import { useEffect, useState } from 'react';

/** CSS 媒体查询响应式 hook */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

/**
 * 响应式断点约定（与 Tailwind 默认断点对齐，三形态）：
 *  <768px  手机   —— 侧栏折叠为左上角抽屉菜单
 *  768-1023 平板  —— 侧栏常驻但收窄为图标栏
 *  ≥1024  桌面   —— 现有全宽侧栏
 */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
