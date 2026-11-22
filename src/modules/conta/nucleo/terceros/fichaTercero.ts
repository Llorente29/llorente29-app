// src/modules/conta/nucleo/terceros/fichaTercero.ts
//
// X27 · La ficha de proveedor y la de cliente, como ERP10 (maqueta nucleo_20, aprobada el 22/11). Lo que decide la
// ficha, sin React ni red: el borrador de las casillas, qué ha cambiado, por qué no se guarda, la retención que
// encaja con el porcentaje guardado, los países y las cifras de las pestañas «Movimientos» y «Saldos».
//
// Lo que no se copia de ERP10 (Julio, 22/11): «Proveedor genérico», «Criterio de caja» y «REAGP» (van en el X27b, que
// los hace funcionar y los enseña solo a las empresas a las que aplican). El tipo de operación no se guarda en la
// ficha: es gris, lo calcula Sumied (país, NIF-IVA, VIES y régimen) y se cambia en la factura.

import { ESTADOS_UE } from '@/modules/conta/lib/vatEu'

export type TipoTercero = 'proveedor' | 'cliente'
export type TipoNif = 'nif_es' | 'vat_eu' | 'foreign'
export const TIPOS_NIF: readonly { valor: TipoNif; texto: string }[] = [
  { valor: 'nif_es', texto: 'N.I.F.' }, { valor: 'vat_eu', texto: 'N.I.F.-I.V.A.' }, { valor: 'foreign', texto: 'Extranjero' },
]
export type FormaPago = 'transfer' | 'direct_debit' | 'card' | 'cash'
/** Las formas de pago de la ficha (sin el saldo prepago, que es de la cuenta de Cocina). */
export const FORMAS_PAGO: readonly { valor: FormaPago; texto: string }[] = [
  { valor: 'transfer', texto: 'Transferencia' }, { valor: 'direct_debit', texto: 'Domiciliación' }, { valor: 'card', texto: 'Tarjeta' }, { valor: 'cash', texto: 'Efectivo' },
]

/** Las casillas de la ficha, como se escriben (texto), las mismas para el proveedor y el cliente. */
export interface Borrador {
  nombre: string
  nif: string
  tipoNif: TipoNif | ''
  comercial: string
  domicilio: string
  postal: string
  poblacion: string
  provincia: string
  pais: string
  telefono: string
  correo: string
  observaciones: string
  recargo: boolean
  no347: boolean
  /** Los ids de los dos tipos de IVA (vacío = ninguno). */
  iva1: string
  iva2: string
  /** El porcentaje de retención (proveedor) o el id del tipo de retención (cliente). */
  retencion: string
  /** Solo el proveedor: % IVA deducible, subcuenta de gasto, local, marca, plataforma y pago directo. */
  deducible: string
  gasto: string
  local: string
  marca: string
  plataforma: string
  pagoDirecto: boolean
  /** La subcuenta de pago (proveedor, el id de company_account) o la de cobro (cliente, el id de su tesorería). */
  pago: string
  forma: FormaPago | ''
  dias: string
  iban: string
  /** Solo el cliente: el tipo de operación (domestic, eu, export). El del proveedor es gris (lo calcula Sumied). */
  operacion: string
}

export const borradorVacio = (): Borrador => ({
  nombre: '', nif: '', tipoNif: 'nif_es', comercial: '', domicilio: '', postal: '', poblacion: '', provincia: '', pais: 'ES',
  telefono: '', correo: '', observaciones: '', recargo: false, no347: false, iva1: '', iva2: '', retencion: '',
  deducible: '', gasto: '', local: '', marca: '', plataforma: '', pagoDirecto: false, pago: '', forma: '', dias: '', iban: '', operacion: '',
})

/** Lo que ha cambiado, casilla a casilla (para «Guardar» y para la pregunta al salir). */
export function cambios(antes: Borrador, ahora: Borrador): (keyof Borrador)[] {
  return (Object.keys(ahora) as (keyof Borrador)[]).filter((k) => antes[k] !== ahora[k])
}

const numero = (t: string): number | null => {
  const s = t.trim().replace(/\./g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}
export const porcentaje = (t: string): number | null => numero(t)
export const dias = (t: string): number | null => numero(t)

/** Por qué no se guarda (la casilla en ámbar en la pantalla y la frase en el aviso de la barra), o null. */
export function porQueNoSeGuarda(b: Borrador): { casilla: keyof Borrador; texto: string } | null {
  if (!b.nombre.trim()) return { casilla: 'nombre', texto: 'Falta el nombre.' }
  const d = porcentaje(b.deducible)
  if (d !== null && (Number.isNaN(d) || d < 0 || d > 100)) return { casilla: 'deducible', texto: 'El % de IVA deducible va de 0 a 100.' }
  const r = porcentaje(b.retencion)
  if (/^[\d.,\s]*$/.test(b.retencion) && r !== null && (Number.isNaN(r) || r < 0 || r > 100)) return { casilla: 'retencion', texto: 'La retención va de 0 a 100.' }
  const n = dias(b.dias)
  if (n !== null && (Number.isNaN(n) || n < 0 || n > 365 || !Number.isInteger(n))) return { casilla: 'dias', texto: 'Los días van de 0 a 365.' }
  if (b.pais.trim() && !/^[A-Za-z]{2}$/.test(b.pais.trim())) return { casilla: 'pais', texto: 'El país va con sus dos letras (ES, FR, PT…).' }
  return null
}

/** La retención que encaja con el porcentaje guardado en la ficha del proveedor (la lupa la enseña con su nombre). */
export function retencionQueEncaja<T extends { id: string; rate: number }>(pct: number | null, lista: readonly T[]): T | null {
  if (pct === null || !(pct > 0)) return null
  return lista.find((r) => Math.abs(r.rate - pct) < 0.005) ?? null
}

// ── Los países ──────────────────────────────────────────────────────────────

/** Los que salen en la lupa: España, la UE y los de fuera que más facturan a la hostelería. */
const OTROS = ['GB', 'CH', 'NO', 'US', 'CN', 'MA', 'AD', 'AR', 'MX', 'BR', 'CA', 'JP', 'TR', 'IL', 'IE'] as const
const nombres = (() => { try { return new Intl.DisplayNames(['es'], { type: 'region' }) } catch { return null } })()
export function nombrePais(codigo: string): string {
  const c = codigo.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  const n = (c === 'EL' ? nombres?.of('GR') : nombres?.of(c)) ?? c
  return n.toLocaleUpperCase('es')
}
export const PAISES: readonly { id: string; codigo: string; descripcion: string }[] = [...new Set(['ES', ...ESTADOS_UE.filter((p) => p !== 'ES'), ...OTROS])]
  .map((c) => ({ id: c, codigo: c, descripcion: nombrePais(c) }))

// ── El tipo de operación del cliente ────────────────────────────────────────

export const OPERACIONES_CLIENTE: readonly { valor: string; texto: string }[] = [
  { valor: 'domestic', texto: 'Operaciones interiores' }, { valor: 'eu', texto: 'Entregas intracomunitarias' }, { valor: 'export', texto: 'Exportaciones' },
]

// ── Movimientos y saldos ────────────────────────────────────────────────────

export interface Movimiento { fecha: string; documento: string; concepto: string; debe: number; haber: number; asiento: string | null; anulado: boolean }
export interface MovimientoConSaldo extends Movimiento { saldo: number }

const cent = (n: number) => Math.round(n * 100)

/**
 * La pestaña «Movimientos»: su mayor, apunte a apunte, con el saldo acumulado en su naturaleza: el proveedor,
 * acreedora (haber − debe, lo que le debes); el cliente, deudora (debe − haber, lo que te debe). Sin los anulados.
 */
export function conSaldo(movs: readonly Movimiento[], tipo: TipoTercero): MovimientoConSaldo[] {
  let s = 0
  return [...movs].filter((m) => !m.anulado).sort((a, b) => a.fecha.localeCompare(b.fecha)).map((m) => {
    s += tipo === 'proveedor' ? cent(m.haber) - cent(m.debe) : cent(m.debe) - cent(m.haber)
    return { ...m, saldo: s / 100 }
  })
}

export interface SaldoMes { mes: string; nombre: string; debe: number; haber: number; saldo: number }
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/**
 * La pestaña «Saldos», como la captura 07 de ERP10: los doce meses del ejercicio, con el debe, el haber y el saldo
 * acumulado al final de cada mes (en su naturaleza); lo de antes del ejercicio entra como saldo de apertura.
 */
export function saldosPorMes(movs: readonly Movimiento[], ejercicio: { inicio: string; fin: string }, tipo: TipoTercero): { apertura: number; meses: SaldoMes[] } {
  const validos = movs.filter((m) => !m.anulado)
  const signo = (m: Movimiento) => (tipo === 'proveedor' ? cent(m.haber) - cent(m.debe) : cent(m.debe) - cent(m.haber))
  let s = validos.filter((m) => m.fecha < ejercicio.inicio).reduce((t, m) => t + signo(m), 0)
  const apertura = s / 100
  const meses: SaldoMes[] = []
  let y = Number(ejercicio.inicio.slice(0, 4)); let mm = Number(ejercicio.inicio.slice(5, 7))
  for (let i = 0; i < 12; i++) {
    const mes = `${y}-${String(mm).padStart(2, '0')}`
    if (`${mes}-01` > ejercicio.fin) break
    const del = validos.filter((m) => m.fecha.slice(0, 7) === mes && m.fecha >= ejercicio.inicio && m.fecha <= ejercicio.fin)
    const debe = del.reduce((t, m) => t + cent(m.debe), 0); const haber = del.reduce((t, m) => t + cent(m.haber), 0)
    s += tipo === 'proveedor' ? haber - debe : debe - haber
    meses.push({ mes, nombre: `${MESES[mm - 1]} ${y}`, debe: debe / 100, haber: haber / 100, saldo: s / 100 })
    mm += 1; if (mm > 12) { mm = 1; y += 1 }
  }
  return { apertura, meses }
}
