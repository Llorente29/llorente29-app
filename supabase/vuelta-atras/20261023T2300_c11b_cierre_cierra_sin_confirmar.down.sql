-- Vuelta atrás de 20261023T2300_c11b_cierre_cierra_sin_confirmar.sql (C11b).
--
-- conta_cerrar_dias vuelve al freno de la 2045 byte a byte (md5
-- 12743c982825a9ee11d970b6d095c275: no anula, marca «para revisar»), y se
-- quita conta_sin_confirmar_no_cobrados. El CHECK de accion vuelve al de la
-- 2045 solo si ninguna fila usa los valores nuevos; si alguna los usa, se
-- queda ancho (las filas cuentan lo que pasó). Lo que la regla nueva ya cerró
-- o anuló NO se deshace aquí: son ventas que ya están en su día.

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

  -- C11: los mismos candidatos, pero el pedido NO se toca (ni status, ni
  -- unconfirmed_at, ni cancelled_at). Solo se apunta para revisar.
  with cand as (
    select x.sale_id, x.location_id, x.sales_day, x.order_code, x.total, x.order_status, x.delivery_state, s.account_id
      from public.conta_por_cerrar(p_company, p_ahora) x
      join public.sale s on s.id = x.sale_id
     where s.status = 'open'
  ),
  rastro as (
    insert into public.sales_day_close_log
      (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, delivery_state, accion)
    select account_id, p_company, sale_id, location_id, sales_day, v_hasta, v_hora, order_code, total, order_status, delivery_state, 'revisar'
      from cand
    on conflict (sale_id) do nothing
    returning total
  )
  select count(*), coalesce(sum(total), 0) into v_n, v_importe from rastro;

  return jsonb_build_object('company_id', p_company, 'cerrado_hasta', v_hasta, 'hora', to_char(v_hora, 'HH24:MI'),
                            'cerrados', 0, 'para_revisar', v_n, 'importe', v_importe);
end
$function$;

drop function if exists public.conta_sin_confirmar_no_cobrados(uuid);

do $$
begin
  if not exists (select 1 from public.sales_day_close_log where accion in ('anulado', 'cerrado_sin_confirmar')) then
    alter table public.sales_day_close_log drop constraint if exists sales_day_close_log_accion;
    alter table public.sales_day_close_log
      add constraint sales_day_close_log_accion check (accion is null or accion in ('revisar', 'restaurado'));
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.conta_cerrar_dias(uuid, timestamptz)'::regprocedure)) <> '12743c982825a9ee11d970b6d095c275' then
    raise exception 'Vuelta atrás C11b-1: conta_cerrar_dias no ha quedado como en la 2045.';
  end if;
end $$;
