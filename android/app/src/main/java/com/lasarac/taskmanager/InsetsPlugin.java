package com.lasarac.taskmanager;

import android.os.Build;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.2.11 rev2：把真实的系统窗口 inset（状态栏 / 导航栏 / 手势条）交给 Web 层。
 *
 * 上一版的坑：只提供 get()，由 Web 启动时问一次。但 Activity 刚起来时
 * getRootWindowInsets() 常常还是 null，Web 拿到全 0，之后又没有任何事件触发
 * 重读 → 安全区永久为 0 → 抽屉顶到状态栏下（用户实测反馈）。
 *
 * 这一版改成【主动推送】：注册 OnApplyWindowInsetsListener，系统每次分发
 * inset（首次布局、横竖屏、手势/三键切换、键盘）都立刻 evaluateJavascript
 * 把值推进 WebView；get() 保留给 Web 主动轮询做交叉验证。
 */
@CapacitorPlugin(name = "Insets")
public class InsetsPlugin extends Plugin {

    private static final String TAG = "InsetsPlugin";

    @Override
    public void handleOnStart() {
        View decor = getDecor();
        if (decor == null) return;

        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            pushInsets(insets);
            // 不消费：Capacitor 的 WebView 自己也要用这些 inset
            return insets;
        });
        // 请求一次立即分发（布局完成后还会再分发一次真值）
        ViewCompat.requestApplyInsets(decor);
        // 兜底：万一监听没被回调，用当前已知值先推一次
        pushInsets(ViewCompat.getRootWindowInsets(decor));
    }

    /** Web 侧主动轮询（src/mobile/insets.ts 的多轮探测）。 */
    @PluginMethod
    public void get(PluginCall call) {
        View decor = getDecor();
        WindowInsetsCompat compat = decor != null ? ViewCompat.getRootWindowInsets(decor) : null;
        call.resolve(insetsToJs(compat));
    }

    private View getDecor() {
        return getActivity() != null ? getActivity().getWindow().getDecorView() : null;
    }

    /** 把最新 inset 推进 WebView（主线程）。 */
    private void pushInsets(WindowInsetsCompat compat) {
        JSObject ins = insetsToJs(compat);
        if (compat == null) return;
        int top = ins.optInt("top", -1);
        int bottom = ins.optInt("bottom", -1);
        int left = ins.optInt("left", -1);
        int right = ins.optInt("right", -1);
        if (top < 0 && bottom < 0 && left < 0 && right < 0) return;

        String js = String.format(
                "(function(){if(window.__TASKMGR_APPLY_INSETS__){window.__TASKMGR_APPLY_INSETS__(%d,%d,%d,%d);}})()",
                Math.max(top, 0), Math.max(bottom, 0), Math.max(left, 0), Math.max(right, 0));
        evaluate(js);
    }

    private void evaluate(String js) {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            WebView wv = bridge.getWebView();
            if (wv == null) return;
            wv.evaluateJavascript(js, null);
        } catch (Exception e) {
            Log.w(TAG, "evaluateJavascript 失败（页面可能还没就绪）", e);
        }
    }

    private JSObject insetsToJs(WindowInsetsCompat compat) {
        JSObject ret = new JSObject();
        float top = 0f, bottom = 0f, left = 0f, right = 0f;

        if (compat != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            androidx.core.graphics.Insets sb = compat.getInsets(WindowInsetsCompat.Type.statusBars());
            androidx.core.graphics.Insets nb = compat.getInsets(WindowInsetsCompat.Type.navigationBars());

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

        ret.put("top", Math.round(top));
        ret.put("bottom", Math.round(bottom));
        ret.put("left", Math.round(left));
        ret.put("right", Math.round(right));
        return ret;
    }
}
