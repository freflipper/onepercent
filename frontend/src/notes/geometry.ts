import { getStroke } from 'perfect-freehand';
export const PAGE_W = 600,
  PAGE_H = 840;
export function strokePath(points: number[][], size: number) {
  if (!points.length) return '';
  const outline = getStroke(points, {
    size,
    thinning: 0.35,
    smoothing: 0.6,
    streamline: 0.5,
    simulatePressure: true,
  });
  if (!outline.length) return '';
  return `M ${outline.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L ')} Z`;
}
export function textHeight(o: any) {
  const chars = Math.max(1, Math.floor((o.width || 260) / (o.size * 0.58)));
  const lines = String(o.text || '')
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0);
  return Math.min(PAGE_H - o.y, Math.max(o.size * 1.45 + 12, lines * o.size * 1.45 + 12));
}
export function bounds(o: any) {
  if (o.type === 'text') return { x: o.x, y: o.y, w: o.width, h: textHeight(o) };
  const xs = o.points.map((p: number[]) => p[0]),
    ys = o.points.map((p: number[]) => p[1]);
  return {
    x: o.x + Math.min(...xs, 0) - o.size,
    y: o.y + Math.min(...ys, 0) - o.size,
    w: Math.max(...xs, 0) + o.size * 2,
    h: Math.max(...ys, 0) + o.size * 2,
  };
}
export function hit(o: any, x: number, y: number, strokeOnly = false) {
  if (strokeOnly)
    return (
      o.type === 'stroke' &&
      o.points.some(
        (p: number[]) => Math.hypot(p[0] + o.x - x, p[1] + o.y - y) < Math.max(16, o.size),
      )
    );
  const b = bounds(o);
  return x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8;
}
