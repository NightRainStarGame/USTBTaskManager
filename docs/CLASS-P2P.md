# 班级 P2P 架构文档（v1.2.7）

> "P2P" 在这里指**没有中心服务器**——所有数据落在共享云盘（GitHub raw + 北科云盘），客户端持密钥自验证。

## 设计目标

1. **零 VPS 依赖**：用户运行应用不需要任何服务端（v1.2.5 → v1.2.6 因为 VPS 难维护被砍掉；v1.2.7 用云盘替代）
2. **数据真实可信**：成员身份和公告内容用 HMAC 签名嵌入文件，**任何客户端都能离线验证**
3. **完全离线可用**：本地 SQLite 缓存所有公告/作业，断网也能浏览历史
4. **多源冗余**：GitHub raw（主）+ 北科云盘（备），一源挂了自动降级
5. **可观测**：每个成员 / 公告 / 作业都带签名，UI 能识别伪造

## 为什么这样设计

### 不用 server 的原因

- v1.2.5 班级系统依赖 VPS Fastify + better-sqlite3（开发者自己维护，每月维护成本）
- VPS 挂了 → 所有用户的班级功能挂掉
- 服务端鉴权绕不开 → 仍然可能伪造成员
- 私钥管理复杂（要不要给用户 JWT？要不要 OAuth？）

### 不用纯 P2P（libp2p/IPFS）的原因

- libp2p 启动 5 秒 + 内存 50MB+ → 桌面应用开销大
- IPFS 节点需要 port forwarding → 校园网 NAT 不友好
- 用户学习成本高（要懂"节点"概念）

### 用共享云盘的取舍

- ✅ 启动零延迟（用云盘的 HTTP API）
- ✅ 校园网内免费（北科云盘是校方提供的）
- ✅ 公开访问（GitHub raw 任何人都能拉）
- ⚠️ 需要信任云盘（云盘管理员能篡改文件 → 但 HMAC 签名能识别）
- ⚠️ 没有实时推送（轮询，30 秒一次）

## 文件协议

### 路径命名

```
class/<inviteCode>/                  ← inviteCode 12 位（classCode + 4 位 HMAC 校验）
  manifest.json                      ← 班级核心元数据
  announcements/<annId>.json         ← 公告条目（annId = 发布时刻时间戳）
  tasks/<taskId>.json               ← 作业条目
```

**为什么用 inviteCode 而不是 classCode 作为路径前缀？**

- inviteCode 自包含校验位（HMAC 4 位），用户手抄不易错
- 客户端拿到 inviteCode 后先 `parseInviteCode` 校验合法性 → 提取 classCode
- 8 位 classCode 单独用 → 容易被误抄（比如用户从聊天复制 `ABCD-EFGH` 漏了 `-`）

### manifest.json 结构

```json
{
  "classCode": "ABCD2345",
  "inviteCode": "ABCD2345EFGH",
  "name": "计科 21-1 班",
  "description": "高等数学同步小组",
  "ownerAlias": "豆芽",
  "createdAt": 1695400000000,
  "members": [
    {
      "alias": "豆芽",
      "role": "owner",
      "joinedAt": 1695400000000,
      "sig": "K7vN9pQ2mX4zL8cR"
    },
    {
      "alias": "Alice",
      "role": "admin",
      "joinedAt": 1695500000000,
      "sig": "a3B7yZ9dF2gH5jK1"
    }
  ],
  "lastAnnouncementId": 1695600000000,
  "lastTaskId": 1695700000000,
  "updatedAt": 1695600000000,
  "sig": "M5xR8tY2pQ9wK3jL"
}
```

### 公告条目

```json
{
  "id": 1695600000000,
  "authorAlias": "豆芽",
  "title": "明天调课通知",
  "body": "上午高数调到下午 3 点，请相互转告",
  "images": [],
  "pinned": false,
  "createdAt": 1695600000000,
  "sig": "P2wQ7yX5rN8kM1jL"
}
```

## 密码学

### 密钥来源

```ts
// electron/class/crypto.ts
export const CLASS_SECRET = 'StarOS-Class-P2P-v1';
```

嵌入 build（不暴露），所有客户端持有同一份 → 任何人都能验证任何人的签名。

**代价**：build 用户反编译 → SECRET 泄露 → 整个系统崩。但 SECRET 泄露也需要配合云盘写权限才能伪造（GitHub PAT + 签名 + 路径三层防护）。

### 签名工具

| 类型 | 算法 | 用途 |
|---|---|---|
| `signMember(alias, classCode, role)` | `HMAC-SHA256(CLASS_SECRET, "member:" \| classCode \| "|" \| alias \| "|" \| role).slice(0, 16)` | 成员身份（防成员伪造） |
| `signEntry(classCode, kind, id, body)` | `HMAC-SHA256(CLASS_SECRET, "entry:" \| classCode \| "|" \| kind \| "|" \| id \| "|" \| body).slice(0, 16)` | 单条内容（防内容篡改） |
| `signManifest(m)` | `HMAC-SHA256(CLASS_SECRET, "manifest:" \| classCode \| "|" \| name \| "|" \| ownerAlias \| "|" \| lastAnn \| "|" \| lastTask \| "|" \| updatedAt).slice(0, 16)` | manifest 整体 |

### 验证流程

```ts
// 加入班级时
const manifest = await fetchManifest(inviteCode);

// 1. 验证 manifest 整体签名
if (manifest.sig !== signManifest(manifest)) throw 'manifest 签名校验失败';

// 2. 逐个验证成员签名
for (const m of manifest.members) {
  if (!verifyMember(m.alias, classCode, m.role, m.sig)) throw `${m.alias} 签名伪造`;
}

// 3. 写入本地数据库
db.insert({ classCode, role: 'member', members: manifest.members });
```

## 同步机制

### 30 秒轮询

每个打开的班级详情页有 `useEffect` + `setInterval(sync, 30_000)`：

```ts
useEffect(() => {
  const t = setInterval(sync, 30_000);
  return () => clearInterval(t);
}, []);
```

`sync()` 调 `class:sync` IPC → `fetchClassSnapshot`：

1. 拉 GitHub manifest（带 `If-None-Match: <本机缓存 sha>`）
2. 304 Not Modified → 不动本地
3. 200 OK + 新 manifest → 解析 `lastAnnouncementId / lastTaskId`
4. 增量拉新公告/作业（id > 本机已知 max id）
5. 每条 `verifyEntry` 校验 → 失败的丢弃 + 警告
6. 写本地 SQLite
7. GitHub 失败 → 降级 AnyShare
8. 两源都失败 → 提示「请检查网络」

### 手动同步

详情页右上「同步」按钮 → `class:sync(classId)` → 同上流程（不等 30 秒）。

### 离线浏览

本地 SQLite 已缓存所有看过的公告/作业 → 断网也能浏览。
但「拉新」必须联网。

## 权限模型

### 三种角色

- **owner**（创建者）：
  - 持有 owner_token（32 字节 base64url，本地生成）
  - 能发布公告 / 作业 / promote admin
  - 离开 → 班级解散
- **admin**（管理员）：
  - 在 manifest.members 标 role='admin'，需 owner 主动 promote
  - 当前实现：admin 实际权限等同 member（v1.2.7 暂不实现 promote，v1.2.8 加）
- **member**（普通成员）：
  - 只能 read + 标记本地已读

### 为什么 owner_token 不上传

- owner_token 是本地生成的 32 字节 base64url
- 仅本机持有 → publish 时用 HMAC 计算签名作为"权威证明"
- 不上传 → 即使云盘管理员拿到 token 也不能伪造 owner 操作（因为 HMAC 在客户端算）

### 实际上如何"权威"

- publish 走 GitHub Contents API PUT，需要 `owner` 角色 + 对应 PAT 权限
- PAT 在 GitHub Settings → Developer settings → Personal access tokens 创建
- 用户在「班级 → 配置」填一次即可

## 已知限制与未来改进

| 限制 | 影响 | 改进计划 |
|---|---|---|
| 实时推送 | 新公告要等 30 秒轮询 | v1.2.8 加 WebSocket 或长轮询 |
| 图片附件 | manifest `images: []` 永远空 | v1.2.8 加图片上传（GitHub LFS） |
| owner 转让 | owner 离开 → 班级解散 | v1.2.8 admin promote |
| 冲突合并 | 两台电脑同时 publish 撞 409 | v1.2.8 加 CRDT 风格合并 |
| 成员上限 | manifest 限制 50 人 | v1.2.8 manifest 限流 + sharding |
| 加密传输 | 云盘管理员能看到内容 | 不解决（设计取舍） |

## 文件清单

| 文件 | 作用 |
|---|---|
| `electron/class/crypto.ts` | HMAC 派生 + 签名工具 |
| `electron/class/storage.ts` | GitHub raw + AnyShare 多源适配器 |
| `electron/class/index.ts` | 10+ IPC handlers |
| `src/pages/Class/index.tsx` | 班级列表页 |
| `src/pages/Class/ClassDetail.tsx` | 班级详情页 |
| `src/mocks/browserApi.ts` | 浏览器 mock（识别 DEMO 前缀） |