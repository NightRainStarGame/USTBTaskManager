# 作业同步码制协议 v2.1（HOMEWORK-CODES）

> TaskManager v1.1.1 起，班级作业发布/接收从「固定密码 + 全量同步」改为「码制 + 按码拉取」。
> v1.1.2 起，`publishCode` 改为**自包含**格式（前 8 位即 `syncCode`），发布作业只需输入发布码一个码。
> 本文档是**协议规范**：配套网站（申请码 + 云盘镜像）必须照此实现，才能与 App 互通。

## 1. 核心概念

一份**作业包**（bundle）= 一个课程的整套作业（含多节课条目），由一对随机码标识：

| 码 | 名称 | 长度 | 角色 | 谁知道 |
|---|---|---|---|---|
| `syncCode` | 同步作业码（分享码） | 8 | 标识作业包；接收方凭此码拉取 | 公开，发给同学 |
| `publishCode` | 作业发布码（密钥） | 12 | 发布方授权凭据；**前 8 位 = syncCode + 后 4 位校验** | 发布者自己留存 |

**关键性质**：`publishCode = syncCode(8位) + 校验位(4位)`。
- 校验位由 `syncCode` 经 HMAC-SHA256 派生，防止随手编造；
- 发布码**自包含**同步码：发布作业只需输入这一个码，App 本地解析 + 校验即可（无需联网、无需服务端）；
- 网站端生成码时用相同 SECRET，即可产出与 App 完全兼容的码对。

App 端入口（v1.1.2）：「作业同步」菜单分三个按钮——
**生成作业码**（生成/展示码对）、**发布作业**（只输发布码）、**接收作业**（只输同步码）。

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

### 3.2 云盘源（第二源，网站负责）

网站「申请发布码」按钮应做两件事：

1. **生成码对**（按 §2.2 规则）并展示给用户；
2. **在云盘建目录**：`/<syncCode>/`（以同步作业码命名），预留 `homework.json`。

之后每当有发布动作，镜像一份与 GitHub 相同的 JSON 到：

```
/<syncCode>/homework.json    ← 与 homework/<syncCode>.json 内容完全一致
```

App 端云盘源的约定（网站按此提供 HTTP 接口即可被 App 读取）：

```
GET {CLOUD_SOURCE_BASE}/<syncCode>/homework.json
  200 → 作业包 JSON（见 §4）
  404 → 该源没有此码（App 会继续尝试下一源）
```

`CLOUD_SOURCE_BASE` 在 App 的 `electron/homework/index.ts` 中配置（当前为 null = 未启用）。
网站上线后把 base URL 告诉 App 维护者填入即可，无需改协议。

**源优先级**：App 先查 GitHub，再查云盘；第一个命中即用。某源故障（超时/5xx）不阻断其他源。

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

### 发布（PublishHomeworkModal）

1. 「作业同步 → 生成作业码」或网站申请得到码对（发布码 = 密钥，同步码 = 分享码）；
2. 「发布作业」输入 `publishCode` → `homework:verifyCodes` 本地解析校验（顺带得到 `syncCode`）；
3. 首次发布需配置 GitHub 令牌（`homework:saveAuth`，存本机 settings 表）；
4. 进入发布界面：选课程 / 上课日期 → 写标题内容 → `homework:publish` 写 GitHub `homework/<syncCode>.json`；
5. 发布成功后自动按此码接收一次，落到本地课程。

### 接收（ReceiveHomeworkModal）

1. 输入 `syncCode` → `homework:receive`；
2. App 依次尝试 GitHub → 云盘源拉包；
3. 按 `courseName` 匹配本地课程（没有则自动建课，绿色 #00FF88，描述「由作业接收自动创建」）；
4. 按 `remote_id`（即 entry.id）去重写入课程作业列表；已存在则只更新内容字段，**不动本地完成状态**。

## 6. 安全边界

- `publishCode` 是协议层/UI 层门槛（防误发、防班级内随意冒发）；**真正的写权限由 GitHub 令牌控制**。
- 派生算法内置在客户端（App / 网站），防君子不防逆向——对班级作业场景足够。
- 任何人拿到 `syncCode` 都能读取作业内容（这是设计目标：分享码=读取权）。
