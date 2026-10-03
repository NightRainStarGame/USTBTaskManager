# TaskManager v1.2.14

## 修复：增量补丁「应用后退出就没下文」（最严重）

现象：点「应用补丁并重启」→ App 退出 → 然后再也没有动静，版本号也没变。

根因在 `electron/resources/patch-helper.cjs`：helper 自身是以 `ELECTRON_RUN_AS_NODE=1` 启动的（否则打包后的 exe 跑不了 Node 脚本），而它拉起新版本时**原样继承了 env**：

```js
spawn(process.execPath, [], { env: { ...process.env, TASKMGR_PATCH_APPLIED: '1' } })
```

于是新拉起来的 TaskManager.exe 进入 **Node 模式** —— 没有 GUI、没有入口参数，起来就退出。用户看到的就是「退出后再也没下文」。这是 AGENTS.md §7 明令的红线（spawn 打包 exe 前必须 delete `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`），这次是被自己违反了。

修复：
- 拉起前清掉 `ELECTRON_RUN_AS_NODE` 与 `NODE_OPTIONS`
- 拉起前等 1.2s（主进程刚退出，单实例锁释放有延迟，否则新进程会被判成「第二个实例」直接 quit —— 同样表现为没下文）
- 拉起后校验应用进程确实在跑，没起来就再试一次
- 三处重复的 spawn 统一收敛到 `relaunchApp()`

补丁本身（下载、基线校验、落盘）一直是对的，只有最后「拉起来」这一步是坏的。

## 精简更新源：默认只启用 2 个

以前 4 个源全开，其中 GitHub raw 国内常被墙 / DNS 劫持、北科云盘只有校园网可达，每次检查更新都要干等它们超时（各 15s），表现为「检查更新半天没反应、一堆源都不好使」。

现在默认只启用：**SSIO 官方源（主）+ jsDelivr CDN（备）**。GitHub raw 与北科云盘改为默认关闭，需要的人在「设置 → 软件更新 → 更新源」里勾选即可启用。

## 班级 / 作业同步：不再显示 GitHub

后端其实 v1.2.12 就已经是 SSIO 主源（SSIO KV 优先、GitHub 仅回退），但**界面文案从头到尾还写着 GitHub**，导致看起来「还在用 GitHub」。本次把面向用户的文案全部改正：

- 班级页：副标题、空列表引导、创建班级提示、配置弹窗（「GitHub 写入通道（主源）」→「SSIO 云同步（主源 · 内置已启用）」）
- 删掉「你还没配置 GitHub PAT，班级数据将仅存本机」的误导警告 —— SSIO 内置通道配不配令牌都能用
- 同步成功提示：`同步完成 · github` → `同步完成 · SSIO 云`
- 作业同步：发布目标「GitHub」→「SSIO 云（主源）」，发布按钮、结果行、接收说明同步改正
- 设置里 GitHub 令牌标注为「备源，可选」，并说明留空不影响使用

## 其它

- 云端返回的 `source` 字段仍是历史值 `github`（那个分支内部是 SSIO 优先），UI 层已按真实主源展示，不再误导
