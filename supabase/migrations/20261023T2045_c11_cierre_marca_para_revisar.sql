-- C11 · 1 · El cierre del día ya no anula ventas: solo las marca «para revisar» (Julio, 23/10).
--
-- cambia: public.conta_cerrar_dias · prueba: supabase/staging/sql/20261023_c11_cierre_no_anula_prueba.sql
-- cambia: public.sales_day_close_log · prueba: supabase/staging/sql/20261023_c11_cierre_no_anula_prueba.sql
--
-- POR QUÉ: conta_cerrar_dias (cron «conta-cierre-del-dia», cada hora a los
-- 7 minutos) ponía status = 'cancelled' a todo pedido de Folvy que seguía
-- «open» a la hora de cierre de su día. La plataforma los entregaba después
-- y quedaban anulados con order_status = 'completed': medido el 23/10, 32 de
-- Foodint (30 de Glovo y 2 de Uber, del 06/10 al 20/10). Una función de
-- Sumied no cambia el estado de un pedido de Folvy (auditoría C09).
--
-- LO QUE CAMBIA:
--   1. sales_day_close_log.accion (nueva, admite nulos): 'revisar' para lo que
--      apunta el cierre desde hoy; 'restaurado' para las que devuelve el segundo fichero
--      (20261023T2050). Las filas de antes quedan con NULL = «anulado» (lo que
--      hacía la función hasta hoy). No se toca ninguna fila aquí.
--   2. conta_cerrar_dias, misma firma: los mismos candidatos (conta_por_cerrar,
--      status 'open'), pero NO hace update de public.sale. Solo apunta cada uno
--      en sales_day_close_log con accion = 'revisar' (una vez por pedido: la
--      clave única de sale_id). Devuelve 'para_revisar' e 'importe', y
--      'cerrados' = 0 para quien lo lea.
--
-- No cambia: el cron, conta_cierre_del_dia_todas, conta_por_cerrar ni
-- conta_proponer_dias. Los asientos de ventas siguen contando solo lo
-- 'closed': un pedido marcado para revisar no entra en su día hasta que Folvy
-- lo cierre (como antes, que tampoco entraba anulado).
-- El cuerpo de partida es el de la 0170 (md5 7d1dd3c1… en producción el 23/10,
-- igual que el repositorio). Lo nuevo va marcado con «C11».
-- Vuelta atrás: supabase/vuelta-atras/20261023T2045_c11_cierre_marca_para_revisar.down.sql

alter table public.sales_day_close_log
  add column if not exists accion text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_day_close_log_accion'
                   and conrelid = 'public.sales_day_close_log'::regclass) then
    alter table public.sales_day_close_log
      add constraint sales_day_close_log_accion check (accion is null or accion in ('revisar', 'restaurado'));
  end if;
end $$;

comment on column public.sales_day_close_log.accion is
  'C11 (23/10). NULL = anulado por el cierre del día (hasta el 23/10). revisar = el cierre lo encontró abierto y lo deja para revisar, sin tocar el pedido. restaurado = anulado por error y devuelto a open (20261023T2050).';

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

comment on function public.conta_cerrar_dias(uuid, timestamptz) is
  'Cierre del día (C04b; C11, 23/10): los pedidos que siguen abiertos a la hora de cierre de su día se apuntan en sales_day_close_log con accion = revisar. No cambia el pedido: el estado de un pedido es de Folvy.';
revoke execute on function public.conta_cerrar_dias(uuid, timestamptz) from public, anon, authenticated;
