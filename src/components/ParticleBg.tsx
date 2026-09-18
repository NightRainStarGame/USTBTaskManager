import { useEffect, useRef } from 'react';

interface ParticleBgProps {
  density?: number;     // 粒子数量
  className?: string;
}

/**
 * Canvas 动态背景：网格 + 粒子 + 鼠标光晕
 * 低开销，自动适配窗口大小
 * v1.1.5：颜色从 CSS 变量读取，跟随主题切换（neon-green / starry）
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
    let particles: Array<{ x: number; y: number; vx: number; vy: number; r: number }> = [];

    /** 从 <html> 的 CSS 变量读出当前主题色三元组，例如 "0 212 255" */
    const readRgb = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--c-primary-rgb').trim();
      // v 形如 "0 255 136"
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

    const initParticles = () => {
      particles = [];
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      for (let i = 0; i < density; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          r: Math.random() * 1.4 + 0.4,
        });
      }
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

    const drawParticles = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const rgb = readRgb();
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        // 距离鼠标越近越亮
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
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.strokeStyle = `rgba(${rgb}, ${0.15 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    };

    const tick = () => {
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

      drawGrid();
      drawMouseGlow();
      drawLinks();
      drawParticles();

      raf = requestAnimationFrame(tick);
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onMouseLeave = () => { mouseRef.current = { x: -1000, y: -1000 }; };

    resize();
    initParticles();
    tick();

    window.addEventListener('resize', () => { resize(); initParticles(); });
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', () => {});
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [density]);

  return <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full pointer-events-auto ${className}`} />;
}