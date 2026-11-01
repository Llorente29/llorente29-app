// supabase/functions/invitar-persona/pedido.ts
//
// DM1 · PR 1 (30/10/2026). Lo de invitar-persona que no necesita Deno, para
// probarlo solo (tests/unit/multitenancy/invitarPersona.test.ts): leer el
// pedido y decir en palabras lo que ha pasado (regla 8).

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

export interface Resultado {
  nuevo: boolean
  anadidas: string[]
  yaEstaba: string[]
  enviada: boolean
  motivo: string | null
}

/** Lo que dice la pantalla al acabar: qué ha pasado, con contenido (regla 8). */
export function fraseDelResultado(correo: string, r: Resultado): string {
  const partes: string[] = []
  if (r.anadidas.length) {
    partes.push(r.nuevo
      ? `Invitación a ${correo} para ${lista(r.anadidas)}.`
      : `${correo} ya tenía usuario: se le ha dado acceso a ${lista(r.anadidas)}. Entra con su contraseña de siempre y elige la empresa arriba.`)
  }
  if (r.yaEstaba.length) partes.push(`Ya entraba en ${lista(r.yaEstaba)}: no se ha cambiado nada ahí.`)
  if (r.nuevo) {
    partes.push(r.enviada
      ? 'Le ha llegado un correo para poner su contraseña; el enlace caduca en 7 días.'
      : `El correo no ha salido${r.motivo ? ` (${r.motivo})` : ''}: vuelve a invitarla más tarde y le llegará otro.`)
  }
  return partes.join(' ')
}
