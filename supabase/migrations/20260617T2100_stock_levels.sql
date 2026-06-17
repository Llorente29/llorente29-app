-- supabase/migrations/20260617T2100_stock_levels.sql
--
-- Frente ② — NIVELES DE STOCK (base del MRP II).
-- Política de stock por artículo × local (separada del saldo, que vive en
-- recipe_item_location_stock). Cinco campos; la UI activa hoy min_qty + par_qty;
-- reorder_point / lead_time_days / safety_qty quedan listos para el MRP II.
--
--   min_qty       : por debajo = alerta roja (rotura inminente).
--   par_qty       : nivel objetivo; "To Par" pide hasta aquí (par − stock).
--   reorder_point : punto de pedido (MRP II; null = no activo).
--   lead_time_days: días que tarda el proveedor (MRP II).
--   safety_qty    : stock de seguridad (MRP II).
-- Todo en UNIDAD BASE del artículo (coherente con el resto del módulo).

create table if not exists public.stock_level (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  recipe_item_id  uuid not null references public.recipe_item(id) on delete cascade,
  min_qty         numeric,            -- mínimo (base). null = sin definir
  par_qty         numeric,            -- objetivo / máximo (base)
  reorder_point   numeric,            -- MRP II (null = inactivo)
  lead_time_days  integer,            -- MRP II
  safety_qty      numeric,            -- MRP II
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  created_at      timestamptz not null default now(),
  unique (account_id, location_id, recipe_item_id)
);

create index if not exists idx_stock_level_loc on public.stock_level (account_id, location_id);

alter table public.stock_level enable row level security;

drop policy if exists stock_level_read on public.stock_level;
create policy stock_level_read on public.stock_level
  for select to authenticated
  using (account_id = any (current_user_account_ids()));

drop policy if exists stock_level_write on public.stock_level;
create policy stock_level_write on public.stock_level
  for all to authenticated
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- Lectura: niveles + stock actual + estado, por local. Para la pantalla del ②
-- y para sembrar el "To Par" del order builder. Incluye artículos CON nivel y,
-- opcionalmente, los que tienen stock pero aún no tienen nivel (para definirlos).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.stock_levels_overview(
  p_account uuid,
  p_location uuid,
  p_only_with_level boolean default false
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with base as (
  select ri.id as recipe_item_id, ri.name as item_name, ri.family_id,
         rf.name as family_name, ku.abbreviation as unit_abbr,
         coalesce(rls.qty_on_hand, 0) as qty_on_hand,
         coalesce(rls.avg_unit_cost, ri.computed_cost, 0) as unit_cost,
         sl.min_qty, sl.par_qty, sl.reorder_point, sl.lead_time_days, sl.safety_qty,
         (sl.id is not null) as has_level
  from recipe_item ri
  left join recipe_family rf on rf.id = ri.family_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  left join recipe_item_location_stock rls
         on rls.recipe_item_id = ri.id and rls.location_id = p_location and rls.account_id = p_account
  left join stock_level sl
         on sl.recipe_item_id = ri.id and sl.location_id = p_location and sl.account_id = p_account
  where ri.account_id = p_account
    and ri.type = 'raw'
    and coalesce(ri.is_active, true) = true
)
select jsonb_build_object(
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'recipe_item_id', b.recipe_item_id,
      'item_name', b.item_name,
      'family_id', b.family_id,
      'family_name', b.family_name,
      'unit_abbr', b.unit_abbr,
      'qty_on_hand', b.qty_on_hand,
      'unit_cost', b.unit_cost,
      'min_qty', b.min_qty,
      'par_qty', b.par_qty,
      'reorder_point', b.reorder_point,
      'lead_time_days', b.lead_time_days,
      'safety_qty', b.safety_qty,
      'has_level', b.has_level,
      'below_min', (b.min_qty is not null and b.qty_on_hand < b.min_qty),
      'to_par_qty', (case when b.par_qty is not null and b.par_qty > b.qty_on_hand then b.par_qty - b.qty_on_hand else 0 end)
    ) order by
      (case when b.min_qty is not null and b.qty_on_hand < b.min_qty then 0 else 1 end),
      b.item_name)
    from base b
    where (not p_only_with_level or b.has_level)
  ), '[]'::jsonb)
);
$$;

grant execute on function public.stock_levels_overview(uuid, uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Escritura: define/actualiza el nivel de un artículo (upsert). min/par y, si se
-- envían, los campos MRP II. SECURITY DEFINER con guard (worker no toca niveles).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_stock_level(
  p_account uuid,
  p_location uuid,
  p_recipe_item uuid,
  p_min numeric default null,
  p_par numeric default null,
  p_reorder numeric default null,
  p_lead_time integer default null,
  p_safety numeric default null,
  p_user_id uuid default null,
  p_user_name text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not current_user_is_admin_or_manager_of(p_account) then
    raise exception 'set_stock_level: sin permiso sobre la cuenta %', p_account;
  end if;
  insert into public.stock_level(
    account_id, location_id, recipe_item_id,
    min_qty, par_qty, reorder_point, lead_time_days, safety_qty,
    updated_at, updated_by, updated_by_name
  ) values (
    p_account, p_location, p_recipe_item,
    p_min, p_par, p_reorder, p_lead_time, p_safety,
    now(), p_user_id, p_user_name
  )
  on conflict (account_id, location_id, recipe_item_id) do update set
    min_qty = excluded.min_qty,
    par_qty = excluded.par_qty,
    reorder_point = excluded.reorder_point,
    lead_time_days = excluded.lead_time_days,
    safety_qty = excluded.safety_qty,
    updated_at = now(),
    updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name;
end;
$function$;

grant execute on function public.set_stock_level(uuid, uuid, uuid, numeric, numeric, numeric, integer, numeric, uuid, text) to authenticated;
