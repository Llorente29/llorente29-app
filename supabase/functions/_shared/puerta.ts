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

/** Lo mínimo para releer la marca por otro camino si la función de la base no contesta. */
interface ConTabla {
  // deno-lint-ignore no-explicit-any
  from?: (t: string) => any
}

/**
 * Las cuentas que esta instancia ya ha visto de demo. A una de ellas nunca se
 * la deja salir, ni aunque la base deje de contestar.
 */
const DEMOS_VISTAS = new Set<string>()

/** Solo para las pruebas: olvidar lo visto. */
export function olvidarDemosVistas(): void { DEMOS_VISTAS.clear() }

/**
 * La puerta alrededor de un envío. Para una cuenta que no es de demo, devuelve
 * EXACTAMENTE lo que devuelve `salir` (la llamada de siempre, una vez); para
 * una de demo, lo que diga `enLaDemo`, sin llamar a `salir`. Lo prueba
 * tests/unit/demo/caminoDelPedido.test.ts.
 *
 * `siNoContesta`: qué hacer si no se puede preguntar a la base.
 *   · 'no_sale' (lo que no es camino del pedido): lanza, como
 *     cuentaPuedeSalir; el envío falla como fallaría sin la puerta y su
 *     reintento de siempre lo vuelve a intentar.
 *   · 'sale' (SOLO el camino del pedido: order-advance, HubRise, Last,
 *     Catcher): un pedido no se queda sin su empuje porque falle una pregunta,
 *     pero SOLO si la cuenta no es de demo (Julio, 31/10). Por eso, antes de
 *     dejarla salir:
 *       1. si esta instancia ya la vio de demo, no sale;
 *       2. relee la marca por otro camino (accounts.is_demo): si es de demo, no
 *          sale; si no lo es, sale;
 *       3. solo si tampoco eso contesta, sale, como antes de la puerta.
 *     Cada vez que sale sin respuesta de la función, el registro lo apunta
 *     con «PUERTA_SIN_RESPUESTA», para verlo si se repite.
 */
export async function siPuedeSalir<T>(
  db: ConRpc & ConTabla, accountId: string | null | undefined,
  salir: () => Promise<T>, enLaDemo: () => T | Promise<T>,
  siNoContesta: 'sale' | 'no_sale' = 'no_sale',
): Promise<T> {
  let puede: boolean
  try {
    puede = await cuentaPuedeSalir(db, accountId)
    if (!puede && accountId) DEMOS_VISTAS.add(accountId)
  } catch (e) {
    if (siNoContesta === 'no_sale') throw e
    const motivo = e instanceof Error ? e.message : String(e)
    if (accountId && DEMOS_VISTAS.has(accountId)) {
      console.error(`PUERTA_SIN_RESPUESTA cuenta=${accountId} no sale: ya se vio de demo · ${motivo}`)
      return enLaDemo()
    }
    let marca: boolean | null | undefined = undefined
    try {
      const r = await db.from?.('accounts').select('is_demo').eq('id', accountId).maybeSingle()
      if (r && !r.error) marca = (r.data as { is_demo?: boolean | null } | null)?.is_demo ?? null
    } catch { /* tampoco contesta */ }
    if (marca === true) {
      if (accountId) DEMOS_VISTAS.add(accountId)
      console.error(`PUERTA_SIN_RESPUESTA cuenta=${accountId} no sale: la marca releída dice demo · ${motivo}`)
      return enLaDemo()
    }
    console.error(`PUERTA_SIN_RESPUESTA cuenta=${accountId} sale: ${marca === undefined ? 'tampoco contesta la marca' : 'la marca releída dice que no es demo'} · ${motivo}`)
    puede = true
  }
  return puede ? salir() : enLaDemo()
}
