-- 20260705T1800_push_job_reliability.sql
-- FIABILIDAD DE LA COLA DE PROMOS (05/07/2026, veredicto Julio: "deja de ser fiable").
-- La familia de fallos del día (duplicados, vuelos zombis, frenos ignorados) se cierra
-- con invariantes, no con parches. Aquí los dos del lado BD (el robot v3.18 lleva los suyos):
--   (1) report_promo_push_job SOLO actualiza jobs que sigan en 'sent': un job matado por
--       el operador (status='error' manual) queda matado aunque un vuelo viejo del robot
--       intente reportar encima. El freno del operador es definitivo.
--   (2) get_promo_push_job_status: RPC mínima para el KILL-SWITCH del robot — antes de
--       cada POS y del clic final de Crear, el robot relee el estado; si no es 'sent',
--       aborta. Misma puerta de secreto que claim/report.
-- REGLA SQL de la casa: funciones SECURITY DEFINER — crear con BEGIN/COMMIT solos,
-- verificar DESPUÉS y por separado, jamás ejecutarlas en la misma transacción.

begin;

-- (1) El report no resucita muertos
create or replace function public.report_promo_push_job(
  p_secret text, p_job_id uuid, p_ok boolean,
  p_external_ref text default null, p_error text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_acc uuid;
begin
  select account_id into v_acc from offers_agent_config
   where push_agent_secret = p_secret and push_agent_secret is not null;
  if v_acc is null then raise exception 'secreto inválido'; end if;
  update promo_push_job
     set status = case when p_ok then 'done' else 'error' end,
         external_ref = coalesce(p_external_ref, external_ref),
         last_error = p_error, updated_at = now()
   where id = p_job_id and account_id = v_acc
     and status = 'sent';  -- v3.18: solo vuelos vivos; un job matado queda matado
end $function$;

-- (2) Estado del job para el kill-switch del robot
create or replace function public.get_promo_push_job_status(p_secret text, p_job_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_acc uuid; v_status text;
begin
  select account_id into v_acc from offers_agent_config
   where push_agent_secret = p_secret and push_agent_secret is not null;
  if v_acc is null then raise exception 'secreto inválido'; end if;
  select status into v_status from promo_push_job
   where id = p_job_id and account_id = v_acc;
  return v_status;
end $function$;

revoke all on function public.get_promo_push_job_status(text, uuid) from public;
grant execute on function public.get_promo_push_job_status(text, uuid) to anon, authenticated, service_role;

commit;
