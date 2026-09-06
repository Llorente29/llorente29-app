-- B79 lote 4 · pieza A (06/09/2026) — §3.4: el Resumen necesita saber DE QUIEN
-- es cada euro de comida, y hoy `by_brand` solo devuelve el NOMBRE de la marca.
--
-- ── QUE CAMBIA, Y POR QUE CADA COSA ──────────────────────────────────────────
--
-- 1. `by_brand` gana `brand_id` y `ownership_type`.
--    · `ownership_type` porque la pantalla aprobada separa «tuyas» de «de
--      terceros» y esa separacion INVIERTE la lectura: medido en los ultimos 30
--      dias de Foodint, la comida es el 24,0 % en total, el 18,5 % en las marcas
--      propias y el 26,8 % en las cedidas, que son el 67 % de lo vendido. El
--      24,0 % no es «como cocina Foodint»: es sobre todo la carta que manda el
--      TPV de otro. Sin esta columna la pantalla ensena un numero que el usuario
--      atribuye a lo que el controla, y no lo es.
--    · `brand_id` porque el boton «Ver platos» de cada fila necesita un id, y
--      porque agrupar por NOMBRE es la regla 9 esperando a morder: hoy Foodint no
--      tiene ni un nombre de marca repetido (medido: cero grupos con count > 1 en
--      toda la tabla `brand`), pero el dia que lo tenga, dos marcas distintas se
--      fundirian en una fila sin avisar. Se agrupa por id y se arrastra el nombre.
--
-- 2. `by_ownership`: el mismo corte, ya sumado en SQL.
--    NO se deriva en el cliente sumando las filas de `by_brand` porque esas filas
--    van redondeadas a euros enteros: sumar 17 redondeos y dividir da otra vara
--    de medir que la del numero grande (regla 31). Aqui sale del mismo `u`, con
--    el mismo numerador y el mismo denominador.
--    Y devuelve TRES cubos, no dos: en la ventana medida hay 3 unidades de venta,
--    31 EUR, SIN MARCA NINGUNA. Un corte «tuyas / de terceros» las tiraria en
--    silencio. Salen como `sin_marca` y que la pantalla decida como decirlo — pero
--    que no pueda no saberlo (regla 7).
--
-- 3. `total` gana `envase_eur` y `envase_pts`.
--    La pantalla justifica la fila «platos sin envase» diciendo cuanto pesa el
--    envase que SI esta puesto. AVISO IMPORTANTE, y va en el cuerpo y no solo en
--    el F6: esto NO es un trozo extraido del coste congelado de la venta. Es el
--    `packaging_cost` de las fichas de HOY aplicado a lo que se vendio. Sirve para
--    el orden de magnitud (3,7 puntos sobre 24,0 en los ultimos 30 dias) y para
--    sostener la unica afirmacion que importa — que el food cost REAL es mayor,
--    porque 314 de los 558 platos en carta tienen el envase a cero — pero NO se
--    puede restar del 24,0 % como si fuera un componente suyo. Quien pinte esto
--    escribe «vale unos X EUR de lo vendido», nunca «son X puntos de los 24,0».
--
-- 4. Se corrige un comentario que YA NO ES VERDAD (y un comentario que miente
--    cuesta lo mismo que una pantalla que miente). El bloque del umbral de 40
--    dice «Foodint NO TIENE FILA en kitchen_settings». Medido hoy: la fila
--    EXISTE, y `target_food_cost_pct` esta a NULL. El 40 sigue siendo interino
--    exactamente por lo mismo — no hay objetivo con el que hacerlo relativo —
--    pero la causa se cuenta como es.
--
-- ── POR QUE `CREATE OR REPLACE` Y NO `DROP` + `CREATE` (regla 2) ─────────────
-- La regla 2 manda DROP+CREATE cuando cambia la FIRMA. Aqui no cambia: mismos
-- cinco parametros, mismos tipos, mismo `returns jsonb`. No puede nacer una
-- sobrecarga. Solo cambia el contenido del jsonb, que es aditivo: `salud`,
-- `total`, `by_brand` y `by_dish` conservan todas sus claves.
--
-- ── CONSUMIDORES, MIRADOS ANTES DE PUBLICAR (regla 32) ───────────────────────
-- `src/modules/ventas/services/foodCostService.ts` (getFoodCost), y a traves de
-- el `src/pages/MargenPlatoPage.tsx` y `src/pages/RecomendacionesPage.tsx`. Los
-- tres leen claves POR NOMBRE (`b.brand`, `b.food_cost_pct`, `b.sospechoso`…);
-- ninguno desestructura de forma exhaustiva ni cuenta claves. Anadir campos no
-- les toca. El tipo TS `FoodCostBrand` se amplia en el lote de front.

create or replace function public.food_cost_dashboard(
  p_account uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_location uuid default null,
  p_brand uuid default null
)
returns jsonb
language sql
stable
as $function$
  with l as (
    select s.brand_id                                  as brand_id,
           b.name                                      as brand,
           b.ownership_type                            as own_type,
           mi.name                                     as dish,
           coalesce(sl.line_type, 'product')           as lt,
           coalesce(sl.parent_sale_line_id, sl.id)     as unidad,
           sl.quantity, sl.unit_price,
           ri.computed_cost, coalesce(ri.packaging_cost,0) as packaging,
           -- B44 (03/09/2026): el coste CONGELADO EN LA VENTA. Ya lleva la
           -- cantidad multiplicada y los modificadores aplicados; en el combo
           -- vive en la linea PADRE. No se vuelve a multiplicar por quantity.
           sl.computed_cost as line_cost,
           (sl.computed_cost is not null)              as costed
    from public.sale_line sl
    join public.sale s on s.id = sl.sale_id
    left join public.menu_item mi on mi.id = sl.menu_item_id
    left join public.recipe_item ri on ri.id = mi.recipe_item_id
    left join public.brand b on b.id = s.brand_id
    where sl.account_id = p_account
      and coalesce(s.status,'') <> 'cancelled'
      and (p_from is null or s.sold_at >= p_from)
      and (p_to  is null or s.sold_at <  p_to)
      and (p_location is null or s.location_id = p_location)
      and (p_brand is null or s.brand_id = p_brand)
  ),
  u as (
    select unidad,
           max(brand) as brand,
           -- Todas las lineas de una unidad son de la MISMA venta, y por tanto de
           -- la misma marca: cualquier agregado da el mismo valor. Va por texto
           -- porque en Postgres no existe max(uuid).
           max(brand_id::text)::uuid as brand_id,
           max(own_type)                                       as own_type,
           sum(quantity * unit_price)                          as eur,
           sum(line_cost) filter (where costed)                as coste,
           -- Envase de las fichas de HOY sobre lo vendido. Ver el punto 3 de la
           -- cabecera: es una estimacion del orden de magnitud, NO un trozo del
           -- coste congelado. No se resta del food_cost_pct.
           sum(packaging * quantity)                           as envase,
           bool_or(costed)                                     as costeada
    from l
    group by unidad
  )
  select jsonb_build_object(
    'salud', jsonb_build_object(
      'unidades',           (select count(*) from u),
      'unidades_costeadas', (select count(*) filter (where costeada) from u),
      'cobertura_pct',      (select round(100.0*count(*) filter (where costeada)
                                          /nullif(count(*),0),1) from u),
      'cobertura_dinero_pct', (select round(100.0*sum(eur) filter (where costeada)
                                            /nullif(sum(eur),0),1) from u),
      'ingreso_total',      (select round(sum(eur)) from u)
    ),
    'total', (select jsonb_build_object(
        'ingreso',       round(sum(eur) filter (where costeada)),
        'food_cost',     round(sum(coste)),
        'food_cost_pct', round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1),
        'envase_eur',    round(sum(envase) filter (where costeada), 2),
        'envase_pts',    round(100.0*sum(envase) filter (where costeada)
                                    /nullif(sum(eur) filter (where costeada),0),1)
      ) from u),
    'by_ownership', (
      -- «Tuyas» (own) frente a «de terceros» (licensed), y el cubo que existe y
      -- que nadie espera: las ventas sin marca. Se devuelven los tres.
      select coalesce(jsonb_agg(o order by o.vendido desc),'[]'::jsonb) from (
        select coalesce(own_type,'sin_marca') as tipo,
          count(*)::int                             as unidades,
          round(sum(eur))                           as vendido,
          round(sum(eur) filter (where costeada))   as vendido_con_coste,
          round(sum(coste))                         as food_cost,
          round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) as food_cost_pct,
          round(100.0*count(*) filter (where costeada)/nullif(count(*),0),1)   as cobertura_pct
        from u
        group by coalesce(own_type,'sin_marca')
      ) o
    ),
    'by_brand', (
      select coalesce(jsonb_agg(x order by x.ingreso desc),'[]'::jsonb) from (
        select max(brand) as brand,
          brand_id,
          max(own_type)                             as ownership_type,
          round(sum(eur) filter (where costeada))   as ingreso,
          round(sum(coste))                         as food_cost,
          round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) as food_cost_pct,
          round(100.0*count(*) filter (where costeada)/nullif(count(*),0),1)   as cobertura_pct,
          -- ── LA BANDERA «sospechosa». UMBRAL ALTO PROVISIONAL: 40 %. ────────
          -- Estaba en 60 y NO PODIA ENCENDERSE. Se midieron 68 observaciones
          -- (17 marcas x 4 ventanas) con la metrica por unidad de venta: minimo
          -- 5,4 · mediana 21,6 · p95 31,1 · MAXIMO 33,1. Cero por encima de 60,
          -- cero por encima de 40, una por debajo de 8.
          --
          -- El 60 se fijo cuando los combos inflaban el numero al doble (Deep
          -- Pizza marcaba 78,6 % y es 32,9 %). Corregido el denominador, ninguna
          -- marca de esta casa puede acercarse: era una alarma muda.
          --
          -- 40 son SIETE PUNTOS por encima de la peor marca real: no salta por
          -- variacion normal y sigue por debajo de donde un food cost deja de
          -- ser un margen. Es un numero con padre, no uno redondo.
          --
          -- ES INTERINO, Y ESTA ES SU FECHA DE CADUCIDAD: el umbral bueno no es
          -- absoluto, es «X puntos sobre el objetivo de la cuenta». Hoy no se
          -- puede. CORREGIDO EL 06/09/2026: este comentario decia que Foodint no
          -- tenia fila en `kitchen_settings`. Medido hoy, la fila SI EXISTE y es
          -- `target_food_cost_pct` quien esta a NULL — la conclusion no cambia
          -- (no hay objetivo con el que hacer el umbral relativo) pero la causa
          -- se cuenta como es. Frente A7. El dia que ese objetivo tenga valor,
          -- este 40 se sustituye por el relativo y deja de envejecer solo.
          --
          -- La rama baja se queda en 8: esa SI funciona — salto en julio con una
          -- marca al 5,4 %, que es su trabajo (avisar de que falta coste).
          (round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) > 40
           or round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) < 8) as sospechoso
        from u where brand_id is not null group by brand_id
      ) x
    ),
    'by_dish', (
      select coalesce(jsonb_agg(d order by d.ingreso desc),'[]'::jsonb) from (
        select dish, brand,
          round(sum(quantity)) as uds,
          round(avg(unit_price),2) as precio,
          round(avg(line_cost / nullif(quantity,0)),2) as food,
          round(100.0*sum(line_cost)/nullif(sum(quantity*unit_price),0),1) as food_cost_pct,
          round(sum(quantity*unit_price)) as ingreso
        from l where costed and dish is not null and lt = 'product'
        group by dish, brand
        order by sum(quantity*unit_price) desc limit 30
      ) d
    )
  );
$function$;
