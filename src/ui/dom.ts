/** Tiny DOM + formatting helpers shared by every panel. */

import { formatCompact, formatDecimal, formatNumber, labelTable, t } from '../core/i18n';

export function el<T extends HTMLElement = HTMLElement>(
  tag: string,
  className?: string,
  html?: string,
): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------- formatting */

export const fmtInt = (n: number): string => formatNumber(n);
export const fmt1 = (n: number): string => formatDecimal(n, 1);
export const fmt2 = (n: number): string => formatDecimal(n, 2);
export const fmtCompact = (n: number): string => formatCompact(n);

export function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${formatDecimal(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1000) return `$${formatDecimal(n / 1000)}K`;
  return `$${formatNumber(Math.round(n))}`;
}

export function fmtWeight(kg: number): string {
  if (kg >= 1000) return `${formatDecimal(kg / 1000)} t`;
  return `${formatNumber(Math.round(kg))} kg`;
}

/** Human-readable elapsed time, e.g. `2 小時 15 分` / `2 h 15 min`. */
export function fmtDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 60) return t('{0} 分', Math.round(minutes));
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 24) return m === 0 ? t('{0} 小時', h) : t('{0} 小時 {1} 分', h, m);
  return t('{0} 天 {1} 小時', Math.floor(h / 24), h % 24);
}

/** Remaining travel time, e.g. `1 小時 5 分` / `1 h 5 min`. */
export function fmtEta(minutes: number): string {
  if (minutes <= 0) return t('已到達');
  if (minutes < 60) return t('{0} 分鐘', Math.round(minutes));
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? t('{0} 小時', h) : t('{0} 小時 {1} 分', h, m);
}

export function relativeTime(simMinutes: number, now: number): string {
  const delta = now - simMinutes;
  if (delta < 1) return t('剛剛');
  return t('{0}前', fmtDuration(delta));
}

export function statusTone(status: string): string {
  switch (status) {
    case 'done':
    case 'shipped':
    case 'delivered':
    case 'closed':
      return 'ok';
    case 'active':
    case 'loading':
    case 'receiving':
    case 'enroute':
    case 'delivering':
    case 'putaway':
    case 'picking':
    case 'packing':
      return 'busy';
    case 'critical':
    case 'danger':
    case 'onhold':
    case 'overdue':
      return 'danger';
    case 'express':
    case 'warning':
      return 'warn';
    case 'queued':
    case 'scheduled':
    case 'released':
    case 'staged':
      return 'info';
    default:
      return 'muted';
  }
}

/* ------------------------------------------------------------------ labels */

/**
 * Label tables hold the Traditional Chinese source strings; call sites pass
 * them through `t()` so the active language is always applied.
 */
export const TASK_LABEL = labelTable({
  receive: '收貨',
  putaway: '上架',
  pick: '揀貨',
  pack: '打包',
  load: '裝車',
  dispatch: '發運',
  replenish: '補貨',
  cyclecount: '盤點',
});

export const ORDER_STATUS_LABEL = labelTable({
  released: '待釋出',
  picking: '揀貨中',
  picked: '已揀貨',
  packing: '打包中',
  packed: '已打包',
  staged: '待裝車',
  loading: '裝車中',
  shipped: '已出貨',
  onhold: '暫停',
});

export const VEHICLE_STATUS_LABEL = labelTable({
  idle: '待命',
  loading: '裝車中',
  enroute: '高速公路',
  delivering: '配送中',
  unloading: '卸貨中',
  returning: '返程',
});

export const PRIORITY_LABEL = labelTable({
  standard: '一般',
  express: '急件',
  critical: '特急',
});

export const ROLE_LABEL = labelTable({
  picker: '揀貨員',
  receiver: '收貨員',
  packer: '打包員',
  loader: '裝車員',
  driver: '駕駛',
  supervisor: '主管',
});

export const TEMP_LABEL = labelTable({
  ambient: '常溫',
  chilled: '冷藏',
  frozen: '冷凍',
});

export const CHANNEL_LABEL = labelTable({
  B2B: 'B2B',
  B2C: 'B2C',
  XBorder: '跨境',
  Replenish: '補貨',
});

export const MOVEMENT_LABEL = labelTable({
  receipt: '收貨',
  putaway: '上架',
  pick: '揀貨',
  replenish: '補貨',
  adjustment: '盤點調整',
  shipment: '出貨',
  return: '退貨',
});

export const WAVE_STATUS = labelTable({
  building: '建構中',
  released: '已釋出',
  picking: '揀貨中',
  complete: '完成',
});

export const SHIPMENT_STATUS = labelTable({
  loading: '裝車中',
  sealed: '已封車',
  enroute: '運輸中',
  delivering: '配送中',
  delivered: '已送達',
  returning: '返程',
});

export const VEHICLE_KIND = labelTable({
  van: '廂型車',
  box: '貨車',
  reefer: '冷藏車',
  flatbed: '板車',
  container: '貨櫃車',
});

export const AGV_STATE_LABEL = labelTable({
  idle: '待命',
  toPick: '前往取貨',
  toDrop: '前往放貨',
  charging: '充電中',
  blocked: '阻塞',
});

/* ----------------------------------------------------------- count units */

/**
 * Units that follow a count need a singular form for the value 1.
 * The singular keys are literals so the dictionary audit can see them.
 */
export const taskUnit = (count: number): string => (count === 1 ? t('1 任務') : t('任務'));
export const binUnit = (count: number): string => (count === 1 ? t('1 儲位') : t('儲位'));
export const waveUnit = (count: number): string => (count === 1 ? t('1 波次') : t('波次'));
export const batchUnit = (count: number): string => (count === 1 ? t('1 批次') : t('批次'));
