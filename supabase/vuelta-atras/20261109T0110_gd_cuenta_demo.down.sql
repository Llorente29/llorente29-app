-- supabase/vuelta-atras/20261109T0110_gd_cuenta_demo.down.sql
--
-- Vuelta atrás de la 0110: quita la cuenta «Gestoría Demo» y todo lo suyo. Solo
-- esa cuenta: por su id, y solo si es de demostración. Casi todo cuelga de la
-- cuenta con «on delete cascade»; lo que no (lo que escriben los agentes, los
-- avisos descartados, las invitaciones de asesoría…), se quita antes, solo de
-- esta cuenta.

do $$ begin
  if exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo is not true) then
    raise exception 'GD: la cuenta de000000-…-a0 no es de demostración: no se borra.';
  end if;
end $$;
delete from public.agent_run_log           where account_id         = 'de000000-0000-4000-8000-0000000000a0';
delete from public.pending_dismissal       where account_id         = 'de000000-0000-4000-8000-0000000000a0';
delete from public.conta_puerta_recibido   where account_id         = 'de000000-0000-4000-8000-0000000000a0';
delete from public.registro_jornada_enlace where account_id         = 'de000000-0000-4000-8000-0000000000a0';
delete from public.company_tax_presenter   where advisor_account_id = 'de000000-0000-4000-8000-0000000000a0';
delete from public.tax_advisor_invitation  where advisor_account_id = 'de000000-0000-4000-8000-0000000000a0';
delete from public.impersonation_sessions  where target_account_id  = 'de000000-0000-4000-8000-0000000000a0';
delete from public.platform_audit_log      where target_account_id  = 'de000000-0000-4000-8000-0000000000a0';
delete from public.locations               where account_id         = 'de000000-0000-4000-8000-0000000000a0';
delete from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo is true;
