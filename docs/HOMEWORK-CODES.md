# 作业同步码制协议 v2.3（HOMEWORK-CODES）

> TaskManager v1.1.1 起，班级作业发布/接收从「固定密码 + 全量同步」改为「码制 + 按码拉取」。
> v1.1.2 起，`publishCode` 改为**自包含**格式（前 8 位即 `syncCode`），发布作业只需输入发布码一个码。
> v1.1.3 起，`publishCode` 改为**可选 secret edit**；每门课程持久化一个 `syncCode`；发布作业**直接进入添加作业 UI**；接收作业**找不到同名课程时弹窗告知**。
> v1.1.4 起，新增「北科云盘（AnyShare）」作为第二同步源（**校园网**），接收方按前缀取最新一份；GitHub 读路径改走 `raw.githubusercontent.com` CDN 解决 60 次/小时速率限制。
> 本文档是**协议规范**：配套网站（申请码 + 云盘镜像）必须照此实现，才能与 App 互通。

## 1. 核心概念

一份**作业包**（bundle）= 一个课程的整套作业（含多节课条目），由 8 位同步作业码标识：

| 码 | 名称 | 长度 | 角色 | 谁知道 |
|---|---|---|---|---|
| `syncCode` | 同步作业码（分享码） | 8 | 标识作业包；接收方凭此码拉取 | 公开，发给同学 |
| `publishCode` | 作业发布码（密钥，可选） | 12 | 可选 secret edit；前 8 位 = syncCode + 4 位 HMAC 校验 | 只有发布者 |

**v1.1.3 默认行为**：GitHub PAT = 用户身份认证，`syncCode` 就够上传；想限制别人改你的码包才填 `publishCode`。
**v1.1.3 持久化**：每门课程有一个 `syncCode`，存于本机 `settings.homework_sync_<courseId>`，首次发布时自动生成；同一课程后续发布复用同一个码。

App 端入口（v1.1.3）：「作业同步」菜单分三个按钮——
**生成作业码**（生成/展示码对，留给网站或跨设备分发）、**发布作业**（点开**直接进「添加作业」界面** → 填完即上传 + 自动落到本地）、**接收作业**（输入同步码 → 拉取 → 自动挂到同名课程；找不到时弹窗告知）。

## 2. 码的规范

### 2.1 字符表

```
23456789ABCDEFGHJKMNPQRSTUVWXYZ
```

31 个字符 = 数字 2-9 + 大写字母去掉 `0 O 1 I L`（易混淆字符全部剔除）。
输入时 App 会忽略大小写、空格和连字符（规范化：大写 + 去非字母数字）。

### 2.2 生成规则

- `syncCode`：8 位，字符表内**均匀随机**。
- `publishCode`：12 位 = `syncCode(8位) + 校验位(4位)`，校验位按下式派生（伪代码）：

```
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
SECRET   = "StarOS-Homework-Code-v1"        // 派生密钥，网站端必须使用同一字符串
mac      = HMAC_SHA256(key = SECRET, message = "publish:" + syncCode)
check    = ALPHABET[mac[0] % 31] + ALPHABET[mac[1] % 31] + ALPHABET[mac[2] % 31] + ALPHABET[mac[3] % 31]
publishCode = syncCode + check              // 8 + 4 = 12 位
```

参考实现（Node.js）：

```js
const { createHmac, randomBytes } = require('crypto');
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const SECRET = 'StarOS-Homework-Code-v1';

function randomCode(len) {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

function derivePublishCode(syncCode) {
  const mac = createHmac('sha256', SECRET).update(`publish:${syncCode}`).digest();
  let check = '';
  for (let i = 0; i < 4; i++) check += ALPHABET[mac[i] % ALPHABET.length];
  return syncCode + check;   // 前 8 位就是 syncCode 本身
}

// 网站端「申请发布码」按钮：
const syncCode = randomCode(8);            // 如 "7KQ2M4XP"
const publishCode = derivePublishCode(syncCode); // 如 "7KQ2M4XPT9F3"
```

> ⚠️ 改动 `SECRET` 会使所有已分发的发布码失效。如需升级算法， bump 版本后缀（如 `StarOS-Homework-Code-v2`）并做兼容。

### 2.3 验证规则

发布码自包含，验证（也是解析）只需一个码：

```
parse(publishCode) -> syncCode | null
  p = normalize(publishCode)              // 大写 + 去非字母数字
  = null, 若 p.length != 12
  = null, 若任一字符不在字符表内
  = null, 若 derivePublishCode(p.slice(0, 8)) != p
  = p.slice(0, 8), 其他情况               // 前 8 位即同步码
```

## 3. 存储布局

### 3.1 GitHub 源（第一源，已实现）

仓库 `NightRainStarGame/USTBTaskManager`，分支 `main`：

```
homework/<syncCode>.json     ← 作业包本体（一个码一个文件）
```

- **读**：公开仓库匿名可读（GitHub Contents API `GET /repos/.../contents/homework/<syncCode>.json`，或 raw.githubusercontent.com 直链）。
- **写**：需要 GitHub 令牌（fine-grained PAT，仅本仓库、仅 Contents 读写）。令牌只存在发布者本机，不经网站。

### 3.2 云盘源（第二源，v1.1.4 起：AnyShare 外链；v1.1.7 目录范式）

v1.1.4 起内置「北科云盘」（爱数 AnyShare）作为第二同步源。仅在**北京科技大学校园网**内可达。

**v1.1.7 目录转接范式（当前）**：

```
分享根目录/
└── homework/                        ← 固定名一级文件夹（匿名可自动创建）
    └── <publishCode>/               ← 作业发布码（12 位）命名的文件夹 = 一个课程的整套作业包
        └── <courseKey>-<unix_ts>.json   ← 作业包本体；课程通用 ID 命名 + 时间戳版本
```

- `publishCode = syncCode + 4 位校验`，接收端可由 syncCode **本地 HMAC 派生**（无需传输）。
- `courseKey` = 课程通用固定 ID（`CK-` + 哈希(课程名|授课老师)），同名同授课老师在所有设备上一致；文件夹里一眼能看出作业属于哪门课。
- 匿名分享**不能覆盖 / 不能删除**同名文件 → 每次发布写新时间戳文件；接收端按修改时间取最新。
- **旧版兼容**：v1.1.4~1.1.6 的扁平结构 `分享根目录/<syncCode>-<ts>.json` 仍可读；新版本发布后包自动迁入新结构。

**课程通用固定 ID（v1.1.7，配套）**：作业包 JSON 顶层新增 `courseKey` 字段；接收端挂载链：用户手选 > `courseKey` 精确命中（**命中的所有同名同老师课程一起挂**）> 旧 `courseGuid` > 同名唯一 > 同名多个弹窗手选。同步作业码也按 courseKey 共享（同名同老师的课程在发布方本地共用一个码一个包）。

**App 端读取方式**：走 `electron/anyshare.ts` 客户端：
1. POST `/link` 表单（id=外链ID, type=anonymous, password=提取码）→ 302 Set-Cookie `link_token:<id>=ory_at_xxx`
2. 后续一律 `Authorization: Bearer <token>`：
   - `POST /api/efast/v1/dir/list {docid=根}`  → `{files: [{name, docid, rev, size, modified}]}`
   - `POST /api/open-doc/v1/file-download {doc:[{id, version}]}` → `{items: [{url: 签名直链}]}`
   - `POST /api/efast/v1/file/osbeginupload` → S3 multipart 直传 → `osendupload`

**v1.1.4 UI**：发布弹窗「发布到」切换 `GitHub` / `北科云盘（需校园网）`；Settings 页「作业同步」区可改外链/提取码/启停。

**网站端指引**（若要兼容）：
- 在云盘分享根目录里建一个 `<syncCode>/homework.json` 镜像 GitHub 内容即可，App 当前不会去解析 `<syncCode>/` 子目录，而是按 `<syncCode>-<ts>.json` 平铺；
- 接收失败（404 / 超时）时 App 自动回落到 GitHub 源。

## 4. 作业包 JSON 格式

```json
{
  "syncCode": "7KQ2M4XP",
  "courseName": "高等数学A(1)",
  "createdAt": 1760000000000,
  "updatedAt": 1760000123456,
  "entries": [
    {
      "id": "uuid-v4",                  // 稳定 ID，接收端去重键
      "courseName": "高等数学A(1)",
      "sessionDate": "2026-09-17",      // 上课日期 YYYY-MM-DD
      "sessionTime": "08:00-09:35",     // 可选
      "title": "第三章习题 1-10",
      "content": "具体要求…",
      "type": "homework",               // homework | exam | project | reading | other
      "dueDate": 1760072340000,         // 截止时间 ms，可选
      "publisher": "学委-张三",
      "publishedAt": 1760000000000,
      "updatedAt": 1760000123456
    }
  ]
}
```

规则：
- **一个包只属于一个课程**；`courseName` 以最新一次发布为准。
- **幂等键**：`sessionDate + title` 相同视为同一条（覆盖更新，保留原 `id`）。
- `entries` 按 `sessionDate` 升序。

## 5. App 端行为（供网站端理解）

### 发布（PublishHomeworkModal，v1.1.3 流程）

1. 「作业同步 → 发布作业」**直接打开「添加作业」界面**（课程 / 类型 / 标题 / 内容 / 上课日 / 截止），无需先输码；
2. 后端 `homework:publish` 收到 `courseId`（或 `syncCode`）后决定远端 bundle：
   - 传 `courseId` 且该课程持久化过 `syncCode` → 复用；
   - 传 `courseId` 但未持久化 → 自动生成 8 位 `syncCode` 存 `settings.homework_sync_<courseId>`；
   - 传 `syncCode`（兼容旧流程）→ 直接用；
   - 都不传 → 报错；
3. 可选「secret edit」勾上后，App 校验 `publishCode`（HMAC）；不勾则跳过（仅依赖 GitHub PAT）；
4. 首次发布需配置 GitHub 令牌（`homework:saveAuth`，存本机 settings 表）；
5. `homework:publish` 写 GitHub `homework/<syncCode>.json`；成功后自动 `homework:receive` 一次把刚发布的条目落到本地课程。

### 接收（ReceiveHomeworkModal，v1.1.3 流程）

1. 输入 `syncCode` → `homework:receive`；
2. App 依次尝试 GitHub → 云盘源拉包；
3. 按 `courseName` 匹配本地课程：
   - **命中** → 按 `remote_id`（即 entry.id）去重写入课程作业列表；已存在则只更新内容字段，**不动本地完成状态**；
   - **未命中** → 不再自动建课；返回 `courseNotFound=true` + `courseName=X`，前端弹窗告知并提供「新建该课程并接收 / 我先手动添加课程」两个选项。

## 6. 安全边界
- `publishCode`（v1.1.3 起可选，默认关闭）是协议层/UI 层门槛（防冒发），**真正的写权限由 GitHub 令牌控制**。
- 派生算法内置在客户端（App / 网站），防君子不防逆向——对班级作业场景足够。
- 任何人拿到 `syncCode` 都能读取作业内容（这是设计目标：分享码=读取权）。
- **v1.1.3 起**：接收作业要求本地已存在同名课程，避免被远端包任意新建空课。
