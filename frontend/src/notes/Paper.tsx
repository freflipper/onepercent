import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Defs, G, Line, Path, Pattern, Rect } from 'react-native-svg';
import { useTheme } from '@/src/theme';
import { newId } from '@/src/dates';
import { bounds, PAGE_H, PAGE_W, strokePath, textHeight } from './geometry';
import { PaperGesture } from './PaperGesture';

export default function Paper({ page, scale, tool, brush, selection, onSelect, onChange }: any) {
  const { colors } = useTheme(),
    [liveStroke, setLiveStroke] = useState<number[][]>([]),
    [moving, setMoving] = useState<any>(null);
  const inputRefs = useRef<Record<string, TextInput | null>>({}),
    paperRef = useRef<View>(null);
  const point = useCallback(
    (event: any): number[] | null => {
      const native = event.nativeEvent,
        touch = native.touches?.[0] || native.changedTouches?.[0] || native;
      let x = native.locationX,
        y = native.locationY;
      if (Platform.OS === 'web') {
        const rect = (paperRef.current as any)?.getBoundingClientRect?.();
        if (rect) {
          x =
            (touch.clientX ?? (touch.pageX != null ? touch.pageX - window.scrollX : NaN)) -
            rect.left;
          y =
            (touch.clientY ?? (touch.pageY != null ? touch.pageY - window.scrollY : NaN)) -
            rect.top;
        }
      }
      const factor = scale;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(factor) || factor <= 0)
        return null;
      return [
        Math.max(0, Math.min(PAGE_W, x / factor)),
        Math.max(0, Math.min(PAGE_H, y / factor)),
        Number.isFinite(native.force) && native.force > 0 ? Math.min(1, native.force) : 0.5,
      ];
    },
    [scale],
  );
  const [controller] = useState(() => new PaperGesture());
  useLayoutEffect(() => {
    controller.configure(
      { page, tool, brush, onSelect, onChange },
      point,
      setLiveStroke,
      setMoving,
    );
  }, [controller, page, tool, brush, onSelect, onChange, point]);
  const objects = page.objects
    .filter((o: any) => !moving?.removed?.includes(o.id))
    .map((o: any) => (moving?.id === o.id ? moving : o));
  const selected = objects.find((o: any) => o.id === selection),
    box = selected && bounds(selected);
  function addText(event: any) {
    const p = point(event),
      id = newId();
    if (!p) return;
    onChange({
      ...page,
      objects: [
        ...page.objects,
        {
          id,
          type: 'text',
          x: Math.min(p[0], PAGE_W - 180),
          y: Math.min(p[1], PAGE_H - 50),
          width: Math.min(280, PAGE_W - Math.min(p[0], PAGE_W - 180)),
          text: '',
          color: brush.color,
          size: brush.textSize || 20,
          bold: brush.bold || false,
          italic: brush.italic || false,
          underline: brush.underline || false,
          align: brush.align || 'left',
        },
      ],
    });
    onSelect(id);
    requestAnimationFrame(() => inputRefs.current[id]?.focus());
  }
  const patternId = `paper-${page.id}`;
  return (
    <View
      ref={paperRef}
      testID="note-paper"
      style={[
        styles.paper,
        { width: PAGE_W * scale, height: PAGE_H * scale, backgroundColor: colors.paper },
      ]}
    >
      <Svg
        pointerEvents="none"
        width="100%"
        height="100%"
        viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <Pattern
            id={patternId}
            width={page.spacing}
            height={page.spacing}
            patternUnits="userSpaceOnUse"
          >
            <Line
              x1="0"
              y1={page.spacing - 0.5}
              x2={page.spacing}
              y2={page.spacing - 0.5}
              stroke={colors.paperLine}
              strokeWidth="0.7"
            />
            {page.background === 'Grid' && (
              <Line
                x1={page.spacing - 0.5}
                y1="0"
                x2={page.spacing - 0.5}
                y2={page.spacing}
                stroke={colors.paperLine}
                strokeWidth="0.7"
              />
            )}
          </Pattern>
        </Defs>
        {page.background !== 'Blank' && (
          <Rect width={PAGE_W} height={PAGE_H} fill={`url(#${patternId})`} />
        )}
      </Svg>
      {tool === 'Text' && (
        <Pressable testID="note-add-text-layer" onPress={addText} style={StyleSheet.absoluteFill} />
      )}
      {objects
        .filter((o: any) => o.type === 'text')
        .map((o: any) => (
          <TextInput
            key={o.id}
            ref={(el) => {
              inputRefs.current[o.id] = el;
            }}
            testID={`note-text-${o.id}`}
            accessibilityLabel="Editable note text"
            multiline
            scrollEnabled={false}
            editable={tool === 'Text'}
            pointerEvents={tool === 'Text' ? 'auto' : 'none'}
            value={o.text}
            placeholder={tool === 'Text' ? 'Type here…' : ''}
            placeholderTextColor={colors.paperLine}
            onFocus={() => onSelect(o.id)}
            onChangeText={(text) =>
              onChange({
                ...page,
                objects: page.objects.map((v: any) => (v.id === o.id ? { ...v, text } : v)),
              })
            }
            style={[
              styles.text,
              {
                left: o.x * scale,
                top: o.y * scale,
                width: o.width * scale,
                height: textHeight(o) * scale,
                fontSize: o.size * scale,
                lineHeight: o.size * 1.45 * scale,
                color: o.color,
                fontWeight: o.bold ? '700' : '400',
                fontStyle: o.italic ? 'italic' : 'normal',
                textDecorationLine: o.underline ? 'underline' : 'none',
                textAlign: o.align || 'left',
                borderColor: selection === o.id ? colors.inkBlue : colors.transparent,
                borderWidth: selection === o.id ? 1 : 0,
              },
            ]}
          />
        ))}
      <Svg
        pointerEvents="none"
        width="100%"
        height="100%"
        viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
        style={StyleSheet.absoluteFill}
      >
        {objects
          .filter((o: any) => o.type === 'stroke')
          .map((o: any) => (
            <G key={o.id} transform={`translate(${o.x},${o.y})`}>
              <Path d={strokePath(o.points, o.size)} fill={o.color} opacity={o.opacity} />
            </G>
          ))}
        {liveStroke.length > 0 && (
          <Path
            d={strokePath(liveStroke, tool === 'Highlighter' ? brush.size * 5 : brush.size)}
            fill={brush.color}
            opacity={tool === 'Highlighter' ? 0.32 : 1}
          />
        )}
        {box && tool === 'Select' && (
          <Rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            fill="none"
            stroke={colors.inkBlue}
            strokeWidth="1"
            strokeDasharray="5 4"
          />
        )}
      </Svg>
      {['Pen', 'Highlighter', 'Select', 'Stroke Eraser'].includes(tool) && (
        <View
          testID="note-drawing-layer"
          {...controller.responder.panHandlers}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  paper: { position: 'relative', overflow: 'hidden' },
  text: { position: 'absolute', padding: 0, margin: 0, textAlignVertical: 'top', borderRadius: 0 },
});
