import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Pencil, Save, X, Lock, Unlock, FolderOpen, FileText, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import dayjs from 'dayjs';

function renderMarkdown(md: string): { __html: string } {
  // v1.2.7：硬 XSS 防御（about.txt 来自多源聚合，云端可被改）
  // 1) esc 转义 & < > " '（属性值双引号也必须转义）
  // 2) 链接 [text](url) 强制白名单协议：仅 http / https / mailto
  //    拒绝 javascript: / data: / vbscript: 等可执行协议
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const escAttr = (s: string) => esc(s).replace(/\s/g, '%20');
  const safeUrl = (raw: string) => {
    const u = raw.trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^mailto:/i.test(u)) return u;
    return null; // 拒绝一切其他协议
  };
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let codeBuf: string[] = [];
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-ink-700/60 text-neon-green font-mono text-[12px]">$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_m, text: string, url: string) => {
        const u = safeUrl(url);
        if (!u) return esc(text); // 拒绝不安全协议 → 渲染为纯文本
        return `<a href="${escAttr(u)}" target="_blank" rel="noreferrer" class="text-neon-green underline">${esc(text)}</a>`;
      });
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeCode = () => { if (inCode) { out.push(`<pre class="bg-ink-900/80 border border-neon-green/15 rounded p-2 my-2 text-[12px] overflow-x-auto"><code>${esc(codeBuf.join('\n'))}</code></pre>`); inCode = false; codeBuf = []; } };
  for (const raw of lines) {
    const line = raw;
    if (line.startsWith('```')) {
      if (inCode) { closeCode(); continue; }
      closeList(); inCode = true; continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^### /.test(line)) { closeList(); out.push(`<h3 class="text-sm font-bold text-neon-green mt-2 mb-1">${inline(line.slice(4))}</h3>`); continue; }
    if (/^## /.test(line)) { closeList(); out.push(`<h2 class="text-base font-bold text-neon-green mt-3 mb-1">${inline(line.slice(3))}</h2>`); continue; }
    if (/^# /.test(line)) { closeList(); out.push(`<h1 class="text-lg font-bold text-neon-green mt-2 mb-2">${inline(line.slice(2))}</h1>`); continue; }
    if (/^- /.test(line)) {
      if (!inList) { out.push('<ul class="list-disc list-inside my-1 space-y-0.5">'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.trim() === '') { out.push('<div class="h-1.5"></div>'); continue; }
    out.push(`<p class="my-1.5 leading-relaxed">${inline(line)}</p>`);
  }
  closeList(); closeCode();
  return { __html: out.join('\n') };
}

interface AboutCache {
  text: string;
  source?: string;
  sha256?: string;
  pulledAt?: number;
  pinned: boolean;
  mtimeMs?: number;
}

export default function AboutPanel({ appVersion }: { appVersion: string }) {
  const [cache, setCache] = useState<AboutCache | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadCache = async () => {
    const c = await window.taskAPI.about.getCache();
    setCache(c);
    setPinned(c.pinned);
  };

  useEffect(() => { loadCache(); }, []);

  const html = useMemo(() => (cache ? renderMarkdown(cache.text) : { __html: '' }), [cache]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const r = await window.taskAPI.about.refresh();
      if (r.ok) {
        const ok = r.results.filter((x: { ok: boolean }) => x.ok).length;
        const fail = r.results.length - ok;
        setRefreshMsg({
          kind: 'ok',
          text: `已从 ${r.source || '云端'} 拉取最新（${ok} 源成功${fail ? `，${fail} 源失败` : ''}）。`,
        });
        await loadCache();
      } else {
        setRefreshMsg({ kind: 'err', text: r.error || '拉取失败' });
      }
    } catch (e: any) {
      setRefreshMsg({ kind: 'err', text: e?.message || String(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const startEdit = () => {
    setDraft(cache?.text || '');
    setEditing(true);
    setSaveMsg(null);
  };

  const cancelEdit = () => { setEditing(false); setDraft(''); setSaveMsg(null); };

  const saveLocal = async () => {
    setSaveMsg(null);
    const r = await window.taskAPI.about.saveLocal(draft);
    if (r.ok) {
      setSaveMsg({ kind: 'ok', text: `已保存本地版本（${r.size} 字节，sha256 ${r.sha256?.slice(0, 12)}…）。` });
      setEditing(false);
      await loadCache();
    } else {
      setSaveMsg({ kind: 'err', text: r.error || '保存失败' });
    }
  };

  const togglePinned = async () => {
    const r = await window.taskAPI.about.setPinned(!pinned);
    setPinned(r.pinned);
    if (r.pinned) {
      setRefreshMsg({ kind: 'ok', text: '已锁定本地。云端下次启动不再覆盖。' });
    } else {
      setRefreshMsg({ kind: 'ok', text: '已解锁。下次「立即拉取最新」会被云端覆盖。' });
    }
  };

  const openCacheFolder = async () => {
    await window.taskAPI.about.openCache();
  };

  if (!cache) return <div className="text-text-dim text-xs font-mono">加载中…</div>;

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-sm font-mono">
        <div className="flex"><span className="w-28 text-text-dim">应用名称</span><span className="text-neon-green">TaskManager</span></div>
        <div className="flex"><span className="w-28 text-text-dim">版本</span><span>v{appVersion || '—'}</span></div>
      </div>

      <div className="rounded-md border border-neon-green/15 bg-ink-900/40 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neon-green/10 bg-ink-800/60 text-[11px] font-mono text-text-dim">
          <FileText size={12} className="text-neon-green" />
          <span>about.txt</span>
          <span className="ml-auto" title={cache.source || ''}>
            {cache.source ? `来源 · ${cache.source}` : '默认内容'}
          </span>
          {cache.pulledAt ? (
            <span title={cache.sha256 || ''}>
              · {dayjs(cache.pulledAt).format('MM-DD HH:mm:ss')}
            </span>
          ) : null}
        </div>

        {editing ? (
          <div className="p-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="input-neon w-full font-mono text-[13px] leading-relaxed"
              rows={14}
              spellCheck={false}
              placeholder="支持 # / ## / ### 标题，- 列表，**粗体**，`代码`，[text](url) 链接…"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={saveLocal} className="btn-neon text-xs"><Save size={12} /> 保存本地</button>
              <button onClick={cancelEdit} className="btn-ghost text-xs"><X size={12} /> 取消</button>
              {saveMsg && (
                <span className={`text-xs font-mono self-center ${saveMsg.kind === 'ok' ? 'text-neon-green' : 'text-neon-danger'}`}>
                  {saveMsg.text}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div
            className="px-4 py-3 text-[13px] text-text leading-relaxed font-sans"
            dangerouslySetInnerHTML={html}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <button onClick={refresh} disabled={refreshing} className="btn-neon text-xs">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '拉取中…' : '立即拉取最新'}
        </button>
        {!editing && (
          <button onClick={startEdit} className="btn-ghost text-xs">
            <Pencil size={12} /> 编辑本地
          </button>
        )}
        <button onClick={togglePinned} className="btn-ghost text-xs">
          {pinned ? <Lock size={12} className="text-neon-yellow" /> : <Unlock size={12} />}
          {pinned ? '已锁定本地（解锁）' : '锁定本地'}
        </button>
        <button onClick={openCacheFolder} className="btn-ghost text-xs">
          <FolderOpen size={12} /> 打开缓存目录
        </button>
        {refreshMsg && (
          <span className={`flex items-center gap-1 ${refreshMsg.kind === 'ok' ? 'text-neon-green' : 'text-neon-danger'}`}>
            {refreshMsg.kind === 'ok' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {refreshMsg.text}
          </span>
        )}
      </div>

      <div className="text-[10px] text-text-dim font-mono leading-relaxed space-y-0.5">
        <div className="flex items-start gap-1"><Info size={10} className="mt-0.5 shrink-0" />
          这份关于文本会从所有启用的更新源自动同步到本地缓存 <code className="px-1 mx-0.5 rounded bg-ink-700/60 text-neon-green">{cache.sha256 ? 'about.txt（已缓存）' : 'about.txt（默认内容）'}</code>。
        </div>
        <div>· 全网同步：编辑仓库根 <code className="px-1 mx-0.5 rounded bg-ink-700/60">about.txt</code> → commit + push → 用户下次启动自动拉到</div>
        <div>· 保留本地版：编辑后勾「锁定本地」即可阻止云端覆盖</div>
      </div>
    </div>
  );
}