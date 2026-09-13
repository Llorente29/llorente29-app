-- QUE SIGNIFICA «DECIDIDA»: no «tiene fila», sino «tiene fila que descuenta algo».
--
-- Encargo de Julio, 13/09 14:35 §2. Esta es SOLO la definicion; las tres
-- puertas de escritura van detras, y el CHECK de la tabla esta noche.
--
-- ── LA BANDA: cumple las tres, y por eso entra ahora ──────────────────────
--   1. NO ESCRIBE. Es `immutable`, no toca ninguna tabla.
--   2. NO LA LLAMA NADA VIVO. Es nueva: 0 funciones, 0 crons, 0 disparadores,
--      0 front. Nadie la nombra todavia.
--   3. SE DICE ANTES. Dicho en el parte antes de aplicarla.
--
-- ── POR QUE EXISTE ────────────────────────────────────────────────────────
--
-- El 13/09 a las 11:40:15 se guardaron desde el tablero 5 «Maiz» y «Frijoles»
-- (Bendito Burrito) con ficha y SIN cantidad. El contador bajo de 107 a 105 y
-- el consumo real es CERO:
--
--   `_sale_line_raw_consumption` hace `mri.quantity * COALESCE(m.quantity, 1)`
--   y la de la IZQUIERDA no esta coalescida. null x 1 = null, `_qty_in_base`
--   devuelve null, y `explode_recipe_to_raws` con null devuelve CERO FILAS.
--   Medido sobre la fila real: consumo 0; con cantidad 1 seria 1.
--
-- Hasta hoy «decidida» era EXISTS(impacto confirmado), o sea TIENE FILA. El 105
-- era PEOR que el 107 porque parecia progreso, y un contador que miente apaga
-- la unica alarma que hay para las 105 restantes.
--
-- Y NO HABIA OTRA: `modifier_zero_cost_watchdog` las habria marcado por su suma
-- de coste cero, pero su puerta es `price_impact > 0` y las dos son GRATIS.
-- Medido con su propio predicado: no pasan la puerta. El vigia vigila DINERO,
-- no stock.
--
-- ── QUE EXIGE CADA TIPO, MEDIDO SOBRE LAS 131 FILAS DE LA TABLA ───────────
--
-- Un candado plano seria el proximo fallo. Los seis tipos, contados hoy:
--
--   add_item      75 filas · 2 sin cantidad (las de hoy) · 0 sin ficha
--                 -> ficha Y cantidad
--   bundle        43 filas · 0 y 0, todas cantidad 1        -> ficha Y cantidad
--   remove_item    3 filas · 0 y 0 (las 3 «Sin pepinillos», 20 de Pepinillos
--                 Agridulce)                                -> ficha Y cantidad
--                 OJO: el encargo suponia que un «quita» no lleva cantidad y LA
--                 TABLA DICE LO CONTRARIO. El motor resta `qty_base` calculado
--                 de `mri.quantity`: un quita sin cantidad no resta nada, o sea
--                 el mismo fallo con otro signo. Gana lo que se mide.
--   replace_item   3 filas, todas `proposed` y de la cuenta plantilla
--                 -> ficha Y cantidad, por simetria con add_item
--   multiply       0 filas -> CANTIDAD Y NO FICHA. El motor hace
--                 `qty_base * (COALESCE(mri.quantity,1) - 1)` sobre la receta
--                 del PLATO (`mi.recipe_item_id`) y NO mira
--                 `target_recipe_item_id`. Con cantidad nula escala por cero:
--                 otro no-op callado.
--   none           7 filas · 5 sin ficha ni cantidad -> NO EXIGE NADA. Es una
--                 respuesta entera por si misma: «no lleva nada».
--
-- ── LO QUE NO HACE, A PROPOSITO ───────────────────────────────────────────
--
-- No dice nada de lo que SOBRA. Hay 2 filas `none` con ficha y cantidad —«Con
-- Pepinillos» de Lobbers (17/06) y «Base Pollo (The OG)» de Milanesa House
-- (31/08)—. Pueden ser restos de una edicion anterior o un olvido de verdad (la
-- segunda huele a que elegir la base de pollo deberia consumir la milanesa),
-- pero eso lo decide quien lo sabe, no una migracion. Se dicen y se dejan.
--
-- ── EL EFECTO, MEDIDO ANTES ───────────────────────────────────────────────
--   impactos confirmados 128 · completos 126 · a medias 2 (los de hoy)
--   contador hoy 105 activas sin decidir · con esta definicion 107
--   toda la tabla 131 filas · incumplirian 2 · ninguna otra

create or replace function public._impacto_completo(
  p_tipo     text,
  p_ficha    uuid,
  p_cantidad numeric
) returns boolean
language sql
immutable
parallel safe
as $imp$
  select case p_tipo
           when 'none'         then true
           when 'multiply'     then p_cantidad is not null and p_cantidad > 0
           when 'add_item'     then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           when 'remove_item'  then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           when 'replace_item' then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           when 'bundle'       then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           -- Un tipo desconocido NO se da por bueno: mejor que cuente como
           -- pendiente y se mire, a que desaparezca del contador.
           else false
         end;
$imp$;

comment on function public._impacto_completo(text,uuid,numeric) is
  'Que significa DECIDIDA: no «tiene fila», sino «tiene fila que descuenta algo». Unica definicion; la comparten las tres puertas de escritura, el contador del tablero 1 y el CHECK de la tabla.';

revoke all on function public._impacto_completo(text,uuid,numeric) from public;
grant execute on function public._impacto_completo(text,uuid,numeric) to authenticated;
