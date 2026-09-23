import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * 移动端（Capacitor / Android）构建配置。
 *
 * 与桌面构建的差异：
 * 1. 入口 index-mobile.html → src/mobile/bootstrap.ts（主进程逻辑跑在 webview）
 * 2. alias：electron / better-sqlite3 / node:* → src/mobile/shims/*
 * 3. 产物目录 dist-mobile/（capacitor webDir）
 * 4. define：__TASKMANAGER_VERSION__ 从 package.json 注入
 */
import pkg from './package.json';

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('./src'),
      // —— 移动端替换层（桌面构建不含这些 alias）——
      electron: r('./src/mobile/electron-shim.ts'),
      'better-sqlite3': r('./src/mobile/sqlite3-adapter.ts'),
      'node:fs': r('./src/mobile/shims/fs.ts'),
      fs: r('./src/mobile/shims/fs.ts'),
      'node:path': r('./src/mobile/shims/path.ts'),
      path: r('./src/mobile/shims/path.ts'),
      'node:os': r('./src/mobile/shims/os.ts'),
      os: r('./src/mobile/shims/os.ts'),
      'node:url': r('./src/mobile/shims/url.ts'),
      url: r('./src/mobile/shims/url.ts'),
      'node:crypto': r('./src/mobile/shims/crypto.ts'),
      crypto: r('./src/mobile/shims/crypto.ts'),
      'node:https': r('./src/mobile/shims/https.ts'),
      https: r('./src/mobile/shims/https.ts'),
      'node:http': r('./src/mobile/shims/http.ts'),
      http: r('./src/mobile/shims/http.ts'),
      // 不该被外部化：updater/patchApply 静态 import { spawn }，外部化的空模块会让 Rollup 构建失败
      'node:child_process': r('./src/mobile/shims/child_process.ts'),
      child_process: r('./src/mobile/shims/child_process.ts'),
    },
  },
  define: {
    __TASKMANAGER_VERSION__: JSON.stringify(pkg.version),
  },
  base: './',
  build: {
    outDir: 'dist-mobile',
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        mobile: r('index-mobile.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
    // sql.js wasm 走 ?url 资源；主 chunk 会比较大（含全部主进程逻辑），可接受
    chunkSizeWarningLimit: 1500,
  },
});
