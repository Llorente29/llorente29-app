// src/modules/conta/lib/validacionesEmpresa.ts
//
// Regla 6 del núcleo del C00 (§5): NIF único por cuenta, una sola actividad
// principal, IBAN válido y socios que no pasen de 100. Reutiliza los
// validadores del C01 (lib/nif, lib/iban): no los duplica. La base lo
// garantiza también; esto es para decirlo antes, en palabras.

import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'
import { validarIban } from '@/modules/conta/lib/iban'

export interface Fallo { campo: string; texto: string }

/** El NIF de una empresa: válido y sin repetir en la cuenta. */
export function revisarNifEmpresa(nif: string, otras: { id: string; nif: string | null; nombre: string }[], propiaId: string | null): Fallo[] {
  const v = validarNifEs(nif)
  if (!v.ok) return [{ campo: 'nif', texto: v.motivo }]
  const repe = otras.find((o) => o.id !== propiaId && o.nif !== null && normalizarNif(o.nif) === v.normalizado)
  return repe ? [{ campo: 'nif', texto: `Ese NIF ya lo tiene otra empresa de tu cuenta: ${repe.nombre}.` }] : []
}

/** Entre las actividades vigentes, una y solo una principal. */
export function revisarActividades(acts: { esPrincipal: boolean; vigente: boolean }[]): Fallo[] {
  const vivas = acts.filter((a) => a.vigente)
  if (vivas.length === 0) return []
  const principales = vivas.filter((a) => a.esPrincipal).length
  if (principales === 0) return [{ campo: 'actividad', texto: 'Marca cuál es tu actividad principal.' }]
  if (principales > 1) return [{ campo: 'actividad', texto: 'Solo puede haber una actividad principal.' }]
  return []
}

/** Una cuenta bancaria: IBAN válido. */
export function revisarIbanBanco(iban: string): Fallo[] {
  const v = validarIban(iban)
  return v.ok ? [] : [{ campo: 'iban', texto: v.motivo }]
}

/** Los porcentajes de los socios vigentes no pasan de 100. */
export function revisarSocios(socios: { pct: number | null; vigente: boolean }[]): Fallo[] {
  const total = socios.filter((s) => s.vigente).reduce((acc, s) => acc + (s.pct ?? 0), 0)
  const redondo = Math.round(total * 100) / 100
  return redondo > 100 ? [{ campo: 'socios', texto: `Los porcentajes suman ${String(redondo).replace('.', ',')} %: no pueden pasar de 100.` }] : []
}
