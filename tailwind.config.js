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
          // 黄色（更新提示用，不随主题切换）
          yellow: '#FFEA00',
          'yellow-bright': '#FFFF66',
          'yellow-dim': '#CCBA00',
          // 语义色（危险/逾期，不随主题切换）
          danger: '#FF3366',
        },
        // 背景层级（深色结构色，不随主题切换）
        ink: {
          base: '#000000',
          900: '#0A0F0D',
          800: '#101815',
          700: '#1A2420',
          600: '#243029',
          500: '#2F3D36',
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
      },
      keyframes: {
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
