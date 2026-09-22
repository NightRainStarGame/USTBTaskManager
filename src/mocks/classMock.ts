/**
 * v1.2.7 块 L：从 src/mocks/browserApi.ts 拆出
 *
 * 班级 P2P mock：浏览器预览用 in-memory 状态（mockClasses + mockAnnouncements + mockClassTasks + mockLocalAlias）
 *
 * 浏览器预览的班级页面只接受 DEMO 前缀的邀请码 / DEMO 前缀的假班级码，
 * 不与 GitHub PAT 实际交互。所有数据存内存，刷新即丢。
 *
 * 调用方：src/mocks/browserApi.ts 的 createBrowserApi() 通过 createClassMockApi()
 * 注入到 taskAPI.class
 */

let mockLocalAlias = '我';
const mockClasses: any[] = [];
const mockAnnouncements: Record<number, any[]> = {};
const mockClassTasks: Record<number, any[]> = {};

/** 模拟异步操作（与真实 IPC 时延接近） */
const delay = () => new Promise<void>((r) => setTimeout(r, 80 + Math.random() * 120));

export function createClassMockApi() {
  return {
    config: async () => ({
      ok: true,
      repo: 'NightRainStarGame/USTBTaskManager',
      branch: 'main',
      repoUrl: 'https://github.com/NightRainStarGame/USTBTaskManager/tree/main/class',
      tokenSet: false,
      cloudSourceEnabled: false,
      cloud: null,
      localAlias: mockLocalAlias,
    }),
    saveAuth: async () => ({ ok: true, tokenSet: false }),
    saveCloud: async () => ({ ok: true }),
    saveLocalAlias: async (alias: string) => { mockLocalAlias = alias; return { ok: true, localAlias: alias }; },
    list: async () => ({ ok: true, classes: mockClasses }),
    info: async (id: number) => {
      const c = mockClasses.find(x => x.id === id);
      return c ? { ok: true, ...c } : { ok: false, error: '班级不存在' };
    },
    create: async (payload: { name: string; description?: string; alias?: string }) => {
      await delay();
      const alias = payload.alias || mockLocalAlias;
      const code = 'DEMO8CD2';
      const invite = 'DEMO8CD2-DEMO';
      const id = mockClasses.length + 1;
      const cls = {
        id, classCode: code, inviteCode: invite,
        name: payload.name, description: payload.description || '',
        ownerAlias: alias, myAlias: alias, role: 'owner' as const,
        memberCount: 1, maxMembers: 50, cloudSynced: false,
        lastSyncedAt: null, joinedAt: Date.now(), dissolved: false,
        members: [{ alias, role: 'owner' as const, joinedAt: Date.now(), sig: 'mock-sig' }],
        lastAnnouncementId: 0, lastTaskId: 0, manifestSha: null,
      };
      mockClasses.unshift(cls);
      return { ok: true, warnings: ['浏览器预览模式：班级仅存于本机内存'], ...cls, ownerToken: 'mock-owner-token' };
    },
    join: async (payload: { inviteCode: string; alias?: string }) => {
      await delay();
      const alias = payload.alias || mockLocalAlias;
      // 浏览器预览：仅识别 DEMO 前缀的 inviteCode
      if (!/^DEMO/i.test(payload.inviteCode || '')) {
        return { ok: false, error: '浏览器预览仅识别 DEMO 前缀的邀请码（真码请用桌面端）', errorCode: 'INVALID_INVITE_CODE' };
      }
      const id = mockClasses.length + 1;
      const cls = {
        id, classCode: 'DEMO-' + (mockClasses.length + 1).toString().padStart(4, '0'),
        inviteCode: payload.inviteCode,
        name: '示例班级（浏览器预览）', description: '这是一个演示班级',
        ownerAlias: '豆芽', myAlias: alias, role: 'member' as const,
        memberCount: 3, maxMembers: 50, cloudSynced: true,
        lastSyncedAt: Date.now(), joinedAt: Date.now(), dissolved: false,
        members: [
          { alias: '豆芽', role: 'owner' as const, joinedAt: Date.now() - 7 * 86400_000, sig: 'mock-sig' },
          { alias: 'Alice', role: 'admin' as const, joinedAt: Date.now() - 5 * 86400_000, sig: 'mock-sig' },
          { alias, role: 'member' as const, joinedAt: Date.now(), sig: 'mock-sig' },
        ],
        lastAnnouncementId: Date.now() - 86400_000, lastTaskId: Date.now() - 3600_000, manifestSha: null,
      };
      mockClasses.unshift(cls);
      return { ok: true, source: 'github', classId: id, className: cls.name, role: 'member', memberCount: 3 };
    },
    leave: async (id: number) => {
      const i = mockClasses.findIndex(x => x.id === id);
      if (i < 0) return { ok: false, error: '班级不存在' };
      mockClasses.splice(i, 1);
      return { ok: true };
    },
    listAnnouncements: async (id: number) => {
      const list = mockAnnouncements[id] || [];
      return { ok: true, announcements: list };
    },
    listTasks: async (id: number) => {
      const list = mockClassTasks[id] || [];
      return { ok: true, tasks: list };
    },
    publishAnnouncement: async (id: number, payload: { title: string; body: string }) => {
      await delay();
      const ann = {
        id: Date.now(), title: payload.title, body: payload.body,
        images: [], pinned: false, isRead: true, createdAt: Date.now(),
        authorAlias: mockLocalAlias,
      };
      if (!mockAnnouncements[id]) mockAnnouncements[id] = [];
      mockAnnouncements[id].unshift(ann);
      return { ok: true, warnings: ['浏览器预览模式：仅本机内存生效'], annId: ann.id };
    },
    publishTask: async (id: number, payload: { title: string; body?: string; dueAt?: number }) => {
      await delay();
      const task = {
        id: Date.now(), title: payload.title, body: payload.body || '',
        dueAt: payload.dueAt || null, status: 'open' as const, createdAt: Date.now(),
      };
      if (!mockClassTasks[id]) mockClassTasks[id] = [];
      mockClassTasks[id].unshift(task);
      return { ok: true, warnings: ['浏览器预览模式：仅本机内存生效'], taskId: task.id };
    },
    markAnnouncementRead: async (id: number, annId: number) => {
      const a = mockAnnouncements[id]?.find(x => x.id === annId);
      if (a) a.isRead = true;
      return { ok: true };
    },
    completeTask: async (id: number, taskId: number, status: 'open' | 'done' | 'cancelled') => {
      const t = mockClassTasks[id]?.find(x => x.id === taskId);
      if (t) t.status = status;
      return { ok: true };
    },
    sync: async (id: number) => ({ ok: true, source: 'github', newAnnouncements: 0, newTasks: 0 }),
  };
}