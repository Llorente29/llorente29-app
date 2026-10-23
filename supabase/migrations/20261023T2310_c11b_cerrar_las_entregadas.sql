-- C11b · 2 · Cerrar como vendidas las ventas que el cierre del día anuló y la plataforma entregó (Julio, 23/10).
--
-- AUTORIZO: update de public.sale (camino del pedido). Solo DATOS de Foodint;
-- en staging (sin Foodint) no hace nada.
--
-- QUÉ: las ventas de Foodint que conta_cerrar_dias anuló (status 'cancelled',
-- unconfirmed_at puesto, cancel_reason «No confirmado por la plataforma al
-- cierre del día (…)», con su fila en sales_day_close_log sin accion) y que la
-- plataforma entregó (order_status 'completed'). Las cancelled, rejected y
-- delivery_failed de la plataforma no se tocan.
--
-- CÓMO (C11b, punto 2): status 'closed', closed_at = la hora de entrega
-- (delivered_at; estas no la tienen, así que la de entrega al rider o, si no,
-- la de «listo»), y fuera los tres sellos de la anulación. NO se llama a
-- close_sale. El consumo no se toca: sus movimientos de stock ya están
-- (consumieron al aceptarse y la anulación no los devolvió). El coste de las
-- líneas: medido el 23/10, a una línea le falta (cost_computed_at NULL); se
-- calcula con compute_sale_line_cost, que solo escribe esa línea (lo mismo que
-- haría close_sale, sin su consumo). Su fila de sales_day_close_log pasa a
-- accion = 'cerrado_sin_confirmar' (el aviso de la liquidación las mira).
--
-- Y los asientos: con las ventas cerradas, sus días quedan por asentar. Aquí
-- se llama a conta_proponer_dias (lo mismo que hace el cron cada hora): los
-- días de Glovo que no tenían asiento quedan con su asiento PROPUESTO (sin
-- validar ni enviar a Diez). Los días que ya tenían asiento validado no se
-- tocan: se rehacen anulando ese asiento en el libro (contraasiento a Diez) y
-- validando el que se vuelve a proponer; eso lo hace una persona.
--
-- GUARDA: exactamente la lista medida el 23/10 (huella de los ids ordenados,
-- 32 ventas, 833,79 €). Si no, para sin tocar nada.
-- COMPRUEBA, después: estado en la plataforma, reparto, importe, marca, canal
-- y local iguales a la copia; los movimientos de stock de esas ventas, los
-- mismos (ids); todas sus líneas con su coste calculado. Si algo no, para entera.
-- COPIA: public.c11b_ventas_cerradas_20261023 (cerrada a la API).
-- Vuelta atrás: supabase/vuelta-atras/20261023T2310_c11b_cerrar_las_entregadas.down.sql

do $$
declare
  v_acc     constant uuid    := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_huella  constant text    := '386e6850e1a1214eef2a02754e38a67d';
  v_n_esper constant int     := 32;
  v_importe constant numeric := 833.79;
  v_h text; v_n int; v_suma numeric; v_mov_antes text; v_mov_despues text; v_mal int; v_l uuid; v_e uuid; v_p jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'C11b-2: esta base no tiene la cuenta de Foodint: no hay nada que cerrar.';
    return;
  end if;

  create table if not exists public.c11b_ventas_cerradas_20261023 (
    sale_id uuid primary key, status text, closed_at timestamptz, unconfirmed_at timestamptz, cancelled_at timestamptz,
    cancel_reason text, order_status text, delivery_state text, service_type text, total numeric,
    brand_id uuid, channel_id uuid, location_id uuid, updated_at timestamptz,
    lineas_sin_coste uuid[], copiado_at timestamptz not null default now());
  alter table public.c11b_ventas_cerradas_20261023 enable row level security;
  revoke all on public.c11b_ventas_cerradas_20261023 from public, anon, authenticated;

  create temporary table c11b_lista on commit drop as
    select s.id from public.sale s join public.sales_day_close_log l on l.sale_id = s.id
     where s.account_id = v_acc and s.status = 'cancelled' and s.order_status = 'completed'
       and s.unconfirmed_at is not null and s.cancel_reason like 'No confirmado por la plataforma al cierre del día (%'
       and l.accion is null;
  perform 1 from public.sale s where s.id in (select id from c11b_lista) for update;
  select count(*), md5(string_agg(s.id::text, ',' order by s.id)), sum(s.total) into v_n, v_h, v_suma
    from public.sale s where s.id in (select id from c11b_lista);
  if v_n <> v_n_esper or v_h is distinct from v_huella or v_suma is distinct from v_importe then
    raise exception 'C11b-2: la lista no es la medida el 23/10 (% ventas, % €, huella %). No se toca nada.', v_n, v_suma, coalesce(v_h, '-');
  end if;

  insert into public.c11b_ventas_cerradas_20261023
    (sale_id, status, closed_at, unconfirmed_at, cancelled_at, cancel_reason, order_status, delivery_state, service_type, total,
     brand_id, channel_id, location_id, updated_at, lineas_sin_coste)
  select s.id, s.status, s.closed_at, s.unconfirmed_at, s.cancelled_at, s.cancel_reason, s.order_status, s.delivery_state, s.service_type, s.total,
         s.brand_id, s.channel_id, s.location_id, s.updated_at,
         array(select l.id from public.sale_line l where l.sale_id = s.id and coalesce(l.line_type, 'product') = 'product' and l.cost_computed_at is null)
    from public.sale s where s.id in (select id from c11b_lista);

  select md5(coalesce(string_agg(m.id::text, ',' order by m.id), '')) into v_mov_antes
    from public.stock_movement m where m.source_id in (select id from c11b_lista);

  -- Los costes que faltan (solo escribe la línea).
  for v_l in select l.id from public.sale_line l where l.sale_id in (select id from c11b_lista)
                and coalesce(l.line_type, 'product') = 'product' and l.cost_computed_at is null loop
    perform public.compute_sale_line_cost(v_l);
  end loop;

  perform set_config('folvy.reparto_tal_cual', 'on', true);
  update public.sale s
     set status = 'closed', closed_at = coalesce(s.delivered_at, s.handed_to_courier_at, s.ready_at),
         unconfirmed_at = null, cancelled_at = null, cancel_reason = null
   where s.id in (select id from c11b_lista);
  get diagnostics v_n = row_count;
  update public.sales_day_close_log set accion = 'cerrado_sin_confirmar' where sale_id in (select id from c11b_lista);

  -- Comprobar.
  select count(*) into v_mal
    from public.sale s join public.c11b_ventas_cerradas_20261023 c on c.sale_id = s.id
   where s.status <> 'closed' or s.closed_at is null or s.unconfirmed_at is not null or s.cancelled_at is not null or s.cancel_reason is not null
      or s.order_status is distinct from c.order_status or s.delivery_state is distinct from c.delivery_state
      or s.service_type is distinct from c.service_type or s.total is distinct from c.total
      or s.brand_id is distinct from c.brand_id or s.channel_id is distinct from c.channel_id or s.location_id is distinct from c.location_id;
  if v_mal > 0 then
    raise exception 'C11b-2: % venta(s) no han quedado como tocaba. Vuelta atrás de toda la transacción.', v_mal;
  end if;
  select md5(coalesce(string_agg(m.id::text, ',' order by m.id), '')) into v_mov_despues
    from public.stock_movement m where m.source_id in (select id from c11b_lista);
  if v_mov_despues is distinct from v_mov_antes then
    raise exception 'C11b-2: los movimientos de stock de esas ventas han cambiado. Vuelta atrás de toda la transacción.';
  end if;
  if exists (select 1 from public.sale_line l where l.sale_id in (select id from c11b_lista)
                and coalesce(l.line_type, 'product') = 'product' and l.cost_computed_at is null) then
    raise exception 'C11b-2: alguna línea sigue sin su coste calculado. Vuelta atrás de toda la transacción.';
  end if;

  -- Los días que quedan por asentar, propuestos (como el cron cada hora).
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  v_p := public.conta_proponer_dias(v_e, now(), 'Cierre del día (C11b)');
  if coalesce((v_p->>'fallos')::int, 0) > 0 then
    raise exception 'C11b-2: proponer los días ha fallado: %. Vuelta atrás de toda la transacción.', v_p->'errores';
  end if;

  raise notice 'C11b-2: % ventas cerradas como vendidas (sin tocar su stock); días propuestos: %.', v_n, v_p;
end $$;
