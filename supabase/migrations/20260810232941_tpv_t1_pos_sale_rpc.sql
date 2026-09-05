create table if not exists public.pos_ticket_counter (
  account_id     uuid not null references public.accounts(id),
  location_id    uuid not null references public.locations(id),
  business_date  date not null,
  last_number    integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (account_id, location_id, business_date)
);

alter table public.pos_ticket_counter enable row level security;
revoke all on public.pos_ticket_counter from public, anon, authenticated;

create or replace function public._pos_next_ticket_code(p_account_id uuid, p_location_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tz          text;
  v_cutoff      interval := make_interval(hours => 4);
  v_business_date date;
  v_seq         integer;
begin
  select coalesce(a.timezone, 'Europe/Madrid') into v_tz from accounts a where a.id = p_account_id;
  v_business_date := (date_trunc('day', (now() at time zone v_tz) - v_cutoff))::date;

  insert into pos_ticket_counter (account_id, location_id, business_date, last_number)
  values (p_account_id, p_location_id, v_business_date, 1)
  on conflict (account_id, location_id, business_date)
  do update set last_number = pos_ticket_counter.last_number + 1, updated_at = now()
  returning last_number into v_seq;

  return 'T' || lpad(v_seq::text, 3, '0');
end;
$$;

revoke all on function public._pos_next_ticket_code(uuid, uuid) from public, anon;
grant execute on function public._pos_next_ticket_code(uuid, uuid) to authenticated;

create or replace function public._pos_can_operate(p_account_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    public.current_user_is_admin()
    or public.current_user_is_admin_or_manager_of(p_account_id)
    or exists (
      select 1
      from public.user_profiles up
      join public.employees e on e.id = up.employee_id
      where up.user_id = auth.uid()
        and up.account_id = p_account_id
        and up.active = true
        and (
          e.location_id = p_location_id
          or p_location_id = any(coalesce(e.assigned_locations, '{}'::uuid[]))
          or coalesce(array_length(e.assigned_locations, 1), 0) = 0
        )
    );
$$;

revoke all on function public._pos_can_operate(uuid, uuid) from public, anon;
grant execute on function public._pos_can_operate(uuid, uuid) to authenticated;

create or replace function public._pos_channel_id(p_account_id uuid, p_kind text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug text;
  v_name text;
  v_type text;
  v_id   uuid;
begin
  if p_kind = 'takeaway' then
    v_slug := 'tpv-para-llevar'; v_name := 'Para llevar'; v_type := 'takeaway';
  else
    v_slug := 'tpv-mostrador';   v_name := 'Mostrador';    v_type := 'dine_in';
  end if;

  select id into v_id from sales_channel where account_id = p_account_id and slug = v_slug;
  if v_id is not null then return v_id; end if;

  insert into sales_channel (account_id, name, slug, channel_type, is_active)
  values (p_account_id, v_name, v_slug, v_type, true)
  on conflict (account_id, slug) do update set name = excluded.name
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public._pos_channel_id(uuid, text) from public, anon;
grant execute on function public._pos_channel_id(uuid, text) to authenticated;

create or replace function public.pos_item_config(p_account_id uuid, p_location_id uuid, p_menu_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_item  record;
  v_slots jsonb;
begin
  if not public._pos_can_operate(p_account_id, p_location_id) then
    raise exception 'pos_item_config: sin acceso a esta cuenta/local';
  end if;

  select mi.id, mi.name, mi.description, mi.photo_url, mi.price, mi.product_type, mi.recipe_item_id, mi.brand_id
    into v_item
  from menu_item mi
  join brand_location_availability bla
    on bla.brand_id = mi.brand_id and bla.location_id = p_location_id and bla.is_active
  where mi.id = p_menu_item_id and mi.account_id = p_account_id
    and mi.is_active is not false and mi.is_available is not false and mi.archived_at is null;

  if v_item.id is null then return null; end if;

  if v_item.product_type = 'combo' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', cs.id,
             'name', cs.name,
             'min', cs.min_selections,
             'max', cs.max_selections,
             'options', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'menu_item_id', omi.id,
                        'name', omi.name,
                        'photo_url', omi.photo_url,
                        'price_impact', cso.price_impact,
                        'is_default', cso.is_default,
                        'allergens', _allergens_of_recipe(omi.recipe_item_id),
                        'modifier_groups', _modgroups_of_item(omi.id)
                      ) order by cso.position nulls last, omi.name), '[]'::jsonb)
               from combo_slot_option cso
               join menu_item omi on omi.id = cso.menu_item_id
               where cso.combo_slot_id = cs.id and cso.is_active and omi.is_active is not false
             )
           ) order by cs.position nulls last), '[]'::jsonb)
    into v_slots
    from combo_slot cs
    where cs.combo_item_id = v_item.id and cs.is_active;
  else
    v_slots := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_item.id,
    'name', v_item.name,
    'description', v_item.description,
    'photo_url', v_item.photo_url,
    'price', v_item.price,
    'product_type', v_item.product_type,
    'allergens', _allergens_of_recipe(v_item.recipe_item_id),
    'modifier_groups', _modgroups_of_item(v_item.id),
    'slots', v_slots
  );
end;
$$;

revoke all on function public.pos_item_config(uuid, uuid, uuid) from public, anon;
grant execute on function public.pos_item_config(uuid, uuid, uuid) to authenticated;