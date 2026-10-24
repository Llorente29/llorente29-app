-- Vuelta atrás de 20261023T2045_c11_cierre_marca_para_revisar.sql (C11).
--
-- Devuelve conta_cerrar_dias a su cuerpo de la 0170 byte a byte (md5
-- 7d1dd3c15193d716616fe268e3a5bab6): OJO, con eso el cierre del día VUELVE A
-- ANULAR pedidos. Solo si Julio lo pide.
-- La columna sales_day_close_log.accion se queda (admite nulos y nadie más la
-- lee): borrarla perdería qué se marcó para revisar y qué se restauró.

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
  v_n       int;
  v_importe numeric;
begin
  select c.account_id, coalesce(t.sales_day_close_time, time '02:00')
    into v_account, v_hora
    from public.company c left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company;
  if v_account is null then
    raise exception 'Cierre del día: la empresa % no existe.', p_company;
  end if;
  v_hasta := public.conta_ultimo_dia_cerrado(p_company, p_ahora);

  with cand as (
    -- skip locked: un pedido que en este mismo instante está moviendo la
    -- plataforma no se pisa; lo coge la pasada de la hora siguiente.
    select s.id from public.sale s
     where s.id in (select x.sale_id from public.conta_por_cerrar(p_company, p_ahora) x)
       and s.status = 'open'
     for update of s skip locked
  ),
  cerrados as (
    update public.sale s
       set status = 'cancelled',
           unconfirmed_at = now(),
           cancelled_at = now(),
           cancel_reason = format('No confirmado por la plataforma al cierre del día (%s)', to_char(v_hora, 'FMHH24:MI')),
           updated_at = now()
      from cand
     where s.id = cand.id
    returning s.id, s.account_id, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date as dia,
              coalesce(s.platform_order_code, s.pos_short_code, s.external_ref) as codigo, s.total, s.order_status, s.delivery_state
  ),
  rastro as (
    insert into public.sales_day_close_log
      (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, delivery_state)
    select account_id, p_company, id, location_id, dia, v_hasta, v_hora, codigo, total, order_status, delivery_state
      from cerrados
    on conflict (sale_id) do nothing
    returning total
  )
  select count(*), coalesce(sum(total), 0) into v_n, v_importe from rastro;

  return jsonb_build_object('company_id', p_company, 'cerrado_hasta', v_hasta, 'hora', to_char(v_hora, 'HH24:MI'),
                            'cerrados', v_n, 'importe', v_importe);
end
$function$;

do $$
begin
  if md5((select prosrc from pg_proc where oid = 'public.conta_cerrar_dias(uuid, timestamptz)'::regprocedure)) <> '7d1dd3c15193d716616fe268e3a5bab6' then
    raise exception 'Vuelta atrás C11-1: conta_cerrar_dias no ha quedado como en la 0170.';
  end if;
end $$;
