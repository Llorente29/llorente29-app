-- Vuelta atrás de 20261019T0170_cierre_a_las_dos.sql.
--
-- Deja la hora de serie en 6:00 y las tres funciones como estaban
-- (20261016T0100 y 0130, copiadas de lo vigente el 12/10: md5 7d029e66…,
-- b9ced117… y 587d12a8…). No toca la hora guardada de ninguna empresa (la de
-- Foodint la devuelve la vuelta atrás de la 0175).

alter table public.company_tax_profile alter column sales_day_close_time set default '06:00';
comment on column public.company_tax_profile.sales_day_close_time is
  'Cierre del día: a esta hora (de Madrid) se dan por terminadas las ventas del día anterior. Un pedido de marca propia que siga abierto se cierra como no confirmado. Vacío = 6:00.';

create or replace function public.conta_ultimo_dia_cerrado(p_company uuid, p_ahora timestamp with time zone default now())
 returns date
 language sql
 stable
 set search_path to 'public'
as $function$
  select case when (p_ahora at time zone 'Europe/Madrid')::time >= coalesce(t.sales_day_close_time, time '06:00')
              then (p_ahora at time zone 'Europe/Madrid')::date - 1
              else (p_ahora at time zone 'Europe/Madrid')::date - 2 end
    from public.company c
    left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company
$function$;
comment on function public.conta_ultimo_dia_cerrado(uuid, timestamptz) is
  'Cierre del día: el último día ya cerrado de la empresa a esta hora (Madrid). A las 17:16 del 09/10 con cierre a las 6:00 → 08/10; a las 5:30 del 09/10 → 07/10.';

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
  select c.account_id, coalesce(t.sales_day_close_time, time '06:00')
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

create or replace function public.conta_propuestos_antes_del_cierre(p_company uuid default null::uuid)
 returns table(entry_id uuid, company_id uuid, location_id uuid, sales_day date, created_at timestamp with time zone, status text, number integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  select e.id, e.company_id, d.location_id, d.sales_day, e.created_at, e.status, e.number
    from public.journal_entry e
    join public.sales_day_summary d on d.entry_id = e.id
    left join public.company_tax_profile t on t.company_id = e.company_id
   where e.source_type = 'sales_day'
     and e.status = 'propuesto'
     and (p_company is null or e.company_id = p_company)
     -- Propuesto antes de la hora de cierre de su día (6:00 de Madrid del día siguiente).
     and e.created_at < (((d.sales_day + 1)::timestamp + coalesce(t.sales_day_close_time, time '06:00')) at time zone 'Europe/Madrid')
$function$;
