import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { strokePath, PAGE_H, PAGE_W } from './geometry';
import { themes } from '@/src/theme';
import { notePayload, validateNotePayload } from './document';

const escape = (value: any) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function notebookHTML(note: any) {
  validateNotePayload(notePayload(note));
  const c = themes.light;
  const pages = note.pages
    .map((page: any) => {
      const lines =
        page.background === 'Blank'
          ? ''
          : Array.from(
              { length: Math.ceil(PAGE_H / page.spacing) },
              (_, i) =>
                `<line x1="0" y1="${i * page.spacing + page.spacing - 0.5}" x2="600" y2="${i * page.spacing + page.spacing - 0.5}" stroke="${c.paperLine}" stroke-width="0.7"/>`,
            ).join('') +
            (page.background === 'Grid'
              ? Array.from(
                  { length: Math.ceil(PAGE_W / page.spacing) },
                  (_, i) =>
                    `<line x1="${i * page.spacing + page.spacing - 0.5}" y1="0" x2="${i * page.spacing + page.spacing - 0.5}" y2="840" stroke="${c.paperLine}" stroke-width="0.7"/>`,
                ).join('')
              : '');
      const texts = page.objects
        .filter((o: any) => o.type === 'text')
        .map(
          (o: any) =>
            `<div style="position:absolute;left:${o.x}px;top:${o.y}px;width:${o.width}px;font-size:${o.size}px;color:${escape(o.color)};font-weight:${o.bold ? 700 : 400};font-style:${o.italic ? 'italic' : 'normal'};text-decoration:${o.underline ? 'underline' : 'none'};text-align:${o.align || 'left'};line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere">${escape(o.text)}</div>`,
        )
        .join('');
      const strokes = page.objects
        .filter((o: any) => o.type === 'stroke')
        .map(
          (o: any) =>
            `<path transform="translate(${o.x},${o.y})" d="${strokePath(o.points, o.size)}" fill="${escape(o.color)}" opacity="${o.opacity ?? 1}"/>`,
        )
        .join('');
      return `<section><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 840">${lines}</svg>${texts}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 840">${strokes}</svg></section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(note.title)}</title><style>@page{size:600px 840px;margin:0}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;background:${c.paper}}section{position:relative;width:600px;height:840px;overflow:hidden;page-break-after:always;break-after:page;background:${c.paper};print-color-adjust:exact;-webkit-print-color-adjust:exact}section:last-child{page-break-after:auto}svg{position:absolute;inset:0;width:600px;height:840px;pointer-events:none}</style></head><body>${pages}</body></html>`;
}
/** Reserve the browser window during the click, before waiting for the save acknowledgement. */
export function prepareNotebookExport() {
  const win = Platform.OS === 'web' ? window.open('', '_blank') : null;
  if (Platform.OS === 'web' && !win)
    throw new Error('Allow the print window in your browser, then retry.');
  let cancelled = false;
  if (win) {
    win.opener = null;
    win.document.title = '1% — Print notebook';
    win.document.body.textContent = 'Saving and preparing your notebook…';
  }
  return {
    cancel() {
      cancelled = true;
      win?.close();
    },
    async complete(note: any) {
      if (cancelled || win?.closed) throw new Error('The print window was closed.');
      const html = notebookHTML(note);
      if (win) {
        const safe = html.replace(
          '<head>',
          "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'\">",
        );
        win.document.open();
        win.document.write(safe);
        win.document.close();
        await win.document.fonts?.ready;
        if (cancelled || win.closed) throw new Error('The print window was closed.');
        win.addEventListener('afterprint', () => win.close(), { once: true });
        win.focus();
        win.print();
        return;
      }
      const result = await Print.printToFileAsync({ html, width: PAGE_W, height: PAGE_H });
      if (cancelled) return;
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: note.title,
        });
      else await Print.printAsync({ uri: result.uri });
    },
  };
}
export async function exportNotebook(note: any) {
  const job = prepareNotebookExport();
  try {
    await job.complete(note);
  } catch (error) {
    job.cancel();
    throw error;
  }
}
