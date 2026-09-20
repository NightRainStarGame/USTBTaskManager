; ============================================================
; build/installer.nsh —— NSIS 自定义脚本（electron-builder 自动 include）
;
; 目的：
;   1. 升级安装时清掉 Electron 运行时缓存（避免代码堆叠）
;   2. 静默安装（/S）完成后自动拉起新版本 TaskManager.exe，
;      实现「点更新按钮 → 等一会自己起来」的无感升级
;   3. /S 参数检测：用 `silentInstall` 标志让 NSIS 向导全程静默
;      （不弹"为我安装"、不弹目录选择），同时保留双击 Setup
;      时的正常向导流程
;
; 提供的宏：
;   cleanStaleAppFiles —— 在 installApplicationFiles 之前调用
; ============================================================

!macro cleanStaleAppFiles
  ${if} ${FileExists} "$INSTDIR\resources\app\Cache"
    RMDir /r "$INSTDIR\resources\app\Cache"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\Code Cache"
    RMDir /r "$INSTDIR\resources\app\Code Cache"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\GPUCache"
    RMDir /r "$INSTDIR\resources\app\GPUCache"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\Local Storage"
    RMDir /r "$INSTDIR\resources\app\Local Storage"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\Session Storage"
    RMDir /r "$INSTDIR\resources\app\Session Storage"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\Network"
    RMDir /r "$INSTDIR\resources\app\Network"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\blob_storage"
    RMDir /r "$INSTDIR\resources\app\blob_storage"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\DawnGraphiteCache"
    RMDir /r "$INSTDIR\resources\app\DawnGraphiteCache"
  ${endif}
  ${if} ${FileExists} "$INSTDIR\resources\app\DawnWebGPUCache"
    RMDir /r "$INSTDIR\resources\app\DawnWebGPUCache"
  ${endif}
!macroend

!macro customInstall
  !insertmacro cleanStaleAppFiles
!macroend

; .onInit 在 NSIS 启动时最先跑（向导页加载前）。
; 检测命令行：含 /S 视为「应用内主动更新调用」→ 设 silentInstall，
; electron-builder 模板的 MUI_PAGE_*_GRAY 会把对应向导页变成 no-op，
; 整个安装流程不再弹任何窗口。
;
; 注意：
; - electron-builder 的 NSIS 模板默认 silentInstall 只对 oneClick=true
;   真正生效。我们这里加 .onInit 钩子强制覆盖，让 oneClick=false 也能
;   在 /S 时跳过欢迎页 / 目录页 / 安装页 / 完成页。
; - 不动双击 Setup（不含 /S）的体验，用户仍可手选安装位置和确认安装。
Function .onInit
  Push $0
  Push $1
  ; 在 /S 或 /D=<path> 出现时把 silentInstall 旗打开
  StrCpy $0 ""
  StrCpy $1 ""
  ${GetParameters} $0
  ${GetOptions} $0 "/S" $1
  ${IfNot} ${Errors}
    SetSilent silent
    SetSilentInstall silent
  ${EndIf}
  ; silentInstall 旗只控制 MUI 是否渲染向导页，不影响 installApplicationFiles 执行。
  ; 即：文件仍会照常解压 + 落盘，只是没有窗口。
  Pop $1
  Pop $0
FunctionEnd

; 安装成功后自动拉起新版本。
;   - 不论 Setup 是被用户双击、还是被 App 通过 /S 静默拉起的，都走这条路径
;   - 升级场景下用户已经「确认要装新版」——不管是点了 NSIS 的 Install 按钮、还是点了 App 里的更新按钮——都期望新版自动起来
;   - .onInstSuccess 在 installApplicationFiles 完成后触发，$INSTDIR 里已经是新文件，再拉起就是新版本
;   - ExecShell 是异步的，NSIS 自己退出后拉起的 exe 仍正常运行
Function .onInstSuccess
  ${If} ${FileExists} "$INSTDIR\TaskManager.exe"
    ExecShell "" '"$INSTDIR\TaskManager.exe"' "" SW_SHOWNORMAL
  ${EndIf}
FunctionEnd