// supabase/functions/_shared/tarifa/proximoCobro.ts
//
// G04 · Tarea 4 (08/11/2026). El próximo cobro de GoCardless, para la banda de
// «Clientes» (Julio, nº 11 y nº 12): NUNCA la primera fecha sola.
//   · En grande, el total de los próximos 30 días: cobros y euros.
//   · Debajo, el desglose: el día principal (el de más importe: «4 dic.: 287
//     cobros · 21.801 €») y «otros días: N cobros · X €».
//   · En «Las dos», el total de las dos empresas y una línea de desglose por
//     empresa.
//   · En QBO, el 08/11, el primer día era el 16/11 (5 cobros · 181,50 €) y el
//     grande el 04/12 (287 · 21.801,19 €).
// Cuenta cada suscripción activa con su siguiente cobro (lo guarda la lectura:
// upcoming_payments). Las que no traen fecha se cuentan aparte.
// Puro. Lo prueban tests/unit/modules/conta/gestoria/g04/proximoCobro.test.ts.

import { euros } from './precio.ts'

export interface SiguienteCobro {
  empresaId: string
  /** «AAAA-MM-DD», o null si la suscripción no trae fecha. */
  fecha: string | null
  importeCent: number
}

export interface DiaDeCobro { fecha: string; cobros: number; importeCent: number }
export interface Suma { cobros: number; importeCent: number }

export interface CobroDeUnaEmpresa {
  empresaId: string
  total: Suma
  /** El día con más importe (si empatan, el primero). Null si no hay ninguno en 30 días. */
  principal: DiaDeCobro | null
  otros: Suma & { dias: number }
  dias: DiaDeCobro[]
  sinFecha: number
}

export interface ProximoCobro {
  /** Lo de las empresas elegidas juntas: en grande. */
  total: Suma
  porEmpresa: CobroDeUnaEmpresa[]
  sinFecha: number
  /** «289 cobros · 22.006,89 €» (con céntimos: la cifra grande). */
  titulo: string
  /** El desglose, una línea por empresa (con una sola, sin su nombre). */
  desglose: string[]
}

const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.']
export const diaCorto = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]}`
const masDias = (hoy: string, n: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** Un número con el punto de los miles, también con cuatro cifras («1.060»; toLocaleString no lo pone). */
export const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const nCobros = (n: number) => `${miles(n)} ${n === 1 ? 'cobro' : 'cobros'}`
/** Los euros del desglose, sin céntimos («21.801 €»). */
export const eurosRedondos = (cent: number) => `${miles(Math.round(cent / 100))} €`

function deUnaEmpresa(xs: readonly SiguienteCobro[], empresaId: string, hoy: string, hasta: string): CobroDeUnaEmpresa {
  const de = xs.filter((x) => x.empresaId === empresaId)
  const porDia = new Map<string, DiaDeCobro>()
  for (const x of de) {
    if (!x.fecha || x.fecha < hoy || x.fecha > hasta) continue
    const d = porDia.get(x.fecha) ?? { fecha: x.fecha, cobros: 0, importeCent: 0 }
    d.cobros++
    d.importeCent += x.importeCent
    porDia.set(x.fecha, d)
  }
  const dias = [...porDia.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
  const principal = dias.reduce<DiaDeCobro | null>((m, d) => (!m || d.importeCent > m.importeCent ? d : m), null)
  const otros = dias.filter((d) => d !== principal)
  return {
    empresaId, dias, principal,
    total: { cobros: dias.reduce((s, d) => s + d.cobros, 0), importeCent: dias.reduce((s, d) => s + d.importeCent, 0) },
    otros: { dias: otros.length, cobros: otros.reduce((s, d) => s + d.cobros, 0), importeCent: otros.reduce((s, d) => s + d.importeCent, 0) },
    sinFecha: de.filter((x) => !x.fecha).length,
  }
}

/** Una línea de desglose: «4 dic.: 287 cobros · 21.801 € · otros días: 5 cobros · 182 €». */
export function lineaDeDesglose(e: CobroDeUnaEmpresa, nombre: string | null): string {
  const partes = [
    e.principal ? `${diaCorto(e.principal.fecha)}: ${nCobros(e.principal.cobros)} · ${eurosRedondos(e.principal.importeCent)}` : 'ningún cobro en 30 días',
    e.otros.cobros ? `otros días: ${nCobros(e.otros.cobros)} · ${eurosRedondos(e.otros.importeCent)}` : null,
  ].filter(Boolean).join(' · ')
  return nombre ? `${nombre} · ${partes}` : partes.charAt(0).toUpperCase() + partes.slice(1)
}

/** El próximo cobro de las empresas elegidas (una, o las dos), de hoy a 30 días. */
export function proximoCobro(xs: readonly SiguienteCobro[], empresas: readonly { id: string; nombre: string }[], hoy: string): ProximoCobro {
  const hasta = masDias(hoy, 30)
  const porEmpresa = empresas.map((e) => deUnaEmpresa(xs, e.id, hoy, hasta))
  const total = { cobros: porEmpresa.reduce((s, e) => s + e.total.cobros, 0), importeCent: porEmpresa.reduce((s, e) => s + e.total.importeCent, 0) }
  return {
    total, porEmpresa,
    sinFecha: porEmpresa.reduce((s, e) => s + e.sinFecha, 0),
    titulo: total.cobros ? `${nCobros(total.cobros)} · ${euros(total.importeCent)}` : 'Ningún cobro en los próximos 30 días',
    desglose: porEmpresa.map((e, i) => lineaDeDesglose(e, empresas.length > 1 ? empresas[i].nombre : null)),
  }
}
