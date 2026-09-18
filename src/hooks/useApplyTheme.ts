import { useEffect } from 'react';
import { useStore } from '@/store';

/** v1.1.5 主题应用钩子：监听 settings.theme 变化，把 data-theme 写到 <html> 上 */
export function useApplyTheme() {
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => {
    const valid = theme === 'starry' || theme === 'neon-green' ? theme : 'neon-green';
    document.documentElement.dataset.theme = valid;
  }, [theme]);
}
