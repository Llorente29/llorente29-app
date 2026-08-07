# ENCARGO CODE — Allowlist de `anon` EXECUTE para cerrar F0.1

## Contexto
Quedan **325 funciones SECURITY DEFINER ejecutables por `anon`**. Muchas son helpers internos que solo
llaman usuarios logueados (rol `authenticated`) — a esas hay que **revocar `anon`**. Pero algunas SÍ las
llama el público sin sesión (con la anon key): la tienda, la tablet/kiosko, la app de repartidor. Revocar
`anon` a ciegas rompería esas superficies. Este encargo construye la **allowlist** (lo que DEBE conservar
`anon`) para que Claude, después, revoque `anon` de todo lo demás con seguridad.

## Objetivo
Producir una lista de **nombres de función que se invocan sin sesión de Supabase** (con la anon key),
mirando las superficies públicas del repo + las Edge Functions.

## Ya sabemos (no hace falta grep, van directas a la allowlist)
- **Las 29 `*_by_token`** (tablet/kiosko/repartidor usan anon key + token propio). Auditadas hoy: todas
  atan el token a su cuenta. → allowlist.
- Sus resolutores/ayudantes: `kds_resolve_device`, `_courier_by_token`, `_set_product_availability_core`,
  `_scope_preview_core`, `_build_test_ticket`, `courier_payout`, `sale_delivery_distance_km`,
  `location_surge_pct` (los que llaman las `*_by_token`). Verificar en el grep cuáles se llaman anidados.

## Grep a hacer (superficies públicas → qué RPC/función tocan)
Buscar en el **front** las llamadas `.rpc(` / `functions.invoke(` / `.from(` que ocurren en páginas
públicas / sin login:
- Tienda pública: rutas `/t/:slug`, checkout, carrito (place_shop_order, resolve_delivery_zone, lectura de
  carta/marcas del shop, `business_hours`/`is_brand_open`, Stripe intent).
- Captura de consentimiento / CRM público: `register_shop_consent`, `customer_*` (OTP, sesión, cupón).
- Estación/KDS sin login: `/estacion`, `/cocina-tv` (además de las `*_by_token`).
- App de repartidor: pantallas de courier (además de las `courier_*_by_token`).
Y en **`supabase/functions/*`**: qué funciones SQL invocan las edges que reciben llamadas de anon
(las `--no-verify-jwt`), por si alguna necesita `anon`.

Comandos sugeridos (PowerShell, desde la raíz del repo):
```powershell
# RPCs llamadas desde el front
Select-String -Path (Get-ChildItem -Recurse -Include *.ts,*.tsx src).FullName -Pattern "\.rpc\(\s*['""]([a-z0-9_]+)" | ForEach-Object { $_.Matches.Groups[1].Value } | Sort-Object -Unique
# Edges y sus llamadas SQL
Select-String -Path (Get-ChildItem -Recurse -Include *.ts supabase/functions).FullName -Pattern "\.rpc\(\s*['""]([a-z0-9_]+)" | ForEach-Object { $_.Matches.Groups[1].Value } | Sort-Object -Unique
```
(Idealmente separar las que están en páginas públicas de las que están tras login; si no es fácil,
listar todas y Claude filtra contra las 325 anon-exec.)

## Entregable
Un fichero `docs/allowlist_anon_execute.md` con:
1. La lista de funciones que se invocan sin sesión (público/tablet/shop/courier) → **conservan `anon`**.
2. (Opcional) las que se llaman solo tras login → candidatas a revocar `anon`.

## Después (lo hace Claude, no Code)
Con la allowlist, Claude cruza contra las 325 anon-exec, **revoca `anon` de las que no están en la
allowlist** (manteniendo `authenticated`/`service_role`), por lotes con verificación
(`has_function_privilege('anon', oid, 'EXECUTE')`) y prueba de humo del Shop + tablet. Cierra F0.1.

## Regla de oro (para funciones nuevas)
Toda función pública nueva (shop/tablet/courier) debe: ser SECURITY DEFINER, resolver su ámbito de un
token/sesión propia (nunca fiarse de un account_id recibido), y quedar en la allowlist. Las internas: sin
`anon` (solo `authenticated`/`service_role`).
