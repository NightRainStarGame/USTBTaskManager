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

/** v1.3.0：补丁持久缓存状态（zip + patch-info.json） */
export type PatchCacheStateDTO = {
  exists: boolean;
  info?: {
    fromVersion: string;
    toVersion: string;
    sha256: string;
    size: number;
    baseAsarSha256: string;
    appAsarSha256: string;
    downloadedAt: number;
    zipPath: string;
  };
  zipOk?: boolean | null;
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
      // v1.2.1 画布编辑器（与现有 projects/tasks 完全独立的新模块）
      canvases: {
        list: () => invoke('db:canvases:list'),
        get: (id: number) => invoke('db:canvases:get', id),
        /** v1.3.0：画布并入项目 —— 按项目取画布 */
        getByProject: (projectId: number) => invoke('db:canvases:getByProject', projectId),
        create: (data: any) => invoke('db:canvases:create', data),
        update: (id: number, data: any) => invoke('db:canvases:update', id, data),
        delete: (id: number) => invoke('db:canvases:delete', id),
      },
      canvasNodes: {
        listByCanvas: (canvasId: number) => invoke('db:canvasNodes:listByCanvas', canvasId),
        create: (data: any) => invoke('db:canvasNodes:create', data),
        update: (id: number, data: any) => invoke('db:canvasNodes:update', id, data),
        /** 拖拽过程中批量更新坐标（一次 IPC 写多条） */
        updatePositions: (batch: Array<{ id: number; pos_x: number; pos_y: number }>) =>
          invoke('db:canvasNodes:updatePositions', batch),
        delete: (id: number) => invoke('db:canvasNodes:delete', id),
      },
      canvasEdges: {
        listByCanvas: (canvasId: number) => invoke('db:canvasEdges:listByCanvas', canvasId),
        create: (data: any) => invoke('db:canvasEdges:create', data),
        update: (id: number, data: any) => invoke('db:canvasEdges:update', id, data),
        delete: (id: number) => invoke('db:canvasEdges:delete', id),
      },
      settings: {
        getAll: () => invoke('db:settings:getAll'),
        set: (key: string, value: string) => invoke('db:settings:set', key, value),
      },
      stats: {
        dashboard: () => invoke('db:stats:dashboard'),
        /** v1.2.3：周报 / 月报聚合（时间范围毫秒时间戳） */
        report: (from: number, to: number) => invoke('db:stats:report', from, to) as Promise<{
          reqDoneByDay: Array<{ day: string; n: number }>;
          reqDoneByCourse: Array<{ courseId: number; courseName: string | null; courseColor: string | null; n: number }>;
          habitCheckinsByDay: Array<{ day: string; n: number }>;
          attendanceSummary: Record<string, number>;
          range: { from: number; to: number };
        }>,
      },
      // ── v1.2.3 新模块 ──
      grades: {
        list: (filter?: { semester?: string; courseId?: number }) => invoke('db:grades:list', filter),
        create: (data: any) => invoke('db:grades:create', data),
        update: (id: number, data: any) => invoke('db:grades:update', id, data),
        delete: (id: number) => invoke('db:grades:delete', id),
      },
      exams: {
        list: (filter?: { status?: string }) => invoke('db:exams:list', filter),
        create: (data: any) => invoke('db:exams:create', data),
        update: (id: number, data: any) => invoke('db:exams:update', id, data),
        delete: (id: number) => invoke('db:exams:delete', id),
      },
      pomodoro: {
        list: (filter?: { from?: number; to?: number; courseId?: number }) => invoke('db:pomodoro:list', filter),
        create: (data: any) => invoke('db:pomodoro:create', data),
        stop: (id: number, minutes: number) => invoke('db:pomodoro:stop', id, minutes),
        stats: (from: number, to: number) => invoke('db:pomodoro:stats', from, to) as Promise<{
          byDay: Array<{ day: string; minutes: number; sessions: number }>;
          byCourse: Array<{ courseId: number; courseName: string | null; courseColor: string | null; minutes: number; sessions: number }>;
        }>,
      },
      habits: {
        list: () => invoke('db:habits:list') as Promise<Array<{ id: number; name: string; emoji: string; color: string; frequency: string; target_per_week: number | null; archived: number; sort_order: number; created_at: number; checkinDates: string[] }>>,
        create: (data: any) => invoke('db:habits:create', data),
        update: (id: number, data: any) => invoke('db:habits:update', id, data),
        delete: (id: number) => invoke('db:habits:delete', id),
        toggleCheckin: (habitId: number, date: string) => invoke('db:habits:toggleCheckin', habitId, date) as Promise<{ ok: boolean; checked: boolean }>,
      },
      attendance: {
        list: (filter?: { courseId?: number }) => invoke('db:attendance:list', filter),
        upsert: (data: { course_id: number; date: string; status: string; note?: string }) => invoke('db:attendance:upsert', data),
        stats: (courseId?: number) => invoke('db:attendance:stats', courseId) as Promise<Record<string, number>>,
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
          latencyMs?: number;
          /** v1.3.0：增量补丁清单（优先走补丁更新） */
          patches?: any[] | null;
          asarSize?: number | null;
          size?: number | null;
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
            latencyMs?: number;
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
        applied?: boolean; failed?: boolean; pendingSidecar?: boolean;
        baseline?: { expected: string; actual: string };
        message?: string;
      }>,
      /** v1.3.0：缓存式补丁更新 —— 只下载 zip+json 到 userData/update-cache，不退出 */
      patchDownload: (patch: any) =>
        invoke('update:patch:download', patch) as Promise<{
          ok: boolean;
          error?: string;
          state?: PatchCacheStateDTO;
        }>,
      /** v1.3.0：查询补丁缓存（设置页"已下载的更新"卡片） */
      patchCacheState: () => invoke('update:patch:cacheState') as Promise<PatchCacheStateDTO>,
      /** v1.3.0：应用缓存补丁（校验 → helper → 重启） */
      patchApplyCached: () => invoke('update:patch:applyCached') as Promise<{
        ok: boolean;
        error?: string;
        state?: PatchCacheStateDTO;
        helperPid?: number;
      }>,
      /** v1.3.0：清空补丁缓存 */
      patchClearCache: () => invoke('update:patch:clearCache') as Promise<{ ok: boolean }>,
      /** v1.2.7：用户主动接管 .new 旁路（PatchStateCard 重试按钮触发），主进程会退出 */
      patchTakeoverSidecar: () => invoke('update:patch:takeoverSidecar') as Promise<{
        ok: boolean; error?: string; helperPid?: number;
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
      /** v1.2.2：回看已生成的作业码（手动生成历史 + 课程绑定码，同码去重） */
      listMyCodes: () => invoke('homework:listMyCodes') as Promise<{
        ok: boolean;
        codes: Array<{ syncCode: string; publishCode: string; createdAt: number; source: 'generated' | 'course'; courseName?: string }>;
        error?: string;
      }>,
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
        skipped?: Array<{ title: string; courseName: string; reason: string }>;
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

    /** v1.1.9：自动清理 & 回收站 */
    cleanup: {
      rules: () => invoke('cleanup:rules') as Promise<{
        enabled: boolean;
        reqDays: number;
        taskDays: number;
        eventDays: number;
        projectDays: number;
        homeworkDays: number;
        binDays: number;
      }>,
      setRules: (patch: {
        enabled?: boolean;
        reqDays?: number;
        taskDays?: number;
        eventDays?: number;
        projectDays?: number;
        homeworkDays?: number;
        binDays?: number;
      }) => invoke('cleanup:setRules', patch) as Promise<{
        enabled: boolean;
        reqDays: number;
        taskDays: number;
        eventDays: number;
        projectDays: number;
        homeworkDays: number;
        binDays: number;
      }>,
      run: () => invoke('cleanup:run') as Promise<{
        local: {
          ranAt: number;
          enabled: boolean;
          binned: { requirements: number; tasks: number; events: number; projects: number };
          purgedBin: number;
        };
        cloud: {
          ranAt: number;
          codes: string[];
          github: { checked: number; rewritten: number; deleted: number; removedEntries: number; errors: string[] };
          cloud: { checked: number; rewritten: number; removedEntries: number; errors: string[] };
        };
      }>,
      bin: (opts?: { kind?: string; limit?: number }) => invoke('cleanup:bin', opts) as Promise<Array<{
        id: number;
        kind: string;
        entity_id: number | null;
        title: string;
        reason: string | null;
        deleted_at: number;
        purge_at: number;
        snapshot: Record<string, any>;
      }>>,
      restore: (id: number) => invoke('cleanup:bin:restore', id) as Promise<{ ok: boolean; error?: string; newId?: number }>,
      purge: (id?: number | null) => invoke('cleanup:bin:purge', id ?? null) as Promise<{ purged: number }>,
    },

    /** v1.2.3：WebDAV 云同步（坚果云等） */
    webdav: {
      config: () => invoke('webdav:config') as Promise<{ url: string; user: string; hasPass: boolean; configured: boolean }>,
      save: (cfg: { url?: string; user?: string; pass?: string; clearPass?: boolean }) => invoke('webdav:save', cfg) as Promise<{ ok: boolean }>,
      test: () => invoke('webdav:test') as Promise<{ ok: boolean; error?: string; warning?: string }>,
      push: () => invoke('webdav:push') as Promise<{ ok: boolean; size?: number; counts?: Record<string, number>; exportedAt?: number; error?: string }>,
      remoteInfo: () => invoke('webdav:remoteInfo') as Promise<{
        ok: boolean; exists?: boolean; exportedAt?: number; appVersion?: string;
        counts?: Record<string, number>; error?: string;
      }>,
      pull: () => invoke('webdav:pull') as Promise<{
        ok: boolean; restored?: Record<string, number>; safetyBackupPath?: string;
        exportedAt?: number; error?: string;
      }>,
    },

    

    /** v1.2.6：付费体系（纯本地月卡，30 天计时，无服务端依赖） */
    billing: {
      status: () => invoke('billing:status') as Promise<{
        ok: boolean;
        isPremium: boolean;
        premiumUntil: number | null;
        premiumUntilIso: string | null;
        remainingDays: number;
        activatedCount: number;
        monthlyDays: number;
        /** v1.2.6：最近 5 条已激活码（mask 后），用户自查是否被他人盗用 */
        recentlyActivatedCodes?: Array<{
          codeMasked: string;
          openedAtIso: string;
          expiresAtIso: string;
        }>;
        error?: string;
      }>,
      redeemMonthly: (code: string) => invoke('billing:redeemMonthly', code) as Promise<{
        ok: boolean;
        isPremium?: boolean;
        premiumUntil?: number;
        expiresAtIso?: string;
        remainingDays?: number;
        /** v1.2.6：码已用过的明确错误码 */
        errorCode?: 'ALREADY_ACTIVATED';
        activatedAtIso?: string;
        error?: string;
      }>,
      redeemVoucher: (code: string) => invoke('billing:redeemVoucher', code) as Promise<{
        ok: boolean;
        plan?: 'BASIC' | 'MONTHLY';
        error?: string;
      }>,
      /** v1.2.6 起无操作（保留入口以免渲染层报错） */
      syncVouchers: () => invoke('billing:syncVouchers') as Promise<{ ok: boolean; activated: number; error?: string }>,
    },

    // v1.2.7 起 P2P 班级复活（GitHub raw 主写 + 北科云盘备；无 VPS 依赖）
    class: {
      config: () => invoke('class:config') as Promise<{
        ok: boolean; repo: string; branch: string; repoUrl: string;
        tokenSet: boolean; cloudSourceEnabled: boolean;
        cloud: { baseUrl: string; linkId: string; password: string; enabled: boolean } | null;
        localAlias: string;
      }>,
      saveAuth: (token: string) => invoke('class:saveAuth', token) as Promise<{ ok: boolean; tokenSet?: boolean; error?: string }>,
      saveCloud: (cfg: { url?: string; password?: string; enabled?: boolean }) => invoke('class:saveCloud', cfg) as Promise<{
        ok: boolean; cloud?: { baseUrl: string; linkId: string; password: string; enabled: boolean }; error?: string;
      }>,
      saveLocalAlias: (alias: string) => invoke('class:saveLocalAlias', alias) as Promise<{ ok: boolean; localAlias?: string; error?: string }>,
      list: () => invoke('class:list') as Promise<{ ok: boolean; classes: any[] }>,
      info: (classId: number) => invoke('class:info', classId) as Promise<{ ok: boolean; [k: string]: any }>,
      create: (payload: { name: string; description?: string; alias?: string }) => invoke('class:create', payload) as Promise<{
        ok: boolean; warnings?: string[]; error?: string; errorCode?: string; hint?: string;
        id?: number; classCode?: string; inviteCode?: string; ownerToken?: string;
      }>,
      join: (payload: { inviteCode: string; alias?: string }) => invoke('class:join', payload) as Promise<{
        ok: boolean; source?: 'github' | 'anyshare'; error?: string; errorCode?: string;
        classId?: number; className?: string; role?: string; memberCount?: number;
      }>,
      leave: (classId: number) => invoke('class:leave', classId) as Promise<{ ok: boolean; error?: string }>,
      listAnnouncements: (classId: number) => invoke('class:listAnnouncements', classId) as Promise<{ ok: boolean; announcements: any[] }>,
      listTasks: (classId: number) => invoke('class:listTasks', classId) as Promise<{ ok: boolean; tasks: any[] }>,
      publishAnnouncement: (classId: number, payload: { title: string; body: string }) =>
        invoke('class:publishAnnouncement', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; annId?: number; error?: string }>,
      publishTask: (classId: number, payload: { title: string; body?: string; dueAt?: number }) =>
        invoke('class:publishTask', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; taskId?: number; error?: string }>,
      markAnnouncementRead: (classId: number, annId: number) =>
        invoke('class:markAnnouncementRead', classId, annId) as Promise<{ ok: boolean }>,
      completeTask: (classId: number, taskId: number, status: 'open' | 'done' | 'cancelled') =>
        invoke('class:completeTask', classId, taskId, status) as Promise<{ ok: boolean }>,
      sync: (classId: number) => invoke('class:sync', classId) as Promise<{
        ok: boolean; source?: 'github' | 'anyshare';
        newAnnouncements?: number; newTasks?: number;
        manifest?: any; error?: string;
      }>,
    },

    /** v1.2.3：主进程推送事件（托盘 / 全局快捷键） */
    system: {
      /** 订阅「呼出快速添加」（Ctrl+Shift+A / 托盘），返回取消订阅函数 */
      onQuickAdd: (cb: () => void) => {
        if (subscribe) return subscribe('app:quickadd', cb);
        return () => { /* 浏览器 / 移动端无此事件 */ };
      },
    },
  };

  return api;
}

export type TaskAPI = ReturnType<typeof buildAPI>;
