import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // 注意：本机沙箱会拦截批量删除（emptyOutDir 清理 dist 会被拒绝），
    // 因此关闭 emptyOutDir，并改用「固定文件名」策略：
    // 每次构建原地覆盖同名产物，永不产生带哈希的残留文件，也就不需要删除。
    outDir: 'dist',
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        // v1.2.11 血泪提示：**不要在这里加 manualChunks，也不要让产物出现运行时 import()**。
        // 打包版由 Electron loadFile() 加载 app.asar 内的 index.html（file:// 协议），
        // Chromium 在 file:// 下不会放行页面发起的动态 import —— v1.2.10 就是这样让
        // 9 个懒加载页面全部崩掉的（详见 src/App.tsx 顶部注释）。
        // 保持「单入口 → 单 bundle」，index.html 只有一个 main.js/main.css。
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});