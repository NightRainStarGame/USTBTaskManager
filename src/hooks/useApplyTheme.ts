import { useEffect } from 'react';
import { useStore } from '@/store';

/** v1.1.5 主题应用钩子：监听 settings.theme 变化，把 data-theme 写到 <html> 上 */
export function useApplyTheme() {
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => {
    // v1.3.0：新默认主题 aurora（极光）；新增玻璃明暗（Windows Fluent/Mica）
    const valid = ['aurora', 'starry', 'neon-green', 'sakura', 'glass-light', 'glass-dark'].includes(theme)
      ? theme
      : 'aurora';
    document.documentElement.dataset.theme = valid;
  }, [theme]);
}
