import { t } from '../core/i18n';
import { fmt1 } from './dom';

export interface ChartOptions {
  height?: number;
  padding?: number;
  showAxis?: boolean;
  fill?: string;
  stroke?: string;
  gridColor?: string;
}

/** Crisp canvas sizing that follows device pixel ratio. */
function prepare(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 320;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export function drawSparkline(
  canvas: HTMLCanvasElement,
  data: number[],
  options: ChartOptions = {},
): void {
  const height = options.height ?? 64;
  const padding = options.padding ?? 4;
  const ctx = prepare(canvas, height);
  const width = canvas.clientWidth || 320;
  const stroke = options.stroke ?? '#276bb9';
  const fill = options.fill ?? 'rgba(39,107,185,0.14)';
  const gridColor = options.gridColor ?? 'rgba(20,45,75,0.08)';

  if (data.length < 2) {
    ctx.fillStyle = 'rgba(105,125,150,0.95)';
    ctx.font = '11px "Noto Sans TC",sans-serif';
    ctx.fillText(t('資料累積中…'), 10, height / 2);
    return;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padding + (innerH / 2) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  const pointAt = (i: number): [number, number] => [
    padding + (i / (data.length - 1)) * innerW,
    padding + innerH - ((data[i]! - min) / range) * innerH,
  ];

  ctx.beginPath();
  const [x0, y0] = pointAt(0);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < data.length; i++) {
    const [x, y] = pointAt(i);
    ctx.lineTo(x, y);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.lineTo(width - padding, height);
  ctx.lineTo(padding, height);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  const [lx, ly] = pointAt(data.length - 1);
  ctx.beginPath();
  ctx.arc(lx, ly, 2.8, 0, Math.PI * 2);
  ctx.fillStyle = stroke;
  ctx.fill();
}

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/** Horizontal utilisation bars with labels — used for zone capacity. */
export function drawBars(
  canvas: HTMLCanvasElement,
  data: BarDatum[],
  options: ChartOptions & { max?: number; unit?: string } = {},
): void {
  const rowHeight = 22;
  const height = Math.max(40, data.length * rowHeight + 10);
  const ctx = prepare(canvas, height);
  const width = canvas.clientWidth || 320;
  const labelW = 54;
  const valueW = 52;
  const barW = Math.max(30, width - labelW - valueW - 12);
  const max = options.max ?? Math.max(1, ...data.map((d) => d.value));

  data.forEach((datum, i) => {
    const y = 6 + i * rowHeight;
    ctx.fillStyle = 'rgba(70,90,115,0.95)';
    ctx.font = '11px "Noto Sans TC",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(datum.label, 0, y + 7);

    ctx.fillStyle = 'rgba(20,45,75,0.07)';
    ctx.fillRect(labelW, y + 2, barW, 11);

    const ratio = Math.max(0, Math.min(1, datum.value / max));
    const color = datum.color ?? (ratio > 0.9 ? '#c53434' : ratio > 0.75 ? '#b05c00' : '#0f8f8f');
    ctx.fillStyle = color;
    ctx.fillRect(labelW, y + 2, barW * ratio, 11);

    ctx.fillStyle = 'rgba(70,90,115,0.95)';
    ctx.textAlign = 'right';
    ctx.font = '11px "JetBrains Mono",monospace';
    ctx.fillText(`${fmt1(datum.value)}${options.unit ?? ''}`, width, y + 7);
  });
}

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

/** Donut chart with an inline legend. */
export function drawDonut(canvas: HTMLCanvasElement, data: DonutDatum[]): void {
  const height = 150;
  const ctx = prepare(canvas, height);
  const width = canvas.clientWidth || 320;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const cx = 62;
  const cy = height / 2;
  const r = 44;
  const inner = 26;

  let angle = -Math.PI / 2;
  data.forEach((datum) => {
    if (datum.value <= 0) return;
    const slice = (datum.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = datum.color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    angle += slice;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.fillStyle = '#22354c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 17px "JetBrains Mono",monospace';
  ctx.fillText(fmt1(total), cx, cy - 5);
  ctx.fillStyle = 'rgba(110,130,155,0.95)';
  ctx.font = '9px "Noto Sans TC",sans-serif';
  ctx.fillText(t('總計'), cx, cy + 12);

  let ly = 22;
  const lx = 128;
  data.forEach((datum) => {
    ctx.fillStyle = datum.color;
    ctx.fillRect(lx, ly - 5, 9, 9);
    ctx.fillStyle = 'rgba(60,80,105,0.95)';
    ctx.textAlign = 'left';
    ctx.font = '11px "Noto Sans TC",sans-serif';
    ctx.fillText(datum.label, lx + 15, ly);
    ctx.fillStyle = 'rgba(105,125,150,0.95)';
    ctx.font = '11px "JetBrains Mono",monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${fmt1(datum.value)}`, width, ly);
    ly += 19;
  });
}

/** Horizontal timeline used for the TMS route board. */
export function drawRouteStrip(
  canvas: HTMLCanvasElement,
  segments: Array<{ label: string; ratio: number; color: string }>,
): void {
  const height = 26;
  const ctx = prepare(canvas, height);
  const width = canvas.clientWidth || 320;
  let x = 0;
  segments.forEach((segment) => {
    const w = Math.max(2, width * segment.ratio);
    ctx.fillStyle = segment.color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, 4, w, 12);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.strokeRect(x + 0.5, 4.5, w - 1, 11);
    x += w;
  });
}
