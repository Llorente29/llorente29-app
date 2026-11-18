// src/modules/conta/erp10/comparar.ts
//
// X06 · «Comprueba que queda igual»: el sumas y saldos de ERP10 (leerSumasYSaldos)
// contra los saldos de Sumied a la misma fecha (conta_erp10_comprobar), cuenta a
// cuenta, y por qué no queda igual. Puro: sin red ni base.
//
// Cómo se explica una diferencia (contestado en el PR del X06, con las cifras de
// staging):
//   1. Lo que ERP10 debería tener en una cuenta es el saldo de Sumied menos todo lo
//      que no ha salido: lo que no sale por aquí (asientos, días del TPV, lo que hay
//      que meter a mano), lo que está por sacar, lo que no pudo salir y el
//      contraasiento de una que salió y se anuló después.
//   2. Si lo que queda contra ERP10 es cero y todo lo restado es «no sale por aquí»,
//      la cuenta va al grupo de en medio: «llevan cosas que todavía no salen por
//      aquí». No es un fallo.
//   3. Si es cero pero entre lo restado hay algo con motivo (por sacar, no pudo,
//      cambió), va a «no quedan igual», con su explicación.
//   4. Si queda algo, se busca una factura que salió (o que se metió a mano) con
//      justo ese importe en esa cuenta: «En ERP10 falta una factura…». Si no la hay,
//      se dice que Sumied no sabe explicarlo. Nunca se inventa la causa.
// Todo en céntimos; la diferencia que se enseña es ERP10 menos Sumied, con el signo
// natural de la cuenta (un proveedor con menos saldo en ERP10 sale en negativo).

import { importe } from '@/modules/conta/erp10/salida'
import type { FilaSumas } from '@/modules/conta/lib/traer'

// ── Lo que viene de la base ──────────────────────────────────────────────────────────

export interface SaldoSumied { codigo: string; plantilla: string | null; nombre: string; saldo: number; erp: string | null }
export interface AsientoSumied {
  entryId: string
  serie: number
  numero: number | null
  fecha: string
  concepto: string
  origen: string
  estado: string
  /** El asiento que deshace, si es un contraasiento. */
  deshace: string | null
  factura: string | null
  tercero: string | null
  salida: { lote: string; mes: string; salioEn: string; clase: string } | null
  aMano: { quien: string | null; cuando: string } | null
  lineas: { cuenta: string; importe: number }[]
}
export interface Comprobar {
  fecha: string
  ejercicio: { desde: string; hasta: string }
  desde: string
  codigo: string
  largo: number
  saldos: SaldoSumied[]
  asientos: AsientoSumied[]
  lotes: { id: string; mes: string; creadoEn: string; quien: string | null }[]
  igualado: { mes: string; fichero: string; fechaSaldos: string; quien: string | null; cuando: string } | null
}

/** Lo que dice la salida del mes de lo que no ha salido (de armarSalida). */
export interface LoQueNoHaSalido {
  /** Los asientos que van en los ficheros de la próxima descarga. */
  porSacar: ReadonlySet<string>
  /** Los que no pueden salir, con su porqué. */
  noPueden: ReadonlyMap<string, string>
}

// ── Lo que sale de la comparación ──────────────────────────────────────────────────

export type Clase = 'falta' | 'a_mano' | 'por_sacar' | 'no_pudo' | 'cambiada' | 'no_sale_aqui' | 'desconocida'

export interface Partida {
  clase: Clase
  /** El asiento (nulo en «desconocida»). */
  asiento: AsientoSumied | null
  /** Lo que pone en esta cuenta, en céntimos, como Sumied menos ERP10. */
  importe: number
  porque?: string
}

export interface CuentaComparada {
  cuenta: string
  nombre: string
  /** Saldos y diferencia, con el signo natural de la cuenta, en céntimos. */
  sumied: number
  erp10: number
  diferencia: number
  grupo: 'no_igual' | 'no_sale' | 'igual'
  /** Lo que la explica (vacío si queda igual). */
  partidas: Partida[]
  /** Si impide darlo por igualado: algo sin explicar o por hacer. */
  bloquea: boolean
  /** Sumied no tiene esta cuenta (o no tiene saldo en ella) y ERP10 sí. */
  soloEnErp10: boolean
}

export interface Comparacion {
  cuentas: CuentaComparada[]
  noIgual: CuentaComparada[]
  noSale: CuentaComparada[]
  igual: CuentaComparada[]
  totales: { sumied: number; erp10: number; diferencia: number }
  /** Se puede dar por igualado: ninguna cuenta con algo sin explicar o por hacer. */
  igualable: boolean
}

const c = (x: number) => Math.round(Number(x) * 100)

/** Qué es un asiento que no está en ERP10 (o sí, si salió o se metió a mano). */
export function claseDe(a: AsientoSumied, salidos: ReadonlySet<string>, nh: LoQueNoHaSalido): Clase | 'salida' {
  if (a.aMano) return 'a_mano'
  if (a.salida) return 'salida'
  if (a.deshace && salidos.has(a.deshace)) return 'cambiada'
  if (nh.porSacar.has(a.entryId)) return 'por_sacar'
  const porque = nh.noPueden.get(a.entryId)
  // Lo que hay que meter a mano en ERP10 (una emitida rectificativa, un asiento que lleva I.V.A. y no es factura) no es un
  // fallo: todavía no sale por aquí. X07: «… métela a mano en ERP10 para que entre en su libro.» también.
  if (porque !== undefined) return /mano en ERP10/i.test(porque) ? 'no_sale_aqui' : 'no_pudo'
  return 'no_sale_aqui'
}

/** Las clases que no impiden darlo por igualado: se saben y no hay nada que hacer hoy. */
const NO_BLOQUEA: ReadonlySet<Clase> = new Set(['a_mano', 'no_sale_aqui'])

/**
 * La comparación entera. `erp`: las filas del sumas y saldos de ERP10 (céntimos);
 * `base`: lo de conta_erp10_comprobar; `nh`: lo que dice la salida del mes de lo que
 * no ha salido.
 */
export function comparar(erp: readonly FilaSumas[], base: Comprobar, nh: LoQueNoHaSalido): Comparacion {
  const aErp = new Map(base.saldos.map((s) => [s.codigo, s.erp ?? s.codigo]))
  const sumied = new Map<string, { saldo: number; nombre: string }>()
  for (const s of base.saldos) {
    const k = aErp.get(s.codigo)!
    const x = sumied.get(k) ?? { saldo: 0, nombre: s.nombre }
    x.saldo += c(s.saldo)
    sumied.set(k, x)
  }
  const deErp = new Map<string, { saldo: number; nombre: string }>()
  for (const f of erp) {
    const x = deErp.get(f.subcuenta) ?? { saldo: 0, nombre: f.nombre }
    x.saldo += f.deudor - f.acreedor
    deErp.set(f.subcuenta, x)
  }

  const salidos = new Set(base.asientos.filter((a) => a.salida).map((a) => a.entryId))
  // Lo que pone cada asiento en cada cuenta (con el código de ERP10), y su clase.
  const porCuenta = new Map<string, { asiento: AsientoSumied; clase: Clase | 'salida'; importe: number }[]>()
  for (const a of base.asientos) {
    const clase = claseDe(a, salidos, nh)
    for (const l of a.lineas) {
      const k = aErp.get(l.cuenta) ?? l.cuenta
      const v = c(l.importe)
      if (!v) continue
      porCuenta.set(k, [...(porCuenta.get(k) ?? []), { asiento: a, clase, importe: v }])
    }
  }

  const cuentas: CuentaComparada[] = []
  for (const k of [...new Set([...sumied.keys(), ...deErp.keys()])].sort()) {
    const s = sumied.get(k)?.saldo ?? 0
    const e = deErp.get(k)?.saldo ?? 0
    const signo = (s || e) < 0 ? -1 : 1
    const nombre = sumied.get(k)?.nombre || deErp.get(k)?.nombre || ''
    const movs = porCuenta.get(k) ?? []
    const base0: Omit<CuentaComparada, 'grupo' | 'partidas' | 'bloquea'> = {
      cuenta: k, nombre, sumied: s * signo, erp10: e * signo, diferencia: (e - s) * signo, soloEnErp10: !sumied.has(k) || (s === 0 && !movs.length && e !== 0),
    }
    if (s === e) { cuentas.push({ ...base0, grupo: 'igual', partidas: [], bloquea: false }); continue }

    // 1 · Lo que no ha salido, restado.
    const partidas: Partida[] = movs
      .filter((m) => m.clase !== 'salida' && m.clase !== 'a_mano')
      .map((m) => ({ clase: m.clase as Clase, asiento: m.asiento, importe: m.importe, porque: m.clase === 'no_pudo' || m.clase === 'no_sale_aqui' ? nh.noPueden.get(m.asiento.entryId) : undefined }))
    const restado = partidas.reduce((t, p) => t + p.importe, 0)
    const queda = s - restado - e
    // 2 · Lo que queda: una que salió (o se metió a mano) con justo ese importe.
    if (queda !== 0) {
      const cand = movs.filter((m) => (m.clase === 'salida' || m.clase === 'a_mano') && m.importe === queda)
      const elegida = cand.find((m) => m.clase === 'a_mano') ?? cand[0]
      partidas.unshift(elegida
        ? { clase: elegida.clase === 'a_mano' ? 'a_mano' : 'falta', asiento: elegida.asiento, importe: queda }
        : { clase: 'desconocida', asiento: null, importe: queda })
    }
    const soloNoSale = queda === 0 && partidas.length > 0 && partidas.every((p) => p.clase === 'no_sale_aqui')
    cuentas.push({
      ...base0, partidas,
      grupo: soloNoSale ? 'no_sale' : 'no_igual',
      bloquea: !soloNoSale && partidas.some((p) => !NO_BLOQUEA.has(p.clase)),
    })
  }

  const suma = (k: 'sumied' | 'erp10' | 'diferencia') => cuentas.reduce((t, x) => t + x[k], 0)
  const noIgual = cuentas.filter((x) => x.grupo === 'no_igual')
  return {
    cuentas, noIgual, noSale: cuentas.filter((x) => x.grupo === 'no_sale'), igual: cuentas.filter((x) => x.grupo === 'igual'),
    totales: { sumied: suma('sumied'), erp10: suma('erp10'), diferencia: suma('diferencia') },
    igualable: !noIgual.some((x) => x.bloquea),
  }
}

// ── Lo que se dice ─────────────────────────────────────────────────────────────────

const euros = (cent: number) => importe(Math.abs(cent) / 100)
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const que = (a: AsientoSumied) => (a.factura ? `La ${a.factura}` : `El asiento ${a.serie}/${a.numero ?? ''}`)
/** El total de un asiento (lo que suma su debe): el importe de la factura, sea cual sea la cuenta que se mira. */
const totalDe = (a: AsientoSumied) => a.lineas.reduce((t, l) => t + Math.max(c(l.importe), 0), 0)

/** Qué es una cuenta para una factura: su base, su IVA, su total o su retención. */
export function papel(cuenta: string): string {
  if (/^4751|^473/.test(cuenta)) return 'su retención'
  if (/^47[27]/.test(cuenta)) return 'su IVA'
  if (/^4[0134]/.test(cuenta)) return 'su total'
  if (/^[2367]/.test(cuenta)) return 'su base'
  return 'su importe'
}

export interface Aviso {
  titulo: string
  texto: string
  /** Lo que se puede hacer desde el aviso. */
  acciones: ('volver' | 'a_mano')[]
  /** El asiento sobre el que actúan las acciones. */
  entryId: string | null
  /** Si es una diferencia que hay que resolver (ámbar) o solo se cuenta (gris). */
  tono: 'ambar' | 'gris'
}

/**
 * Lo que se dice de una cuenta: un aviso por cada cosa que la explica, y las notas
 * de debajo («las otras diferencias son de la misma factura», «Sumied no sabe…»).
 * `ultimoLote`: el id de la última tanda, para decir «en esta tanda».
 */
export function explicar(x: CuentaComparada, todas: readonly CuentaComparada[], ultimoLote: string | null): { avisos: Aviso[]; notas: { titulo: string; texto: string }[] } {
  const avisos: Aviso[] = []
  const notas: { titulo: string; texto: string }[] = []
  for (const p of x.partidas) {
    const a = p.asiento
    switch (p.clase) {
      case 'falta': {
        const tanda = a!.salida!.lote === ultimoLote ? 'en esta tanda' : `en la tanda del ${dm(a!.salida!.salioEn)}`
        avisos.push({ titulo: 'En ERP10 falta una factura.', texto: `${que(a!)} del ${dm(a!.fecha)}, de ${euros(totalDe(a!))}, salió de Sumied ${tanda} y no está en el saldo de ERP10.`,
          acciones: ['volver', 'a_mano'], entryId: a!.entryId, tono: 'ambar' })
        const otras = todas.filter((o) => o.cuenta !== x.cuenta && o.partidas.some((q) => q.clase === 'falta' && q.asiento?.entryId === a!.entryId))
        if (otras.length) {
          const lista = otras.map((o) => `${papel(o.cuenta)} (${euros(o.partidas.find((q) => q.asiento?.entryId === a!.entryId)!.importe)}) en la ${o.cuenta}`)
          const unidas = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`
          notas.push(otras.length === 1
            ? { titulo: 'La otra diferencia es de la misma factura:', texto: `${unidas}.` }
            : { titulo: `Las otras ${['', '', 'dos', 'tres', 'cuatro'][otras.length] ?? otras.length} diferencias son de la misma factura:`, texto: `${unidas}.` })
        }
        notas.push({ titulo: 'Sumied no sabe por qué ERP10 no la cogió.', texto: 'Solo ve que falta. El motivo lo dice ERP10 al importar.' })
        break
      }
      case 'a_mano':
        avisos.push({ titulo: 'Metida a mano en ERP10.', texto: `${que(a!)} del ${dm(a!.fecha)}, de ${euros(totalDe(a!))}: lo apuntó ${a!.aMano!.quien ?? 'alguien de la cuenta'} el ${dm(a!.aMano!.cuando.slice(0, 10))}. Ya no cuenta como diferencia.`,
          acciones: [], entryId: a!.entryId, tono: 'gris' })
        break
      case 'por_sacar':
        avisos.push({ titulo: 'Todavía no ha salido.', texto: `${que(a!)} del ${dm(a!.fecha)}, de ${euros(totalDe(a!))}, está en lo que sale y no se ha descargado. Sácala en el paso 1.`,
          acciones: [], entryId: a!.entryId, tono: 'ambar' })
        break
      case 'no_pudo':
        avisos.push({ titulo: 'No pudo salir.', texto: `${que(a!)} del ${dm(a!.fecha)}, de ${euros(totalDe(a!))}: ${p.porque ?? 'no pudo salir.'}`,
          acciones: ['a_mano'], entryId: a!.entryId, tono: 'ambar' })
        break
      case 'cambiada':
        avisos.push({ titulo: 'Cambió después de salir.', texto: `Salió a ERP10 y después se anuló en Sumied (el ${dm(a!.fecha)}, ${euros(p.importe)}). ERP10 tiene la de antes: corrígela a mano en ERP10.`,
          acciones: ['a_mano'], entryId: a!.entryId, tono: 'ambar' })
        break
      case 'desconocida':
        avisos.push({ titulo: 'Sumied no sabe explicar esta diferencia.',
          texto: x.soloEnErp10
            ? `ERP10 tiene ${euros(p.importe)} en la ${x.cuenta} y en Sumied no hay nada que lo explique. Mira el mayor de esta cuenta en ERP10.`
            : `Hay ${euros(p.importe)} que no son de nada de lo que salió ni de lo que se ha quedado sin salir. Mira el mayor de esta cuenta en los dos programas.`,
          acciones: [], entryId: null, tono: 'ambar' })
        break
      case 'no_sale_aqui':
        break
    }
  }
  const noSale = x.partidas.filter((p) => p.clase === 'no_sale_aqui')
  if (noSale.length) {
    const total = noSale.reduce((t, p) => t + p.importe, 0)
    avisos.push({ titulo: 'Todavía no sale por aquí.',
      texto: `${noSale.length === 1 ? 'Un asiento' : `${noSale.length} asientos`} de ${euros(total)} que hoy no ${noSale.length === 1 ? 'sale' : 'salen'} a ERP10 (nóminas, bancos, días del TPV o facturas que hay que meter a mano). No es un fallo: se meten en ERP10 como hasta ahora.`,
      acciones: [], entryId: null, tono: 'gris' })
  }
  return { avisos, notas }
}

/** «3 cuentas con diferencia» (las que no quedan igual). */
export const conDiferencia = (n: number) => `${n} ${n === 1 ? 'cuenta con diferencia' : 'cuentas con diferencia'}`

/** La fecha del sumas y saldos: la que traiga el fichero en su cabecera, o el último día del mes. */
export function fechaDelSumas(cabecera: readonly string[], mes: string): string {
  for (const t of cabecera) {
    const m = /(?:hasta|a)\s*(?:fecha)?\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  const [a, mm] = mes.split('-').map(Number)
  const fin = new Date(Date.UTC(a, mm, 0))
  return fin.toISOString().slice(0, 10)
}
