-- cambia: public.sale · prueba: supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql
-- cambia: public.sale_line · prueba: supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql
-- cambia: public.tg_auto_print_on_accept · prueba: supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql
-- cambia: public.upsert_pos_sale · prueba: supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql
-- cambia: public.pos_open_sales · prueba: supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql
-- cambia: public.order_for_print · prueba: supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql
-- TPV · Sala · S1 · parte B — mesas, comensales y envíos a cocina.
--
-- 01/11/2026 · CORREGIDA PARA PASAR DOS VECES (Julio, antes de subirla a
-- producción, donde nunca se aplicó: el historial solo tiene la S1a). Los
-- cuatro cambios de la sección 6 se saltan si ya están hechos (por su
-- comentario «TPV sala (S1)», y order_for_print por tener ya la firma de tres);
-- la primera vez hacen exactamente lo de antes. Lo demás ya era
-- «if not exists» / «create or replace». Staging la tenía aplicada sin
-- registrar, y pasarla otra vez habría duplicado dos añadidos y parado en
-- order_for_print. Prueba: supabase/staging/sql/20261101_s1b_dos_veces_prueba.sql.
--
-- REQUIERE la parte A (20261008T1315_tpv_sala_s1a_zonas_y_mesas.sql):
-- dining_zone, dining_table, dining_config y void_reason ya existen.
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
--     · (parte A: dining_zone, dining_table, dining_config, void_reason)
--     · sale_fire            un «Enviar a cocina» = una fila, numerada por cuenta
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

-- ══ 0. La banda, y que la parte A esté ═════════════════════════════════
do $$
begin
  if to_regclass('public.dining_table') is null or to_regclass('public.void_reason') is null then
    raise exception 'tpv_sala_s1b: falta la parte A (20261008T1315_tpv_sala_s1a_zonas_y_mesas.sql). Parar.';
  end if;
end $$;

do $$
declare v_h time := (now() at time zone 'Europe/Madrid')::time;
begin
  if v_h >= time '12:15' or v_h < time '00:30' then
    raise exception 'tpv_sala_s1: son las % en Madrid — dentro de la banda de servicio (12:15–00:30). Esperar.', v_h;
  end if;
end $$;

-- 01/11/2026: los cierres, todos de entrada y en un solo orden. Primero las
-- tablas a las que apuntan las claves ajenas que crea (y que su vuelta atrás
-- tiene que borrar, con cierre exclusivo también sobre ellas): accounts,
-- locations, kds_device, dining_table y void_reason; después sale y sale_line.
-- Quien lee la sala (dining_table y luego sale) y las tablets (kds_device y
-- luego sale) van en ese orden. Coger sale antes dio 40P01 en la vuelta atrás
-- (ensayo y staging del 01/11). Son unos segundos, con los locales cerrados.
lock table public.accounts, public.locations, public.kds_device, public.dining_table, public.void_reason,
           public.sale, public.sale_line in access exclusive mode;

-- ══ 1. Tablas nuevas ════════════════════════════════════════════════════

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
-- Los envíos y anulaciones solo se escriben por las funciones (SECURITY
-- DEFINER): lectura para la cuenta, ninguna política de escritura.

alter table public.sale_fire      enable row level security;
alter table public.sale_line_void enable row level security;

drop policy if exists sale_fire_select on public.sale_fire;
create policy sale_fire_select on public.sale_fire for select using (belongs_to_account(account_id));
drop policy if exists sale_line_void_select on public.sale_line_void;
create policy sale_line_void_select on public.sale_line_void for select using (belongs_to_account(account_id));

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
  -- 01/11: si ya está (el comentario de abajo), no se añade otra vez.
  if position('-- TPV sala (S1): una MESA imprime por envíos' in v_def) > 0 then
    raise notice 'tpv_sala_s1: tg_auto_print_on_accept ya lo tiene — sin cambios';
  else
  select count(*) into c from regexp_matches(v_def, '\n  if v_fire then\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: tg_auto_print_on_accept, «if v_fire then» aparece % veces (se esperaba 1) — parar', c; end if;
  v_new := regexp_replace(v_def, '\n  if v_fire then\n',
    E'\n  -- TPV sala (S1): una MESA imprime por envíos (pos_table_fire), nunca el\n  -- pedido entero al aceptarse.\n  if v_fire and new.table_id is not null then v_fire := false; end if;\n\n  if v_fire then\n');
  execute v_new;
  end if;

  -- 6.2 upsert_pos_sale: no toca cuentas de mesa.
  v_def := pg_get_functiondef('public.upsert_pos_sale(uuid,uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure);
  if position('-- TPV sala (S1): una cuenta de mesa no pasa por aquí' in v_def) > 0 then
    raise notice 'tpv_sala_s1: upsert_pos_sale ya lo tiene — sin cambios';
  else
  select count(*) into c from regexp_matches(v_def, E'    if v_result\\.id is null then\n      raise exception ''upsert_pos_sale: venta inexistente o de otra cuenta/local'';\n    end if;\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: upsert_pos_sale, guarda de venta aparece % veces (se esperaba 1) — parar', c; end if;
  v_new := regexp_replace(v_def,
    E'(    if v_result\\.id is null then\n      raise exception ''upsert_pos_sale: venta inexistente o de otra cuenta/local'';\n    end if;\n)',
    E'\\1    -- TPV sala (S1): una cuenta de mesa no pasa por aquí. Su borrar-y-reinsertar\n    -- destruiría las líneas ya enviadas a cocina.\n    if v_result.table_id is not null then\n      raise exception ''upsert_pos_sale: es la cuenta de una mesa — se trabaja desde Sala'';\n    end if;\n');
  execute v_new;
  end if;

  -- 6.3 pos_open_sales: las mesas viven en Sala.
  v_def := pg_get_functiondef('public.pos_open_sales(uuid,uuid,integer)'::regprocedure);
  if position(E'    and s.status = ''open''\n    and s.table_id is null\n' in v_def) > 0 then
    raise notice 'tpv_sala_s1: pos_open_sales ya lo tiene — sin cambios';
  else
  select count(*) into c from regexp_matches(v_def, E'    and s\\.status = ''open''\n', 'g');
  if c <> 1 then raise exception 'tpv_sala_s1: pos_open_sales, filtro de status aparece % veces (se esperaba 1) — parar', c; end if;
  v_new := regexp_replace(v_def, E'    and s\\.status = ''open''\n', E'    and s.status = ''open''\n    and s.table_id is null\n');
  execute v_new;
  end if;

end $$;

-- 6.4 order_for_print + p_fire_id. AÑADIR PARÁMETRO = DROP + CREATE (regla 2).
-- 01/11/2026: ESCRITA, no por sustitución en vivo, para que el analizador vea
-- el drop + create (con execute dinámico solo veía el drop, y el front la usa).
-- El texto es el de producción del 01/11 (md5 a9878591…, ya con la R03) con las
-- MISMAS tres sustituciones de antes: la firma con p_fire_id, el filtro de
-- envío y anuladas, y la cabecera de mesa. Si producción ha cambiado desde
-- entonces, para: pisarla borraría ese cambio. Donde ya tiene la firma de tres
-- (staging), la guarda no aplica y la deja como esta (la misma cada vez).
do $$
begin
  if to_regprocedure('public.order_for_print(text,uuid,uuid)') is null then
    if md5(pg_get_functiondef('public.order_for_print(text,uuid)'::regprocedure)) <> 'a987859161734deb07ec9e4301cb349d' then
      raise exception 'tpv_sala_s1: order_for_print no es la medida el 01/11 (md5 a9878591…) — parar: pisarla borraría ese cambio';
    end if;
  end if;
end $$;

drop function if exists public.order_for_print(text, uuid);

CREATE OR REPLACE FUNCTION public.order_for_print(p_device_token text, p_sale_id uuid, p_fire_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_result      jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'order_for_print: token no válido';
  end if;
  v_account_id := v_device.account_id;

  -- Pobla descuento por línea (Last + HubRise) just-in-time. No falla si no hay.
  begin
    perform public.fill_line_discounts(p_sale_id);
    -- C9 L1: acuña los tokens de etiqueta si no existen. Idempotente: la
    -- reimpresion pasa por aqui otra vez y devuelve LOS MISMOS.
    perform public.ensure_label_tokens(p_sale_id);
  exception when others then
    null;  -- el ticket no se cae por un descuento mal formado
  end;

  with v as (
    select s.id, s.external_ref, s.external_tab_ref,
           s.platform_order_code, s.pos_short_code, s.platform_order_ref,
           s.order_status, s.status, s.service_type, s.source,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.customer_name, s.customer_phone, s.delivery_address,
           s.expected_time, s.customer_note, s.delivery_address_fixed, s.delivery_address_fixed_by, s.customer_phone_code, s.delivery_instructions, s.order_customer_note, s.delivery_by_reason,
           s.total, s.paid, s.payment_method, s.discount_amount, s.delivery_cost,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at, s.raw_tab
    from sale s
    where s.id = p_sale_id and s.account_id = v_account_id
  ),
  notas as (
    select v.id as sale_id, (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from v
    cross join lateral (select safe_jsonb(v.raw_tab) as tab) rt
    cross join lateral (select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products) p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.products)='array' then p.products else '[]'::jsonb end) as prod
    where nullif(btrim(prod->>'comments'),'') is not null and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, btrim(regexp_replace(regexp_replace(sl.product_name, '[‍️←-⇿⌀-⏿①-⓿─-➿⬀-⯿\U0001F000-\U0001FAFF]', '', 'g'), '\s{2,}', ' ', 'g')) as product_name, sl.quantity, sl.line_type,
           sl.menu_item_id, sl.external_product_id, sl.unit_price, sl.line_total, sl.kitchen_note,
           sl.original_unit_price, sl.discount_label,
           mi.category as menu_category, df.name as family, df.color as family_color, df.icon as family_icon,
           array(select case a.allergen_code when 'gluten' then 'Gluten' when 'milk' then 'Lácteos' when 'eggs' then 'Huevos' when 'sulphites' then 'Sulfitos' when 'mustard' then 'Mostaza' when 'soy' then 'Soja' when 'sesame' then 'Sésamo' when 'celery' then 'Apio' when 'nuts' then 'Frutos de cáscara' when 'fish' then 'Pescado' when 'molluscs' then 'Moluscos' when 'crustaceans' then 'Crustáceos' when 'peanuts' then 'Cacahuetes' when 'lupin' then 'Altramuces' else initcap(a.allergen_code) end from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join recipe_family df on df.id = ri.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null
      -- TPV sala (S1): con envío, solo sus líneas; nunca las anuladas.
      and (p_fire_id is null or sl.fire_id = p_fire_id)
      and sl.voided_at is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id, btrim(regexp_replace(regexp_replace(sl.product_name, '[‍️←-⇿⌀-⏿①-⓿─-➿⬀-⯿\U0001F000-\U0001FAFF]', '', 'g'), '\s{2,}', ' ', 'g')) as product_name, sl.quantity,
           sl.line_type, sl.external_product_id, sl.menu_item_id, mg.group_type,
           dfh.name as family, dfh.color as family_color, mih.category as menu_category,
           case when sl.line_type='combo_item' then 1 when mg.group_type='removal' then 2
                when mg.group_type='extras' then 3 when mg.group_type in ('choice','side') then 4
                when mg.group_type in ('cross_sell','info') then 6 else 5 end as sort_rank
    from sale_line sl
    left join modifier_option mo on mo.id = sl.modifier_option_id
    left join modifier_group mg on mg.id = mo.modifier_group_id
    left join menu_item mih on mih.id = sl.menu_item_id
    left join recipe_item rih on rih.id = mih.recipe_item_id
    left join recipe_family dfh on dfh.id = rih.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is not null
  )
  select to_jsonb(t) into v_result from (
    select v.id as sale_id, v.external_ref, v.external_tab_ref,
           v.platform_order_code, v.pos_short_code, v.platform_order_ref, v.order_status, v.status, v.service_type, v.source,
           b.name as brand, b.logo_url as brand_logo_url, b.color as brand_color,
           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption, b.ownership_type as brand_ownership_type,
           public.label_token_bolsa(v.id) as bag_token,
           coalesce(ch.name, v.external_channel_text) as channel, v.channel_id,
           v.customer_name, v.customer_phone, v.delivery_address, v.expected_time, v.customer_note, v.delivery_address_fixed, v.delivery_address_fixed_by, v.customer_phone_code, v.delivery_instructions, v.order_customer_note, v.delivery_by_reason,
           v.total, v.paid, v.payment_method, v.discount_amount, v.delivery_cost, v.entro_at,
           safe_jsonb(v.raw_tab)->'delivery' as delivery_detail,
           (select jsonb_agg(jsonb_build_object(
              'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity, 'menu_item_id', l.menu_item_id,
              'unit_tokens', public.label_tokens_for(l.line_id),
              'unit_price', l.unit_price, 'line_total', l.line_total,
              'original_unit_price', l.original_unit_price, 'discount_label', l.discount_label,
              'allergens', l.allergens,
              'family', l.family, 'family_color', l.family_color, 'family_icon', l.family_icon,
              'menu_category', l.menu_category, 'has_recipe', (l.menu_item_id is not null),
              'customer_note', coalesce((select n.note from notas n where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1), l.kitchen_note),
              'children', coalesce((select jsonb_agg(jsonb_build_object(
                  'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity, 'line_type', h.line_type,
                  'unit_tokens', public.label_tokens_for(h.line_id),
                  'group_type', h.group_type, 'menu_item_id', h.menu_item_id, 'family', h.family,
                  'family_color', h.family_color, 'menu_category', h.menu_category
                ) order by h.sort_rank, h.product_name) from hijas h where h.parent_sale_line_id = l.line_id), '[]'::jsonb)
            ) order by l.product_name) from padres l) as lineas
    from v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  ) t;

  -- TPV sala (S1): mesa, zona, comensales y envío para la cabecera del ticket.
  if v_result is not null then
    v_result := v_result || coalesce((
      select jsonb_build_object(
        'table_name', dt.name, 'zone_name', z.name, 'covers', s.covers,
        'served_by_name', s.served_by_name,
        'fire_number', f.fire_number, 'fired_at', f.fired_at,
        'fire_count', (select count(*) from sale_fire ff where ff.sale_id = s.id))
      from sale s
      join dining_table dt on dt.id = s.table_id
      join dining_zone z on z.id = dt.zone_id
      left join sale_fire f on f.id = p_fire_id and f.sale_id = s.id
      where s.id = p_sale_id and s.account_id = v_account_id), '{}'::jsonb);
  end if;

  return v_result;
end;
$function$;

grant execute on function public.order_for_print(text, uuid, uuid) to anon, authenticated, service_role;

do $$
declare v_acl_after text;
begin
  select p.proacl::text into v_acl_after from pg_proc p where p.oid = 'public.order_for_print(text,uuid,uuid)'::regprocedure;
  -- Los permisos de antes eran PUBLIC + anon + authenticated + service_role.
  if v_acl_after is null
     or position('anon=X' in v_acl_after) = 0
     or position('authenticated=X' in v_acl_after) = 0
     or position('service_role=X' in v_acl_after) = 0 then
    raise exception 'tpv_sala_s1: permisos de order_for_print no restaurados (ahora %) — parar', v_acl_after;
  end if;
  if (select count(*) from pg_proc where proname = 'order_for_print' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'tpv_sala_s1: order_for_print tiene más de una firma — parar';
  end if;
end $$;

notify pgrst, 'reload schema';
