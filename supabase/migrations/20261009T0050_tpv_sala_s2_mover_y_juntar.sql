-- TPV · Sala · S2 — mover y juntar mesas, y llevar líneas sueltas a otra mesa.
--
-- ENCARGO: «TPV · Sala», tramo S2 (maqueta, pantalla 4). REQUIERE la parte B
-- de S1 (20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.sql).
--
-- ⚠️ FUERA DE BANDA, como B: añade columnas a `sale` y a `sale_fire`. Pensada
--    para aplicarse en la misma ventana, justo después de B.
--
-- QUÉ HACE
--   Datos
--     · sale.merged_into_sale_id   la cuenta que se juntó con otra apunta a la
--                                  que la recibe (y queda cancelada y recogida)
--     · sale_fire.origin_fire_id, origin_table_name
--                                  un envío que llega de otra mesa dice de cuál
--     · sale_table_move            quién movió qué y cuándo (cambio, junta, líneas)
--   Funciones
--     · pos_table_move(cuenta, mesa destino)
--         destino libre   → la cuenta pasa entera a esa mesa
--         destino ocupada → se juntan las dos cuentas en la del destino: sus
--                           envíos (renumerados detrás de los del destino, con
--                           la mesa de origen), sus líneas (mismos id), sus
--                           anulaciones; los comensales se suman
--     · pos_table_move_lines(líneas, mesa destino, comensales si está libre)
--         las líneas y toda su descendencia pasan a la otra cuenta. Si estaban
--         enviadas, en el destino aparecen en un envío que dice de qué mesa y a
--         qué hora salió (el papel de cocina ya lo tenían)
--     · pos_table_detail      + la mesa de origen de cada envío
--   Si algo de lo movido ya estaba en cocina, sale un aviso en la impresora de
--   cocina («CAMBIO DE MESA 4 → 7», «PASAN A LA MESA 7 …»), como el ANULADO:
--   documento compuesto, lo imprime cualquier paquete.
--
-- NO avisa «no caben»: eso lo dice la pantalla antes de tocar (la mesa sabe
-- sus sitios). Deja hacerlo siempre (encargo: «Avisa si no caben, pero deja»).
--
-- DECISIONES
--   · La cuenta que se junta con otra queda `cancelled` con motivo «Juntada con
--     la mesa N» y `merged_into_sale_id`. Su consumo pasa entero a la otra (se
--     regenera en las dos). En informes de anulaciones aparecerá con ese motivo.
--   · Juntar o mover líneas anula «Pide la cuenta» en las cuentas que cambian
--     de importe: la cuenta impresa ya no vale y hay que sacarla otra vez.
--   · No se puede juntar con una mesa cobrada (está «sin recoger»), ni mover
--     una cuenta cobrada.

-- ══ 0. La banda, y que B esté ═══════════════════════════════════════════
do $$
begin
  if to_regclass('public.sale_fire') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale' and column_name = 'table_id') then
    raise exception 'tpv_sala_s2: falta la parte B de S1. Parar.';
  end if;
end $$;

do $$
declare v_h time := (now() at time zone 'Europe/Madrid')::time;
begin
  if v_h >= time '12:15' or v_h < time '00:30' then
    raise exception 'tpv_sala_s2: son las % en Madrid — dentro de la banda de servicio (12:15–00:30). Esperar.', v_h;
  end if;
end $$;

-- ══ 1. Datos ════════════════════════════════════════════════════════════

alter table public.sale
  add column if not exists merged_into_sale_id uuid references public.sale(id) on delete set null;

alter table public.sale_fire
  add column if not exists origin_fire_id    uuid references public.sale_fire(id) on delete set null,
  add column if not exists origin_table_name text;

create table if not exists public.sale_table_move (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  location_id    uuid not null references public.locations(id),
  kind           text not null check (kind in ('move', 'merge', 'lines')),
  from_sale_id   uuid not null references public.sale(id) on delete cascade,
  to_sale_id     uuid not null references public.sale(id) on delete cascade,
  from_table_id  uuid references public.dining_table(id) on delete set null,
  to_table_id    uuid references public.dining_table(id) on delete set null,
  line_ids       uuid[],                       -- solo 'lines': las líneas movidas (padres)
  covers_moved   integer,                      -- solo 'merge': comensales que se suman
  amount_moved   numeric,                      -- importe que cambia de cuenta
  moved_at       timestamptz not null default now(),
  moved_by       uuid,
  moved_by_name  text,
  device_id      uuid references public.kds_device(id) on delete set null
);
create index if not exists sale_table_move_from_idx on public.sale_table_move (from_sale_id);
create index if not exists sale_table_move_to_idx on public.sale_table_move (to_sale_id);

alter table public.sale_table_move enable row level security;
drop policy if exists sale_table_move_select on public.sale_table_move;
create policy sale_table_move_select on public.sale_table_move for select using (belongs_to_account(account_id));

-- ══ 2. Ayudantes ═══════════════════════════════════════════════════════

-- El aviso a cocina cuando algo que ya estaba en cocina cambia de mesa.
create or replace function public._pos_print_table_notice(p_sale sale, p_banner text, p_title text, p_lines text[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_blocks jsonb; v_l text;
begin
  v_blocks := jsonb_build_array(
    jsonb_build_object('kind', 'invertBanner', 'text', p_banner, 'size', 3),
    jsonb_build_object('kind', 'text', 'text', p_title, 'align', 'center', 'bold', true, 'size', 3),
    jsonb_build_object('kind', 'rule'));
  foreach v_l in array coalesce(p_lines, '{}'::text[]) loop
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('kind', 'text', 'text', v_l, 'bold', true, 'size', 2));
  end loop;
  v_blocks := v_blocks || jsonb_build_array(
    jsonb_build_object('kind', 'text', 'text', coalesce(public._pos_actor_name(p_sale.account_id), '') || ' · ' || to_char(now() at time zone 'Europe/Madrid', 'HH24:MI'), 'muted', true),
    jsonb_build_object('kind', 'cut'));
  return public._pos_enqueue_print(p_sale, 'kitchen', jsonb_build_object('title', p_banner, 'widthMm', 80, 'blocks', v_blocks));
end $$;
revoke all on function public._pos_print_table_notice(sale, text, text, text[]) from public, anon;

-- La mesa destino, con la guarda de cuenta y local.
create or replace function public._pos_dest_table(p_table_id uuid, p_from sale)
returns dining_table language plpgsql stable security definer set search_path = public as $$
declare v_t dining_table;
begin
  select * into v_t from dining_table where id = p_table_id and is_active;
  if v_t.id is null then raise exception 'Esa mesa no existe.'; end if;
  if v_t.account_id <> p_from.account_id or v_t.location_id <> p_from.location_id then
    raise exception 'La mesa % es de otro local.', v_t.name;
  end if;
  return v_t;
end $$;
revoke all on function public._pos_dest_table(uuid, sale) from public, anon;

-- ══ 3. Cambiar de mesa / juntar ═════════════════════════════════════════

create or replace function public.pos_table_move(p_sale_id uuid, p_to_table_id uuid, p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s sale; v_d sale; v_to dining_table; v_from_name text; v_base int; v_amount numeric;
  v_dev uuid; v_has_fires boolean; v_jobs int := 0;
begin
  v_s := public._pos_table_sale(p_sale_id);
  perform public._pos_table_assert_open(v_s);
  v_to := public._pos_dest_table(p_to_table_id, v_s);
  if v_to.id = v_s.table_id then raise exception 'Es la misma mesa.'; end if;
  select name into v_from_name from dining_table where id = v_s.table_id;
  v_dev := public._pos_device_for(p_device_token, v_s.account_id, v_s.location_id);
  v_has_fires := exists (select 1 from sale_fire where sale_id = v_s.id);

  perform 1 from sale where id = v_s.id for update;
  select * into v_d from sale
  where table_id = v_to.id and table_cleared_at is null and status <> 'cancelled'
  for update;

  -- ── Destino libre: la cuenta pasa entera ──
  if v_d.id is null then
    update sale set table_id = v_to.id, updated_at = now() where id = v_s.id;
    insert into sale_table_move (account_id, location_id, kind, from_sale_id, to_sale_id, from_table_id, to_table_id,
                                 amount_moved, moved_by, moved_by_name, device_id)
    values (v_s.account_id, v_s.location_id, 'move', v_s.id, v_s.id, v_s.table_id, v_to.id,
            v_s.total, auth.uid(), public._pos_actor_name(v_s.account_id), v_dev);
    if v_has_fires then
      v_jobs := public._pos_print_table_notice(v_s, 'CAMBIO DE MESA', 'MESA ' || upper(v_from_name) || ' → ' || upper(v_to.name), null);
    end if;
    return jsonb_build_object('kind', 'move', 'saleId', v_s.id, 'tableName', v_to.name, 'covers', v_s.covers,
                              'total', v_s.total, 'printJobs', v_jobs);
  end if;

  -- ── Destino ocupado: se juntan las dos cuentas en la del destino ──
  if v_d.paid_at is not null then
    raise exception 'La mesa % está cobrada y sin recoger: primero «Mesa lista».', v_to.name;
  end if;

  select coalesce(max(fire_number), 0) into v_base from sale_fire where sale_id = v_d.id;
  -- Los envíos de la que se junta van detrás de los del destino, y dicen de dónde vienen.
  update sale_fire
     set sale_id = v_d.id,
         fire_number = fire_number + v_base,
         origin_table_name = coalesce(origin_table_name, v_from_name)
   where sale_id = v_s.id;
  -- Las líneas no se reescriben: cambian de cuenta con su id, su envío y sus marcas.
  update sale_line set sale_id = v_d.id, updated_at = now() where sale_id = v_s.id;
  update sale_line_void set sale_id = v_d.id where sale_id = v_s.id;

  v_amount := v_s.total;

  -- EL ORDEN IMPORTA (ensayo en staging, 08/10): stock_movement tiene una clave
  -- única por (línea, ingrediente). El consumo de una línea movida sigue
  -- apuntado a la cuenta de ORIGEN hasta que esa cuenta se recalcula; si el
  -- destino se recalcula antes, choca con él y la venta entera se aborta (23505).
  -- Primero se cierra el origen —al cancelarla, su consumo, ya sin líneas, se
  -- recalcula a nada— y después se toca el destino.
  update sale set
    status = 'cancelled', cancelled_at = now(),
    cancel_reason = 'Juntada con la mesa ' || v_to.name,
    merged_into_sale_id = v_d.id,
    table_cleared_at = now(),
    total = 0, taxable_base = 0, tax = 0,
    updated_at = now()
  where id = v_s.id;
  -- Por si el origen no tenía nada que el disparador mirase (sin estado de cocina).
  perform public.generate_sale_consumption(v_s.id);

  update sale set
    covers = covers + v_s.covers,
    opened_at = least(coalesce(opened_at, created_at), coalesce(v_s.opened_at, v_s.created_at)),
    order_status = coalesce(order_status, v_s.order_status),
    bill_requested_at = null,
    updated_at = now()
  where id = v_d.id;

  perform public._pos_table_recalc_totals(v_d.id);
  perform public.generate_sale_consumption(v_d.id);   -- mover líneas no dispara el consumo

  insert into sale_table_move (account_id, location_id, kind, from_sale_id, to_sale_id, from_table_id, to_table_id,
                               covers_moved, amount_moved, moved_by, moved_by_name, device_id)
  values (v_s.account_id, v_s.location_id, 'merge', v_s.id, v_d.id, v_s.table_id, v_to.id,
          v_s.covers, v_amount, auth.uid(), public._pos_actor_name(v_s.account_id), v_dev);

  if v_has_fires then
    v_jobs := public._pos_print_table_notice(v_d, 'MESAS JUNTAS', 'MESA ' || upper(v_from_name) || ' → ' || upper(v_to.name), null);
  end if;

  select * into v_d from sale where id = v_d.id;
  return jsonb_build_object('kind', 'merge', 'saleId', v_d.id, 'tableName', v_to.name, 'covers', v_d.covers,
                            'total', v_d.total, 'printJobs', v_jobs);
end $$;
grant execute on function public.pos_table_move(uuid, uuid, text) to authenticated;

-- ══ 4. Llevar líneas sueltas a otra mesa ═══════════════════════════════

create or replace function public.pos_table_move_lines(p_line_ids uuid[], p_to_table_id uuid, p_covers integer default null, p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s sale; v_d sale; v_to dining_table; v_from_name text; v_sale_ids uuid[]; v_dev uuid;
  v_f record; v_new_fire uuid; v_new_sale uuid; v_num int; v_amount numeric; v_notice text[]; v_jobs int := 0; v_n int;
begin
  if p_line_ids is null or array_length(p_line_ids, 1) is null then raise exception 'No hay líneas que mover.'; end if;

  select array_agg(distinct sale_id) into v_sale_ids
  from sale_line where id = any (p_line_ids) and parent_sale_line_id is null;
  if v_sale_ids is null or array_length(v_sale_ids, 1) <> 1 then
    raise exception 'Las líneas tienen que ser de una sola mesa.';
  end if;
  select count(*) into v_n from sale_line where id = any (p_line_ids) and parent_sale_line_id is null;
  if v_n <> array_length(p_line_ids, 1) then raise exception 'Alguna de esas líneas no existe.'; end if;

  v_s := public._pos_table_sale(v_sale_ids[1]);
  perform public._pos_table_assert_open(v_s);
  v_to := public._pos_dest_table(p_to_table_id, v_s);
  if v_to.id = v_s.table_id then raise exception 'Es la misma mesa.'; end if;
  select name into v_from_name from dining_table where id = v_s.table_id;
  v_dev := public._pos_device_for(p_device_token, v_s.account_id, v_s.location_id);

  perform 1 from sale where id = v_s.id for update;
  select * into v_d from sale
  where table_id = v_to.id and table_cleared_at is null and status <> 'cancelled'
  for update;

  if v_d.id is null then
    if p_covers is null or p_covers < 1 then
      raise exception 'La mesa % está libre: hay que decir cuántos son.', v_to.name;
    end if;
    -- En una variable, no dentro del WHERE: ahí Postgres puede evaluarla más
    -- de una vez y la segunda encontraría la mesa ya abierta (ensayo local, 08/10).
    v_new_sale := (public.pos_table_open(v_to.id, p_covers, v_s.brand_id, p_device_token)->>'saleId')::uuid;
    select * into v_d from sale where id = v_new_sale;
  elsif v_d.paid_at is not null then
    raise exception 'La mesa % está cobrada y sin recoger: primero «Mesa lista».', v_to.name;
  end if;

  select coalesce(sum(line_total), 0) into v_amount
  from sale_line where id = any (p_line_ids) or parent_sale_line_id = any (p_line_ids);

  -- Lo que ya estaba en cocina: un envío en el destino por cada envío de
  -- origen, con su hora y su mesa de origen. El papel ya salió: no se imprime.
  for v_f in
    select distinct f.id, f.fired_at, f.fired_by, f.fired_by_name, f.device_id, f.origin_table_name
    from sale_line sl join sale_fire f on f.id = sl.fire_id
    where sl.id = any (p_line_ids)
  loop
    select coalesce(max(fire_number), 0) + 1 into v_num from sale_fire where sale_id = v_d.id;
    insert into sale_fire (account_id, location_id, sale_id, fire_number, fired_at, fired_by, fired_by_name, device_id,
                           origin_fire_id, origin_table_name)
    values (v_s.account_id, v_s.location_id, v_d.id, v_num, v_f.fired_at, v_f.fired_by, v_f.fired_by_name, v_f.device_id,
            v_f.id, coalesce(v_f.origin_table_name, v_from_name))
    returning id into v_new_fire;

    with recursive arbol as (
      select id from sale_line where id = any (p_line_ids) and fire_id = v_f.id
      union all
      select h.id from sale_line h join arbol a on h.parent_sale_line_id = a.id
    )
    update sale_line set sale_id = v_d.id, fire_id = v_new_fire, updated_at = now() where id in (select id from arbol);
  end loop;

  -- Lo que no se había enviado pasa tal cual (sigue sin enviar).
  with recursive arbol as (
    select id from sale_line where id = any (p_line_ids) and fire_id is null
    union all
    select h.id from sale_line h join arbol a on h.parent_sale_line_id = a.id
  )
  update sale_line set sale_id = v_d.id, updated_at = now() where id in (select id from arbol);

  update sale_line_void set sale_id = v_d.id where sale_line_id = any (p_line_ids);

  -- EL ORDEN IMPORTA (ver pos_table_move): el origen suelta el consumo de las
  -- líneas que se van ANTES de que nada recalcule el destino. Cambiar el
  -- estado del destino a 'accepted' ya dispara su recálculo.
  perform public.generate_sale_consumption(v_s.id);

  -- Las dos cuentas cambian de importe: la cuenta impresa ya no vale.
  update sale set bill_requested_at = null, updated_at = now() where id in (v_s.id, v_d.id);
  update sale set order_status = coalesce(order_status, 'accepted')
  where id = v_d.id and exists (select 1 from sale_fire where sale_id = v_d.id);

  perform public._pos_table_recalc_totals(v_s.id);
  perform public._pos_table_recalc_totals(v_d.id);
  perform public.generate_sale_consumption(v_d.id);

  insert into sale_table_move (account_id, location_id, kind, from_sale_id, to_sale_id, from_table_id, to_table_id,
                               line_ids, amount_moved, moved_by, moved_by_name, device_id)
  values (v_s.account_id, v_s.location_id, 'lines', v_s.id, v_d.id, v_s.table_id, v_to.id,
          p_line_ids, v_amount, auth.uid(), public._pos_actor_name(v_s.account_id), v_dev);

  select array_agg(rtrim(to_char(quantity, 'FM999990.##'), '.') || 'x ' || product_name order by created_at)
    into v_notice
  from sale_line where id = any (p_line_ids) and fire_id is not null and voided_at is null;
  if v_notice is not null then
    v_jobs := public._pos_print_table_notice(v_d, 'CAMBIO DE MESA',
      'DE LA ' || upper(v_from_name) || ' A LA ' || upper(v_to.name), v_notice);
  end if;

  return jsonb_build_object('saleId', v_d.id, 'tableName', v_to.name, 'moved', array_length(p_line_ids, 1),
                            'amount', v_amount, 'printJobs', v_jobs);
end $$;
grant execute on function public.pos_table_move_lines(uuid[], uuid, integer, text) to authenticated;

-- ══ 5. pos_table_detail: la mesa de origen de cada envío ════════════════
-- Función de este mismo encargo (S1): se reescribe entera, con el añadido.
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
        'id', f.id, 'number', f.fire_number, 'firedAt', f.fired_at, 'firedByName', f.fired_by_name,
        'originTableName', f.origin_table_name
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

notify pgrst, 'reload schema';
