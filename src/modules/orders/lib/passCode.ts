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
  external_tab_ref?: string | null
  external_ref?: string | null
}

// De qué campo salió el código de pase (para decidir la parte destacada y el estilo).
export type PassSource = 'short' | 'platform' | 'tab' | 'none'

export interface PassCode {
  source: PassSource
  full: string              // código de pase completo (el GRANDE)
  lead: string              // parte NO destacada (prefijo): "" si no aplica
  emph: string              // parte DESTACADA (lo que canta el rider): dígitos o últimos 4
  secondary: string | null  // el OTRO código (pequeño), null si no hay
}

const clean = (s?: string | null): string => (s ?? '').trim()

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
    return { source: tab ? 'tab' : 'none', full: t, lead: '', emph: t, secondary: null }
  }

  full = full.toUpperCase()
  secondary = secondary ? secondary.toUpperCase() : null

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

  return { source, full, lead, emph, secondary }
}
