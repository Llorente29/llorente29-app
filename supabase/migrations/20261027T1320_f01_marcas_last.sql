-- supabase/migrations/20261027T1320_f01_marcas_last.sql
--
-- F01 · PR 1 · Marcas de Last (tableros 1 y 2). SOLO AÑADE: lo nuevo, que se
-- puede pasar dos veces. Lo que cambia lo que ya existe va en la 1322.
-- Solo marcas que entran por Last. Nada de HubRise. Nada se publica en Last:
-- solo se lee su espejo (external_catalog_product).
--
--   1. external_catalog_product.external_brand_id: el id de la marca de Last en
--      ese local (el mismo que external_brand_map), que last-catalog-sync ya
--      tenía a mano y no guardaba. Con él se vincula una marca antes de su
--      primera venta.
--   2. external_brand_alta: «esta marca de Last (cuenta de Last + nombre) es
--      esta marca de Folvy». La escribe el alta; con ella el sembrado y la
--      pasada de cada sincronización saben de quién es cada fila del espejo.
--   3. SEMBRAR UNA MARCA (_f01_sembrar_marca), por (marca, matrícula) y no por
--      matrícula. Medido en Foodint (27/10, solo lectura): 49 de 435 matrículas
--      están en más de una marca (las bebidas y los postres de Cloudtown). El
--      sembrado de antes juntaba por matrícula y le daba a cada una UNA marca
--      (max del nombre): las bebidas de El Delicioso nunca se crearon. Y miraba
--      «ya existe» solo entre las filas vivas, mientras el índice único
--      uq_menu_item_external también cuenta las archivadas (Nestea Limón de Ay
--      Mamita, Marquesa de Dulce de Leche de Dos Coyotes): de ahí el «duplicate
--      key». Ahora:
--      · una fila archivada no se resucita ni se duplica: se cuenta y se dice;
--      · la misma carta en Uber y Glovo (misma matrícula) es UN plato, con un
--        precio por plataforma (menu_item_override) cuando difiere;
--      · nombres casi iguales en la misma marca («CACHAPA QUESUDA (DL)» y
--        «CACHAPA QUESUDA DL») comparten artículo: son el mismo plato;
--      · una matrícula que otra marca ya tiene enlazada a un artículo (Coca Cola
--        → «Coca-Cola Original Lata») se enlaza al mismo: lo del almacén.
--   4. LAS MARCAS DE LAST (f01_marcas_last): cada marca del espejo, con sus
--      locales, plataformas, platos y si está vinculada. Pendiente = no
--      vinculada. No cuentan las cuentas de Last apagadas, ni los locales de
--      Last sin local de Folvy activo (Plaza Castilla cerró en julio).
--   5. EL ALTA (f01_alta_marca): crea o reutiliza la marca, guarda de quién es
--      (y el socio de una cedida, en brand_licensing_agreement: sin porcentaje
--      necesita la 1322), la pone en sus locales y plataformas, la vincula,
--      siembra su carta y coloca lo vendido antes (regla 6: nunca por debajo
--      del último recuento cerrado; lo que queda debajo se cuenta y se dice).
--   6. LA PASADA (f01_pasada_last): la llama last-catalog-sync después de cada
--      sincronización (cada hora de 12 a 23) y vincula los locales nuevos de las
--      marcas dadas de alta en cuanto el espejo trae su id.

-- ── 1. El id de la marca de Last en el espejo ───────────────────────────────
alter table public.external_catalog_product add column if not exists external_brand_id text;
comment on column public.external_catalog_product.external_brand_id is
  'F01: el id de la marca de Last en este local (brands[].id de /locations/{id}), el mismo que external_brand_map.external_brand_id. Lo escribe last-catalog-sync.';

-- ── 2. De quién es cada marca de Last ───────────────────────────────────────
create table if not exists public.external_brand_alta (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  source               text not null default 'lastapp',
  external_org_id      uuid not null,
  external_brand_name  text not null,
  brand_id             uuid not null references public.brand(id) on delete cascade,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  created_by_name      text,
  constraint external_brand_alta_uq unique (account_id, source, external_org_id, external_brand_name)
);
comment on table public.external_brand_alta is
  'F01: «la marca de Last X (de esta cuenta de Last) es la marca de Folvy Y». La escribe f01_alta_marca; la leen el sembrado y la pasada de cada sincronización. El nombre va sin espacios a los lados.';
alter table public.external_brand_alta enable row level security;
drop policy if exists external_brand_alta_select on public.external_brand_alta;
create policy external_brand_alta_select on public.external_brand_alta for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
revoke insert, update, delete on public.external_brand_alta from anon, authenticated;

-- ── Ayudantes ───────────────────────────────────────────────────────────────
-- El nombre de un plato para comparar: sin mayúsculas, sin acentos, sin signos
-- y sin espacios de más. «CACHAPA QUESUDA (DL)» y «CACHAPA QUESUDA DL» dan lo mismo.
create or replace function public._f01_normalizar(p text)
returns text language sql stable set search_path = public as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(public.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;
revoke all on function public._f01_normalizar(text) from public, anon;
grant execute on function public._f01_normalizar(text) to authenticated;

-- La marca de Folvy que tiene el nombre de una marca de Last (con el alias de siempre).
create or replace function public._f01_marca_por_nombre(p_account uuid, p_nombre text)
returns uuid language sql stable security definer set search_path = public as $$
  select b.id from public.brand b
   where b.account_id = p_account and b.archived_at is null
     and public._f01_normalizar(b.name) = public._f01_normalizar(case when btrim(p_nombre) = 'Dirty Burgers' then 'Dirty Burger' else p_nombre end)
   order by b.is_active desc, b.created_at
   limit 1
$$;
revoke all on function public._f01_marca_por_nombre(uuid, text) from public, anon, authenticated;

-- La marca de Folvy de una marca de Last: primero el alta; después, un vínculo
-- de sus locales (external_brand_map) a la marca de su nombre; si no, ninguna.
create or replace function public._f01_marca_vinculada(p_account uuid, p_org uuid, p_nombre text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.brand_id from public.external_brand_alta a
      where a.account_id = p_account and a.source = 'lastapp' and a.external_org_id = p_org and a.external_brand_name = btrim(p_nombre)),
    (select m.brand_id from public.external_brand_map m
      where m.account_id = p_account and m.source = 'lastapp' and not m.is_ignored
        and m.brand_id = public._f01_marca_por_nombre(p_account, p_nombre)
        and m.external_location_id in (select e.external_location_id::text from public.external_catalog_product e
                                        where e.account_id = p_account and e.external_org_id = p_org and btrim(e.external_brand_name) = btrim(p_nombre))
      limit 1))
$$;
revoke all on function public._f01_marca_vinculada(uuid, uuid, text) from public, anon, authenticated;

-- Las filas VIVAS de una marca de Last en el espejo: de una cuenta de Last
-- encendida, vistas en su última foto (con un día de margen) y no desaparecidas.
create or replace function public._f01_filas(p_account uuid, p_org uuid, p_nombre text)
returns setof public.external_catalog_product language sql stable security definer set search_path = public as $$
  select e.* from public.external_catalog_product e
   where e.account_id = p_account and e.source = 'lastapp' and e.external_org_id = p_org
     and btrim(e.external_brand_name) = btrim(p_nombre)
     and e.missing_since is null
     and e.seen_in_catalog_at >= (select max(x.seen_in_catalog_at) - interval '1 day' from public.external_catalog_product x
                                   where x.account_id = p_account and x.external_org_id = p_org)
$$;
revoke all on function public._f01_filas(uuid, uuid, text) from public, anon, authenticated;

-- ── 3. Sembrar la carta de UNA marca ────────────────────────────────────────
-- Por matrícula dentro de la marca. Devuelve lo que ha hecho (o haría, en ensayo).
create or replace function public._f01_sembrar_marca(p_account uuid, p_brand uuid, p_org uuid, p_nombre text, p_ensayo boolean, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ud        uuid;
  v_p         record;
  v_c         record;
  v_mi        uuid;
  v_ri        uuid;
  v_tipo      text;
  v_origen    text;
  v_vistos    jsonb := '{}'::jsonb;    -- nombre normalizado → artículo (o 'ensayo')
  v_nombres   jsonb := '{}'::jsonb;    -- nombre normalizado → el primer nombre visto
  v_con       text;
  v_platos    jsonb := '{}'::jsonb;    -- nombre normalizado → cómo queda: almacen | receta | sin_receta
  v_norm      text;
  v_matr      integer := 0;
  v_ya        integer := 0;
  v_creados   integer := 0;
  v_enlazados integer := 0;
  v_juntados  jsonb := '[]'::jsonb;
  v_almacen   jsonb := '[]'::jsonb;
  v_archiv    jsonb := '[]'::jsonb;
  v_over      integer := 0;
  v_base      integer;
begin
  -- La unidad «ud»: la global si la hay (producción); si no, la de la cuenta (staging).
  select u.id into v_ud from public.kitchen_unit u
   where (u.account_id is null or u.account_id = p_account) and u.dimension = 'unit' and u.is_base and u.is_active
   order by (u.account_id is null) desc, u.is_seed desc, u.created_at limit 1;

  for v_p in
    select f.organization_product_id::text as matricula,
           btrim(coalesce(max(f.product_name) filter (where f.external_channel = 'default'), max(f.product_name))) as nombre,
           coalesce(max(f.price_cents) filter (where f.external_channel = 'default'),
                    mode() within group (order by f.price_cents)) as base_cents
      from public._f01_filas(p_account, p_org, p_nombre) f
     where f.organization_product_id is not null
     group by f.organization_product_id
     order by 2, 1
  loop
    v_matr := v_matr + 1;
    v_norm := coalesce(public._f01_normalizar(v_p.nombre), v_p.matricula);
    v_mi := null; v_ri := null; v_origen := null; v_con := null;

    select mi.id, mi.recipe_item_id into v_mi, v_ri from public.menu_item mi
     where mi.account_id = p_account and mi.brand_id = p_brand and mi.external_source = 'lastapp'
       and mi.external_id = v_p.matricula and mi.archived_at is null
     limit 1;

    if v_mi is null and exists (select 1 from public.menu_item mi
         where mi.account_id = p_account and mi.brand_id = p_brand and mi.external_source = 'lastapp'
           and mi.external_id = v_p.matricula and mi.archived_at is not null) then
      -- Archivada a propósito: ni se resucita ni se duplica (el índice único también la cuenta).
      v_archiv := v_archiv || jsonb_build_object('plato', v_p.nombre, 'matricula', v_p.matricula);
      continue;
    end if;

    if v_ri is null then
      -- a) lo que ya tiene enlazado esta matrícula en otra marca (las bebidas y los postres).
      select mi.recipe_item_id into v_ri from public.menu_item mi
       where mi.account_id = p_account and mi.external_source = 'lastapp' and mi.external_id = v_p.matricula
         and mi.archived_at is null and mi.recipe_item_id is not null
       group by mi.recipe_item_id order by count(*) desc limit 1;
      if v_ri is not null then v_origen := 'otra_marca'; end if;
      -- b) un plato de la misma marca con el mismo nombre (casi igual): el mismo artículo.
      if v_ri is null and v_vistos ? v_norm then
        v_origen := 'juntado';
        v_con := v_nombres->>v_norm;
        if v_vistos->>v_norm <> 'ensayo' then v_ri := (v_vistos->>v_norm)::uuid; end if;
      end if;
      if v_ri is null and v_origen is null then
        select mi.recipe_item_id, btrim(mi.name) into v_ri, v_con from public.menu_item mi
         where mi.account_id = p_account and mi.brand_id = p_brand and mi.archived_at is null
           and mi.recipe_item_id is not null and public._f01_normalizar(mi.name) = v_norm
           and mi.external_id is distinct from v_p.matricula
         limit 1;
        if v_ri is not null then v_origen := 'juntado'; end if;
      end if;
      -- c) un artículo del almacén que se llama igual, si es uno solo.
      if v_ri is null and v_origen is null then
        select min(ri.id::text)::uuid into v_ri from public.recipe_item ri
         where ri.account_id = p_account and ri.type = 'raw' and ri.is_active and ri.archived_at is null
           and public._f01_normalizar(ri.name) = v_norm
        having count(*) = 1;
        if v_ri is not null then v_origen := 'almacen'; end if;
      end if;
      -- d) un plato nuevo, sin receta todavía.
      if v_ri is null and v_origen is null then
        v_origen := 'nuevo';
        if not p_ensayo then
          insert into public.recipe_item (account_id, type, name, base_unit_id, is_active, source, needs_review, created_by_name)
          values (p_account, 'dish', v_p.nombre, v_ud, true, 'import', true, p_quien_nombre)
          returning id into v_ri;
        end if;
      end if;
      if v_origen = 'juntado' then
        v_juntados := v_juntados || jsonb_build_object('plato', v_p.nombre, 'con', coalesce(v_con, v_norm));
      end if;
    end if;

    if not (v_vistos ? v_norm) then
      v_vistos := v_vistos || jsonb_build_object(v_norm, coalesce(v_ri::text, 'ensayo'));
      v_nombres := v_nombres || jsonb_build_object(v_norm, v_p.nombre);
    end if;

    if v_mi is not null then
      v_ya := v_ya + 1;
      if v_origen is not null then
        v_enlazados := v_enlazados + 1;
        if not p_ensayo and v_ri is not null then
          update public.menu_item set recipe_item_id = v_ri, updated_at = now()
           where id = v_mi and recipe_item_id is null;
        end if;
      end if;
    else
      v_creados := v_creados + 1;
      if not p_ensayo then
        insert into public.menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                                      product_type, external_source, external_id, source, needs_review, created_by_name)
        values (p_account, p_brand, null, v_ri, v_p.nombre, coalesce(v_p.base_cents, 0)::numeric / 100.0,
                'item', 'lastapp', v_p.matricula, 'import', true, p_quien_nombre)
        returning id into v_mi;
      end if;
    end if;

    -- Cómo queda el plato (por nombre: dos nombres casi iguales son un plato).
    select ri.type into v_tipo from public.recipe_item ri where ri.id = v_ri;
    if not (v_platos ? v_norm) then
      v_platos := v_platos || jsonb_build_object(v_norm,
        case when v_tipo = 'raw' then 'almacen'
             when v_ri is not null and exists (select 1 from public.recipe_line rl where rl.parent_item_id = v_ri) then 'receta'
             else 'sin_receta' end);
      if v_tipo = 'raw' then v_almacen := v_almacen || to_jsonb(v_p.nombre); end if;
    end if;

    -- El precio de cada plataforma, cuando no es el de la carta.
    v_base := v_p.base_cents;
    for v_c in
      select sc.id as channel_id,
             (select f.price_cents from public._f01_filas(p_account, p_org, p_nombre) f
               where f.organization_product_id::text = v_p.matricula and f.external_channel = sc.slug and f.price_cents is not null
               order by f.seen_in_catalog_at desc nulls last limit 1) as cents
        from public.sales_channel sc
       where sc.account_id = p_account and sc.slug in ('glovo', 'uber', 'justeat', 'shop')
    loop
      if v_c.cents is not null and v_c.cents is distinct from coalesce(v_base, -1)
         and (v_mi is null or not exists (select 1 from public.menu_item_override o
               where o.account_id = p_account and o.menu_item_id = v_mi and o.channel_id = v_c.channel_id and o.location_id is null)) then
        v_over := v_over + 1;
        if not p_ensayo then
          insert into public.menu_item_override (account_id, menu_item_id, channel_id, location_id, price)
          values (p_account, v_mi, v_c.channel_id, null, v_c.cents::numeric / 100.0);
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'matriculas', v_matr,
    'platos', (select count(*) from jsonb_object_keys(v_platos)),
    'ya_estaban', v_ya,
    'creados', v_creados,
    'enlazados', v_enlazados,
    'juntados', v_juntados,
    'del_almacen', v_almacen,
    'con_receta', (select count(*) from jsonb_each_text(v_platos) x where x.value = 'receta'),
    'sin_receta', (select count(*) from jsonb_each_text(v_platos) x where x.value = 'sin_receta'),
    'precios_por_plataforma', v_over,
    'archivadas', v_archiv);
end $$;
revoke all on function public._f01_sembrar_marca(uuid, uuid, uuid, text, boolean, text) from public, anon, authenticated;

-- ── Vincular una marca en sus locales y plataformas ─────────────────────────
-- Solo locales de Last con local de Folvy ACTIVO. Lo que ya está, se deja.
create or replace function public._f01_vincular(p_account uuid, p_brand uuid, p_org uuid, p_nombre text, p_ensayo boolean, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r          record;
  v_mapas      integer := 0;
  v_otra       jsonb := '[]'::jsonb;
  v_locales    jsonb;
  v_canales    jsonb;
begin
  select coalesce(jsonb_agg(distinct jsonb_build_object('id', l.id, 'nombre', l.name)), '[]'::jsonb) into v_locales
    from public._f01_filas(p_account, p_org, p_nombre) f
    join public.external_location_map lm on lm.account_id = p_account and lm.source = 'lastapp'
         and lm.external_location_id = f.external_location_id::text and lm.is_active
    join public.locations l on l.id = lm.location_id and l.account_id = p_account and l.active;

  select coalesce(jsonb_agg(distinct jsonb_build_object('id', sc.id, 'slug', sc.slug, 'nombre', sc.name)), '[]'::jsonb) into v_canales
    from public._f01_filas(p_account, p_org, p_nombre) f
    cross join lateral unnest(coalesce(f.external_channels, array[f.external_channel])) ch(slug)
    join public.sales_channel sc on sc.account_id = p_account and sc.slug = ch.slug and sc.is_active;

  if not p_ensayo then
    insert into public.brand_location_availability (account_id, brand_id, location_id, is_active, active_since, notes)
    select p_account, p_brand, (x->>'id')::uuid, true, current_date, 'F01 · alta de una marca de Last' from jsonb_array_elements(v_locales) x
    on conflict (account_id, brand_id, location_id) do nothing;

    insert into public.brand_channel (account_id, brand_id, channel_id, is_active, created_by_name)
    select p_account, p_brand, (x->>'id')::uuid, true, p_quien_nombre from jsonb_array_elements(v_canales) x
    on conflict (brand_id, channel_id) do nothing;
  end if;

  -- El vínculo de cada local de Last con su id de marca (cuando el espejo lo trae).
  for v_r in
    select distinct f.external_location_id::text as loc, f.external_brand_id as ext
      from public._f01_filas(p_account, p_org, p_nombre) f
      join public.external_location_map lm on lm.account_id = p_account and lm.source = 'lastapp'
           and lm.external_location_id = f.external_location_id::text and lm.is_active
      join public.locations l on l.id = lm.location_id and l.active
     where f.external_brand_id is not null
  loop
    if exists (select 1 from public.external_brand_map m where m.account_id = p_account and m.source = 'lastapp'
                and m.external_location_id = v_r.loc and m.external_brand_id = v_r.ext) then
      if exists (select 1 from public.external_brand_map m where m.account_id = p_account and m.source = 'lastapp'
                  and m.external_location_id = v_r.loc and m.external_brand_id = v_r.ext
                  and m.brand_id is distinct from p_brand) then
        -- Otra decisión ya tomada (otra marca o ignorada): no se pisa, se dice.
        v_otra := v_otra || jsonb_build_object('local_last', v_r.loc);
      end if;
      continue;
    end if;
    v_mapas := v_mapas + 1;
    if not p_ensayo then
      insert into public.external_brand_map (account_id, source, external_location_id, external_brand_id, brand_id, is_ignored)
      values (p_account, 'lastapp', v_r.loc, v_r.ext, p_brand, false)
      on conflict (account_id, source, external_location_id, external_brand_id) do nothing;
    end if;
  end loop;

  return jsonb_build_object('locales', v_locales, 'canales', v_canales, 'vinculos_nuevos', v_mapas, 'vinculos_de_otra_marca', v_otra);
end $$;
revoke all on function public._f01_vincular(uuid, uuid, uuid, text, boolean, text) from public, anon, authenticated;

-- ── Colocar lo vendido antes (regla 6) ──────────────────────────────────────
-- Las ventas de Last con líneas sin colocar de esta marca (por su matrícula o
-- por su id de marca), DESPUÉS del último recuento cerrado. Las de antes del
-- corte no se tocan: se cuentan y se dicen.
create or replace function public._f01_recolocar(p_account uuid, p_brand uuid, p_org uuid, p_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corte   timestamptz;
  v_id      uuid;
  v_hechas  integer := 0;
  v_fallos  integer := 0;
  v_debajo  integer := 0;
begin
  select max(ic.closed_at) into v_corte from public.inventory_count ic
   where ic.account_id = p_account and ic.status in ('aprobado', 'en_revision');

  for v_id in
    with matriculas as (
      select distinct f.organization_product_id::text as m from public._f01_filas(p_account, p_org, p_nombre) f
       where f.organization_product_id is not null),
    ids as (
      select distinct f.external_brand_id as e from public._f01_filas(p_account, p_org, p_nombre) f where f.external_brand_id is not null),
    ventas as (
      select s.id, s.sold_at from public.sale s
       where s.account_id = p_account and s.source = 'lastapp' and s.raw_products is not null
         and (exists (select 1 from public.sale_line sl
                       where sl.sale_id = s.id and sl.account_id = p_account and sl.menu_item_id is null
                         and coalesce(sl.unmapped_reason, '') in ('no_brand', 'no_menu_item', 'no_recipe')
                         and sl.external_product_id in (select m from matriculas))
              or (s.brand_id is null and s.external_brand_text in (select e from ids))))
    select v.id from ventas v where v_corte is null or v.sold_at > v_corte order by v.sold_at
  loop
    begin
      perform public.reprocess_sale(v_id);
      v_hechas := v_hechas + 1;
    exception when others then
      v_fallos := v_fallos + 1;
      raise warning 'F01: no se ha podido colocar la venta %: %', v_id, sqlerrm;
    end;
  end loop;

  if v_corte is not null then
    select count(distinct s.id) into v_debajo from public.sale s
      join public.sale_line sl on sl.sale_id = s.id and sl.account_id = p_account
     where s.account_id = p_account and s.source = 'lastapp' and s.sold_at <= v_corte and sl.menu_item_id is null
       and coalesce(sl.unmapped_reason, '') in ('no_brand', 'no_menu_item', 'no_recipe')
       and sl.external_product_id in (select f.organization_product_id::text from public._f01_filas(p_account, p_org, p_nombre) f);
  end if;

  return jsonb_build_object('colocadas', v_hechas, 'fallidas', v_fallos, 'antes_del_recuento', v_debajo, 'corte', v_corte);
end $$;
revoke all on function public._f01_recolocar(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ── 4. Las marcas de Last de una cuenta ─────────────────────────────────────
create or replace function public._f01_marcas_last(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  with fotos as (
    select x.external_org_id as org, max(x.seen_in_catalog_at) as ultima
      from public.external_catalog_product x where x.account_id = p_account group by x.external_org_id
  ),
  vivas as (
    -- Una fila por (cuenta de Last, marca, local de Folvy ACTIVO), de una cuenta de Last encendida.
    select e.external_org_id as org, btrim(e.external_brand_name) as nombre, l.id as loc_id, l.name as loc_nombre,
           e.external_location_id::text as loc_last, e.external_brand_id as ext,
           e.organization_product_id, e.product_name, coalesce(e.external_channels, array[e.external_channel]) as canales
      from public.external_catalog_product e
      join public.external_integration ei on ei.account_id = e.account_id and ei.source = 'lastapp'
           and ei.external_org_id = e.external_org_id and ei.is_active
      join public.external_location_map lm on lm.account_id = e.account_id and lm.source = 'lastapp'
           and lm.external_location_id = e.external_location_id::text and lm.is_active
      join public.locations l on l.id = lm.location_id and l.account_id = e.account_id and l.active
      join fotos fo on fo.org = e.external_org_id
     where e.account_id = p_account and e.source = 'lastapp' and e.missing_since is null
       and nullif(btrim(e.external_brand_name), '') is not null and btrim(e.external_brand_name) <> 'FOODINT'
       and e.seen_in_catalog_at >= fo.ultima - interval '1 day'
  ),
  marcas as (
    select v.org, v.nombre,
           jsonb_agg(distinct jsonb_build_object('id', v.loc_id, 'nombre', v.loc_nombre)) as locales,
           (select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from vivas v2 cross join lateral unnest(v2.canales) c
             where v2.org = v.org and v2.nombre = v.nombre and c in ('uber', 'glovo', 'justeat', 'deliveroo', 'shop')) as canales,
           count(distinct public._f01_normalizar(v.product_name)) filter (where v.organization_product_id is not null) as platos,
           -- Un local con su id de marca que Folvy ignora a propósito.
           bool_or(exists (select 1 from public.external_brand_map m where m.account_id = p_account and m.source = 'lastapp'
                             and m.external_location_id = v.loc_last and m.external_brand_id = v.ext and m.is_ignored)) as ignorada
      from vivas v group by v.org, v.nombre
  ),
  con_marca as (
    select m.*, public._f01_marca_vinculada(p_account, m.org, m.nombre) as vinculada,
           public._f01_marca_por_nombre(p_account, m.nombre) as por_nombre,
           ei.organization_name, ei.ownership_type
      from marcas m
      join public.external_integration ei on ei.account_id = p_account and ei.source = 'lastapp' and ei.external_org_id = m.org
  ),
  -- El socio que se propone: el de las otras marcas de la misma cuenta de Last
  -- (su ficha; si no la tienen, la factura de sus pedidos de Last).
  socios as (
    select c.org, x.socio, count(distinct x.brand_id) as marcas
      from (select distinct org from con_marca) c
      cross join lateral (
        select coalesce(a.owner_name,
                 (select public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name' from public.sale s
                   where s.account_id = p_account and s.brand_id = b.id and s.sold_at > now() - interval '90 days'
                     and public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name' is not null
                   order by s.sold_at desc limit 1)) as socio, b.id as brand_id
          from con_marca cm
          join public.brand b on b.id = cm.vinculada and b.ownership_type = 'licensed' and b.is_active
          left join public.brand_licensing_agreement a on a.brand_id = b.id and a.account_id = p_account and a.is_active
         where cm.org = c.org) x
     where x.socio is not null
     group by c.org, x.socio
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'org', cm.org,
           'cuenta_last', cm.organization_name,
           'nombre', cm.nombre,
           'estado', case when cm.ignorada then 'ignorada'
                          when cm.vinculada is not null then 'vinculada'
                          when cm.por_nombre is not null then 'sin_vincular'
                          else 'nueva' end,
           'brand_id', coalesce(cm.vinculada, cm.por_nombre),
           'marca_folvy', (select b.name from public.brand b where b.id = coalesce(cm.vinculada, cm.por_nombre)),
           'locales', cm.locales,
           'canales', cm.canales,
           'platos', cm.platos,
           'ventas', (select count(*) from public.sale s where s.account_id = p_account and s.brand_id = coalesce(cm.vinculada, cm.por_nombre)),
           'propuesta', jsonb_build_object(
              'propia', cm.ownership_type is distinct from 'licensed',
              -- Si ninguna otra marca de esa cuenta de Last lo dice, el nombre de la cuenta (si es de cedidas).
              'socio', coalesce((select so.socio from socios so where so.org = cm.org order by so.marcas desc, so.socio limit 1),
                                case when cm.ownership_type = 'licensed' then cm.organization_name end),
              'socio_marcas', coalesce((select so.marcas from socios so where so.org = cm.org order by so.marcas desc, so.socio limit 1), 0)))
         order by (cm.vinculada is null and not cm.ignorada) desc, cm.nombre), '[]'::jsonb)
    into v
    from con_marca cm;
  return v;
end $$;
revoke all on function public._f01_marcas_last(uuid) from public, anon, authenticated;

create or replace function public.f01_marcas_last(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  -- Dar de alta es cosa de quien administra la cuenta; los demás no ven el aviso.
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    return '[]'::jsonb;
  end if;
  return public._f01_marcas_last(p_account);
end $$;
revoke all on function public.f01_marcas_last(uuid) from public, anon;
grant execute on function public.f01_marcas_last(uuid) to authenticated;

-- ── 5. El alta en una sola pantalla ─────────────────────────────────────────
create or replace function public._f01_alta_marca(p_account uuid, p_org uuid, p_nombre_last text, p_nombre text,
                                                  p_propia boolean, p_socio text, p_ensayo boolean, p_quien uuid, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_last    text := btrim(coalesce(p_nombre_last, ''));
  v_nombre  text := btrim(coalesce(nullif(btrim(p_nombre), ''), p_nombre_last));
  v_socio   text := nullif(btrim(coalesce(p_socio, '')), '');
  v_brand   uuid;
  v_nueva   boolean := false;
  v_slug    text;
  v_n       integer := 1;
  v_vinc    jsonb;
  v_carta   jsonb;
  v_ventas  jsonb;
begin
  if v_last = '' then raise exception 'Falta la marca de Last.' using errcode = '22023'; end if;
  if v_nombre = '' then raise exception 'Falta el nombre de la marca.' using errcode = '22023'; end if;
  if p_propia is null then raise exception 'Falta decir si la marca es tuya o cedida.' using errcode = '22023'; end if;
  if not p_propia and v_socio is null then raise exception 'Una marca cedida necesita su socio.' using errcode = '22023'; end if;
  if not exists (select 1 from public.external_integration ei where ei.account_id = p_account and ei.source = 'lastapp'
                  and ei.external_org_id = p_org and ei.is_active) then
    raise exception 'Esa cuenta de Last no está conectada.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public._f01_filas(p_account, p_org, v_last)) then
    raise exception 'La marca «%» ya no está en las cartas de Last.', v_last using errcode = 'P0002';
  end if;

  -- La marca: la del alta, la vinculada o la que se llama igual; si no hay, una nueva.
  v_brand := coalesce(public._f01_marca_vinculada(p_account, p_org, v_last), public._f01_marca_por_nombre(p_account, v_nombre),
                      public._f01_marca_por_nombre(p_account, v_last));
  if v_brand is null then
    v_nueva := true;
    if not p_ensayo then
      v_slug := coalesce(nullif(btrim(regexp_replace(lower(public.unaccent(v_nombre)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'marca');
      while exists (select 1 from public.brand b where b.account_id = p_account and b.slug = case when v_n = 1 then v_slug else v_slug || '-' || v_n end) loop
        v_n := v_n + 1;
      end loop;
      insert into public.brand (account_id, name, slug, ownership_type, is_active, catalog_source, created_by, created_by_name)
      values (p_account, v_nombre, case when v_n = 1 then v_slug else v_slug || '-' || v_n end,
              case when p_propia then 'own' else 'licensed' end, true, 'pos', p_quien, p_quien_nombre)
      returning id into v_brand;
    end if;
  elsif not p_ensayo then
    update public.brand set ownership_type = case when p_propia then 'own' else 'licensed' end, is_active = true, updated_at = now()
     where id = v_brand and (ownership_type is distinct from case when p_propia then 'own' else 'licensed' end or not is_active);
  end if;

  if not p_ensayo then
    -- De quién es: el socio de una cedida, en su ficha (el porcentaje, cuando se sepa).
    if not p_propia then
      insert into public.brand_licensing_agreement (account_id, brand_id, owner_name, revenue_share_pct, is_active, created_by, created_by_name)
      values (p_account, v_brand, v_socio, null, true, p_quien, p_quien_nombre)
      on conflict (brand_id) do update set owner_name = excluded.owner_name, is_active = true, archived_at = null, updated_at = now();
    end if;
    insert into public.external_brand_alta (account_id, source, external_org_id, external_brand_name, brand_id, created_by, created_by_name)
    values (p_account, 'lastapp', p_org, v_last, v_brand, p_quien, p_quien_nombre)
    on conflict (account_id, source, external_org_id, external_brand_name) do update set brand_id = excluded.brand_id;
  end if;

  -- En ensayo con marca nueva, v_brand es null: se lee igual (nada de la marca existe todavía).
  v_vinc  := public._f01_vincular(p_account, v_brand, p_org, v_last, p_ensayo, p_quien_nombre);
  v_carta := public._f01_sembrar_marca(p_account, v_brand, p_org, v_last, p_ensayo, p_quien_nombre);
  v_ventas := case when p_ensayo then null else public._f01_recolocar(p_account, v_brand, p_org, v_last) end;

  return jsonb_build_object(
    'brand_id', v_brand, 'nombre', v_nombre, 'nueva', v_nueva, 'propia', p_propia, 'socio', case when p_propia then null else v_socio end,
    'ensayo', p_ensayo, 'locales', coalesce(v_vinc->'locales', '[]'::jsonb), 'canales', coalesce(v_vinc->'canales', '[]'::jsonb),
    'vinculos_nuevos', coalesce((v_vinc->>'vinculos_nuevos')::integer, 0), 'vinculos_de_otra_marca', coalesce(v_vinc->'vinculos_de_otra_marca', '[]'::jsonb),
    'carta', v_carta, 'ventas', v_ventas);
end $$;
revoke all on function public._f01_alta_marca(uuid, uuid, text, text, boolean, text, boolean, uuid, text) from public, anon, authenticated;

-- Lo que llama la pantalla. «Ensayo» = lo que haría, sin tocar nada (el panel lo enseña antes del botón).
create or replace function public.f01_alta_marca(p_account uuid, p_org uuid, p_nombre_last text, p_nombre text,
                                                 p_propia boolean, p_socio text, p_ensayo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Dar de alta una marca es cosa de quien administra la cuenta.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(up.display_name), ''), u.email) into v_nombre
    from auth.users u left join public.user_profiles up on up.user_id = u.id and up.account_id = p_account
   where u.id = auth.uid() limit 1;
  return public._f01_alta_marca(p_account, p_org, p_nombre_last, p_nombre, p_propia, p_socio, coalesce(p_ensayo, false), auth.uid(), v_nombre);
end $$;
revoke all on function public.f01_alta_marca(uuid, uuid, text, text, boolean, text, boolean) from public, anon;
grant execute on function public.f01_alta_marca(uuid, uuid, text, text, boolean, text, boolean) to authenticated;

-- ── 6. La pasada de cada sincronización ─────────────────────────────────────
-- Vincula los locales nuevos de las marcas dadas de alta y coloca lo vendido
-- que haya quedado sin marca. No crea marcas ni platos: eso es el alta.
create or replace function public.f01_pasada_last(p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a       record;
  v_vinc    jsonb;
  v_ventas  jsonb;
  v_salida  jsonb := '[]'::jsonb;
begin
  for v_a in select a.* from public.external_brand_alta a
               join public.brand b on b.id = a.brand_id and b.archived_at is null
              where a.account_id = p_account and a.source = 'lastapp'
  loop
    v_vinc := public._f01_vincular(p_account, v_a.brand_id, v_a.external_org_id, v_a.external_brand_name, false, 'F01 · pasada de Last');
    if (v_vinc->>'vinculos_nuevos')::integer > 0 then
      v_ventas := public._f01_recolocar(p_account, v_a.brand_id, v_a.external_org_id, v_a.external_brand_name);
      v_salida := v_salida || jsonb_build_object('marca', v_a.external_brand_name, 'vinculos_nuevos', v_vinc->'vinculos_nuevos', 'ventas', v_ventas);
    end if;
  end loop;
  return jsonb_build_object('marcas_con_vinculos_nuevos', v_salida);
end $$;
revoke all on function public.f01_pasada_last(uuid) from public, anon, authenticated;
grant execute on function public.f01_pasada_last(uuid) to service_role;

