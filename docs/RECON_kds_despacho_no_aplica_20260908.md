# RECON · El KDS pinta como FALLO lo que es lo correcto (§4 del encargo)

**Fecha:** 08/09/2026 · **Rama:** `claude/schema-migrations-repo-40d7u8` · **Escribe:** nada. Lectura pura.
**Encargo:** `ENCARGO_CODE_kds_despacho_cedidas`, §4. Cierra el lazo de B70: allí el guardarraíl quedó bien;
lo que falta es que el KDS deje de gritar cuando el guardarraíl actúa.

> **Titular:** el diagnóstico de Julio es correcto y **el alcance es 4 veces mayor de lo que parecía**. No son
> 3 pedidos de cedida: son **69 pedidos de marcas que no reparten** los que han caído en la tarjeta de
> despacho propio — **46 con banner rojo y 23 con un botón azul «Despachar reparto» que tampoco puede
> funcionar nunca**. Y sigue pasando hoy: el último es del 08/09.

---

## §1 · De dónde sale el estado (§4.1) — persistido, y en texto libre

Cadena completa, con fichero y línea:

| paso | dónde |
|---|---|
| decide si se despacha | `resolve_dispatch()` (BBDD) → devuelve `(carrier, reason)` |
| se guarda el motivo | **`sale.dispatch_error`**, `text` libre |
| lo sirve al KDS | `orders_feed()` / `orders_feed_by_token()` |
| decide la cara de la tarjeta | `src/modules/orders/components/OrderCard.tsx:382` |
| el botón | `OrderCard.tsx:409` · y `DispatchBoardPage.tsx:273` |

```ts
// OrderCard.tsx:382
if (isOwnDeliveryUndispatched(order) && order.dispatch_mode !== 'off') {
  const failed = !!order.dispatch_error          // ← 383. Aquí está el bug.
```
```ts
// ordersFeedService.ts:387
export function isOwnDeliveryUndispatched(order: OrderFeedItem): boolean {
  return (order.service_type === 'own_delivery') && !order.carrier_code
}
```

**La rama (A) se activa por `service_type`, no por si la marca reparte.** Un Just Eat de Dos Coyotes llega
con `service_type = 'own_delivery'` (para Last ES un reparto), sin `carrier_code` (porque el resolutor lo
rechazó, correctamente), con `dispatch_mode = 'auto'` y con `dispatch_error` puesto → rojo + reintentar.

**Y la UI no puede hacerlo mejor aunque quiera:** `orders_feed` expone `brand_ownership_type` pero **NO
expone el interruptor de reparto propio**. El dato con el que decidir no le llega.

## §2 · El interruptor (§4.2) — está bien puesto, y es derivado

`resolve_dispatch`, vivo:

```sql
-- GUARD: interruptor de reparto propio por marca.
-- own_delivery_enabled NULL → deriva de ownership_type (propia=on, cedida=off).
SELECT coalesce(b.own_delivery_enabled, b.ownership_type = 'own') INTO v_brand_enabled ...
IF v_brand_enabled IS NOT TRUE THEN
  RETURN QUERY SELECT NULL::text, 'marca sin reparto propio (interruptor apagado)'::text;
```

Es `brand.own_delivery_enabled`, y cuando está a NULL **se deriva de `ownership_type`**. Bien pensado: una
cedida está apagada por defecto sin que nadie tenga que acordarse.

| ownership_type | marcas | interruptor ON | OFF | sin poner (NULL) |
|---|---|---|---|---|
| `licensed` | 9 | 0 | 0 | **9** → derivado OFF |
| `own` | 9 | 0 | **2** | 7 → derivado ON |

**Confirmado:** para las 9 cedidas está apagado (derivado), y el guardarraíl de B70 es lo que produce el
no-despacho. **El despacho hace lo correcto. El bug es sólo de presentación**, como decía el encargo.

**Un detalle del texto, que es parte del problema:** «interruptor apagado» describe el caso de una marca
PROPIA con el flag a `false` (hay 2). Para una cedida nadie apagó nada — **nunca tuvo interruptor**. El
mensaje manda al cocinero a buscar un interruptor que no existe.

## §3 · Distinguir los dos estados (§4.3) — hoy NO se puede

`resolve_dispatch` devuelve **prosa, sin código de motivo**. Los rechazos salen todos igual —`carrier` a NULL
y un `reason` distinto— y acaban los cuatro en la misma columna `sale.dispatch_error`:

| motivo devuelto | qué es de verdad |
|---|---|
| `venta no encontrada` | fallo |
| `marca sin reparto propio (interruptor apagado)` | **NO APLICA** |
| `sin dirección de entrega: la plataforma no la ha enviado` | **NO APLICA** (lo dice el propio comentario del resolutor: «en Glovo la ausencia de direccion es justamente la señal de que reparte la plataforma») |
| todo lo demás (Catcher caído, sin rider en 8 min…) | fallo |

**Una columna, dos significados, separados sólo por la prosa de dentro.** La UI tendría que hacer
`ilike '%interruptor apagado%'` para distinguirlos — y el comentario de `ordersFeedService.ts:484` presume,
con razón, que el motivo lo escribe el resolutor «si algún día cambia la regla, el mensaje cambia con ella».
Las dos cosas juntas son una trampa: **el día que se reescriba el texto, la pantalla vuelve a ponerse roja
sin que nadie toque la pantalla.**

→ **Hace falta un motivo estructurado**, no una cadena. Es la respuesta al §4.3: hoy no hay forma, y hay que
crearla.

## §4 · Alcance (§4.4) — 69 pedidos, no 3

Pedidos que caen en la rama (A) —`service_type='own_delivery'`, sin `carrier_code`, `dispatch_mode ≠ 'off'`—
**de marcas que NO reparten** (interruptor efectivo apagado):

| marca | vía | banner rojo | sólo botón azul | total | desde → hasta |
|---|---|---|---|---|---|
| `licensed` | lastapp | 9 | 8 | **17** | 12/06 → **08/09** |
| `own`, interruptor `false` | hubrise | 25 | 0 | **25** | 28/08 → 06/09 |
| `own`, interruptor `false` | lastapp | 12 | 15 | **27** | 14/06 → 22/08 |
| | | **46** | **23** | **69** | |

Tres cosas que esto añade al encargo:

1. **No es sólo de cedidas.** 52 de los 69 son marcas PROPIAS con el interruptor apagado a mano. El §2 del
   encargo ya lo cubre («cedida, o interruptor de reparto propio apagado») — la medición confirma que la
   forma general hacía falta.
2. **No es sólo Last→Just Eat.** Pasa por `lastapp` y por `hubrise`.
3. **23 de los 69 no tienen ni banner rojo: sólo el botón azul «Despachar reparto».** Es el mismo pecado de
   la regla 35 —un botón sin destino— pero *sin* el rojo que al menos avisa de que algo pasa. El cocinero lo
   pulsa, el resolutor dice que no, y aparece el rojo. **La pantalla fabrica el error que luego enseña.**

*Cautela sobre esta cifra, y va dicha:* el interruptor se evalúa con la configuración de HOY sobre ventas
desde junio. Para las 9 cedidas es firme (`own_delivery_enabled` está a NULL en las nueve, así que el
derivado siempre ha sido «no»). Para las 2 propias con `false` explícito **no puedo fechar cuándo se apagó**,
así que sus 52 pedidos son un techo, no un dato exacto. Los 17 de cedida sí son exactos.

## §5 · Lo que ya existe y no hay que inventar

El estado tranquilo que pide el §2.1 **ya está construido**: la rama (B) de la misma función.

```ts
// OrderCard.tsx — tras la rama (A)
if (d.kind === 'platform') return <PlatformDeliveryRow view={d} />
```

`deliveryView` la produce con `carrierLabel: order.channel ?? 'la plataforma'` y hasta el teléfono de soporte
del canal. Es exactamente «Entrega: la reparte Just Eat», en gris, sin alarma y sin botón.

**Pero hoy una cedida no llega ahí:** `deliveryView` sólo devuelve `platform` si
`isPlatformDelivery(order.service_type)`, y el `service_type` de estos pedidos es `'own_delivery'`. Sin tocar
eso, sacarlos de la rama (A) los dejaría en `kind: 'none'` → **sin ninguna línea de entrega**, que tampoco es
lo que pide el encargo.

## §6 · Propuesta (para aprobar antes de construir)

Cuatro piezas pequeñas, ninguna toca el despacho:

1. **Una sola definición de «esta marca reparte»**, en la base:
   `public.marca_reparte_propio(brand_id) → boolean`, con la MISMA expresión que hoy vive dentro de
   `resolve_dispatch`. La usan el resolutor y los dos feeds. Nunca dos implementaciones de la misma regla,
   una buena y otra que se queda atrás — que es justo lo que costó el mes del importador.
2. **`orders_feed` / `orders_feed_by_token` exponen `brand_own_delivery`** (booleano). Es el dato que la UI
   necesita y hoy no recibe.
3. **`isOwnDeliveryUndispatched` deja de ser cierta** cuando la marca no reparte, y `deliveryView` devuelve
   `platform` en ese caso, con `order.channel` de etiqueta. Cae sola en la rama (B): línea tranquila, sin
   rojo, sin botón. Barrido de lectores (regla 32): **3 sitios** llaman a `isOwnDeliveryUndispatched`
   (`OrderCard.tsx:382`, `DispatchBoardPage.tsx:53` y `:246`), y `DispatchBoardPage.tsx:53` además hace
   `|| !!o.dispatch_error`, que hay que acotar igual o el tablero seguirá listándolos como pendientes.
4. **Motivo estructurado en el rechazo.** `resolve_dispatch` devuelve además un código
   (`no_aplica_marca` / `no_aplica_sin_direccion` / `fallo_*`) y se persiste junto al texto, para que la
   pantalla no tenga que leer prosa. **Ojo, regla 2:** añadir una columna al `RETURNS TABLE` de
   `resolve_dispatch` **cambia su firma de salida** → DROP + CREATE, con sus llamadores delante, nunca
   `CREATE OR REPLACE`.

**Lo que NO se toca, y hay que decirlo:** el caso 1 del §1 del encargo —fallo real en marca que SÍ reparte—
se queda exactamente igual, rojo y con reintentar. Son los 50 pedidos de `own` + interruptor ON del recuento.
La corrección no puede apagar la alarma de quien sí reparte y de verdad falló.

## §7 · Preguntas para Julio

1. **El botón azul en los 23 pedidos sin rojo.** ¿Confirmas que también sobra? Cae dentro de la regla del
   §2 («no muestra… ni botón de reintentar»), pero el encargo describe el rojo y quiero decirlo explícito
   antes de quitarlo: son pedidos donde hoy el cocinero ve «Despachar reparto» y no debería.
2. **«Sin dirección» en marca que SÍ reparte** (2 pedidos): el propio resolutor dice que la falta de
   dirección es la señal de que reparte la plataforma. ¿Va también a «no aplica», o prefieres que ése siga
   avisando porque en una marca propia sí podría ser un fallo de la integración?
3. **Orden.** Prioridad alta y es de cocina en vivo, pero el §5 lo deja a tu decisión frente al importador.
   Dime cuál va antes.

**Nada de esto se ha construido.** La RECON no escribe.
