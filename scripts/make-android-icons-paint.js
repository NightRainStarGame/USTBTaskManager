// 移动端图标绘制代码（由 make-android-icons.cjs 注入渲染进程执行）。
// 几何参数与 scripts/make-icon.py 完全一致：对勾三点 (0.285,0.525)-(0.455,0.690)-(0.735,0.320)，
// 描边 0.115，任务点 (0.775,0.715) r=0.083，底渐变 #0A0F0D→#000，氛围光 rgba(0,74,40)。

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function strokeCheck(ctx, S) {
  var P = [[0.285, 0.525], [0.455, 0.690], [0.735, 0.320]];
  ctx.beginPath();
  ctx.moveTo(P[0][0] * S, P[0][1] * S);
  ctx.lineTo(P[1][0] * S, P[1][1] * S);
  ctx.lineTo(P[2][0] * S, P[2][1] * S);
}
function dotPath(ctx, S, k) {
  var cx = 0.775 * S, cy = 0.715 * S, r = 0.083 * S * k;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
}
function drawAmbient(ctx, S) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(0.5 * S, 0.74 * S);
  ctx.scale(1, 0.65);
  var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.40 * S);
  g.addColorStop(0, 'rgba(0,74,40,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 0.40 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawGlyph(ctx, S, glow) {
  var STROKE = 0.115 * S;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (glow) {
    ctx.save();
    try { ctx.filter = 'blur(' + (0.05 * S) + 'px)'; } catch (e) {}
    ctx.strokeStyle = 'rgba(0,200,115,0.85)';
    ctx.lineWidth = STROKE;
    strokeCheck(ctx, S);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,200,115,0.85)';
    dotPath(ctx, S, 1);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = '#00FF88';
  ctx.lineWidth = STROKE;
  strokeCheck(ctx, S);
  ctx.stroke();
  ctx.save();
  ctx.strokeStyle = 'rgba(0,255,200,0.55)';
  ctx.lineWidth = STROKE * 0.30;
  ctx.beginPath();
  ctx.moveTo((0.285 + 0.02) * S, (0.525 - 0.02) * S);
  ctx.lineTo(0.455 * S, (0.690 - 0.02) * S);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#FFEA00';
  dotPath(ctx, S, 1);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,200,0.92)';
  dotPath(ctx, S, 0.42);
  ctx.fill();
}
// mode: 'square'（圆角方底）| 'round'（圆底）| 'fg'（透明底 + 图形 66%）| 'splash'（纯底 + 居中图形）
function paint(ctx, S, mode) {
  var W = ctx.canvas.width, H = ctx.canvas.height;
  if (mode === 'splash') {
    ctx.fillStyle = '#05070F';
    ctx.fillRect(0, 0, W, H);
    var sc = (Math.min(W, H) * 0.26) / S;
    ctx.save();
    ctx.translate(W / 2 - (S * sc) / 2, H / 2 - (S * sc) / 2);
    ctx.scale(sc, sc);
    drawAmbient(ctx, S);
    drawGlyph(ctx, S, true);
    ctx.restore();
    return;
  }
  if (mode === 'fg') {
    ctx.save();
    ctx.translate(0.17 * S, 0.17 * S);
    ctx.scale(0.66, 0.66);
    drawGlyph(ctx, S, true);
    ctx.restore();
    return;
  }
  ctx.save();
  if (mode === 'square') {
    roundRectPath(ctx, 0.045 * S, 0.045 * S, S - 0.09 * S, S - 0.09 * S, 0.235 * S);
  } else {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  }
  ctx.clip();
  var g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#0A0F0D');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  drawAmbient(ctx, S);
  drawGlyph(ctx, S, true);
  ctx.restore();
}
window.__paint = paint;
