// src/modules/conta/nucleo/recibida/validarSoloLoCompleto.ts
//
// K09 · Nunca se valida una recibida incompleta ni repetida (Julio, 21/11). La
// base lo impide al validar (conta_recibida_motivos, 0945); la pantalla dice lo
// mismo ANTES de pulsar (regla 8), con las mismas frases, e Intro no valida:
//   · lo que falta: el proveedor, el número, la fecha, una base con su tipo y la
//     cuenta de gasto de cada línea («Falta la cuenta de gasto en la línea 1»);
//   · la repetida: otra ya contabilizada del mismo proveedor con el mismo número
//     (sin mayúsculas, espacios, guiones ni ceros a la izquierda: normaNumero),
//     «Ya está la FV26-018817 de Frutas Eloy, asiento 2/1», con «Abrirla»; y
//     «No es la misma: …», escrita, para validarla igual.

import { normaNumero } from '@/modules/conta/documentos/paraValidar'
import type { LineaGasto, LineaIva } from '@/modules/conta/documentos/fichaRecibida'

const num = (x: string) => {
  const n = Number(String(x ?? '').replace(/\./g, '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : null
}

/** Lo que falta para validarla, cada cosa con su frase (las mismas que la base). */
export function faltasParaValidar(b: { proveedorId: string; numero: string; fecha: string; iva: readonly LineaIva[]; gastos: readonly LineaGasto[] }): string[] {
  const l: string[] = []
  if (!b.proveedorId) l.push('Falta el proveedor.')
  if (!b.numero.trim()) l.push('Falta el número de la factura.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) l.push('Falta la fecha de la factura.')
  if (!b.iva.some((x) => num(x.base) !== null && num(x.base) !== 0 && String(x.tipo ?? '').trim() !== '')) l.push('Falta la base con su tipo de IVA.')
  if (!b.gastos.length) l.push('Falta la cuenta de gasto.')
  b.gastos.forEach((g, i) => { if (!g.cuenta.trim()) l.push(b.gastos.length > 1 ? `Falta la cuenta de gasto en la línea ${i + 1}.` : 'Falta la cuenta de gasto en la línea 1.') })
  return l
}

/** ¿Es el mismo número? Sin mayúsculas, espacios, guiones, barras, puntos ni ceros a la izquierda. */
export const mismoNumero = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normaNumero(a)
  return x !== '' && x === normaNumero(b)
}

export interface OtraFactura { id: string; numero: string; proveedor: string; asiento: string }

/** La otra ya contabilizada con su número, de entre las del mismo proveedor (null si no hay, o si ya se dijo que no es la misma). */
export function laRepetida(o: { id: string; numero: string; confirmada: boolean; otras: readonly (OtraFactura & { validada: boolean })[] }): OtraFactura | null {
  if (o.confirmada || !normaNumero(o.numero)) return null
  const x = o.otras.find((f) => f.id !== o.id && f.validada && mismoNumero(f.numero, o.numero))
  return x ? { id: x.id, numero: x.numero, proveedor: x.proveedor, asiento: x.asiento } : null
}

/** La frase de la repetida, la misma que la base. */
export const textoRepetida = (x: OtraFactura) => `Ya está la ${x.numero} de ${x.proveedor}, asiento ${x.asiento}.`

/** Lo que se dice al pulsar Intro sin poder validar: se guarda, y no se valida. */
export function textoNoSeValida(o: { faltas: readonly string[]; repetida: OtraFactura | null; guardada: boolean }): string | null {
  const partes = [...o.faltas.map((x) => x.replace(/\.$/, '')), ...(o.repetida ? [`${textoRepetida(o.repetida).replace(/\.$/, '')}: si no es la misma, dilo en «No es la misma»`] : [])]
  if (!partes.length) return null
  return `${o.guardada ? 'Guardada, sin validar' : 'Sin validar'}: ${partes.join(' · ')}. No paso a la siguiente.`
}
