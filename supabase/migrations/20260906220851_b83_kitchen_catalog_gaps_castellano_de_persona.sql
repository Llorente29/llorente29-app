-- B83 (07/09/2026) — La definición que se PINTA va en castellano de persona; la
-- regla técnica viaja aparte y no se enseña.
--
-- Sustituye a `20260906172842_b79_l4_kitchen_catalog_gaps_las_cinco_cosas.sql`.
-- Todo lo demás queda igual: mismos contadores, mismo orden, misma firma, mismos
-- `peores`. Lo único que cambia es el IDIOMA de lo que se pinta.
--
-- ── POR QUE ────────────────────────────────────────────────────────────────
-- En la verificación en producción del 06/09 el Resumen enseñaba debajo de cada
-- fila, en cursiva: «price_impact > 0», «menu_item.recipe_item_id IS NULL»,
-- «recipe_item.packaging_cost a NULL o a 0», «kitchen_settings.target_food_cost_pct».
--
-- La regla de lenguaje que ya estaba escrita en `textoInforme.ts` desde B78 dice:
-- en pantalla de cliente no se enseña un identificador interno, ni un nombre de
-- columna, ni un trozo de SQL. La pantalla que la maqueta hizo para cumplirla era
-- justo la que la incumplía.
--
-- La intención de la versión anterior era buena —que el número no se separe nunca
-- de la regla con la que se contó— y SE MANTIENE ENTERA. Lo que estaba mal es que
-- la regla estaba escrita en el idioma de la base y no en el de quien la lee.
-- Ahora son dos:
--   · `definicion`    → castellano de persona. Es la ÚNICA que se pinta.
--   · `regla_tecnica` → las columnas exactas. Viaja para soporte y para poder
--                       auditar el número, y NO se pinta nunca en cliente.
--
-- ── EL GUARDA, Y EL FALLO QUE TUVO EN SU PRIMERA VERSION ───────────────────
-- El primer guarda que escribí para esto usaba
-- `v_src like '%d_sin_coste  constant text := ''%recipe_item_id%'` y ABORTO la
-- migración — con las definiciones ya correctas. Dos errores míos en una línea:
-- el `%` final busca en TODO el cuerpo (y `recipe_item_id` aparece más abajo, en
-- el CTE, legítimamente), y en `LIKE` el `_` es un comodín de un carácter, así que
-- `d_sin_coste` ni siquiera anclaba donde yo creía.
--
-- El guarda bueno saca las líneas `d_*` UNA A UNA y comprueba cada una sola. Se
-- probó contra la función vieja antes de aplicar: encuentra las 6 y marca las 6.

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
  -- ── DOS JUEGOS DE DEFINICIONES, Y SOLO UNO SE PINTA (B83) ────────────────
  -- `d_*` es lo que VE EL CLIENTE: castellano de persona, sin una sola columna,
  -- sin SQL y sin inglés. `t_*` es la regla técnica: viaja en la salida para
  -- soporte y para poder auditar el número, pero NO SE PINTA.
  d_en_carta   constant text := 'Un plato está «en carta» si está activo y no se ha retirado del catálogo.';
  d_extras     constant text := 'Un extra que el cliente paga aparte y que, sumado lo que lleva, no añade ni un céntimo de coste. Cuenta también el que no tiene nada puesto.';
  d_sin_coste  constant text := 'Un plato de la carta del que Folvy no sabe lo que cuesta: o no tiene ficha de escandallo enlazada, o la tiene sin terminar.';
  d_sin_envase constant text := 'Un plato cuya ficha tiene el envase a cero, así que su coste no incluye lo que cuesta servirlo.';
  d_ingred     constant text := 'Un ingrediente en uso al que no se le ha puesto ningún precio, ni a mano ni por compras.';
  d_objetivo   constant text := 'La cuenta no tiene un objetivo de comida sobre ventas al que apuntar, así que ninguna cifra puede llamarse buena ni mala.';

  -- La regla técnica. Viaja, no se pinta.
  t_en_carta   constant text := 'menu_item de la cuenta con is_active IS NOT FALSE y archived_at IS NULL.';
  t_extras     constant text := 'modifier_option activa con price_impact > 0 cuyos modifier_recipe_impact en estado confirmed suman 0, incluidas las que no tienen ninguno. Misma consulta que el vigía modifier_zero_cost_watchdog.';
  t_sin_coste  constant text := 'menu_item en carta con recipe_item_id IS NULL, o con ficha cuyo recipe_item.computed_cost IS NULL. Con coste = computed_cost IS NOT NULL.';
  t_sin_envase constant text := 'menu_item en carta cuya recipe_item.packaging_cost es NULL o 0.';
  t_ingred     constant text := 'recipe_item de tipo raw, activo y sin archivar, con fixed_cost y computed_cost ambos nulos o cero.';
  t_objetivo   constant text := 'kitchen_settings.target_food_cost_pct inexistente o NULL para la cuenta.';

  v_dias     integer := greatest(1, (extract(epoch from coalesce(p_ventana, interval '30 days')) / 86400)::int);
  v_resultado jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para ver lo que le falta al catálogo de la cuenta %', p_account
      using errcode = '42501';
  end if;

  with carta as (
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
      'regla_tecnica', t_en_carta,
      'n',          (select count(*) from carta)
    ),
    'cosas', jsonb_build_array(

      jsonb_build_object(
        'clave',      'extras_que_cobran_sin_coste',
        'orden',      1,
        'por_que_aqui','Entran en la caja y no descuentan comida: empujan la cifra de comida sobre ventas HACIA ABAJO. Es el único de los cinco que hace que el número sea mejor de lo que es.',
        'definicion', d_extras,
        'regla_tecnica', t_extras,
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
        'regla_tecnica', t_sin_coste,
        'n',          (select count(*) from carta where computed_cost is null),
        'de',         (select count(*) from carta),
        'sin_ficha',           (select count(*) from carta where recipe_item_id is null),
        'con_ficha_sin_coste', (select count(*) from carta where recipe_item_id is not null and computed_cost is null),
        'accion',     'Casar o crear la ficha',
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
        'por_que_aqui','Su envase cuenta como cero, así que la comida sale más barata de lo que es.',
        'definicion', d_sin_envase,
        'regla_tecnica', t_sin_envase,
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
        'clave',      'sin_objetivo_de_comida',
        'orden',      4,
        'por_que_aqui','Va el cuarto porque no ensucia ningún número: los deja sin juez. Es un minuto de trabajo y le da sentido a los tres de arriba.',
        'definicion', d_objetivo,
        'regla_tecnica', t_objetivo,
        'n',          (select case when (select target_food_cost_pct from objetivo) is null then 1 else 0 end),
        'de',         1,
        'hay_fila_de_ajustes', (select exists (select 1 from objetivo)),
        'target_food_cost_pct', (select target_food_cost_pct from objetivo),
        'platos_con_objetivo_propio', (
          select count(*)::int from menu_item mi2
           where mi2.account_id = p_account                    -- regla 9
             and mi2.is_active is not false
             and mi2.archived_at is null
             and mi2.target_food_cost_pct is not null
        ),
        'accion',     'Poner objetivo',
        'peores',     '[]'::jsonb
      ),

      jsonb_build_object(
        'clave',      'ingredientes_sin_precio',
        'orden',      5,
        'por_que_aqui','El último porque HOY no bloquea nada: se cuenta en cuántas líneas de receta aparecen de verdad, y hoy son cero. Si ese número sube, este contador sube de puesto solo.',
        'definicion', d_ingred,
        'regla_tecnica', t_ingred,
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
      )
    )
  ) into v_resultado;

  return v_resultado;
end;
$function$;

comment on function public.kitchen_catalog_gaps(uuid, interval) is
  'B79 lote 4 · B83. Las cinco cosas que arreglar del Resumen de Kitchen. Cada contador devuelve DOS reglas: `definicion` en castellano de persona (la unica que se pinta) y `regla_tecnica` con las columnas (viaja, no se pinta).';

revoke execute on function public.kitchen_catalog_gaps(uuid, interval) from public, anon;

-- ── GUARDA ─────────────────────────────────────────────────────────────────
do $guarda$
declare v_oid oid; v_src text; v_linea text; v_d int := 0;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kitchen_catalog_gaps'
     and pg_get_function_identity_arguments(p.oid) = 'p_account uuid, p_ventana interval';

  if v_oid is null then
    raise exception 'GUARDA: kitchen_catalog_gaps(uuid, interval) no existe despues de aplicar.';
  end if;
  if has_function_privilege('public', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'GUARDA: sigue siendo ejecutable por public/anon (regla 16).';
  end if;

  select p.prosrc into v_src from pg_proc p where p.oid = v_oid;

  if v_src not like '%is_active IS NOT FALSE%' then
    raise exception 'GUARDA: las definiciones no estan en el cuerpo de la funcion.';
  end if;
  if v_src not like '%regla_tecnica%' then
    raise exception 'GUARDA: falta regla_tecnica — la regla tecnica tiene que ir aparte.';
  end if;

  -- Cada linea `d_*` se saca SOLA y se comprueba sola. Nada de buscar en todo el
  -- cuerpo: ahi `recipe_item_id` aparece legitimamente en los CTE.
  for v_linea in
    select btrim(l) from unnest(string_to_array(v_src, E'\n')) as l
     where btrim(l) like 'd\_%constant text :=%'
  loop
    v_d := v_d + 1;
    if v_linea ~ '(price_impact|packaging_cost|computed_cost|fixed_cost|target_food_cost_pct|recipe_item_id|is_active|archived_at|IS NULL|IS NOT FALSE|SELECT|WHERE)' then
      raise exception 'GUARDA: una definicion que se PINTA lleva algo tecnico dentro: %', v_linea;
    end if;
  end loop;
  if v_d <> 6 then
    raise exception 'GUARDA: esperaba 6 definiciones que se pintan y he encontrado %.', v_d;
  end if;
end
$guarda$;
