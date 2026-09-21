import { useState } from 'react';
import { Download, Upload, FileJson, AlertTriangle } from 'lucide-react';
import Modal from '@/components/Modal';
import {
  buildExportPayload, parseImportPayload,
  type ExportPayload,
} from './history';
import type { Node, Edge } from '@xyflow/react';

/** v1.2.1 块 7：导入导出面板（点击触发，单独弹窗） */
export function ExportButton(props: {
  canvasName: string;
  canvasDescription?: string | null;
  viewport: { x: number; y: number; zoom: number };
  nodes: Node[];
  edges: Edge[];
}) {
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    if (props.nodes.length === 0 && props.edges.length === 0) {
      window.alert('当前画布为空，无可导出内容。');
      return;
    }
    setBusy(true);
    try {
      const payload = buildExportPayload(
        props.canvasName,
        props.canvasDescription,
        props.viewport,
        props.nodes,
        props.edges,
      );
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (props.canvasName || 'canvas').replace(/[\\/:*?"<>|]/g, '_');
      a.download = `${safeName}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={onExport} disabled={busy} className="btn-ghost text-xs" title="导出为 JSON 文件">
      <Download size={12} /> {busy ? '导出中…' : '导出'}
    </button>
  );
}

/** 导入弹窗 —— 选择本地 JSON → 校验 → 调用回调 */
export function ImportModal(props: {
  onClose: () => void;
  onImport: (payload: ExportPayload, replace: boolean) => Promise<void>;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [payload, setPayload] = useState<ExportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [parsing, setParsing] = useState(false);

  const onFile = async (file: File) => {
    setError(null);
    setParsing(true);
    try {
      const text = await file.text();
      const parsed = parseImportPayload(text);
      setRaw(text);
      setPayload(parsed);
    } catch (e) {
      setError((e as Error).message);
      setPayload(null);
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!payload) return;
    await props.onImport(payload, replace);
    props.onClose();
  };

  return (
    <Modal
      title="导入画布"
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose} className="btn-ghost">取消</button>
          <button onClick={submit} disabled={!payload} className="btn-neon">
            <Upload size={12} /> 导入
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {!raw && (
          <label className="block">
            <div className="label-tag mb-1">选择 JSON 文件</div>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
              className="input-neon w-full text-xs"
            />
          </label>
        )}

        {parsing && <div className="text-xs text-text-dim font-mono">解析中…</div>}

        {error && (
          <div className="flex items-start gap-2 p-2 rounded border border-neon-danger/40 bg-neon-danger/5 text-xs">
            <AlertTriangle size={14} style={{ color: '#FF3366' }} className="shrink-0 mt-0.5" />
            <div className="text-neon-danger font-mono">{error}</div>
          </div>
        )}

        {payload && (
          <>
            <div className="p-2 rounded border border-neon-green/20 bg-ink-base/40 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <FileJson size={12} className="text-neon-green" />
                <span className="label-tag">画布：{payload.canvas.name}</span>
              </div>
              <div className="text-[10px] text-text-dim font-mono">
                {payload.nodes.length} 节点 · {payload.edges.length} 连线 ·
                {' '}导出时间 {new Date(payload.exportedAt).toLocaleString()}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-mono">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              <span className="text-text-secondary">替换当前画布（否则在现有节点后追加）</span>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}