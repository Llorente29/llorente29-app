# Auditoría de seguridad — funciones `*_by_token` (07/08/2026)

## Objetivo
Verificar que ninguna función `*_by_token` (las que sirven datos/acciones **sin sesión de Supabase**,
por token de dispositivo o de repartidor) permita que un token de una cuenta/local acceda a datos de
otra. Superficie crítica para multi-tenencia antes del cliente 2.

## Alcance
29 funciones `*_by_token` (todas SECURITY DEFINER) + los 2 resolutores de token.

## Método
1. Listado + firma de las 29.
2. Clasificación: cuáles reciben un id de objeto por parámetro (sale, menu_item, brand, printer, assignment).
3. Lectura del cuerpo de **las 13 que reciben id de objeto** (las de riesgo real) + de los 2 resolutores.

## Resultado: ✅ TODO CORRECTO — sin agujeros, sin cambios

**Resolutores (la pieza maestra):**
- `kds_resolve_device(token)` → `select * from kds_device where token = p_token and is_active`. La cuenta
  y el local salen del propio registro del token; token inválido → fila nula (los llamadores lo rechazan).
- `_courier_by_token(token)` → `where access_token = p_token and active`, lanza excepción si no existe.
- **Ninguno acepta cuenta/local del que llama**: siempre se deriva del token. No hay inyección de ámbito posible.

**Las 13 funciones con id de objeto — todas acotan al ámbito del token**, por uno de dos patrones válidos:
- *Raise-on-mismatch*: `set_order_status` (cuenta+local de la venta), `set_brand_status` (cuenta de la
  marca), `set_product_availability` (cuenta del producto), `courier_advance` ("este pedido no es tuyo").
- *WHERE-scoping*: `delete_printer` / `upsert_printer` / `enqueue_test_print` (printer `where account_id AND
  location_id` del dispositivo), `reprint_order` (venta en el local del dispositivo), `courier_claim` /
  `courier_decline` (`where account_id = c.account_id AND courier_id IS NULL ...`), `preview_scope` /
  `preview_scope_bulk` (menu_item `where account_id = v_device.account_id`), `set_products_availability_bulk`
  (rechaza si algún producto no es de la cuenta del dispositivo).

**Las 16 restantes** (feeds, paneles, sesión, track, ping, earnings…) no reciben id de objeto: derivan el
ámbito del token y devuelven solo los datos de ese ámbito.

## Conclusión
La superficie `*_by_token` es **hermética contra acceso entre cuentas**. Disciplina consistente en todo el
conjunto. No se requiere ninguna migración. Punto cerrado del inventario de seguridad (F0).

> Nota: si en el futuro se añade una nueva `*_by_token`, debe seguir el mismo patrón — resolver el token a
> su ámbito y acotar TODO objeto a ese ámbito (raise-on-mismatch o WHERE-scoping), nunca fiarse de un
> id/ámbito recibido por parámetro.
