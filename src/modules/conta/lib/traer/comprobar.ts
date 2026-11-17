// src/modules/conta/lib/traer/comprobar.ts
//
// N04 · Lo que se comprueba ENTRE ficheros, sin escribir nada, para que la pantalla
// lo enseñe («Mira lo que entra»). Cada cosa que no cuadra, en una frase con sus
// cifras; lo que cuadra, también (regla 7: nada se esconde).

import { cifra, fechaDeGente, trimestre } from './excel'
import type { Asiento, DiarioLeido, Factura, FilaSumas, LibroLeido, PlanLeido, Tercero } from './leer'
import { claveNombre } from '@/modules/conta/lib/importarPlan'

// ── El diario contra el sumas y saldos, cuenta a cuenta ──────────────────────────────

export interface CuentaComparada {
  subcuenta: string
  nombre: string
  diario: { debe: number; haber: number }
  sumas: { debe: number; haber: number } | null
  cuadra: boolean
  /** Lo que no cuadra, en una frase («La cuenta 41000012 tiene 246,30 en el diario y 164,20 en el sumas y saldos: 82,10 de diferencia.»). */
  frase: string | null
}

/** Lo que se suma por subcuenta (también lo usa la salida a ERP10). */
export function sumarPorSubcuenta(asientos: readonly Asiento[]): Map<string, { nombre: string; debe: number; haber: number }> {
  const m = new Map<string, { nombre: string; debe: number; haber: number }>()
  for (const a of asientos) for (const ap of a.apuntes) {
    const x = m.get(ap.subcuenta) ?? { nombre: ap.nombre, debe: 0, haber: 0 }
    x.debe += ap.debe; x.haber += ap.haber
    m.set(ap.subcuenta, x)
  }
  return m
}

/**
 * Compara dos sumas y saldos cuenta a cuenta: lo de un lado (el diario de ERP10, o
 * Sumied) contra el sumas y saldos de ERP10. Pieza suelta: la usa también la salida.
 * `deDonde` es cómo se nombra el primer lado en la frase («en el diario», «en Sumied»).
 */
export function compararConSumas(lado: ReadonlyMap<string, { nombre: string; debe: number; haber: number }>, sumas: readonly FilaSumas[], deDonde = 'en el diario'): CuentaComparada[] {
  const porCuenta = new Map(sumas.map((s) => [s.subcuenta, s]))
  const todas = [...new Set([...lado.keys(), ...porCuenta.keys()])].sort()
  return todas.map((sub) => {
    const d = lado.get(sub) ?? null, s = porCuenta.get(sub) ?? null
    const dd = { debe: d?.debe ?? 0, haber: d?.haber ?? 0 }
    const ss = s ? { debe: s.debe, haber: s.haber } : null
    const nombre = d?.nombre || s?.nombre || ''
    let frase: string | null = null
    if (!s && (dd.debe || dd.haber)) {
      frase = `La cuenta ${sub} tiene movimientos ${deDonde} (${cifra(dd.debe)} al debe y ${cifra(dd.haber)} al haber) y no está en el sumas y saldos.`
    } else if (s && (s.debe !== dd.debe || s.haber !== dd.haber)) {
      const lado2 = s.debe !== dd.debe ? 'debe' : 'haber'
      const a = dd[lado2], b = s[lado2]
      frase = `La cuenta ${sub} tiene ${cifra(a)} ${deDonde} y ${cifra(b)} en el sumas y saldos, al ${lado2}: ${cifra(Math.abs(a - b))} de diferencia.`
      if (s.debe !== dd.debe && s.haber !== dd.haber) {
        frase += ` Al haber, también: ${cifra(dd.haber)} y ${cifra(s.haber)}.`
      }
    }
    return { subcuenta: sub, nombre, diario: dd, sumas: ss, cuadra: frase === null, frase }
  })
}

// ── El IVA del diario contra los libros, por trimestre ───────────────────────────────

export interface IvaTrimestre {
  libro: 'recibidas' | 'expedidas'
  trimestre: string
  /** La 472 (debe − haber) o la 477 (haber − debe) del diario en el trimestre. */
  diario: number
  /** Las cuotas del libro en el trimestre. */
  libroCuotas: number
  cuadra: boolean
  frase: string
}

const trimDeLibro = (f: Factura): string => (f.periodo && f.ejercicio ? `${f.periodo} ${f.ejercicio}` : trimestre(f.expedicion))

export function ivaPorTrimestre(diario: DiarioLeido, recibidas: LibroLeido | null, expedidas: LibroLeido | null): IvaTrimestre[] {
  const out: IvaTrimestre[] = []
  for (const [libro, l, prefijo, signo, nombre] of [
    ['recibidas', recibidas, '472', 1, 'la 472 (IVA soportado)'],
    ['expedidas', expedidas, '477', -1, 'la 477 (IVA repercutido)'],
  ] as const) {
    if (!l) continue
    const enDiario = new Map<string, number>()
    for (const a of diario.asientos) for (const ap of a.apuntes) {
      if (!ap.subcuenta.startsWith(prefijo)) continue
      const t = trimestre(a.fecha)
      enDiario.set(t, (enDiario.get(t) ?? 0) + signo * (ap.debe - ap.haber))
    }
    const enLibro = new Map<string, number>()
    for (const f of l.facturas) enLibro.set(trimDeLibro(f), (enLibro.get(trimDeLibro(f)) ?? 0) + f.cuota)
    for (const t of [...new Set([...enDiario.keys(), ...enLibro.keys()])].sort(porTrimestre)) {
      const d = enDiario.get(t) ?? 0, b = enLibro.get(t) ?? 0
      const libroNombre = libro === 'recibidas' ? 'del libro de facturas recibidas' : 'del libro de facturas emitidas'
      out.push({
        libro, trimestre: t, diario: d, libroCuotas: b, cuadra: d === b,
        frase: d === b
          ? `${t}: ${nombre} del diario, ${cifra(d)}, es lo mismo que las cuotas ${libroNombre}.`
          : `${t}: ${nombre} del diario suma ${cifra(d)} y las cuotas ${libroNombre}, ${cifra(b)}: ${cifra(Math.abs(d - b))} de diferencia.`,
      })
    }
  }
  return out
}
const porTrimestre = (a: string, b: string) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b)

// ── Cada factura, con su asiento (por fecha, NIF y cuota) ────────────────────────────

export interface FacturaCasada { libro: 'recibidas' | 'expedidas'; factura: Factura; asiento: Asiento }
export interface FacturaSinCasar { libro: 'recibidas' | 'expedidas'; factura: Factura; porque: string }
export interface Casado { casadas: FacturaCasada[]; sinCasar: FacturaSinCasar[]; asientosConIvaSinFactura: Asiento[] }

/**
 * Casa cada factura del libro con un asiento del diario: el mismo día (de expedición),
 * con un apunte en la cuenta del tercero de su NIF (por los listados de proveedores y
 * clientes) y con la misma cuota en la 472 (recibidas) o la 477 (emitidas). Cada asiento,
 * una sola vez. Las que no casan salen TODAS, con su porqué (regla 7).
 */
export function casarFacturas(diario: DiarioLeido, recibidas: LibroLeido | null, expedidas: LibroLeido | null, terceros: readonly Tercero[]): Casado {
  const cuentasDeNif = new Map<string, Set<string>>()
  for (const t of terceros) if (t.nif) cuentasDeNif.set(t.nif, (cuentasDeNif.get(t.nif) ?? new Set()).add(t.codigo))
  const usados = new Set<Asiento>()
  const casadas: FacturaCasada[] = [], sinCasar: FacturaSinCasar[] = []
  const iva = (a: Asiento, prefijo: string, signo: number) => a.apuntes.filter((x) => x.subcuenta.startsWith(prefijo)).reduce((s, x) => s + signo * (x.debe - x.haber), 0)
  for (const [libro, l, prefijo, signo] of [['recibidas', recibidas, '472', 1], ['expedidas', expedidas, '477', -1]] as const) {
    if (!l) continue
    for (const f of l.facturas) {
      const cuentas = f.nif ? cuentasDeNif.get(f.nif) : undefined
      const delDia = diario.asientos.filter((a) => !usados.has(a) && a.fecha === f.expedicion)
      const conCuota = delDia.filter((a) => iva(a, prefijo, signo) === f.cuota)
      const casa = cuentas ? conCuota.find((a) => a.apuntes.some((x) => cuentas.has(x.subcuenta))) : undefined
      if (casa) { usados.add(casa); casadas.push({ libro, factura: f, asiento: casa }); continue }
      const que = `La factura ${f.numero} del ${fechaDeGente(f.expedicion)} (${f.nombre || 'sin nombre'})`
      const porque = !f.nif ? `${que} no trae NIF: no sé de quién es.`
        : !cuentas ? `${que} es del NIF ${f.nif}, que no está en el listado de ${libro === 'recibidas' ? 'proveedores' : 'clientes'}: no sé cuál es su cuenta.`
        : !delDia.length ? `${que} no tiene ningún asiento ese día en el diario.`
        : !conCuota.length ? `${que} no tiene ningún asiento ese día con su cuota de IVA (${cifra(f.cuota)}).`
        : `${que} no tiene ningún asiento ese día con su cuota y la cuenta ${[...cuentas].join(' o ')}.`
      sinCasar.push({ libro, factura: f, porque })
    }
  }
  const asientosConIvaSinFactura = diario.asientos.filter((a) => !usados.has(a)
    && ((recibidas && a.apuntes.some((x) => x.subcuenta.startsWith('472'))) || (expedidas && a.apuntes.some((x) => x.subcuenta.startsWith('477')))))
  return { casadas, sinCasar, asientosConIvaSinFactura }
}

// ── Las cuentas: largo, las que faltan en el plan, los terceros raros ────────────────

export interface Largos { largos: number[]; frase: string | null }

/** El largo de las subcuentas en cada fichero: si no es el mismo en todos, se dice. */
export function largoDeLasCuentas(porFichero: readonly { nombre: string; cuentas: readonly string[] }[]): Largos {
  const por = porFichero.map((x) => ({ nombre: x.nombre, largos: [...new Set(x.cuentas.filter(Boolean).map((c) => c.length))].sort() })).filter((x) => x.largos.length)
  const todos = [...new Set(por.flatMap((x) => x.largos))].sort()
  if (todos.length <= 1) return { largos: todos, frase: null }
  return {
    largos: todos,
    frase: `Las subcuentas no tienen todas el mismo número de cifras: ${por.map((x) => `${x.nombre}, ${x.largos.join(' y ')}`).join('; ')}. Sumied las trae con las cifras que traen, sin convertir: revisa de dónde sale cada una.`,
  }
}

const esTercero = (c: string) => /^4[0134]/.test(c)

/** Cuentas del diario que no están en el plan, y terceros del diario que no están en los listados. */
export function cuentasQueFaltan(diario: DiarioLeido, plan: PlanLeido | null, terceros: readonly Tercero[] | null): { fueraDelPlan: string[]; tercerosFueraDeListados: string[]; frases: string[] } {
  const enDiario = [...new Set(diario.asientos.flatMap((a) => a.apuntes.map((x) => x.subcuenta)))].sort()
  const nombre = (c: string) => diario.asientos.flatMap((a) => a.apuntes).find((x) => x.subcuenta === c)?.nombre ?? ''
  const enPlan = new Set(plan?.subcuentas.map((s) => s.codigo) ?? [])
  const enListados = new Set(terceros?.map((t) => t.codigo) ?? [])
  const fueraDelPlan = plan ? enDiario.filter((c) => !enPlan.has(c)) : []
  const tercerosFueraDeListados = terceros ? enDiario.filter((c) => esTercero(c) && !enListados.has(c)) : []
  const frases = [
    ...fueraDelPlan.map((c) => `La cuenta ${c}${nombre(c) ? ` (${nombre(c)})` : ''} tiene apuntes en el diario y no está en el plan de cuentas.`),
    ...tercerosFueraDeListados.map((c) => `La cuenta ${c}${nombre(c) ? ` (${nombre(c)})` : ''} es de un proveedor o un cliente, tiene apuntes en el diario y no está en los listados de proveedores y clientes.`),
  ]
  return { fueraDelPlan, tercerosFueraDeListados, frases }
}

export interface TerceroRaro { que: 'sin_nif' | 'nif_repetido' | 'nombre_distinto'; cuentas: string[]; nif: string | null; frase: string }

/** Lo raro de los terceros: sin NIF, el mismo NIF en dos cuentas, el mismo NIF con nombre distinto (en los listados o en los libros). */
export function tercerosRaros(terceros: readonly Tercero[], facturas: readonly Factura[]): TerceroRaro[] {
  const out: TerceroRaro[] = []
  for (const t of terceros) if (!t.nif) out.push({ que: 'sin_nif', cuentas: [t.codigo], nif: null, frase: `${t.codigo} · ${t.nombreFiscal || 'sin nombre'}: no trae NIF.` })
  const porNif = new Map<string, Tercero[]>()
  for (const t of terceros) if (t.nif) porNif.set(t.nif, [...(porNif.get(t.nif) ?? []), t])
  for (const [nif, ts] of porNif) {
    if (ts.length > 1) out.push({ que: 'nif_repetido', cuentas: ts.map((t) => t.codigo), nif, frase: `El NIF ${nif} está en ${ts.length} cuentas: ${ts.map((t) => `${t.codigo} (${t.nombreFiscal})`).join(' y ')}.` })
    const nombres = new Map<string, string>()
    for (const t of ts) nombres.set(claveNombre(t.nombreFiscal), t.nombreFiscal)
    for (const f of facturas) if (f.nif === nif && f.nombre) nombres.set(claveNombre(f.nombre), f.nombre)
    if (nombres.size > 1) out.push({ que: 'nombre_distinto', cuentas: ts.map((t) => t.codigo), nif, frase: `El NIF ${nif} sale con nombres distintos: ${[...nombres.values()].map((n) => `«${n}»`).join(' y ')}.` })
  }
  return out
}
