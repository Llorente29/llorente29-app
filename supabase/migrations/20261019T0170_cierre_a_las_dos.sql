-- C04b · Respuesta 4 · El día se cierra a las 2:00 (Julio, 12/10).
--
-- cambia: public.conta_ultimo_dia_cerrado · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
-- cambia: public.conta_cerrar_dias · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
-- cambia: public.conta_propuestos_antes_del_cierre · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
-- cambia: public.company_tax_profile · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
--
-- POR QUÉ: «Los cierres diarios pasan a las 02:00 (hora de Madrid), para que
-- entren todas las ventas del día.» El día D se cierra a las 2:00 del día
-- D + 1, también con el cambio de hora.
--
-- LO QUE CAMBIA (solo la hora DE SERIE; la de cada empresa es su ajuste, y
-- la de Foodint, que hoy guarda 06:00, la pasa a 02:00 la 0175):
--   1. company_tax_profile.sales_day_close_time: el valor de serie pasa de
--      06:00 a 02:00 (solo el DEFAULT: ninguna fila cambia aquí).
--   2. conta_ultimo_dia_cerrado y conta_cerrar_dias: cuando la empresa no
--      tiene hora, 02:00 en vez de 06:00. Lo demás, copiado de lo vigente
--      (md5 7d029e66… y b9ced117…, iguales en staging y producción el 12/10).
--   3. conta_propuestos_antes_del_cierre: «propuesto antes del cierre de su
--      día» deja de calcular el instante de cierre a mano y pregunta lo mismo
--      que el cierre: ¿estaba ya cerrado ese día cuando se propuso?
--      (conta_ultimo_dia_cerrado en el instante de la propuesta). Con las 6:00
--      daba igual; con las 2:00, NO: la noche del 25/10 las 2:00 pasan dos
--      veces, y «D + 1 a las 2:00 en Madrid» lo lee Postgres como la SEGUNDA
--      (hora de invierno), una hora DESPUÉS de que el cierre ya hubiera
--      cerrado el día con la primera. Un asiento propuesto en esa hora se
--      habría dado por «propuesto antes del cierre» sin serlo. Así, las dos
--      preguntas son la misma y no pueden discrepar.
--
-- No cambia: el cron (cada hora, a los 7 minutos: el día de ayer se cierra a
-- las 2:07 de Madrid), el proponedor (pregunta a conta_ultimo_dia_cerrado),
-- el agente «día cerrado sin resumen o sin asiento a las 24 h» (lee la hora
-- de la empresa) ni el día de cada pedido (el natural de sold_at en Madrid).
-- Vuelta atrás: supabase/vuelta-atras/20261019T0170_cierre_a_las_dos.down.sql

-- 1 · La hora de serie ----------------------------------------------------------------
alter table public.company_tax_profile alter column sales_day_close_time set default '02:00';
comment on column public.company_tax_profile.sales_day_close_time is
  'Cierre del día: a esta hora (de Madrid) se dan por terminadas las ventas del día anterior. Un pedido de marca propia que siga abierto se cierra como no confirmado. Vacío = 2:00.';

-- 2 · El último día cerrado --------------------------------------------------------------
create or replace function public.conta_ultimo_dia_cerrado(p_company uuid, p_ahora timestamp with time zone default now())
 returns date
 language sql
 stable
 set search_path to 'public'
as $function$
  select case when (p_ahora at time zone 'Europe/Madrid')::time >= coalesce(t.sales_day_close_time, time '02:00')
              then (p_ahora at time zone 'Europe/Madrid')::date - 1
              else (p_ahora at time zone 'Europe/Madrid')::date - 2 end
    from public.company c
    left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company
$function$;
comment on function public.conta_ultimo_dia_cerrado(uuid, timestamptz) is
  'Cierre del día: el último día ya cerrado de la empresa a esta hora (Madrid). A las 17:16 del 09/10 con cierre a las 2:00 → 08/10; a las 1:30 del 09/10 → 07/10.';

-- 3 · El cierre de una empresa ---------------------------------------------------------
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

-- 4 · Lo propuesto antes de su cierre ----------------------------------------------------
create or replace function public.conta_propuestos_antes_del_cierre(p_company uuid default null::uuid)
 returns table(entry_id uuid, company_id uuid, location_id uuid, sales_day date, created_at timestamp with time zone, status text, number integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  select e.id, e.company_id, d.location_id, d.sales_day, e.created_at, e.status, e.number
    from public.journal_entry e
    join public.sales_day_summary d on d.entry_id = e.id
   where e.source_type = 'sales_day'
     and e.status = 'propuesto'
     and (p_company is null or e.company_id = p_company)
     -- Propuesto cuando su día aún no estaba cerrado: la MISMA pregunta que
     -- hace el cierre (también la noche en que las 2:00 pasan dos veces).
     and public.conta_ultimo_dia_cerrado(e.company_id, e.created_at) < d.sales_day
$function$;
