-- C11 · 2 · Devolver a «open» las ventas que el cierre del día anuló y la plataforma entregó (Julio, 23/10).
--
-- AUTORIZO: update de public.sale (camino del pedido). Solo DATOS de Foodint;
-- en staging (sin Foodint) no hace nada.
--
-- QUÉ: las ventas de Foodint que conta_cerrar_dias anuló (status 'cancelled',
-- unconfirmed_at puesto, cancel_reason «No confirmado por la plataforma al
-- cierre del día (…)», con su fila en sales_day_close_log) y que en la
-- plataforma acabaron ENTREGADAS (order_status = 'completed'). Las que la
-- plataforma tiene cancelled, rejected o delivery_failed no se tocan.
--
-- A QUÉ ESTADO: al de antes. La función solo anulaba pedidos con status
-- 'open' (su primera línea), así que vuelven a 'open', y se quitan los tres
-- sellos que puso: unconfirmed_at, cancelled_at y cancel_reason. NO se llama a
-- close_sale (recalcula costes y vuelve a generar el consumo: es un cambio de
-- stock y se decide aparte). Su fila de sales_day_close_log pasa a
-- accion = 'restaurado'.
--
-- QUÉ NO DISPARA, medido en producción el 23/10 sobre los disparadores de sale:
--   · order_status no cambia → ni trg_sale_push_status (empuje a la plataforma),
--     ni trg_sale_close_on_complete, ni impresión, ni reparto, ni los sellos.
--   · trg_sale_consumption_on_complete: la rama de anulación exige status
--     'cancelled' en la fila nueva, y la de alta un cambio de order_status:
--     ninguna. La anulación tampoco devolvió el stock (unconfirmed_at puesto):
--     sus movimientos siguen ahí y no se vuelven a generar.
--   · folvy.reparto_tal_cual = on, local a la transacción: el disparador de
--     «quién reparte» de Uber no decide de nuevo.
--   Y se COMPRUEBA, no se supone: después del update, order_status,
--   delivery_state, service_type, total, marca, canal y local son los de la
--   copia, y los movimientos de stock de esas ventas no han cambiado (ni en
--   número ni en ids). Si algo cambió, para entera.
--
-- GUARDA: la lista se ancla por la condición de arriba y por su huella (md5 de
-- los ids ordenados, medida en producción el 23/10 a las 20:40 UTC). Si no
-- es exactamente esa lista, para sin tocar nada.
-- COPIA: public.c11_ventas_restauradas_20261023 (cerrada a la API), con lo de
-- antes de cada venta: la usa la vuelta atrás.
-- Vuelta atrás: supabase/vuelta-atras/20261023T2050_c11_restaurar_ventas_entregadas.down.sql

do $$
declare
  v_acc    constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_huella constant text := '386e6850e1a1214eef2a02754e38a67d';
  v_h text; v_n int; v_mov_antes text; v_mov_despues text; v_mal int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'C11-2: esta base no tiene la cuenta de Foodint: no hay nada que restaurar.';
    return;
  end if;

  create table if not exists public.c11_ventas_restauradas_20261023 (
    sale_id        uuid primary key,
    status         text,
    unconfirmed_at timestamptz,
    cancelled_at   timestamptz,
    cancel_reason  text,
    order_status   text,
    delivery_state text,
    service_type   text,
    total          numeric,
    brand_id       uuid,
    channel_id     uuid,
    location_id    uuid,
    updated_at     timestamptz,
    copiado_at     timestamptz not null default now()
  );
  alter table public.c11_ventas_restauradas_20261023 enable row level security;
  revoke all on public.c11_ventas_restauradas_20261023 from public, anon, authenticated;

  -- La lista, bloqueada, y su huella.
  create temporary table c11_lista on commit drop as
    select s.id
      from public.sale s
      join public.sales_day_close_log l on l.sale_id = s.id
     where s.account_id = v_acc
       and s.status = 'cancelled' and s.order_status = 'completed'
       and s.unconfirmed_at is not null
       and s.cancel_reason like 'No confirmado por la plataforma al cierre del día (%'
       and l.accion is null;
  perform 1 from public.sale s where s.id in (select id from c11_lista) for update;
  select count(*), md5(string_agg(id::text, ',' order by id)) into v_n, v_h from c11_lista;
  if v_h is distinct from v_huella then
    raise exception 'C11-2: la lista no es la medida el 23/10 (% ventas, huella %). No se toca nada.', v_n, coalesce(v_h, '-');
  end if;

  insert into public.c11_ventas_restauradas_20261023
    (sale_id, status, unconfirmed_at, cancelled_at, cancel_reason, order_status, delivery_state, service_type, total, brand_id, channel_id, location_id, updated_at)
  select s.id, s.status, s.unconfirmed_at, s.cancelled_at, s.cancel_reason, s.order_status, s.delivery_state, s.service_type, s.total, s.brand_id, s.channel_id, s.location_id, s.updated_at
    from public.sale s where s.id in (select id from c11_lista);

  select md5(coalesce(string_agg(m.id::text, ',' order by m.id), '')) into v_mov_antes
    from public.stock_movement m where m.source_id in (select id from c11_lista);

  perform set_config('folvy.reparto_tal_cual', 'on', true);
  update public.sale s
     set status = 'open', unconfirmed_at = null, cancelled_at = null, cancel_reason = null
   where s.id in (select id from c11_lista);
  get diagnostics v_n = row_count;

  update public.sales_day_close_log set accion = 'restaurado' where sale_id in (select id from c11_lista);

  -- Comprobar lo que no tenía que cambiar.
  select count(*) into v_mal
    from public.sale s join public.c11_ventas_restauradas_20261023 c on c.sale_id = s.id
   where s.status <> 'open' or s.unconfirmed_at is not null or s.cancelled_at is not null or s.cancel_reason is not null
      or s.order_status is distinct from c.order_status or s.delivery_state is distinct from c.delivery_state
      or s.service_type is distinct from c.service_type or s.total is distinct from c.total
      or s.brand_id is distinct from c.brand_id or s.channel_id is distinct from c.channel_id or s.location_id is distinct from c.location_id;
  if v_mal > 0 then
    raise exception 'C11-2: % venta(s) no han quedado como tocaba (algún disparador cambió algo). Vuelta atrás de toda la transacción.', v_mal;
  end if;
  select md5(coalesce(string_agg(m.id::text, ',' order by m.id), '')) into v_mov_despues
    from public.stock_movement m where m.source_id in (select id from c11_lista);
  if v_mov_despues is distinct from v_mov_antes then
    raise exception 'C11-2: los movimientos de stock de esas ventas han cambiado. Vuelta atrás de toda la transacción.';
  end if;

  raise notice 'C11-2: % ventas devueltas a open, sin tocar su estado en la plataforma ni su stock.', v_n;
end $$;
