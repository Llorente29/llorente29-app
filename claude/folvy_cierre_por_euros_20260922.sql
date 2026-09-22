-- ============================================================================
-- EL CIERRE POR EUROS — el nucleo del vigia nuevo
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
--
-- Esto no es el vigia: es la PIEZA que el vigia tiene que tener dentro, y la
-- unica propiedad que el encargo dice que importa de verdad:
--
--     vendido = completo + suma de cada causa,   al centimo.
--
-- PROBADO el 22/09 sobre 12/09–21/09:
--
--   1 · sin casar con la carta              29 lineas      206,13 EUR
--   2 · sin ficha y sin descontar            7 lineas       75,10 EUR
--   3 · con ficha y cero movimientos         6 lineas       81,60 EUR
--   4 · descuenta, le falta un ingrediente  93 lineas    1.897,42 EUR
--   5 · la comida si, el envase nunca    1.710 lineas   24.486,51 EUR
--   6 · completo                           497 lineas    7.498,70 EUR
--   ------------------------------------------------------------------
--   TOTAL                                2.342 lineas   34.245,46 EUR   ✅ cierra
--
-- LAS DOS DECISIONES QUE LO HACEN FUNCIONAR:
--
-- (a) Lo esperado sale de `_sale_line_raw_consumption`, la MISMA funcion del
--     motor, no de una replica. Por eso los dos falsos positivos del encargo se
--     caen solos: un combo sin ficha carga sus movimientos a la linea PADRE y
--     la funcion lo sabe; los `modifier` no conducen y la funcion tampoco los
--     cuenta. No hay que excluirlos a mano: no aparecen.
--
-- (b) El ENVASE necesita su propia medida y no puede salir de esa funcion.
--     `explode_recipe_to_raws` solo para en 'raw'/'tool'/receta stockable; un
--     'packaging' no tiene lineas hijas, asi que devuelve CERO filas. O sea:
--     el motor no es que se salte el envase por un filtro, es que el envase es
--     INVISIBLE para el, por construccion. Preguntarle al motor por el envase
--     siempre dira que todo va bien. Por eso la casilla 5 se mide mirando el
--     escandallo (`recipe_line` -> `recipe_item.type='packaging'`), no la
--     funcion.
--
-- 🔴 LO QUE ESTA CONSULTA TODAVIA NO SEPARA, y hay que resolver antes de que
--    esto avise a nadie: la casilla 4 mezcla dos cosas distintas.
--    `_sale_line_raw_consumption` calcula lo esperado con la receta de HOY,
--    pero los movimientos se escribieron con la receta que habia EL DIA DE LA
--    VENTA. Si alguien anade un ingrediente hoy, todas las ventas anteriores
--    de ese plato aparecen como «le falta un ingrediente» y no falta nada.
--    Se ve en los datos: 22 lineas con el mismo importe exacto y SIETE
--    ingredientes faltando a la vez no es el motor saltandose siete cosas.
--    Lo intente cuantificar dos veces el 22/09 y las dos consultas salieron
--    mal, asi que NO hay numero. Es el siguiente paso, y decide si el vigia
--    avisa o grita en falso.
-- ============================================================================

with u as (   -- ── EL UNIVERSO, definido UNA vez ─────────────────────────────
  -- Que sea una sola definicion es medio encargo: el 22/09 el parte decia
  -- 2.343 lineas / 34.309,96 EUR y esta consulta da 2.342 / 34.245,46. Una
  -- linea y 64,50 EUR de diferencia que no se pudo explicar (no es la zona
  -- horaria: UTC, Madrid y dia-de-negocio dan los tres lo mismo; y no hay
  -- ninguna linea anulada de ese importe). Mientras el universo no viva en un
  -- solo sitio, dos personas honestas sacan dos numeros.
  select sl.id,
         coalesce(sl.line_total,0) as eur,
         sl.menu_item_id,
         mi.recipe_item_id,
         exists (select 1 from sale_line h
                  where h.parent_sale_line_id = sl.id and h.line_type = 'combo_item') as es_combo
  from sale s
  join sale_line sl on sl.sale_id = s.id and sl.account_id = s.account_id
  left join menu_item mi on mi.id = sl.menu_item_id and mi.account_id = sl.account_id
  where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and s.sold_at >= '2026-09-12' and s.sold_at < '2026-09-22'   -- ventana limpia
    and coalesce(sl.line_type,'product') = 'product'
    and coalesce(s.order_status,'') not in ('cancelled','rejected','delivery_failed')
    and s.cancelled_at is null
),
esp as (      -- lo que el MOTOR dice que habria que consumir
  select u.id, e.raw_item_id, sum(e.qty_base) as qty
  from u cross join lateral public._sale_line_raw_consumption(u.id) e
  group by u.id, e.raw_item_id
),
real as (     -- lo que se consumio de verdad
  select sm.sale_line_id as id, sm.recipe_item_id as raw_item_id, sum(abs(sm.qty_base)) as qty
  from stock_movement sm
  where sm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and sm.movement_type = 'consumo' and sm.source_type = 'sale'
    and sm.sale_line_id is not null
  group by 1,2
),
pack as (     -- el envase que el escandallo dice que lleva (invisible al motor)
  select u.id, count(*) as n_envases
  from u
  join recipe_line rl on rl.parent_item_id = u.recipe_item_id
                     and rl.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  join recipe_item c on c.id = rl.child_item_id and c.account_id = rl.account_id
                    and c.type = 'packaging'
  group by u.id
),
cmp as (
  select u.*,
         coalesce((select count(*) from esp where esp.id = u.id), 0) as n_esp,
         coalesce((select count(*) from real where real.id = u.id), 0) as n_real,
         coalesce((select count(*) from esp
                    where esp.id = u.id
                      and not exists (select 1 from real
                                       where real.id = esp.id
                                         and real.raw_item_id = esp.raw_item_id)), 0) as n_faltan,
         coalesce((select n_envases from pack where pack.id = u.id), 0) as n_envases
  from u
)
select casilla, count(*) as lineas, round(sum(eur)::numeric, 2) as euros
from (
  select cmp.*,
    case
      when menu_item_id is null                                then '1 · sin casar con la carta'
      when recipe_item_id is null and not es_combo and n_real=0 then '2 · sin ficha y sin descontar'
      -- 23/09: ANTES que la 3, porque si no se la traga. El recasado en frio
      -- dejo 463 lineas CON plato y SIN consumo, a proposito. Caen en la 3
      -- («con ficha y cero movimientos») y ahi parecen una averia. Casilla
      -- propia, NO filtro: existen, cuentan euros, y no van a descontar
      -- nunca. Esconderlas seria «sin alertas» habiendo filas (regla 7).
      when exists (select 1 from public.sale_line_recast_frio f
                    where f.sale_line_id = cmp.id)         then '3b · recasada en frio (no descontara nunca)'
      when n_esp > 0 and n_real = 0                            then '3 · con ficha y cero movimientos'
      when n_faltan > 0                                        then '4 · descuenta, le falta un ingrediente'
      -- 23/09 00:01: esta casilla YA NO CRECE. `explode_recipe_to_raws` acepta
      -- 'packaging' desde entonces, asi que el envase de lo que se venda a
      -- partir de ahora si se mueve. Lo de antes se queda: no se reproceso
      -- nada (regla del 18/09) y cuadra en el primer recuento.
      when n_envases > 0                                       then '5 · la comida si, el envase nunca'
      else                                                          '6 · completo'
    end as casilla
  from cmp
) z
group by casilla
union all
select 'TOTAL (tiene que ser la suma de las siete)', count(*), round(sum(eur)::numeric,2) from u
order by casilla;
