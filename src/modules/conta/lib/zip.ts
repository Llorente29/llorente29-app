// src/modules/conta/lib/zip.ts
//
// C05 · Un .zip sin compresión («stored», APPNOTE 4.4.5 método 0) para los
// documentos de un requerimiento de la AEAT. Los documentos ya vienen
// comprimidos (PDF, JPG): comprimir otra vez no gana nada y obligaría a meter
// una dependencia. Puro: entra una lista de ficheros, sale un Uint8Array.

export interface FicheroZip { nombre: string; datos: Uint8Array }

let tabla: Uint32Array | null = null
function tablaCrc(): Uint32Array {
  if (tabla) return tabla
  tabla = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[n] = c >>> 0
  }
  return tabla
}

export function crc32(d: Uint8Array): number {
  const t = tablaCrc()
  let c = 0xffffffff
  for (let i = 0; i < d.length; i++) c = t[(c ^ d[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Nombres únicos dentro del zip: «factura.pdf», «factura (2).pdf»… */
export function nombresUnicos(nombres: string[]): string[] {
  const vistos = new Map<string, number>()
  return nombres.map((n) => {
    const limpio = n.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'documento'
    const k = limpio.toLowerCase()
    const veces = (vistos.get(k) ?? 0) + 1
    vistos.set(k, veces)
    if (veces === 1) return limpio
    const punto = limpio.lastIndexOf('.')
    return punto > 0 ? `${limpio.slice(0, punto)} (${veces})${limpio.slice(punto)}` : `${limpio} (${veces})`
  })
}

export function crearZip(ficheros: FicheroZip[]): Uint8Array {
  const enc = new TextEncoder()
  const locales: Uint8Array[] = []
  const centrales: Uint8Array[] = []
  let desplazamiento = 0
  for (const f of ficheros) {
    const nombre = enc.encode(f.nombre)
    const crc = crc32(f.datos)
    const local = new Uint8Array(30 + nombre.length)
    const v = new DataView(local.buffer)
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true) // UTF-8
    v.setUint16(8, 0, true); v.setUint16(10, 0, true); v.setUint16(12, 0x21, true) // 1980-01-01
    v.setUint32(14, crc, true); v.setUint32(18, f.datos.length, true); v.setUint32(22, f.datos.length, true)
    v.setUint16(26, nombre.length, true); v.setUint16(28, 0, true)
    local.set(nombre, 30)
    const central = new Uint8Array(46 + nombre.length)
    const w = new DataView(central.buffer)
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true)
    w.setUint16(10, 0, true); w.setUint16(12, 0, true); w.setUint16(14, 0x21, true)
    w.setUint32(16, crc, true); w.setUint32(20, f.datos.length, true); w.setUint32(24, f.datos.length, true)
    w.setUint16(28, nombre.length, true); w.setUint32(42, desplazamiento, true)
    central.set(nombre, 46)
    locales.push(local, f.datos)
    centrales.push(central)
    desplazamiento += local.length + f.datos.length
  }
  const tamCentral = centrales.reduce((a, c) => a + c.length, 0)
  const fin = new Uint8Array(22)
  const e = new DataView(fin.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, ficheros.length, true); e.setUint16(10, ficheros.length, true)
  e.setUint32(12, tamCentral, true); e.setUint32(16, desplazamiento, true)
  const total = new Uint8Array(desplazamiento + tamCentral + 22)
  let p = 0
  for (const b of [...locales, ...centrales, fin]) { total.set(b, p); p += b.length }
  return total
}
