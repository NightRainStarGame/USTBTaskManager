/**
 * v1.2.3 系统级通知调度：每分钟检查一次
 *   - 上课前 X 分钟（默认 15）
 *   - 作业截止前 24 小时 / 1 小时（分级）
 *   - 考试前 1 天 / 1 小时
 * 用 settings 表记录已发送去重（当日 + 实体 + 档位），7 天自动过期清理。
 */
import { Notification, BrowserWindow, app } from 'electron';
import dayjs from 'dayjs';
import type { DB } from './db/index';

const CHECK_INTERVAL_MS = 60_000;

function getSetting(db: DB, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function isOn(db: DB, key: string, fallback: string): boolean {
  return getSetting(db, key, fallback) !== '0';
}

/** 当日去重键（当天 + 类型 + 实体 + 档位）；返回是否首次（应发送） */
function markSent(db: DB, kind: string, id: number, level: string): boolean {
  const ymd = dayjs().format('YYYY-MM-DD');
  const key = `notif:${kind}:${id}:${level}:${ymd}`;
  const dup = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
  if (dup) return false;
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(Date.now()));
  return true;
}

function purgeStaleMarks(db: DB) {
  try {
    db.prepare(`DELETE FROM settings WHERE key LIKE 'notif:%' AND CAST(value AS INTEGER) < ?`).run(Date.now() - 7 * 86400000);
  } catch { /* ignore */ }
}

function sendNotification(title: string, body: string, getWin: () => BrowserWindow | null) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: `[StarOS] ${title}`, body, silent: false });
  n.on('click', () => {
    const win = getWin();
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  });
  n.show();
}

function checkOnce(db: DB, getWin: () => BrowserWindow | null) {
  const now = Date.now();

  // ── 课程提醒（今日 type='class' 事件，上课前 X 分钟） ──
  if (isOn(db, 'notify_enabled', '1')) {
    const classMinutes = Number(getSetting(db, 'notify_class_minutes', '15')) || 15;
    if (classMinutes > 0) {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
      const classes = db.prepare(
        `SELECT id, title, start_at, location FROM events
         WHERE type = 'class' AND start_at >= ? AND start_at <= ? ORDER BY start_at ASC`
      ).all(dayStart.getTime(), dayEnd.getTime()) as Array<{ id: number; title: string; start_at: number; location?: string | null }>;
      for (const c of classes) {
        const diffMin = (c.start_at - now) / 60000;
        if (diffMin > 0 && diffMin <= classMinutes && markSent(db, 'class', c.id, String(classMinutes))) {
          sendNotification(
            `${Math.ceil(diffMin)} 分钟后上课`,
            `${c.title}${c.location ? ` @ ${c.location}` : ''}`,
            getWin,
          );
        }
      }
    }

    // ── 作业截止分级提醒（24h / 1h） ──
    const reqs = db.prepare(
      `SELECT id, title, due_date, course_id FROM course_requirements WHERE status != 'done' AND due_date > ?`
    ).all(now) as Array<{ id: number; title: string; due_date: number; course_id: number }>;
    const courseName = new Map<number, string>();
    try {
      for (const c of db.prepare('SELECT id, name FROM courses').all() as Array<{ id: number; name: string }>) {
        courseName.set(c.id, c.name);
      }
    } catch { /* ignore */ }
    for (const r of reqs) {
      const diffH = (r.due_date - now) / 3600000;
      if (diffH <= 1 && isOn(db, 'notify_due_1h', '1') && markSent(db, 'req', r.id, '1h')) {
        sendNotification('作业 1 小时内截止', `${courseName.get(r.course_id) || ''} · ${r.title}`, getWin);
      } else if (diffH <= 24 && isOn(db, 'notify_due_24h', '1') && markSent(db, 'req', r.id, '24h')) {
        sendNotification('作业 24 小时内截止', `${courseName.get(r.course_id) || ''} · ${r.title}`, getWin);
      }
    }

    // ── 考试提醒（前 1 天 / 前 1 小时） ──
    if (isOn(db, 'notify_exam_1d', '1')) {
      const exams = db.prepare(
        `SELECT e.id, e.title, e.exam_date, e.location, c.name AS course_name FROM exams e
         LEFT JOIN courses c ON e.course_id = c.id
         WHERE e.status = 'upcoming' AND e.exam_date > ?`
      ).all(now) as Array<{ id: number; title: string; exam_date: number; location?: string | null; course_name?: string | null }>;
      for (const e of exams) {
        const diffH = (e.exam_date - now) / 3600000;
        const name = e.course_name ? `${e.course_name} · ${e.title}` : e.title;
        if (diffH <= 1 && markSent(db, 'exam', e.id, '1h')) {
          sendNotification('考试 1 小时后开始', `${name}${e.location ? ` @ ${e.location}` : ''}`, getWin);
        } else if (diffH <= 24 && markSent(db, 'exam', e.id, '1d')) {
          sendNotification('考试明天进行', `${name} · ${dayjs(e.exam_date).format('MM-DD HH:mm')}`, getWin);
        }
      }
    }
  }
}

/** 启动通知调度器（主进程 whenReady 后调用一次） */
export function startNotificationScheduler(db: DB, getWin: () => BrowserWindow | null) {
  // 启动 90 秒后首查（避开启动高峰），此后每分钟
  setTimeout(() => {
    checkOnce(db, getWin);
    const timer = setInterval(() => {
      try {
        checkOnce(db, getWin);
        if (Math.random() < 0.05) purgeStaleMarks(db); // 平均每 20 分钟清一次过期去重键
      } catch (e) {
        console.error('[notify] check failed', e);
      }
    }, CHECK_INTERVAL_MS);
    // 应用退出时不再需要清理（interval 随进程结束）
    app.on('will-quit', () => clearInterval(timer));
  }, 90_000);
}
