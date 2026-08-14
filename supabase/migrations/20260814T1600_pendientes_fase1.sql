-- ENCARGO CODE (14/08) Pantalla de PENDIENTES, Fase 1 (Almacén y Recepción).
-- Tramo A: tabla de descartes + RPC única pending_board() + RPC de acción
-- dismiss_pending(). El alcance por rol/local se aplica DENTRO de la RPC
-- (nunca en el cliente) — si se aplicara fuera, bastaría llamar con otro
-- location_id para ver los pendientes de un local ajeno.

-- ─────────────────────────────────────────────────────────────────────
-- A.3 · pending_dismissal
-- ─────────────────────────────────────────────────────────────────────
create table public.pending_dismissal (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  location_id uuid references public.locations(id),
  pending_kind text not null,
  entity_id uuid,                 -- null = descarta el tipo entero en ese local
  action text not null check (action in ('posponer','descartar')),
  until timestamptz,              -- obligatorio en 'posponer', null en 'descartar'
  reason text,                    -- obligatorio en 'descartar', null en 'posponer'
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint pending_dismissal_posponer_requires_until check (action <> 'posponer' or until is not null),
  constraint pending_dismissal_descartar_requires_reason check (action <> 'descartar' or reason is not null)
);

create index pending_dismissal_lookup_idx on public.pending_dismissal (account_id, pending_kind, location_id, entity_id);

alter table public.pending_dismissal enable row level security;

create policy pending_dismissal_select on public.pending_dismissal
  for select using (public.belongs_to_account(account_id));

create policy pending_dismissal_insert on public.pending_dismissal
  for insert with check (public.belongs_to_account(account_id));

-- ─────────────────────────────────────────────────────────────────────
-- Helper interno: las entidades RAW que hoy matchean cada pending_kind,
-- sin aplicar alcance ni permiso (lo aplican los callers). Compartido por
-- pending_board (contar) y dismiss_pending (fotografiar al posponer) para
-- que las dos nunca puedan desincronizarse — la misma definición de "qué
-- es un pendiente de este tipo" vive en un solo sitio.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.pending_raw_entities(p_account_id uuid)
returns table(pending_kind text, entity_id uuid, location_id uuid, entity_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select 'recepcion_esperando_oficina', gr.id, gr.location_id, gr.received_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'recibido'

  union all
  select 'albaran_genero_sin_casar', gr.id, gr.location_id, gr.received_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'confirmado' and gr.needs_review

  union all
  select 'pedido_vencido', po.id, po.location_id, po.expected_date::timestamptz
  from purchase_order po
  where po.account_id = p_account_id and po.status = 'enviado' and po.expected_date < current_date

  union all
  select 'albaran_borrador_atascado', gr.id, gr.location_id, gr.created_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'borrador' and gr.created_at < now() - interval '2 days'

  union all
  select 'pedido_borrador_atascado', po.id, po.location_id, po.created_at
  from purchase_order po
  where po.account_id = p_account_id and po.status = 'borrador' and po.created_at < now() - interval '7 days'

  union all
  select 'recuento_abierto', ic.id, ic.location_id, ic.created_at
  from inventory_count ic
  where ic.account_id = p_account_id and ic.closed_at is null and ic.status <> 'anulado'

  union all
  select 'recuento_sin_aprobar', ic.id, ic.location_id, ic.closed_at
  from inventory_count ic
  where ic.account_id = p_account_id and ic.closed_at is not null and ic.approved_at is null and ic.status <> 'anulado'

  union all
  select 'linea_sin_coste', sm.id, sm.location_id, sm.created_at
  from stock_movement sm
  where sm.account_id = p_account_id and sm.source_type = 'goods_receipt_line' and sm.unit_cost is null
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A.1 · pending_board(p_account_id) — una llamada, una respuesta.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.pending_board(p_account_id uuid)
returns table(
  pending_kind   text,
  layer          text,
  area           text,
  location_id    uuid,
  location_name  text,
  items          integer,
  detail         jsonb,
  sort_weight    integer
)
language plpgsql
-- volatile (default), no "stable": SET LOCAL statement_timeout no está
-- permitido dentro de una función marcada stable. Solo lectura igualmente;
-- la guarda de tiempo pesa más que el hint al planner.
security definer
set search_path to 'public'
as $$
declare
  v_user_profile_id uuid;
  v_user_role text;
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'pending_board: cuenta % no pertenece al usuario', p_account_id;
  end if;

  set local statement_timeout = '3s';

  select up.id, up.role into v_user_profile_id, v_user_role
  from public.user_profiles up
  where up.user_id = auth.uid() and up.account_id = p_account_id and up.active = true
  limit 1;

  -- Sin perfil activo en esta cuenta: cero filas, no error (mismo criterio
  -- que un Responsable de local sin manager_locations, ver más abajo).
  if v_user_profile_id is null then
    return;
  end if;

  return query
  with scoped_locations as (
    select l.id, l.name
    from public.locations l
    where l.account_id = p_account_id and l.active = true
      and (
        v_user_role = 'admin'
        or exists (
          select 1 from public.manager_locations ml
          where ml.user_profile_id = v_user_profile_id and ml.location_id = l.id
        )
      )
  ),
  dismissed as (
    select d.pending_kind, d.location_id, d.entity_id
    from public.pending_dismissal d
    where d.account_id = p_account_id
      and (
        (d.action = 'posponer' and d.until > now())
        or (d.action = 'descartar' and d.entity_id is null)
      )
  ),
  raw as (
    select r.pending_kind, r.entity_id, r.location_id, r.entity_at
    from public.pending_raw_entities(p_account_id) r
    join scoped_locations sl on sl.id = r.location_id
    where not exists (
      select 1 from dismissed d
      where d.pending_kind = r.pending_kind
        and d.location_id = r.location_id
        and (d.entity_id = r.entity_id or d.entity_id is null)
    )
  ),
  counted as (
    select r.pending_kind, r.location_id, count(*)::integer as items, min(r.entity_at) as oldest_at
    from raw r
    group by r.pending_kind, r.location_id
  ),
  kinds as (
    select * from (values
      ('recepcion_esperando_oficina', 'ahora',  'almacen', 'show_recepcion',   10),
      ('albaran_genero_sin_casar',    'ahora',  'almacen', 'show_recepcion',   20),
      ('pedido_vencido',              'ahora',  'almacen', 'show_pedidos',     30),
      ('albaran_borrador_atascado',   'semana', 'almacen', 'show_recepcion',   40),
      ('pedido_borrador_atascado',    'semana', 'almacen', 'show_pedidos',     50),
      ('recuento_abierto',            'semana', 'almacen', 'show_inventarios', 60),
      ('recuento_sin_aprobar',        'semana', 'almacen', 'show_inventarios', 70),
      ('linea_sin_coste',             'semana', 'almacen', 'show_costes',      80)
    ) as k(pending_kind, layer, area, perm_key, sort_weight)
  )
  select
    c.pending_kind, k.layer, k.area, c.location_id, sl.name,
    c.items, jsonb_build_object('oldest_at', c.oldest_at), k.sort_weight
  from counted c
  join kinds k on k.pending_kind = c.pending_kind
  join scoped_locations sl on sl.id = c.location_id
  where public.has_permission(p_account_id, k.perm_key)

  union all

  select
    'stock_negativo', 'salud', 'almacen', sl.id, sl.name,
    count(*)::integer, jsonb_build_object(), 90
  from public.recipe_item_location_stock rils
  join scoped_locations sl on sl.id = rils.location_id
  where rils.account_id = p_account_id and rils.qty_on_hand < 0
    and public.has_permission(p_account_id, 'show_inventory')
  group by sl.id, sl.name;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Acción: posponer/descartar. "Posponer" fotografía las entidades que HOY
-- matchean ese pending_kind+location (pending_raw_entities) y les pone
-- until — si entra una entidad NUEVA mientras tanto (no está en la foto),
-- no tiene fila de descarte y aparece de inmediato: así "si el número sube,
-- reaparece hoy" sin guardar un contador aparte. "Descartar" es siempre a
-- nivel de tipo (entity_id null) — es la causa la que se entierra, no un caso.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.dismiss_pending(
  p_account_id uuid,
  p_pending_kind text,
  p_location_id uuid,
  p_action text,
  p_preset text default null,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_profile_id uuid;
  v_user_id uuid;
  v_user_name text;
  v_until timestamptz;
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'dismiss_pending: cuenta % no pertenece al usuario', p_account_id;
  end if;

  if p_action not in ('posponer', 'descartar') then
    raise exception 'dismiss_pending: action invalida %', p_action;
  end if;

  select up.id, up.user_id, up.display_name into v_user_profile_id, v_user_id, v_user_name
  from public.user_profiles up
  where up.user_id = auth.uid() and up.account_id = p_account_id and up.active = true
  limit 1;

  if v_user_profile_id is null then
    raise exception 'dismiss_pending: sin perfil activo en esta cuenta';
  end if;

  if p_action = 'posponer' then
    if p_preset not in ('manana', 'semana', 'mes') then
      raise exception 'dismiss_pending: preset invalido para posponer';
    end if;
    v_until := case p_preset
      when 'manana' then (current_date + 1)::timestamptz
      when 'semana' then (current_date + 7)::timestamptz
      else (current_date + interval '1 month')::timestamptz
    end;

    insert into public.pending_dismissal (account_id, location_id, pending_kind, entity_id, action, until, created_by, created_by_name)
    select p_account_id, p_location_id, p_pending_kind, r.entity_id, 'posponer', v_until, v_user_id, v_user_name
    from public.pending_raw_entities(p_account_id) r
    where r.pending_kind = p_pending_kind and r.location_id = p_location_id;

  else
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'dismiss_pending: descartar exige motivo';
    end if;
    insert into public.pending_dismissal (account_id, location_id, pending_kind, entity_id, action, reason, created_by, created_by_name)
    values (p_account_id, p_location_id, p_pending_kind, null, 'descartar', p_reason, v_user_id, v_user_name);
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.pending_dismissal') is null then
    raise exception 'pendientes fase1: falta la tabla pending_dismissal';
  end if;
  if to_regprocedure('public.pending_board(uuid)') is null then
    raise exception 'pendientes fase1: falta la funcion pending_board';
  end if;
  if to_regprocedure('public.dismiss_pending(uuid,text,uuid,text,text,text)') is null then
    raise exception 'pendientes fase1: falta la funcion dismiss_pending';
  end if;
end $$;
