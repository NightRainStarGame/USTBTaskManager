# TaskManager v1.2.13

## 修复：增量补丁板块消失（v1.2.12 回归）

v1.2.12 把桌面端更新主源切换到 SSIO 后，设置页的「增量补丁」按钮不再出现，所有人只能下载 93MB 整包。两个独立原因叠加：

**1. SSIO 源合成清单时硬编码了空补丁表**

`electron/updater/ssio.ts` 把 SSIO 的 API 响应合成成 `latest.json` 文本时写了 `patches: []`（当时的注释是「SSIO 不做增量补丁」）。而补丁面板 `PatchPanel.tsx` 完全靠 `manifest.patches` 渲染，空数组 → 按钮不渲染 → 板块消失。

改为：整包信息仍取 SSIO 的 `/v1/releases/latest`（国内下载快），**补丁清单改从 SSIO KV 读取**发版时同步的完整 `latest.json`。只有当 KV 里的版本与 SSIO 发行版本一致时才下发补丁，避免版本没同步时客户端拿到错误基线（baseAsarSha256 不匹配必然应用失败）。KV 不可达时自动退化为整包更新。

**2. v1.2.12 发版时补丁根本没生成成功**

发版脚本在生成 1.2.11→1.2.12 补丁时，缓存里缺 `1.2.12.asar`，异常被 `try/catch` 静默吞掉（只打印一行警告），`latest.json` 的 `patches` 因此继承为空数组。

已补生成 `TaskManager-Patch-1.2.11-to-1.2.12.zip`（22.30 MB）并上传到 v1.2.12 Release。此前漏生成的历史版本补丁同样可回溯补齐。

## 改进：发版流程补上清单同步

新增 `scripts/publish-manifest-kv.js`，发版脚本在写好 `latest.json` 之后自动把它同步到 SSIO KV（key `taskmgr/latest.json`）并回读校验版本与补丁条数。漏掉这步 = 增量补丁不可用，所以现在它是发版流程的一环，同步失败会明确告警。

## 影响面

- 桌面端：更新时重新出现「增量补丁 22.3 MB」按钮（整装 93 MB），补丁 zip 走 GitHub raw / jsDelivr 镜像链
- 移动端：不受影响（APK 更新走 KV 清单，本来就是整包）
- 已装 v1.2.12 的用户：升级到本版后，下次更新即可使用增量补丁
