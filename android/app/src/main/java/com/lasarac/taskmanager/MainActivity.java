package com.lasarac.taskmanager;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // v1.2.11：注册自定义插件
        registerPlugin(InsetsPlugin.class);     // 系统栏安全区 → Web
        registerPlugin(ApkInstallerPlugin.class); // APK 自更新

        // v1.2.11：显式全屏布局（edge-to-edge），系统栏透明。
        // 内容避让不再依赖各机型 WebView 对 env(safe-area-inset-*) 的实现差异，
        // 而是由 Web 层使用 InsetsPlugin 给出的权威值做 padding —— 这是移动端
        // 「状态栏盖住顶栏、手势条压住悬浮球」这类重叠的根治办法。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 关掉系统自动加的对比度遮罩，否则状态栏会浮现一条灰底
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
    }
}
