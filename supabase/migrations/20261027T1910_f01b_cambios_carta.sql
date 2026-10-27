-- supabase/migrations/20261027T1910_f01b_cambios_carta.sql
--
-- F01 · PR 2 · Cambios en la carta de una marca de Last (tablero 5 de la
-- maqueta aprobada). SOLO AÑADE (y se puede pasar dos veces). Solo Last: las
-- cedidas van por Last y las propias por HubRise; esto no toca HubRise. Nada se
-- publica en Last: solo se lee.
--
-- Medido en producción (27/10, solo lectura), en las cedidas de Foodint:
--   · Extras vendidos en 30 días: 302 líneas en 7 marcas, todas casadas con una
--     opción de Folvy. Opciones de Last en Folvy: 50 en 4 marcas, 43 con lo que
--     descuentan; Koreans, Birria y Chivuos venden extras casados con opciones
--     de otras marcas (comparten el extra en Last). Las opciones las crea la
--     importación de cada noche (lastapp-catalog-import, catálogo de la
--     organización); el espejo de cada hora NO guardaba los extras.
--   · Precios: 82 platos de 8 cedidas con el precio de carta distinto del de
--     Last. Por eso los precios NO se aplican solos todavía: se enseñan y se
--     ponen con un botón, que deja apunte de cada cambio (ver el PR).
--
--   1. external_catalog_modifier: el espejo de los extras de Last (la pregunta,
--      su hueco y el extra), con los productos que los usan. Lo escribe
--      last-catalog-sync con el catálogo de la organización.
--   2. external_catalog_change: el apunte de cada precio puesto desde Last.
--   3. LOS CAMBIOS DE CARTA (f01_cambios_carta), por marca de Last vinculada:
--      · platos nuevos: están en Last y no en la carta de la marca;
--      · extras nuevos: en Last, en sus platos, y sin decir qué descuentan, con
--        una propuesta cuando Folvy la sabe (el artículo del almacén que se
--        llama como el extra, y la cantidad si va por unidades);
--      · platos que ya no están: en la carta y no en Last, con la última vez
--        que se vieron. Se quedan en el histórico; nada se archiva solo;
--      · precios distintos: el de Last y el de la carta, por plataforma.
--   4. LO QUE SE DECIDE AHÍ: añadir los platos nuevos (el sembrado de la
--      marca), guardar lo que descuentan los extras (crea la opción como la
--      crearía la importación si aún no ha pasado) y poner los precios de Last.
--      Cada uno confirma con lo que ha hecho (regla 8).

-- ── 1. El espejo de los extras ──────────────────────────────────────────────
create table if not exists public.external_catalog_modifier (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  source              text not null default 'lastapp',
  external_org_id     uuid not null,
  group_id            text not null,       -- la pregunta (modifierGroups[].id)
  slot_id             text not null,       -- su hueco (organizationModifiers[].id): la clave de la importación
  modifier_id         text not null,       -- el extra (modifierId): lo que traen los pedidos
  group_name          text,
  group_min           integer,
  group_max           integer,
  name                text,
  price_cents         integer,
  product_ids         text[] not null default '{}',  -- los productos (organizationProductId) que hacen la pregunta
  seen_in_catalog_at  timestamptz not null default now(),
  missing_since       timestamptz,
  created_at          timestamptz not null default now(),
  constraint external_catalog_modifier_uq unique (account_id, source, external_org_id, group_id, slot_id)
);
comment on table public.external_catalog_modifier is
  'F01 · PR 2: el espejo de los extras de Last (pregunta, hueco y extra) con los productos que los usan. Lo escribe last-catalog-sync con /organizations/{id}/catalog. Solo se lee de Last.';
create index if not exists external_catalog_modifier_extra on public.external_catalog_modifier (account_id, modifier_id);
alter table public.external_catalog_modifier enable row level security;
drop policy if exists external_catalog_modifier_select on public.external_catalog_modifier;
create policy external_catalog_modifier_select on public.external_catalog_modifier for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
revoke insert, update, delete on public.external_catalog_modifier from anon, authenticated;

-- ── 2. El apunte de los precios puestos desde Last ──────────────────────────
create table if not exists public.external_catalog_change (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id) on delete cascade,
  brand_id                 uuid not null references public.brand(id) on delete cascade,
  kind                     text not null default 'precio',
  menu_item_id             uuid,
  nombre                   text,
  canal                    text,             -- null = el precio de la carta
  antes                    numeric,
  despues                  numeric,
  created_at               timestamptz not null default now(),
  created_by               uuid,
  created_by_name          text
);
comment on table public.external_catalog_change is
  'F01 · PR 2: lo que se ha puesto en la carta desde Last (hoy, precios), con quién y cuándo. Lo escribe f01_poner_precios_de_last.';
alter table public.external_catalog_change enable row level security;
drop policy if exists external_catalog_change_select on public.external_catalog_change;
create policy external_catalog_change_select on public.external_catalog_change for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
revoke insert, update, delete on public.external_catalog_change from anon, authenticated;

-- ── Ayudantes ───────────────────────────────────────────────────────────────
-- Lo que propone Folvy para un extra: el artículo del almacén que se llama como
-- él (sin «extra», «doble de», «con»…), y la cantidad si va por unidades
-- (2 si es «doble»). «Sin X» propone quitar X, sin cantidad (la dice la receta).
create or replace function public._f01b_propuesta(p_account uuid, p_nombre text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_n      text := coalesce(public._f01_normalizar(p_nombre), '');
  v_quita  boolean := v_n like 'sin %';
  v_doble  boolean := v_n ~ '(^| )doble( |$)';
  v_resto  text;
  v_ficha  record;
begin
  v_resto := btrim(regexp_replace(regexp_replace(v_n,
    '^(sin|extra|doble de|doble|con|anadir|mas|mas de|racion de|porcion de) ', '', 'g'), ' (extra|doble|adicional)$', '', 'g'));
  if v_resto = '' then return null; end if;
  -- Exacto y uno solo; si no, el único que empieza así.
  select ri.id, ri.name, ri.base_unit_id, ku.dimension, ku.abbreviation into v_ficha
    from public.recipe_item ri left join public.kitchen_unit ku on ku.id = ri.base_unit_id
   where ri.account_id = p_account and ri.type = 'raw' and ri.is_active and ri.archived_at is null
     and public._f01_normalizar(ri.name) = v_resto
   limit 2;
  if v_ficha.id is null or (select count(*) from public.recipe_item ri where ri.account_id = p_account and ri.type = 'raw'
                             and ri.is_active and ri.archived_at is null and public._f01_normalizar(ri.name) = v_resto) <> 1 then
    v_ficha := null;
    select ri.id, ri.name, ri.base_unit_id, ku.dimension, ku.abbreviation into v_ficha
      from public.recipe_item ri left join public.kitchen_unit ku on ku.id = ri.base_unit_id
     where ri.account_id = p_account and ri.type = 'raw' and ri.is_active and ri.archived_at is null
       and public._f01_normalizar(ri.name) like v_resto || ' %'
       and (select count(*) from public.recipe_item r2 where r2.account_id = p_account and r2.type = 'raw' and r2.is_active
              and r2.archived_at is null and public._f01_normalizar(r2.name) like v_resto || ' %') = 1;
  end if;
  -- Y si no, el artículo por cuyo nombre empieza el extra («Huevo frito» → «Huevo»), el más largo y uno solo.
  if v_ficha.id is null then
    select ri.id, ri.name, ri.base_unit_id, ku.dimension, ku.abbreviation into v_ficha
      from public.recipe_item ri left join public.kitchen_unit ku on ku.id = ri.base_unit_id
     where ri.account_id = p_account and ri.type = 'raw' and ri.is_active and ri.archived_at is null
       and v_resto like public._f01_normalizar(ri.name) || ' %'
       and (select count(*) from public.recipe_item r2 where r2.account_id = p_account and r2.type = 'raw' and r2.is_active
              and r2.archived_at is null and public._f01_normalizar(r2.name) = public._f01_normalizar(ri.name)) = 1
     order by length(public._f01_normalizar(ri.name)) desc
     limit 1;
  end if;
  if v_ficha.id is null then return null; end if;
  return jsonb_build_object(
    'ficha', v_ficha.id, 'ficha_nombre', v_ficha.name,
    'tipo', case when v_quita then 'remove_item' else 'add_item' end,
    'cantidad', case when not v_quita and v_ficha.dimension = 'unit' then case when v_doble then 2 else 1 end end,
    'unidad', v_ficha.base_unit_id, 'unidad_nombre', v_ficha.abbreviation);
end $$;
revoke all on function public._f01b_propuesta(uuid, text) from public, anon, authenticated;

-- Los extras VIVOS de Last de una cuenta de Last: de su última foto, no desaparecidos.
create or replace function public._f01b_extras(p_account uuid, p_org uuid)
returns setof public.external_catalog_modifier language sql stable security definer set search_path = public as $$
  select m.* from public.external_catalog_modifier m
   where m.account_id = p_account and m.source = 'lastapp' and m.external_org_id = p_org and m.missing_since is null
     and m.seen_in_catalog_at >= (select max(x.seen_in_catalog_at) - interval '1 day' from public.external_catalog_modifier x
                                   where x.account_id = p_account and x.external_org_id = p_org)
$$;
revoke all on function public._f01b_extras(uuid, uuid) from public, anon, authenticated;

-- ── 3. Los cambios de carta de UNA marca de Last vinculada ──────────────────
create or replace function public._f01b_cambios_marca(p_account uuid, p_brand uuid, p_org uuid, p_nombre text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_nuevos   jsonb;
  v_retir    jsonb;
  v_precios  jsonb;
  v_extras   jsonb;
  v_hay      boolean;
begin
  select exists (select 1 from public._f01_filas(p_account, p_org, p_nombre)) into v_hay;
  if not v_hay then return null; end if;

  -- Platos nuevos: en Last y no en la carta de la marca (ni archivados).
  select coalesce(jsonb_agg(jsonb_build_object('matricula', x.m, 'nombre', x.n, 'precio', x.c / 100.0) order by x.n), '[]'::jsonb) into v_nuevos
    from (select f.organization_product_id::text as m, btrim(max(f.product_name)) as n,
                 coalesce(max(f.price_cents) filter (where f.external_channel = 'default'), mode() within group (order by f.price_cents)) as c
            from public._f01_filas(p_account, p_org, p_nombre) f
           where f.organization_product_id is not null
             and not exists (select 1 from public.menu_item mi where mi.account_id = p_account and mi.brand_id = p_brand
                               and mi.external_source = 'lastapp' and mi.external_id = f.organization_product_id::text)
           group by 1) x;

  -- Platos que ya no están: en la carta (de Last, vivos) y no en su última foto.
  select coalesce(jsonb_agg(jsonb_build_object('menu_item_id', mi.id, 'nombre', btrim(mi.name),
           'visto', (select max(e.seen_in_catalog_at) from public.external_catalog_product e
                      where e.account_id = p_account and e.organization_product_id::text = mi.external_id))
           order by mi.name), '[]'::jsonb) into v_retir
    from public.menu_item mi
   where mi.account_id = p_account and mi.brand_id = p_brand and mi.external_source = 'lastapp' and mi.archived_at is null
     and coalesce(mi.product_type, 'item') <> 'combo'
     and not exists (select 1 from public._f01_filas(p_account, p_org, p_nombre) f where f.organization_product_id::text = mi.external_id);

  -- Precios distintos: el de la carta y el de cada plataforma, contra Last.
  with base as (
    select mi.id, btrim(mi.name) as nombre, mi.price,
           coalesce(max(f.price_cents) filter (where f.external_channel = 'default'), mode() within group (order by f.price_cents)) as base_c
      from public.menu_item mi
      join public._f01_filas(p_account, p_org, p_nombre) f on f.organization_product_id::text = mi.external_id
     where mi.account_id = p_account and mi.brand_id = p_brand and mi.external_source = 'lastapp' and mi.archived_at is null
       and f.price_cents is not null
     group by mi.id, mi.name, mi.price
  ),
  canal as (
    select b.id, b.nombre, sc.id as channel_id, sc.slug, b.base_c,
           (select f.price_cents from public._f01_filas(p_account, p_org, p_nombre) f
             where f.organization_product_id::text = (select mi.external_id from public.menu_item mi where mi.id = b.id)
               and f.external_channel = sc.slug and f.price_cents is not null
             order by f.seen_in_catalog_at desc limit 1) as last_c,
           (select o.price from public.menu_item_override o where o.account_id = p_account and o.menu_item_id = b.id
             and o.channel_id = sc.id and o.location_id is null) as folvy
      from base b cross join public.sales_channel sc
     where sc.account_id = p_account and sc.slug in ('glovo', 'uber', 'justeat', 'shop')
  )
  select coalesce(jsonb_agg(x order by x->>'nombre', x->>'canal' nulls first), '[]'::jsonb) into v_precios
    from (select jsonb_build_object('menu_item_id', b.id, 'nombre', b.nombre, 'canal', null, 'antes', b.price, 'despues', b.base_c / 100.0) as x
            from base b where b.base_c is not null and round(b.price * 100) <> b.base_c
          union all
          select jsonb_build_object('menu_item_id', c.id, 'nombre', c.nombre, 'canal', c.slug,
                   'antes', coalesce(c.folvy, (select mi.price from public.menu_item mi where mi.id = c.id)), 'despues', c.last_c / 100.0)
            from canal c
           where c.last_c is not null and c.last_c is distinct from c.base_c
             and round(coalesce(c.folvy, -1) * 100) is distinct from c.last_c) y;

  -- Extras nuevos: en Last, en algún plato de la marca, y sin decir qué descuentan.
  with propias as (
    select distinct f.organization_product_id::text as m from public._f01_filas(p_account, p_org, p_nombre) f where f.organization_product_id is not null
  ),
  ex as (
    select distinct on (e.modifier_id) e.modifier_id, btrim(e.name) as nombre, e.price_cents, e.group_name
      from public._f01b_extras(p_account, p_org) e
     where e.product_ids && (select coalesce(array_agg(m), '{}') from propias)
       and not exists (select 1 from public.modifier_option o
                        where o.account_id = p_account and o.pos_modifier_id = e.modifier_id
                          and exists (select 1 from public.modifier_recipe_impact i where i.modifier_option_id = o.id and i.status = 'confirmed'))
     order by e.modifier_id, e.seen_in_catalog_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'modifier_id', ex.modifier_id, 'nombre', ex.nombre, 'pregunta', ex.group_name, 'precio', coalesce(ex.price_cents, 0) / 100.0,
           'en_folvy', exists (select 1 from public.modifier_option o where o.account_id = p_account and o.pos_modifier_id = ex.modifier_id),
           'propuesta', p.p,
           'estado', case when p.p is not null and p.p->>'cantidad' is not null then 'propuesto' else 'falta' end)
           order by ex.nombre), '[]'::jsonb) into v_extras
    from ex cross join lateral (select public._f01b_propuesta(p_account, ex.nombre) as p) p;

  return jsonb_build_object('brand_id', p_brand, 'nombre', (select b.name from public.brand b where b.id = p_brand),
    'nombre_last', p_nombre, 'org', p_org,
    'platos_nuevos', v_nuevos, 'extras_nuevos', v_extras, 'retirados', v_retir, 'precios', v_precios,
    'precios_puestos_30d', (select count(*) from public.external_catalog_change c where c.account_id = p_account and c.brand_id = p_brand
                              and c.kind = 'precio' and c.created_at > now() - interval '30 days'));
end $$;
revoke all on function public._f01b_cambios_marca(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Todas las marcas de Last vinculadas de la cuenta, con sus cambios.
create or replace function public.f01_cambios_carta(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; m jsonb; c jsonb;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(p_account)) then
    return '[]'::jsonb;
  end if;
  for m in select x from jsonb_array_elements(public._f01_marcas_last(p_account)) x
            where x->>'estado' = 'vinculada' and x->>'brand_id' is not null loop
    c := public._f01b_cambios_marca(p_account, (m->>'brand_id')::uuid, (m->>'org')::uuid, m->>'nombre');
    if c is not null then v := v || c; end if;
  end loop;
  return v;
end $$;
revoke all on function public.f01_cambios_carta(uuid) from public, anon;
grant execute on function public.f01_cambios_carta(uuid) to authenticated;

-- ── 4. Lo que se decide en la pantalla ──────────────────────────────────────
-- La marca de Last vinculada de una marca de Folvy (cuenta de Last y nombre).
create or replace function public._f01b_last_de(p_account uuid, p_brand uuid)
returns table (org uuid, nombre text) language sql stable security definer set search_path = public as $$
  select (x->>'org')::uuid, x->>'nombre' from jsonb_array_elements(public._f01_marcas_last(p_account)) x
   where x->>'estado' = 'vinculada' and (x->>'brand_id')::uuid = p_brand
   limit 1
$$;
revoke all on function public._f01b_last_de(uuid, uuid) from public, anon, authenticated;

create or replace function public._f01b_quien(p_account uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(up.display_name), ''), u.email) from auth.users u
    left join public.user_profiles up on up.user_id = u.id and up.account_id = p_account
   where u.id = auth.uid() limit 1
$$;
revoke all on function public._f01b_quien(uuid) from public, anon, authenticated;

-- Añadir los platos nuevos a la carta: el sembrado de la marca (PR 1).
create or replace function public.f01_anadir_platos_nuevos(p_account uuid, p_brand uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l record; r jsonb; v_marca text;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Cambiar la carta de una marca es cosa de quien administra la cuenta.' using errcode = '42501';
  end if;
  select * into v_l from public._f01b_last_de(p_account, p_brand);
  if v_l.org is null then raise exception 'Esa marca no está vinculada a Last.' using errcode = 'P0002'; end if;
  select name into v_marca from public.brand where id = p_brand and account_id = p_account;
  r := public._f01_sembrar_marca(p_account, p_brand, v_l.org, v_l.nombre, false, public._f01b_quien(p_account));
  return r || jsonb_build_object('frase',
    case when (r->>'creados')::int = 0 then 'No había platos nuevos que añadir a ' || v_marca || '.'
         else case when (r->>'creados')::int = 1 then 'Añadido 1 plato' else 'Añadidos ' || (r->>'creados') || ' platos' end
              || ' a la carta de ' || v_marca || '.'
              || case when (r->>'sin_receta')::int > 0 then ' Faltan ' || (r->>'sin_receta') || ' recetas.' else '' end end);
end $$;
revoke all on function public.f01_anadir_platos_nuevos(uuid, uuid) from public, anon;
grant execute on function public.f01_anadir_platos_nuevos(uuid, uuid) to authenticated;

-- Guardar lo que descuentan los extras: [{modifier_id, ficha, tipo, cantidad, unidad}].
-- Si la importación de la noche aún no ha creado la opción en Folvy, se crea
-- aquí con SUS claves (la pregunta y el hueco de Last), y la importación la casa.
create or replace function public.f01_guardar_extras(p_account uuid, p_brand uuid, p_extras jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_x       jsonb;
  v_e       record;
  v_grupo   uuid;
  v_opc     uuid;
  v_quien   text := public._f01b_quien(p_account);
  v_extras  integer := 0;
  v_copias  integer := 0;
  v_nuevas  integer := 0;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para decir qué descuentan los extras de esta cuenta.' using errcode = '42501';
  end if;
  if p_extras is null or jsonb_array_length(p_extras) = 0 then raise exception 'No hay extras que guardar.' using errcode = '22023'; end if;
  if not exists (select 1 from public.brand where id = p_brand and account_id = p_account) then
    raise exception 'Esa marca no es de esta cuenta.' using errcode = '42501';
  end if;

  for v_x in select * from jsonb_array_elements(p_extras) loop
    if nullif(v_x->>'cantidad', '') is null or (v_x->>'tipo') not in ('add_item', 'remove_item')
       or not exists (select 1 from public.recipe_item ri where ri.id = (v_x->>'ficha')::uuid and ri.account_id = p_account) then
      raise exception 'Al extra % le falta qué descuenta o cuánto. No se ha guardado nada.', v_x->>'modifier_id' using errcode = '22023';
    end if;
    -- La opción de Folvy; si no existe aún, se crea como la crearía la importación.
    if not exists (select 1 from public.modifier_option o where o.account_id = p_account and o.pos_modifier_id = v_x->>'modifier_id') then
      select e.* into v_e from public.external_catalog_modifier e
       where e.account_id = p_account and e.modifier_id = v_x->>'modifier_id' and e.missing_since is null
       order by e.seen_in_catalog_at desc limit 1;
      if v_e.id is null then raise exception 'El extra % no está en Last.', v_x->>'modifier_id' using errcode = 'P0002'; end if;
      select g.id into v_grupo from public.modifier_group g
       where g.account_id = p_account and g.external_source = 'lastapp' and g.external_id = v_e.group_id;
      if v_grupo is null then
        insert into public.modifier_group (account_id, brand_id, name, min_selections, max_selections, group_type, is_active, external_source, external_id)
        values (p_account, p_brand, coalesce(v_e.group_name, 'Extras'), coalesce(v_e.group_min, 0), coalesce(v_e.group_max, 1), 'extras', true, 'lastapp', v_e.group_id)
        returning id into v_grupo;
      end if;
      insert into public.modifier_option (account_id, modifier_group_id, name, price_impact, is_active, external_source, external_id, pos_modifier_id)
      values (p_account, v_grupo, coalesce(v_e.name, '(extra)'), coalesce(v_e.price_cents, 0) / 100.0, true, 'lastapp', v_e.slot_id, v_e.modifier_id)
      on conflict (account_id, external_source, external_id) where external_id is not null do nothing;
      v_nuevas := v_nuevas + 1;
    end if;
    v_extras := v_extras + 1;
    for v_opc in select o.id from public.modifier_option o where o.account_id = p_account and o.pos_modifier_id = v_x->>'modifier_id' loop
      insert into public.modifier_recipe_impact (account_id, modifier_option_id, impact_type, target_recipe_item_id, quantity, unit_id,
                                                 status, source, rationale, confirmed_by, confirmed_by_name, confirmed_at)
      values (p_account, v_opc, v_x->>'tipo', (v_x->>'ficha')::uuid, (v_x->>'cantidad')::numeric, nullif(v_x->>'unidad', '')::uuid,
              'confirmed', 'human', 'F01 · Cambios de Last', auth.uid(), v_quien, now())
      on conflict (modifier_option_id, target_recipe_item_id) where status = 'confirmed'
      do update set impact_type = excluded.impact_type, quantity = excluded.quantity, unit_id = excluded.unit_id,
                    rationale = excluded.rationale, confirmed_by = excluded.confirmed_by,
                    confirmed_by_name = excluded.confirmed_by_name, confirmed_at = excluded.confirmed_at, updated_at = now();
      v_copias := v_copias + 1;
    end loop;
  end loop;

  return jsonb_build_object('extras', v_extras, 'copias', v_copias, 'opciones_nuevas', v_nuevas,
    'frase', case when v_extras = 1 then 'Guardado 1 extra: ya dice qué descuenta del almacén.'
                  else 'Guardados ' || v_extras || ' extras: ya dicen qué descuentan del almacén.' end);
end $$;
revoke all on function public.f01_guardar_extras(uuid, uuid, jsonb) from public, anon;
grant execute on function public.f01_guardar_extras(uuid, uuid, jsonb) to authenticated;

-- Poner los precios de Last en la carta de una marca, y apuntarlo.
create or replace function public.f01_poner_precios_de_last(p_account uuid, p_brand uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_l     record;
  v_c     jsonb;
  v_p     jsonb;
  v_quien text := public._f01b_quien(p_account);
  v_n     integer := 0;
  v_marca text;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Cambiar la carta de una marca es cosa de quien administra la cuenta.' using errcode = '42501';
  end if;
  select * into v_l from public._f01b_last_de(p_account, p_brand);
  if v_l.org is null then raise exception 'Esa marca no está vinculada a Last.' using errcode = 'P0002'; end if;
  select name into v_marca from public.brand where id = p_brand and account_id = p_account;
  v_c := public._f01b_cambios_marca(p_account, p_brand, v_l.org, v_l.nombre);
  for v_p in select * from jsonb_array_elements(coalesce(v_c->'precios', '[]'::jsonb)) loop
    if v_p->>'canal' is null then
      update public.menu_item set price = (v_p->>'despues')::numeric, updated_at = now()
       where id = (v_p->>'menu_item_id')::uuid and account_id = p_account;
    else
      update public.menu_item_override o set price = (v_p->>'despues')::numeric, updated_at = now()
        from public.sales_channel sc
       where o.account_id = p_account and o.menu_item_id = (v_p->>'menu_item_id')::uuid and o.location_id is null
         and o.channel_id = sc.id and sc.account_id = p_account and sc.slug = v_p->>'canal';
      if not found then
        insert into public.menu_item_override (account_id, menu_item_id, channel_id, location_id, price)
        select p_account, (v_p->>'menu_item_id')::uuid, sc.id, null, (v_p->>'despues')::numeric
          from public.sales_channel sc where sc.account_id = p_account and sc.slug = v_p->>'canal';
      end if;
    end if;
    insert into public.external_catalog_change (account_id, brand_id, kind, menu_item_id, nombre, canal, antes, despues, created_by, created_by_name)
    values (p_account, p_brand, 'precio', (v_p->>'menu_item_id')::uuid, v_p->>'nombre', v_p->>'canal',
            (v_p->>'antes')::numeric, (v_p->>'despues')::numeric, auth.uid(), v_quien);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('puestos', v_n,
    'frase', case when v_n = 0 then 'Los precios de ' || v_marca || ' ya eran los de Last.'
                  when v_n = 1 then 'Puesto 1 precio de Last en ' || v_marca || ', apuntado.'
                  else 'Puestos ' || v_n || ' precios de Last en ' || v_marca || ', apuntados.' end);
end $$;
revoke all on function public.f01_poner_precios_de_last(uuid, uuid) from public, anon;
grant execute on function public.f01_poner_precios_de_last(uuid, uuid) to authenticated;

-- ── El espejo de los extras: lo escribe last-catalog-sync ───────────────────
-- p_extras: [{group_id, slot_id, modifier_id, group_name, group_min, group_max, name, price_cents, product_ids}]
-- Lo que no viene en esta foto queda con missing_since (no se borra).
create or replace function public.f01_espejo_extras(p_account uuid, p_org uuid, p_extras jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ahora timestamptz := now(); v_vistos integer; v_idos integer;
begin
  insert into public.external_catalog_modifier (account_id, source, external_org_id, group_id, slot_id, modifier_id, group_name,
                                                group_min, group_max, name, price_cents, product_ids, seen_in_catalog_at, missing_since)
  select p_account, 'lastapp', p_org, x->>'group_id', x->>'slot_id', x->>'modifier_id', x->>'group_name',
         nullif(x->>'group_min', '')::integer, nullif(x->>'group_max', '')::integer, x->>'name', nullif(x->>'price_cents', '')::integer,
         coalesce((select array_agg(v) from jsonb_array_elements_text(x->'product_ids') v), '{}'), v_ahora, null
    from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) x
   where nullif(x->>'group_id', '') is not null and nullif(x->>'slot_id', '') is not null and nullif(x->>'modifier_id', '') is not null
  on conflict (account_id, source, external_org_id, group_id, slot_id) do update set
    modifier_id = excluded.modifier_id, group_name = excluded.group_name, group_min = excluded.group_min, group_max = excluded.group_max,
    name = excluded.name, price_cents = excluded.price_cents, product_ids = excluded.product_ids,
    seen_in_catalog_at = excluded.seen_in_catalog_at, missing_since = null;
  get diagnostics v_vistos = row_count;
  -- Solo si la foto trae algo: una lista vacía (Last no contesta bien) no da por idos a todos.
  if v_vistos > 0 then
    update public.external_catalog_modifier set missing_since = v_ahora
     where account_id = p_account and source = 'lastapp' and external_org_id = p_org
       and seen_in_catalog_at < v_ahora and missing_since is null;
    get diagnostics v_idos = row_count;
  end if;
  return jsonb_build_object('vistos', v_vistos, 'idos', coalesce(v_idos, 0));
end $$;
revoke all on function public.f01_espejo_extras(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.f01_espejo_extras(uuid, uuid, jsonb) to service_role;
