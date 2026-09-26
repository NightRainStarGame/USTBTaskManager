/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 霓虹主题色（v1.1.5：跟随 [data-theme] CSS 变量切换）
        // 用 rgb(var(--c-primary-rgb) / <alpha-value>) 模式保留 bg-neon-green/40 等透明度修饰符
        neon: {
          green: 'rgb(var(--c-primary-rgb) / <alpha-value>)',
          'green-bright': 'rgb(var(--c-primary-bright-rgb) / <alpha-value>)',
          'green-dim': 'rgb(var(--c-primary-dim-rgb) / <alpha-value>)',
          'green-deep': 'rgb(var(--c-primary-deep-rgb) / <alpha-value>)',
          // 黄色（更新提示用；v1.1.6 改为变量驱动——sakura 浅底上纯黄不可读，换成琥珀）
          yellow: 'rgb(var(--c-warn-rgb) / <alpha-value>)',
          'yellow-bright': 'rgb(var(--c-warn-bright-rgb) / <alpha-value>)',
          'yellow-dim': 'rgb(var(--c-warn-dim-rgb) / <alpha-value>)',
          // 语义色（危险/逾期，不随主题切换）
          danger: '#FF3366',
        },
        // 背景层级（v1.1.6 改为变量驱动：深色主题给墨色系，sakura 给粉白系）
        ink: {
          base: 'rgb(var(--c-ink-base-rgb) / <alpha-value>)',
          900: 'rgb(var(--c-ink-900-rgb) / <alpha-value>)',
          800: 'rgb(var(--c-ink-800-rgb) / <alpha-value>)',
          700: 'rgb(var(--c-ink-700-rgb) / <alpha-value>)',
          600: 'rgb(var(--c-ink-600-rgb) / <alpha-value>)',
          500: 'rgb(var(--c-ink-500-rgb) / <alpha-value>)',
        },
        // 文本（v1.1.5：跟随主题切换）
        text: {
          primary: 'var(--c-text)',
          secondary: 'var(--c-text-secondary)',
          dim: 'var(--c-text-dim)',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // v1.1.5：跟随主题的霓虹光晕（neon-green 在 starry 主题下自动变青蓝）
        'neon-green': '0 0 8px rgb(var(--c-primary-rgb) / 0.6), 0 0 24px rgb(var(--c-primary-rgb) / 0.25)',
        'neon-green-strong': '0 0 12px rgb(var(--c-primary-rgb) / 0.9), 0 0 32px rgb(var(--c-primary-rgb) / 0.5)',
        // 黄色光晕（固定）
        'neon-yellow': '0 0 8px rgba(255,234,0,0.7), 0 0 20px rgba(255,234,0,0.3)',
        'glass': 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.6)',
      },
      animation: {
        'scan-line': 'scanLine 6s linear infinite',
        'pulse-glow': 'pulseGlow 2.4s ease-in-out infinite',
        'flicker': 'flicker 4s linear infinite',
        'data-flow': 'dataFlow 8s linear infinite',
        // v1.2.10：统一动效时长/曲线令牌 —— 以前各处手写 cubic-bezier，动画风格不统一
        'page-in': 'pageIn 260ms var(--ease-expo-out) both',
        'panel-in': 'panelIn 240ms var(--ease-expo-out) both',
        'fade-in': 'fadeIn 200ms var(--ease-expo-out) both',
      },
      // v1.2.10：缓动令牌（ease-expo-out = OKX 官网那种"快起慢收"的手感）
      transitionTimingFunction: {
        'expo-out': 'var(--ease-expo-out)',
        'spring-out': 'var(--ease-spring)',
      },
      keyframes: {
        // v1.2.10：页面切换（轻微上移 + 淡入，走合成层不触发 layout）
        pageIn: {
          '0%': { opacity: '0', transform: 'translate3d(0, 8px, 0)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        panelIn: {
          '0%': { opacity: '0', transform: 'translate3d(0, 6px, 0) scale(0.985)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0) scale(1)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scanLine: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        flicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': { opacity: '1' },
          '20%, 22%, 24%, 55%': { opacity: '0.85' },
        },
        dataFlow: {
          '0%': { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '0% 200%' },
        },
      },
      backgroundImage: {
        // v1.1.5：网格背景色跟随主题
        'grid-neon': "linear-gradient(rgb(var(--c-primary-rgb) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-primary-rgb) / 0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};
