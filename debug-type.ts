import type { TaskAPI } from '../electron/preload';
const x: TaskAPI = null as any;
// @ts-ignore
type Db = TaskAPI['db'];
type DbKeys = keyof Db;
const k: DbKeys = 'courses' as const;
// @ts-ignore
const k2: DbKeys = 'categories' as const;
console.log(k, k2);
