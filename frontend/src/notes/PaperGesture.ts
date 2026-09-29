import { PanResponder } from 'react-native';
import { newId } from '../dates';
import { bounds, hit, PAGE_H, PAGE_W } from './geometry';

/** Imperative gesture state belongs to the responder, not to React render-time refs. */
export class PaperGesture {
  private current: any = null;
  private gesture: any = null;
  private point: (event: any) => number[] | null = () => null;
  private live: (value: number[][]) => void = () => {};
  private moving: (value: any) => void = () => {};
  configure(
    current: any,
    point: (event: any) => number[] | null,
    live: (value: number[][]) => void,
    moving: (value: any) => void,
  ) {
    this.current = current;
    this.point = point;
    this.live = live;
    this.moving = moving;
  }
  private enabled = () =>
    ['Pen', 'Highlighter', 'Stroke Eraser', 'Select'].includes(this.current?.tool);
  readonly responder = PanResponder.create({
    onStartShouldSetPanResponder: this.enabled,
    onMoveShouldSetPanResponder: this.enabled,
    onPanResponderGrant: (event) => {
      const p = this.point(event),
        r = this.current;
      if (!p || !r) return;
      if (r.tool === 'Pen' || r.tool === 'Highlighter') {
        this.gesture = { points: [p] };
        this.live([p]);
      } else if (r.tool === 'Select') {
        const object = [...r.page.objects].reverse().find((o: any) => hit(o, p[0], p[1]));
        r.onSelect(object?.id || null);
        this.gesture = object ? { object, start: p, next: object } : null;
      } else {
        this.gesture = { removed: new Set<string>() };
        const o = [...r.page.objects].reverse().find((o: any) => hit(o, p[0], p[1], true));
        if (o) {
          this.gesture.removed.add(o.id);
          this.moving({ removed: [...this.gesture.removed] });
        }
      }
    },
    onPanResponderMove: (event) => {
      const p = this.point(event),
        r = this.current,
        g = this.gesture;
      if (!g || !p || !r) return;
      if (g.points) {
        g.points.push(p);
        this.live([...g.points]);
      } else if (g.object) {
        const b = bounds(g.object);
        g.next = {
          ...g.object,
          x: Math.max(0, Math.min(PAGE_W - Math.min(b.w, PAGE_W), g.object.x + p[0] - g.start[0])),
          y: Math.max(0, Math.min(PAGE_H - Math.min(b.h, PAGE_H), g.object.y + p[1] - g.start[1])),
        };
        this.moving(g.next);
      } else if (g.removed) {
        const o = [...r.page.objects].reverse().find((o: any) => hit(o, p[0], p[1], true));
        if (o) {
          g.removed.add(o.id);
          this.moving({ removed: [...g.removed] });
        }
      }
    },
    onPanResponderRelease: () => {
      const r = this.current,
        g = this.gesture;
      if (!r) return;
      if (g?.points) {
        const x = Math.min(...g.points.map((p: number[]) => p[0])),
          y = Math.min(...g.points.map((p: number[]) => p[1]));
        const object = {
          id: newId(),
          type: 'stroke',
          x,
          y,
          points: g.points.map((p: number[]) => [p[0] - x, p[1] - y, p[2]]),
          color: r.brush.color,
          size: r.tool === 'Highlighter' ? r.brush.size * 5 : r.brush.size,
          opacity: r.tool === 'Highlighter' ? 0.32 : 1,
        };
        r.onChange({ ...r.page, objects: [...r.page.objects, object] });
      } else if (g?.object && (g.next.x !== g.object.x || g.next.y !== g.object.y))
        r.onChange({
          ...r.page,
          objects: r.page.objects.map((o: any) => (o.id === g.object.id ? g.next : o)),
        });
      else if (g?.removed?.size)
        r.onChange({ ...r.page, objects: r.page.objects.filter((o: any) => !g.removed.has(o.id)) });
      this.gesture = null;
      this.live([]);
      this.moving(null);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      this.gesture = null;
      this.live([]);
      this.moving(null);
    },
  });
}
