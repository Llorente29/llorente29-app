// src/modules/orders/lib/passCode.ts
//
// CÓDIGO DE PASE — el número que el repartidor canta al llegar, para encontrar la
// bolsa entre varias, rápido, en el momento de más prisa. Un único concepto por
// pedido, con la fuente según el canal (dato operativo de Julio, 25/07):
//
//   · Glovo               → pos_short_code (G315). El rider canta los 3 dígitos ("315").
//   · Uber                → platform_order_code (A1CDE) COMPLETO; el rider canta el
//                           final → se destacan los últimos 4 ("1CDE"). El completo
//                           evita ambigüedad (0/O, 8/B con prisa).
//   · Reparto propio/otros → pos_short_code (lo que Folvy manda a Catcher).
//   · Fallback: si falta el campo previsto, usar el otro; si faltan los dos, el tab;
//     si nada, "—". NUNCA inventar.
//
// Devuelve el código partido en `lead` (prefijo, pequeño) + `emph` (lo que se canta,
// destacado) y el `secondary` (el OTRO código, pequeño, para incidencias/reclamaciones).
// Puro y sin dependencias: lo usan la tarjeta (/orders) y los dos ticketRenderers.

export interface PassCodeInput {
  channel?: string | null
  pos_short_code?: string | null
  platform_order_code?: string | null
  platform_order_ref?: string | null   // referencia LARGA (HubRise: order.ref)
  external_tab_ref?: string | null
  external_ref?: string | null
}

// De qué campo salió el código de pase (para decidir la parte destacada y el estilo).
export type PassSource = 'short' | 'platform' | 'tab' | 'none'

// De qué campo salió el SEGUNDO código. Lo usan los tres renderizadores para
// decidir la etiqueta: los de la plataforma llevan su nombre delante ("Glovo ·
// 101755551192"), el corto de Folvy no se disfraza de código del canal.
export type SecondarySource = 'platform' | 'ref' | 'short' | null

export interface PassCode {
  source: PassSource
  full: string              // código de pase completo (el GRANDE)
  lead: string              // parte NO destacada (prefijo): "" si no aplica
  emph: string              // parte DESTACADA (lo que canta el rider): dígitos o últimos 4
  secondary: string | null  // el OTRO código (pequeño), null si no hay
  secondarySource: SecondarySource
}

const clean = (s?: string | null): string => (s ?? '').trim()

// ── EL NÚMERO LARGO DE LA PLATAFORMA (27/08/2026) ───────────────────────────
// Por Last.app el ticket llevaba impreso el nº largo de Glovo (101753216562)
// porque `platform_order_code` ERA ese número. Por HubRise ese campo pasó a ser
// el `collection_code` (en Glovo, 3 dígitos) y el largo se quedó sin columna
// hasta 20260827T2100, que lo guarda en `platform_order_ref`. Es el número que
// hace falta para RECLAMAR a Glovo.
//
// No vale imprimirlo siempre, porque `ref` no significa lo mismo en los tres:
//   Glovo     ref 101755551192   ≠ collection_code   -> imprimir
//   Just Eat  ref 189793329      = collection_code   -> repetiría el mismo número
//   Uber      ref (uuid)                             -> ruido en un ticket
//
// Se decide POR LA FORMA DEL DATO, no por el canal — mismo criterio que
// hubrise_street_line y por la misma razón: `channel` es texto libre de la
// plataforma y no se le puede colgar una decisión de impresión.
//
// La regla vive AQUÍ y sólo aquí. Los tres renderizadores (ticket web de
// preview, ESC/POS nativo e imagen nativa) leen `secondary` y `secondarySource`
// y no vuelven a decidir nada: tres copias de una misma regla es exactamente
// como nació el fallo de la dirección de Glovo.
const LONG_REF_RE = /^[0-9]{6,20}$/

function longRef(o: PassCodeInput): string | null {
  const ref = clean(o.platform_order_ref)
  if (!ref) return null
  if (ref === clean(o.platform_order_code)) return null  // Just Eat: es el mismo
  if (!LONG_REF_RE.test(ref)) return null                // Uber: uuid fuera
  return ref
}

export function passCode(o: PassCodeInput): PassCode {
  const isUber = /uber/i.test(clean(o.channel))
  const short = clean(o.pos_short_code)
  const plat = clean(o.platform_order_code)

  // Fuente principal según canal, con fallback al otro código.
  let full = ''
  let source: PassSource = 'none'
  let secondary: string | null = null
  if (isUber) {
    if (plat)       { full = plat;  source = 'platform'; secondary = short || null }
    else if (short) { full = short; source = 'short' }
  } else {
    if (short)      { full = short; source = 'short';    secondary = plat || null }
    else if (plat)  { full = plat;  source = 'platform' }
  }

  // Sin ninguno de los dos códigos: cae al tab (últimos 5), o "—".
  if (!full) {
    const tab = clean(o.external_tab_ref) || clean(o.external_ref)
    const t = tab ? '#' + tab.replace(/-/g, '').slice(-5).toUpperCase() : '—'
    // Sin código de pase, el largo es lo único que queda para una incidencia.
    const lr = longRef(o)
    return {
      source: tab ? 'tab' : 'none', full: t, lead: '', emph: t,
      secondary: lr, secondarySource: lr ? 'ref' : null,
    }
  }

  full = full.toUpperCase()
  secondary = secondary ? secondary.toUpperCase() : null

  // El largo GANA al otro código cuando la forma del dato dice que es un número
  // de reclamación de verdad. En Glovo el `secondary` de hoy es el corto ("954"),
  // que ya se lee entero dentro del grande ("G954"): sustituirlo no pierde nada
  // y añade el número con el que se reclama.
  let secondarySource: SecondarySource =
    secondary === null ? null : (secondary === clean(o.platform_order_code).toUpperCase() ? 'platform' : 'short')
  const lr = longRef(o)
  if (lr) { secondary = lr; secondarySource = 'ref' }

  // Parte destacada según la fuente:
  //   short    → dígitos finales ("G315" → "315"); si no hay dígitos, todo.
  //   platform → últimos 4 (Uber canta el final; en un largo de Glovo es lo menos malo).
  let emph = full
  let lead = ''
  if (source === 'short') {
    const m = full.match(/\d+$/)
    if (m) { emph = m[0]; lead = full.slice(0, full.length - emph.length) }
  } else if (source === 'platform') {
    emph = full.slice(-4)
    lead = full.slice(0, full.length - emph.length)
  }

  return { source, full, lead, emph, secondary, secondarySource }
}
