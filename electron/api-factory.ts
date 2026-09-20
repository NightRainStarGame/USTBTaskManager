/**
 * taskAPI 工厂 —— 桌面 preload 与移动端 shim 共用的 API 定义。
 *
 * 本文件不得 import 'electron' 或任何 Node 内置模块：
 * - 桌面：electron/preload.ts 用 contextBridge + ipcRenderer 注入
 * - 移动：src/mobile/bootstrap.ts 用同进程的 ipcMain handler 表直调
 */

/** 更新源（v1.1.4：type='anyshare' 为北科云盘外链源，password 是提取码） */
export type UpdateSourceDTO = {
  name: string;
  url: string;
  enabled: boolean;
  primary: boolean;
  type?: 'anyshare' | 'http';
  password?: string;
};

export type Invoke = (channel: string, ...args: any[]) => Promise<any>;
export type Send = (channel: string, ...args: any[]) => void;
/** 订阅主进程 → 渲染层事件；返回取消订阅函数 */
export type Subscribe = (channel: string, cb: (payload: any) => void) => () => void;

export function buildAPI(invoke: Invoke, send: Send, subscribe?: Subscribe) {
  const api = {
    // 窗口
    window: {
      minimize: () => invoke('window:minimize'),
      maximize: () => invoke('window:maximize'),
      close: () => invoke('window:close'),
      isMaximized: () => invoke('window:isMaximized') as Promise<boolean>,
    },
    // 数据库（统一封装）
    db: {
      courses: {
        list: () => invoke('db:courses:list'),
        get: (id: number) => invoke('db:courses:get', id),
        create: (data: any) => invoke('db:courses:create', data),
        update: (id: number, data: any) => invoke('db:courses:update', id, data),
        delete: (id: number) => invoke('db:courses:delete', id),
      },
      requirements: {
        list: (filter?: any) => invoke('db:requirements:list', filter),
        create: (data: any) => invoke('db:requirements:create', data),
        update: (id: number, data: any) => invoke('db:requirements:update', id, data),
        delete: (id: number) => invoke('db:requirements:delete', id),
      },
      events: {
        list: (filter?: any) => invoke('db:events:list', filter),
        create: (data: any) => invoke('db:events:create', data),
        update: (id: number, data: any) => invoke('db:events:update', id, data),
        delete: (id: number) => invoke('db:events:delete', id),
      },
      categories: {
        list: () => invoke('db:categories:list'),
        create: (data: any) => invoke('db:categories:create', data),
        update: (id: number, data: any) => invoke('db:categories:update', id, data),
        delete: (id: number) => invoke('db:categories:delete', id),
      },
      userProfiles: {
        list: () => invoke('db:userProfiles:list'),
        getActive: () => invoke('db:userProfiles:getActive'),
        getByOpenid: (openid: string) => invoke('db:userProfiles:getByOpenid', openid),
        create: (data: any) => invoke('db:userProfiles:create', data),
        update: (id: number, data: any) => invoke('db:userProfiles:update', id, data),
        delete: (id: number) => invoke('db:userProfiles:delete', id),
        setActive: (id: number) => invoke('db:userProfiles:setActive', id),
      },
      courseNotes: {
        list: (courseId: number) => invoke('db:courseNotes:list', courseId),
        create: (data: any) => invoke('db:courseNotes:create', data),
        update: (id: number, data: any) => invoke('db:courseNotes:update', id, data),
        delete: (id: number) => invoke('db:courseNotes:delete', id),
      },
      miniPrograms: {
        list: () => invoke('db:miniPrograms:list'),
        getByCourse: (courseId: number) => invoke('db:miniPrograms:getByCourse', courseId),
        getActive: () => invoke('db:miniPrograms:getActive'),
        createOrUpdate: (data: any) => invoke('db:miniPrograms:createOrUpdate', data),
        setActive: (id: number) => invoke('db:miniPrograms:setActive', id),
        delete: (id: number) => invoke('db:miniPrograms:delete', id),
      },
      projects: {
        list: () => invoke('db:projects:list'),
        get: (id: number) => invoke('db:projects:get', id),
        create: (data: any) => invoke('db:projects:create', data),
        update: (id: number, data: any) => invoke('db:projects:update', id, data),
        delete: (id: number) => invoke('db:projects:delete', id),
      },
      tasks: {
        list: (filter?: any) => invoke('db:tasks:list', filter),
        create: (data: any) => invoke('db:tasks:create', data),
        update: (id: number, data: any) => invoke('db:tasks:update', id, data),
        delete: (id: number) => invoke('db:tasks:delete', id),
      },
      settings: {
        getAll: () => invoke('db:settings:getAll'),
        set: (key: string, value: string) => invoke('db:settings:set', key, value),
      },
      stats: {
        dashboard: () => invoke('db:stats:dashboard'),
      },
    },
    // 微信小程序（预留接口）
    miniprogram: {
      open: (appId: string) => invoke('miniprogram:open', appId),
      isReady: () => invoke('miniprogram:isReady') as Promise<boolean>,
      config: {
        get: () => invoke('miniprogram:config:get'),
        set: (cfg: any) => invoke('miniprogram:config:set', cfg),
      },
    },
    // 贝壳课表（USTB SSO 扫码登录 + BYYT 教务课表导入）
    ustb: {
      status: () => invoke('ustb:status'),
      qrStart: () => invoke('ustb:qr:start') as Promise<{ sessionId: string; qrImage: string }>,
      qrPoll: (sessionId: string) => invoke('ustb:qr:poll', sessionId) as Promise<{ status: string; user?: { name: string; school: string; userId: string }; message?: string }>,
      qrCancel: (sessionId: string) => invoke('ustb:qr:cancel', sessionId),
      preview: (term: { xn: string; xq: string }) => invoke('ustb:preview', term),
      import: (opts: { xn: string; xq: string; semesterStart: number }) => invoke('ustb:import', opts) as Promise<{ courses: number; events: number; items: number; warnings: string[] }>,
      logout: () => invoke('ustb:logout'),
    },
    // ICS 导出
    ics: {
      export: (events: any[]) => invoke('ics:export', events) as Promise<{ ok: boolean; path?: string; count?: number; canceled?: boolean }>,
    },
    // 应用信息（版本号等）
    app: {
      info: () => invoke('app:info') as Promise<{
        name: string;
        version: string;
        electron: string;
        platform: string;
        packaged: boolean;
      }>,
      /** v1.1.5：渲染层完成 React mount + store.refreshAll() 后调用，通知主进程关 splash */
      ready: () => send('app:ready-to-show'),
    },
    // 软件更新
    updater: {
      config: () => invoke('update:config') as Promise<{
        defaultSources: UpdateSourceDTO[];
        sources: UpdateSourceDTO[];
        activeIndex: number;
        /** 兼容旧字段：当前主源 URL */
        source: string;
        defaultSource: string;
        autoCheck: boolean;
        skippedVersion: string | null;
        lastCheckAt: number;
      }>,
      check: (opts?: { force?: boolean; sourceIndex?: number }) => invoke('update:check', opts),
      /** 查所有启用的源，返回合并结果（每源独立结果 + 版本最高的 winner） */
      checkAll: () => invoke('update:checkAll') as Promise<{
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
          source: UpdateSourceDTO;
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
      /** v1.1.4：北科云盘源的下载需带上源信息（type/url/password），后端据此换签名直链 */
      download: (opts: { url: string; version: string; sha256?: string | null; source?: UpdateSourceDTO | null }) =>
        invoke('update:download', opts) as Promise<{ ok: boolean; path?: string; size?: number; error?: string; canceled?: boolean }>,
      cancel: () => invoke('update:cancel'),
      install: (filePath: string) => invoke('update:install', filePath) as Promise<{ ok: boolean; error?: string }>,
      openExternal: (url: string) => invoke('update:openExternal', url) as Promise<{ ok: boolean; error?: string }>,
      skipVersion: (version: string) => invoke('update:skipVersion', version),
      /** v1.1.6 块 4b：增量补丁相关。renderer 端拿当前 winner + 当前 app.getVersion() 自决 */
      patchPreview: (manifest: any, currentVersion: string) =>
        invoke('update:patch:preview', manifest, currentVersion) as Promise<{
          available: boolean;
          reason?: string;
          patch?: {
            fromVersion: string;
            toVersion: string;
            url: string;
            sha256: string;
            size: number;
            baseAsarSha256: string;
            appAsarSha256: string;
          };
          sizeMB?: number;
          fullSizeMB?: number;
        }>,
      /** v1.1.6 块 4b：下载补丁 + 启动 helper + 退出主进程 */
      patchApply: (patch: any) =>
        invoke('update:patch:apply', patch) as Promise<{
          ok: boolean;
          error?: string;
          helperPid?: number;
          nextVersion?: string;
        }>,
      /** v1.1.6 块 4b：校验上次补丁是否应用成功（启动时调一次） */
      patchState: () => invoke('update:patch:state') as Promise<{
        applied?: boolean; failed?: boolean;
        baseline?: { expected: string; actual: string };
        message?: string;
      }>,
      /** 兼容旧 API：用单源替换（保留旧行为） */
      setSource: (source: string) => invoke('update:setSource', source) as Promise<{ ok: boolean; source: string; sources: UpdateSourceDTO[] }>,
      /** 新 API：整体保存多源 + 切换主源 */
      setSources: (payload: {
        sources: UpdateSourceDTO[];
        activeIndex: number;
      }) => invoke('update:setSources', payload) as Promise<{ ok: boolean; sources: UpdateSourceDTO[]; activeIndex: number }>,
      /** 仅切换激活的主源（不动其他配置） */
      setActiveSource: (index: number) => invoke('update:setActiveSource', index) as Promise<{ ok: boolean; activeIndex: number; sources: UpdateSourceDTO[] }>,
      setAutoCheck: (enabled: boolean) => invoke('update:setAutoCheck', enabled) as Promise<{ ok: boolean; enabled: boolean }>,
      /** 订阅下载进度，返回取消订阅函数 */
      onProgress: (cb: (p: any) => void) => {
        if (subscribe) return subscribe('update:progress', cb);
        return () => { /* 桌面端由 preload 提供 */ };
      },
      /** 订阅「启动时发现新版本」推送，返回取消订阅函数 */
      onAvailable: (cb: (r: any) => void) => {
        if (subscribe) return subscribe('update:available', cb);
        return () => { /* 桌面端由 preload 提供 */ };
      },
    },
    // 作业发布 / 接收（码制协议：作业包 = homework/<syncCode>.json）
    homework: {
      config: () => invoke('homework:config') as Promise<{
        repo: string; branch: string; dir: string; repoUrl: string;
        tokenSet: boolean; publisher: string; lastSync: number | null;
        cloudSourceEnabled: boolean;
        /** v1.1.4：北科云盘作业同步源配置（null = 未配置） */
        cloud: { baseUrl: string; linkId: string; password: string; enabled: boolean } | null;
      }>,
      /** 保存 GitHub 发布令牌 + 发布人昵称（只存本机） */
      saveAuth: (token: string, publisher: string) => invoke('homework:saveAuth', token, publisher) as Promise<{ ok: boolean; error?: string; tokenSet?: boolean }>,
      /** v1.1.4：保存北科云盘作业同步源（外链地址 + 提取码 + 启用开关） */
      saveCloud: (cfg: { url?: string; password?: string; enabled?: boolean }) =>
        invoke('homework:saveCloud', cfg) as Promise<{ ok: boolean; error?: string; cloud?: { baseUrl: string; linkId: string; password: string; enabled: boolean } }>,
      /** 生成一对新码（同步作业码 + 作业发布码） */
      generateCodes: () => invoke('homework:generateCodes') as Promise<{ ok: boolean; syncCode: string; publishCode: string }>,
      /** 校验作业发布码（本地 HMAC，无需联网）；通过则返回解析出的同步码 */
      verifyCodes: (publishCode: string) => invoke('homework:verifyCodes', publishCode) as Promise<{ ok: boolean; syncCode?: string }>,
      /** v1.1.3：取某课程对应的同步作业码（首次自动生成）。用作发布时定位远端 bundle */
      courseSyncCode: (courseId: number | null | undefined) => invoke('homework:courseSyncCode', courseId) as Promise<{ ok: boolean; syncCode: string; error?: string }>,
      /** 发布一条作业。publishCode 可选；如未填 syncCode 但传了 courseId，会用该课程持久化的 syncCode（首次自动生成）。
       *  v1.1.6：targets 可同时推 GitHub + 北科云盘；target 字段保留兼容老调用方 */
      publish: (payload: {
        publishCode?: string; syncCode?: string; courseId?: number | null;
        targets?: ('github' | 'cloud')[];
        /** @deprecated v1.1.6 起改用 targets */
        target?: 'github' | 'cloud';
        courseName: string; sessionDate: string;
        sessionTime?: string | null;
        /** 单条发布时必填；批量（v1.1.8+）可省，由 entries 提供 */
        title?: string; content?: string;
        type?: string; dueDate?: number | null;
        /** v1.1.8+：批量发布条目；存在时 title/content/type/dueDate 被忽略，每条独立 */
        entries?: Array<{ title: string; content: string; type?: string; sessionDate?: string; sessionTime?: string | null; dueDate?: number | null }>;
      }) => invoke('homework:publish', payload) as Promise<{
        ok: boolean; error?: string;
        entry?: { id: string; title: string; sessionDate: string; publisher: string; updatedAt: number };
        syncCode?: string; bundleCreated?: boolean;
        fileUrl?: string;
        entriesCount?: number;
        /** v1.1.8+：本次实际发布的条目数（批量场景下 >1） */
        entriesPublished?: number;
        targets?: ('github' | 'cloud')[];
        perTarget?: Array<{ target: 'github' | 'cloud'; ok: boolean; error?: string; fileUrl?: string; anyshareRaw?: string; entriesCount?: number }>;
      }>,
      /** 某个码包在远端已发布的作业 */
      remoteEntries: (syncCode: string) => invoke('homework:remoteEntries', syncCode) as Promise<{
        ok: boolean; error?: string; courseName?: string;
        entries: Array<{ id: string; title: string; sessionDate: string; sessionTime?: string | null; content: string; publisher: string; publishedAt: number; updatedAt: number }>;
      }>,
      /** 按同步作业码接收一个作业包到本地课程；本地缺课程时返回 courseNotFound=true 让前端弹窗询问；
       *  v1.1.6：同名多门课程时返回 courseCandidates 让前端手选，重试时传 chooseCourseId
       *  v1.1.8：perCourse 按课程分组给出精确挂载计数；items 每项加 courseId */
      receive: (syncCode: string, chooseCourseId?: number | null) => invoke('homework:receive', syncCode, chooseCourseId) as Promise<{
        ok: boolean; error?: string; source?: string; syncCode?: string; courseName?: string;
        courseNotFound?: boolean;
        courseCandidates?: Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
        entries: number; created: number; updated: number;
        coursesTouched: number; coursesCreated: string[];
        perCourse?: Array<{ courseId: number; courseName: string; entries: number; created: number; updated: number }>;
        items: Array<{ courseId: number; courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
        syncedAt: number;
      }>,
    },
    // v1.1.6 输入诊断（块 3）：探测器上报 + Settings 导出
    diag: {
      /** 探测器触发失灵快照时调用，无返回值（fire & forget）。浏览器环境无 IPC 也能调，但等于 noop */
      append: (snapshot: any) => { send('input:diag:append', snapshot); },
      /** 预览：返回最近 5 条失灵快照（用于 Settings 卡片展示） */
      peek: () => invoke('input:diag:peek') as Promise<{
        ok: boolean;
        path: string;
        byteCount: number;
        recent: Array<{ ts: number; iso: string; reason: string; focusedTag: string; stallCount: number; msSinceLastKeydown: number; appVersion: string }>;
        error?: string;
      }>,
      /** 导出：弹出 save dialog 把 %TMP%/taskmanager-input-diag.log 复制过去 */
      export: () => invoke('input:diag:export') as Promise<{
        ok: boolean; path?: string; canceled?: boolean; byteCount?: number; error?: string;
      }>,
    },
    // 全量备份 / 恢复 / 完整性检查
    backup: {
      export: () => invoke('backup:export') as Promise<{ ok: boolean; path?: string; counts?: Record<string, number>; canceled?: boolean }>,
      import: (opts?: { skipSafetyBackup?: boolean }) => invoke('backup:import', opts) as Promise<{
        ok: boolean;
        canceled?: boolean;
        error?: string;
        restored?: Record<string, number>;
        safetyBackupPath?: string;
        source?: string;
      }>,
      status: () => invoke('backup:status') as Promise<{
        integrity: string;
        foreignKeyViolations: number;
        journalMode: string;
        tables: Record<string, number>;
        dbSizeBytes: number;
        lastAutoBackup: string | null;
      }>,
      makeSafety: () => invoke('backup:makeSafety') as Promise<{ ok: boolean; path: string }>,
    },
    // 课表 Excel 导入
    xls: {
      pickFile: () => invoke('xls:pickFile') as Promise<string | null>,
      parseFile: (filePath: string) => invoke('xls:parseFile', filePath) as Promise<{
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
        invoke('xls:reparse', parsed, mapping),
      importItems: (items: any[], opts: { xn: string; xq: '1' | '2'; semesterStart: number; replaceExisting: boolean }) =>
        invoke('xls:importItems', items, opts) as Promise<{
          courses: number; events: number; items: number; courseIds: number[]; warnings: string[];
        }>,
      lastImport: () => invoke('xls:lastImport') as Promise<{ lastSync: number; courseCount: number }>,
    },
    // 关于文本（about.txt，多源聚合 + 本地缓存）
    about: {
      getCache: () => invoke('about:get-cache') as Promise<{
        text: string;
        source?: string;
        sha256?: string;
        pulledAt?: number;
        pinned: boolean;
        mtimeMs?: number;
      }>,
      refresh: () => invoke('about:refresh') as Promise<{
        ok: boolean;
        source?: string;
        sha256?: string;
        size?: number;
        pulledAt?: number;
        error?: string;
        results: Array<{ source: string; ok: boolean; error?: string; sha256?: string; size?: number }>;
      }>,
      saveLocal: (text: string) => invoke('about:save-local', text) as Promise<{ ok: boolean; sha256?: string; size?: number; error?: string }>,
      setPinned: (pinned: boolean) => invoke('about:set-pinned', pinned) as Promise<{ ok: boolean; pinned: boolean }>,
      cachePath: () => invoke('about:cache-path') as Promise<string>,
      openCache: () => invoke('about:open-cache') as Promise<{ ok: boolean }>,
    },
  };

  return api;
}

export type TaskAPI = ReturnType<typeof buildAPI>;
