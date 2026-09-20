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

; GetParameters / GetOptions 来自 NSIS 自带的 FileFunc.nsh；
; ${IfNot} 来自 LogicLib.nsh。
; electron-builder 模板不会自动 include 这两个文件，这里手动引入以便
; .onInit 解析 /S 并走 silent 分支。
!include "LogicLib.nsh"
!include "FileFunc.nsh"

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

; electron-builder 模板已经定义 Function .onInit，并在内部 !insertmacro
; customInit 钩子，我们直接挂 customInit 即可避免「Function .onInit already
; exists」报错。
;
; 检测命令行：含 /S 视为「应用内主动更新调用」→ SetSilent silent，
; 让 MUI_PAGE_WELCOME / DIRECTORY / INSTFILES / FINISH 全部隐藏。
; 双击 Setup 时不走 /S，向导正常渲染（用户仍可手选目录）。
;
; 注意 electron-builder 默认 SilentInstall=normal，理论上 /S 就该静默，
; 但实际渲染仍会闪 INSTFILES 进度页。SetSilent silent 是更激进的方案，
; 让所有页面 no-op，彻底「点一下就完事」。
!macro customInit
  Push $R0
  Push $R1
  StrCpy $R0 ""
  StrCpy $R1 ""
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${IfNot} ${Errors}
    SetSilent silent
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

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