package com.lasarac.taskmanager;

import android.os.Build;
import android.util.DisplayMetrics;
import android.view.View;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.2.11：把真实的系统窗口 inset（状态栏 / 导航栏 / 手势条）交给 Web 层。
 *
 * 为什么不让 CSS 直接用 env(safe-area-inset-*)？
 *   —— Android WebView 对 env() 的支持随 Chromium 版本漂移，同一份 CSS 在不同
 *      机型上可能拿到 0。这里由原生用 WindowInsetsCompat 读取权威值并换算成
 *      CSS px（=dp），再由 Web 写入 CSS 变量，结果在所有机型上一致。
 *
 * 搭配 MainActivity 的 WindowCompat.setDecorFitsSystemWindows(window, false)：
 * 原生侧全屏延伸（背景铺满更好看），内容避让由 Web 层用这些值做 padding。
 */
@CapacitorPlugin(name = "Insets")
public class InsetsPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        call.resolve(readInsets());
    }

    private JSObject readInsets() {
        JSObject ret = new JSObject();
        float top = 0f, bottom = 0f, left = 0f, right = 0f;

        View decor = getActivity() != null ? getActivity().getWindow().getDecorView() : null;
        if (decor != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            WindowInsetsCompat compat = ViewCompat.getRootWindowInsets(decor);
            if (compat != null) {
                androidx.core.graphics.Insets sb =
                        compat.getInsets(WindowInsetsCompat.Type.statusBars());
                androidx.core.graphics.Insets nb =
                        compat.getInsets(WindowInsetsCompat.Type.navigationBars());

                top = sb.top;
                bottom = nb.bottom;
                left = Math.max(sb.left, nb.left);
                right = Math.max(sb.right, nb.right);

                // 物理 px → CSS px(dp)，与 Web 样式单位对齐
                DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
                float density = dm != null ? dm.density : 1f;
                if (density > 0) {
                    top /= density;
                    bottom /= density;
                    left /= density;
                    right /= density;
                }
            }
        }

        ret.put("top", Math.round(top));
        ret.put("bottom", Math.round(bottom));
        ret.put("left", Math.round(left));
        ret.put("right", Math.round(right));
        ret.put("imeVisible", false);
        return ret;
    }
}
