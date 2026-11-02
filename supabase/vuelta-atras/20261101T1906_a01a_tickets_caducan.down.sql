-- supabase/vuelta-atras/20261101T1906_a01a_tickets_caducan.down.sql
-- Vuelta atrás del A01a: db_health_watchdog como estaba (del respaldo, con su
-- huella), fuera print_job_vigia, print_job_aviso y el disparador, los
-- caducados vuelven a «pending» (también los 17 de Alcalá) y el CHECK y las
-- columnas como antes.
lock table public.print_job in access exclusive mode;
select public._restaurar_funcion('public.db_health_watchdog()', '20261101T1906_a01a_tickets_caducan');
drop function if exists public.print_job_vigia();
drop table if exists public.print_job_aviso;
drop trigger if exists print_job_caducado_no_vuelve on public.print_job;
drop function if exists public._print_job_caducado_no_vuelve();
update public.print_job set status = 'pending', expired_at = null, expire_reason = null where status = 'expired';
alter table public.print_job drop constraint if exists print_job_status_check;
alter table public.print_job add constraint print_job_status_check
  check (status = any (array['pending', 'sent', 'done', 'error', 'cancelled']));
alter table public.print_job drop column if exists expired_at, drop column if exists expire_reason;
