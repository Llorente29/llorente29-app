// src/modules/shop/shopHost.ts
//
// Resolución del Shop por HOSTNAME (subdominio por tienda: <slug>.folvy.app).
// Capa 1 del frente "dominio de la tienda": cada tienda tiene su subdominio
// limpio en folvy.app, resuelto en el arranque del front (SPA pura, sin
// servidor). El backend NO se toca: el slug derivado del host se sigue pasando
// como p_slug a las mismas RPC del Shop.
//
// Reglas (conservadoras, para no capturar por error dominios que NO son tienda):
//   - Solo subdominios de un único nivel de `folvy.app`  →  <slug>.folvy.app
//   - Se EXCLUYEN: el apex (folvy.app), `app.folvy.app`, `www.folvy.app`,
//     los previews de Vercel (*.vercel.app), localhost e IPs.
//   - Multi-nivel (a.b.folvy.app) NO se soporta (no es un slug válido).
//
// Capa 2 (dominio 100% propio del cliente, p.ej. pedidos.llorente29.com) NO se
// resuelve aquí: ese hostname no contiene el slug y necesitará un mapeo
// host→slug en servidor. Este módulo se diseña para ampliarse sin reescribir:
// isShopHost() seguirá valiendo para *.folvy.app y la Capa 2 añadirá su rama.

const ROOT = 'folvy.app'
const RESERVED = new Set(['app', 'www'])

/** true si el hostname actual es un subdominio de tienda `<slug>.folvy.app`. */
export function isShopHost(): boolean {
  const host = window.location.hostname.toLowerCase()
  if (!host.endsWith('.' + ROOT)) return false          // apex o dominio ajeno → no
  const sub = host.slice(0, -('.' + ROOT).length)
  if (!sub || sub.includes('.')) return false            // vacío o multi-nivel → no
  if (RESERVED.has(sub)) return false                    // app / www → no (app de gestión)
  return true
}

/** El slug de la tienda derivado del subdominio, o null si no es host de tienda. */
export function shopSlugFromHost(): string | null {
  if (!isShopHost()) return null
  const host = window.location.hostname.toLowerCase()
  return host.slice(0, -('.' + ROOT).length)
}
