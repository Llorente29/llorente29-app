-- B79 lote 4 · pieza B (06/09/2026) — «Sólo lo que hay que arreglar»: las cinco
-- cosas del Resumen, contadas en un solo sitio.
--
-- ── LA CONDICION QUE PUSO JULIO, Y COMO SE CUMPLE ───────────────────────────
-- «La RPC nace con la definicion de cada contador escrita EN EL CUERPO, no solo
-- en el comentario.» Viene de un caso real: la palabra «interino» de
-- `menu_item_economics` vivia en un `COMMENT ON FUNCTION`, Julio la busco en el
-- cuerpo y no estaba — y tenia razon, porque un comentario de fuera no viaja con
-- la funcion ni sale por `pg_get_functiondef` de un vistazo.
--
-- Aqui la definicion no es un comentario: es un DATO QUE SALE POR LA SALIDA.
-- Cada contador devuelve su `definicion` en castellano al lado de su numero, con
-- las columnas exactas que ha mirado. La pantalla la puede enseñar, quien haga un
-- grep la encuentra en el cuerpo, y el numero no puede separarse de su regla.
--
-- ── LAS DEFINICIONES, TAL Y COMO LAS FIJO JULIO ─────────────────────────────
--   · «en carta»  = `is_active IS NOT FALSE` Y `archived_at IS NULL`.
--     (Medido hoy: `menu_item.is_active` es NOT NULL, asi que `IS NOT FALSE`
--     equivale a `is_active` a secas. Se escribe como lo pidio Julio porque el
--     dia que la columna admita NULL la regla no cambia de significado sola.)
--   · «con coste» = `recipe_item.computed_cost IS NOT NULL`.
--   · «extras que cobran sin coste» = la consulta del vigia de B73a, tal cual.
--   · «ingredientes sin precio» = el aviso que ya tiene el Resumen hoy.
--   · «sin envase» = `packaging_cost` a NULL o a cero.
--
-- ── TRES COSAS QUE MEDI Y QUE NO SON LO QUE LA MAQUETA SUPONIA ──────────────
-- (regla 31: la prueba se escribe contra la poblacion real, no contra la idea)
--
-- 1. «130 platos sin coste» son 129, y 128 de esos 129 NO TIENEN FICHA NINGUNA
--    (`menu_item.recipe_item_id IS NULL`). No es que su coste este sin calcular:
--    es que no hay a que calcularselo. La accion no es «poner coste», es «enlazar
--    o crear la ficha», y por eso el contador devuelve el desglose y no un total.
--    El unico caso restante es «Tarrina Salsa Smokey (BM)», que apunta a una ficha
--    `raw` con `computed_cost` a NULL.
--
-- 2. «23 ingredientes sin precio · por ellos, 16 recetas no cierran su coste»:
--    los 23 son exactos, pero las 16 NO EXISTEN. Medido: esos 23 aparecen en CERO
--    lineas de receta, y en Foodint no hay ni una ficha activa de tipo `recipe` o
--    `dish` con `computed_cost` a NULL. Hoy no bloquean nada. Se cuenta lo que se
--    puede probar — `usados_en_lineas_de_receta` — y por eso este contador baja al
--    cuarto puesto: la propia maqueta dice que el orden es «por lo que mas pesa»,
--    y con el dato corregido pesa poco.
--
-- 3. «El envase pesa 3,5 puntos» son 3,7, y son una ESTIMACION: salen del
--    `packaging_cost` de las fichas de hoy aplicado a lo vendido, no de un trozo
--    del coste congelado en la venta. Viven en `food_cost_dashboard.total`
--    (pieza A), no aqui, para no medir lo mismo con dos varas distintas.
--
-- ── POR QUE `SECURITY DEFINER` Y POR QUE LEVANTA EN VEZ DE DEVOLVER VACIO ────
-- Definer como su hermana `kitchen_dishes_incomplete`, y por tanto SIN RLS: cada
-- consulta lleva su `account_id` escrito (regla 9), sin excepcion. Pero al reves
-- que ella, si no hay permiso esto NO devuelve cero filas: levanta. Una pantalla
-- que recibe cero de una consulta denegada no distingue «no tienes permiso» de
-- «no hay nada que arreglar», y eso es exactamente lo que B79 vino a matar
-- (reglas 7 y 8: un fallo se enseña, no se disfraza de vacio).
--
-- ── `peores` DEVUELVE LA LISTA ENTERA, NO UN TOP TRES (regla 7) ─────────────
-- La maqueta enseña tres marcas. Este contador devuelve TODAS las que tienen al
-- menos una: 11 marcas en «extras», 18 en «platos sin coste», 18 en «sin envase»,
-- y sus `n` suman exactamente el total de cada contador (100, 129 y 314; medido).
-- El corte a tres es de la pantalla, y la pantalla tiene que decir cuántas deja
-- fuera. Un umbral ordena y etiqueta; no decide qué filas existen.
--
-- VOLATILE, no STABLE, porque llama a `_impact_cost`, que es VOLATILE.
--
-- Nace declarada (regla 16): PUBLIC y anon no la ejecutan.

create or replace function public.kitchen_catalog_gaps(
  p_account uuid,
  p_ventana interval default interval '30 days'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- LAS DEFINICIONES, EN EL CUERPO Y EN CASTELLANO. Cada una viaja pegada a su
  -- numero en la salida: el que lee la cifra lee la regla con la que se contó.
  d_en_carta   constant text := 'En carta = está en `menu_item` de esta cuenta, con `is_active IS NOT FALSE` y `archived_at IS NULL`.';
  d_extras     constant text := 'Opción de modificador ACTIVA que cobra dinero (`price_impact > 0`) y cuyos impactos en estado `confirmed` suman exactamente 0,00 € — incluidas las que no tienen ningún impacto. Es la misma consulta del vigía `modifier_zero_cost_watchdog`.';
  d_sin_coste  constant text := 'Plato en carta cuya ficha no tiene coste calculado: o no tiene ficha (`menu_item.recipe_item_id IS NULL`), o la tiene y su `recipe_item.computed_cost IS NULL`. Con coste = `computed_cost IS NOT NULL`.';
  d_sin_envase constant text := 'Plato en carta cuya ficha tiene el envase a cero: `recipe_item.packaging_cost` a NULL o a 0.';
  d_ingred     constant text := 'Ingrediente (`recipe_item.type = ''raw''`) activo y sin archivar que no tiene ningún precio: ni `fixed_cost` ni `computed_cost` por encima de cero. Es el mismo aviso que ya da el Resumen hoy.';
  d_objetivo   constant text := 'La cuenta no tiene objetivo de comida: `kitchen_settings.target_food_cost_pct` no existe o está a NULL. Sin él, ningún food cost puede llamarse bueno ni malo.';

  v_dias     integer := greatest(1, (extract(epoch from coalesce(p_ventana, interval '30 days')) / 86400)::int);
  v_resultado jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para ver lo que le falta al catálogo de la cuenta %', p_account
      using errcode = '42501';
  end if;

  with carta as (
    -- «EN CARTA», la definición de arriba, escrita una sola vez y usada por los
    -- tres contadores que hablan de platos.
    select mi.id, mi.brand_id, mi.recipe_item_id,
           ri.computed_cost, ri.packaging_cost
      from menu_item mi
      left join recipe_item ri on ri.id = mi.recipe_item_id
     where mi.account_id = p_account
       and mi.is_active is not false
       and mi.archived_at is null
  ),
  cobran as (
    select mo.id, mg.brand_id
      from modifier_option mo
      join modifier_group mg on mg.id = mo.modifier_group_id
                            and mg.account_id = p_account      -- regla 9
     where mo.account_id = p_account
       and mo.is_active
       and coalesce(mo.price_impact, 0) > 0
  ),
  extras_cero as (
    select c.id, c.brand_id
      from cobran c
     where coalesce((select sum(case when i.impact_type in ('add_item','bundle','replace_item')
                                     then public._impact_cost(i.target_recipe_item_id, i.quantity, i.unit_id)
                                     else 0 end)
                       from modifier_recipe_impact i
                      where i.modifier_option_id = c.id
                        and i.status = 'confirmed'), 0) = 0
  ),
  extras_vivos as (
    -- Los que además SE ESTÁN VENDIENDO: deuda que sale por caja hoy.
    select distinct e.id
      from extras_cero e
      join sale_line m on m.modifier_option_id = e.id and m.line_type = 'modifier'
      join sale s on s.id = m.sale_id
                 and s.account_id = p_account                  -- regla 9
                 and s.sold_at >= now() - coalesce(p_ventana, interval '30 days')
                 and coalesce(s.status, '') <> 'cancelled'
  ),
  ingredientes as (
    select ri.id, (coalesce(ri.fixed_cost,0) = 0 and coalesce(ri.computed_cost,0) = 0) as mudo
      from recipe_item ri
     where ri.account_id = p_account
       and ri.type = 'raw'
       and ri.is_active is not false
       and ri.archived_at is null
  ),
  objetivo as (
    select ks.target_food_cost_pct
      from kitchen_settings ks
     where ks.account_id = p_account
     limit 1
  )
  select jsonb_build_object(
    'cuenta',        p_account,
    'medido_en',     now(),
    'ventana_dias',  v_dias,
    'en_carta', jsonb_build_object(
      'definicion', d_en_carta,
      'n',          (select count(*) from carta)
    ),
    -- EL ORDEN NO ES ALFABÉTICO NI CASUAL: es el que pide la propia pantalla,
    -- «por lo que más pesa» en la cifra de comida sobre ventas. Cada fila lleva
    -- escrito por qué está donde está, para que el día que alguien lo cambie
    -- tenga que discutir con una frase y no con un número mágico.
    'cosas', jsonb_build_array(

      jsonb_build_object(
        'clave',      'extras_que_cobran_sin_coste',
        'orden',      1,
        'por_que_aqui','Entran en la caja y no descuentan comida: empujan la cifra de comida sobre ventas HACIA ABAJO. Es el único de los cinco que hace que el número sea mejor de lo que es.',
        'definicion', d_extras,
        'n',          (select count(*) from extras_cero),
        'de',         (select count(*) from cobran),
        'venden',     (select count(*) from extras_vivos),
        'accion',     'Ponerles coste',
        'peores', (
          select coalesce(jsonb_agg(p order by p.n desc, p.marca), '[]'::jsonb) from (
            select c.brand_id, coalesce(b.name, '(sin marca)') as marca,
                   count(*) filter (where z.id is not null)::int as n,
                   count(*)::int                                as de
              from cobran c
              left join extras_cero z on z.id = c.id
              left join brand b on b.id = c.brand_id and b.account_id = p_account
             group by c.brand_id, b.name
            having count(*) filter (where z.id is not null) > 0
          ) p
        )
      ),

      jsonb_build_object(
        'clave',      'platos_en_carta_sin_coste',
        'orden',      2,
        'por_que_aqui','Se venden sin que Folvy sepa lo que cuestan, así que se quedan FUERA de la cifra: no la empeoran, la dejan incompleta.',
        'definicion', d_sin_coste,
        'n',          (select count(*) from carta where computed_cost is null),
        'de',         (select count(*) from carta),
        -- El desglose que cambia la acción: casi todos no es que no tengan el
        -- coste calculado, es que no tienen ficha a la que calculárselo.
        'sin_ficha',           (select count(*) from carta where recipe_item_id is null),
        'con_ficha_sin_coste', (select count(*) from carta where recipe_item_id is not null and computed_cost is null),
        'accion',     'Completar',
        'peores', (
          select coalesce(jsonb_agg(p order by p.n desc, p.marca), '[]'::jsonb) from (
            select k.brand_id, coalesce(b.name, '(sin marca)') as marca,
                   count(*) filter (where k.computed_cost is null)::int as n,
                   count(*)::int                                        as de
              from carta k
              left join brand b on b.id = k.brand_id and b.account_id = p_account
             group by k.brand_id, b.name
            having count(*) filter (where k.computed_cost is null) > 0
          ) p
        )
      ),

      jsonb_build_object(
        'clave',      'platos_en_carta_sin_envase',
        'orden',      3,
        'por_que_aqui','Su envase cuenta como cero, así que la comida sale más barata de lo que es. El envase que sí está puesto se mide en `food_cost_dashboard.total.envase_pts`.',
        'definicion', d_sin_envase,
        'n',          (select count(*) from carta where coalesce(packaging_cost, 0) = 0),
        'de',         (select count(*) from carta),
        'accion',     'Poner envase',
        'peores', (
          select coalesce(jsonb_agg(p order by p.n desc, p.marca), '[]'::jsonb) from (
            select k.brand_id, coalesce(b.name, '(sin marca)') as marca,
                   count(*) filter (where coalesce(k.packaging_cost,0) = 0)::int as n,
                   count(*)::int                                                 as de
              from carta k
              left join brand b on b.id = k.brand_id and b.account_id = p_account
             group by k.brand_id, b.name
            having count(*) filter (where coalesce(k.packaging_cost,0) = 0) > 0
          ) p
        )
      ),

      jsonb_build_object(
        'clave',      'ingredientes_sin_precio',
        'orden',      4,
        'por_que_aqui','Va el cuarto y no el tercero porque HOY no bloquea nada: `usados_en_lineas_de_receta` dice en cuántas líneas de receta aparecen de verdad. Si ese número sube, este contador sube de puesto solo.',
        'definicion', d_ingred,
        'n',          (select count(*) from ingredientes where mudo),
        'de',         (select count(*) from ingredientes),
        'usados_en_lineas_de_receta', (
          select count(*)::int
            from recipe_line rl
            join ingredientes g on g.id = rl.child_item_id and g.mudo
           where rl.account_id = p_account                     -- regla 9
        ),
        'recetas_que_bloquean', (
          select count(distinct rl.parent_item_id)::int
            from recipe_line rl
            join ingredientes g on g.id = rl.child_item_id and g.mudo
            join recipe_item rr on rr.id = rl.parent_item_id
                               and rr.account_id = p_account   -- regla 9
                               and rr.is_active is not false
                               and rr.archived_at is null
           where rl.account_id = p_account
        ),
        'accion',     'Poner precios',
        'peores',     '[]'::jsonb
      ),

      jsonb_build_object(
        'clave',      'sin_objetivo_de_comida',
        'orden',      5,
        'por_que_aqui','El último porque no ensucia ningún número: los deja sin juez. Mientras no exista, ni esta pantalla ni el umbral de «marca sospechosa» de `food_cost_dashboard` pueden decir si una cifra es buena.',
        'definicion', d_objetivo,
        'n',          (select case when (select target_food_cost_pct from objetivo) is null then 1 else 0 end),
        'de',         1,
        'hay_fila_de_ajustes', (select exists (select 1 from objetivo)),
        'target_food_cost_pct', (select target_food_cost_pct from objetivo),
        'accion',     'Poner objetivo',
        'peores',     '[]'::jsonb
      )
    )
  ) into v_resultado;

  return v_resultado;
end;
$function$;

comment on function public.kitchen_catalog_gaps(uuid, interval) is
  'B79 lote 4. Las cinco cosas que arreglar del Resumen de Kitchen. Cada contador devuelve su definicion EN LA SALIDA, no solo en un comentario: el numero no se separa de la regla con la que se conto.';

revoke execute on function public.kitchen_catalog_gaps(uuid, interval) from public, anon;
