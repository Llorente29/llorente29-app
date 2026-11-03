// supabase/functions/invitar-persona/pedido.ts
//
// DM1 · PR 1 (30/10/2026). Lo de invitar-persona que no necesita Deno, para
// probarlo solo (tests/unit/multitenancy/invitarPersona.test.ts): leer el
// pedido y decir en palabras lo que ha pasado (regla 8). Desde el 03/11
// (Accesos 1) la invitación se acepta: la frase dice que se ha enviado.

export type Rol = 'admin' | 'manager'
export interface PedidoInvitacion {
  correo: string
  cuentas: { accountId: string; rol: Rol }[]
  marca: 'folvy' | 'sumied'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function leerInvitacion(b: Record<string, unknown> | null): { ok: true; pedido: PedidoInvitacion } | { ok: false; error: string } {
  const correo = String(b?.correo ?? '').trim().toLowerCase()
  if (!CORREO.test(correo) || correo.length > 254) return { ok: false, error: 'Escribe un correo válido.' }
  const crudas = Array.isArray(b?.cuentas) ? (b?.cuentas as unknown[]) : []
  if (crudas.length === 0) return { ok: false, error: 'Elige al menos una empresa.' }
  const cuentas: PedidoInvitacion['cuentas'] = []
  for (const c of crudas) {
    const x = c as Record<string, unknown>
    const accountId = String(x?.account_id ?? '')
    const rol = String(x?.rol ?? '')
    if (!UUID.test(accountId)) return { ok: false, error: 'Una de las empresas no es válida.' }
    if (rol !== 'admin' && rol !== 'manager') return { ok: false, error: 'El permiso tiene que ser «Todo (administrador)» o «Encargado».' }
    if (cuentas.some((y) => y.accountId === accountId)) return { ok: false, error: 'Una empresa está dos veces.' }
    cuentas.push({ accountId, rol })
  }
  const marca = b?.marca === 'sumied' ? 'sumied' : 'folvy'
  return { ok: true, pedido: { correo, cuentas, marca } }
}

/** «Foodint y Casa Lola», «A, B y C». */
export function lista(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/** Cómo se dice cada permiso en la pantalla y en el correo. */
export const NOMBRE_PERMISO: Record<Rol, string> = { admin: 'Todo', manager: 'Encargado' }

export function leerReenvio(b: Record<string, unknown> | null): { ok: true; pedido: { id: string; marca: 'folvy' | 'sumied' } } | { ok: false; error: string } {
  const id = String(b?.id ?? '')
  if (!UUID.test(id)) return { ok: false, error: 'Esa invitación no es válida.' }
  return { ok: true, pedido: { id, marca: b?.marca === 'sumied' ? 'sumied' : 'folvy' } }
}

/**
 * Lo que dice la pantalla al acabar (regla 8), con contenido:
 * «Invitación enviada a … para Foodint (Todo) y Casa Lola (Encargado). …»
 */
export function fraseDelEnvio(correo: string, empresas: { nombre: string; permiso: string }[], enviada: boolean, motivo: string | null, reenvio = false): string {
  const para = lista(empresas.map((e) => `${e.nombre} (${e.permiso})`))
  if (!enviada) {
    return `${reenvio ? 'Invitación renovada' : 'Invitación guardada'} para ${correo} en ${para}, pero el correo no ha salido${motivo ? ` (${motivo})` : ''}. Sale en Pendientes: reenvíala más tarde.`
  }
  return `${reenvio ? 'Invitación reenviada' : 'Invitación enviada'} a ${correo} para ${para}. Le llega un correo con un enlace que vale 7 días; hasta que acepte, sale en Pendientes.`
}
