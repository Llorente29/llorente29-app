-- ============================================================================
-- Folvy · Fiabilidad del almacén — cola de trabajo + auto-casado exacto
-- Encargo: ENCARGO_CODE fiabilidad del almacén (26/07/2026)
--
-- Contexto medido (7 días, Alcalá): de 551 líneas vendidas, 247 no descuentan
-- ingredientes (45%). El food cost se calcula sobre poco más de la mitad.
-- Los tres carriles son los tres puntos donde generate_sale_consumption se rinde:
--   A · sale_line.menu_item_id IS NULL          → 187 líneas · 26 productos · 2.998 €
--   B · _sale_line_raw_consumption() sin filas  →  60 líneas · 31 productos ·   696 €
--   C · COALESCE(avg_unit_cost, computed_cost) NULL → movimiento con coste vacío
--
-- QUÉ TRAE ESTA MIGRACIÓN (y por qué, tras leer las funciones vivas)
--
-- 1) map_sales_product_to_dish — LA PIEZA QUE FALTABA.
--    El encargo daba por hecho que el backend estaba completo, pero NINGUNA RPC
--    sabía casar un producto vendido a un plato QUE YA EXISTE:
--      · resolve_unmapped_sales('link')  → CREA un plato nuevo (duplicaría el que ya hay)
--      · create_dish_from_unmapped       → CREA un plato nuevo
--      · classify_unmapped_product('dish', target) → devuelve 'is_dish' y no conecta nada
--      · classify_unmapped_product('resale', target) → sí ancla, pero convierte el
--        artículo en 'raw' de reventa: destrozaría un plato con escandallo.
--    Sin esto, el botón "Sí, es este plato" de la cola no puede existir. Esta RPC
--    apunta el menu_item SELLADO (matrícula del TPV) al recipe_item ELEGIDO.
--
-- 2) auto_map_exact_sales + cron cada 15 min — que la cola no se vuelva a llenar.
--    Decisión de Julio (26/07): auto-casar SÓLO coincidencia EXACTA de nombre
--    normalizado, y sólo si el candidato es único. Un fuzzy del 90% casaría
--    "Milanesa Napolitana" con "Milanesa Napolitana XL" y descontaría los
--    ingredientes equivocados en silencio; eso no entra. Todo lo demás va a la
--    cola con su sugerencia. Nota: run_mapping NO persiste nada (verificado), así
--    que un cron que sólo lo llamara tiraría el resultado — por eso el cron casa.
--
-- 3) sales_mapping_fix — el registro que hace posible "persiste hasta corregirlo".
--    Un producto NO sale de la cola por pulsar un botón: sale cuando una venta
--    NUEVA suya ya casa. Aquí se apunta cuándo se arregló y cómo, para poder
--    decir "arreglado, esperando la próxima venta" y para revertir el automático.
--
-- 4) warehouse_reliability_queue — la cola entera (A, B y C) en UNA llamada,
--    agrupada por producto y ordenada por € de impacto. Hoy el front se descarga
--    TODAS las líneas sin casar de la cuenta y agrupa en el navegador.
--
-- 5) recost_sales_for_product — el re-costeo retroactivo, con dry-run.
--    NO se ejecuta solo: mapear arregla de hoy en adelante. Rehacer semanas
--    pasadas descuadra el stock contado, así que es un botón aparte y explícito.
--
-- Aplicar a mano en el SQL Editor. Sin begin/commit. Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3) Registro de arreglos (auditoría + reversión + "esperando confirmación")
-- ----------------------------------------------------------------------------
create table if not exists public.sales_mapping_fix (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  product_norm    text not null,               -- nombre normalizado del producto del TPV
  product_name    text not null,               -- tal cual se vio, para enseñarlo
  recipe_item_id  uuid references public.recipe_item(id) on delete set null,
  menu_item_id    uuid references public.menu_item(id)   on delete set null,
  method          text not null check (method in ('manual','auto_exact','ignore','dish_created')),
  confidence      numeric,
  actor_name      text,
  fixed_at        timestamptz not null default now(),
  reverted_at     timestamptz,
  notes           text
);

create index if not exists idx_sales_mapping_fix_lookup
  on public.sales_mapping_fix (account_id, product_norm, fixed_at desc);

alter table public.sales_mapping_fix enable row level security;

drop policy if exists sales_mapping_fix_select on public.sales_mapping_fix;
create policy sales_mapping_fix_select on public.sales_mapping_fix
  for select using (public.belongs_to_account(account_id));

comment on table public.sales_mapping_fix is
  'Bitácora de arreglos de casado de ventas. Permite decir "arreglado, esperando la próxima venta", auditar lo que casó el cron y revertirlo.';

-- Normalización ÚNICA del nombre de producto: la misma que usan
-- resolve_unmapped_sales y classify_unmapped_product (minúsculas, sin acentos,
-- sin punto final, espacios colapsados). Si esto diverge, el casado se rompe en
-- silencio, así que vive en una sola función.
create or replace function public.sales_product_norm(p_name text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select regexp_replace(
           regexp_replace(btrim(lower(public.unaccent(coalesce(p_name, '')))), '\.$', ''),
           '\s+', ' ', 'g'
         );
$$;

-- Sigla de una marca: iniciales de sus palabras, ignorando conectores.
--   'Milanesa Haus' → mh · 'Dos Coyotes' → dc · 'Ay Mamita Bowls' → amb
create or replace function public.sales_brand_initials(p_brand_name text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select string_agg(left(w, 1), '' order by ord)
  from (
    select w, ord from unnest(
             string_to_array(
               regexp_replace(lower(public.unaccent(coalesce(p_brand_name, ''))), '[^a-z0-9 ]', ' ', 'g'),
               ' ')
           ) with ordinality as t(w, ord)
    where w <> '' and w not in ('de','del','la','el','los','las','y','do','it','the','of','and','a')
  ) q;
$$;

-- Nombre normalizado SIN el marcador de marca del final.
-- El sufijo sólo se quita si es la sigla (o el nombre) de la marca DE ESA VENTA:
-- así "(MH)" desaparece en un producto de Milanesa Haus, pero "XL" nunca, porque
-- ninguna marca se llama así. Sin esta atadura, "Milanesa de Pollo XL" casaría
-- con "Milanesa de Pollo" y descontaría la receta equivocada en silencio.
create or replace function public.sales_product_norm_nobrand(p_name text, p_brand_name text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_norm  text := public.sales_product_norm(p_name);
  v_sigla text := public.sales_brand_initials(p_brand_name);
  v_marca text := public.sales_product_norm(p_brand_name);
  v_tok   text;
begin
  foreach v_tok in array array[v_sigla, v_marca] loop
    if v_tok is null or length(v_tok) < 2 then continue; end if;
    -- "... (mh)" o "... mh" al final
    if v_norm like '%(' || v_tok || ')' then
      v_norm := btrim(left(v_norm, length(v_norm) - length(v_tok) - 2));
    elsif v_norm like '% ' || v_tok then
      v_norm := btrim(left(v_norm, length(v_norm) - length(v_tok) - 1));
    end if;
  end loop;
  return btrim(v_norm);
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) map_sales_product_to_dish — casar un producto vendido a un plato EXISTENTE
-- ----------------------------------------------------------------------------
-- Apunta el menu_item sellado por matrícula (external_source='lastapp',
-- external_id = external_product_id del TPV) al recipe_item elegido. Si no
-- existe ese menu_item, lo crea apuntando al plato elegido — NUNCA crea un plato.
--
-- Alcance temporal: de HOY en adelante, igual que classify_unmapped_product. No
-- reprocesa el histórico (eso descuadra el stock contado y además revienta por
-- timeout con volumen). El histórico se rehace, si se quiere, con
-- recost_sales_for_product, que es explícito y tiene dry-run.
create or replace function public._map_sales_product_to_dish_internal(
  p_account_id     uuid,
  p_product_name   text,
  p_recipe_item_id uuid,
  p_brand_id       uuid default null,
  p_actor_name     text default null,
  p_method         text default 'manual'
)
returns table(resultado text, menu_item_id uuid, recipe_item_id uuid, brand_id uuid, lineas_futuras integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_norm      text;
  v_matricula text;
  v_brand_id  uuid;
  v_menu_id   uuid;
  v_dish      record;
  v_unit      uuid;
  v_cat_name  text;
  v_cat_price numeric;
  v_is_combo  boolean := false;
  v_pend      integer := 0;
begin
  if p_method not in ('manual','auto_exact') then
    raise exception 'map_sales_product_to_dish: método inválido %', p_method;
  end if;

  v_norm := public.sales_product_norm(p_product_name);
  if v_norm = '' then
    raise exception 'map_sales_product_to_dish: nombre de producto vacío';
  end if;

  -- El plato destino debe existir, ser de la cuenta y estar vivo. No se admite
  -- casar contra un artículo archivado: sería enterrar el problema.
  select ri.id, ri.name, ri.type, ri.archived_at
    into v_dish
    from recipe_item ri
   where ri.id = p_recipe_item_id and ri.account_id = p_account_id;
  if not found then
    raise exception 'map_sales_product_to_dish: el plato % no existe en la cuenta.', p_recipe_item_id;
  end if;
  if v_dish.archived_at is not null then
    raise exception 'El plato "%" está archivado; elige uno activo.', v_dish.name;
  end if;

  -- Matrícula del TPV + marca, tomadas de las propias ventas sin casar.
  select sl.external_product_id, s.brand_id
    into v_matricula, v_brand_id
    from sale_line sl
    join sale s on s.id = sl.sale_id
   where sl.account_id = p_account_id
     and s.source = 'lastapp'
     and coalesce(sl.line_type, 'product') = 'product'
     and (p_brand_id is null or s.brand_id = p_brand_id)
     and public.sales_product_norm(sl.product_name) = v_norm
   order by (sl.external_product_id is not null) desc, (s.brand_id is not null) desc
   limit 1;

  if v_matricula is null then
    raise exception 'No se pudo resolver "%" por matrícula (sus ventas no traen id de producto del TPV).', p_product_name;
  end if;

  v_brand_id := coalesce(p_brand_id, v_brand_id);
  if v_brand_id is null then
    raise exception 'No se pudo resolver la marca de "%".', p_product_name;
  end if;

  -- Un combo no se casa a un plato: su coste es Σ de componentes (frente propio).
  select bool_or(ecp.product_type = 'combo'),
         max(ecp.product_name) filter (where ecp.external_channel = 'default'),
         coalesce(
           max(ecp.price_cents) filter (where ecp.external_channel = 'default'),
           (select mode() within group (order by ecp2.price_cents)
              from external_catalog_product ecp2
             where ecp2.account_id = p_account_id
               and ecp2.organization_product_id::text = v_matricula
               and ecp2.price_cents is not null)
         )
    into v_is_combo, v_cat_name, v_cat_price
    from external_catalog_product ecp
   where ecp.account_id = p_account_id
     and ecp.organization_product_id::text = v_matricula;

  if coalesce(v_is_combo, false) then
    raise exception 'El producto "%" es un combo; su coste es Σ componentes, no una receta.', p_product_name;
  end if;

  -- ¿Ya hay menu_item sellado para esa matrícula y marca? → reapuntarlo al plato.
  select mi.id into v_menu_id
    from menu_item mi
   where mi.account_id = p_account_id
     and mi.external_source = 'lastapp'
     and mi.external_id = v_matricula
     and mi.brand_id = v_brand_id
     and mi.archived_at is null
   limit 1;

  if v_menu_id is not null then
    update menu_item
       set recipe_item_id = p_recipe_item_id,
           needs_review = false,
           updated_at = now()
     where id = v_menu_id;
  else
    select id into v_unit from kitchen_unit
     where lower(coalesce(abbreviation,'')) = 'ud' or lower(coalesce(name,'')) = 'unidad'
     order by (lower(coalesce(abbreviation,'')) = 'ud') desc
     limit 1;
    if v_unit is null then
      raise exception 'No existe la unidad base "Unidad" en kitchen_unit.';
    end if;

    insert into menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                           product_type, external_source, external_id, source, needs_review)
    values (p_account_id, v_brand_id, null, p_recipe_item_id,
            coalesce(nullif(btrim(v_cat_name), ''), p_product_name),
            coalesce(v_cat_price, 0)::numeric / 100.0,
            'item', 'lastapp', v_matricula, 'import', false)
    returning id into v_menu_id;
  end if;

  -- El plato pasa a ser vendible (si no lo era) para que la carta lo reconozca.
  update recipe_item
     set is_sellable = true, updated_at = now()
   where id = p_recipe_item_id and coalesce(is_sellable, false) = false;

  -- Cuántas líneas ya vendidas quedan pendientes de este producto: NO se tocan
  -- aquí (mapear arregla de hoy en adelante). Se informa para que la pantalla
  -- pueda ofrecer el re-costeo retroactivo con una cifra real.
  select count(*) into v_pend
    from sale_line sl
    join sale s on s.id = sl.sale_id
   where sl.account_id = p_account_id
     and sl.menu_item_id is null
     and sl.ignored_at is null
     and coalesce(sl.line_type,'product') = 'product'
     and public.sales_product_norm(sl.product_name) = v_norm;

  insert into sales_mapping_fix (account_id, product_norm, product_name, recipe_item_id,
                                 menu_item_id, method, actor_name)
  values (p_account_id, v_norm, p_product_name, p_recipe_item_id, v_menu_id, p_method, p_actor_name);

  return query select 'mapped'::text, v_menu_id, p_recipe_item_id, v_brand_id, v_pend;
end;
$$;

comment on function public._map_sales_product_to_dish_internal(uuid, text, uuid, uuid, text, text) is
  'Motor del casado producto→plato, SIN guard de sesión. NO se concede a authenticated: lo llaman la función pública (que sí comprueba acceso) y el cron.';

-- Cara pública: comprueba acceso y delega. El guard vive aquí, y sólo aquí,
-- porque el cron corre como `postgres`, que NO es admin de ninguna cuenta
-- (verificado: current_user_is_admin() = false). Con el guard dentro del motor,
-- el cron lanzaría excepción en cada producto, el `exception when others` de
-- auto_map_exact_sales se la tragaría y el trabajo saldría a cero cada 15
-- minutos, en silencio y para siempre — con el dry-run en verde, además.
create or replace function public.map_sales_product_to_dish(
  p_account_id     uuid,
  p_product_name   text,
  p_recipe_item_id uuid,
  p_brand_id       uuid default null,
  p_actor_name     text default null,
  p_method         text default 'manual'
)
returns table(resultado text, menu_item_id uuid, recipe_item_id uuid, brand_id uuid, lineas_futuras integer)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'map_sales_product_to_dish: sin acceso a la cuenta %', p_account_id;
  end if;
  return query
    select * from public._map_sales_product_to_dish_internal(
      p_account_id, p_product_name, p_recipe_item_id, p_brand_id, p_actor_name, p_method);
end;
$$;

comment on function public.map_sales_product_to_dish(uuid, text, uuid, uuid, text, text) is
  'Casa un producto vendido del TPV a un plato QUE YA EXISTE (apunta el menu_item sellado por matrícula). No crea platos y no reprocesa histórico.';

-- ----------------------------------------------------------------------------
-- 2) auto_map_exact_sales — sólo coincidencia EXACTA y candidato ÚNICO
-- ----------------------------------------------------------------------------
create or replace function public.auto_map_exact_sales(
  p_account_id uuid default null,
  p_days       integer default 30,
  p_dry_run    boolean default false
)
returns table(product_name text, recipe_item_id uuid, dish_name text, aplicado boolean, motivo text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row     record;
  v_target  uuid;
  v_tname   text;
  v_n       integer;
begin
  for v_row in
    select sl.account_id,
           b.name as brand_name,
           public.sales_product_norm_nobrand(sl.product_name, b.name) as norm,
           min(sl.product_name) as sample_name,
           count(*) as lineas
      from sale_line sl
      join sale s on s.id = sl.sale_id
      left join brand b on b.id = s.brand_id
     where (p_account_id is null or sl.account_id = p_account_id)
       and s.source = 'lastapp'
       and s.is_active
       and sl.menu_item_id is null
       and sl.ignored_at is null
       and coalesce(sl.line_type,'product') = 'product'
       and s.sold_at >= now() - make_interval(days => greatest(p_days, 1))
     group by 1, 2, 3
  loop
    -- Candidatos: artículos vivos de la cuenta cuyo nombre, quitando la MISMA
    -- sigla de marca, es IDÉNTICO. Ni fuzzy, ni prefijos, ni "empieza por":
    -- igualdad exacta tras retirar el marcador de canal.
    select count(*), min(ri.id), min(ri.name)
      into v_n, v_target, v_tname
      from recipe_item ri
     where ri.account_id = v_row.account_id
       and ri.archived_at is null
       and ri.type in ('dish','raw')
       and public.sales_product_norm_nobrand(ri.name, v_row.brand_name) = v_row.norm
       and v_row.norm <> '';

    if v_n = 0 then
      product_name := v_row.sample_name; recipe_item_id := null; dish_name := null;
      aplicado := false; motivo := 'sin coincidencia exacta';
      return next; continue;
    elsif v_n > 1 then
      -- Varios artículos con el mismo nombre: elegir sería adivinar. A la cola.
      product_name := v_row.sample_name; recipe_item_id := null; dish_name := null;
      aplicado := false; motivo := 'varios artículos con ese nombre exacto';
      return next; continue;
    end if;

    if p_dry_run then
      product_name := v_row.sample_name; recipe_item_id := v_target; dish_name := v_tname;
      aplicado := false; motivo := 'dry-run';
      return next; continue;
    end if;

    -- Un fallo en un producto (combo, sin matrícula, sin marca) no puede parar
    -- al resto de la pasada.
    begin
      -- Al INTERNO a propósito: la pública exige sesión de admin y el cron no
      -- la tiene. Ver el comentario de _map_sales_product_to_dish_internal.
      perform public._map_sales_product_to_dish_internal(
        v_row.account_id, v_row.sample_name, v_target, null, 'auto (coincidencia exacta)', 'auto_exact');
      product_name := v_row.sample_name; recipe_item_id := v_target; dish_name := v_tname;
      aplicado := true; motivo := null;
    exception when others then
      product_name := v_row.sample_name; recipe_item_id := v_target; dish_name := v_tname;
      aplicado := false; motivo := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;

comment on function public.auto_map_exact_sales(uuid, integer, boolean) is
  'Casa solo los productos cuyo nombre normalizado coincide EXACTAMENTE con un único artículo vivo. Lo demás va a la cola. p_dry_run para ver qué haría.';

-- Cron cada 15 minutos (patrón de los otros 20 jobs del proyecto).
select cron.unschedule('sales-automap-exact')
 where exists (select 1 from cron.job where jobname = 'sales-automap-exact');

select cron.schedule('sales-automap-exact', '*/15 * * * *',
  $cron$ select public.auto_map_exact_sales(); $cron$);

-- ----------------------------------------------------------------------------
-- 4) warehouse_reliability_queue — la cola A/B/C en una llamada
-- ----------------------------------------------------------------------------
-- Devuelve jsonb: { carril, product_name, recipe_item_id, ventas, eur,
--                   ultima_venta, estado, fixed_at, ventas_desde_arreglo,
--                   ventas_ok_desde_arreglo, detalle }
--   estado: 'pendiente'            → nunca se tocó
--           'esperando_confirmacion' → arreglado, aún sin ventas nuevas
--           'recaido'              → arreglado pero volvió a fallar (reaparece)
-- Ordenado por € de impacto desc. Un producto sale de la cola cuando sus ventas
-- NUEVAS ya casan: eso lo decide el dato, no un botón.
create or replace function public.warehouse_reliability_queue(
  p_account_id  uuid,
  p_location_id uuid default null,
  p_days        integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Guard multi-cuenta. Sin esto, un usuario podría pasar el account_id de otro
  -- cliente y leerle ventas, platos e importes: la RPC es SECURITY DEFINER y
  -- está concedida a authenticated. Misma fuga que se cerró el 25/07 en
  -- _kitchen_day_banner_for.
  if not public.belongs_to_account(p_account_id) then
    raise exception 'warehouse_reliability_queue: sin acceso a la cuenta %', p_account_id;
  end if;

  return (
with rango as (
  select now() - make_interval(days => greatest(p_days, 1)) as desde
),
lineas as (
  select sl.id, sl.product_name, sl.menu_item_id, sl.line_total, sl.ignored_at,
         s.sold_at, s.location_id, mi.recipe_item_id
    from sale_line sl
    join sale s on s.id = sl.sale_id
    left join menu_item mi on mi.id = sl.menu_item_id
   cross join rango r
   where sl.account_id = p_account_id
     and s.is_active
     and s.sold_at >= r.desde
     and coalesce(sl.line_type,'product') = 'product'
     and (p_location_id is null or s.location_id = p_location_id)
),
-- ── Carril A: la venta no conecta con ningún plato de la carta ──
carril_a as (
  select public.sales_product_norm(l.product_name) as norm,
         min(l.product_name) as product_name,
         count(*) as ventas,
         round(sum(coalesce(l.line_total,0))::numeric, 2) as eur,
         max(l.sold_at) as ultima_venta
    from lineas l
   where l.menu_item_id is null and l.ignored_at is null
   group by 1
),
-- ── Carril B: casa con un plato, pero el plato no explota a ingredientes ──
carril_b as (
  select public.sales_product_norm(l.product_name) as norm,
         min(l.product_name) as product_name,
         min(l.recipe_item_id::text)::uuid as recipe_item_id,
         count(*) as ventas,
         round(sum(coalesce(l.line_total,0))::numeric, 2) as eur,
         max(l.sold_at) as ultima_venta
    from lineas l
   where l.menu_item_id is not null and l.ignored_at is null
     and not exists (select 1 from public._sale_line_raw_consumption(l.id))
   group by 1
),
-- ── Carril C: el ingrediente sale del almacén sin saber lo que cuesta ──
carril_c as (
  select ri.id as recipe_item_id, ri.name as product_name,
         count(*) as ventas,
         0::numeric as eur,
         max(sm.occurred_at) as ultima_venta,
         (select count(*) from recipe_line rl where rl.child_item_id = ri.id) as en_recetas
    from stock_movement sm
    join recipe_item ri on ri.id = sm.recipe_item_id
   cross join rango r
   where sm.account_id = p_account_id
     and sm.movement_type = 'consumo'
     and sm.occurred_at >= r.desde
     and sm.unit_cost is null
     and (p_location_id is null or sm.location_id = p_location_id)
   group by 1, 2
),
-- Último arreglo por producto (para el estado y el "hasta corregirlo").
fixes as (
  select distinct on (product_norm) product_norm, fixed_at, recipe_item_id, method
    from sales_mapping_fix
   where account_id = p_account_id and reverted_at is null
   order by product_norm, fixed_at desc
),
-- ¿Ha vendido después del arreglo? ¿Casó esa venta nueva?
verificacion as (
  select f.product_norm,
         count(*) filter (where l.sold_at > f.fixed_at) as ventas_desde,
         count(*) filter (where l.sold_at > f.fixed_at and l.menu_item_id is not null) as ok_desde
    from fixes f
    join lineas l on public.sales_product_norm(l.product_name) = f.product_norm
   group by 1
),
unidas as (
  select 'A' as carril, a.norm, a.product_name, null::uuid as recipe_item_id,
         a.ventas, a.eur, a.ultima_venta, null::bigint as en_recetas
    from carril_a a
  union all
  select 'B', b.norm, b.product_name, b.recipe_item_id, b.ventas, b.eur, b.ultima_venta, null
    from carril_b b
  union all
  select 'C', public.sales_product_norm(c.product_name), c.product_name, c.recipe_item_id,
         c.ventas, c.eur, c.ultima_venta, c.en_recetas
    from carril_c c
)
select coalesce(jsonb_agg(x order by x.carril, x.eur desc, x.ventas desc), '[]'::jsonb)
from (
  select u.carril, u.product_name, u.recipe_item_id, u.ventas, u.eur,
         u.ultima_venta, u.en_recetas,
         f.fixed_at, f.method as fix_method,
         coalesce(v.ventas_desde, 0) as ventas_desde_arreglo,
         coalesce(v.ok_desde, 0)     as ventas_ok_desde_arreglo,
         case
           when f.product_norm is null then 'pendiente'
           when coalesce(v.ventas_desde, 0) = 0 then 'esperando_confirmacion'
           else 'recaido'
         end as estado
    from unidas u
    left join fixes f on f.product_norm = u.norm
    left join verificacion v on v.product_norm = u.norm
) x
  );
end;
$$;

comment on function public.warehouse_reliability_queue(uuid, uuid, integer) is
  'Cola de fiabilidad del almacén: carriles A (sin casar), B (sin escandallo) y C (sin coste), por producto y ordenados por € de impacto, con el estado de verificación de cada arreglo.';

-- ----------------------------------------------------------------------------
-- 5) recost_sales_for_product — re-costeo retroactivo EXPLÍCITO (con dry-run)
-- ----------------------------------------------------------------------------
-- Rehace el pasado de UN producto: casa sus líneas antiguas y vuelve a generar
-- el consumo de esas ventas. Descuadra el stock físico contado, así que nunca
-- corre solo: lo pide una persona sabiendo lo que hace, y p_dry_run enseña el
-- impacto antes de tocar nada.
create or replace function public.recost_sales_for_product(
  p_account_id   uuid,
  p_product_name text,
  p_days         integer default 30,
  p_dry_run      boolean default true
)
returns table(ventas_afectadas integer, lineas_afectadas integer, movimientos integer, aplicado boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_norm    text;
  v_sale    record;
  v_ventas  integer := 0;
  v_lineas  integer := 0;
  v_movs    integer := 0;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'recost_sales_for_product: sin acceso a la cuenta %', p_account_id;
  end if;

  v_norm := public.sales_product_norm(p_product_name);

  create temp table if not exists _recost_sales (sale_id uuid primary key) on commit drop;
  delete from _recost_sales;

  insert into _recost_sales (sale_id)
  select distinct s.id
    from sale_line sl
    join sale s on s.id = sl.sale_id
   where sl.account_id = p_account_id
     and s.is_active
     and s.sold_at >= now() - make_interval(days => greatest(p_days, 1))
     and coalesce(sl.line_type,'product') = 'product'
     and sl.ignored_at is null
     and public.sales_product_norm(sl.product_name) = v_norm;

  select count(*) into v_ventas from _recost_sales;

  select count(*) into v_lineas
    from sale_line sl
   where sl.account_id = p_account_id
     and sl.sale_id in (select sale_id from _recost_sales)
     and public.sales_product_norm(sl.product_name) = v_norm;

  if p_dry_run then
    return query select v_ventas, v_lineas, 0, false;
    return;
  end if;

  -- Casar las líneas viejas con el menu_item sellado de su matrícula, igual que
  -- haría el recast, pero acotado a este producto (no a la cuenta entera).
  update sale_line sl
     set menu_item_id = mi.id, map_source = 'manual', map_needs_review = false,
         unmapped_reason = null, updated_at = now()
    from sale s, menu_item mi
   where sl.sale_id = s.id
     and sl.account_id = p_account_id
     and sl.sale_id in (select sale_id from _recost_sales)
     and sl.menu_item_id is null
     and public.sales_product_norm(sl.product_name) = v_norm
     and mi.account_id = p_account_id
     and mi.external_source = 'lastapp'
     and mi.external_id = sl.external_product_id
     and mi.brand_id is not distinct from s.brand_id
     and mi.archived_at is null;

  for v_sale in select sale_id from _recost_sales loop
    v_movs := v_movs + coalesce(public.generate_sale_consumption(v_sale.sale_id), 0);
  end loop;

  return query select v_ventas, v_lineas, v_movs, true;
end;
$$;

comment on function public.recost_sales_for_product(uuid, text, integer, boolean) is
  'Re-costeo retroactivo de UN producto (casa líneas viejas + regenera consumo). Descuadra el stock contado: siempre explícito, con dry-run por defecto.';

-- ----------------------------------------------------------------------------
-- GRANTS + recarga del esquema expuesto
-- ----------------------------------------------------------------------------
grant execute on function public.sales_product_norm(text)                                    to authenticated;
grant execute on function public.sales_brand_initials(text)                                  to authenticated;
grant execute on function public.sales_product_norm_nobrand(text, text)                      to authenticated;
grant execute on function public.map_sales_product_to_dish(uuid, text, uuid, uuid, text, text) to authenticated;
-- El motor interno queda fuera del alcance de la sesión: sólo lo invocan la
-- función pública (con guard) y el cron. Revocado explícitamente por si acaso.
revoke all on function public._map_sales_product_to_dish_internal(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.warehouse_reliability_queue(uuid, uuid, integer)            to authenticated;
grant execute on function public.recost_sales_for_product(uuid, text, integer, boolean)      to authenticated;
grant execute on function public.auto_map_exact_sales(uuid, integer, boolean)                to authenticated;
grant select on public.sales_mapping_fix to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
-- 1) Qué casaría el automático (VISTA PREVIA, no toca nada):
--    select * from public.auto_map_exact_sales(null, 30, true) order by aplicado desc;
--
-- 1b) LA QUE VALE — ejecución REAL. El dry-run retorna antes de casar, así que
--     sale verde aunque producción no haga nada: hay que comprobar el efecto.
--    select * from public.auto_map_exact_sales(null, 30, false) order by aplicado desc;
--    select method, count(*), max(fixed_at)
--      from public.sales_mapping_fix group by 1;      -- debe haber method='auto_exact'
--    select jobname, schedule, active from cron.job where jobname='sales-automap-exact';
--
-- 2) La cola de Alcalá, 7 días (lo que verá la pantalla):
--    select jsonb_pretty(public.warehouse_reliability_queue(
--      (select account_id from public.locations where id='38158159-cd71-4056-950b-53425afac1ce'),
--      '38158159-cd71-4056-950b-53425afac1ce', 7));
--
-- 3) El cron quedó programado:
--    select jobname, schedule, active from cron.job where jobname = 'sales-automap-exact';
--
-- 4) Impacto de re-costear un producto (sin ejecutarlo):
--    select * from public.recost_sales_for_product(
--      '<account>', 'Milanesa de Pollo Napolitana (MH)', 30, true);
-- ============================================================================
