-- TPV · Sala · S1 — mesas, comensales y envíos a cocina.
--
-- ENCARGO: «TPV · Sala (mesas, comensales, envíos a cocina)», 08/10/2026.
--
-- ⚠️ FUERA DE BANDA. Se aplica entre las 00:30 y las 12:15 (reloj de la base,
--    Europe/Madrid). Toma ACCESS EXCLUSIVE sobre `sale` y `sale_line` (columnas
--    nuevas + CHECK de service_type) y reescribe `order_for_print` y
--    `tg_auto_print_on_accept`, que están en el camino de CADA pedido.
--    La guarda de abajo aborta si se intenta dentro de la banda.
--
-- QUÉ HACE
--   Datos
--     · dining_zone          zonas del local (sala / terraza / barra / reservado)
--     · dining_table         mesas (zona, nombre, sitios, sitio en la rejilla)
--     · dining_config        por local: umbral ámbar del tiempo de mesa
--     · sale_fire            un «Enviar a cocina» = una fila, numerada por cuenta
--     · void_reason          motivos de anulación, configurables por cuenta
--     · sale_line_void       la anulación de una línea ya enviada (la línea sigue)
--     · sale  + table_id, covers, served_by, served_by_name,
--               bill_requested_at, table_cleared_at
--     · sale_line + fire_id (NULL = aún no enviada), voided_at
--     · sale.service_type admite 'dine_in'
--   Funciones (todas por cuenta y local, guarda _pos_can_operate)
--     · pos_floor              la sala: zonas, mesas y su estado CALCULADO
--     · pos_table_open         abre la mesa con N comensales (obligatorio)
--     · pos_table_detail       cabecera + envíos + líneas de una mesa
--     · pos_table_add_lines    AÑADE líneas sin enviar (nunca reconstruye)
--     · pos_table_set_pending_qty / pos_table_remove_pending_line
--                              tocar lo que AÚN no se ha enviado
--     · pos_table_fire         crea el envío con lo pendiente e imprime SOLO eso
--     · pos_table_void_line    anula una línea enviada: motivo + «ANULADO» en cocina
--     · pos_table_request_bill «Sacar la cuenta»: imprime y la mesa pide la cuenta
--     · pos_table_charge       cobra (efectivo / tarjeta)
--     · pos_table_clear        «Mesa lista»: la mesa queda libre
--     · pos_void_reasons       motivos de la cuenta (siembra 4 si no hay ninguno)
--   Cambios en lo que ya existe (sustitución quirúrgica sobre la definición
--   VIVA, con guarda de «el fragmento aparece exactamente una vez»)
--     · order_for_print   + p_fire_id (DROP + CREATE, regla 2; permisos
--                         restaurados y comprobados): con envío devuelve SOLO sus
--                         líneas; nunca devuelve líneas anuladas; añade mesa,
--                         zona, comensales y envío al pedido.
--     · tg_auto_print_on_accept  no imprime el pedido entero de una MESA: la mesa
--                         imprime por envíos (pos_table_fire).
--     · upsert_pos_sale   rechaza una cuenta de mesa: su borrar-y-reinsertar
--                         destruiría la identidad de las líneas enviadas.
--     · pos_open_sales    no lista cuentas de mesa (viven en Sala).
--   La venta rápida de /tpv (Mostrador, Para llevar) no cambia: sus ventas no
--   tienen table_id y ninguna de las tres ramas nuevas se activa para ellas.
--
-- DECISIONES QUE CONVIENE LEER ANTES DE APLICAR
--   · El estado de la mesa NO se guarda: se calcula en pos_floor.
--   · «Cobrada» se lee de paid_at, no de status: la pantalla de cocina puede
--     cerrar la venta (close_sale al pasar a 'completed') antes de cobrar.
--   · Anular una línea enviada pone su importe a 0 (y el de sus hijas) y guarda
--     el original en sale_line_void. NO devuelve el stock: el plato puede estar
--     ya hecho. Si Julio decide lo contrario, es un cambio en
--     generate_sale_consumption y va en su propio tramo (regla 10).
--   · La impresión de un envío va con payload {mode:'by_order', sale_id,
--     fire_id}. Una tablet con el paquete VIEJO ignora fire_id e imprime la cuenta
--     entera: imprime de más, nunca deja de imprimir. Hasta que las tablets
--     tengan el paquete nuevo, eso es lo que verá cocina.
--   · El «ANULADO» va como documento ya compuesto (TicketDoc), que el worker
--     imprime tal cual en cualquier versión de paquete.

-- ══ 0. La banda ═════════════════════════════════════════════════════════
do $$
declare v_h time := (now() at time zone 'Europe/Madrid')::time;
begin
  if v_h >= time '12:15' or v_h < time '00:30' then
    raise exception 'tpv_sala_s1: son las % en Madrid — dentro de la banda de servicio (12:15–00:30). Esperar.', v_h;
  end if;
end $$;

-- ══ 1. Tablas nuevas ════════════════════════════════════════════════════

create table if not exists public.dining_zone (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  kind        text not null default 'sala'
              check (kind in ('sala', 'terraza', 'barra', 'reservado')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists dining_zone_location_name_uq
  on public.dining_zone (location_id, lower(btrim(name))) where is_active;
create index if not exists dining_zone_location_idx on public.dining_zone (location_id, sort_order);

create table if not exists public.dining_table (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  zone_id     uuid not null references public.dining_zone(id) on delete restrict,
  name        text not null check (btrim(name) <> ''),
  seats       integer not null default 4 check (seats between 1 and 99),
  -- Rejilla ordenada, no plano dibujado: posición = orden; ancho = cuántas
  -- columnas ocupa (una mesa larga de 8 ocupa 2).
  sort_order  integer not null default 0,
  grid_width  integer not null default 1 check (grid_width between 1 and 4),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- El nombre de una mesa es único en el LOCAL, no en la zona: «la 4» tiene que
-- ser una sola cuando un camarero la nombra.
create unique index if not exists dining_table_location_name_uq
  on public.dining_table (location_id, lower(btrim(name))) where is_active;
create index if not exists dining_table_zone_idx on public.dining_table (zone_id, sort_order);

create table if not exists public.dining_config (
  location_id        uuid primary key references public.locations(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  -- A partir de cuántos minutos abierta el tiempo de la mesa pasa a ámbar.
  table_warn_minutes integer not null default 90 check (table_warn_minutes between 5 and 600),
  updated_at         timestamptz not null default now()
);

create table if not exists public.sale_fire (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  location_id   uuid not null references public.locations(id),
  sale_id       uuid not null references public.sale(id) on delete cascade,
  fire_number   integer not null check (fire_number >= 1),
  fired_at      timestamptz not null default now(),
  fired_by      uuid,
  fired_by_name text,
  device_id     uuid references public.kds_device(id) on delete set null,
  unique (sale_id, fire_number)
);
create index if not exists sale_fire_sale_idx on public.sale_fire (sale_id);

create table if not exists public.void_reason (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  label      text not null check (btrim(label) <> ''),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists void_reason_account_label_uq
  on public.void_reason (account_id, lower(btrim(label))) where is_active;

create table if not exists public.sale_line_void (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  sale_id             uuid not null references public.sale(id) on delete cascade,
  sale_line_id        uuid not null unique references public.sale_line(id) on delete cascade,
  reason_id           uuid references public.void_reason(id) on delete set null,
  reason_label        text not null,            -- copia: el motivo puede renombrarse luego
  note                text,
  original_quantity   numeric not null,
  original_line_total numeric not null,         -- el padre + sus hijas, antes de anular
  voided_at           timestamptz not null default now(),
  voided_by           uuid,
  voided_by_name      text,
  device_id           uuid references public.kds_device(id) on delete set null
);
create index if not exists sale_line_void_sale_idx on public.sale_line_void (sale_id);

-- ══ 2. Columnas en sale / sale_line (ACCESS EXCLUSIVE: por eso fuera de banda) ══

alter table public.sale
  add column if not exists table_id          uuid references public.dining_table(id) on delete set null,
  add column if not exists covers            integer check (covers is null or covers between 1 and 999),
  add column if not exists served_by         uuid,
  add column if not exists served_by_name    text,
  add column if not exists bill_requested_at timestamptz,
  add column if not exists table_cleared_at  timestamptz;

alter table public.sale drop constraint if exists sale_service_type_check;
alter table public.sale add constraint sale_service_type_check
  check (service_type is null or service_type = any (array['platform_delivery', 'own_delivery', 'pickup', 'dine_in']));

-- Comensales obligatorios en una cuenta de mesa (no se rellenan hacia atrás:
-- solo afecta a filas con table_id, que hoy no existe ninguna).
alter table public.sale drop constraint if exists sale_table_needs_covers;
alter table public.sale add constraint sale_table_needs_covers
  check (table_id is null or covers is not null);

-- Una mesa, una cuenta viva. «Viva» = no cancelada y sin recoger.
create unique index if not exists sale_one_live_per_table_uq
  on public.sale (table_id)
  where table_id is not null and table_cleared_at is null and status <> 'cancelled';

alter table public.sale_line
  add column if not exists fire_id   uuid references public.sale_fire(id) on delete restrict,
  add column if not exists voided_at timestamptz;
create index if not exists sale_line_fire_idx on public.sale_line (fire_id) where fire_id is not null;

-- ══ 3. RLS ═══════════════════════════════════════════════════════════════
-- Lectura: cualquiera de la cuenta. Escritura de configuración (zonas, mesas,
-- umbral, motivos): admin o encargado. Los envíos y anulaciones solo se
-- escriben por las funciones (SECURITY DEFINER): ninguna política de escritura.

alter table public.dining_zone    enable row level security;
alter table public.dining_table   enable row level security;
alter table public.dining_config  enable row level security;
alter table public.sale_fire      enable row level security;
alter table public.void_reason    enable row level security;
alter table public.sale_line_void enable row level security;

drop policy if exists dining_zone_select on public.dining_zone;
create policy dining_zone_select on public.dining_zone for select using (belongs_to_account(account_id));
drop policy if exists dining_zone_write on public.dining_zone;
create policy dining_zone_write on public.dining_zone for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists dining_table_select on public.dining_table;
create policy dining_table_select on public.dining_table for select using (belongs_to_account(account_id));
drop policy if exists dining_table_write on public.dining_table;
create policy dining_table_write on public.dining_table for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists dining_config_select on public.dining_config;
create policy dining_config_select on public.dining_config for select using (belongs_to_account(account_id));
drop policy if exists dining_config_write on public.dining_config;
create policy dining_config_write on public.dining_config for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists void_reason_select on public.void_reason;
create policy void_reason_select on public.void_reason for select using (belongs_to_account(account_id));
drop policy if exists void_reason_write on public.void_reason;
create policy void_reason_write on public.void_reason for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists sale_fire_select on public.sale_fire;
create policy sale_fire_select on public.sale_fire for select using (belongs_to_account(account_id));
drop policy if exists sale_line_void_select on public.sale_line_void;
create policy sale_line_void_select on public.sale_line_void for select using (belongs_to_account(account_id));

-- La guarda de mesas: la zona y la mesa son del mismo local y cuenta.
create or replace function public.tg_dining_table_same_location()
returns trigger language plpgsql set search_path = public as $$
declare v_z dining_zone;
begin
  select * into v_z from dining_zone where id = new.zone_id;
  if v_z.id is null or v_z.location_id <> new.location_id or v_z.account_id <> new.account_id then
    raise exception 'La zona no es de este local.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_dining_table_same_location on public.dining_table;
create trigger trg_dining_table_same_location before insert or update on public.dining_table
  for each row execute function public.tg_dining_table_same_location();

drop trigger if exists set_dining_zone_updated_at on public.dining_zone;
create trigger set_dining_zone_updated_at before update on public.dining_zone
  for each row execute function public.set_updated_at();

-- ══ 4. Ayudantes internos ═══════════════════════════════════════════════

-- Canal propio de la sala, hermano de _pos_channel_id (que no se toca: es el
-- camino de la venta rápida). Mismo patrón: se crea la primera vez.
create or replace function public._pos_sala_channel_id(p_account_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from sales_channel where account_id = p_account_id and slug = 'tpv-sala';
  if v_id is not null then return v_id; end if;
  insert into sales_channel (account_id, name, slug, channel_type, is_active)
  values (p_account_id, 'Sala', 'tpv-sala', 'dine_in', true)
  on conflict (account_id, slug) do update set name = excluded.name
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public._pos_sala_channel_id(uuid) from public, anon;

-- Una cuenta de mesa por id, con la guarda de cuenta/local. Lanza si no.
create or replace function public._pos_table_sale(p_sale_id uuid)
returns sale language plpgsql stable security definer set search_path = public as $$
declare v_s sale;
begin
  select * into v_s from sale where id = p_sale_id;
  if v_s.id is null or v_s.table_id is null then
    raise exception 'Esta cuenta no es de una mesa.';
  end if;
  if not public._pos_can_operate(v_s.account_id, v_s.location_id) then
    raise exception 'Sin acceso a esta cuenta/local.';
  end if;
  return v_s;
end $$;
revoke all on function public._pos_table_sale(uuid) from public, anon;

create or replace function public._pos_actor_name(p_account_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select display_name from user_profiles where user_id = auth.uid() and account_id = p_account_id limit 1
$$;
revoke all on function public._pos_actor_name(uuid) from public, anon;

create or replace function public._pos_device_for(p_token text, p_account_id uuid, p_location_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_d kds_device;
begin
  if p_token is null then return null; end if;
  v_d := public.kds_resolve_device(p_token);
  if v_d.id is not null and v_d.account_id = p_account_id and v_d.location_id = p_location_id then
    return v_d.id;
  end if;
  return null;
end $$;
revoke all on function public._pos_device_for(text, uuid, uuid) from public, anon;

-- Inserta UNA línea del TPV (con sus modificadores y componentes de combo) en
-- una venta. Es el cuerpo del bucle de _adapt_folvy_pos_order, copiado y no
-- compartido a propósito: aquel es el camino de la venta rápida y no se toca.
-- Diferencias: no borra nada antes, y devuelve el id del padre.
create or replace function public._pos_insert_order_line(p_sale_id uuid, p_line jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_mi menu_item%rowtype; v_comp_mi menu_item%rowtype; v_repr jsonb; v_qty numeric;
  v_parent uuid; v_comp uuid; v_m jsonb; v_c jsonb; v_opt record; v_pt text;
begin
  select account_id into v_acc from sale where id = p_sale_id;
  v_repr := public._shop_reprice_line(v_acc, p_line);
  v_qty  := coalesce((p_line->>'quantity')::numeric, 1);
  v_pt   := coalesce(p_line->>'productType', 'item');

  select * into v_mi from menu_item where id = (p_line->>'menuItemId')::uuid and account_id = v_acc;
  if not found then v_mi := null; end if;

  insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                         quantity, unit_price, line_total, menu_item_id, kitchen_note,
                         map_source, map_needs_review, unmapped_reason,
                         external_source, external_product_id, external_brand_id)
  values (v_acc, p_sale_id,
          coalesce(v_mi.name, v_repr->>'name'), coalesce(v_mi.name, v_repr->>'name'),
          'product', v_qty, (v_repr->>'unitPrice')::numeric, (v_repr->>'lineTotal')::numeric,
          v_mi.id, nullif(btrim(p_line->>'kitchenNote'), ''),
          case when v_mi.id is not null then 'pos' else 'unmapped' end,
          (v_mi.id is null), case when v_mi.id is null then 'no_menu_item' else null end,
          'folvy_pos', (p_line->>'menuItemId'), v_mi.brand_id::text)
  returning id into v_parent;

  if jsonb_typeof(p_line->'modifiers') = 'array' then
    for v_m in select * from jsonb_array_elements(p_line->'modifiers') loop
      select mo.id, mo.name, mo.price_impact into v_opt
      from modifier_option mo
      join modifier_group mg on mg.id = mo.modifier_group_id
      join modifier_group_assignment mga on mga.modifier_group_id = mg.id
      where mo.id = (v_m->>'optionId')::uuid and mga.menu_item_id = v_mi.id and mo.is_active and mg.is_active
      limit 1;
      if not found then v_opt := null; end if;
      insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                             quantity, unit_price, line_total, modifier_option_id,
                             map_source, map_needs_review, parent_sale_line_id,
                             external_source, external_product_id, external_brand_id)
      values (v_acc, p_sale_id, coalesce(v_opt.name, 'modificador'), coalesce(v_opt.name, 'modificador'),
              'modifier', coalesce((v_m->>'qty')::numeric, 1), coalesce(v_opt.price_impact, 0),
              coalesce(v_opt.price_impact, 0) * coalesce((v_m->>'qty')::numeric, 1), v_opt.id,
              case when v_opt.id is not null then 'pos' else 'unmapped' end, (v_opt.id is null), v_parent,
              'folvy_pos', (v_m->>'optionId'), v_mi.brand_id::text);
    end loop;
  end if;

  if v_pt = 'combo' and jsonb_typeof(p_line->'combo') = 'array' then
    for v_c in select * from jsonb_array_elements(p_line->'combo') loop
      select * into v_comp_mi from menu_item where id = (v_c->>'menuItemId')::uuid and account_id = v_acc;
      if not found then v_comp_mi := null; end if;
      insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                             quantity, unit_price, line_total, menu_item_id,
                             map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                             external_source, external_product_id, external_brand_id)
      values (v_acc, p_sale_id, coalesce(v_comp_mi.name, 'combo_item'), coalesce(v_comp_mi.name, 'combo_item'),
              'combo_item', 1, 0, 0, v_comp_mi.id,
              case when v_comp_mi.id is not null then 'pos' else 'unmapped' end, (v_comp_mi.id is null),
              case when v_comp_mi.id is null then 'no_menu_item' else null end, v_parent,
              'folvy_pos', (v_c->>'menuItemId'), v_comp_mi.brand_id::text)
      returning id into v_comp;

      if jsonb_typeof(v_c->'modifiers') = 'array' then
        for v_m in select * from jsonb_array_elements(v_c->'modifiers') loop
          select mo.id, mo.name, mo.price_impact into v_opt
          from modifier_option mo
          join modifier_group mg on mg.id = mo.modifier_group_id
          join modifier_group_assignment mga on mga.modifier_group_id = mg.id
          where mo.id = (v_m->>'optionId')::uuid and mga.menu_item_id = v_comp_mi.id and mo.is_active and mg.is_active
          limit 1;
          if not found then v_opt := null; end if;
          insert into sale_line (account_id, sale_id, product_name, raw_text, line_type,
                                 quantity, unit_price, line_total, modifier_option_id,
                                 map_source, map_needs_review, parent_sale_line_id,
                                 external_source, external_product_id, external_brand_id)
          values (v_acc, p_sale_id, coalesce(v_opt.name, 'modificador'), coalesce(v_opt.name, 'modificador'),
                  'modifier', coalesce((v_m->>'qty')::numeric, 1), coalesce(v_opt.price_impact, 0),
                  coalesce(v_opt.price_impact, 0) * coalesce((v_m->>'qty')::numeric, 1), v_opt.id,
                  case when v_opt.id is not null then 'pos' else 'unmapped' end, (v_opt.id is null), v_comp,
                  'folvy_pos', (v_m->>'optionId'), v_comp_mi.brand_id::text);
        end loop;
      end if;
    end loop;
  end if;

  return v_parent;
end $$;
revoke all on function public._pos_insert_order_line(uuid, jsonb) from public, anon;

-- Totales de la cuenta desde sale_line (padres; las anuladas ya valen 0). El
-- IVA por línea con el vat_rate del producto, como upsert_pos_sale.
create or replace function public._pos_table_recalc_totals(p_sale_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_base numeric;
begin
  select coalesce(sum(sl.line_total), 0),
         coalesce(sum(round(sl.line_total / (1 + coalesce(mi.vat_rate, 10) / 100.0), 2)), 0)
    into v_total, v_base
  from sale_line sl
  left join menu_item mi on mi.id = sl.menu_item_id
  where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null;
  update sale set total = round(v_total, 2), taxable_base = round(v_base, 2),
                  tax = round(v_total - v_base, 2), updated_at = now()
  where id = p_sale_id;
end $$;
revoke all on function public._pos_table_recalc_totals(uuid) from public, anon;

-- Encola un documento para las impresoras del local que lo saben imprimir.
-- Devuelve cuántos trabajos ha encolado; si no hay impresora, deja rastro en
-- print_route_failure_log (como tg_auto_print_on_accept) y devuelve 0 para que
-- la pantalla lo DIGA (regla 8).
create or replace function public._pos_enqueue_print(p_sale sale, p_doc text, p_payload jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_p record; v_i int; v_n int := 0;
begin
  for v_p in
    select id, copies from printer
    where account_id = p_sale.account_id and location_id = p_sale.location_id and is_active
      and p_doc = any (doc_types)
  loop
    for v_i in 1..greatest(1, coalesce(v_p.copies, 1)) loop
      insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
      values (p_sale.account_id, p_sale.location_id, v_p.id, p_sale.id, p_doc, p_payload, 'auto', 'pending');
      v_n := v_n + 1;
    end loop;
  end loop;
  if v_n = 0 then
    insert into print_route_failure_log (account_id, location_id, sale_id, doc_type, detail)
    values (p_sale.account_id, p_sale.location_id, p_sale.id, p_doc,
            'TPV sala: sin impresora activa que imprima ' || p_doc || ' en el local');
  end if;
  return v_n;
end $$;
revoke all on function public._pos_enqueue_print(sale, text, jsonb) from public, anon;

-- ══ 5. Las funciones del TPV de sala ════════════════════════════════════

-- Estado CALCULADO de una cuenta de mesa. Solo dice lo que el sistema sabe.
create or replace function public._pos_table_state(p_sale sale)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_sale.id is null then 'libre'
    when p_sale.paid_at is not null then 'cobrada'
    when p_sale.bill_requested_at is not null then 'pide_cuenta'
    when exists (select 1 from sale_fire f where f.sale_id = p_sale.id) then 'en_cocina'
    else 'sin_pedir'
  end
$$;
revoke all on function public._pos_table_state(sale) from public, anon;

create or replace function public.pos_floor(p_account_id uuid, p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._pos_can_operate(p_account_id, p_location_id) then
    raise exception 'pos_floor: sin acceso a esta cuenta/local';
  end if;

  with live as (
    select s.* from sale s
    where s.account_id = p_account_id and s.location_id = p_location_id
      and s.table_id is not null and s.table_cleared_at is null and s.status <> 'cancelled'
  ),
  t as (
    select dt.*, l.id as sale_id,
      case when l.id is null then null else jsonb_build_object(
        'id', l.id,
        'covers', l.covers,
        'openedAt', coalesce(l.opened_at, l.created_at),
        'total', l.total,
        'servedByName', l.served_by_name,
        'state', public._pos_table_state(l),
        'fireCount', (select count(*) from sale_fire f where f.sale_id = l.id),
        'lastFireAt', (select max(f.fired_at) from sale_fire f where f.sale_id = l.id),
        'pendingCount', (select count(*) from sale_line sl where sl.sale_id = l.id
                           and sl.parent_sale_line_id is null and sl.fire_id is null),
        'billRequestedAt', l.bill_requested_at,
        'paidAt', l.paid_at
      ) end as sale_json
    from dining_table dt
    left join live l on l.table_id = dt.id
    where dt.account_id = p_account_id and dt.location_id = p_location_id and dt.is_active
  )
  select jsonb_build_object(
    'warnMinutes', coalesce((select table_warn_minutes from dining_config where location_id = p_location_id), 90),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id, 'name', z.name, 'kind', z.kind, 'sortOrder', z.sort_order,
        'tables', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name, 'seats', t.seats, 'gridWidth', t.grid_width,
            'sortOrder', t.sort_order, 'sale', t.sale_json
          ) order by t.sort_order, t.name) from t where t.zone_id = z.id), '[]'::jsonb)
      ) order by z.sort_order, z.name)
      from dining_zone z
      where z.account_id = p_account_id and z.location_id = p_location_id and z.is_active
    ), '[]'::jsonb)
  ) into v;
  return v;
end $$;
grant execute on function public.pos_floor(uuid, uuid) to authenticated;

create or replace function public.pos_table_open(p_table_id uuid, p_covers integer, p_brand_id uuid, p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t dining_table; v_id uuid; v_actor text;
begin
  select * into v_t from dining_table where id = p_table_id and is_active;
  if v_t.id is null then raise exception 'Esa mesa no existe.'; end if;
  if not public._pos_can_operate(v_t.account_id, v_t.location_id) then
    raise exception 'Sin acceso a esta cuenta/local.';
  end if;
  if p_covers is null or p_covers < 1 then raise exception 'Hay que decir cuántos son.'; end if;
  if exists (select 1 from sale where table_id = p_table_id and table_cleared_at is null and status <> 'cancelled') then
    raise exception 'La mesa % ya está abierta.', v_t.name;
  end if;

  v_actor := public._pos_actor_name(v_t.account_id);
  insert into sale (
    account_id, location_id, brand_id, channel_id, source, service_type,
    status, order_status, sold_at, opened_at, total, taxable_base, tax,
    pos_short_code, created_by, created_by_name, device_id,
    table_id, covers, served_by, served_by_name
  ) values (
    v_t.account_id, v_t.location_id, p_brand_id, public._pos_sala_channel_id(v_t.account_id),
    'folvy_pos', 'dine_in', 'open', null, now(), now(), 0, 0, 0,
    public._pos_next_ticket_code(v_t.account_id, v_t.location_id), auth.uid(), v_actor,
    public._pos_device_for(p_device_token, v_t.account_id, v_t.location_id),
    v_t.id, p_covers, auth.uid(), v_actor
  ) returning id into v_id;

  return jsonb_build_object('saleId', v_id);
end $$;
grant execute on function public.pos_table_open(uuid, integer, uuid, text) to authenticated;

create or replace function public.pos_table_detail(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_s sale; v jsonb;
begin
  v_s := public._pos_table_sale(p_sale_id);
  select jsonb_build_object(
    'saleId', v_s.id, 'posShortCode', v_s.pos_short_code, 'brandId', v_s.brand_id,
    'tableId', dt.id, 'tableName', dt.name, 'seats', dt.seats,
    'zoneId', z.id, 'zoneName', z.name, 'zoneKind', z.kind,
    'covers', v_s.covers, 'openedAt', coalesce(v_s.opened_at, v_s.created_at),
    'servedByName', v_s.served_by_name, 'total', v_s.total,
    'state', public._pos_table_state(v_s),
    'billRequestedAt', v_s.bill_requested_at, 'paidAt', v_s.paid_at,
    'paymentMethod', v_s.payment_method,
    'fires', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'number', f.fire_number, 'firedAt', f.fired_at, 'firedByName', f.fired_by_name
      ) order by f.fire_number) from sale_fire f where f.sale_id = v_s.id), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', sl.id, 'name', sl.product_name, 'menuItemId', sl.menu_item_id,
        'quantity', sl.quantity, 'unitPrice', sl.unit_price, 'lineTotal', sl.line_total,
        'kitchenNote', sl.kitchen_note, 'fireId', sl.fire_id, 'voidedAt', sl.voided_at,
        'voidReason', (select v.reason_label from sale_line_void v where v.sale_line_id = sl.id),
        'createdAt', sl.created_at,
        'summary', coalesce((select jsonb_agg(h.product_name order by h.created_at)
                             from sale_line h where h.parent_sale_line_id = sl.id), '[]'::jsonb)
      ) order by sl.created_at, sl.id)
      from sale_line sl where sl.sale_id = v_s.id and sl.parent_sale_line_id is null), '[]'::jsonb)
  ) into v
  from dining_table dt join dining_zone z on z.id = dt.zone_id
  where dt.id = v_s.table_id;
  return v;
end $$;
grant execute on function public.pos_table_detail(uuid) to authenticated;

create or replace function public._pos_table_assert_open(p_s sale)
returns void language plpgsql set search_path = public as $$
begin
  if p_s.status = 'cancelled' then raise exception 'La cuenta está anulada.'; end if;
  if p_s.paid_at is not null then raise exception 'La mesa ya está cobrada.'; end if;
end $$;
revoke all on function public._pos_table_assert_open(sale) from public, anon;

create or replace function public.pos_table_add_lines(p_sale_id uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s sale; v_line jsonb; v_n int := 0;
begin
  v_s := public._pos_table_sale(p_sale_id);
  perform public._pos_table_assert_open(v_s);
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'pos_table_add_lines: p_lines no es una lista'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    perform public._pos_insert_order_line(p_sale_id, v_line);
    v_n := v_n + 1;
  end loop;
  perform public._pos_table_recalc_totals(p_sale_id);
  return jsonb_build_object('added', v_n);
end $$;
grant execute on function public.pos_table_add_lines(uuid, jsonb) to authenticated;

-- Solo lo NO enviado se puede tocar o quitar: lo enviado se anula.
create or replace function public.pos_table_set_pending_qty(p_line_id uuid, p_quantity numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l sale_line; v_s sale;
begin
  select * into v_l from sale_line where id = p_line_id and parent_sale_line_id is null;
  if v_l.id is null then raise exception 'Esa línea no existe.'; end if;
  v_s := public._pos_table_sale(v_l.sale_id);
  perform public._pos_table_assert_open(v_s);
  if v_l.fire_id is not null then raise exception 'Esa línea ya está en cocina: se anula, no se cambia.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'La cantidad mínima es 1.'; end if;
  update sale_line set quantity = p_quantity, line_total = round(unit_price * p_quantity, 2), updated_at = now()
  where id = p_line_id;
  perform public._pos_table_recalc_totals(v_s.id);
  -- tg_sale_line_consumption solo salta en UPDATE si cambia el plato: la
  -- cantidad la recalcula esto, como lo haría una línea nueva.
  perform public.generate_sale_consumption(v_s.id);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.pos_table_set_pending_qty(uuid, numeric) to authenticated;

create or replace function public.pos_table_remove_pending_line(p_line_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l sale_line; v_s sale;
begin
  select * into v_l from sale_line where id = p_line_id and parent_sale_line_id is null;
  if v_l.id is null then raise exception 'Esa línea no existe.'; end if;
  v_s := public._pos_table_sale(v_l.sale_id);
  perform public._pos_table_assert_open(v_s);
  if v_l.fire_id is not null then raise exception 'Esa línea ya está en cocina: se anula, no se borra.'; end if;
  delete from sale_line where id = p_line_id;   -- las hijas caen por la FK en cascada
  perform public._pos_table_recalc_totals(v_s.id);
  perform public.generate_sale_consumption(v_s.id);   -- el borrado no dispara el consumo
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.pos_table_remove_pending_line(uuid) to authenticated;

-- «Enviar a cocina»: añade lo que venga en p_lines, crea UN envío con todo lo
-- pendiente y lo imprime en las impresoras de cocina del local. El primer
-- envío y los siguientes van por el mismo camino.
create or replace function public.pos_table_fire(p_sale_id uuid, p_lines jsonb default '[]'::jsonb, p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s sale; v_line jsonb; v_fire uuid; v_num int; v_n int; v_jobs int;
begin
  v_s := public._pos_table_sale(p_sale_id);
  perform public._pos_table_assert_open(v_s);
  -- Dos camareros enviando la misma mesa a la vez: uno espera al otro.
  perform 1 from sale where id = p_sale_id for update;

  if jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      perform public._pos_insert_order_line(p_sale_id, v_line);
    end loop;
  end if;

  select count(*) into v_n from sale_line
  where sale_id = p_sale_id and parent_sale_line_id is null and fire_id is null and voided_at is null;
  if v_n = 0 then raise exception 'No hay nada nuevo que enviar.'; end if;

  select coalesce(max(fire_number), 0) + 1 into v_num from sale_fire where sale_id = p_sale_id;
  insert into sale_fire (account_id, location_id, sale_id, fire_number, fired_by, fired_by_name, device_id)
  values (v_s.account_id, v_s.location_id, p_sale_id, v_num, auth.uid(), public._pos_actor_name(v_s.account_id),
          public._pos_device_for(p_device_token, v_s.account_id, v_s.location_id))
  returning id into v_fire;

  -- El padre y TODA su descendencia (modificadores, componentes de combo y sus
  -- modificadores) van al mismo envío.
  with recursive arbol as (
    select id from sale_line
    where sale_id = p_sale_id and parent_sale_line_id is null and fire_id is null and voided_at is null
    union all
    select h.id from sale_line h join arbol a on h.parent_sale_line_id = a.id
  )
  update sale_line set fire_id = v_fire where id in (select id from arbol);

  perform public._pos_table_recalc_totals(p_sale_id);

  -- Entra en cocina (pantalla de cocina y consumo como hoy). La impresión
  -- automática del pedido entero NO salta para una mesa (ver §6).
  update sale set order_status = coalesce(order_status, 'accepted') where id = p_sale_id;

  v_jobs := public._pos_enqueue_print(v_s, 'kitchen',
              jsonb_build_object('mode', 'by_order', 'sale_id', p_sale_id, 'fire_id', v_fire, 'fire_number', v_num));

  return jsonb_build_object('fireId', v_fire, 'fireNumber', v_num, 'lineCount', v_n, 'printJobs', v_jobs);
end $$;
grant execute on function public.pos_table_fire(uuid, jsonb, text) to authenticated;

create or replace function public.pos_void_reasons(p_account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.current_user_is_admin() or public.belongs_to_account(p_account_id)) then
    raise exception 'Sin acceso a esta cuenta.';
  end if;
  if not exists (select 1 from void_reason where account_id = p_account_id) then
    insert into void_reason (account_id, label, sort_order) values
      (p_account_id, 'Error al pedir', 10),
      (p_account_id, 'El cliente lo cambia', 20),
      (p_account_id, 'Tarda demasiado', 30),
      (p_account_id, 'Se ha agotado', 40);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label) order by sort_order, label)
                   from void_reason where account_id = p_account_id and is_active), '[]'::jsonb);
end $$;
grant execute on function public.pos_void_reasons(uuid) to authenticated;

-- Anular una línea YA ENVIADA. La línea sigue existiendo: importe a 0, la
-- anulación escrita (motivo, quién, cuándo, importe original) y «ANULADO» en
-- cocina. El documento va compuesto (TicketDoc): lo imprime cualquier paquete.
create or replace function public.pos_table_void_line(p_line_id uuid, p_reason_id uuid, p_note text default null, p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l sale_line; v_s sale; v_r void_reason; v_orig numeric; v_tab text; v_zone text; v_jobs int; v_who text;
begin
  select * into v_l from sale_line where id = p_line_id and parent_sale_line_id is null;
  if v_l.id is null then raise exception 'Esa línea no existe.'; end if;
  v_s := public._pos_table_sale(v_l.sale_id);
  perform public._pos_table_assert_open(v_s);
  if v_l.fire_id is null then raise exception 'Esa línea no se ha enviado: se quita, no se anula.'; end if;
  if v_l.voided_at is not null then raise exception 'Esa línea ya está anulada.'; end if;
  select * into v_r from void_reason where id = p_reason_id and account_id = v_s.account_id and is_active;
  if v_r.id is null then raise exception 'Hay que elegir un motivo.'; end if;

  select coalesce(sum(line_total), 0) into v_orig from sale_line where id = p_line_id or parent_sale_line_id = p_line_id;
  v_who := public._pos_actor_name(v_s.account_id);

  insert into sale_line_void (account_id, sale_id, sale_line_id, reason_id, reason_label, note,
                              original_quantity, original_line_total, voided_by, voided_by_name, device_id)
  values (v_s.account_id, v_s.id, p_line_id, v_r.id, v_r.label, nullif(btrim(p_note), ''),
          v_l.quantity, v_orig, auth.uid(), v_who,
          public._pos_device_for(p_device_token, v_s.account_id, v_s.location_id));

  with recursive arbol as (
    select id from sale_line where id = p_line_id
    union all
    select h.id from sale_line h join arbol a on h.parent_sale_line_id = a.id
  )
  update sale_line set voided_at = now(), line_total = 0, updated_at = now() where id in (select id from arbol);
  perform public._pos_table_recalc_totals(v_s.id);

  select dt.name, z.name into v_tab, v_zone from dining_table dt join dining_zone z on z.id = dt.zone_id where dt.id = v_s.table_id;
  v_jobs := public._pos_enqueue_print(v_s, 'kitchen', jsonb_build_object(
    'title', 'Anulado', 'widthMm', 80, 'blocks', jsonb_build_array(
      jsonb_build_object('kind', 'invertBanner', 'text', 'ANULADO', 'size', 4),
      jsonb_build_object('kind', 'text', 'text', 'MESA ' || upper(v_tab), 'align', 'center', 'bold', true, 'size', 3),
      jsonb_build_object('kind', 'text', 'text', upper(v_zone), 'align', 'center', 'bold', true, 'size', 2),
      jsonb_build_object('kind', 'rule'),
      jsonb_build_object('kind', 'text', 'text', rtrim(to_char(v_l.quantity, 'FM999990.##'), '.') || 'x ' || v_l.product_name, 'bold', true, 'size', 3),
      jsonb_build_object('kind', 'text', 'text', 'Motivo: ' || v_r.label, 'size', 2),
      jsonb_build_object('kind', 'text', 'text', coalesce(v_who, '') || ' · ' || to_char(now() at time zone 'Europe/Madrid', 'HH24:MI'), 'muted', true),
      jsonb_build_object('kind', 'cut')
    )));

  return jsonb_build_object('ok', true, 'printJobs', v_jobs);
end $$;
grant execute on function public.pos_table_void_line(uuid, uuid, text, text) to authenticated;

-- «Sacar la cuenta»: imprime la cuenta en las impresoras de ticket del local y
-- la mesa pasa a «Pide la cuenta». Se puede sacar otra vez (reimprime).
create or replace function public.pos_table_request_bill(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s sale; v_pending int; v_jobs int;
begin
  v_s := public._pos_table_sale(p_sale_id);
  perform public._pos_table_assert_open(v_s);
  select count(*) into v_pending from sale_line
  where sale_id = p_sale_id and parent_sale_line_id is null and fire_id is null;
  if v_pending > 0 then
    raise exception 'Hay % línea(s) sin enviar a cocina. Envíalas o quítalas antes de sacar la cuenta.', v_pending;
  end if;
  update sale set bill_requested_at = coalesce(bill_requested_at, now()), updated_at = now() where id = p_sale_id;
  v_jobs := public._pos_enqueue_print(v_s, 'bag', jsonb_build_object('mode', 'by_order', 'sale_id', p_sale_id, 'bill', true));
  return jsonb_build_object('ok', true, 'printJobs', v_jobs, 'total', v_s.total);
end $$;
grant execute on function public.pos_table_request_bill(uuid) to authenticated;

create or replace function public.pos_table_charge(p_sale_id uuid, p_payment_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s sale; v_pending int;
begin
  v_s := public._pos_table_sale(p_sale_id);
  perform public._pos_table_assert_open(v_s);
  if p_payment_method not in ('cash', 'card') then raise exception 'Cobrar exige efectivo o tarjeta.'; end if;
  select count(*) into v_pending from sale_line
  where sale_id = p_sale_id and parent_sale_line_id is null and fire_id is null;
  if v_pending > 0 then
    raise exception 'Hay % línea(s) sin enviar a cocina. Envíalas o quítalas antes de cobrar.', v_pending;
  end if;
  if not exists (select 1 from sale_line where sale_id = p_sale_id and parent_sale_line_id is null) then
    raise exception 'La mesa no tiene nada pedido: no hay nada que cobrar.';
  end if;
  update sale set status = 'closed', payment_method = p_payment_method, payment_status = 'paid',
                  paid_at = now(), closed_at = coalesce(closed_at, now()), updated_at = now()
  where id = p_sale_id;
  select * into v_s from sale where id = p_sale_id;
  return jsonb_build_object('ok', true, 'total', v_s.total, 'paymentMethod', v_s.payment_method);
end $$;
grant execute on function public.pos_table_charge(uuid, text) to authenticated;

-- «Mesa lista»: la mesa queda libre. Solo una mesa cobrada (o vacía, para
-- deshacer una apertura por error: se anula la cuenta sin líneas).
create or replace function public.pos_table_clear(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s sale;
begin
  v_s := public._pos_table_sale(p_sale_id);
  if v_s.table_cleared_at is not null then return jsonb_build_object('ok', true); end if;
  if v_s.paid_at is null then
    if exists (select 1 from sale_line where sale_id = p_sale_id) then
      raise exception 'La mesa tiene cosas pedidas y no está cobrada.';
    end if;
    update sale set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Mesa abierta por error (sin nada pedido)',
                    table_cleared_at = now(), updated_at = now()
    where id = p_sale_id;
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;
  update sale set table_cleared_at = now(), order_status = 'completed', updated_at = now() where id = p_sale_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.pos_table_clear(uuid) to authenticated;

-- ══ 6. Lo que ya existe, por sustitución quirúrgica sobre lo VIVO ═══════

do $$
declare
  v_def text; v_new text; c int; v_acl_before text; v_acl_after text;
begin
  -- 6.1 tg_auto_print_on_accept: una mesa no imprime el pedido entero.
  v_def := pg_get_functiondef('public.tg_auto_print_on_accept()'::regprocedure);
  select count(*) into c from regexp_matches(v_def, '\n  if v_fire then\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: tg_auto_print_on_accept, «if v_fire then» aparece % veces (se esperaba 1) — parar', c; end if;
  v_new := regexp_replace(v_def, '\n  if v_fire then\n',
    E'\n  -- TPV sala (S1): una MESA imprime por envíos (pos_table_fire), nunca el\n  -- pedido entero al aceptarse.\n  if v_fire and new.table_id is not null then v_fire := false; end if;\n\n  if v_fire then\n');
  execute v_new;

  -- 6.2 upsert_pos_sale: no toca cuentas de mesa.
  v_def := pg_get_functiondef('public.upsert_pos_sale(uuid,uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure);
  select count(*) into c from regexp_matches(v_def, E'    if v_result\\.id is null then\n      raise exception ''upsert_pos_sale: venta inexistente o de otra cuenta/local'';\n    end if;\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: upsert_pos_sale, guarda de venta aparece % veces (se esperaba 1) — parar', c; end if;
  v_new := regexp_replace(v_def,
    E'(    if v_result\\.id is null then\n      raise exception ''upsert_pos_sale: venta inexistente o de otra cuenta/local'';\n    end if;\n)',
    E'\\1    -- TPV sala (S1): una cuenta de mesa no pasa por aquí. Su borrar-y-reinsertar\n    -- destruiría las líneas ya enviadas a cocina.\n    if v_result.table_id is not null then\n      raise exception ''upsert_pos_sale: es la cuenta de una mesa — se trabaja desde Sala'';\n    end if;\n');
  execute v_new;

  -- 6.3 pos_open_sales: las mesas viven en Sala.
  v_def := pg_get_functiondef('public.pos_open_sales(uuid,uuid,integer)'::regprocedure);
  select count(*) into c from regexp_matches(v_def, E'    and s\\.status = ''open''\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: pos_open_sales, filtro de status aparece % veces (se esperaba 1) — parar', c; end if;
  v_new := regexp_replace(v_def, E'    and s\\.status = ''open''\n', E'    and s.status = ''open''\n    and s.table_id is null\n');
  execute v_new;

  -- 6.4 order_for_print + p_fire_id. AÑADIR PARÁMETRO = DROP + CREATE (regla 2).
  select p.proacl::text into v_acl_before from pg_proc p where p.oid = 'public.order_for_print(text,uuid)'::regprocedure;
  v_def := pg_get_functiondef('public.order_for_print(text,uuid)'::regprocedure);

  select count(*) into c from regexp_matches(v_def, 'public\.order_for_print\(p_device_token text, p_sale_id uuid\)', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: order_for_print, firma aparece % veces — parar', c; end if;
  v_new := regexp_replace(v_def, 'public\.order_for_print\(p_device_token text, p_sale_id uuid\)',
                          'public.order_for_print(p_device_token text, p_sale_id uuid, p_fire_id uuid DEFAULT NULL::uuid)');

  select count(*) into c from regexp_matches(v_new, 'where sl\.sale_id = p_sale_id and sl\.parent_sale_line_id is null\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: order_for_print, filtro de padres aparece % veces — parar', c; end if;
  v_new := regexp_replace(v_new, 'where sl\.sale_id = p_sale_id and sl\.parent_sale_line_id is null\n',
    E'where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null\n      -- TPV sala (S1): con envío, solo sus líneas; nunca las anuladas.\n      and (p_fire_id is null or sl.fire_id = p_fire_id)\n      and sl.voided_at is null\n');

  select count(*) into c from regexp_matches(v_new, E'\n  return v_result;\nend;', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: order_for_print, «return v_result» aparece % veces — parar', c; end if;
  v_new := regexp_replace(v_new, E'\n  return v_result;\nend;',
    E'\n  -- TPV sala (S1): mesa, zona, comensales y envío para la cabecera del ticket.\n  if v_result is not null then\n    v_result := v_result || coalesce((\n      select jsonb_build_object(\n        ''table_name'', dt.name, ''zone_name'', z.name, ''covers'', s.covers,\n        ''served_by_name'', s.served_by_name,\n        ''fire_number'', f.fire_number, ''fired_at'', f.fired_at,\n        ''fire_count'', (select count(*) from sale_fire ff where ff.sale_id = s.id))\n      from sale s\n      join dining_table dt on dt.id = s.table_id\n      join dining_zone z on z.id = dt.zone_id\n      left join sale_fire f on f.id = p_fire_id and f.sale_id = s.id\n      where s.id = p_sale_id and s.account_id = v_account_id), ''{}''::jsonb);\n  end if;\n\n  return v_result;\nend;');

  drop function public.order_for_print(text, uuid);
  execute v_new;
  grant execute on function public.order_for_print(text, uuid, uuid) to anon, authenticated, service_role;

  select p.proacl::text into v_acl_after from pg_proc p where p.oid = 'public.order_for_print(text,uuid,uuid)'::regprocedure;
  -- Los permisos de antes eran PUBLIC + anon + authenticated + service_role.
  if v_acl_after is null
     or position('anon=X' in v_acl_after) = 0
     or position('authenticated=X' in v_acl_after) = 0
     or position('service_role=X' in v_acl_after) = 0 then
    raise exception 'tpv_sala_s1: permisos de order_for_print no restaurados (antes %, ahora %) — parar', v_acl_before, v_acl_after;
  end if;
  raise notice 'order_for_print permisos antes %, ahora %', v_acl_before, v_acl_after;

  if (select count(*) from pg_proc where proname = 'order_for_print' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'tpv_sala_s1: order_for_print tiene más de una firma — parar';
  end if;
end $$;

notify pgrst, 'reload schema';
