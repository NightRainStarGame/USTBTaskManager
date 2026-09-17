/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 霓虹绿系（主品牌色）
        neon: {
          green: '#00FF88',
          'green-bright': '#00FFC8',
          'green-dim': '#00B86B',
          'green-deep': '#008F4D',
          yellow: '#FFEA00',
          'yellow-bright': '#FFFF66',
          'yellow-dim': '#CCBA00',
          danger: '#FF3366',
        },
        // 背景层级
        ink: {
          base: '#000000',
          900: '#0A0F0D',
          800: '#101815',
          700: '#1A2420',
          600: '#243029',
          500: '#2F3D36',
        },
        // 文本
        text: {
          primary: '#E8FFEE',
          secondary: '#8FA89B',
          dim: '#4A5C52',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'neon-green': '0 0 8px rgba(0,255,136,0.6), 0 0 24px rgba(0,255,136,0.25)',
        'neon-green-strong': '0 0 12px rgba(0,255,136,0.9), 0 0 32px rgba(0,255,136,0.5)',
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
        'grid-neon': "linear-gradient(rgba(0,255,136,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};