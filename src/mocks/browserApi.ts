/**
 * v1.2.8 块 L：mocks/browserApi 拆分（thin 组装层）
 *
 * 拆分结构：
 *   browserApi/
 *   ├── data.ts       共享 MockData + nextId/delay/withCourseInfo/computeStats
 *   ├── dbCourses.ts  courses/requirements/events/categories
 *   ├── dbProjects.ts projects/tasks
 *   ├── dbCanvas.ts   canvases/canvasNodes/canvasEdges
 *   ├── dbSettings.ts settings/userProfiles/courseNotes
 *   └── dbMisc.ts     stats/grades/exams/pomodoro/habits/attendance
 *
 * 浏览器预览模式共享同一份 MockData 实例，所有 mock 数据由 createBrowserApi() 创建。
 * 注意：ustb.import / backup.import 等高需要直接修改 data 引用（见下方实现）。
 */
import { createMockData, type MockData } from './browserApi/data';
import { createCoursesApi } from './browserApi/dbCourses';
import { createProjectsApi } from './browserApi/dbProjects';
import { createCanvasApi } from './browserApi/dbCanvas';
import { createSettingsApi } from './browserApi/dbSettings';
import { createMiscApi } from './browserApi/dbMisc';
import { createClassMockApi } from './classMock';

// 浏览器模式常量（v1.2.8 块 L：迁移到独立模块，但保留默认源/默认版本号以兼容 UI）
export const MOCK_APP_VERSION = '0.2.5';
export const MOCK_DEFAULT_SOURCE = 'https://github.com/lc-sys/TaskManager/releases';
export const MOCK_DEFAULT_SOURCES = [
  { name: 'GitHub Releases', url: MOCK_DEFAULT_SOURCE, enabled: true, primary: true },
];

// 贝壳课表演示数据（v1.2.8 块 L：保留在此，因为只用一次）
const USTB_DEMO_ITEMS: Array<{
  className: string; teacher: string; location: string;
  day: number; period: number; periodName: string;
  weeks: number[]; weeksText: string;
}> = [
  { className: '高等数学 A(下)', teacher: '黄教授', location: '理教 302', day: 1, period: 1, periodName: '第1-2节', weeks: Array.from({ length: 16 }, (_, i) => i + 1), weeksText: '1-16周' },
  { className: '线性代数', teacher: '李老师', location: '主楼 215', day: 2, period: 3, periodName: '第3-4节', weeks: Array.from({ length: 16 }, (_, i) => i + 1), weeksText: '1-16周' },
  { className: '大学英语 IV', teacher: '王老师', location: '语音室 A', day: 3, period: 5, periodName: '第5-6节', weeks: [1,2,3,4,5,6,7,8], weeksText: '1-8周' },
  { className: '程序设计基础', teacher: '张老师', location: '机房 401', day: 4, period: 1, periodName: '第1-2节', weeks: [9,10,11,12,13,14,15,16], weeksText: '9-16周' },
  { className: '工程力学', teacher: '陈教授', location: '建研楼 101', day: 5, period: 3, periodName: '第3-4节', weeks: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], weeksText: '1-16周' },
];

function fakeQrSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
    <rect width="180" height="180" fill="#fff"/>
    <g fill="#000">
      <rect x="10" y="10" width="40" height="40"/>
      <rect x="130" y="10" width="40" height="40"/>
      <rect x="10" y="130" width="40" height="40"/>
      <rect x="20" y="20" width="20" height="20" fill="#fff"/>
      <rect x="140" y="20" width="20" height="20" fill="#fff"/>
      <rect x="20" y="140" width="20" height="20" fill="#fff"/>
      ${Array.from({ length: 60 }, () => `<rect x="${Math.floor(Math.random() * 160) + 10}" y="${Math.floor(Math.random() * 160) + 10}" width="6" height="6"/>`).join('')}
    </g>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

/** 浏览器端 SHA-256（不可用时退化为提示错误的哈希，校验会失败并提示） */
async function mockSha256(data: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unavailable';
  }
}

/** 弹出文件选择框读取备份 JSON */
function pickBackupFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    window.addEventListener('focus', () => setTimeout(() => {
      if (!input.files?.length) resolve(null);
    }, 500), { once: true });
    input.click();
  });
}

// ---------- Mock API ----------
export function createBrowserApi() {
  const data: MockData = createMockData();

  return {
    window: {
      minimize: async () => {},
      maximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
    },
    db: {
      ...createCoursesApi(data),
      ...createProjectsApi(data),
      ...createCanvasApi(data),
      ...createSettingsApi(data),
      ...createMiscApi(data),
    },
    // v1.2.10：miniprogram 命名空间随小程序模块移除
    // 贝壳课表（浏览器预览：模拟 USTB 扫码登录 + BYYT 课表导入流程）
    ustb: {
      status: async () => {
        await new Promise((r) => setTimeout(r, 60));
        return {
          loggedIn: data.ustb.loggedIn,
          user: data.ustb.user,
          term: data.ustb.term,
          lastSync: data.ustb.lastSync,
          importedCount: data.ustb.importedCourseIds.length,
        };
      },
      qrStart: async () => {
        await new Promise((r) => setTimeout(r, 400));
        data.ustb.pollCount = 0;
        return { sessionId: 'mock-session', qrImage: fakeQrSvg() };
      },
      qrPoll: async () => {
        await new Promise((r) => setTimeout(r, 120));
        data.ustb.pollCount++;
        if (data.ustb.pollCount >= 5) {
          data.ustb.loggedIn = true;
          data.ustb.user = { name: '豆芽（演示）', school: '北京科技大学', userId: '4230xxxx' };
          return { status: 'success', user: data.ustb.user };
        }
        if (data.ustb.pollCount >= 2) return { status: 'scanned' };
        return { status: 'waiting' };
      },
      qrCancel: async () => ({ ok: true }),
      preview: async () => {
        if (!data.ustb.loggedIn) throw new Error('尚未登录，请先扫码');
        await new Promise((r) => setTimeout(r, 300));
        return { user: data.ustb.user, items: USTB_DEMO_ITEMS, periods: [], count: USTB_DEMO_ITEMS.length };
      },
      import: async (opts: any) => {
        if (!data.ustb.loggedIn) throw new Error('尚未登录，请先扫码');
        await new Promise((r) => setTimeout(r, 500));
        // 清除上一次导入
        for (const id of data.ustb.importedCourseIds) {
          data.courses = data.courses.filter((c) => c.id !== id);
          data.events = data.events.filter((e: any) => e.course_id !== id);
        }
        const created: number[] = [];
        let eventCount = 0;
        const dt = new Date(opts.semesterStart);
        dt.setHours(0, 0, 0, 0);
        dt.setDate(dt.getDate() + (dt.getDay() === 0 ? -6 : 1 - dt.getDay()));
        const monday0 = dt.getTime();
        const periods: Record<number, [string, string]> = {
          1: ['08:00', '09:35'], 2: ['09:50', '11:25'], 3: ['14:00', '15:35'],
          4: ['15:50', '17:25'], 5: ['18:30', '20:05'], 6: ['20:10', '21:45'],
        };
        const palette = ['#00FF88', '#00D4FF', '#FFD166', '#FF6B9D', '#A78BFA', '#4ADE80', '#F97316', '#22D3EE', '#F472B6', '#FACC15'];
        const groups = new Map<string, typeof USTB_DEMO_ITEMS>();
        for (const it of USTB_DEMO_ITEMS) {
          const a = groups.get(it.className);
          if (a) a.push(it);
          else groups.set(it.className, [it]);
        }
        let pi = 0;
        groups.forEach((its, name) => {
          const color = palette[pi++ % palette.length];
          const teachers = [...new Set(its.map((i) => i.teacher).filter(Boolean))].join('、');
          const c = {
            id: 1000 + pi, name, code: null, instructor: teachers || null,
            semester: `${opts.xn}-${opts.xq}`, color,
            description: `贝壳课表导入（浏览器演示）`, tags: '["贝壳课表"]', created_at: Date.now(),
          } as any;
          data.courses = [...data.courses, c];
          created.push(c.id);
          for (const it of its) {
            const [sh, sm] = (periods[it.period] ?? periods[1])[0].split(':').map(Number);
            const [eh, em] = (periods[it.period] ?? periods[1])[1].split(':').map(Number);
            const weeks = it.weeks.length ? it.weeks : Array.from({ length: 16 }, (_, i) => i + 1);
            for (const w of weeks) {
              const base = new Date(monday0 + (w - 1) * 7 * 86400000 + (it.day - 1) * 86400000);
              const start_at = base.setHours(sh, sm, 0, 0);
              const end_at = base.setHours(eh, em, 0, 0);
              data.events = [...data.events, {
                id: 2000 + pi + eventCount, title: name, start_at, end_at, location: it.location,
                recurrence: null, recurrence_end: null, course_id: c.id, color: c.color,
                notes: `${it.periodName} · ${it.weeksText}`, all_day: 0, reminder_minutes: null,
                category_id: null, type: 'class',
              }];
              eventCount++;
            }
          }
        });
        data.ustb.importedCourseIds = created;
        data.ustb.lastSync = Date.now();
        data.ustb.term = { xn: opts.xn, xq: String(opts.xq) };
        return { courses: groups.size, events: eventCount, items: USTB_DEMO_ITEMS.length, courseIds: created, warnings: [] };
      },
      logout: async () => {
        data.ustb.loggedIn = false;
        data.ustb.user = null;
        return { ok: true };
      },
    },
    // ICS 导出（浏览器模式：触发本地下载）
    ics: {
      export: async (events: any[]) => {
        const pad = (n: number) => n.toString().padStart(2, '0');
        const fmt = (ts: number, allDay: boolean) => {
          const d = new Date(ts);
          if (allDay) return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
          return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
        };
        const esc = (s: string) => s.replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
        const lines = [
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TaskManager//CN//', 'CALSCALE:GREGORIAN',
          'METHOD:PUBLISH', 'X-WR-CALNAME:TaskManager 日历',
        ];
        const now = fmt(Date.now(), false);
        for (const e of events) {
          const allDay = !!e.all_day;
          lines.push('BEGIN:VEVENT', `UID:${e.id}@taskmanager`, `DTSTAMP:${now}`, `DTSTART:${fmt(e.start_at, allDay)}`);
          if (e.end_at) lines.push(`DTEND:${fmt(e.end_at, allDay)}`);
          lines.push(`SUMMARY:${esc(e.title || '')}`);
          if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
          if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
          const r = e.recurrence;
          if (r === 'WEEKLY') lines.push('RRULE:FREQ=WEEKLY');
          else if (r === 'DAILY') lines.push('RRULE:FREQ=DAILY');
          else if (r === 'MONTHLY') lines.push('RRULE:FREQ=MONTHLY');
          else if (r === 'YEARLY') lines.push('RRULE:FREQ=YEARLY');
          if (e.recurrence_end) lines.push(`UNTIL=${fmt(e.recurrence_end, false)}`);
          lines.push('END:VEVENT');
        }
        lines.push('END:VCALENDAR');
        const content = lines.join('\r\n');
        const blob = new Blob([content], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TaskManager-日历-${new Date().toISOString().slice(0, 10)}.ics`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { ok: true, path: a.download, count: events.length };
      },
    },

    // 全量备份 / 恢复（浏览器模式：JSON 下载 + <input type=file> 读取）
    backup: {
      export: async () => {
        const tables: Record<string, any[]> = {
          courses: [...data.courses],
          categories: [...data.categories],
          course_requirements: [...data.requirements],
          course_notes: [...data.courseNotes],

          events: [...data.events],
          projects: [...data.projects],
          project_tasks: [...data.tasks],
          user_profiles: [...data.userProfiles],
          settings: Object.entries(data.settings).map(([key, value]) => ({ key, value })),
        };
        const checksum = await mockSha256(JSON.stringify(tables));
        const payload = {
          format: 'taskmanager-backup', version: 1, appVersion: '0.2.0-browser-mock',
          exportedAt: Date.now(), tables,
          counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
          checksum,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `taskmanager-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { ok: true, path: a.download, counts: payload.counts };
      },
      import: async (_opts?: { skipSafetyBackup?: boolean }) => {
        const file = await pickBackupFile();
        if (!file) return { ok: false, canceled: true };
        const text = await file.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { return { ok: false, error: '文件不是有效的 JSON' }; }
        if (parsed?.format !== 'taskmanager-backup') return { ok: false, error: '文件格式不匹配（不是 TaskManager 备份）' };
        if (typeof parsed?.checksum !== 'string') return { ok: false, error: '备份缺少校验和' };
        const actual = await mockSha256(JSON.stringify(parsed.tables));
        if (actual !== parsed.checksum) return { ok: false, error: '校验和不匹配：文件被篡改或损坏' };

        const t = parsed.tables;
        data.courses = (t.courses ?? []) as any;
        data.categories = (t.categories ?? []) as any;
        data.requirements = (t.course_requirements ?? []) as any;
        data.courseNotes = (t.course_notes ?? []) as any;

        data.events = (t.events ?? []) as any;
        data.projects = (t.projects ?? []) as any;
        data.tasks = (t.project_tasks ?? []) as any;
        data.userProfiles = (t.user_profiles ?? []) as any;
        data.settings = Object.fromEntries((t.settings ?? []).map((r: any) => [r.key, r.value]));

        const restored: Record<string, number> = {};
        for (const [k, v] of Object.entries(t)) restored[k] = Array.isArray(v) ? v.length : 0;
        return { ok: true, restored, safetyBackupPath: '(浏览器模式不落地)', source: file.name };
      },
      status: async () => {
        return {
          integrity: 'ok',
          foreignKeyViolations: 0,
          journalMode: 'wal',
          tables: {
            courses: data.courses.length,
            categories: data.categories.length,
            course_requirements: data.requirements.length,
            course_notes: data.courseNotes.length,

            events: data.events.length,
            projects: data.projects.length,
            project_tasks: data.tasks.length,
            user_profiles: data.userProfiles.length,
            settings: Object.keys(data.settings).length,
          },
          dbSizeBytes: JSON.stringify({ courses: data.courses, events: data.events, projects: data.projects, tasks: data.tasks, requirements: data.requirements }).length,
          lastAutoBackup: null,
        };
      },
      makeSafety: async () => ({ ok: true, path: '(浏览器模式不落地)' }),
    },

    // 应用信息（浏览器预览）
    app: {
      info: async () => ({
        name: 'TaskManager',
        version: MOCK_APP_VERSION,
        electron: 'browser-preview',
        platform: 'web',
        packaged: false,
      }),
    },

    // 软件更新（浏览器预览：模拟检查结果，不做真实下载）
    updater: {
      config: async () => {
        const sources = Array.isArray(data.settings.update_sources) ? data.settings.update_sources : [];
        const finalSources = sources.length ? sources : MOCK_DEFAULT_SOURCES.map((s) => ({ ...s }));
        const activeIndex = finalSources.findIndex((s: any) => s.primary);
        return {
          defaultSources: finalSources,
          sources: finalSources,
          activeIndex: activeIndex >= 0 ? activeIndex : 0,
          source: finalSources[activeIndex >= 0 ? activeIndex : 0]?.url || '',
          defaultSource: MOCK_DEFAULT_SOURCE,
          autoCheck: data.settings.update_auto_check !== '0',
          skippedVersion: data.settings.update_skipped_version || null,
          lastCheckAt: Number(data.settings.update_last_check) || 0,
        };
      },
      check: async (opts: any) => {
        await new Promise((r) => setTimeout(r, 60));
        const sources = Array.isArray(data.settings.update_sources) ? data.settings.update_sources : [];
        const finalSources = sources.length ? sources : MOCK_DEFAULT_SOURCES.map((s) => ({ ...s }));
        const activeIndex = finalSources.findIndex((s: any) => s.primary);
        const idx = opts?.sourceIndex ?? (activeIndex >= 0 ? activeIndex : 0);
        const source = (finalSources[idx]?.url || '').trim();
        if (!source) {
          return {
            ok: false, reason: 'not_configured', configured: false,
            currentVersion: MOCK_APP_VERSION,
            message: '尚未配置更新源地址。',
          };
        }
        return {
          ok: true, configured: true,
          currentVersion: MOCK_APP_VERSION,
          latestVersion: '0.3.1',
          hasUpdate: true,
          notes: '· 新增课表日历视图\n· 修复课程无法添加作业\n· 优化编辑框输入体验',
          downloadUrl: `${source.replace(/\/[^/]*$/, '')}/TaskManager Setup 0.3.1.exe`,
          pageUrl: source,
          sha256: null,
          source,
          sourceIndex: idx,
          sourceName: finalSources[idx]?.name,
          checkedAt: Date.now(),
          skipped: false,
          forced: false,
        };
      },
      checkAll: async () => {
        await new Promise((r) => setTimeout(r, 60));
        const sources = Array.isArray(data.settings.update_sources) ? data.settings.update_sources : [];
        const finalSources = sources.length ? sources : MOCK_DEFAULT_SOURCES.map((s) => ({ ...s }));
        const perSource = finalSources.map((s: any, i: number) => ({
          source: s,
          result: {
            ok: true, configured: true,
            currentVersion: MOCK_APP_VERSION,
            latestVersion: '0.3.1',
            hasUpdate: true,
            notes: '· 新增课表日历视图',
            downloadUrl: `${(s.url || '').replace(/\/[^/]*$/, '')}/TaskManager Setup 0.3.1.exe`,
            pageUrl: s.url,
            sourceIndex: i,
            sourceName: s.name,
            source: s.url,
            checkedAt: Date.now(),
            skipped: false,
            forced: false,
          },
        }));
        return { currentVersion: MOCK_APP_VERSION, ok: true, anyConfigured: true, winner: perSource[0].result, perSource, checkedAt: Date.now() };
      },
      download: async () => ({ ok: false, error: '(浏览器预览模式不支持下载安装包，请在桌面应用中使用)' }),
      cancel: async () => ({ ok: true }),
      install: async () => ({ ok: false, error: '(浏览器预览模式不支持安装，请在桌面应用中使用)' }),
      patchPreview: async () => ({ available: false, reason: 'browser_mock' }),
      patchDownload: async () => ({ ok: false, error: '(浏览器预览模式不支持下载补丁)' }),
      patchCacheState: async () => ({ exists: false, info: null, zipOk: false }),
      patchApplyCached: async () => ({ ok: false, error: '(浏览器预览模式不支持应用补丁)' }),
      patchClearCache: async () => ({ ok: true }),
      openExternal: async (url: string) => { window.open(url, '_blank', 'noopener'); return { ok: true }; },
      skipVersion: async (v: string) => { data.settings.update_skipped_version = v; return { ok: true }; },
      setSource: async (s: string) => {
        data.settings.update_source = s;
        data.settings.update_sources = [{ name: '自定义源', url: s, enabled: true, primary: true }];
        return { ok: true, source: s, sources: data.settings.update_sources as any };
      },
      setSources: async (payload: any) => {
        data.settings.update_sources = (payload?.sources || []).map((s: any) => ({ ...s }));
        data.settings.update_active_index = String(payload?.activeIndex ?? 0);
        return { ok: true, sources: data.settings.update_sources as any, activeIndex: payload?.activeIndex ?? 0 };
      },
      setActiveSource: async (index: number) => {
        const arr: any[] = Array.isArray(data.settings.update_sources) ? data.settings.update_sources : [];
        const safe = Math.max(0, Math.min(index, arr.length - 1));
        data.settings.update_sources = arr.map((s, i) => ({ ...s, primary: i === safe }));
        data.settings.update_active_index = String(safe);
        return { ok: true, activeIndex: safe, sources: data.settings.update_sources as any };
      },
      setAutoCheck: async (enabled: boolean) => { data.settings.update_auto_check = enabled ? '1' : '0'; return { ok: true, enabled }; },
      onProgress: () => () => {},
      onAvailable: () => () => {},
    },

    /** v1.1.9：自动清理 & 回收站（浏览器预览 mock） */
    cleanup: {
      rules: async () => ({ enabled: true, reqDays: 1, taskDays: 1, eventDays: 7, projectDays: 7, homeworkDays: 7, binDays: 30 }),
      setRules: async (patch: any) => ({ enabled: true, reqDays: 1, taskDays: 1, eventDays: 7, projectDays: 7, homeworkDays: 7, binDays: 30, ...patch }),
      run: async () => ({
        local: { ranAt: Date.now(), enabled: true, binned: { requirements: 0, tasks: 0, events: 0, projects: 0 }, purgedBin: 0 },
        cloud: { ranAt: Date.now(), codes: [], github: { checked: 0, rewritten: 0, deleted: 0, removedEntries: 0, errors: [] }, cloud: { checked: 0, rewritten: 0, removedEntries: 0, errors: [] } },
      }),
      bin: async () => [] as any[],
      restore: async () => ({ ok: false, error: '(浏览器预览模式不支持恢复，请在桌面应用中使用)' }),
      purge: async () => ({ purged: 0 }),
    },

    // v1.2.3：WebDAV 云同步（浏览器预览不可用）
    webdav: {
      config: async () => ({ url: '', user: '', hasPass: false, configured: false }),
      save: async () => ({ ok: true }),
      test: async () => ({ ok: false, error: '浏览器预览不支持 WebDAV' }),
      push: async () => ({ ok: false, error: '浏览器预览不支持 WebDAV' }),
      remoteInfo: async () => ({ ok: false, error: '浏览器预览不支持 WebDAV' }),
      pull: async () => ({ ok: false, error: '浏览器预览不支持 WebDAV' }),
    },

    // v1.2.6：付费月卡 mock（浏览器预览，UI 完整渲染；激活完全在桌面端进行）
    billing: {
      status: async () => {
        await new Promise((r) => setTimeout(r, 60));
        const activated = Array.from(data.billedCodes.entries()).map(([code, info]) => ({
          codeMasked: (() => {
            const parts = code.split('-');
            if (parts.length !== 4) return '****-****-****-****';
            return `${parts[0]}-****-****-${parts[3]}`;
          })(),
          openedAtIso: new Date(info.openedAt).toISOString(),
          expiresAtIso: new Date(info.expiresAt).toISOString(),
        }));
        const maxExp = activated.length > 0
          ? Math.max(...Array.from(data.billedCodes.values()).map((v) => v.expiresAt))
          : null;
        const isPremium = !!(maxExp && maxExp > Date.now());
        const remainingDays = maxExp ? Math.max(0, Math.ceil((maxExp - Date.now()) / 86400_000)) : 0;
        return {
          ok: true,
          isPremium,
          premiumUntil: maxExp,
          premiumUntilIso: maxExp ? new Date(maxExp).toISOString() : null,
          remainingDays,
          activatedCount: activated.length,
          monthlyDays: 30,
          recentlyActivatedCodes: activated,
        };
      },
      redeemMonthly: async (code: string) => {
        await new Promise((r) => setTimeout(r, 60));
        if (/^DEMO[-A-Z0-9]{0,30}$/i.test(code)) {
          if (data.billedCodes.has(code.toUpperCase())) {
            const existing = data.billedCodes.get(code.toUpperCase())!;
            return {
              ok: false,
              errorCode: 'ALREADY_ACTIVATED',
              error: '该月卡码已在本机使用过（每个码仅可激活 1 次）',
              activatedAtIso: new Date(existing.openedAt).toISOString(),
              expiresAtIso: new Date(existing.expiresAt).toISOString(),
              remainingDays: Math.max(0, Math.ceil((existing.expiresAt - Date.now()) / 86400_000)),
            };
          }
          const openedAt = Date.now();
          const expiresAt = openedAt + 30 * 86400_000;
          data.billedCodes.set(code.toUpperCase(), { openedAt, expiresAt });
          return {
            ok: true,
            isPremium: true,
            premiumUntil: expiresAt,
            expiresAtIso: new Date(expiresAt).toISOString(),
            remainingDays: 30,
          };
        }
        return { ok: false, error: '浏览器预览只支持 DEMO 前缀的假激活码（真实激活请用桌面端）' };
      },
      redeemVoucher: async (_code: string) => ({ ok: false, error: 'v1.2.6 起仅支持月卡码（请用桌面端）' }),
      syncVouchers: async () => ({ ok: true, activated: 0 }),
    },

    // v1.2.7：P2P 班级 mock（浏览器预览用）已拆到 mocks/classMock.ts
    class: createClassMockApi(),

    // v1.2.3：主进程事件（浏览器无）
    system: {
      onQuickAdd: () => () => {},
    },
  };
}