; ============================================================
; build/installer.nsh —— NSIS 自定义脚本（electron-builder 自动 include）
;
; 目的：
;   1. 升级安装时清掉 Electron 运行时缓存（避免代码堆叠）
;   2. 静默安装（/S）完成后自动拉起新版本 TaskManager.exe，
;      实现「点更新按钮 → 等一会自己起来」的无感升级
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