/**
 * v1.2.8：通用 localStorage hook
 * - 自动 try/catch（QuotaExceededError / 隐私模式）
 * - JSON 序列化 / 反序列化
 * - 与 React state 接口一致：setValue(value | prev => next)
 * - SSR 安全（typeof window 检查）
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type SetLocalStorageValue<T> = (value: T | ((prev: T) => T)) => void;

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: { /** JSON.stringify 是否稳定（如对象） */
    serialize?: (v: T) => string;
    /** 自定义反序列化（默认 JSON.parse） */
    deserialize?: (raw: string) => T;
  }
): [T, SetLocalStorageValue<T>] {
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? ((raw: string) => JSON.parse(raw) as T);

  const readInitial = (): T => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initialValue;
      return deserialize(raw);
    } catch {
      return initialValue;
    }
  };

  const [value, setValue] = useState<T>(readInitial);
  const valueRef = useRef(value);
  valueRef.current = value;

  const set = useCallback<SetLocalStorageValue<T>>((next) => {
    const resolved = next instanceof Function ? next(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
    try {
      window.localStorage.setItem(key, serialize(resolved));
    } catch {
      // QuotaExceededError / 隐私模式禁用：忽略，业务可继续工作
    }
  }, [key, serialize]);

  // 跨标签页同步（同源 storage 事件）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.storageArea !== window.localStorage) return;
      if (e.newValue == null) return;
      try {
        const next = deserialize(e.newValue);
        valueRef.current = next;
        setValue(next);
      } catch { /* 跨标签页数据损坏，忽略 */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, deserialize]);

  return [value, set];
}