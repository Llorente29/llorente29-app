// src/modules/conta/lib/libro.ts
//
// C04 · Las reglas del libro diario, puras. Lo que comprueba la base al validar
// (0120, journal_entry_validar) se comprueba aquí igual, para decirlo en
// pantalla ANTES de pulsar: cuánto descuadra y dónde, qué apunte de IVA no
// cuadra, qué apunte no tiene local. La base sigue siendo la que manda.
//
//   Regla 1 · cuadra al céntimo, o dice cuánto y en qué lado falta.
//   Regla 2 · número siguiente de su serie, sin huecos (lo pone la base).
//   Regla 3 · lo validado no se toca: el contraasiento le da la vuelta.
//   Regla 4 · fecha en un ejercicio abierto, fuera de lo traído y de un mes
//             cerrado; si no, el primer día abierto (nunca se cuela).
//   Regla 5 · cuota = base × tipo al céntimo, redondeando por factura: un
//             asiento resumen de n facturas admite medio céntimo por factura.
//   Regla 9 · local o «común» en cada apunte; el resultado por local suma el
//             total, también repartiendo lo común.
//   Regla 10 · confianza Seguro / Probable / Duda con porqué; nunca valida
//             sola salvo la opción de la empresa para los Seguros de ventas.
//
// Las series se guardan con el código de Diez (para traerlo sin traducir) y en
// pantalla se dicen por su palabra (respuesta 1 de Julio).

import { eurosExactos } from './formato'

export type Serie = 1 | 2 | 3 | 4 | 9
export const NOMBRE_SERIE: Record<Serie, string> = { 1: 'Ventas', 2: 'Compras', 3: 'Banco', 4: 'General', 9: 'Nóminas' }
export const SERIES: readonly Serie[] = [1, 2, 3, 9, 4]

export type LibroIva = 'issued' | 'received' | 'investment' | 'not_subject'
export type Confianza = 'seguro' | 'probable' | 'duda'
export const NOMBRE_CONFIANZA: Record<Confianza, string> = { seguro: 'Seguro', probable: 'Probable', duda: 'Duda' }

export interface IvaApunte {
  tipoId: string
  /** En porcentaje: 10 = 10 %. */
  tipo: number
  base: number
  libro: LibroIva
  deducible?: 'yes' | 'no' | 'prorrata'
  /** Cuántas facturas resume este apunte (asiento resumen, RIVA 63.4). 1 si es una. */
  facturas?: number
}
/** La retención que nace (factura, nómina, alquiler): su tipo, su base y su modelo. */
export interface RetencionNace { tipoId: string; tipo: number; base: number; modelo: '111' | '115' | '123'; periodo?: undefined }
/** S01d · El pago, la compensación o la devolución de un modelo: su modelo y su periodo («2026-3T»), sin tipo ni base. */
export interface RetencionPago { modelo: '111' | '115' | '123'; periodo: string; tipoId?: undefined }
export type RetencionApunte = RetencionNace | RetencionPago

export interface LineaAsiento {
  /** Código de la cuenta de la empresa (company_account.code). */
  cuenta: string
  debe: number
  haber: number
  concepto?: string
  localId: string | null
  comun?: boolean
  marcaId?: string | null
  terceroId?: string | null
  documento?: string | null
  iva?: IvaApunte
  retencion?: RetencionApunte
}

export interface Razon { decision: string; porque: string; cita?: string }

export interface Propuesta {
  serie: Serie
  fecha: string
  concepto: string
  origen: { tipo: OrigenAsiento; id: string | null }
  lineas: LineaAsiento[]
  confianza: Confianza
  /** El porqué en una frase (la del listado). */
  porque: string
  /** Una frase por decisión, con la cita cuando hay norma (N12 «Por qué lo propongo así»). */
  razones: Razon[]
  terceroId?: string | null
  documento?: string | null
  /** Lo que la persona tiene que mirar antes de validar. */
  avisos: string[]
}

export type OrigenAsiento =
  | 'sales_day' | 'sales_adjustment' | 'supplier_invoice' | 'supplier_payment' | 'channel_settlement'
  | 'licensed_settlement' | 'payroll' | 'bank' | 'vat_settlement' | 'manual' | 'template' | 'reversal' | 'opening' | 'closing' | 'migrated'
  // Compras (10/10): lo recibido sin factura al cierre del mes, y su contrario el día 1.
  | 'purchase_accrual' | 'purchase_accrual_reversal'
  // V01: una factura de venta emitida en Sumied (y el cobro en efectivo de una).
  | 'customer_invoice'
  // S01: el cobro de una factura por el enlace de pago (la pasarela contra la 430).
  | 'customer_payment'

// ── Céntimos ────────────────────────────────────────────────────────────────

/** A céntimos enteros, redondeando la mitad hacia fuera (como round() en la base). */
export const cent = (x: number): number => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9)
export const deCent = (c: number): number => c / 100
export const red2 = (x: number): number => deCent(cent(x))

/** Regla 5 · la cuota de una base a un tipo, al céntimo. */
export function cuotaIva(base: number, tipo: number): number {
  return deCent(Math.sign(base) * Math.round(Math.abs(cent(base) * tipo) / 100 + 1e-9))
}

/** Regla 5 · la base y la cuota de un total con el impuesto dentro (un ticket a un tipo). */
export function baseDeTotal(total: number, tipo: number): { base: number; cuota: number } {
  const base = deCent(Math.sign(total) * Math.round(Math.abs(cent(total)) * 100 / (100 + tipo) + 1e-9))
  return { base, cuota: red2(total - base) }
}

// ── Regla 1 · cuadra ────────────────────────────────────────────────────────

/**
 * El estado del cuadre, una sola fuente para lo que dice el pie (S01c):
 *   · 'vacio'     — no hay importes (todo a cero): «Faltan importes», neutro;
 *   · 'descuadre' — Debe ≠ Haber: «No cuadra: faltan X € en el Haber/Debe»;
 *   · 'cuadra'    — Debe = Haber y > 0: «Cuadra · N €».
 */
export type EstadoCuadre = 'vacio' | 'descuadre' | 'cuadra'

export interface Cuadre { estado: EstadoCuadre; cuadra: boolean; debe: number; haber: number; diferencia: number; texto: string }

export function cuadre(lineas: readonly Pick<LineaAsiento, 'debe' | 'haber'>[]): Cuadre {
  const d = lineas.reduce((t, l) => t + cent(l.debe), 0)
  const h = lineas.reduce((t, l) => t + cent(l.haber), 0)
  const dif = d - h
  const estado: EstadoCuadre = dif !== 0 ? 'descuadre' : d > 0 ? 'cuadra' : 'vacio'
  const texto = estado === 'cuadra'
    ? `Cuadra · ${eurosExactos(deCent(d))}`
    : estado === 'descuadre'
      ? `No cuadra: faltan ${eurosExactos(deCent(Math.abs(dif)))} en el ${dif > 0 ? 'Haber' : 'Debe'}`
      : 'Faltan importes'
  return { estado, cuadra: estado === 'cuadra', debe: deCent(d), haber: deCent(h), diferencia: deCent(dif), texto }
}

// ── S01d · El periodo de un modelo ──────────────────────────────────────────

/** «2026-3T», «2026-01» o «2026-0A» (el año entero): lo mismo que la base (journal_line.withholding_period). */
export const PERIODO_MODELO = /^[0-9]{4}-([1-4]T|0[1-9]|1[0-2]|0A)$/

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «3T 2026», «enero de 2026» o «año 2026». */
export function periodoEnPalabras(periodo: string): string {
  const [a, p] = periodo.split('-')
  if (p === '0A') return `año ${a}`
  if (/^[1-4]T$/.test(p)) return `${p} ${a}`
  const m = Number(p)
  return m >= 1 && m <= 12 ? `${MESES_LARGOS[m - 1]} de ${a}` : periodo
}

/** «111 · 3T 2026». */
export const modeloYPeriodo = (modelo: string, periodo: string): string => `${modelo} · ${periodoEnPalabras(periodo)}`

// ── Lo que la base no dejaría validar, dicho antes ──────────────────────────

/** Los problemas de cada apunte (reglas 1, 5 y 9), en frases. Vacío = se puede validar. */
export function problemas(lineas: readonly LineaAsiento[], esDeIva: (cuenta: string) => boolean, esRetencion: (cuenta: string) => boolean): string[] {
  const out: string[] = []
  if (lineas.length < 2) out.push('Un asiento lleva al menos dos apuntes.')
  const c = cuadre(lineas)
  if (!c.cuadra) out.push(c.debe === 0 && c.haber === 0 ? 'El asiento está a cero.' : `${c.texto}.`)
  lineas.forEach((l, i) => {
    const n = `Apunte ${i + 1} (${l.cuenta})`
    if ((cent(l.debe) > 0) === (cent(l.haber) > 0)) out.push(`${n}: va al Debe o al Haber, uno de los dos.`)
    if (cent(l.debe) < 0 || cent(l.haber) < 0) out.push(`${n}: los importes van en positivo; el lado dice el signo.`)
    if (esDeIva(l.cuenta) && !l.iva) out.push(`${n}: un apunte de IVA lleva base, tipo y libro registro.`)
    if (l.iva) {
      const cuota = cent(l.debe) + cent(l.haber)
      const esperada = cent(cuotaIva(l.iva.base, l.iva.tipo))
      // Medio céntimo por factura de un resumen y, en cualquier apunte, un céntimo de
      // redondeo (C06b, 15/10: 20,40 € con el IVA dentro al 10 % da 18,55 + 1,85).
      const margen = Math.max(1, Math.floor((l.iva.facturas ?? 1) / 2))
      if (Math.abs(cuota - esperada) > margen) {
        out.push(`${n}: la cuota ${eurosExactos(deCent(cuota))} no es la base ${eurosExactos(l.iva.base)} × ${l.iva.tipo} % = ${eurosExactos(deCent(esperada))}.`)
      }
    }
    if (esRetencion(l.cuenta) && !l.retencion) out.push(`${n}: una retención lleva su tipo, su base y su modelo; el pago o la compensación de un modelo, su modelo y su periodo.`)
    if (l.retencion && l.retencion.periodo !== undefined && !PERIODO_MODELO.test(l.retencion.periodo)) out.push(`${n}: el periodo «${l.retencion.periodo}» no es un trimestre (3T), un mes ni el año.`)
    if (!l.comun && !l.localId) out.push(`${n}: falta el local (o marcarlo como común).`)
    if (l.comun && l.localId) out.push(`${n}: o lleva local o es común, no las dos.`)
  })
  return out
}

// ── Regla 2 · numeración sin huecos ─────────────────────────────────────────

export function siguienteNumero(numeros: readonly number[]): number {
  return numeros.reduce((m, n) => Math.max(m, n), 0) + 1
}

/** Los huecos de una serie (el agente los busca): números que faltan entre 1 y el máximo. */
export function huecos(numeros: readonly number[]): number[] {
  const hay = new Set(numeros)
  const max = siguienteNumero(numeros) - 1
  const out: number[] = []
  for (let i = 1; i <= max; i++) if (!hay.has(i)) out.push(i)
  return out
}

// ── Regla 3 · el contraasiento ──────────────────────────────────────────────

export function contraasiento(lineas: readonly LineaAsiento[]): LineaAsiento[] {
  return lineas.map((l) => ({ ...l, debe: l.haber, haber: l.debe }))
}

// ── Regla 4 · la fecha ──────────────────────────────────────────────────────

export interface CalendarioEmpresa {
  ejercicios: readonly { code: string; inicio: string; fin: string; abierto: boolean; traidoHasta: string | null }[]
  /** Meses cerrados, 'YYYY-MM'. */
  mesesCerrados: readonly string[]
}

const masUnDia = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function diaAbierto(fecha: string, c: CalendarioEmpresa): boolean {
  const e = c.ejercicios.find((x) => fecha >= x.inicio && fecha <= x.fin)
  return !!e && e.abierto && (!e.traidoHasta || fecha > e.traidoHasta) && !c.mesesCerrados.includes(fecha.slice(0, 7))
}

/** El primer día abierto desde esa fecha (400 días como mucho). null si no hay. */
export function primerDiaAbierto(fecha: string, c: CalendarioEmpresa): string | null {
  let f = fecha
  for (let i = 0; i <= 400; i++, f = masUnDia(f)) if (diaAbierto(f, c)) return f
  return null
}

/** La fecha que se propone y, si no es la del documento, por qué (nunca se cuela). */
export function fechaPropuesta(fecha: string, c: CalendarioEmpresa): { fecha: string | null; aviso: string | null } {
  if (diaAbierto(fecha, c)) return { fecha, aviso: null }
  const f = primerDiaAbierto(fecha, c)
  const e = c.ejercicios.find((x) => fecha >= x.inicio && fecha <= x.fin)
  const motivo = !e ? 'no hay ejercicio para esa fecha'
    : e.traidoHasta && fecha <= e.traidoHasta ? `hasta el ${e.traidoHasta.split('-').reverse().join('/')} el ejercicio es traído`
      : !e.abierto ? `el ejercicio ${e.code} está cerrado` : `el mes ${fecha.slice(5, 7)}/${fecha.slice(0, 4)} está cerrado`
  return { fecha: f, aviso: f ? `El documento es del ${fecha.split('-').reverse().join('/')}, pero ${motivo}: lo propongo el ${f.split('-').reverse().join('/')}.` : `No hay ningún día abierto para asentarlo: ${motivo}.` }
}

/**
 * D07b · El aviso ámbar de una recibida de un periodo cerrado, con las dos
 * fechas: la de la factura (que conserva) y la del asiento (el primer día
 * abierto, donde va su IVA).
 */
export function avisoPeriodoCerrado(fechaFactura: string, fechaAsiento: string): string {
  const es = (x: string) => x.split('-').reverse().join('/')
  const t = Math.floor((Number(fechaAsiento.slice(5, 7)) - 1) / 3) + 1
  return `La factura es del ${es(fechaFactura)}, en un periodo ya cerrado: se asienta el ${es(fechaAsiento)}, el primer día abierto. Conserva su fecha de factura en el libro de IVA y su IVA va al ${t}T ${fechaAsiento.slice(0, 4)}.`
}

/**
 * V04 · Regla de Julio (27/10): una factura recibida nunca se asienta antes del
 * día en que entró, aunque su mes esté abierto: así el asiento y su IVA caen en
 * el mismo trimestre (su libro la registra el día que entró). `entro` es el día
 * en Madrid (diaDeEntrada). Lo mismo hace la base al proponer (1350).
 */
export function fechaDeLaRecibida(fechaFactura: string, entro: string | null): { fecha: string; aviso: string | null } {
  if (!entro || entro <= fechaFactura) return { fecha: fechaFactura, aviso: null }
  const dm = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}`
  return { fecha: entro, aviso: `Esta factura entró el ${dm(entro)}: se contabiliza el ${dm(entro)}.` }
}

/** El día (AAAA-MM-DD) en Madrid de un instante: el día en que entró una factura. */
export function diaDeEntrada(creadaEn: string | null | undefined): string | null {
  if (!creadaEn) return null
  const d = new Date(creadaEn)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

// ── Regla 9 · el resultado por local suma el total ──────────────────────────

export interface ApunteResultado { cuenta: string; debe: number; haber: number; localId: string | null }
export interface Reparto { localId: string; pct: number }

/**
 * Ingresos (7) menos gastos (6) por local. Lo común se reparte con la regla si
 * suma 100 %; el último local se lleva el redondeo, así la suma es exacta.
 */
export function resultadoPorLocal(apuntes: readonly ApunteResultado[], reparto: readonly Reparto[] = []): { porLocal: Map<string | null, number>; total: number } {
  const porLocal = new Map<string | null, number>()
  let total = 0
  for (const a of apuntes) {
    const g = a.cuenta[0]
    if (g !== '6' && g !== '7') continue
    const r = cent(a.haber) - cent(a.debe)
    total += r
    porLocal.set(a.localId, (porLocal.get(a.localId) ?? 0) + r)
  }
  const comun = porLocal.get(null) ?? 0
  const suma = reparto.reduce((t, r) => t + Math.round(r.pct * 10000), 0)
  if (comun !== 0 && suma === 1_000_000) {
    porLocal.delete(null)
    let repartido = 0
    reparto.forEach((r, i) => {
      const parte = i === reparto.length - 1 ? comun - repartido : Math.round((comun * r.pct) / 100)
      repartido += parte
      porLocal.set(r.localId, (porLocal.get(r.localId) ?? 0) + parte)
    })
  }
  return { porLocal: new Map([...porLocal].map(([k, v]) => [k, deCent(v)])), total: deCent(total) }
}

// ── Regla 10 · confianza y si valida sola ───────────────────────────────────

/** La peor de varias: basta una duda para que todo sea duda. */
export function peor(...cs: Confianza[]): Confianza {
  return cs.includes('duda') ? 'duda' : cs.includes('probable') ? 'probable' : 'seguro'
}

/** Nunca valida sola, salvo la opción de la empresa (apagada por defecto) para los Seguros de ventas del día. */
export function validaSola(p: Pick<Propuesta, 'origen' | 'confianza' | 'avisos'>, validarSegurosDeVentas: boolean): boolean {
  return validarSegurosDeVentas && p.origen.tipo === 'sales_day' && p.confianza === 'seguro' && p.avisos.length === 0
}
