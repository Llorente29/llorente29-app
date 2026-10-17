// src/modules/conta/services/esperanService.ts
//
// M01 · «Esperan»: lo que la validación pararía, leído de la base. Nombres
// dentro de cadenas (regla 40), de la 20261117T0100_m01_motivos_para_validar:
// conta_esperan(p_company, p_desde, p_hasta) → entry_id, orden, codigo, motivo.
// Con los permisos de quien la llama: solo lo de su cuenta.

import { rpc } from '@/modules/conta/services/bd'
import type { MotivoEspera } from '@/modules/conta/lib/esperan'

type Fila = Record<string, unknown>

/** Por asiento, sus motivos en orden (el primero es el que dice la validación). */
export async function leerEsperan(companyId: string, desde = '1900-01-01', hasta = '2999-12-31'): Promise<Map<string, MotivoEspera[]>> {
  const filas = ((await rpc<Fila[] | null>('conta_esperan', { p_company: companyId, p_desde: desde, p_hasta: hasta })) ?? [])
  const out = new Map<string, MotivoEspera[]>()
  for (const f of [...filas].sort((a, b) => Number(a.orden) - Number(b.orden))) {
    const id = String(f.entry_id)
    if (!out.has(id)) out.set(id, [])
    out.get(id)!.push({ codigo: String(f.codigo), motivo: String(f.motivo) })
  }
  return out
}
