/**
 * v1.2.7 块 L：从 src/mocks/browserApi.ts 拆出
 *
 * 班级 P2P mock：浏览器预览用 in-memory 状态（mockClasses + mockAnnouncements + mockClassTasks + mockLocalAlias）
 *
 * 浏览器预览的班级页面只接受 DEMO 前缀的邀请码 / DEMO 前缀的假班级码，
 * 不与 GitHub PAT 实际交互。所有数据存内存，刷新即丢。
 *
 * v1.2.9 R8：补齐 deleteAnnouncement / promoteMember / removeMember / 接龙 / 投票 mock
 *
 * 调用方：src/mocks/browserApi.ts 的 createBrowserApi() 通过 createClassMockApi()
 * 注入到 taskAPI.class
 */

let mockLocalAlias = '我';
const mockClasses: any[] = [];
const mockAnnouncements: Record<number, any[]> = {};
const mockClassTasks: Record<number, any[]> = {};
const mockChains: Record<number, any[]> = {};
const mockPolls: Record<number, any[]> = {};

/** 模拟异步操作（与真实 IPC 时延接近） */
const delay = () => new Promise<void>((r) => setTimeout(r, 80 + Math.random() * 120));

function findClass(id: number) {
  return mockClasses.find(x => x.id === id);
}

function syncMembersCount(cls: any) {
  // 保持 memberCount 与 members 长度一致
  cls.memberCount = (cls.members || []).length;
  return cls;
}

export function createClassMockApi() {
  return {
    config: async () => ({
      ok: true,
      repo: 'NightRainStarGame/USTBTaskManager-Class',
      branch: 'main',
      repoUrl: 'https://github.com/NightRainStarGame/USTBTaskManager-Class/tree/main/class',
      tokenSet: false,
      fallbackTokenAvailable: true,
      usingFallbackToken: true,
      cloudSourceEnabled: false,
      cloud: null,
      localAlias: mockLocalAlias,
    }),
    saveAuth: async () => ({ ok: true, tokenSet: false }),
    saveCloud: async () => ({ ok: true }),
    saveLocalAlias: async (alias: string) => { mockLocalAlias = alias; return { ok: true, localAlias: alias }; },
    list: async () => ({ ok: true, classes: mockClasses }),
    info: async (id: number) => {
      const c = findClass(id);
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
      // 预置一条演示公告 / 演示接龙 / 演示投票
      mockAnnouncements[id] = [{
        id: Date.now() - 7200_000, title: '欢迎加入示例班级',
        body: '浏览器预览模式下所有数据仅存内存。\n试试顶部的「接龙」「投票」按钮！',
        images: [], pinned: false, isRead: false, createdAt: Date.now() - 7200_000, authorAlias: '豆芽',
      }];
      mockChains[id] = [{
        id: Date.now() - 3600_000, authorAlias: '豆芽', title: '周六团建报名',
        body: '格式：姓名 + 想吃的菜', items: [
          { alias: '豆芽', content: '豆芽 + 火锅', ts: Date.now() - 3400_000 },
        ], closed: false, createdAt: Date.now() - 3600_000, updatedAt: Date.now() - 3400_000,
      }];
      mockPolls[id] = [{
        id: Date.now() - 1800_000, authorAlias: '豆芽', question: '班会时间选哪个？',
        description: '投票截止明晚 8 点', options: [{ text: '周三 19:00' }, { text: '周四 19:00' }, { text: '周五 18:30' }],
        votes: { Alice: { choices: [0], ts: Date.now() - 1500_000 } },
        multi: false, closed: false, deadlineAt: null,
        createdAt: Date.now() - 1800_000, updatedAt: Date.now() - 1500_000,
      }];
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
    // v1.2.9 R2
    deleteAnnouncement: async (id: number, annId: number) => {
      await delay();
      const list = mockAnnouncements[id];
      if (!list) return { ok: false, error: '班级不存在' };
      const i = list.findIndex(x => x.id === annId);
      if (i < 0) return { ok: false, error: '公告不存在' };
      list.splice(i, 1);
      return { ok: true };
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
    // v1.2.9 R3
    promoteMember: async (id: number, payload: { alias: string; role: 'admin' | 'member' }) => {
      await delay();
      const cls = findClass(id);
      if (!cls) return { ok: false, error: '班级不存在' };
      if (cls.role !== 'owner') return { ok: false, error: '仅 owner 可调整成员角色', errorCode: 'NOT_OWNER' };
      const m = (cls.members || []).find((x: any) => x.alias === payload.alias);
      if (!m) return { ok: false, error: '成员不存在', errorCode: 'NOT_FOUND' };
      if (m.role === 'owner') return { ok: false, error: '不能调整 owner 本人' };
      m.role = payload.role;
      return { ok: true, role: payload.role };
    },
    removeMember: async (id: number, payload: { alias: string }) => {
      await delay();
      const cls = findClass(id);
      if (!cls) return { ok: false, error: '班级不存在' };
      if (cls.role !== 'owner' && cls.role !== 'admin') return { ok: false, error: '仅 owner / admin 可移除成员', errorCode: 'NOT_ALLOWED' };
      const m = (cls.members || []).find((x: any) => x.alias === payload.alias);
      if (!m) return { ok: false, error: '成员不存在', errorCode: 'NOT_FOUND' };
      if (m.role === 'owner') return { ok: false, error: '不能移除 owner' };
      if (cls.role === 'admin' && m.role !== 'member') return { ok: false, error: 'admin 只能移除普通成员', errorCode: 'NOT_ALLOWED' };
      cls.members = cls.members.filter((x: any) => x.alias !== payload.alias);
      syncMembersCount(cls);
      return { ok: true };
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
    // v1.2.9 R4：接龙
    listChains: async (id: number) => ({ ok: true, chains: mockChains[id] || [] }),
    createChain: async (id: number, payload: { title: string; body?: string }) => {
      await delay();
      const chain = {
        id: Date.now(), authorAlias: mockLocalAlias, title: payload.title, body: payload.body || '',
        items: [], closed: false, createdAt: Date.now(), updatedAt: Date.now(),
      };
      if (!mockChains[id]) mockChains[id] = [];
      mockChains[id].unshift(chain);
      return { ok: true, warnings: ['浏览器预览模式：仅本机内存生效'], chainId: chain.id };
    },
    joinChain: async (id: number, chainId: number, content: string) => {
      await delay();
      const c = mockChains[id]?.find(x => x.id === chainId);
      if (!c) return { ok: false, error: '接龙不存在', errorCode: 'NOT_FOUND' };
      if (c.closed) return { ok: false, error: '接龙已结束' };
      c.items.push({ alias: mockLocalAlias, content, ts: Date.now() });
      c.updatedAt = Date.now();
      return { ok: true };
    },
    closeChain: async (id: number, chainId: number) => {
      await delay();
      const c = mockChains[id]?.find(x => x.id === chainId);
      if (!c) return { ok: false, error: '接龙不存在' };
      const cls = findClass(id);
      const can = cls && (cls.role === 'owner' || cls.role === 'admin' || c.authorAlias === mockLocalAlias);
      if (!can) return { ok: false, error: '仅发起人或管理员可结束接龙', errorCode: 'NOT_ALLOWED' };
      c.closed = true;
      return { ok: true };
    },
    // v1.2.9 R5：投票
    listPolls: async (id: number) => ({ ok: true, polls: mockPolls[id] || [] }),
    createPoll: async (id: number, payload: { question: string; description?: string; options: string[]; multi?: boolean; deadlineAt?: number }) => {
      await delay();
      const opts = (payload.options || []).map((t) => ({ text: t }));
      if (opts.length < 2) return { ok: false, error: '至少需要 2 个选项' };
      const poll = {
        id: Date.now(), authorAlias: mockLocalAlias,
        question: payload.question, description: payload.description || '',
        options: opts, votes: {}, multi: !!payload.multi, closed: false,
        deadlineAt: payload.deadlineAt || null, createdAt: Date.now(), updatedAt: Date.now(),
      };
      if (!mockPolls[id]) mockPolls[id] = [];
      mockPolls[id].unshift(poll);
      return { ok: true, warnings: ['浏览器预览模式：仅本机内存生效'], pollId: poll.id };
    },
    votePoll: async (id: number, pollId: number, choices: number[]) => {
      await delay();
      const p = mockPolls[id]?.find(x => x.id === pollId);
      if (!p) return { ok: false, error: '投票不存在', errorCode: 'NOT_FOUND' };
      if (p.closed) return { ok: false, error: '投票已结束' };
      if (p.deadlineAt && Date.now() > p.deadlineAt) return { ok: false, error: '投票已过截止时间' };
      p.votes[mockLocalAlias] = { choices, ts: Date.now() };
      p.updatedAt = Date.now();
      return { ok: true };
    },
    closePoll: async (id: number, pollId: number) => {
      await delay();
      const p = mockPolls[id]?.find(x => x.id === pollId);
      if (!p) return { ok: false, error: '投票不存在' };
      const cls = findClass(id);
      const can = cls && (cls.role === 'owner' || cls.role === 'admin' || p.authorAlias === mockLocalAlias);
      if (!can) return { ok: false, error: '仅发起人或管理员可结束投票', errorCode: 'NOT_ALLOWED' };
      p.closed = true;
      return { ok: true };
    },
    sync: async (id: number) => {
      await delay();
      const cls = findClass(id);
      if (cls) cls.lastSyncedAt = Date.now();
      return { ok: true, source: 'github', newAnnouncements: 0, newTasks: 0, newChains: 0, newPolls: 0 };
    },
  };
}
