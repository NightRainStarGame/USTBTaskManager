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
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});