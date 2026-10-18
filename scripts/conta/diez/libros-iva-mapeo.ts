// scripts/conta/diez/libros-iva-mapeo.ts
//
// I01b · Los libros de IVA de Diez → el libro de IVA de Sumied (vat_book_entry).
// Núcleo puro: leer de Diez sin repetir ni saltar facturas, y convertir cada
// factura en sus filas del libro (una por tramo de IVA). Lo usan la lectura
// (libros-iva-lectura.ts) y la preparación del importador
// (libros-iva-preparar.ts). Lo que escribe es libros-iva-importar.sql.
//
// Medido en C0008 (runs 39114334781 a 39118625192, solo GET):
//   · el listado de facturas pagina con $top/$skip SIN orden fijo: leído por
//     meses repitió 431 y se saltó otras 431. Día a día cabe en una página; el
//     día que la llena se pide en tramos de documento;
//   · 3.952 facturas de enero a septiembre de 2026, todas con su asiento traído
//     (ejercicio, serie, documento) y la misma cuota que su 477 o su 472, al
//     céntimo; hasta tres tramos de IVA (BaseImponibleN, PorcentajeIVAN,
//     CuotaIVAN); sin recargo; 36 con retención; las expedidas, todas al 10 %.
//
// Las decisiones, con su porqué:
//   · Serie 1 → libro de expedidas; serie 2 → recibidas. Un tramo al 0 % sin
//     cuota de una recibida va al libro de no sujetas: así su base no infla la
//     casilla [28].
//   · TipoFactura 6 y 7 (abonos) de una RECIBIDA se quedan como F1 con su
//     signo: el 303 que presentó Diez (1T) no lleva nada en [40]/[41] y sí el
//     abono restando en [29]. Lo de Diez, tal cual. En una expedida, R1.
//   · Factura simplificada → F2.
//   · El país sale del NIF solo si empieza por dos letras de otro país (un
//     NIF o NIE español empieza por una letra o una cifra).
//   · La fecha que decide el trimestre de una recibida (received_date) es una
//     ELECCIÓN del lanzamiento ('asiento' o 'introduccion'): la mide la
//     lectura contra los 303 presentados.

import type { ClienteDiez, Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

/** Lo que trae una página del listado de Diez ($top del cliente). */
export const PAGINA = 200
const DOCUMENTO_MAX = 9999
const TRAMO = 150

/** Los céntimos de un importe de Diez (double), redondeados. */
export const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
/** El trimestre (1–4) de una fecha AAAAMMDD. */
export const trimestre = (aaaammdd: unknown) => Math.floor((Math.floor(Number(aaaammdd) / 100) % 100 - 1) / 3) + 1
/** AAAAMMDD → AAAA-MM-DD (o null). */
export const isoDe = (aaaammdd: unknown) => {
  const s = String(aaaammdd ?? '')
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
}
/** Los tramos de IVA de una factura: hasta 8 (BaseImponibleN, PorcentajeIVAN, CuotaIVAN). */
export function tramos(f: Record<string, unknown>) {
  const t: { base: number; tipo: number; cuota: number }[] = []
  for (let n = 1; n <= 8; n++) {
    const base = cent(f[`BaseImponible${n}`]), cuota = cent(f[`CuotaIVA${n}`]), tipo = Number(f[`PorcentajeIVA${n}`] ?? 0)
    if (base !== 0 || cuota !== 0) t.push({ base, tipo, cuota })
  }
  return t
}
/** La cuota de una factura de Diez, en céntimos (todos sus tramos). */
export const cuotaFactura = (f: Record<string, unknown>) => tramos(f).reduce((t, x) => t + x.cuota, 0)

/** Los días AAAAMMDD de un mes AAAAMM a otro, ambos incluidos. */
export function diasEntre(desde: string, hasta: string): number[] {
  const out: number[] = []
  const d = new Date(Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(4, 6)) - 1, 1))
  const fin = new Date(Date.UTC(Number(hasta.slice(0, 4)), Number(hasta.slice(4, 6)), 0))
  for (; d <= fin; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate())
  return out
}
/** Los tramos [desde, hasta] de documento, de 1 a max, de n en n. */
export function tramosDocumento(max: number, n: number): [number, number][] {
  const out: [number, number][] = []
  for (let a = 1; a <= max; a += n) out.push([a, Math.min(a + n - 1, max)])
  return out
}

export type Lectura = { facturas: Factura[]; filas: number; dias: number; sinContestar: number[]; diasLlenos: number; tramosLlenos: number; repetidas: number; repetidasDistintas: number }

/**
 * Las facturas de Diez de un mes a otro, día a día, sin repetidas: el día que
 * llena la página se vuelve a pedir en tramos de documento. Las repetidas con
 * el mismo contenido se quitan; si alguna clave sale con contenido distinto,
 * se cuenta (y quien llama decide parar).
 */
export async function leerFacturas(c: Pick<ClienteDiez, 'todas'>, desde: string, hasta: string): Promise<Lectura> {
  const todas: Factura[] = []
  const sinContestar: number[] = []
  let dias = 0, diasLlenos = 0, tramosLlenos = 0
  const filtro = (x: string) => `/api/facturas?$filter=${encodeURIComponent(x)}`
  for (const d of diasEntre(desde, hasta)) {
    try {
      let del = await c.todas<Factura>(filtro(`Fecha ge ${d} and Fecha le ${d}`))
      if (del.length >= PAGINA) {
        diasLlenos++
        del = []
        for (const [a, b] of tramosDocumento(DOCUMENTO_MAX, TRAMO)) {
          const t = await c.todas<Factura>(filtro(`Fecha ge ${d} and Fecha le ${d} and Documento ge ${a} and Documento le ${b}`))
          if (t.length >= PAGINA) tramosLlenos++
          del.push(...t)
        }
      }
      todas.push(...del); dias++
    } catch { sinContestar.push(d) }
  }
  const porClave = new Map<string, Factura[]>()
  for (const f of todas) { const k = `${f.Ejercicio}/${f.Serie}/${f.Documento}`; porClave.set(k, [...(porClave.get(k) ?? []), f]) }
  let repetidas = 0, repetidasDistintas = 0
  for (const fs of porClave.values()) {
    if (fs.length < 2) continue
    repetidas++
    if (new Set(fs.map((f) => JSON.stringify(f))).size > 1) repetidasDistintas++
  }
  return { facturas: [...porClave.values()].map((fs) => fs[0]), filas: todas.length, dias, sinContestar, diasLlenos, tramosLlenos, repetidas, repetidasDistintas }
}

/** De dónde sale el trimestre de una recibida. */
export type FechaRecibida = 'asiento' | 'introduccion'

/** Una fila del libro de IVA de Sumied, lista para libros-iva-importar.sql (importes en céntimos). */
export type FilaLibro = {
  e: string; s: string; n: number
  libro: 'issued' | 'received' | 'not_subject'
  tipo_factura: 'F1' | 'F2' | 'R1'
  numero: string | null
  fecha_factura: string | null; fecha_operacion: string | null; fecha_recibida: string | null
  nif: string | null; pais: string | null; nombre: string | null
  base: number; tipo: number; cuota: number
  retencion_tipo: number | null; retencion: number | null
  tramo: number
}

/** El país de un NIF: solo si empieza por dos letras de otro país. */
export function paisDe(nif: unknown): string | null {
  const m = /^([A-Z]{2})[0-9A-Z]/.exec(String(nif ?? '').toUpperCase().replace(/[\s.-]/g, ''))
  return m && m[1] !== 'ES' ? m[1] : null
}

/** Las filas del libro de una factura de Diez (una por tramo). Lanza si no se sabe a qué libro va. */
export function filasDeFactura(f: Record<string, unknown>, fechaRecibida: FechaRecibida): FilaLibro[] {
  const serie = String(f.Serie)
  if (serie !== '1' && serie !== '2') throw new Error(`serie ${serie}: solo se traen las series 1 (expedidas) y 2 (recibidas)`)
  const recibida = serie === '2'
  const t = tramos(f)
  if (t.length === 0) throw new Error('factura sin tramos de IVA')
  const tf = Number(f.TipoFactura ?? 1)
  const tipo: FilaLibro['tipo_factura'] = !recibida && (tf === 6 || tf === 7) ? 'R1' : f.EsFacturaSimplificada === true ? 'F2' : 'F1'
  const nif = String(f.CifCliente ?? '').trim() || null
  const ret = cent(f.CuotaRetencion)
  return t.map((x, i) => ({
    e: String(f.Ejercicio), s: serie, n: Number(f.Documento),
    libro: recibida && x.tipo === 0 && x.cuota === 0 ? 'not_subject' : recibida ? 'received' : 'issued',
    tipo_factura: tipo,
    numero: String(f.NumeroFactura ?? '').trim() || null,
    fecha_factura: isoDe(f.FechaFactura) ?? isoDe(f.Fecha),
    fecha_operacion: isoDe(f.FechaOperacion),
    fecha_recibida: recibida ? (fechaRecibida === 'introduccion' ? isoDe(f.FechaIntroduccionFactura) ?? isoDe(f.Fecha) : isoDe(f.Fecha)) : null,
    nif, pais: paisDe(nif), nombre: String(f.NombreCliente ?? '').trim() || null,
    base: x.base, tipo: x.tipo, cuota: x.cuota,
    retencion_tipo: i === 0 && ret !== 0 ? Number(f.PorcentajeRetencion ?? 0) : null,
    retencion: i === 0 && ret !== 0 ? ret : null,
    tramo: i + 1,
  }))
}
