package com.lasarac.taskmanager;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * v1.2.11：APK 自更新 —— 下载并拉起系统安装界面。
 *
 * 以前移动端「设置 → 更新」只有一句话：不支持应用内更新，去 GitHub 下载。
 * 结果就是用户手上的 APK 永远停在旧版本，bug 修了也到不了手机上。
 *
 * 链路：
 *   JS 侧比对 latest.json 的 android.versionCode >
 *   本机 BuildConfig.VERSION_CODE → 调 installApk({url, sha256})
 *   → 后台线程下载到 app 私有 Download/update/
 *   → sha256 校验（可选但强烈建议）
 *   → FileProvider content:// Uri + ACTION_VIEW 交给系统安装器
 *
 * 为什么不用 DownloadManager：需要额外权限语义且进度回调复杂；
 * APK 只有几 MB，直连下载完全够用，也便于做 sha256 校验。
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final String TAG = "ApkInstaller";
    private final ExecutorService pool = Executors.newSingleThreadExecutor();

    /** Android 8+ 安装未知应用需要显式授权，先让 JS 知道状态。 */
    @PluginMethod
    public void canRequestInstalls(PluginCall call) {
        boolean allowed;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        } else {
            allowed = true;
        }
        call.resolve(new JSObject().put("allowed", allowed));
    }

    /**
     * 本机 APK 版本。JS 侧用它做 versionCode 比对 —— 比字符串版本号可靠：
     * 一旦出现非标准命名，字符串比较就会误判。
     *
     * 用 PackageManager 而不是 BuildConfig：AGP 8 默认不再生成 BuildConfig，
     * 而 PackageInfo 读的是实际安装的包信息，天然与安装包一致。
     */
    @PluginMethod
    public void currentVersion(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pi = pm.getPackageInfo(getContext().getPackageName(), 0);
            int versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? (int) pi.getLongVersionCode()
                    : pi.versionCode;
            call.resolve(new JSObject()
                    .put("versionCode", versionCode)
                    .put("versionName", pi.versionName));
        } catch (Exception e) {
            Log.w(TAG, "read PackageInfo failed", e);
            call.resolve(new JSObject().put("versionCode", 0).put("versionName", ""));
        }
    }

    /** 打开「允许安装未知应用」设置页。 */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve(new JSObject().put("ok", true));
    }

    /**
     * 下载 APK 并安装。参数：url（必填）、sha256（可选，建议填）。
     * 返回值统一为 ok/reason，JS 侧据此决定文案 —— 不用 reject，
     * 避免不同端 Capacitor 版本 reject 签名差异吞掉错误码。
     */
    @PluginMethod
    public void installApk(final PluginCall call) {
        final String url = call.getString("url");
        final String sha256 = call.getString("sha256");

        if (url == null || url.isEmpty()) {
            call.resolve(new JSObject().put("ok", false).put("reason", "MISSING_URL"));
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.resolve(new JSObject().put("ok", false).put("reason", "NEED_INSTALL_PERMISSION"));
            return;
        }

        call.setKeepAlive(true);
        pool.execute(new Runnable() {
            @Override
            public void run() {
                doDownloadAndInstall(url, sha256, call);
            }
        });
    }

    private void doDownloadAndInstall(String urlStr, String sha256, PluginCall call) {
        HttpURLConnection conn = null;
        try {
            File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "update");
            if (!dir.exists() && !dir.mkdirs()) {
                fail(call, "MKDIR_FAILED");
                return;
            }
            File file = new File(dir, "TaskManager-update.apk");
            if (file.exists()) {
                file.delete();
            }

            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            conn.setRequestProperty("User-Agent", "TaskManager-Android-Updater");

            int code = conn.getResponseCode();
            if (code >= 400) {
                Log.w(TAG, "download failed, http " + code);
                fail(call, "HTTP_" + code);
                return;
            }

            InputStream in = conn.getInputStream();
            FileOutputStream out = new FileOutputStream(file);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            out.flush();
            out.close();
            in.close();

            if (sha256 != null && !sha256.isEmpty()) {
                String actual = sha256(file);
                if (!sha256.equalsIgnoreCase(actual)) {
                    Log.w(TAG, "sha256 mismatch: expect " + sha256 + " got " + actual);
                    file.delete();
                    fail(call, "SHA256_MISMATCH");
                    return;
                }
            }

            install(file, call);
        } catch (Exception e) {
            Log.e(TAG, "installApk error", e);
            fail(call, "EXCEPTION:" + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void install(File file, PluginCall call) {
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve(new JSObject().put("ok", true).put("file", file.getAbsolutePath()));
        } catch (Exception e) {
            Log.e(TAG, "start install intent failed", e);
            fail(call, "INTENT_FAILED:" + e.getMessage());
        }
    }

    private void fail(PluginCall call, String reason) {
        call.resolve(new JSObject().put("ok", false).put("reason", reason));
    }

    private static String sha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        FileInputStream in = new FileInputStream(file);
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            md.update(buf, 0, n);
        }
        in.close();
        byte[] digest = md.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
