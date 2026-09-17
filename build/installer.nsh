; ============================================================
; build/installer.nsh —— NSIS 自定义脚本（electron-builder 自动 include）
;
; 目的：升级安装时主动清理可能堆叠的旧文件，避免「代码堆叠 / 旧版新版混文件」。
;
; 工作机制：
;   - electron-builder 在 `installApplicationFiles` 之前调用 `uninstallOldVersion`
;     把旧版整个 $INSTDIR 重命名为 $PLUGINSDIR\old-install，再装新版。
;   - 但 `resources/app/` 里的 .pak、.bin、cache、Code Cache 等可能因浏览器升级而出现
;     新文件。如果新版不再包含某些文件，旧文件会留下来（虽然罕见）。
;   - 这个脚本做**最后一道保险**：在 installApplicationFiles 之前，对几个
;     容易堆叠的临时/缓存目录做 RMDir /r 清空。
;   - 真正的安全网是 uninstallOldVersion 的 rename —— 这里只是兜底。
;
; 提供的宏：
;   cleanStaleAppFiles —— 在 installApplicationFiles 之前调用
; ============================================================

!macro cleanStaleAppFiles
  ; 安装过程中 SetOutPath 已经到 $INSTDIR
  ; 清理容易在升级时堆叠的运行时缓存 / 临时目录
  ; 这些目录里的内容都会被新版运行时重新创建，所以可以安全删除
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
  ; 在新文件被复制到 $INSTDIR 之前，先清掉上面列出的缓存目录
  !insertmacro cleanStaleAppFiles
!macroend