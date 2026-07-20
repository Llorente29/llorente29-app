// src/native/print/escpos.ts
// Port a TypeScript/navegador del escpos.js del agente (Buffer -> Uint8Array).
// TicketDoc (modelo Folvy de bloques) -> bytes ESC/POS para térmicas 80mm.
// Lógica IDÉNTICA al agente; solo cambia el contenedor de bytes y el QR (TextEncoder).

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

export interface TicketBlock { kind: string; [k: string]: any }
export interface TicketDoc { title?: string; widthMm?: number; blocks: TicketBlock[] }

class Bytes {
  arr: number[] = [];
  push(...b: number[]) { for (const x of b) this.arr.push(x & 0xff); return this; }
  raw(buf: ArrayLike<number>) { for (let i = 0; i < buf.length; i++) this.arr.push(buf[i] & 0xff); return this; }
  text(s: string) {
    // La NT311 corrompe bytes altos -> plegamos acentos a ASCII. El € va en 0xD5.
    const fold: Record<string, string> = { 'á':'a','à':'a','ä':'a','é':'e','è':'e','ë':'e','í':'i','ì':'i','ï':'i','ó':'o','ò':'o','ö':'o','ú':'u','ù':'u','ü':'u','ñ':'n','ç':'c','Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U','Ñ':'N','Ü':'U','¿':'?','¡':'!','·':'-','»':'>','«':'<','ª':'a','º':'o','–':'-','—':'-','“':'"','”':'"','‘':"'",'’':"'",'⚠':'!','✂':'' };
    const str = s || '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '€') { this.arr.push(0xD5); continue; }
      const f = fold[ch] !== undefined ? fold[ch] : ch;
      for (let j = 0; j < f.length; j++) {
        const c = f.charCodeAt(j);
        this.arr.push(c < 128 ? c : 0x3f);
      }
    }
    return this;
  }
  build(): Uint8Array { return Uint8Array.from(this.arr); }
}

const init       = (b: Bytes) => { b.push(ESC, 0x40); };
const lf         = (b: Bytes, n = 1) => { for (let i = 0; i < n; i++) b.push(LF); return b; };
const alignLeft  = (b: Bytes) => b.push(ESC, 0x61, 0);
const alignCtr   = (b: Bytes) => b.push(ESC, 0x61, 1);
const alignRight = (b: Bytes) => b.push(ESC, 0x61, 2);
const boldOn     = (b: Bytes) => b.push(ESC, 0x45, 1);
const boldOff    = (b: Bytes) => b.push(ESC, 0x45, 0);
const reverseOn  = (b: Bytes) => b.push(GS, 0x42, 1);
const reverseOff = (b: Bytes) => b.push(GS, 0x42, 0);
const sizeFor    = (b: Bytes, s: number) => {
  if (s >= 4) b.push(GS, 0x21, 0x33);
  else if (s === 3) b.push(GS, 0x21, 0x22);
  else if (s === 2) b.push(GS, 0x21, 0x11);
  else b.push(GS, 0x21, 0x00);
};
const sizeNormal = (b: Bytes) => b.push(GS, 0x21, 0x00);
const cut        = (b: Bytes) => { lf(b, 4); b.push(GS, 0x56, 1); };

function qr(b: Bytes, data: string, moduleSize = 6) {
  const store = new TextEncoder().encode(data || '');
  const len = store.length + 3;
  const pL = len & 0xff, pH = (len >> 8) & 0xff;
  b.push(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0);
  b.push(GS, 0x28, 0x6b, 3, 0, 49, 67, moduleSize);
  b.push(GS, 0x28, 0x6b, 3, 0, 49, 69, 49);
  b.push(GS, 0x28, 0x6b, pL, pH, 49, 80, 48);
  for (let i = 0; i < store.length; i++) b.push(store[i]);
  b.push(GS, 0x28, 0x6b, 3, 0, 49, 81, 48);
}

function rasterImage(b: Bytes, width: number, height: number, data: ArrayLike<number>) {
  const widthBytes = Math.ceil(width / 8);
  const xL = widthBytes & 0xff, xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff, yH = (height >> 8) & 0xff;
  b.push(GS, 0x76, 0x30, 0, xL, xH, yL, yH);
  b.raw(data);
}

const WIDTH_CHARS = 48;

function rowLine(left?: string, right?: string, cols = WIDTH_CHARS) {
  left = left ?? ''; right = right ?? '';
  const space = Math.max(1, cols - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

export function renderDoc(doc: TicketDoc): Uint8Array {
  const b = new Bytes();
  init(b);
  alignLeft(b);

  for (const blk of doc.blocks) {
    switch (blk.kind) {
      case 'logo': {
        if (blk.data && blk.width && blk.height) {
          alignCtr(b);
          rasterImage(b, blk.width, blk.height, blk.data);
          lf(b);
          alignLeft(b);
        }
        break;
      }
      case 'text': {
        if (blk.align === 'center') alignCtr(b); else if (blk.align === 'right') alignRight(b); else alignLeft(b);
        sizeFor(b, blk.size || 1);
        if (blk.bold) boldOn(b);
        b.text(blk.text); lf(b);
        if (blk.bold) boldOff(b);
        sizeNormal(b); alignLeft(b);
        break;
      }
      case 'row': {
        alignLeft(b);
        if (blk.bold) boldOn(b);
        b.text(rowLine(blk.left, blk.right)); lf(b);
        if (blk.bold) boldOff(b);
        break;
      }
      case 'priceRow': {
        alignLeft(b);
        const fits = (l: string, r: string) => (l.length + r.length + 1) <= WIDTH_CHARS;
        const emit = (l: string, r: string, bold?: boolean) => {
          if (bold) boldOn(b);
          if (fits(l, r)) { b.text(rowLine(l, r)); lf(b); }
          else { b.text(l); lf(b); alignRight(b); b.text(r); lf(b); alignLeft(b); }
          if (bold) boldOff(b);
        };
        if (blk.original != null && blk.original !== blk.final) {
          emit(blk.label, blk.original, true);
          emit('  ' + (blk.discountLabel || 'Descuento'), blk.final, true);
        } else {
          emit(blk.label, blk.final, true);
        }
        break;
      }
      case 'cols': {
        alignLeft(b);
        if (blk.bold) boldOn(b);
        const parts = blk.parts || [];
        const w = Math.floor(WIDTH_CHARS / parts.length);
        let line = '';
        parts.forEach((p: any, i: number) => {
          const s = String(p ?? '');
          line += i === 0 ? s.padEnd(w) : s.padStart(w);
        });
        b.text(line.slice(0, WIDTH_CHARS)); lf(b);
        if (blk.bold) boldOff(b);
        break;
      }
      case 'banner': {
        alignCtr(b); boldOn(b);
        sizeFor(b, (blk.text || '').length <= 12 ? 3 : 2);
        b.text(blk.text || ''); lf(b);
        sizeNormal(b); boldOff(b); alignLeft(b);
        break;
      }
      case 'invertBanner': {
        const txt = ' ' + (blk.text || '') + ' ';
        alignCtr(b);
        reverseOn(b); boldOn(b);
        sizeFor(b, blk.size || 3);
        b.text(txt); lf(b);
        sizeNormal(b); boldOff(b); reverseOff(b); alignLeft(b);
        break;
      }
      case 'box': {
        alignLeft(b);
        b.text('='.repeat(WIDTH_CHARS)); lf(b);
        for (const line of (blk.lines || [])) {
          boldOn(b); sizeFor(b, blk.size || 2); b.text(line); lf(b); sizeNormal(b); boldOff(b);
        }
        b.text('='.repeat(WIDTH_CHARS)); lf(b);
        break;
      }
      case 'rule': {
        alignLeft(b);
        b.text((blk.dashed ? '-' : '=').repeat(WIDTH_CHARS)); lf(b);
        break;
      }
      case 'space': lf(b, blk.lines ?? 1); break;
      case 'qr': {
        alignCtr(b);
        qr(b, blk.data ?? '', blk.size === 'sm' ? 4 : 7);
        lf(b);
        if (blk.caption) { boldOn(b); b.text(blk.caption); lf(b); boldOff(b); }
        alignLeft(b);
        break;
      }
      case 'cut': cut(b); break;
      default: break;
    }
  }
  const last = doc.blocks[doc.blocks.length - 1];
  if (!last || last.kind !== 'cut') cut(b);
  return b.build();
}
