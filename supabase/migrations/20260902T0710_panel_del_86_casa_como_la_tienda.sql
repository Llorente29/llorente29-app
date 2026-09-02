-- 20260902T0710_panel_del_86_casa_como_la_tienda.sql
--
-- UN 86 EN VIGOR QUE LA PANTALLA DEL 86 NO ENSEÑABA.
--
-- «Wrap seoul chicken», Foodint Carabanchel, agotado el 30/08 a las 13:54, sin
-- fecha de vuelta. Vive en CUATRO cartas activas —Milanesa Haus ×2, Big Mike's
-- y KDB— y llevaba TRES DÍAS agotado de verdad en la tienda y en el TPV,
-- mientras la pantalla de Disponibilidad decía que no lo estaba. Nadie podía
-- reactivarlo desde el producto.
--
-- ── UN CRITERIO, DOS ESCRITURAS (Regla 10) ─────────────────────────────────
-- La tienda (`shop_brand_menu_by_slug`) y el TPV (`pos_item_config`) deciden si
-- un producto está agotado casando por las DOS vías:
--
--   and ((mi.external_id   is not null and pa.external_id   = mi.external_id)
--     or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id))
--
-- `_availability_panel_core` casaba SOLO por `external_id`. La fila del Wrap
-- tiene `external_id` a NULL y va ligada por `recipe_item_id`, así que el panel
-- no la reconocía, `tiene_ficha` salía falso y el filtro final la tiraba. El 86
-- surtía efecto y era invisible: la peor combinación de las dos.
--
-- Esta migración copia la condición del sitio que manda. No la reinventa: la
-- tienda y el TPV son quienes deciden si algo se vende, y el panel es quien lo
-- cuenta; si cuentan distinto, uno de los dos miente.
--
-- ── LO QUE NO CAMBIA, Y ES A PROPÓSITO ─────────────────────────────────────
-- La AGRUPACIÓN se queda como está. De las 66 filas de Carabanchel, 3 se
-- agrupan porque son el mismo producto físico agotado bajo varias marcas —es lo
-- que se pidió el 01/09 para no ver «Milanesa de ternera» cuatro veces— y una
-- se caía por este fallo. 66 → 63 agrupando (bien) → 62 filtrando (mal).
--
-- ── MEDIDO ANTES Y DESPUÉS ─────────────────────────────────────────────────
--   Foodint Carabanchel   62 → 63   (aparece el Wrap)
--   Foodint Alcalá        18 → 18   (no cambia)
--   Toda la cuenta        80 → 81
-- La verificación de abajo aborta si esas cifras no salen: un arreglo de
-- visibilidad que no cambia lo que se ve no ha arreglado nada.
--
-- Se edita con pg_get_functiondef + replace, con cuatro sustituciones ancladas
-- y verificadas. La función tiene 90 líneas y el resto queda byte a byte igual.

do $edita$
declare
  v_src text;
  v_new text;
  v_a1 constant text := '  unioned as (
    select matricula, loc, true as s_last, false as s_folvy,
           null::text as u_reason, null::timestamptz as u_until, null::timestamptz as u_set
    from last_off
    union all
    select matricula, loc, false, true, r_reason, r_until, r_set
    from folvy_off
  ),';
  v_a2 constant text := '    group by mi.external_id
  ),';
  v_a3 constant text := '  exp as (
    select u.matricula, u.loc, u.s_last, u.s_folvy, u.u_reason, u.u_until, u.u_set,
           i.rec, i.nm, i.repr_id, i.brs, i.photo, i.external_id as i_ext,
           bn as brand_name
    from unioned u
    left join ident i on i.external_id = u.matricula
    left join lateral unnest(coalesce(i.bnames, array[]::text[])) as bn on true
  ),';
  v_a4 constant text := 'bool_or(i_ext is not null)                                         as tiene_ficha';
begin
  v_src := pg_get_functiondef('public._availability_panel_core(uuid,uuid)'::regprocedure);

  if position('ident_rec' in v_src) > 0 then
    raise notice '_availability_panel_core ya casa por las dos vias, se salta';
    return;
  end if;

  if position(v_a1 in v_src) = 0 or position(v_a2 in v_src) = 0
     or position(v_a3 in v_src) = 0 or position(v_a4 in v_src) = 0 then
    raise exception 'no se encuentran las anclas en _availability_panel_core: ha cambiado y hay que revisar esta migracion';
  end if;

  -- 1 · `unioned` tiraba el recipe_item_id que `folvy_off` ya traia.
  v_new := replace(v_src, v_a1, '  unioned as (
    select matricula, null::uuid as rec_id, loc, true as s_last, false as s_folvy,
           null::text as u_reason, null::timestamptz as u_until, null::timestamptz as u_set
    from last_off
    union all
    select matricula, rec_id, loc, false, true, r_reason, r_until, r_set
    from folvy_off
  ),');

  -- 2 · La segunda via de identificacion: por recipe_item_id.
  v_new := replace(v_new, v_a2, '    group by mi.external_id
  ),
  ident_rec as (
    select mi.recipe_item_id,
           max(mi.recipe_item_id::text)                                        as rec,
           min(mi.name)                                                        as nm,
           min(mi.id::text)                                                    as repr_id,
           count(distinct mi.brand_id)                                         as brs,
           array_agg(distinct b.name) filter (where b.name is not null)        as bnames,
           (array_agg(mi.photo_url) filter (where mi.photo_url is not null))[1] as photo
    from menu_item mi
    left join brand b on b.id = mi.brand_id
    where mi.account_id = p_account_id and mi.recipe_item_id is not null
    group by mi.recipe_item_id
  ),');

  -- 3 · El casado, con la MISMA condicion que la tienda y el TPV: external_id
  --     si lo hay, y si no casa por ahi, recipe_item_id.
  v_new := replace(v_new, v_a3, '  exp as (
    select u.matricula, u.loc, u.s_last, u.s_folvy, u.u_reason, u.u_until, u.u_set,
           coalesce(ie.rec, ir.rec)                     as rec,
           coalesce(ie.nm, ir.nm)                       as nm,
           coalesce(ie.repr_id, ir.repr_id)             as repr_id,
           coalesce(ie.brs, ir.brs)                     as brs,
           coalesce(ie.photo, ir.photo)                 as photo,
           (ie.external_id is not null or ir.recipe_item_id is not null) as i_ext,
           bn as brand_name
    from unioned u
    left join ident ie on ie.external_id = u.matricula
    left join ident_rec ir
           on ie.external_id is null and ir.recipe_item_id = u.rec_id
    left join lateral unnest(coalesce(ie.bnames, ir.bnames, array[]::text[])) as bn on true
  ),');

  -- 4 · `i_ext` ya es booleano: `is not null` seria cierto SIEMPRE y el filtro
  --     dejaria de filtrar -- de arreglar una fuga a abrirla del todo. Se
  --     cambia a la vez que su origen, no despues.
  v_new := replace(v_new, v_a4, 'bool_or(i_ext)                                                     as tiene_ficha');

  execute v_new;

  v_src := pg_get_functiondef('public._availability_panel_core(uuid,uuid)'::regprocedure);
  if position('ident_rec' in v_src) = 0 or position('bool_or(i_ext)' in v_src) = 0 then
    raise exception 'la edicion de _availability_panel_core no quedo aplicada';
  end if;
  raise notice '_availability_panel_core casa ahora por external_id o recipe_item_id';
end;
$edita$;

-- ── Verificación, con las cifras de verdad ─────────────────────────────────
do $verif$
declare v_n int; v_cara int; v_alca int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_availability_panel_core';
  if v_n <> 1 then
    raise exception '_availability_panel_core tiene % firmas (Regla 2)', v_n;
  end if;

  select count(*) into v_cara from public._availability_panel_core(
    '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid, '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid);
  select count(*) into v_alca from public._availability_panel_core(
    '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,
    (select id from locations where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and name='Foodint Alcalá'));

  if v_cara <> 63 then
    raise exception 'Carabanchel deberia listar 63 y lista %', v_cara;
  end if;
  if v_alca <> 18 then
    raise exception 'Alcala no deberia cambiar (18) y lista %', v_alca;
  end if;

  raise notice 'VERIFICACION OK: Carabanchel 62 -> 63, Alcala 18 -> 18';
end;
$verif$;
