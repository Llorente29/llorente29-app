# ENCARGO CLAUDE CODE — v3 · Paso 3: mostrar el REGALO por marca en el storefront

## Contexto
El agente de ofertas ya crea **regalos por marca** (`coupon.kind='free_item'` con `campaign_scope`
apuntando a un `menu_item` de esa marca) y el cobro (`place_shop_order`) **ya los aplica** por la
marca del carrito (verificado con dry-run). Falta que el storefront **muestre** el regalo en la
carta ("Pide 15€ y llévate una MAHOU gratis"). Hoy el regalo ya se ve en el **carrito** (vía
`place_shop_order`), pero NO se anuncia en el hub ni en el menú de marca.

Ya existe en la BD la función `public._shop_brand_free_gift(p_account uuid, p_brand uuid)` que
devuelve `{ name, min, value }` del regalo de UNA marca (o `null`). Solo hay que enchufarla en el
display + renderizarla en el front.

## Regla de oro
**SOLO AÑADIR, NUNCA QUITAR.** Es el storefront en producción (con Stripe live). No elimines ni
cambies ningún campo que ya devuelvan las funciones ni que ya use el front. Solo añade el campo
`gift`. Si dudas, no toques.

## IMPORTANTE — el repo está DESACTUALIZADO respecto a la BD viva
Las migraciones del repo para `shop_hub_by_slug` / `shop_brand_menu_by_slug` son ANTIGUAS (les
faltan campos de oferta que la función VIVA sí tiene: `_shop_brand_best_offer`, `free_delivery`,
`free_gift`, etc.). NO reconstruyas desde el repo. Parte SIEMPRE de la definición **viva**:

```sql
select pg_get_functiondef('public.shop_hub_by_slug(text)'::regprocedure);
select pg_get_functiondef('public.shop_brand_menu_by_slug(...)'::regprocedure);
```
(usa `\df shop_brand_menu_by_slug` o pg_proc para la firma exacta de la 2ª; probablemente
`(p_slug text, p_brand_id uuid)`).

## Tareas

### 1) RPC — añadir el regalo por marca (desde la definición VIVA)
- **`shop_hub_by_slug(p_slug)`**: en el `jsonb_build_object` de CADA marca dentro del `jsonb_agg`
  que arma `v_brands` (donde ya va `'offer', public._shop_brand_best_offer(v_account_id, b.id)`),
  añade una clave:
  ```
  'gift', public._shop_brand_free_gift(v_account_id, b.id)
  ```
  Deja intacto el `'free_gift'` de cuenta que ya devuelve a nivel raíz (no lo quites).
- **`shop_brand_menu_by_slug(p_slug, p_brand_id)`**: en el `jsonb_build_object` del `return`
  (donde ya va `'free_delivery', public._shop_account_free_delivery(v_account_id)`), añade:
  ```
  'gift', public._shop_brand_free_gift(v_account_id, p_brand_id)
  ```
  (usa el id de marca que la función ya tiene: `p_brand_id` o `v_brand.id`).
- Reconstruye cada función con `CREATE OR REPLACE`, **verbatim** salvo esa línea añadida,
  conservando `security definer`, `set search_path = public`, firma y `grant ... to anon, authenticated`.

### 2) Versionar (saldar el drift)
Guarda las definiciones VIVAS + el cambio como migraciones nuevas en `supabase/migrations/`:
- `2026____T_____shop_hub_by_slug_v5_gift.sql`
- `2026____T_____shop_brand_menu_by_slug_gift.sql`
Así el repo queda por fin sincronizado con la BD (hoy no lo está).

### 3) Frontend — renderizar el badge del regalo
Busca dónde el front consume `shop_hub_by_slug` y `shop_brand_menu_by_slug` (probable:
`src/modules/shop/**` — rutas `ShopHubRoute` / `BrandMenuRoute` o similares; `git grep -l
shop_hub_by_slug src`, `git grep -l free_delivery src`). Donde hoy pinta `free_delivery` /
`offer`, añade —mismo estilo, sin romper el layout— un badge del regalo cuando `gift` no sea null:

> 🎁 {gift.name} gratis desde {gift.min}€  (si `gift.min` es null → "con tu pedido")

- En el **hub**: pequeño chip en la tarjeta de marca (junto al de oferta), solo si `brand.gift`.
- En el **menú de marca**: banner/chip arriba (junto al de envío gratis), solo si `gift`.
- Tipos TS: añade `gift?: { name: string; min: number | null; value: number } | null` a las
  interfaces de marca/menú que ya existan. NO rompas las que hay.

### 4) Verificación
- SQL: confirma que el hub trae el regalo de Bendito:
  ```sql
  select b->'gift'
  from jsonb_array_elements((select shop_hub_by_slug((select slug from accounts where id='51ad1792-6629-4ef7-833a-b57b09a86710')))->'brands') b
  where b->>'name' ilike '%Bendito%';
  ```
  Debe salir `{ "name": "...", "min": ..., "value": ... }` cuando Bendito tenga un regalo activo
  (hoy el regalo del agente está en estado `propuesta`/`active=false`; para VER el badge, activa
  temporalmente uno de Bendito o crea uno de prueba `active=true` y bórralo después).
- `npm run build` verde.
- Regresión: abre el hub y el menú de una marca SIN regalo → todo igual que antes (el badge no
  aparece, nada roto).

### 5) Rutas / notas
- NO toques `place_shop_order` (ya está bien).
- NO toques `_shop_brand_free_gift` (ya está creada y probada).
- Commit descriptivo. Reporta: las dos migraciones creadas, los ficheros de front tocados, y el
  resultado de la verificación SQL del regalo de Bendito.
