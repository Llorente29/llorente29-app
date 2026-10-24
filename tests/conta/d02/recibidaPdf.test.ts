// D02 · Toda recibida tiene su PDF desde que entra (_shared/recibidaPdf.ts):
// hacer el PDF de las fotos y enlazarlo al asiento validado, contra dobles del
// almacén y de la base. Las fotos son las inventadas de tests/conta/d01; las
// facturas, cuentas y asientos, ids inventados.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enlazarPdfs, hacerPdfs, pasada, rutaDeLaFactura, rutaDelAsiento, type Fichero, type PorEnlazar, type PorHacer, type PuertoPdf } from '../../../supabase/functions/_shared/recibidaPdf'

const DIR = 'tests/conta/d01/facturas-inventadas'
const foto = (f: string) => new Uint8Array(readFileSync(`${DIR}/${f}`))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

interface Doble extends PuertoPdf {
  almacen: Map<string, Uint8Array>
  subidas: string[]
  hechos: { factura: string; ruta: string; sha256: string; bytes: number; paginas: number }[]
  fallos: { factura: string; motivo: string; enlace: boolean }[]
  enlaces: { asiento: string; ruta: string; nombre: string; sha256: string; bytes: number }[]
}

function doble(o: { porHacer?: PorHacer[]; porEnlazar?: PorEnlazar[]; ficheros?: Record<string, Uint8Array>; enlazarFalla?: string; subirFalla?: string } = {}): Doble {
  const almacen = new Map(Object.entries(o.ficheros ?? {}))
  const d: Doble = {
    almacen, subidas: [], hechos: [], fallos: [], enlaces: [],
    async reclamar() { return o.porHacer ?? [] },
    async bajar(f: Fichero) {
      const b = almacen.get(`${f.bucket}:${f.ruta}`)
      if (!b) throw new Error('no se ha podido leer el fichero guardado (Object not found)')
      return b
    },
    async subir(ruta, pdf) {
      if (o.subirFalla) throw new Error(o.subirFalla)
      d.subidas.push(ruta); almacen.set(`conta-documentos:${ruta}`, pdf)
    },
    async hecho(factura, ruta, sha256, bytes, paginas) { d.hechos.push({ factura, ruta, sha256, bytes, paginas }) },
    async fallo(factura, motivo, enlace) { d.fallos.push({ factura, motivo, enlace }) },
    async porEnlazar() { return o.porEnlazar ?? [] },
    async enlazar(asiento, ruta, nombre, sha256, bytes) {
      if (o.enlazarFalla) throw new Error(o.enlazarFalla)
      d.enlaces.push({ asiento, ruta, nombre, sha256, bytes })
    },
    async sha256(b) { return sha(b) },
  }
  return d
}
const siempre = { limite: 20, seguir: () => true }

describe('hacer el PDF de las fotos que entran', () => {
  it('una foto: se baja, se convierte, se sube a <cuenta>/recibidas/<factura>/<huella>.pdf y se apunta', async () => {
    const d = doble({
      porHacer: [{ factura: 'fac-1', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'cta/rec/00-image.jpg' }] }],
      ficheros: { 'receipt-uploads:cta/rec/00-image.jpg': foto('f09-torcida.jpg') },
    })
    expect(await hacerPdfs(d, siempre)).toEqual({ hechos: 1, fallos: 0, sinTiempo: 0 })
    expect(d.hechos).toHaveLength(1)
    const h = d.hechos[0]
    expect(h.ruta).toBe(rutaDeLaFactura('cta', 'fac-1', h.sha256))
    expect(h.ruta).toMatch(/^cta\/recibidas\/fac-1\/[0-9a-f]{16}\.pdf$/)
    const pdf = d.almacen.get(`conta-documentos:${h.ruta}`)!
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    expect(h).toMatchObject({ sha256: sha(pdf), bytes: pdf.length, paginas: 1 })
    expect(d.fallos).toEqual([])
  })
  it('varias páginas de su lectura, un PDF con todas, en su orden', async () => {
    const d = doble({
      porHacer: [{ factura: 'fac-2', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'a.jpg' }, { bucket: 'receipt-uploads', ruta: 'b.jpg' }] }],
      ficheros: { 'receipt-uploads:a.jpg': foto('f09-torcida.jpg'), 'receipt-uploads:b.jpg': foto('f10-borrosa.jpg') },
    })
    await hacerPdfs(d, siempre)
    expect(d.hechos[0].paginas).toBe(2)
  })
  it('lo que no se puede convertir se apunta con su motivo, y no para a las demás', async () => {
    const d = doble({
      porHacer: [
        { factura: 'heic', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'x.jpg' }] },
        { factura: 'falta', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'no-esta.jpg' }] },
        { factura: 'nada', cuenta: 'cta', ficheros: [] },
        { factura: 'bien', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'ok.jpg' }] },
      ],
      ficheros: {
        'receipt-uploads:x.jpg': new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]),
        'receipt-uploads:ok.jpg': foto('f10-borrosa.jpg'),
      },
    })
    expect(await hacerPdfs(d, siempre)).toEqual({ hechos: 1, fallos: 3, sinTiempo: 0 })
    expect(d.fallos).toEqual([
      { factura: 'heic', motivo: 'la foto 1 es una foto HEIC (la de los iPhone) y solo sé convertir JPG y PNG', enlace: false },
      { factura: 'falta', motivo: 'no se ha podido leer el fichero guardado (Object not found)', enlace: false },
      { factura: 'nada', motivo: 'la factura no tiene ningún fichero guardado', enlace: false },
    ])
    expect(d.hechos.map((h) => h.factura)).toEqual(['bien'])
  })
  it('si no se puede subir, no se apunta como hecho: se apunta el fallo', async () => {
    const d = doble({
      porHacer: [{ factura: 'fac-1', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'a.jpg' }] }],
      ficheros: { 'receipt-uploads:a.jpg': foto('f09-torcida.jpg') }, subirFalla: 'no se ha podido guardar el PDF (lleno)',
    })
    await hacerPdfs(d, siempre)
    expect(d.hechos).toEqual([])
    expect(d.fallos).toEqual([{ factura: 'fac-1', motivo: 'no se ha podido guardar el PDF (lleno)', enlace: false }])
  })
  it('sin tiempo, la que queda no se toca: la coge la pasada siguiente (está apartada)', async () => {
    const d = doble({
      porHacer: [{ factura: 'a', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'a.jpg' }] }, { factura: 'b', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'a.jpg' }] }],
      ficheros: { 'receipt-uploads:a.jpg': foto('f09-torcida.jpg') },
    })
    let n = 0
    expect(await hacerPdfs(d, { limite: 20, seguir: () => n++ < 1 })).toEqual({ hechos: 1, fallos: 0, sinTiempo: 1 })
    expect(d.fallos).toEqual([])
  })
})

describe('enlazar el PDF al asiento validado', () => {
  const pdf = foto('f01-mercancia.pdf')
  it('copia el PDF a <cuenta>/<asiento>/<huella>.pdf (la ruta que lee el envío a Diez) y lo enlaza con su nombre', async () => {
    const d = doble({
      porEnlazar: [{ asiento: 'asi-1', cuenta: 'cta', factura: 'fac-1', fuente: { bucket: 'conta-documentos', ruta: 'cta/recibidas/fac-1/abc.pdf' }, nombre: 'PROVEEDOR INVENTADO 24048027.pdf' }],
      ficheros: { 'conta-documentos:cta/recibidas/fac-1/abc.pdf': pdf },
    })
    expect(await enlazarPdfs(d, siempre)).toEqual({ enlazados: 1, sinEnlazar: 0, sinTiempo: 0 })
    expect(d.enlaces).toEqual([{ asiento: 'asi-1', ruta: rutaDelAsiento('cta', 'asi-1', sha(pdf)), nombre: 'PROVEEDOR INVENTADO 24048027.pdf', sha256: sha(pdf), bytes: pdf.length }])
    expect(d.subidas).toEqual([`cta/asi-1/${sha(pdf).slice(0, 16)}.pdf`])
  })
  it('un original que ya era PDF se enlaza tal cual, desde receipt-uploads', async () => {
    const d = doble({
      porEnlazar: [{ asiento: 'asi-2', cuenta: 'cta', factura: 'fac-2', fuente: { bucket: 'receipt-uploads', ruta: 'cta/lote/f.pdf' }, nombre: 'x.pdf' }],
      ficheros: { 'receipt-uploads:cta/lote/f.pdf': pdf },
    })
    await enlazarPdfs(d, siempre)
    expect(d.enlaces[0].sha256).toBe(sha(pdf))
  })
  it('si lo guardado no es un PDF o la base no lo enlaza, se apunta como fallo de enlace', async () => {
    const d = doble({
      porEnlazar: [{ asiento: 'asi-3', cuenta: 'cta', factura: 'fac-3', fuente: { bucket: 'receipt-uploads', ruta: 'raro.pdf' }, nombre: 'x.pdf' }],
      ficheros: { 'receipt-uploads:raro.pdf': foto('f09-torcida.jpg') },
    })
    await enlazarPdfs(d, siempre)
    expect(d.fallos).toEqual([{ factura: 'fac-3', motivo: 'el documento guardado de la factura no es un PDF', enlace: true }])
    const e = doble({
      porEnlazar: [{ asiento: 'asi-4', cuenta: 'cta', factura: 'fac-4', fuente: { bucket: 'receipt-uploads', ruta: 'f.pdf' }, nombre: 'x.pdf' }],
      ficheros: { 'receipt-uploads:f.pdf': pdf }, enlazarFalla: 'Ese asiento ya tiene su factura: no se cambia.',
    })
    expect(await enlazarPdfs(e, siempre)).toEqual({ enlazados: 0, sinEnlazar: 1, sinTiempo: 0 })
    expect(e.fallos).toEqual([{ factura: 'fac-4', motivo: 'Ese asiento ya tiene su factura: no se cambia.', enlace: true }])
  })
})

describe('una pasada', () => {
  it('primero hace, luego enlaza, y lo cuenta', async () => {
    const orden: string[] = []
    const d = doble({
      porHacer: [{ factura: 'fac-1', cuenta: 'cta', ficheros: [{ bucket: 'receipt-uploads', ruta: 'a.jpg' }] }],
      ficheros: { 'receipt-uploads:a.jpg': foto('f09-torcida.jpg') },
    })
    const reclamar = d.reclamar.bind(d), porEnlazar = d.porEnlazar.bind(d)
    d.reclamar = async (l) => { orden.push('hacer'); return reclamar(l) }
    d.porEnlazar = async (l) => {
      orden.push('enlazar')
      // Lo recién hecho ya sale para enlazar en la misma pasada.
      const h = d.hechos[0]
      return h ? [{ asiento: 'asi-1', cuenta: 'cta', factura: h.factura, fuente: { bucket: 'conta-documentos', ruta: h.ruta }, nombre: 'x.pdf' }] : porEnlazar(l)
    }
    expect(await pasada(d, siempre)).toEqual({ hechos: 1, fallos: 0, enlazados: 1, sinEnlazar: 0, sinTiempo: 0 })
    expect(orden).toEqual(['hacer', 'enlazar'])
    expect(d.enlaces[0].sha256).toBe(d.hechos[0].sha256)
  })
})
