-- 20260705T1210_offers_agent_rpcs.sql
-- MOTOR DE OFERTAS — RPCs del agente (versionado a posteriori, 05/07/2026).
-- Cuerpos = pg_get_functiondef de la BD viva, byte a byte (RECON 05/07).
-- REGLA DE HIERRO: solo CREATE + GRANT + COMMIT. Ninguna llamada de prueba dentro
-- (SECURITY DEFINER + auth.uid() null en SQL Editor abortaría la transacción).
-- ACLs reproducidas de la BD viva:
--   agent_sales_signal      -> authenticated + service_role (SIN anon)
--   claim_promo_push_jobs   -> anon + authenticated + service_role (el robot llama con anon key)
--   report_promo_push_job   -> anon + authenticated + service_role

begin;

-- ── 1. agent_sales_signal — señal de ventas por marca×canal:
--      pulso 7d, media 28d y PICO histórico (mejor mes de los últimos 12).
CREATE OR REPLACE FUNCTION public.agent_sales_signal(p_account_id uuid)
 RETURNS TABLE(brand_id uuid, channel_name text, sales_7d numeric, avg_28d numeric, peak_daily numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with daily as (
    select s.brand_id, sc.name as channel_name,
           date_trunc('month', s.created_at) as mes,
           count(*) / greatest(extract(day from
             least(date_trunc('month', s.created_at) + interval '1 month', now())
             - date_trunc('month', s.created_at))::numeric, 1) as ventas_dia
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '12 months'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name, date_trunc('month', s.created_at)
  ),
  peak as (
    select brand_id, channel_name, max(ventas_dia) as peak_daily
    from daily group by brand_id, channel_name
  ),
  reciente as (
    select s.brand_id, sc.name as channel_name,
      count(*) filter (where s.created_at >= now() - interval '7 days') / 7.0  as s7,
      count(*) filter (where s.created_at >= now() - interval '28 days') / 28.0 as s28
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '28 days'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name
  )
  select r.brand_id, r.channel_name, round(r.s7,2), round(r.s28,2),
         round(coalesce(p.peak_daily,0),2)
  from reciente r
  left join peak p on p.brand_id = r.brand_id and p.channel_name = r.channel_name
  where r.brand_id is not null;
$function$;

revoke all on function public.agent_sales_signal(uuid) from public, anon;
grant execute on function public.agent_sales_signal(uuid) to authenticated, service_role;

-- ── 2. claim_promo_push_jobs — el robot reclama trabajos por secreto
--      (FOR UPDATE SKIP LOCKED; reintentos hasta 5; patrón claim_print_jobs).
CREATE OR REPLACE FUNCTION public.claim_promo_push_jobs(p_secret text, p_platform text, p_limit integer DEFAULT 3)
 RETURNS SETOF promo_push_job
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_acc uuid;
begin
  select account_id into v_acc from offers_agent_config
   where push_agent_secret = p_secret and push_agent_secret is not null;
  if v_acc is null then raise exception 'secreto inválido'; end if;
  return query
    update promo_push_job j
       set status='sent', attempts=attempts+1, updated_at=now()
     where j.id in (
       select id from promo_push_job
        where account_id=v_acc and platform=p_platform and status in ('pending','error')
          and attempts < 5
        order by created_at
        for update skip locked
        limit p_limit)
    returning j.*;
end $function$;

revoke all on function public.claim_promo_push_jobs(text, text, integer) from public;
grant execute on function public.claim_promo_push_jobs(text, text, integer) to anon, authenticated, service_role;

-- ── 3. report_promo_push_job — el robot reporta el resultado de un trabajo
CREATE OR REPLACE FUNCTION public.report_promo_push_job(p_secret text, p_job_id uuid, p_ok boolean, p_external_ref text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_acc uuid;
begin
  select account_id into v_acc from offers_agent_config
   where push_agent_secret = p_secret and push_agent_secret is not null;
  if v_acc is null then raise exception 'secreto inválido'; end if;
  update promo_push_job
     set status = case when p_ok then 'done' else 'error' end,
         external_ref = coalesce(p_external_ref, external_ref),
         last_error = p_error, updated_at = now()
   where id = p_job_id and account_id = v_acc;
end $function$;

revoke all on function public.report_promo_push_job(text, uuid, boolean, text, text) from public;
grant execute on function public.report_promo_push_job(text, uuid, boolean, text, text) to anon, authenticated, service_role;

commit;
