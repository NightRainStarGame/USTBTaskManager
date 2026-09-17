"""
生成 TaskManager 应用图标（build/icon.ico）。

设计：深色圆角方 + 霓虹绿对勾 + 霓虹黄任务点，与 UI 主题色保持一致。
绿 = #00FF88，黄 = #FFEA00，底色 = #0A0F0D -> #000000。

用超采样绘制再降采样，保证小尺寸下边缘依然干净。
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 2048  # 工作画布（超采样）
GREEN = (0, 255, 136)
GREEN_BRIGHT = (0, 255, 200)
YELLOW = (255, 234, 0)
BG_TOP = (10, 15, 13)     # #0A0F0D
BG_BOTTOM = (0, 0, 0)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
os.makedirs(OUT_DIR, exist_ok=True)


def px(v):
    """归一化坐标 -> 像素"""
    return v * S


# ---------- 1. 圆角方形遮罩 ----------
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    [px(0.045), px(0.045), S - px(0.045), S - px(0.045)],
    radius=px(0.235),
    fill=255,
)

# ---------- 2. 竖向渐变底 ----------
grad_line = Image.new('RGB', (1, S))
for y in range(S):
    t = y / (S - 1)
    grad_line.putpixel((0, y), tuple(
        int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
    ))
base = grad_line.resize((S, S), Image.BILINEAR)

# 底部中央的绿色氛围光（刻意收在圆角内部，避免被边界硬切）
amb = Image.new('L', (S, S), 0)
ImageDraw.Draw(amb).ellipse(
    [px(0.10), px(0.48), px(0.90), px(1.00)], fill=58
)
amb = amb.filter(ImageFilter.GaussianBlur(px(0.085)))
base = ImageChops.add(
    base,
    Image.composite(Image.new('RGB', (S, S), (0, 74, 40)),
                    Image.new('RGB', (S, S), (0, 0, 0)), amb),
)

# ---------- 3. 霓虹图形：对勾 + 任务点 ----------
CHECK = [(0.285, 0.525), (0.455, 0.690), (0.735, 0.320)]
STROKE = px(0.115)
DOT_C = (0.775, 0.715)
DOT_R = px(0.083)

# 3a. 光晕层（模糊后叠加）
glow_mask = Image.new('L', (S, S), 0)
gd = ImageDraw.Draw(glow_mask)
gd.line([(px(x), px(y)) for x, y in CHECK], fill=255, width=int(STROKE), joint='curve')
for x, y in (CHECK[0], CHECK[-1]):
    gd.ellipse([px(x) - STROKE / 2, px(y) - STROKE / 2,
                px(x) + STROKE / 2, px(y) + STROKE / 2], fill=255)
gd.ellipse([px(DOT_C[0]) - DOT_R, px(DOT_C[1]) - DOT_R,
            px(DOT_C[0]) + DOT_R, px(DOT_C[1]) + DOT_R], fill=255)

glow = glow_mask.filter(ImageFilter.GaussianBlur(px(0.055)))
glow = glow.point(lambda v: min(255, int(v * 1.35)))
base = ImageChops.add(
    base,
    Image.composite(Image.new('RGB', (S, S), (0, 150, 84)),
                    Image.new('RGB', (S, S), (0, 0, 0)), glow),
)
glow2 = glow_mask.filter(ImageFilter.GaussianBlur(px(0.018)))
base = ImageChops.add(
    base,
    Image.composite(Image.new('RGB', (S, S), (10, 90, 60)),
                    Image.new('RGB', (S, S), (0, 0, 0)), glow2),
)

# 叠加层全部完成后，再转 RGBA 并套上圆角遮罩
base = base.convert('RGBA')
base.putalpha(mask)

# 3b. 清晰图形层
neon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
nd = ImageDraw.Draw(neon)
nd.line([(px(x), px(y)) for x, y in CHECK], fill=GREEN + (255,),
        width=int(STROKE), joint='curve')
for x, y in (CHECK[0], CHECK[-1]):
    nd.ellipse([px(x) - STROKE / 2, px(y) - STROKE / 2,
                px(x) + STROKE / 2, px(y) + STROKE / 2], fill=GREEN + (255,))

# 对勾高光（更亮的上半段）
hi = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hi).line(
    [(px(CHECK[0][0] + 0.02), px(CHECK[0][1] - 0.02)),
     (px(CHECK[1][0]), px(CHECK[1][1] - 0.02))],
    fill=GREEN_BRIGHT + (150,), width=int(STROKE * 0.30), joint='curve')
neon = Image.alpha_composite(neon, hi)

# 黄色任务点 + 内圈亮心
nd.ellipse([px(DOT_C[0]) - DOT_R, px(DOT_C[1]) - DOT_R,
            px(DOT_C[0]) + DOT_R, px(DOT_C[1]) + DOT_R], fill=YELLOW + (255,))
nd.ellipse([px(DOT_C[0]) - DOT_R * 0.42, px(DOT_C[1]) - DOT_R * 0.42,
            px(DOT_C[0]) + DOT_R * 0.42, px(DOT_C[1]) + DOT_R * 0.42],
           fill=(255, 255, 200, 235))

base = Image.alpha_composite(base, neon)

# ---------- 4. 降采样并导出多尺寸 ICO ----------
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [base.resize((s, s), Image.LANCZOS) for s in sizes]

ico_path = os.path.join(OUT_DIR, 'icon.ico')
frames[-1].save(ico_path, format='ICO', sizes=[(s, s) for s in sizes])
frames[-1].save(os.path.join(OUT_DIR, 'icon.png'), format='PNG')

print('icon.ico ->', os.path.abspath(ico_path))
print('sizes    ->', sizes)
print('bytes    ->', os.path.getsize(ico_path))
