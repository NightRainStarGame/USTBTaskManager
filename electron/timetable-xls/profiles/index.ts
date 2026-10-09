/**
 * 学校档案注册表 —— 加一所学校 = 写一个 profile 文件 + 在 PROFILES 里加一行。
 *
 * 导入向导把这份列表渲染成下拉框，并按 detect() 的置信度给出「猜你选这个」的提示，
 * 但**最终由用户自己选**：不同学校偶尔共用同一套教务系统（换个模板就对不上），
 * 自动猜错还不如让人一眼选对。
 */
import type { ProfileInfo, SchoolProfile } from './types';
import { normalizeAoa } from './shared';
import { qiluProfile } from './qilu';
import { genericProfile } from './generic';

export const PROFILES: SchoolProfile[] = [qiluProfile, genericProfile];

/** 自动选中的门槛：低于 85 说明「只是有点像」，交给用户选 */
export const AUTO_PICK_THRESHOLD = 85;

export function listProfiles(): ProfileInfo[] {
  return PROFILES.map((p) => ({ id: p.id, name: p.name, layout: p.layout, note: p.note }));
}

export function getProfile(id: string): SchoolProfile | null {
  return PROFILES.find((p) => p.id === id) || null;
}

/**
 * 猜这份文件是哪个学校的档案。
 * @returns 建议的档案 id 与置信度；没有明显倾向时返回 generic
 */
export function detectProfile(aoaRaw: unknown[][]): { id: string; confidence: number } {
  const aoa = normalizeAoa(aoaRaw);
  let best = { id: genericProfile.id, confidence: 0 };
  for (const p of PROFILES) {
    if (p.id === genericProfile.id) continue; // 兜底档案不参与竞争
    const confidence = p.detect(aoa);
    if (confidence > best.confidence) best = { id: p.id, confidence };
  }
  if (best.confidence >= AUTO_PICK_THRESHOLD) return best;
  return { id: genericProfile.id, confidence: best.confidence };
}

export type { ProfileInfo, SchoolProfile };
