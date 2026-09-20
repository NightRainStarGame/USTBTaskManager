import { useEffect, useRef } from 'react';

interface ParticleBgProps {
  density?: number;     // 粒子数量
  className?: string;
}

interface CircleParticle {
  x: number; y: number; vx: number; vy: number; r: number;
}

interface HeartParticle {
  x: number; y: number;            // 位置
  vy: number;                      // 上升速度（负值，向上飘）
  swayAmp: number;                 // 左右摇摆幅度
  swayPhase: number;               // 摇摆相位
  swaySpeed: number;               // 摇摆速度
  size: number;                    // 心形尺寸（px 级）
  alpha: number;                   // 基础透明度
  tone: number;                    // 0~1 粉色深浅
}

/**
 * Canvas 动态背景：网格 + 粒子 + 鼠标光晕
 * 低开销，自动适配窗口大小
 * v1.1.5：颜色从 CSS 变量读取，跟随主题切换（neon-green / starry）
 * v1.1.7：
 *  - sakura 主题切换为**爱心粒子**（上浮 + 左右摇摆，粉色系，替代几何圆点/连线/网格）
 *  - 全主题限帧 30fps（降低 GPU 占用，缓解低 GPU 机器上的输入卡顿）
 */
export default function ParticleBg({ density = 60, className = '' }: ParticleBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let circles: CircleParticle[] = [];
    let hearts: HeartParticle[] = [];
    let isSakura = document.documentElement.dataset.theme === 'sakura';

    /** 从 <html> 的 CSS 变量读出当前主题色三元组，例如 "0 212 255" */
    const readRgb = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--c-primary-rgb').trim();
      return v || '0 255 136';
    };
    const readBgDeep = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--c-bg-deep').trim() || '#000000';
    const readBgPanel = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--c-bg-deep').trim() || '#0A0F0D';

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const initCircles = () => {
      circles = [];
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      for (let i = 0; i < density; i++) {
        circles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          r: Math.random() * 1.4 + 0.4,
        });
      }
    };

    const initHearts = () => {
      hearts = [];
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const n = Math.max(18, Math.round(density * 0.5)); // 爱心更大更醒目，数量减半
      for (let i = 0; i < n; i++) {
        hearts.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vy: -(0.15 + Math.random() * 0.4),
          swayAmp: 8 + Math.random() * 22,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: 0.004 + Math.random() * 0.01,
          size: 5 + Math.random() * 9,
          alpha: 0.25 + Math.random() * 0.45,
          tone: Math.random(),
        });
      }
    };

    const initParticles = () => { isSakura ? initHearts() : initCircles(); };

    /** 主题切换（data-theme 变化）时重置粒子形态 */
    const themeObserver = new MutationObserver(() => {
      const nowSakura = document.documentElement.dataset.theme === 'sakura';
      if (nowSakura !== isSakura) {
        isSakura = nowSakura;
        initParticles();
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /** 画一颗心（贝塞尔心形，中心在 (0,0)，尺寸≈size） */
    const drawHeart = (x: number, y: number, size: number, fill: string) => {
      const s = size / 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, -3.2);
      ctx.bezierCurveTo(-1.2, -6.4, -5.6, -7.2, -7.6, -4.4);
      ctx.bezierCurveTo(-9.6, -1.6, -5.6, 2.4, 0, 6.8);
      ctx.bezierCurveTo(5.6, 2.4, 9.6, -1.6, 7.6, -4.4);
      ctx.bezierCurveTo(5.6, -7.2, 1.2, -6.4, 0, -3.2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    };

    const drawGrid = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const rgb = readRgb();
      ctx.strokeStyle = `rgba(${rgb}, 0.06)`;
      ctx.lineWidth = 1;
      const step = 40;
      ctx.beginPath();
      for (let x = 0; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    };

    const drawMouseGlow = () => {
      const m = mouseRef.current;
      if (m.x < 0) return;
      const rgb = readRgb();
      const grad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 220);
      grad.addColorStop(0, `rgba(${rgb}, 0.18)`);
      grad.addColorStop(0.5, `rgba(${rgb}, 0.05)`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    };

    const drawCircles = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const rgb = readRgb();
      circles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        const dx = p.x - mouseRef.current.x;
        const dy = p.y - mouseRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const intensity = Math.max(0, 1 - dist / 200);

        ctx.fillStyle = `rgba(${rgb}, ${0.3 + intensity * 0.7})`;
        ctx.shadowBlur = intensity * 8;
        ctx.shadowColor = `rgb(${rgb})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + intensity * 1.2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    };

    const drawLinks = () => {
      const rgb = readRgb();
      for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
          const dx = circles[i].x - circles[j].x;
          const dy = circles[i].y - circles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.strokeStyle = `rgba(${rgb}, ${0.15 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(circles[i].x, circles[i].y);
            ctx.lineTo(circles[j].x, circles[j].y);
            ctx.stroke();
          }
        }
      }
    };

    const drawHearts = (t: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const rgb = readRgb();
      hearts.forEach(p => {
        p.y += p.vy;
        p.swayPhase += p.swaySpeed * 16;
        const sway = Math.sin(p.swayPhase) * p.swayAmp * 0.05;
        if (p.y < -20) {
          p.y = h + 20;
          p.x = Math.random() * w;
        }
        if (p.x < -30 || p.x > w + 30) p.x = Math.random() * w;
        // 粉色深浅：tone 0 → 主色，1 → 亮粉；随呼吸微调透明度
        const breath = 0.85 + 0.15 * Math.sin(t * 0.001 + p.swayPhase);
        const [r, g, b] = rgb.split(' ').map(Number);
        const rr = Math.round(r + (247 - r) * p.tone);
        const gg = Math.round(g + (143 - g) * p.tone);
        const bb = Math.round(b + (188 - b) * p.tone);
        drawHeart(p.x + sway, p.y, p.size + Math.sin(t * 0.0012 + p.swayPhase) * 1.2, `rgba(${rr}, ${gg}, ${bb}, ${(p.alpha * breath).toFixed(3)})`);
      });
    };

    let lastFrame = 0;
    const FRAME_MIN_MS = 1000 / 30; // 限帧 30fps
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - lastFrame < FRAME_MIN_MS) return;
      lastFrame = t;

      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      // 主题背景渐变
      const bgGrad = ctx.createRadialGradient(
        canvas.clientWidth / 2, canvas.clientHeight / 2, 0,
        canvas.clientWidth / 2, canvas.clientHeight / 2, Math.max(canvas.clientWidth, canvas.clientHeight) / 1.2
      );
      bgGrad.addColorStop(0, readBgPanel());
      bgGrad.addColorStop(1, readBgDeep());
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      if (isSakura) {
        // 樱花主题：柔粉光晕 + 爱心上浮（无网格/连线，去掉科技感）
        drawMouseGlow();
        drawHearts(t);
      } else {
        drawGrid();
        drawMouseGlow();
        drawLinks();
        drawCircles();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onMouseLeave = () => { mouseRef.current = { x: -1000, y: -1000 }; };

    resize();
    initParticles();
    raf = requestAnimationFrame(tick);

    const onResize = () => { resize(); initParticles(); };
    window.addEventListener('resize', onResize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [density]);

  return <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full pointer-events-auto ${className}`} />;
}
