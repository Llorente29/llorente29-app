// supabase/functions/_shared/imagenAPdf.ts
//
// D02 · Imagen a PDF en el servidor (Julio, 22/10). Toda factura recibida que
// llega como foto (JPG o PNG) tiene su PDF desde que entra, la convierta quien
// la convierta: correo, OCR, subida o la foto de la recepción. Aquí está solo
// la conversión, sin red ni base, para probarla con las fotos inventadas de
// tests/conta/d01 y servirla igual en Deno (la función) que en Node (vitest).
//
// Lo mismo que hace el front con jsPDF (src/modules/conta/lib/fotoAPdf.ts),
// página a página: A4 con la foto entera, sin recortar ni deformar, ajustada
// al ancho o al alto con 10 mm de margen y centrada; una foto apaisada, en
// página apaisada. Una página por foto, en su orden.
//
// Dos cosas que el front no hace y aquí sí:
//   · la ORIENTACIÓN EXIF de un JPG de móvil (casi todas vienen giradas en el
//     fichero y derechas en pantalla): se gira con la matriz de la página, sin
//     tocar los bytes de la foto;
//   · un PNG con transparencia o con paleta se pasa a RGB con su máscara.
//
// El JPG va dentro tal cual (DCTDecode): sin descomprimir ni perder calidad.
// El PNG de 8 bits en gris o RGB, también tal cual (FlateDecode con su
// predictor); los demás se descomprimen, se desfiltran y se vuelven a
// comprimir. Un PNG entrelazado, un HEIC o cualquier otra cosa no se convierte:
// se dice qué es, y lo apunta quien llama.

/** Lo que sabe convertir. */
export type TipoImagen = 'image/jpeg' | 'image/png'

/** Por los primeros bytes, no por el nombre ni por lo que diga el almacén. */
export function tipoDeImagen(b: Uint8Array): TipoImagen | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  return null
}

/** ¿Qué es, si no es una foto que sepa convertir? En palabras, para el motivo. */
export function queEs(b: Uint8Array): string {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'un PDF'
  if (b.length > 12 && String.fromCharCode(...b.slice(4, 8)) === 'ftyp') {
    const marca = String.fromCharCode(...b.slice(8, 12))
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(marca)) return 'una foto HEIC (la de los iPhone)'
    return `un fichero «${marca.trim()}»`
  }
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'una foto WEBP'
  if (b.length > 4 && ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) return 'una foto TIFF'
  if (!b.length) return 'un fichero vacío'
  return 'un fichero que no es JPG ni PNG'
}

// ── El JPG ──────────────────────────────────────────────────────────────────

export interface Jpeg { ancho: number; alto: number; componentes: 1 | 3 | 4; adobe: boolean; orientacion: number }

/** Tamaño, color y orientación EXIF de un JPG, sin descomprimirlo. */
export function leerJpeg(b: Uint8Array): Jpeg {
  if (tipoDeImagen(b) !== 'image/jpeg') throw new Error('no es un JPG')
  let i = 2, orientacion = 1, adobe = false
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('el JPG está roto (falta un marcador)')
    const m = b[i + 1]
    if (m === 0xff) { i++; continue }                 // relleno
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
    if (m === 0xd9 || m === 0xda) break               // fin, o empiezan los datos sin haber visto el tamaño
    const largo = (b[i + 2] << 8) | b[i + 3]
    if (largo < 2 || i + 2 + largo > b.length) throw new Error('el JPG está roto (un segmento se sale)')
    const s = i + 4
    if (m === 0xe1 && largo > 8 && String.fromCharCode(...b.slice(s, s + 4)) === 'Exif' && b[s + 4] === 0 && b[s + 5] === 0) {
      orientacion = orientacionExif(b.subarray(s + 6, i + 2 + largo)) ?? orientacion
    } else if (m === 0xee && largo >= 7 && String.fromCharCode(...b.slice(s, s + 5)) === 'Adobe') {
      adobe = true
    } else if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (m === 0xc3 || m === 0xc7 || m === 0xcb || m === 0xcf) throw new Error('el JPG es sin pérdida (un tipo que los PDF no leen)')
      const alto = (b[s + 1] << 8) | b[s + 2]
      const ancho = (b[s + 3] << 8) | b[s + 4]
      const c = b[s + 5]
      if (!(ancho > 0 && alto > 0)) throw new Error('el JPG no dice su tamaño')
      if (c !== 1 && c !== 3 && c !== 4) throw new Error(`el JPG tiene ${c} canales de color`)
      return { ancho, alto, componentes: c as 1 | 3 | 4, adobe, orientacion: orientacionValida(orientacion) }
    }
    i += 2 + largo
  }
  throw new Error('el JPG no dice su tamaño')
}

function orientacionValida(o: number): number { return Number.isInteger(o) && o >= 1 && o <= 8 ? o : 1 }

/** La etiqueta 0x0112 del primer directorio de un TIFF (el EXIF). */
function orientacionExif(t: Uint8Array): number | null {
  if (t.length < 8) return null
  const le = t[0] === 0x49 && t[1] === 0x49
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : -1)
  const u32 = (o: number) => (o + 4 <= t.length ? (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 0x1000000 : t[o] * 0x1000000 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3])) : -1)
  if (u16(2) !== 42) return null
  const ifd = u32(4)
  const n = u16(ifd)
  if (ifd < 0 || n < 0) return null
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v > 0 ? v : null }
  }
  return null
}

// ── El PNG ──────────────────────────────────────────────────────────────────

export interface Png { ancho: number; alto: number; profundidad: number; color: number; entrelazado: boolean; paleta: Uint8Array | null; trns: Uint8Array | null; datos: Uint8Array }

/** Los trozos de un PNG que hacen falta, sin descomprimir. */
export function leerPng(b: Uint8Array): Png {
  if (tipoDeImagen(b) !== 'image/png') throw new Error('no es un PNG')
  let i = 8, ihdr: Uint8Array | null = null, paleta: Uint8Array | null = null, trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (i + 8 <= b.length) {
    const largo = ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])
    const tipo = String.fromCharCode(...b.slice(i + 4, i + 8))
    if (i + 12 + largo > b.length) throw new Error('el PNG está roto (un trozo se sale)')
    const d = b.subarray(i + 8, i + 8 + largo)
    if (tipo === 'IHDR') ihdr = d
    else if (tipo === 'PLTE') paleta = d
    else if (tipo === 'tRNS') trns = d
    else if (tipo === 'IDAT') idat.push(d)
    else if (tipo === 'IEND') break
    i += 12 + largo
  }
  if (!ihdr || ihdr.length < 13) throw new Error('el PNG no dice su tamaño')
  const ancho = ((ihdr[0] << 24) >>> 0) + ((ihdr[1] << 16) | (ihdr[2] << 8) | ihdr[3])
  const alto = ((ihdr[4] << 24) >>> 0) + ((ihdr[5] << 16) | (ihdr[6] << 8) | ihdr[7])
  const profundidad = ihdr[8], color = ihdr[9]
  if (!(ancho > 0 && alto > 0)) throw new Error('el PNG no dice su tamaño')
  const validas: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
  if (!validas[color]?.includes(profundidad)) throw new Error(`el PNG es de un tipo que no existe (color ${color}, ${profundidad} bits)`)
  if (color === 3 && !paleta) throw new Error('el PNG de paleta no trae su paleta')
  if (!idat.length) throw new Error('el PNG no trae la imagen')
  return { ancho, alto, profundidad, color, entrelazado: ihdr[12] === 1, paleta, trns, datos: unir(idat) }
}

const CANALES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** ¿Va dentro tal cual? Gris o RGB de 8 bits, sin transparencia ni entrelazado. */
export function pngTalCual(p: Png): boolean {
  return !p.entrelazado && p.profundidad === 8 && (p.color === 0 || p.color === 2) && !p.trns
}

/** Desfiltra un PNG (ya descomprimido) y lo deja en 8 bits: color (1 o 3 canales) y, si la hay, transparencia. */
export function pngA8Bits(p: Png, crudo: Uint8Array): { colores: 1 | 3; color: Uint8Array; alfa: Uint8Array | null } {
  if (p.entrelazado) throw new Error('el PNG está entrelazado y no sé convertirlo')
  const canales = CANALES[p.color]
  const bitsPixel = canales * p.profundidad
  const bpp = Math.max(1, bitsPixel >> 3)
  const fila = Math.ceil((p.ancho * bitsPixel) / 8)
  if (crudo.length < (fila + 1) * p.alto) throw new Error('el PNG está cortado')
  const lineas = new Uint8Array(fila * p.alto)
  let previa = new Uint8Array(fila)
  for (let y = 0; y < p.alto; y++) {
    const filtro = crudo[y * (fila + 1)]
    const src = crudo.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1))
    const out = lineas.subarray(y * fila, (y + 1) * fila)
    for (let x = 0; x < fila; x++) {
      const a = x >= bpp ? out[x - bpp] : 0, b = previa[x], c = x >= bpp ? previa[x - bpp] : 0
      let v = src[x]
      if (filtro === 1) v += a
      else if (filtro === 2) v += b
      else if (filtro === 3) v += (a + b) >> 1
      else if (filtro === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      else if (filtro !== 0) throw new Error(`el PNG tiene un filtro que no existe (${filtro})`)
      out[x] = v & 0xff
    }
    previa = out
  }
  const n = p.ancho * p.alto
  const gris = p.color === 0 || p.color === 4
  const colores: 1 | 3 = gris ? 1 : 3
  const color = new Uint8Array(n * colores)
  let alfa: Uint8Array | null = p.color === 4 || p.color === 6 || p.trns ? new Uint8Array(n).fill(255) : null
  const muestra = (y: number, k: number): number => {   // la k-ésima muestra de la fila y, en su profundidad
    const base = y * fila
    if (p.profundidad === 8) return lineas[base + k]
    if (p.profundidad === 16) return lineas[base + 2 * k]   // el byte alto
    const porByte = 8 / p.profundidad, byte = lineas[base + Math.floor(k / porByte)]
    const desp = 8 - p.profundidad * ((k % porByte) + 1)
    return (byte >> desp) & ((1 << p.profundidad) - 1)
  }
  const muestraEntera = (y: number, k: number): number => (p.profundidad === 16 ? (lineas[y * fila + 2 * k] << 8) | lineas[y * fila + 2 * k + 1] : muestra(y, k))
  const escala = p.profundidad < 8 ? 255 / ((1 << p.profundidad) - 1) : 1
  for (let y = 0; y < p.alto; y++) {
    for (let x = 0; x < p.ancho; x++) {
      const i = y * p.ancho + x
      if (p.color === 3) {
        const idx = muestra(y, x)
        if (3 * idx + 2 >= p.paleta!.length) throw new Error('el PNG usa un color que no está en su paleta')
        color[3 * i] = p.paleta![3 * idx]; color[3 * i + 1] = p.paleta![3 * idx + 1]; color[3 * i + 2] = p.paleta![3 * idx + 2]
        if (alfa && p.trns && idx < p.trns.length) alfa[i] = p.trns[idx]
      } else if (gris) {
        const g = muestra(y, x * canales)
        color[i] = Math.round(g * escala)
        if (p.color === 4) alfa![i] = muestra(y, x * canales + 1)
        else if (alfa && p.trns && p.trns.length >= 2 && muestraEntera(y, x) === ((p.trns[0] << 8) | p.trns[1])) alfa[i] = 0
      } else {
        for (let k = 0; k < 3; k++) color[3 * i + k] = muestra(y, x * canales + k)
        if (p.color === 6) alfa![i] = muestra(y, x * canales + 3)
        else if (alfa && p.trns && p.trns.length >= 6) {
          const igual = [0, 1, 2].every((k) => muestraEntera(y, x * canales + k) === ((p.trns![2 * k] << 8) | p.trns![2 * k + 1]))
          if (igual) alfa[i] = 0
        }
      }
    }
  }
  if (alfa && alfa.every((v) => v === 255)) alfa = null
  return { colores, color, alfa }
}

// ── La página ───────────────────────────────────────────────────────────────

/** A4 en puntos (1 mm = 72/25,4 pt) y el margen de 10 mm, como el front. */
export const A4_PT = { ancho: 595.2756, alto: 841.8898 }
export const MARGEN_PT = (10 * 72) / 25.4

/** El tamaño con el que se VE la foto: con la orientación 5 a 8, ancho y alto se cambian. */
export function tamanoVisto(ancho: number, alto: number, orientacion: number): { ancho: number; alto: number } {
  return orientacion >= 5 && orientacion <= 8 ? { ancho: alto, alto: ancho } : { ancho, alto }
}

/** Dónde va la foto en la página (puntos), con el mismo cálculo que el front (en mm). */
export function encajePt(anchoPx: number, altoPx: number): { apaisada: boolean; pw: number; ph: number; x: number; y: number; w: number; h: number } {
  if (!(anchoPx > 0 && altoPx > 0)) throw new Error('la foto no tiene tamaño')
  const apaisada = anchoPx > altoPx
  const pw = apaisada ? A4_PT.alto : A4_PT.ancho
  const ph = apaisada ? A4_PT.ancho : A4_PT.alto
  const escala = Math.min((pw - 2 * MARGEN_PT) / anchoPx, (ph - 2 * MARGEN_PT) / altoPx)
  const w = anchoPx * escala, h = altoPx * escala
  return { apaisada, pw, ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h }
}

/**
 * La matriz que pinta la foto, tal como está guardada, derecha en el hueco
 * (x, y, w, h) de la página. [a b c d e f]: un punto (u, v) de la foto
 * (0..1, v = 1 arriba) cae en (a·u + c·v + e, b·u + d·v + f).
 */
export function matriz(orientacion: number, r: { x: number; y: number; w: number; h: number }): [number, number, number, number, number, number] {
  const { x, y, w, h } = r
  switch (orientacionValida(orientacion)) {
    case 2: return [-w, 0, 0, h, x + w, y]          // espejo horizontal
    case 3: return [-w, 0, 0, -h, x + w, y + h]     // girada 180°
    case 4: return [w, 0, 0, -h, x, y + h]          // espejo vertical
    case 5: return [0, -h, -w, 0, x + w, y + h]     // traspuesta
    case 6: return [0, -h, w, 0, x, y + h]          // hay que girarla 90° a la derecha
    case 7: return [0, h, w, 0, x, y]               // traspuesta al revés
    case 8: return [0, h, -w, 0, x + w, y]          // hay que girarla 90° a la izquierda
    default: return [w, 0, 0, h, x, y]
  }
}

// ── El PDF ──────────────────────────────────────────────────────────────────

export interface Foto { bytes: Uint8Array }
export interface PdfHecho { pdf: Uint8Array; paginas: number; giradas: number }

const texto = (s: string) => new TextEncoder().encode(s)
function unir(partes: Uint8Array[]): Uint8Array {
  const n = partes.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of partes) { out.set(p, o); o += p.length }
  return out
}
const num = (v: number) => (Math.abs(v) < 1e-9 ? '0' : Number(v.toFixed(4)).toString())

async function porStream(datos: Uint8Array, s: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> {
  const escritor = s.writable.getWriter()
  // Si los datos están rotos, el error sale por el lector (abajo); aquí no se deja suelto.
  escritor.write(datos).then(() => escritor.close()).catch(() => undefined)
  const partes: Uint8Array[] = []
  const lector = s.readable.getReader()
  for (;;) { const { done, value } = await lector.read(); if (done) break; partes.push(value) }
  return unir(partes)
}
/** zlib (lo que guarda el PNG y lo que lee FlateDecode). */
export const inflar = (d: Uint8Array) => porStream(d, new DecompressionStream('deflate'))
export const desinflar = (d: Uint8Array) => porStream(d, new CompressionStream('deflate'))

interface Objeto { dic: string; flujo?: Uint8Array }

/** Una o varias fotos (JPG o PNG), una por página y en su orden, como un PDF. */
export async function fotosAPdf(fotos: Foto[]): Promise<PdfHecho> {
  if (!fotos.length) throw new Error('no hay ninguna foto')
  // 1 catálogo, 2 páginas; luego, por foto: página, contenido, imagen y (si hay) su máscara.
  const objetos: Objeto[] = [{ dic: '<< /Type /Catalog /Pages 2 0 R >>' }, { dic: '' }]
  const paginas: number[] = []
  let giradas = 0
  for (const [k, f] of fotos.entries()) {
    const tipo = tipoDeImagen(f.bytes)
    if (!tipo) throw new Error(`la foto ${k + 1} es ${queEs(f.bytes)} y solo sé convertir JPG y PNG`)
    let ancho: number, alto: number, orientacion = 1
    let imagen: Objeto, mascara: Objeto | null = null
    if (tipo === 'image/jpeg') {
      const j = leerJpeg(f.bytes)
      ancho = j.ancho; alto = j.alto; orientacion = j.orientacion
      const espacio = j.componentes === 1 ? '/DeviceGray' : j.componentes === 3 ? '/DeviceRGB' : '/DeviceCMYK'
      // Un CMYK de Adobe (Photoshop) guarda las tintas al revés.
      const decode = j.componentes === 4 && j.adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : ''
      imagen = { dic: `<< /Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} /ColorSpace ${espacio} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${f.bytes.length} >>`, flujo: f.bytes }
    } else {
      const p = leerPng(f.bytes)
      ancho = p.ancho; alto = p.alto
      if (pngTalCual(p)) {
        const colores = p.color === 0 ? 1 : 3
        imagen = { dic: `<< /Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} /ColorSpace ${colores === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colores} /BitsPerComponent 8 /Columns ${ancho} >> /Length ${p.datos.length} >>`, flujo: p.datos }
      } else {
        if (p.entrelazado) throw new Error(`la foto ${k + 1} es un PNG entrelazado y no sé convertirlo`)
        const ocho = pngA8Bits(p, await inflar(p.datos))
        const c = await desinflar(ocho.color)
        imagen = { dic: '', flujo: c }
        let smask = ''
        if (ocho.alfa) {
          const a = await desinflar(ocho.alfa)
          mascara = { dic: `<< /Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${a.length} >>`, flujo: a }
          smask = ` /SMask ${objetos.length + 4} 0 R`
        }
        imagen.dic = `<< /Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} /ColorSpace ${ocho.colores === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode${smask} /Length ${c.length} >>`
      }
    }
    if (orientacion !== 1) giradas++
    const visto = tamanoVisto(ancho, alto, orientacion)
    const e = encajePt(visto.ancho, visto.alto)
    const m = matriz(orientacion, e).map(num).join(' ')
    const pagina = objetos.length + 1, contenido = pagina + 1, img = pagina + 2
    const flujo = texto(`q ${m} cm /F${k + 1} Do Q\n`)
    objetos.push({ dic: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(e.pw)} ${num(e.ph)}] /Resources << /XObject << /F${k + 1} ${img} 0 R >> >> /Contents ${contenido} 0 R >>` })
    objetos.push({ dic: `<< /Length ${flujo.length} >>`, flujo })
    objetos.push(imagen)
    if (mascara) objetos.push(mascara)
    paginas.push(pagina)
  }
  objetos[1] = { dic: `<< /Type /Pages /Kids [${paginas.map((p) => `${p} 0 R`).join(' ')}] /Count ${paginas.length} >>` }

  // La cabecera y una línea con bytes altos: así nadie lo toma por texto.
  const partes: Uint8Array[] = [texto('%PDF-1.4\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  let largo = partes[0].length + partes[1].length
  const desplazamientos: number[] = []
  for (const [i, o] of objetos.entries()) {
    desplazamientos.push(largo)
    const trozo = o.flujo
      ? unir([texto(`${i + 1} 0 obj\n${o.dic}\nstream\n`), o.flujo, texto('\nendstream\nendobj\n')])
      : texto(`${i + 1} 0 obj\n${o.dic}\nendobj\n`)
    partes.push(trozo); largo += trozo.length
  }
  const xref = [`xref\n0 ${objetos.length + 1}\n`, '0000000000 65535 f \n', ...desplazamientos.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`)].join('')
  partes.push(texto(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${largo}\n%%EOF\n`))
  return { pdf: unir(partes), paginas: paginas.length, giradas }
}
