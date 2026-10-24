// D02 · Imagen a PDF en el servidor (_shared/imagenAPdf.ts). Con las fotos
// inventadas de la prueba de lectura (tests/conta/d01/facturas-inventadas) y
// PNG hechos aquí, de cada tipo. El PDF se abre con pdf.js, como lo abriría
// cualquiera: si pdf.js no lo lee, no es un PDF.
import { readFileSync } from 'node:fs'
import { zlibSync } from 'fflate'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { A4_PT, MARGEN_PT, encajePt, fotosAPdf, inflar, leerJpeg, leerPng, matriz, pngA8Bits, pngTalCual, queEs, tamanoVisto, tipoDeImagen } from '../../../supabase/functions/_shared/imagenAPdf'
import { encaje } from '../../../src/modules/conta/lib/fotoAPdf'

const DIR = 'tests/conta/d01/facturas-inventadas'
const foto = (f: string) => new Uint8Array(readFileSync(`${DIR}/${f}`))
const MM = 72 / 25.4

async function abrir(pdf: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: pdf.slice(), isEvalSupported: false, useSystemFonts: false }).promise
  const paginas = []
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i)
    const ops = await p.getOperatorList()
    paginas.push({ vista: p.view.map((v: number) => Math.round(v)), imagenes: ops.fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject).length })
  }
  return { n: doc.numPages, paginas }
}

/** Mete un EXIF con esa orientación detrás del SOI de un JPG (como lo guarda un móvil). */
function conOrientacion(jpg: Uint8Array, o: number, le = true): Uint8Array {
  const tiff = le
    ? [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]
    : [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const seg = [0xff, 0xe1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff, ...exif]
  return new Uint8Array([...jpg.slice(0, 2), ...seg, ...jpg.slice(2)])
}

// ── PNG hechos aquí ─────────────────────────────────────────────────────────
const crc = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
})()
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
function trozo(tipo: string, d: Uint8Array): number[] {
  const td = new Uint8Array([...new TextEncoder().encode(tipo), ...d])
  return [...u32(d.length), ...td, ...u32(crc(td))]
}
/** Un PNG con estas filas YA filtradas (cada fila empieza por su byte de filtro). */
function png(o: { ancho: number; alto: number; profundidad: number; color: number; filas: number[][]; paleta?: number[]; trns?: number[]; entrelazado?: boolean }): Uint8Array {
  const ihdr = new Uint8Array([...u32(o.ancho), ...u32(o.alto), o.profundidad, o.color, 0, 0, o.entrelazado ? 1 : 0])
  const datos = zlibSync(new Uint8Array(o.filas.flat()))
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...trozo('IHDR', ihdr),
    ...(o.paleta ? trozo('PLTE', new Uint8Array(o.paleta)) : []),
    ...(o.trns ? trozo('tRNS', new Uint8Array(o.trns)) : []),
    ...trozo('IDAT', datos), ...trozo('IEND', new Uint8Array())])
}

describe('qué es cada fichero', () => {
  it('JPG y PNG por sus primeros bytes; lo demás se dice qué es', () => {
    expect(tipoDeImagen(foto('f09-torcida.jpg'))).toBe('image/jpeg')
    expect(tipoDeImagen(png({ ancho: 1, alto: 1, profundidad: 8, color: 0, filas: [[0, 7]] }))).toBe('image/png')
    expect(tipoDeImagen(foto('f01-mercancia.pdf'))).toBeNull()
    expect(queEs(foto('f01-mercancia.pdf'))).toBe('un PDF')
    expect(queEs(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]))).toMatch(/HEIC/)
    expect(queEs(new Uint8Array())).toBe('un fichero vacío')
  })
})

describe('el JPG', () => {
  it('las dos fotos inventadas: 1800 × 2400, RGB, derechas', () => {
    for (const f of ['f09-torcida.jpg', 'f10-borrosa.jpg']) expect(leerJpeg(foto(f))).toEqual({ ancho: 1800, alto: 2400, componentes: 3, adobe: false, orientacion: 1 })
  })
  it('la orientación del EXIF, en los dos órdenes de bytes', () => {
    expect(leerJpeg(conOrientacion(foto('f09-torcida.jpg'), 6)).orientacion).toBe(6)
    expect(leerJpeg(conOrientacion(foto('f09-torcida.jpg'), 8, false)).orientacion).toBe(8)
    expect(leerJpeg(conOrientacion(foto('f09-torcida.jpg'), 99)).orientacion).toBe(1)
  })
  it('un JPG cortado antes de decir su tamaño no se convierte', () => {
    expect(() => leerJpeg(foto('f09-torcida.jpg').slice(0, 20))).toThrow(/JPG/)
  })
})

describe('la página, como el front', () => {
  it('el hueco de la foto es el del front (fotoAPdf.ts), en puntos', () => {
    for (const [w, h] of [[1800, 2400], [3000, 1000], [800, 4000], [1000, 1000]]) {
      const f = encaje(w, h), s = encajePt(w, h)
      expect(s.apaisada).toBe(f.orientacion === 'apaisada')
      for (const k of ['x', 'y', 'w', 'h'] as const) expect(s[k]).toBeCloseTo(f[k] * MM, 3)
    }
    expect(MARGEN_PT).toBeCloseTo(10 * MM, 6)
  })
  it('cada orientación lleva las esquinas de la foto a su sitio', () => {
    const r = { x: 10, y: 20, w: 100, h: 200 }
    const punto = (o: number, u: number, v: number) => { const [a, b, c, d, e, f] = matriz(o, r); return [a * u + c * v + e, b * u + d * v + f] }
    // (u, v) de la foto guardada: (0, 1) es su esquina de arriba a la izquierda.
    expect(punto(1, 0, 1)).toEqual([10, 220])
    expect(punto(3, 0, 1)).toEqual([110, 20])        // 180°: abajo a la derecha
    expect(punto(6, 0, 1)).toEqual([110, 220])       // 90° a la derecha: arriba a la derecha
    expect(punto(6, 0, 0)).toEqual([10, 220])        // su primera columna de abajo, arriba
    expect(punto(8, 0, 1)).toEqual([10, 20])         // 90° a la izquierda: abajo a la izquierda
    expect(punto(2, 0, 1)).toEqual([110, 220])
    expect(punto(4, 0, 1)).toEqual([10, 20])
    expect(punto(5, 0, 1)).toEqual([10, 220])
    expect(punto(7, 0, 1)).toEqual([110, 20])
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const xs = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => punto(o, u, v))
      expect(Math.min(...xs.map((p) => p[0]))).toBe(10); expect(Math.max(...xs.map((p) => p[0]))).toBe(110)
      expect(Math.min(...xs.map((p) => p[1]))).toBe(20); expect(Math.max(...xs.map((p) => p[1]))).toBe(220)
    }
    expect(tamanoVisto(1800, 2400, 6)).toEqual({ ancho: 2400, alto: 1800 })
    expect(tamanoVisto(1800, 2400, 3)).toEqual({ ancho: 1800, alto: 2400 })
  })
})

describe('el PDF', () => {
  it('la foto torcida, un A4 vertical con la foto dentro tal cual', async () => {
    const f = foto('f09-torcida.jpg')
    const r = await fotosAPdf([{ bytes: f }])
    expect(new TextDecoder().decode(r.pdf.slice(0, 8))).toBe('%PDF-1.4')
    expect(r).toMatchObject({ paginas: 1, giradas: 0 })
    const a = await abrir(r.pdf)
    expect(a).toEqual({ n: 1, paginas: [{ vista: [0, 0, Math.round(A4_PT.ancho), Math.round(A4_PT.alto)], imagenes: 1 }] })
    // Los bytes de la foto, dentro sin tocar (DCTDecode): no pierde calidad.
    const dentro = Buffer.from(r.pdf).indexOf(Buffer.from(f))
    expect(dentro).toBeGreaterThan(0)
  })
  it('dos fotos, dos páginas en su orden', async () => {
    const r = await fotosAPdf([{ bytes: foto('f09-torcida.jpg') }, { bytes: foto('f10-borrosa.jpg') }])
    expect(r.paginas).toBe(2)
    const a = await abrir(r.pdf)
    expect(a.n).toBe(2)
    const pdf = Buffer.from(r.pdf)
    expect(pdf.indexOf(Buffer.from(foto('f09-torcida.jpg')))).toBeLessThan(pdf.indexOf(Buffer.from(foto('f10-borrosa.jpg'))))
  })
  it('una foto de móvil girada (EXIF 6) sale derecha: página apaisada', async () => {
    const r = await fotosAPdf([{ bytes: conOrientacion(foto('f09-torcida.jpg'), 6) }])
    expect(r.giradas).toBe(1)
    const a = await abrir(r.pdf)
    expect(a.paginas[0]).toEqual({ vista: [0, 0, Math.round(A4_PT.alto), Math.round(A4_PT.ancho)], imagenes: 1 })
  })
  it('un PDF, un HEIC o nada no se convierten, y se dice qué son', async () => {
    await expect(fotosAPdf([])).rejects.toThrow(/ninguna foto/)
    await expect(fotosAPdf([{ bytes: foto('f01-mercancia.pdf') }])).rejects.toThrow('la foto 1 es un PDF y solo sé convertir JPG y PNG')
    await expect(fotosAPdf([{ bytes: foto('f09-torcida.jpg') }, { bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]) }])).rejects.toThrow(/la foto 2 es una foto HEIC/)
  })
})

describe('el PNG', () => {
  // 2 × 2 RGB: rojo, verde / azul, blanco. Fila 0 sin filtro; fila 1 con «Sub».
  const rgb = png({ ancho: 2, alto: 2, profundidad: 8, color: 2, filas: [[0, 255, 0, 0, 0, 255, 0], [1, 0, 0, 255, 255, 1, 0]] })
  it('gris o RGB de 8 bits va dentro tal cual; con transparencia o paleta, no', () => {
    expect(pngTalCual(leerPng(rgb))).toBe(true)
    expect(pngTalCual(leerPng(png({ ancho: 1, alto: 1, profundidad: 8, color: 6, filas: [[0, 1, 2, 3, 4]] })))).toBe(false)
    expect(pngTalCual(leerPng(png({ ancho: 1, alto: 1, profundidad: 4, color: 3, filas: [[0, 0]], paleta: [9, 9, 9] })))).toBe(false)
  })
  it('desfiltra cada filtro (ninguno, Sub, Up, Average, Paeth) a los mismos píxeles', async () => {
    // Los mismos 2 × 2 RGB de arriba, con la fila 1 en cada filtro.
    const p1 = [0, 0, 255, 255, 255, 255]          // la fila 1 sin filtrar
    const p0 = [255, 0, 0, 0, 255, 0]
    const filtrar = (f: number) => p1.map((v, x) => {
      const a = x >= 3 ? p1[x - 3] : 0, b = p0[x], c = x >= 3 ? p0[x - 3] : 0
      const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      return (v - pred + 256) & 0xff
    })
    for (const f of [0, 1, 2, 3, 4]) {
      const p = leerPng(png({ ancho: 2, alto: 2, profundidad: 8, color: 2, filas: [[0, ...p0], [f, ...filtrar(f)]] }))
      const r = pngA8Bits(p, await inflar(p.datos))
      expect(Array.from(r.color), `filtro ${f}`).toEqual([...p0, ...p1])
      expect(r.alfa).toBeNull()
    }
  })
  it('RGBA con transparencia: color y máscara aparte; opaca del todo, sin máscara', async () => {
    const p = leerPng(png({ ancho: 2, alto: 1, profundidad: 8, color: 6, filas: [[0, 10, 20, 30, 255, 40, 50, 60, 0]] }))
    const r = pngA8Bits(p, await inflar(p.datos))
    expect(Array.from(r.color)).toEqual([10, 20, 30, 40, 50, 60])
    expect(Array.from(r.alfa!)).toEqual([255, 0])
    const opaca = leerPng(png({ ancho: 1, alto: 1, profundidad: 8, color: 6, filas: [[0, 1, 2, 3, 255]] }))
    expect(pngA8Bits(opaca, await inflar(opaca.datos)).alfa).toBeNull()
  })
  it('paleta de 4 bits con tRNS, y gris de 16 y de 1 bit', async () => {
    const pal = leerPng(png({ ancho: 3, alto: 1, profundidad: 4, color: 3, filas: [[0, 0x01, 0x20]], paleta: [0, 0, 0, 200, 100, 50, 7, 8, 9], trns: [255, 128] }))
    const r = pngA8Bits(pal, await inflar(pal.datos))
    expect(Array.from(r.color)).toEqual([0, 0, 0, 200, 100, 50, 7, 8, 9])
    expect(Array.from(r.alfa!)).toEqual([255, 128, 255])
    const g16 = leerPng(png({ ancho: 2, alto: 1, profundidad: 16, color: 0, filas: [[0, 0x12, 0x34, 0xff, 0xff]] }))
    expect(Array.from(pngA8Bits(g16, await inflar(g16.datos)).color)).toEqual([0x12, 0xff])
    const g1 = leerPng(png({ ancho: 8, alto: 1, profundidad: 1, color: 0, filas: [[0, 0b10100000]] }))
    expect(Array.from(pngA8Bits(g1, await inflar(g1.datos)).color)).toEqual([255, 0, 255, 0, 0, 0, 0, 0])
  })
  it('cada PNG sale como un PDF que pdf.js abre, con su foto (y su máscara si la lleva)', async () => {
    const casos = [
      rgb,
      png({ ancho: 2, alto: 1, profundidad: 8, color: 6, filas: [[0, 10, 20, 30, 255, 40, 50, 60, 0]] }),
      png({ ancho: 3, alto: 1, profundidad: 4, color: 3, filas: [[0, 0x01, 0x20]], paleta: [0, 0, 0, 200, 100, 50, 7, 8, 9] }),
      png({ ancho: 2, alto: 1, profundidad: 16, color: 0, filas: [[0, 0x12, 0x34, 0xff, 0xff]] }),
    ]
    for (const [k, c] of casos.entries()) {
      const r = await fotosAPdf([{ bytes: c }])
      const a = await abrir(r.pdf)
      expect(a.paginas[0].imagenes, `PNG ${k}`).toBe(1)
      expect(new TextDecoder('latin1').decode(r.pdf).includes('/SMask'), `PNG ${k}`).toBe(k === 1)
    }
  })
  it('un PNG con los datos rotos falla con su error, sin dejar nada suelto', async () => {
    const roto = png({ ancho: 2, alto: 1, profundidad: 8, color: 6, filas: [[0, 10, 20, 30, 255, 40, 50, 60, 0]] })
    const i = Buffer.from(roto).indexOf(Buffer.from('IDAT')) + 6
    roto.fill(0xab, i, i + 4)
    await expect(fotosAPdf([{ bytes: roto }])).rejects.toThrow()
  })
  it('un PNG entrelazado no se convierte, y lo dice', async () => {
    const e = png({ ancho: 1, alto: 1, profundidad: 8, color: 6, filas: [[0, 1, 2, 3, 4]], entrelazado: true })
    await expect(fotosAPdf([{ bytes: e }])).rejects.toThrow('la foto 1 es un PNG entrelazado y no sé convertirlo')
  })
})
