import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置 —— Android 壳。
 * webDir = vite.mobile.config.ts 的产物目录（npm run build:mobile）。
 */
const config: CapacitorConfig = {
  appId: 'com.lasarac.taskmanager',
  appName: 'TaskManager',
  webDir: 'dist-mobile',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
