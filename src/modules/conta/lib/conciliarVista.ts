// src/modules/conta/lib/conciliarVista.ts
//
// B02 · Lo que enseña «Bancos · Conciliar» (maqueta N17b), sin React ni base.
// De UNA lectura de los movimientos del mes salen a la vez el cuadre de
// arriba, la barra, la banda y los contadores de las bandejas: cuentan con la
// misma vara y no pueden decir cosas distintas (regla 31; lo comprueba
// tests/unit/modules/conta/conciliarVistaB02.test.ts).
//
// También: qué viene preseleccionado (el punto verde), el buscador, las filas
// por día con los iguales juntos, las facturas de la contraparte del panel
// lateral y el asiento que se crea al confirmar.
//
// Un umbral ordena, no esconde (regla 7): «Todos» enseña todas las filas; las
// otras bandejas filtran porque se piden.

import { normal, nombra, type Destino } from '@/modules/conta/lib/conciliacion'
import { nombreMes, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'

export type Bandeja = 'confirmar' | 'aclarar' | 'casados' | 'todos'
export const BANDEJAS: { id: Bandeja; nombre: string }[] = [
  { id: 'confirmar', nombre: 'Para confirmar' }, { id: 'aclarar', nombre: 'Por aclarar' }, { id: 'casados', nombre: 'Casados solos' }, { id: 'todos', nombre: 'Todos' },
]

/** En qué bandeja cae un movimiento (además de «Todos», donde están todos). */
export function bandejaDe(m: MovimientoBanco): Exclude<Bandeja, 'todos'> | null {
  if (m.estado === 'propuesto') return 'confirmar'
  if (m.estado === 'por_aclarar' || m.estado === 'pendiente' || m.estado === 'posible_repetido') return 'aclarar'
  if (m.estado === 'casado' && m.casado?.porQuien === 'folvy') return 'casados'
  return null
}

/** Lo que se puede confirmar tal cual: tiene destino, no falta el ticket y no hay que elegir entre dos. */
export function confirmable(m: MovimientoBanco): boolean {
  const p = m.propuesta
  return m.estado === 'propuesto' && !!p?.destino && !(p.pideTicket && !m.ticket) && !(p.alternativas?.length)
}

/**
 * El punto verde: «lo casaría solo, pero aún no puedo». Viene marcado para
 * confirmar en bloque. Nunca una factura sin aprobar (decisión de Julio).
 */
export function preseleccionado(m: MovimientoBanco): boolean {
  return confirmable(m) && !!m.propuesta?.preseleccionar && !m.propuesta.facturaSinAprobar
}

export interface Cuadre {
  /** Lo que dice el banco (el último extracto con saldo del mes), o null si no lo hay. */
  bancoCent: number | null
  /** Lo que dice la 572 del banco a la misma fecha, o null si el banco no tiene su cuenta. */
  libroCent: number | null
  /** En el banco − en contabilidad = te falta por casar. */
  faltaCent: number | null
  /** Lo que suman los movimientos sin casar (si es igual a lo que falta, cuadra en cuanto se casen). */
  sinCasarCent: number
  cuenta: Record<Bandeja, number>
  /** B02 · Los traspasos que esperan el extracto de otra cuenta: no cuentan por aclarar, pero se dicen. */
  esperan: { n: number; de: string[] }
  /** Los que vienen marcados para confirmar en bloque. */
  preseleccionados: string[]
  /** La banda, en primera persona. */
  frase: string
}

/** El cuadre, la barra, la banda y los contadores de las bandejas, de una sola lectura. */
export function cuadreDe(movs: readonly MovimientoBanco[], bancoCent: number | null, libroCent: number | null, mes: string): Cuadre {
  const cuenta: Record<Bandeja, number> = { confirmar: 0, aclarar: 0, casados: 0, todos: movs.length }
  for (const m of movs) { const b = bandejaDe(m); if (b) cuenta[b]++ }
  const sinCasarCent = movs.filter((m) => m.estado !== 'casado' && m.estado !== 'ignorado').reduce((t, m) => t + m.importeCent, 0)
  const nombre = nombreMes(mes).toLowerCase()
  const esperan = esperanDe(movs)
  const frase = movs.length === 0
    ? `No hay movimientos de ${nombre}: sube el extracto y los miro.`
    : `He casado yo ${cuenta.casados} de ${movs.length} movimientos de ${nombre}. ${cuenta.confirmar || cuenta.aclarar
      ? `Te quedan ${cuenta.confirmar} por confirmar y ${cuenta.aclarar} por aclarar.`
      : esperan.n ? 'No te queda nada por confirmar ni por aclarar.' : 'No te queda nada.'}${esperan.n ? ` ${fraseEsperan(esperan)}` : ''}`
  return {
    bancoCent, libroCent, faltaCent: bancoCent === null || libroCent === null ? null : bancoCent - libroCent, sinCasarCent,
    cuenta, esperan, preseleccionados: movs.filter(preseleccionado).map((m) => m.id), frase,
  }
}

/** B02 · Cuántos traspasos esperan el extracto de otra cuenta, y de cuáles («···0133»). */
export function esperanDe(movs: readonly Pick<MovimientoBanco, 'estado' | 'propuesta'>[]): { n: number; de: string[] } {
  const suyos = movs.filter((m) => m.estado === 'espera_extracto')
  return { n: suyos.length, de: [...new Set(suyos.map((m) => m.propuesta?.esperaExtracto ?? 'otra cuenta'))].sort() }
}

/** «1 movimiento espera el extracto de ···0133.» / «3 movimientos esperan el extracto de ···0133 y ···6536.» */
export function fraseEsperan(e: { n: number; de: string[] }): string {
  const de = e.de.length > 1 ? `${e.de.slice(0, -1).join(', ')} y ${e.de.at(-1)}` : e.de[0] ?? 'otra cuenta'
  return e.n === 1 ? `1 movimiento espera el extracto de ${de}.` : `${e.n} movimientos esperan el extracto de ${de}.`
}

/**
 * Quién: el nombre limpio de la contraparte; si no la hay, lo que dice el banco
 * limpio; y si el banco solo trae su etiqueta (un Norma 43 cuyos 23 la repiten:
 * va al tipo), la etiqueta. Nunca una fila sin nombre.
 */
export const quienEs = (m: MovimientoBanco) => m.contraparte?.trim() || m.conceptoLimpio.trim() || m.tipo?.trim() || 'Sin texto del banco'

/** Lo que dice el banco tal cual: el concepto, o su etiqueta si es lo único que trae. */
export const textoDelBanco = (m: MovimientoBanco) => m.conceptoBanco.trim() || m.tipo?.trim() || ''

/** «12,50», «-12.5», «1.234,56», «1234» → céntimos; null si no es un importe. */
export function importeBuscado(q: string): number | null {
  const t = q.trim().replace(/\s|€/g, '').replace(/^[+-]/, '')
  if (!/^\d[\d.,]*$/.test(t)) return null
  const coma = t.lastIndexOf(',')
  const punto = t.lastIndexOf('.')
  let n: string
  if (coma > punto) n = t.replace(/\./g, '').replace(',', '.')
  else if (punto > -1 && t.length - punto - 1 <= 2) n = t.replace(/,/g, '')
  else n = t.replace(/[.,]/g, '')
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) : null
}

/** El buscador: por nombre, por importe o por lo que dice el banco. */
export function coincide(m: MovimientoBanco, q: string): boolean {
  const t = normal(q)
  if (!t) return true
  const cent = importeBuscado(q)
  if (cent !== null && Math.abs(m.importeCent) === cent) return true
  return [quienEs(m), textoDelBanco(m), m.propuesta?.que ?? '', m.casado?.asientoConcepto ?? ''].some((x) => normal(x).includes(t))
}

export interface Grupo {
  /** El primero del grupo: el que se enseña. */
  m: MovimientoBanco
  /** Todos los del grupo (uno, o los iguales seguidos). */
  ids: string[]
}
export interface Dia { fecha: string; grupos: Grupo[] }

/** Dos movimientos son «iguales» si son de quien es, por lo mismo, en el mismo estado y con la misma propuesta. */
function iguales(a: MovimientoBanco, b: MovimientoBanco): boolean {
  return a.fecha === b.fecha && a.importeCent === b.importeCent && a.estado === b.estado && a.estado !== 'casado'
    && normal(quienEs(a)) === normal(quienEs(b)) && normal(a.conceptoBanco) === normal(b.conceptoBanco)
    && (a.propuesta?.que ?? null) === (b.propuesta?.que ?? null)
    && JSON.stringify(a.propuesta?.destino ?? null) === JSON.stringify(b.propuesta?.destino ?? null)
}

/** Las filas por día (en el orden en que llegan), con los iguales seguidos en una sola fila. */
export function porDia(movs: readonly MovimientoBanco[]): Dia[] {
  const dias: Dia[] = []
  for (const m of movs) {
    let d = dias[dias.length - 1]
    if (!d || d.fecha !== m.fecha) { d = { fecha: m.fecha, grupos: [] }; dias.push(d) }
    const ultimo = d.grupos[d.grupos.length - 1]
    if (ultimo && iguales(ultimo.m, m)) ultimo.ids.push(m.id)
    else d.grupos.push({ m, ids: [m.id] })
  }
  return dias
}

// ── El panel lateral ────────────────────────────────────────────────────────

export interface FacturaParaCasar {
  id: string; numero: string | null; fecha: string; totalCent: number; pagadoCent: number; proveedor: string; alias: string[]
  terceroId: string | null; cuentaTercero: string | null; enRevision: boolean
}

/** Las facturas pendientes de la contraparte del movimiento (por cualquiera de sus nombres). */
export function facturasDe(m: MovimientoBanco, facturas: readonly FacturaParaCasar[]): FacturaParaCasar[] {
  const texto = `${m.contraparte ?? ''} ${m.conceptoBanco}`
  return facturas.filter((f) => f.totalCent - f.pagadoCent > 0 && nombra(texto, [f.proveedor, ...f.alias]))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

export interface Reparto {
  /** Cuánto va a cada factura elegida, en el orden en que se eligen (cada una hasta lo que le queda). */
  facturas: { id: string; importeCent: number; quedaCent: number }[]
  /** Lo que queda del movimiento sin factura: + sobra, 0 justo. */
  quedaPorCasarCent: number
  /**
   * La diferencia pequeña (hasta 3 € y el 3 % del pago), con su cuenta: + pagado de más (669, o 626 si el
   * banco dice comisión), − pagado de menos al cerrar la factura (769). Se propone; nunca se crea sola.
   */
  diferencia: { cuenta: string; importeCent: number; concepto: string } | null
  /** Si la última factura se queda con un poco por pagar, se puede cerrar con la diferencia (769). */
  sePuedeCerrar: boolean
  /** Por qué no se puede confirmar así, o null. */
  noSePuede: string | null
}

const pequena = (dif: number, pagoCent: number) => dif !== 0 && Math.abs(dif) <= Math.min(300, Math.round(Math.abs(pagoCent) * 0.03))

/**
 * Reparte un pago entre las facturas elegidas: cada una hasta lo que le queda.
 * Lo que sobra, si es pequeño, va como diferencia de más; si la última factura
 * se queda con un poco por pagar y se pide «cerrar», como diferencia de menos.
 * Si lo que sobra es grande, no se deja confirmar: se dice por qué.
 */
export function repartir(m: MovimientoBanco, elegidas: readonly FacturaParaCasar[], cuentas: { c626: string; c669: string; c769: string }, cerrar = false): Reparto {
  let resto = Math.abs(m.importeCent)
  const facturas = elegidas.map((f) => {
    const pendiente = f.totalCent - f.pagadoCent
    const importeCent = Math.min(resto, pendiente)
    resto -= importeCent
    return { id: f.id, importeCent, quedaCent: pendiente - importeCent }
  })
  const proveedor = elegidas[0]?.proveedor ?? ''
  const ultima = facturas[facturas.length - 1]
  const sePuedeCerrar = !!ultima && resto === 0 && pequena(ultima.quedaCent, m.importeCent)
  let diferencia: Reparto['diferencia'] = null
  if (pequena(resto, m.importeCent)) {
    const comision = /COMISI[OÓ]N|\bCOMIS\b|\bCOMIS\./i.test(m.conceptoBanco)
    diferencia = { cuenta: comision ? cuentas.c626 : cuentas.c669, importeCent: resto, concepto: comision ? `Comisión del pago a ${proveedor}` : `Diferencia del pago a ${proveedor}` }
  } else if (cerrar && sePuedeCerrar) {
    diferencia = { cuenta: cuentas.c769, importeCent: -ultima.quedaCent, concepto: `Redondeo del pago a ${proveedor}` }
    ultima.importeCent += ultima.quedaCent
    ultima.quedaCent = 0
  }
  const noSePuede = !elegidas.length ? 'Elige al menos una factura.'
    : facturas.some((f) => f.importeCent === 0) ? 'Sobra una factura: el pago no llega para ella.'
    : new Set(elegidas.map((f) => f.cuentaTercero)).size > 1 ? 'Las facturas son de proveedores distintos: elige las de uno.'
    : !elegidas[0].cuentaTercero ? `${proveedor} no tiene su cuenta de proveedor: dala de alta en su ficha.`
    : resto > 0 && !diferencia ? `Quedan ${euros(resto)} sin factura: elige otra, o apunta el pago sin factura.`
    : null
  return { facturas, quedaPorCasarCent: diferencia && diferencia.importeCent > 0 ? 0 : resto, diferencia, sePuedeCerrar, noSePuede }
}

/** El destino de bank_casar para un reparto que se puede confirmar. */
export function destinoDelReparto(elegidas: readonly FacturaParaCasar[], r: Reparto): Destino {
  const f0 = elegidas[0]
  return {
    tipo: 'factura_recibida', facturas: r.facturas.map((f) => ({ id: f.id, importe: f.importeCent / 100 })),
    cuenta_tercero: f0.cuentaTercero ?? '', tercero_id: f0.terceroId,
    concepto: elegidas.length === 1 ? `Pago de la factura ${f0.numero ?? ''} de ${f0.proveedor}`.replace(/\s+/g, ' ') : `Pago de ${elegidas.length} facturas de ${f0.proveedor}`,
    ...(r.diferencia ? { diferencia: { cuenta: r.diferencia.cuenta, importe: r.diferencia.importeCent / 100, concepto: r.diferencia.concepto } } : {}),
  }
}

export interface LineaAsiento { cuenta: string; debeCent: number; haberCent: number }

/**
 * «Ver el asiento que se crea»: las líneas que escribirá bank_casar
 * (20261101T0200) con este destino. El banco entra al debe si el dinero
 * entra, y al haber si sale. null si se enlaza un asiento que ya existe.
 */
export function asientoQueSeCrea(m: MovimientoBanco, destino: Destino, cuenta572: string | null, otra572: string | null = null): LineaAsiento[] | null {
  const entra = m.importeCent > 0
  const abs = Math.abs(m.importeCent)
  const c = (e: number) => Math.round(e * 100)
  const banco: LineaAsiento = { cuenta: cuenta572 ?? '572', debeCent: entra ? abs : 0, haberCent: entra ? 0 : abs }
  switch (destino.tipo) {
    case 'asiento': return null
    case 'factura_recibida': {
      const suma = destino.facturas.reduce((t, f) => t + c(f.importe), 0)
      const dif = destino.diferencia ? c(destino.diferencia.importe) : 0
      return [banco, { cuenta: destino.cuenta_tercero, debeCent: suma, haberCent: 0 },
        ...(dif ? [{ cuenta: destino.diferencia!.cuenta, debeCent: Math.max(dif, 0), haberCent: Math.max(-dif, 0) }] : [])]
    }
    case 'liquidacion': return [banco, { cuenta: destino.cuenta_cliente, debeCent: 0, haberCent: abs }]
    case 'traspaso': return [banco, { cuenta: otra572 ?? 'la 572 de la otra cuenta', debeCent: entra ? 0 : abs, haberCent: entra ? abs : 0 }]
    default: return [banco, ...destino.lineas.map((l) => ({ cuenta: l.cuenta, debeCent: entra ? 0 : c(l.importe), haberCent: entra ? c(l.importe) : 0 }))]
  }
}

/** La píldora del origen de la propuesta, con su nombre. */
export const PILDORA: Record<string, string> = {
  factura: 'Factura', traspaso: 'Traspaso', regla: 'Regla', liquidacion: 'Liquidación', historial: 'Historial', libro: 'Contabilidad',
  contrato: 'Contrato', nomina: 'Nómina', impuesto: 'Impuesto', banco: 'Banco', cliente: 'Cliente', anticipo: 'Anticipo',
}

const euros = (c: number) => `${(c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES_MIN = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** '2026-10-13' → «Martes 13 de octubre» (la cabecera de cada día). */
export function diaConNombre(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const t = `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES_MIN[d.getUTCMonth()]}`
  return t[0].toUpperCase() + t.slice(1)
}

/** El texto del botón de confirmar en bloque: «24 seguros seleccionados · Confirmar los 24». */
export function textoBloque(seleccion: readonly string[], preseleccionados: readonly string[]): { etiqueta: string; boton: string; seguros: boolean } {
  const n = seleccion.length
  const seguros = n > 0 && n === preseleccionados.length && seleccion.every((id) => preseleccionados.includes(id))
  return {
    etiqueta: `${n} ${seguros ? (n === 1 ? 'seguro seleccionado' : 'seguros seleccionados') : (n === 1 ? 'seleccionado' : 'seleccionados')}`,
    boton: n === 1 ? 'Confirmar el 1' : `Confirmar los ${n}`,
    seguros,
  }
}

// ── De dónde parte el cuadre (regla de Julio, 16/10) ───────────────────────
// Si los bancos tienen fecha de corte (antes de ella la contabilidad está
// cerrada y casi sin conciliar), el cuadre NO parte del saldo contable a la
// víspera del corte: parte del saldo del EXTRACTO ese día, y le suma lo que
// la contabilidad ha movido en la cuenta desde el corte. Y lo dice.

export interface ExtractoSaldos { desde: string; hasta: string; saldoInicialCent: number | null; saldoFinalCent: number | null }

export interface PuntoDePartida {
  /** «En contabilidad» para el cuadre. */
  libroCent: number | null
  /** Lo que la pantalla dice debajo; null si no hay corte (se parte del contable, como siempre). */
  apertura: { fecha: string; bancoCent: number | null; contableCent: number; frase: string } | null
}

const dia = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** El saldo del banco al cierre de `fecha`: el inicial del extracto que empieza al día siguiente, o el final del que acaba ese día. */
export function saldoDelExtractoA(extractos: readonly ExtractoSaldos[], fecha: string): number | null {
  const empieza = extractos.find((e) => e.desde === dia(fecha, 1) && e.saldoInicialCent !== null)
  if (empieza) return empieza.saldoInicialCent
  const acaba = extractos.find((e) => e.hasta === fecha && e.saldoFinalCent !== null)
  return acaba ? acaba.saldoFinalCent : null
}

/**
 * `libroAntesCent`: la 572 a la víspera del corte; `libroAhoraCent`: a la fecha del cuadre.
 * Sin corte (o con el cuadre antes del corte), el contable de siempre.
 */
export function puntoDePartida(corte: string | null, hasta: string, extractos: readonly ExtractoSaldos[], libroAntesCent: number | null, libroAhoraCent: number | null): PuntoDePartida {
  if (!corte || libroAhoraCent === null || libroAntesCent === null || hasta < corte) return { libroCent: libroAhoraCent, apertura: null }
  const vispera = dia(corte, -1)
  const bancoCent = saldoDelExtractoA(extractos, vispera)
  const apertura = { fecha: vispera, bancoCent, contableCent: libroAntesCent, frase: fraseApertura(vispera, bancoCent, libroAntesCent) }
  return { libroCent: bancoCent === null ? libroAhoraCent : bancoCent + (libroAhoraCent - libroAntesCent), apertura }
}

/**
 * La frase del punto de partida, la misma en Movimientos y en «Cierre del mes»
 * (que la calcula la base: _bank_mes_estado, 0220). `vispera`: el día antes del corte.
 */
export function fraseApertura(vispera: string, bancoCent: number | null, contableCent: number): string {
  const e = (c: number) => `${(c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  if (bancoCent === null) return `No tengo el saldo del extracto a ${ddmm(vispera)}: parto del contable (${e(contableCent)}). Sube el extracto que empieza el ${ddmm(dia(vispera, 1))}.`
  return bancoCent === contableCent
    ? `Parto del saldo del extracto a ${ddmm(vispera)} (${e(bancoCent)}), que coincide con el contable.`
    : `Parto del saldo del extracto a ${ddmm(vispera)} (${e(bancoCent)}), no del contable (${e(contableCent)}): hasta esa fecha la contabilidad está cerrada y casi sin conciliar.`
}
