/**
 * v1.2.3 系统托盘：常驻图标 + 下节课/待办数菜单 + 考试倒计时 tooltip。
 * 窗口全部关闭后不退出应用（托盘常驻），托盘菜单提供「显示主窗口 / 退出」。
 */
import { app, Tray, Menu, nativeImage } from 'electron';
import * as path from 'node:path';
import dayjs from 'dayjs';
import { getDb } from './db/index';

let tray: Tray | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function loadTrayIcon() {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico');
  try {
    const img = nativeImage.createFromPath(p);
    // Windows 托盘最佳 16x16；createFromPath 对 .ico 取第一帧
    if (!img.isEmpty()) return img;
  } catch { /* ignore */ }
  return nativeImage.createEmpty();
}

interface TrayInfo {
  nextClass: { title: string; at: number; location?: string | null } | null;
  currentClass: { title: string; until: number; location?: string | null } | null;
  pendingToday: number;
  nextExam: { title: string; at: number } | null;
}

function queryTrayInfo(): TrayInfo {
  const info: TrayInfo = { nextClass: null, currentClass: null, pendingToday: 0, nextExam: null };
  try {
    const db = getDb();
    const now = Date.now();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);

    // 今日课程：进行中 + 下一节
    const classes = db.prepare(
      `SELECT title, start_at, end_at, location FROM events
       WHERE type = 'class' AND start_at >= ? AND start_at <= ?
       ORDER BY start_at ASC LIMIT 5`
    ).all(dayStart.getTime(), dayEnd.getTime()) as Array<{ title: string; start_at: number; end_at: number | null; location?: string | null }>;
    info.currentClass = classes.find((c) => c.start_at <= now && (c.end_at ?? c.start_at + 45 * 60000) > now) as any || null;
    if (!info.currentClass) {
      info.nextClass = classes.find((c) => c.start_at > now)
        ? { title: classes.find((c) => c.start_at > now)!.title, at: classes.find((c) => c.start_at > now)!.start_at, location: classes.find((c) => c.start_at > now)!.location } as any
        : null;
    }

    // 今日到期待办（含逾期未完成）
    info.pendingToday = (db.prepare(
      `SELECT COUNT(*) AS n FROM course_requirements WHERE status != 'done' AND due_date < ?`
    ).get(dayEnd.getTime()) as any).n;

    // 最近一场未结束的考试
    const exam = db.prepare(
      `SELECT e.title, e.exam_date, c.name AS course_name FROM exams e
       LEFT JOIN courses c ON e.course_id = c.id
       WHERE e.status = 'upcoming' AND e.exam_date > ?
       ORDER BY e.exam_date ASC LIMIT 1`
    ).get(now) as { title: string; exam_date: number; course_name?: string | null } | undefined;
    if (exam) info.nextExam = { title: `${exam.course_name || exam.title}`, at: exam.exam_date };
  } catch { /* db 未就绪等场景静默 */ }
  return info;
}

function buildTooltip(info: TrayInfo): string {
  const parts: string[] = ['StarOS TaskManager'];
  if (info.currentClass) {
    parts.push(`上课中：${info.currentClass.title}（至 ${dayjs(info.currentClass.until).format('HH:mm')}）`);
  } else if (info.nextClass) {
    parts.push(`下节课：${info.nextClass.title} ${dayjs(info.nextClass.at).format('HH:mm')}`);
  }
  if (info.pendingToday > 0) parts.push(`今日及逾期待办：${info.pendingToday} 项`);
  if (info.nextExam) {
    const days = Math.ceil((info.nextExam.at - Date.now()) / 86400000);
    parts.push(days > 0 ? `${info.nextExam.title} 考试倒计时 ${days} 天` : `${info.nextExam.title} 今天考试！`);
  }
  return parts.join('\n');
}

/**
 * 初始化托盘。返回是否成功（失败时维持「关窗即退出」旧行为）。
 * @param onShow 托盘菜单「显示主窗口」（窗口可能已销毁，由 main.ts 决定重建或 show）
 * @param onQuit 托盘菜单「退出」
 */
export function initTray(onShow: () => void, onQuit: () => void): boolean {
  const icon = loadTrayIcon();
  if (icon.isEmpty()) {
    console.warn('[tray] icon missing, tray disabled');
    return false;
  }
  tray = new Tray(icon);
  tray.setToolTip('StarOS TaskManager');

  const refresh = () => {
    if (!tray) return;
    const info = queryTrayInfo();
    const now = dayjs();
    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => onShow() },
      { type: 'separator' },
      ...(info.currentClass
        ? [{ label: `上课中 · ${info.currentClass.title}（至 ${dayjs(info.currentClass.until).format('HH:mm')}）`, enabled: false }]
        : info.nextClass
          ? [{ label: `下节课 · ${info.nextClass.title}（${dayjs(info.nextClass.at).format('HH:mm')}）`, enabled: false }]
          : [{ label: '今天没有课了', enabled: false }]),
      { label: `今日及逾期待办：${info.pendingToday} 项`, enabled: false },
      ...(info.nextExam
        ? [{
            label: Math.ceil((info.nextExam.at - Date.now()) / 86400000) > 0
              ? `${info.nextExam.title} · 距考试 ${Math.ceil((info.nextExam.at - Date.now()) / 86400000)} 天`
              : `${info.nextExam.title} · 今天考试`,
            enabled: false,
          }]
        : []),
      { type: 'separator' },
      { label: '现在时刻 ' + now.format('HH:mm'), enabled: false },
      { label: '退出', click: () => onQuit() },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip(buildTooltip(info));
  };

  tray.on('double-click', () => onShow());
  refresh();
  refreshTimer = setInterval(refresh, 30_000);
  return true;
}

export function destroyTray() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (tray) { tray.destroy(); tray = null; }
}
