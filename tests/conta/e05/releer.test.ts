// E05 · Volver a leer en el servidor los PDF de una quincena de Catcher
// (_shared/catcherReleer.ts, Julio, 22/10). Con la quincena inventada de
// ejemplo.ts: sus PDF, leídos con pdfjs por posición como en el servidor; la
// lectura guardada, como la deja conta_lote_registrar al subir, con pdf_pedidos
// en falso (lo que pasó con las 83 de riders antes del #278). Lo demás, dobles.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { excelDeLaLectura, releerLote, textoReleido, type FacturaGuardada, type LecturaGuardada, type PuertoReleer } from '../../../supabase/functions/_shared/catcherReleer'
import { textoPorPosicion } from '../../../supabase/functions/_shared/catcherPdf'
import { comprobarPdf, leerFacturas, type FacturaExcel } from '../../../src/modules/conta/lib/catcherQuincena'
import type { Cruce } from '../../../supabase/functions/_shared/catcherCruces'
import { excelFacturas, FACTURAS, pdf } from './ejemplo'

const EXCEL: FacturaExcel[] = leerFacturas(XLSX.read(excelFacturas(), { type: 'array' })).facturas
async function texto(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  let t = ''
  for (let i = 1; i <= doc.numPages; i++) t += textoPorPosicion((await (await doc.getPage(i)).getTextContent()).items as { str?: string; transform?: number[] }[]) + '\n'
  return t
}
/** La lectura como la guarda conta_lote_registrar, con lo del PDF leído en el orden de dibujo (pdf_pedidos en falso). */
function lecturaDeSubida(ex: FacturaExcel, tipo: string): LecturaGuardada & { comprobaciones: { id: string; ok: boolean; texto: string }[] } {
  return {
    factura: { numero: ex.numero, fecha: ex.fecha, base: ex.base, cuota: ex.cuota, total: ex.total, proveedor: { nombre: ex.emisor.nombre, nif: ex.emisor.nif } },
    lote: { tipo, pedidos: ex.pedidos, periodo: { desde: ex.desde, hasta: ex.hasta } },
    confianza: 'duda',
    comprobaciones: [{ id: 'numero', ok: true, texto: 'Número' }, { id: 'pdf_numero', ok: true, texto: 'x' }, { id: 'pdf_pedidos', ok: false, texto: 'x' }],
  }
}

type Doble = PuertoReleer & { guardadas: Parameters<PuertoReleer['guardarLecturas']>[0][]; cruces: Cruce[]; leidos: string[] }
function doble(o: { estados?: Record<string, string>; sinRuta?: string[]; rota?: string[] } = {}): Doble {
  const fs: FacturaGuardada[] = FACTURAS.map((f, i) => {
    const ex = EXCEL.find((x) => x.numero === f.numero)!
    return { id: `fac-${i}`, numero: f.numero, estado: o.estados?.[f.numero] ?? 'en_revision', ruta: o.sinRuta?.includes(f.numero) ? null : `cta/lote/${f.pdf}`,
      base: f.base, total: f.total, lectura: lecturaDeSubida(ex, f.tipo) }
  })
  const porRuta = new Map(FACTURAS.map((f) => [`cta/lote/${f.pdf}`, o.rota?.includes(f.numero) ? new Uint8Array([1, 2, 3]) : pdf(f)]))
  const d: Doble = {
    guardadas: [], cruces: [], leidos: [],
    async lote() { return { id: 'lote', desde: '2026-09-16', hasta: '2026-09-30', total: null } },
    async facturas() { return fs.map((f) => ({ ...f, lectura: f.lectura ? { ...f.lectura } : null })) },
    async texto(ruta) { d.leidos.push(ruta); return { texto: await texto(porRuta.get(ruta)!), sha256: 'h' } },
    async guardarLecturas(l) {
      d.guardadas.push(l)
      // Como la base: solo las que siguen en revisión; seguras si todo lo del PDF está bien.
      let seguras = 0
      for (const x of l) { const f = fs.find((y) => y.id === x.factura)!; const ok = x.contraPdf.every((c) => c.ok); if (ok) seguras++; f.lectura = { ...f.lectura, confianza: ok ? 'seguro' : 'duda' } }
      return { releidas: l.length, seguras, sin_tocar: 0 }
    },
    async pedidos() { return [] },
    async app() { return [] },
    async tarifas() { return [] },
    async guardarCruce(c) { d.cruces.push(c); return { texto: 'Cruzada la quincena.' } },
  }
  return d
}

describe('lo que dijo el Excel, de la lectura guardada', () => {
  it('da la misma comprobación del PDF que el Excel de verdad, en las cinco', async () => {
    for (const f of FACTURAS) {
      const ex = EXCEL.find((x) => x.numero === f.numero)!
      const g: FacturaGuardada = { id: 'x', numero: f.numero, estado: 'en_revision', ruta: 'r', base: f.base, total: f.total, lectura: lecturaDeSubida(ex, f.tipo) }
      const t = await texto(pdf(f))
      expect(comprobarPdf(excelDeLaLectura(g), t), f.numero).toEqual(comprobarPdf(ex, t))
    }
  })
})

describe('volver a leer y cruzar', () => {
  it('las cinco en revisión: se releen, todas dicen lo mismo que su Excel (pdf_pedidos ya bien) y se vuelve a cruzar con ellas seguras', async () => {
    const d = doble()
    const r = await releerLote(d)
    expect(r).toMatchObject({ releidas: 5, seguras: 5, sinTocar: 0, sinPdf: 0, fallidas: [] })
    expect(d.guardadas[0].every((x) => x.contraPdf.every((c) => c.id.startsWith('pdf_') && c.ok))).toBe(true)
    expect(d.guardadas[0][0].contraPdf.map((c) => c.id)).toEqual(['pdf_numero', 'pdf_nif', 'pdf_base', 'pdf_cuota', 'pdf_total', 'pdf_fecha', 'pdf_ejercicio', 'pdf_pedidos'])
    // El cruce, con las facturas ya seguras al leer (sin pedidos en el doble: cada una sin nada que aclarar).
    expect(Object.values(d.cruces[0].facturas).every((x) => x.estado === 'seguro')).toBe(true)
    expect(textoReleido(r)).toBe('Releídos los PDF de 5 facturas: 5 dicen lo mismo que el Excel. Cruzada la quincena.')
  })
  it('lo que ya decidió una persona no se relee; sin PDF, se cuenta; un PDF roto se dice, y las demás siguen', async () => {
    const d = doble({ estados: { ES_I_1001_26_7: 'aprobada' }, sinRuta: ['ES_I_1002_26_7'], rota: ['ES_I_1003_26_7'] })
    const r = await releerLote(d)
    expect(d.leidos).toHaveLength(3)
    expect(d.leidos.some((x) => x.includes('1001'))).toBe(false)
    expect(r).toMatchObject({ releidas: 2, seguras: 2, sinTocar: 1, sinPdf: 1 })
    expect(r.fallidas.map((x) => x.numero)).toEqual(['ES_I_1003_26_7'])
    expect(textoReleido(r)).toMatch(/^Releídos los PDF de 2 facturas: 2 dicen lo mismo que el Excel\. 1 ya estaba decidida y no se ha tocado\. 1 sin PDF guardado\. 1 no se ha podido leer: ES_I_1003_26_7 \(.+\)\. Cruzada la quincena\.$/)
    // Las que no se releen siguen como estaban al cruzar: la decidida y la sin PDF, sin «segura al leer».
    expect(d.cruces[0].facturas['ES_I_1002_26_7'].estado).toBe('aclarar')
  })
})
