// supabase/functions/_shared/puerta.ts
//
// DM1 · PR 2a (31/10/2026) · La puerta: una cuenta de demostración nunca manda
// nada fuera (encargo DM1, PR 2; respuesta 1, «una sola puerta y una máquina
// que la vigile»). Cada función del servidor que habla con fuera EN NOMBRE DE
// UNA CUENTA (Verifactu, Hacienda, Diez, el banco, los correos, WhatsApp,
// HubRise, Last, Catcher, las plataformas…) pregunta aquí antes de salir.
// Lo vigila tests/unit/demo/puerta.test.ts: si una función que sale fuera no
// importa esta pieza, y no está en su lista de las que no salen por una
// cuenta (con su porqué), la prueba sale en rojo y la nombra.
//
// Lo que haría el envío, en una demo, se da por hecho y se dice: «En la demo
// no se envía de verdad» (regla 8: confirma con contenido, no calla).

/** Lo que dice la pantalla, o el registro, cuando una demo no sale. */
export const EN_LA_DEMO = 'En la demo no se envía de verdad.'

/** Lo mínimo del cliente de Supabase que hace falta: llamar a una función de la base. */
interface ConRpc {
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string; code?: string } | null }>
}

/**
 * ¿Puede esta cuenta mandar algo fuera? Falso si es de demo (accounts.is_demo,
 * en la base: cuenta_puede_salir). Sin cuenta, sí: quien llama decide.
 * Antes de que la base tenga la puerta (la 0907 sin aplicar), sí, como hasta
 * ahora. Cualquier otro error, lanza: el envío falla como fallaría sin la
 * puerta, y su reintento de siempre lo vuelve a intentar.
 */
export async function cuentaPuedeSalir(db: ConRpc, accountId: string | null | undefined): Promise<boolean> {
  if (!accountId) return true
  const { data, error } = await db.rpc('cuenta_puede_salir', { p_account_id: accountId })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return true
    throw new Error(`No se ha podido preguntar si la cuenta puede salir: ${error.message}`)
  }
  return data !== false
}

/** El cuerpo de lo que contesta una función cuando la cuenta es de demo: como hecho, y dicho. */
export function hechoEnLaDemo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: 'ok', demo: true, enviado: false, mensaje: EN_LA_DEMO, ...extra }
}
