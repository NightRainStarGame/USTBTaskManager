import { contextBridge, ipcRenderer } from 'electron';

// 渲染进程可调用的 API
const api = {
  // 窗口
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
  },
  // 数据库（统一封装）
  db: {
    courses: {
      list: () => ipcRenderer.invoke('db:courses:list'),
      get: (id: number) => ipcRenderer.invoke('db:courses:get', id),
      create: (data: any) => ipcRenderer.invoke('db:courses:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:courses:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:courses:delete', id),
    },
    requirements: {
      list: (filter?: any) => ipcRenderer.invoke('db:requirements:list', filter),
      create: (data: any) => ipcRenderer.invoke('db:requirements:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:requirements:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:requirements:delete', id),
    },
    events: {
      list: (filter?: any) => ipcRenderer.invoke('db:events:list', filter),
      create: (data: any) => ipcRenderer.invoke('db:events:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:events:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:events:delete', id),
    },
    categories: {
      list: () => ipcRenderer.invoke('db:categories:list'),
      create: (data: any) => ipcRenderer.invoke('db:categories:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:categories:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:categories:delete', id),
    },
    userProfiles: {
      list: () => ipcRenderer.invoke('db:userProfiles:list'),
      getActive: () => ipcRenderer.invoke('db:userProfiles:getActive'),
      getByOpenid: (openid: string) => ipcRenderer.invoke('db:userProfiles:getByOpenid', openid),
      create: (data: any) => ipcRenderer.invoke('db:userProfiles:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:userProfiles:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:userProfiles:delete', id),
      setActive: (id: number) => ipcRenderer.invoke('db:userProfiles:setActive', id),
    },
    courseNotes: {
      list: (courseId: number) => ipcRenderer.invoke('db:courseNotes:list', courseId),
      create: (data: any) => ipcRenderer.invoke('db:courseNotes:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:courseNotes:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:courseNotes:delete', id),
    },
    miniPrograms: {
      list: () => ipcRenderer.invoke('db:miniPrograms:list'),
      getByCourse: (courseId: number) => ipcRenderer.invoke('db:miniPrograms:getByCourse', courseId),
      getActive: () => ipcRenderer.invoke('db:miniPrograms:getActive'),
      createOrUpdate: (data: any) => ipcRenderer.invoke('db:miniPrograms:createOrUpdate', data),
      setActive: (id: number) => ipcRenderer.invoke('db:miniPrograms:setActive', id),
      delete: (id: number) => ipcRenderer.invoke('db:miniPrograms:delete', id),
    },
    projects: {
      list: () => ipcRenderer.invoke('db:projects:list'),
      get: (id: number) => ipcRenderer.invoke('db:projects:get', id),
      create: (data: any) => ipcRenderer.invoke('db:projects:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:projects:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:projects:delete', id),
    },
    tasks: {
      list: (filter?: any) => ipcRenderer.invoke('db:tasks:list', filter),
      create: (data: any) => ipcRenderer.invoke('db:tasks:create', data),
      update: (id: number, data: any) => ipcRenderer.invoke('db:tasks:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('db:tasks:delete', id),
    },
    settings: {
      getAll: () => ipcRenderer.invoke('db:settings:getAll'),
      set: (key: string, value: string) => ipcRenderer.invoke('db:settings:set', key, value),
    },
    stats: {
      dashboard: () => ipcRenderer.invoke('db:stats:dashboard'),
    },
  },
  // 微信小程序（预留接口）
  miniprogram: {
    open: (appId: string) => ipcRenderer.invoke('miniprogram:open', appId),
    isReady: () => ipcRenderer.invoke('miniprogram:isReady') as Promise<boolean>,
    config: {
      get: () => ipcRenderer.invoke('miniprogram:config:get'),
      set: (cfg: any) => ipcRenderer.invoke('miniprogram:config:set', cfg),
    },
  },
  // 贝壳课表（USTB SSO 扫码登录 + BYYT 教务课表导入）
  ustb: {
    status: () => ipcRenderer.invoke('ustb:status'),
    qrStart: () => ipcRenderer.invoke('ustb:qr:start') as Promise<{ sessionId: string; qrImage: string }>,
    qrPoll: (sessionId: string) => ipcRenderer.invoke('ustb:qr:poll', sessionId) as Promise<{ status: string; user?: { name: string; school: string; userId: string }; message?: string }>,
    qrCancel: (sessionId: string) => ipcRenderer.invoke('ustb:qr:cancel', sessionId),
    preview: (term: { xn: string; xq: string }) => ipcRenderer.invoke('ustb:preview', term),
    import: (opts: { xn: string; xq: string; semesterStart: number }) => ipcRenderer.invoke('ustb:import', opts) as Promise<{ courses: number; events: number; items: number; warnings: string[] }>,
    logout: () => ipcRenderer.invoke('ustb:logout'),
  },
  // ICS 导出
  ics: {
    export: (events: any[]) => ipcRenderer.invoke('ics:export', events) as Promise<{ ok: boolean; path?: string; count?: number; canceled?: boolean }>,
  },
  // 应用信息（版本号等）
  app: {
    info: () => ipcRenderer.invoke('app:info') as Promise<{
      name: string;
      version: string;
      electron: string;
      platform: string;
      packaged: boolean;
    }>,
  },
  // 软件更新
  updater: {
    config: () => ipcRenderer.invoke('update:config') as Promise<{
      defaultSources: Array<{ name: string; url: string; enabled: boolean; primary: boolean }>;
      sources: Array<{ name: string; url: string; enabled: boolean; primary: boolean }>;
      activeIndex: number;
      /** 兼容旧字段：当前主源 URL */
      source: string;
      defaultSource: string;
      autoCheck: boolean;
      skippedVersion: string | null;
      lastCheckAt: number;
    }>,
    check: (opts?: { force?: boolean; sourceIndex?: number }) => ipcRenderer.invoke('update:check', opts),
    /** 查所有启用的源，返回合并结果（每源独立结果 + 版本最高的 winner） */
    checkAll: () => ipcRenderer.invoke('update:checkAll') as Promise<{
      currentVersion: string;
      ok: boolean;
      anyConfigured: boolean;
      winner: {
        ok: boolean;
        configured: boolean;
        currentVersion: string;
        latestVersion: string | null;
        hasUpdate: boolean;
        notes?: string | null;
        downloadUrl?: string | null;
        pageUrl?: string | null;
        sha256?: string | null;
        forced?: boolean;
        skipped?: boolean;
        source?: string;
        sourceIndex?: number;
        sourceName?: string;
        checkedAt?: number;
      } | null;
      perSource: Array<{
        source: { name: string; url: string; enabled: boolean; primary: boolean };
        result: {
          ok: boolean;
          configured: boolean;
          currentVersion: string;
          latestVersion: string | null;
          hasUpdate: boolean;
          notes?: string | null;
          downloadUrl?: string | null;
          pageUrl?: string | null;
          sha256?: string | null;
          forced?: boolean;
          skipped?: boolean;
          source?: string;
          sourceIndex?: number;
          sourceName?: string;
          reason?: string;
          message?: string;
          checkedAt?: number;
        };
      }>;
      checkedAt: number;
    }>,
    download: (opts: { url: string; version: string; sha256?: string | null }) =>
      ipcRenderer.invoke('update:download', opts) as Promise<{ ok: boolean; path?: string; size?: number; error?: string; canceled?: boolean }>,
    cancel: () => ipcRenderer.invoke('update:cancel'),
    install: (filePath: string) => ipcRenderer.invoke('update:install', filePath) as Promise<{ ok: boolean; error?: string }>,
    openExternal: (url: string) => ipcRenderer.invoke('update:openExternal', url) as Promise<{ ok: boolean; error?: string }>,
    skipVersion: (version: string) => ipcRenderer.invoke('update:skipVersion', version),
    /** 兼容旧 API：用单源替换（保留旧行为） */
    setSource: (source: string) => ipcRenderer.invoke('update:setSource', source) as Promise<{ ok: boolean; source: string; sources: Array<{ name: string; url: string; enabled: boolean; primary: boolean }> }>,
    /** 新 API：整体保存多源 + 切换主源 */
    setSources: (payload: {
      sources: Array<{ name: string; url: string; enabled: boolean; primary: boolean }>;
      activeIndex: number;
    }) => ipcRenderer.invoke('update:setSources', payload) as Promise<{ ok: boolean; sources: Array<{ name: string; url: string; enabled: boolean; primary: boolean }>; activeIndex: number }>,
    /** 仅切换激活的主源（不动其他配置） */
    setActiveSource: (index: number) => ipcRenderer.invoke('update:setActiveSource', index) as Promise<{ ok: boolean; activeIndex: number; sources: Array<{ name: string; url: string; enabled: boolean; primary: boolean }> }>,
    setAutoCheck: (enabled: boolean) => ipcRenderer.invoke('update:setAutoCheck', enabled) as Promise<{ ok: boolean; enabled: boolean }>,
    /** 订阅下载进度，返回取消订阅函数 */
    onProgress: (cb: (p: any) => void) => {
      const handler = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('update:progress', handler);
      return () => { ipcRenderer.off('update:progress', handler); };
    },
    /** 订阅「启动时发现新版本」推送，返回取消订阅函数 */
    onAvailable: (cb: (r: any) => void) => {
      const handler = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('update:available', handler);
      return () => { ipcRenderer.off('update:available', handler); };
    },
  },
  // 作业发布 / 同步（GitHub homework/ 文件夹）
  homework: {
    config: () => ipcRenderer.invoke('homework:config') as Promise<{
      repo: string; branch: string; dir: string; repoUrl: string;
      tokenSet: boolean; publisher: string; lastSync: number | null;
    }>,
    /** 保存 GitHub 发布令牌 + 发布人昵称（只存本机） */
    saveAuth: (token: string, publisher: string) => ipcRenderer.invoke('homework:saveAuth', token, publisher) as Promise<{ ok: boolean; error?: string; tokenSet?: boolean }>,
    /** 发布密码验证 */
    verifyPassword: (password: string) => ipcRenderer.invoke('homework:verifyPassword', password) as Promise<{ ok: boolean }>,
    /** 发布一条作业（写 GitHub） */
    publish: (payload: {
      password: string; courseName: string; sessionDate: string;
      sessionTime?: string | null; title: string; content: string;
      type?: string; dueDate?: number | null;
    }) => ipcRenderer.invoke('homework:publish', payload) as Promise<{
      ok: boolean; error?: string;
      entry?: { id: string; title: string; sessionDate: string; publisher: string; updatedAt: number };
      fileUrl?: string;
    }>,
    /** 某门课在远端已发布的作业 */
    remoteEntries: (courseName: string) => ipcRenderer.invoke('homework:remoteEntries', courseName) as Promise<{
      ok: boolean; error?: string;
      entries: Array<{ id: string; title: string; sessionDate: string; sessionTime?: string | null; content: string; publisher: string; publishedAt: number; updatedAt: number }>;
    }>,
    /** 从 GitHub 同步全部作业到本地课程 */
    sync: () => ipcRenderer.invoke('homework:sync') as Promise<{
      ok: boolean; error?: string; files: number; entries: number; created: number; updated: number;
      coursesTouched: number; coursesCreated: string[];
      items: Array<{ courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
      syncedAt: number;
    }>,
  },
  // 全量备份 / 恢复 / 完整性检查
  backup: {
    export: () => ipcRenderer.invoke('backup:export') as Promise<{ ok: boolean; path?: string; counts?: Record<string, number>; canceled?: boolean }>,
    import: (opts?: { skipSafetyBackup?: boolean }) => ipcRenderer.invoke('backup:import', opts) as Promise<{
      ok: boolean;
      canceled?: boolean;
      error?: string;
      restored?: Record<string, number>;
      safetyBackupPath?: string;
      source?: string;
    }>,
    status: () => ipcRenderer.invoke('backup:status') as Promise<{
      integrity: string;
      foreignKeyViolations: number;
      journalMode: string;
      tables: Record<string, number>;
      dbSizeBytes: number;
      lastAutoBackup: string | null;
    }>,
    makeSafety: () => ipcRenderer.invoke('backup:makeSafety') as Promise<{ ok: boolean; path: string }>,
  },
  // 课表 Excel 导入
  xls: {
    pickFile: () => ipcRenderer.invoke('xls:pickFile') as Promise<string | null>,
    parseFile: (filePath: string) => ipcRenderer.invoke('xls:parseFile', filePath) as Promise<{
      sheetName: string;
      headers: string[];
      rows: Record<string, string>[];
      totalRows: number;
      mapping: { className: number; teacher: number; weeks: number; day: number; period: number; location: number };
      preview: Array<{ day: number; period: number; className: string; teacher: string; weeksText: string; weeks: number[]; location: string; periodName: string }>;
      items: Array<{ day: number; period: number; className: string; teacher: string; weeksText: string; weeks: number[]; location: string; periodName: string }>;
      warnings: string[];
      badRows: { row: number; reason: string }[];
    }>,
    reparse: (parsed: any, mapping: { className: number; teacher: number; weeks: number; day: number; period: number; location: number }) =>
      ipcRenderer.invoke('xls:reparse', parsed, mapping),
    importItems: (items: any[], opts: { xn: string; xq: '1' | '2'; semesterStart: number; replaceExisting: boolean }) =>
      ipcRenderer.invoke('xls:importItems', items, opts) as Promise<{
        courses: number; events: number; items: number; courseIds: number[]; warnings: string[];
      }>,
    lastImport: () => ipcRenderer.invoke('xls:lastImport') as Promise<{ lastSync: number; courseCount: number }>,
  },
};

contextBridge.exposeInMainWorld('taskAPI', api);

export type TaskAPI = typeof api;