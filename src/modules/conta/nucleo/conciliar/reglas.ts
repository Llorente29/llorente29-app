// src/modules/conta/nucleo/conciliar/reglas.ts
//
// X30 · Las reglas de verdad de «Conciliar» (maqueta 23b: «＋ Crear regla con este» y «Reglas (N)»). Lo que decide la
// pantalla, sin tocar la base; lo prueba tests/conta/x30-conciliar:
//   · la regla que sale del movimiento elegido (el texto que lo nombra, si es un pago o un ingreso, el banco, la
//     subcuenta, el concepto del asiento y la analítica);
//   · la frase que se lee («Si el concepto contiene “IBERDROLA” y es un pago → 62800000 · SUMINISTROS»);
//   · a cuántos pendientes se aplicaría (la misma condición que el motor: reglaCasa);
//   · lo que se guarda en bank_rule (condition y target) y lo que se lee de ella.

import { contraparteDe, reglaCasa, type Destino } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { formatoImporte } from '../piezas/logica'
import { pendiente, type Linea } from './conciliar'

export type Signo = 'pago' | 'ingreso' | 'los dos'
export type ModoImporte = 'cualquiera' | 'exacto' | 'entre'

/** Una regla tal y como la escribe la ventana (importes en euros, sin signo). */
export interface ReglaEd {
  id: string | null
  contiene: string
  signo: Signo
  importe: { modo: ModoImporte; exacto: number | null; desde: number | null; hasta: number | null }
  /** Solo en este banco (treasury_account); sin él, en todos. */
  bancoId: string | null
  cuenta: string | null
  concepto: string
  local: string | null; marca: string | null; plataforma: string | null
}

/** Una regla del listado «Reglas (N)». */
export interface ReglaVista extends ReglaEd {
  estado: 'propuesta' | 'activa' | 'apagada' | 'rechazada'
  confirmaciones: number
  correcciones: number
  /** Cuántas veces ha conciliado algo (lo vivo) y la última vez. */
  veces: number
  ultima: string | null
  /** Desde cuándo mira (sin valor, todo) y si es de partida. */
  desde: string | null
  partida: boolean
  /** Lo que es, en las de partida («Luz», «Teléfono»…). */
  que: string | null
}

const id = (x: string | null) => (x && /^[0-9a-f-]{36}$/i.test(x) ? x : null)

/**
 * El texto que nombra un movimiento, y que casa con él: de la contraparte limpia (dos palabras, o una) o de las palabras
 * con sentido del concepto (sin «RECIBO», «TRANSFERENCIA», números…). El primero de esos que el motor encuentra en el
 * propio movimiento (una «SL» en medio deja fuera «CATCHER MARKETPLACE RECARGA»).
 */
export function textoDelMovimiento(m: Pick<MovimientoBanco, 'conceptoBanco' | 'conceptoLimpio' | 'contraparte' | 'importeCent' | 'cuentaId'>): string {
  const concepto = m.conceptoBanco || m.conceptoLimpio
  const cp = contraparteDe({ concepto, contraparte: m.contraparte ?? null })
  const ruido = /^(RECIBO|RECIBOS|TRANSF|TRANSFERENCIA|TRANSFERENCIAS|TRANS|ADEUDO|CARGO|ABONO|PAGO|COMPRA|TARJ|TARJETA|DE|DEL|LA|EL|EN|SEPA|DOMICILIADO|DOMIC|NUM|REF|LIQ|OP|POR|SU|FAVOR|RECIBIDA)$/
  const palabras = concepto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 3 && !/\d/.test(w) && !ruido.test(w))
  const cps = cp ? cp.split(' ') : []
  const candidatos = [cps.slice(0, 2).join(' '), cps.slice(0, 1).join(' '), palabras.slice(0, 2).join(' '), palabras.slice(0, 1).join(' ')].filter((x) => x.length >= 3)
  const yo = { concepto, contraparte: m.contraparte ?? null, referencias: [], importeCent: m.importeCent, cuentaId: m.cuentaId, creado: null }
  return candidatos.find((c) => reglaCasa({ contiene: c, signo: null, importe: null, bancoId: null, desde: null }, yo)) ?? candidatos[0] ?? ''
}

/** La regla que propone «＋ Crear regla con este»: desde el movimiento elegido y lo que tiene escrito debajo. */
export function reglaDesdeMovimiento(m: MovimientoBanco, ed: { cuenta: string | null; concepto: string; local: string | null; marca: string | null; plataforma: string | null }): ReglaEd {
  return {
    id: null, contiene: textoDelMovimiento(m), signo: m.importeCent < 0 ? 'pago' : 'ingreso',
    importe: { modo: 'cualquiera', exacto: Math.abs(m.importeCent) / 100, desde: null, hasta: null },
    bancoId: m.cuentaId, cuenta: ed.cuenta, concepto: ed.concepto.trim(), local: ed.local, marca: ed.marca, plataforma: ed.plataforma,
  }
}

const eur = (n: number | null) => (n === null ? '…' : `${formatoImporte(n)} €`)

/** «Si el concepto contiene “IBERDROLA”, es un pago y es de 42,35 € → 62800000 · SUMINISTROS». */
export function fraseDeRegla(r: ReglaEd, nombreCuenta: (c: string) => string, nombreBanco?: (id: string) => string): string {
  const partes = [`el concepto contiene “${r.contiene.trim() || '…'}”`]
  if (r.signo !== 'los dos') partes.push(`es un ${r.signo}`)
  if (r.importe.modo === 'exacto') partes.push(`es de ${eur(r.importe.exacto)}`)
  if (r.importe.modo === 'entre') partes.push(`va de ${eur(r.importe.desde)} a ${eur(r.importe.hasta)}`)
  if (r.bancoId && nombreBanco) partes.push(`es de ${nombreBanco(r.bancoId)}`)
  const y = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]
  const a = r.cuenta ? `${r.cuenta}${nombreCuenta(r.cuenta) ? ` · ${nombreCuenta(r.cuenta).toUpperCase()}` : ''}` : '¿a qué subcuenta?'
  return `Si ${y} → ${a}`
}

/** Lo que dice la base (bank_rule) con la forma del motor, para preguntar si casa. */
export function comoDelMotor(r: ReglaEd) {
  const c = (n: number | null) => (n === null ? null : Math.round(n * 100))
  return {
    contiene: r.contiene.trim(), signo: r.signo === 'pago' ? -1 as const : r.signo === 'ingreso' ? 1 as const : null,
    importe: r.importe.modo === 'exacto' ? { exactoCent: c(r.importe.exacto) } : r.importe.modo === 'entre' ? { desdeCent: c(r.importe.desde), hastaCent: c(r.importe.hasta) } : null,
    bancoId: r.bancoId, desde: null,
  }
}

/** Las pendientes a las que se aplicaría (hacia atrás): las que esperan y casan con la regla. */
export function aCuantosAplica(r: ReglaEd, ls: readonly Linea[]): Linea[] {
  if (r.contiene.trim().length < 3) return []
  const mr = comoDelMotor(r)
  return ls.filter((l) => pendiente(l) && reglaCasa(mr, { concepto: l.m.conceptoBanco || l.m.conceptoLimpio, contraparte: l.m.contraparte ?? null,
    referencias: [], importeCent: l.m.importeCent, cuentaId: l.m.cuentaId, creado: null }))
}

/** Lo que falta para poder guardarla; null si está bien. */
export function faltaEnRegla(r: ReglaEd): string | null {
  if (r.contiene.trim().length < 3) return 'Escribe al menos tres letras del concepto.'
  if (!r.cuenta) return 'Falta la subcuenta.'
  if (r.importe.modo === 'exacto' && !(r.importe.exacto && r.importe.exacto > 0)) return 'Falta el importe.'
  if (r.importe.modo === 'entre' && (r.importe.desde === null || r.importe.hasta === null || r.importe.desde > r.importe.hasta)) return 'El importe «entre» necesita un desde y un hasta, en orden.'
  return null
}

/** condition y target de bank_rule. */
export function aLaBase(r: ReglaEd): { palabras: string; condicion: Record<string, unknown>; destino: Record<string, unknown> } {
  const condicion: Record<string, unknown> = { contiene: r.contiene.trim().toUpperCase() }
  if (r.signo !== 'los dos') condicion.signo = r.signo === 'pago' ? -1 : 1
  if (r.importe.modo === 'exacto') condicion.importe = { exacto: r.importe.exacto }
  if (r.importe.modo === 'entre') condicion.importe = { desde: r.importe.desde, hasta: r.importe.hasta }
  if (r.bancoId) condicion.banco = r.bancoId
  const destino: Record<string, unknown> = { cuenta: r.cuenta }
  if (r.concepto.trim()) destino.concepto = r.concepto.trim()
  if (id(r.local)) destino.local_id = r.local
  if (id(r.marca)) destino.marca_id = r.marca
  if (id(r.plataforma)) destino.canal_id = r.plataforma
  return { palabras: r.contiene.trim().toUpperCase(), condicion, destino }
}

/** De bank_rule a la ventana. */
export function deLaBase(f: Record<string, unknown>): ReglaVista {
  const cond = (f.condition ?? {}) as Record<string, unknown>, dest = (f.target ?? {}) as Record<string, unknown>
  const imp = (cond.importe ?? null) as Record<string, unknown> | null
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
  const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
  return {
    id: String(f.id), contiene: String(cond.contiene ?? f.words ?? ''),
    signo: cond.signo === -1 ? 'pago' : cond.signo === 1 ? 'ingreso' : 'los dos',
    importe: imp && imp.exacto !== undefined && imp.exacto !== null ? { modo: 'exacto', exacto: num(imp.exacto), desde: null, hasta: null }
      : imp ? { modo: 'entre', exacto: null, desde: num(imp.desde), hasta: num(imp.hasta) } : { modo: 'cualquiera', exacto: null, desde: null, hasta: null },
    bancoId: s(cond.banco), cuenta: s(dest.cuenta), concepto: String(dest.concepto ?? ''),
    local: s(dest.local_id), marca: s(dest.marca_id), plataforma: s(dest.canal_id),
    estado: (s(f.status) ?? 'activa') as ReglaVista['estado'], confirmaciones: Number(f.confirmations ?? 0), correcciones: Number(f.corrections ?? 0),
    veces: Number(f.veces ?? 0), ultima: s(f.ultima) ?? s(f.last_used_at), desde: s(f.applies_from), partida: f.seed === 'partida', que: s(dest.que),
  }
}

/** El destino con el que se concilia un pendiente al aplicar la regla hacia atrás (el mismo que propondría el motor). */
export function destinoDeRegla(r: ReglaEd, m: Pick<MovimientoBanco, 'importeCent' | 'conceptoLimpio' | 'conceptoBanco'>): Destino {
  const { destino } = aLaBase(r)
  const ana = Object.fromEntries(['local_id', 'marca_id', 'canal_id'].filter((k) => destino[k]).map((k) => [k, destino[k]]))
  return { tipo: 'cuenta', concepto: r.concepto.trim() || m.conceptoLimpio.trim() || m.conceptoBanco.trim(),
    lineas: [{ cuenta: r.cuenta!, importe: Math.abs(m.importeCent) / 100 }], ...ana } as unknown as Destino
}
