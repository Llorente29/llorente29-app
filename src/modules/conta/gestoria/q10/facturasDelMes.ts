// src/modules/conta/gestoria/q10/facturasDelMes.ts
//
// Q10 · Las facturas de un mes YA COBRADO por GoCardless (noviembre de 2026, de
// las dos empresas de la gestoría: la sociedad y la autónoma), preparadas en
// borrador. Puro: no lee nada.
//
// Lo que decidió Julio (25/11):
//   · una factura por cada cobro del mes que GoCardless da por cobrado
//     (confirmed o paid_out). Los fallidos, pendientes y devueltos no llevan
//     factura: salen aparte, con su motivo;
//   · la fecha de la factura es el día en que se emiten (la misma para todas las
//     de una empresa, nunca futura), y cada una dice «Cuota de noviembre de 2026
//     · cobrada el dd/mm/aaaa» con el día del cobro;
//   · el número sigue la serie de Cegid («2026/1/2745»…), en orden y sin huecos;
//   · La autónoma: retención del 15 % a empresas y autónomos, no a
//     particulares. La de cada cliente sale de su última factura en ERP10; si no
//     se sabe, la factura va a «Pendiente de revisar»;
//   · el total, igual al cobro al céntimo. Si no da, a «Pendiente de revisar».
// Lo que no se puede facturar se dice, no se adivina (regla 7: nada se esconde).

/** Lo que GoCardless da por cobrado. */
export const COBRADO = ['confirmed', 'paid_out'] as const
export const IVA_PCT = 21

export interface CobroQ10 {
  gcId: string
  estado: string
  /** AAAA-MM-DD: el día del cobro. */
  fecha: string
  /** En euros, como lo da GoCardless. */
  importe: number
  suscripcionId: string | null
  mandatoId: string | null
  /** El motivo en palabras que dejó GoCardless (motivo_es), si lo hay. */
  motivo: string | null
}
export interface SuscripcionQ10 { gcId: string; nombre: string | null; gcClienteId: string | null }
export interface MandatoQ10 { gcId: string; gcClienteId: string | null }
export interface EnlaceQ10 { gcClienteId: string; partyId: string | null; estado: string }
export interface FichaQ10 { partyId: string; nombre: string; nif: string | null; direccion: string | null }

export interface EmpresaQ10 {
  id: string
  nombre: string
  /** Una autónoma en estimación directa: sí. Una sociedad: no. */
  retiene: boolean
}

export interface BorradorQ10 {
  cobro: CobroQ10
  ficha: FichaQ10
  /** La línea: el nombre de la suscripción, como en GoCardless (con el del trabajador, si lo lleva). */
  concepto: string
  /** «Cuota de noviembre de 2026 · cobrada el 04/11/2026». */
  texto: string
  baseCent: number
  ivaCent: number
  retencion: { pct: number; cent: number } | null
  totalCent: number
}

export type MotivoPendiente = 'sin_cliente' | 'sin_nif' | 'sin_retencion' | 'sin_suscripcion' | 'no_cuadra'
export interface PendienteQ10 {
  cobro: CobroQ10
  motivo: MotivoPendiente
  /** En palabras, para la pantalla. */
  porque: string
  /** El cliente de GoCardless (su id) y, si está atado, su ficha. */
  gcClienteId: string | null
  ficha: FichaQ10 | null
  concepto: string | null
}
export interface SinFacturaQ10 { cobro: CobroQ10; porque: string; gcClienteId: string | null; ficha: FichaQ10 | null; concepto: string | null }

export interface MesQ10 {
  mes: string
  facturas: BorradorQ10[]
  pendientes: PendienteQ10[]
  /** Lo que GoCardless no dio por cobrado: no lleva factura. */
  sinFactura: SinFacturaQ10[]
  /** Lo que GoCardless cobró (confirmed + paid_out), en céntimos. */
  cobradoCent: number
  facturasCent: number
  pendientesCent: number
  /** La línea de arriba. */
  frase: string
  cuadra: boolean
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const nombreDelMesQ10 = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const cent = (eur: number) => Math.round(eur * 100)
export const eurQ10 = (c: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(c / 100)} €`
const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`

/** «Cuota de noviembre de 2026 · cobrada el 04/11/2026». */
export const textoDeLaCuota = (mes: string, cobradaEl: string) => `Cuota de ${nombreDelMesQ10(mes)} · cobrada el ${dmy(cobradaEl)}`

/**
 * Base, IVA y retención de un total ya cobrado, al céntimo. La base es la que,
 * con el IVA y la retención redondeados cada uno, da EXACTAMENTE el total; si
 * ninguna lo da, null (la factura va a «Pendiente de revisar», nunca a ojo).
 */
export function desglose(totalCent: number, retPct: number, ivaPct = IVA_PCT): { baseCent: number; ivaCent: number; retCent: number } | null {
  const cerca = Math.round(totalCent / (1 + ivaPct / 100 - retPct / 100))
  for (const baseCent of [cerca, cerca - 1, cerca + 1]) {
    const ivaCent = Math.round((baseCent * ivaPct) / 100)
    const retCent = Math.round((baseCent * retPct) / 100)
    if (baseCent > 0 && baseCent + ivaCent - retCent === totalCent) return { baseCent, ivaCent, retCent }
  }
  return null
}

const SIN_FACTURA: Record<string, string> = {
  failed: 'Fallido: GoCardless no lo pudo cobrar',
  charged_back: 'Devuelto por el banco del cliente',
  cancelled: 'Cancelado: no se llegó a cobrar',
  customer_approval_denied: 'El cliente no lo aprobó',
  pending_customer_approval: 'Pendiente: esperando a que el cliente lo apruebe',
  pending_submission: 'Pendiente: aún no se ha mandado al banco',
  submitted: 'Pendiente: mandado al banco, aún sin cobrar',
}
export const porqueSinFactura = (c: CobroQ10) =>
  `${SIN_FACTURA[c.estado] ?? `GoCardless dice «${c.estado}»: no está cobrado`}${c.motivo ? ` (${c.motivo})` : ''}. No lleva factura.`

const PORQUE: Record<MotivoPendiente, string> = {
  sin_cliente: 'El cobro no tiene su cliente atado a una ficha: átalo en «Cobros de GoCardless sin cliente».',
  sin_nif: 'La ficha no tiene NIF: una factura lo lleva. Ponlo en su ficha.',
  sin_retencion: 'No se sabe si lleva retención: su última factura en ERP10 no lo dice (o no tiene ninguna).',
  sin_suscripcion: 'Es un cobro suelto, sin suscripción: GoCardless no dice qué servicio es, y no se adivina.',
  no_cuadra: 'Con el IVA y la retención, ninguna base da el total al céntimo.',
}

export interface EntradaQ10 {
  mes: string
  empresa: EmpresaQ10
  cobros: readonly CobroQ10[]
  suscripciones: readonly SuscripcionQ10[]
  mandatos: readonly MandatoQ10[]
  enlaces: readonly EnlaceQ10[]
  fichas: readonly FichaQ10[]
  /**
   * La retención de cada ficha (por party_id), de su última factura en ERP10:
   * 15, 0… Solo cuenta si la empresa retiene. Sin la ficha en el mapa: no se sabe.
   */
  retenciones: ReadonlyMap<string, number>
}

/** Las facturas del mes, en el orden en que se numeran: por el día del cobro, el cliente y el cobro. */
export function facturasDelMes(e: EntradaQ10): MesQ10 {
  const delMes = e.cobros.filter((c) => c.fecha.slice(0, 7) === e.mes)
  const sus = new Map(e.suscripciones.map((s) => [s.gcId, s]))
  const man = new Map(e.mandatos.map((m) => [m.gcId, m]))
  const enl = new Map(e.enlaces.map((x) => [x.gcClienteId, x]))
  const fic = new Map(e.fichas.map((f) => [f.partyId, f]))
  const facturas: BorradorQ10[] = []
  const pendientes: PendienteQ10[] = []
  const sinFactura: SinFacturaQ10[] = []
  for (const c of delMes) {
    const s = c.suscripcionId ? sus.get(c.suscripcionId) ?? null : null
    const gcClienteId = s?.gcClienteId ?? (c.mandatoId ? man.get(c.mandatoId)?.gcClienteId ?? null : null)
    const enlace = gcClienteId ? enl.get(gcClienteId) : undefined
    const ficha = enlace?.estado === 'atado' && enlace.partyId ? fic.get(enlace.partyId) ?? null : null
    const concepto = s?.nombre?.replace(/\s+/g, ' ').trim() || null
    if (!(COBRADO as readonly string[]).includes(c.estado)) {
      sinFactura.push({ cobro: c, porque: porqueSinFactura(c), gcClienteId, ficha, concepto })
      continue
    }
    const pendiente = (motivo: MotivoPendiente) => pendientes.push({ cobro: c, motivo, porque: PORQUE[motivo], gcClienteId, ficha, concepto })
    if (!ficha) { pendiente('sin_cliente'); continue }
    if (!ficha.nif?.trim()) { pendiente('sin_nif'); continue }
    if (!concepto) { pendiente('sin_suscripcion'); continue }
    const retPct = e.empresa.retiene ? e.retenciones.get(ficha.partyId) : 0
    if (retPct === undefined) { pendiente('sin_retencion'); continue }
    const totalCent = cent(c.importe)
    const d = desglose(totalCent, retPct)
    if (!d) { pendiente('no_cuadra'); continue }
    facturas.push({
      cobro: c, ficha, concepto, texto: textoDeLaCuota(e.mes, c.fecha),
      baseCent: d.baseCent, ivaCent: d.ivaCent, retencion: retPct > 0 ? { pct: retPct, cent: d.retCent } : null, totalCent,
    })
  }
  facturas.sort((a, b) => a.cobro.fecha.localeCompare(b.cobro.fecha) || a.ficha.nombre.localeCompare(b.ficha.nombre, 'es') || a.cobro.gcId.localeCompare(b.cobro.gcId))
  const suma = (xs: readonly { cobro: CobroQ10 }[]) => xs.reduce((t, x) => t + cent(x.cobro.importe), 0)
  const cobradoCent = suma(delMes.filter((c) => (COBRADO as readonly string[]).includes(c.estado)).map((cobro) => ({ cobro })))
  const facturasCent = facturas.reduce((t, f) => t + f.totalCent, 0)
  const pendientesCent = suma(pendientes)
  const cuadra = pendientes.length === 0 && facturasCent === cobradoCent
  const mes = MESES[Number(e.mes.slice(5, 7)) - 1]
  const Mes = mes[0].toUpperCase() + mes.slice(1)
  const frase = `${Mes}: ${n(facturas.length, 'factura', 'facturas')}, ${eurQ10(facturasCent)}. GoCardless cobró ${eurQ10(cobradoCent)}. `
    + (cuadra ? 'Cuadra.' : `Faltan ${pendientes.length} (${eurQ10(pendientesCent)}): mira abajo.`)
  return { mes: e.mes, facturas, pendientes, sinFactura, cobradoCent, facturasCent, pendientesCent, frase, cuadra }
}

// ── La numeración y la fecha de emisión ─────────────────────────────────────────

/** «2026/1/2745»: el año, la serie y el número, como en Cegid. */
export const numeroQ10 = (anio: number, serie: string, numero: number) => `${anio}/${serie}/${numero}`

/** El número de una factura de ERP10 («2026/1/2744», «2026/1/002744»…) partido; null si no es de esa forma. */
export function partirNumero(texto: string): { anio: number; serie: string; numero: number } | null {
  const m = /^\s*(\d{4})\s*\/\s*([^/\s]+)\s*\/\s*0*(\d+)\s*$/.exec(texto)
  return m ? { anio: Number(m[1]), serie: m[2], numero: Number(m[3]) } : null
}

/**
 * Antes de emitir: el último número de la serie en ERP10 tiene que ser el de
 * antes del primero que va a poner Sumied. Si no, PARA y lo dice (Julio, 25/11).
 */
export function comprobarSerie(numerosEnErp10: readonly string[], esperado: { anio: number; serie: string; desde: number }): { ok: boolean; frase: string; ultimo: number | null } {
  const de = numerosEnErp10.map(partirNumero).filter((x): x is NonNullable<typeof x> => !!x && x.anio === esperado.anio && x.serie === esperado.serie)
  const ultimo = de.length ? Math.max(...de.map((x) => x.numero)) : null
  const antes = numeroQ10(esperado.anio, esperado.serie, esperado.desde - 1)
  if (ultimo === null) return { ok: false, ultimo, frase: `En ERP10 no hay ninguna factura de la serie ${esperado.anio}/${esperado.serie}: se esperaba la ${antes} como última. No se emite.` }
  if (ultimo !== esperado.desde - 1) {
    return { ok: false, ultimo, frase: `La última factura de la serie en ERP10 es la ${numeroQ10(esperado.anio, esperado.serie, ultimo)}, y se esperaba la ${antes}. No se emite hasta que cuadre.` }
  }
  return { ok: true, ultimo, frase: `La última factura en ERP10 es la ${antes}: la primera de Sumied será la ${numeroQ10(esperado.anio, esperado.serie, esperado.desde)}.` }
}

/** Los números de las facturas, en su orden: seguidos y sin huecos. */
export function numerar(facturas: readonly BorradorQ10[], anio: number, serie: string, desde: number): string[] {
  return facturas.map((_, i) => numeroQ10(anio, serie, desde + i))
}

/** La fecha de emisión: el día en que se pulsa «Emitir» (nunca futura) y nunca antes de la última factura de la serie. */
export function comprobarFecha(fecha: string, hoy: string, ultimaDeLaSerie: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Falta la fecha de las facturas.'
  if (fecha > hoy) return `La fecha ${dmy(fecha)} es futura: las facturas llevan el día en que se emiten (${dmy(hoy)}).`
  if (fecha !== hoy) return `Las facturas llevan el día en que se emiten (${dmy(hoy)}), no el ${dmy(fecha)}.`
  if (ultimaDeLaSerie && fecha < ultimaDeLaSerie) return `La última factura de la serie es del ${dmy(ultimaDeLaSerie)}: estas no pueden ir antes.`
  return null
}

// ── La retención de cada cliente, de su última factura en ERP10 ─────────────────

/** Lo que hace falta de una factura de ERP10 (FacturaT de _shared/erp10Traer.ts). */
export interface FacturaErp10Q10 {
  /** La cuenta del cliente (430…): las de otra cuenta son recibidas. */
  cuenta: string
  nif: string
  numero: string
  /** AAAAMMDD, como lo da ERP10 (la de la factura o, sin ella, la del asiento). */
  fecha: number
  retencion: { tipo: number | null; importe: number } | null
}

export const nifLimpio = (nif: string | null | undefined) => (nif ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^ES(?=[0-9A-Z]{9}$)/, '')

/**
 * La retención de la ÚLTIMA factura emitida de cada cliente en ERP10, por su
 * NIF: su tipo (15, 7…) o 0 si no llevaba. Un cliente sin factura en ERP10 no
 * está en el mapa: no se sabe, y su factura va a «Pendiente de revisar».
 * Una retención con importe y sin tipo tampoco se sabe.
 */
export function retencionesDeErp10(facturas: readonly FacturaErp10Q10[], fichas: readonly FichaQ10[]): Map<string, number> {
  const ultima = new Map<string, FacturaErp10Q10>()
  for (const f of facturas) {
    if (!f.cuenta.startsWith('43')) continue
    const k = nifLimpio(f.nif)
    if (!k) continue
    const ya = ultima.get(k)
    const n = partirNumero(f.numero)?.numero ?? 0
    const nYa = ya ? partirNumero(ya.numero)?.numero ?? 0 : -1
    if (!ya || f.fecha > ya.fecha || (f.fecha === ya.fecha && n > nYa)) ultima.set(k, f)
  }
  const r = new Map<string, number>()
  for (const ficha of fichas) {
    const f = ultima.get(nifLimpio(ficha.nif))
    if (!f) continue
    if (!f.retencion || !f.retencion.importe) r.set(ficha.partyId, 0)
    else if (f.retencion.tipo) r.set(ficha.partyId, f.retencion.tipo)
  }
  return r
}

/** La última factura de un año en lo leído de ERP10 (la de número más alto), para una empresa sin serie esperada. */
export function ultimaDeErp10(numeros: readonly string[], anio: number): { anio: number; serie: string; numero: number } | null {
  let r: { anio: number; serie: string; numero: number } | null = null
  for (const x of numeros.map(partirNumero)) if (x && x.anio === anio && (!r || x.numero > r.numero)) r = x
  return r
}
