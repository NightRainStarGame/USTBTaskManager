import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** 全局快捷键：Cmd/Ctrl+K 搜索，Cmd/Ctrl+N 加号菜单 */
export default function useShortcuts(onPlus: () => void, onSearch: () => void) {
  const loc = useLocation();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = (e.ctrlKey || e.metaKey);
      if (k && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onSearch();
      } else if (k && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onPlus();
      } else if (e.key === 'Escape') {
        // 由各弹层自行处理
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onPlus, onSearch]);
}