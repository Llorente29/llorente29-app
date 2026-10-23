-- C11b · 1 · El cierre del día cierra como vendidos los pedidos de plataforma que siguen abiertos (Julio, 23/10).
--
-- cambia: public.conta_cerrar_dias · prueba: supabase/staging/sql/20261023_c11b_cierre_sin_confirmar_prueba.sql
-- cambia: public.sales_day_close_log · prueba: supabase/staging/sql/20261023_c11b_cierre_sin_confirmar_prueba.sql
--
-- POR QUÉ: «Nada debe quedar sin contabilizar por no estar confirmado.» Hasta
-- el C11 el cierre anulaba lo que seguía abierto (y se perdían ventas
-- entregadas); el freno del C11 (2045) dejó de anular y solo lo marcaba «para
-- revisar», que bloquea el día. La regla nueva, a la hora de cierre de su día:
--
--   · Pedido de plataforma (source hubrise o lastapp) que sigue abierto:
--       - order_status cancelled, rejected o delivery_failed → fuera: se anula
--         como hacía el cierre antes (status cancelled, unconfirmed_at,
--         cancel_reason; el stock no se devuelve, como entonces) y se apunta
--         accion = 'anulado'.
--       - cualquier otro → se CIERRA como vendido: status closed, closed_at =
--         la hora de entrega si la hay (delivered_at; si no, la de entrega al
--         rider o la de «listo»). NO se llama a close_sale: el coste de cada
--         línea solo se calcula si falta (compute_sale_line_cost, que solo
--         escribe esa línea) y el consumo solo se genera si la venta no tiene
--         ningún movimiento de stock (si ya consumió al aceptarse, no se toca).
--         Se apunta accion = 'cerrado_sin_confirmar'. Entra en el asiento de
--         ventas de su día como cualquier venta cerrada.
--   · Pedido que no es de plataforma (TPV, tienda propia): no se toca; se
--     apunta 'revisar' como en el freno.
--
-- Y el aviso: conta_sin_confirmar_no_cobrados(empresa) — los cerrados sin
-- confirmar que una liquidación de su canal ya cubre (su día dentro del
-- periodo) y no traen ese pedido cobrado: hay que hacer el ajuste.
--
-- No disparan nada al cerrar: el update solo cambia status y closed_at
-- (trg_sale_close_on_complete y el empuje a la plataforma miran order_status;
-- la rama de anulación del consumo exige status 'cancelled').
-- Lo que apuntó el freno «para revisar» y sigue abierto se procesa con la
-- regla nueva (su fila pasa de 'revisar' a lo que toque).
-- El cuerpo de partida es el de la 2045 (md5 12743c98… en producción el 23/10).
-- Vuelta atrás: supabase/vuelta-atras/20261023T2300_c11b_cierre_cierra_sin_confirmar.down.sql

alter table public.sales_day_close_log drop constraint if exists sales_day_close_log_accion;
alter table public.sales_day_close_log
  add constraint sales_day_close_log_accion
  check (accion is null or accion in ('revisar', 'restaurado', 'anulado', 'cerrado_sin_confirmar'));

comment on column public.sales_day_close_log.accion is
  'C11/C11b (23/10). NULL = anulado por el cierre del día (hasta el 23/10). anulado = cancelado en la plataforma, anulado al cierre. cerrado_sin_confirmar = cerrado como vendido al cierre sin confirmación de la plataforma. revisar = abierto al cierre y no es de plataforma: no se toca. restaurado = anulado por error y devuelto (C11).';

create or replace function public.conta_cerrar_dias(p_company uuid, p_ahora timestamp with time zone default now())
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_account uuid;
  v_hora    time;
  v_hasta   date;
  r         record;
  v_accion  text;
  v_l       uuid;
  v_cerrados int := 0; v_anulados int := 0; v_revisar int := 0; v_consumos int := 0;
  v_importe numeric := 0;
begin
  select c.account_id, coalesce(t.sales_day_close_time, time '02:00')
    into v_account, v_hora
    from public.company c left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company;
  if v_account is null then
    raise exception 'Cierre del día: la empresa % no existe.', p_company;
  end if;
  v_hasta := public.conta_ultimo_dia_cerrado(p_company, p_ahora);

  -- C11b: skip locked, como antes: un pedido que en este instante mueve la
  -- plataforma no se pisa; lo coge la pasada de la hora siguiente.
  for r in
    select x.sale_id, x.location_id, x.sales_day, x.order_code, x.total, x.order_status, x.delivery_state, s.account_id, s.source
      from public.conta_por_cerrar(p_company, p_ahora) x
      join public.sale s on s.id = x.sale_id
     where s.status = 'open'
     for update of s skip locked
  loop
    if coalesce(r.source, '') not in ('hubrise', 'lastapp') then
      v_accion := 'revisar'; v_revisar := v_revisar + 1;
    elsif coalesce(r.order_status, '') in ('cancelled', 'rejected', 'delivery_failed') then
      update public.sale s
         set status = 'cancelled', unconfirmed_at = now(), cancelled_at = now(),
             cancel_reason = format('Cancelado en la plataforma (%s), anulado al cierre del día (%s)', r.order_status, to_char(v_hora, 'FMHH24:MI')),
             updated_at = now()
       where s.id = r.sale_id;
      v_accion := 'anulado'; v_anulados := v_anulados + 1;
    else
      update public.sale s
         set status = 'closed', closed_at = coalesce(s.closed_at, s.delivered_at, s.handed_to_courier_at, s.ready_at, now()), updated_at = now()
       where s.id = r.sale_id;
      for v_l in select l.id from public.sale_line l
                  where l.sale_id = r.sale_id and coalesce(l.line_type, 'product') = 'product' and l.cost_computed_at is null loop
        perform public.compute_sale_line_cost(v_l);
      end loop;
      if not exists (select 1 from public.stock_movement m where m.source_id = r.sale_id) then
        perform public.generate_sale_consumption(r.sale_id);
        v_consumos := v_consumos + 1;
      end if;
      v_accion := 'cerrado_sin_confirmar'; v_cerrados := v_cerrados + 1; v_importe := v_importe + coalesce(r.total, 0);
    end if;

    insert into public.sales_day_close_log as g
      (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, delivery_state, accion)
    values (r.account_id, p_company, r.sale_id, r.location_id, r.sales_day, v_hasta, v_hora, r.order_code, r.total, r.order_status, r.delivery_state, v_accion)
    on conflict (sale_id) do update
       set accion = excluded.accion, closed_through = excluded.closed_through, close_time = excluded.close_time,
           order_status = excluded.order_status, delivery_state = excluded.delivery_state, closed_at = now()
     where g.accion = 'revisar' and excluded.accion <> 'revisar';
  end loop;

  return jsonb_build_object('company_id', p_company, 'cerrado_hasta', v_hasta, 'hora', to_char(v_hora, 'HH24:MI'),
                            'cerrados', v_cerrados, 'importe', v_importe, 'anulados', v_anulados,
                            'para_revisar', v_revisar, 'consumos_generados', v_consumos);
end
$function$;

comment on function public.conta_cerrar_dias(uuid, timestamptz) is
  'Cierre del día (C04b; C11b, 23/10): a la hora de cierre de su día, un pedido de plataforma abierto se cierra como vendido (sin volver a consumir si ya consumió) salvo que la plataforma lo tenga cancelled, rejected o delivery_failed (entonces se anula); lo que no es de plataforma se apunta para revisar. Todo queda en sales_day_close_log.';
revoke execute on function public.conta_cerrar_dias(uuid, timestamptz) from public, anon, authenticated;

-- El aviso: cerrados sin confirmar que una liquidación de su canal ya cubre y no cobra.
create or replace function public.conta_sin_confirmar_no_cobrados(p_company uuid)
 returns table(sale_id uuid, location_id uuid, dia date, codigo text, canal_id uuid, total numeric, settlement_ref text, settlement_date date)
 language sql
 stable
 set search_path to 'public'
as $function$
  select l.sale_id, s.location_id, l.sales_day, l.order_code, s.channel_id, s.total, cs.settlement_ref, cs.settlement_date
    from public.sales_day_close_log l
    join public.company c on c.id = p_company and c.account_id = l.account_id
    join public.sale s on s.id = l.sale_id and s.account_id = l.account_id
    join lateral (
      select x.settlement_ref, x.settlement_date
        from public.channel_settlement x
       where x.account_id = s.account_id and x.channel_id = s.channel_id
         and (x.location_id is null or x.location_id = s.location_id)
         and not coalesce(x.is_reference, false)
         and l.sales_day between coalesce(x.period_from, x.proposed_period_from) and coalesce(x.period_to, x.proposed_period_to)
       order by x.settlement_date desc nulls last
       limit 1) cs on true
   where l.company_id = p_company and l.accion = 'cerrado_sin_confirmar' and s.status = 'closed'
     and not exists (select 1 from public.channel_settlement_order co
                      where co.sale_id = s.id and co.account_id = s.account_id and coalesce(co.matched, false))
     and not exists (select 1 from public.journal_dismissal d
                      where d.company_id = p_company and d.source_type = 'sales_adjustment' and d.source_key = s.id::text)
   order by l.sales_day, l.order_code
$function$;

comment on function public.conta_sin_confirmar_no_cobrados(uuid) is
  'C11b (23/10). Pedidos cerrados sin confirmar al cierre del día que una liquidación de su canal ya cubre (su día dentro del periodo) y no trae cobrados: aviso para hacer el ajuste.';
revoke execute on function public.conta_sin_confirmar_no_cobrados(uuid) from public, anon;
grant execute on function public.conta_sin_confirmar_no_cobrados(uuid) to authenticated;
