// src/modules/conta/lib/ivaNoDeducible.ts
//
// D07 · El IVA de una recibida que NO se deduce, con su motivo (Julio, 23/10).
// Caso: Orange S11/0177416578 del 05/10. La cuota va a su gasto (no a la 472),
// sale en el libro de recibidas como no deducible y no entra en el 303 (tanda
// 0850). Núcleo puro: sin red ni base.

export type MotivoNoDeducible = 'no_a_nombre' | 'ticket_sin_nif' | 'otro' | 'sin_roi'

/** Los motivos, en el orden en que se ofrecen. («sin_roi» no se ofrece: lo pone Sumied solo, S01o·2.) */
export const MOTIVOS_NO_DEDUCIBLE: readonly { valor: MotivoNoDeducible; texto: string }[] = [
  { valor: 'no_a_nombre', texto: 'No está a nombre de la empresa' },
  { valor: 'ticket_sin_nif', texto: 'Es un ticket sin NIF' },
  { valor: 'otro', texto: 'Otro motivo' },
]

/** El porqué, dicho para la persona («es un ticket sin NIF»). null si no hay motivo. */
export function porQueNoDeducible(motivo: string | null | undefined, texto?: string | null): string | null {
  if (motivo === 'no_a_nombre') return 'no está a nombre de la empresa'
  if (motivo === 'ticket_sin_nif') return 'es un ticket sin NIF'
  if (motivo === 'sin_roi') return 'es de un proveedor de la UE que cobra IVA español y la empresa no está en el ROI'
  if (motivo === 'otro') return texto?.trim() || null
  return null
}

/** Lo que falta para guardarlo, o null si se puede. */
export function faltaParaGuardar(noDeducible: boolean, motivo: string | null, texto: string | null): string | null {
  if (!noDeducible) return null
  if (!motivo) return 'Di por qué no se deduce.'
  if (motivo === 'otro' && !texto?.trim()) return 'Con «Otro motivo», escribe cuál.'
  return null
}
