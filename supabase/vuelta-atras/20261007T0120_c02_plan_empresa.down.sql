-- supabase/vuelta-atras/20261007T0120_c02_plan_empresa.down.sql
--
-- Deshace 20261007T0120_c02_plan_empresa.sql: quita el plan de cada empresa
-- (cuentas, enlaces y su registro) y las funciones, y devuelve la longitud a
-- 4–12. Lo que se pierde es solo lo que trajo esa migración: los planes
-- activados y sus subcuentas. Antes de borrar, cuenta cuántos hay por empresa.
do $$
declare r record;
begin
  for r in select company_id, count(*) n from public.company_account group by company_id loop
    raise notice 'Empresa %: se pierden % cuentas de su plan contable.', r.company_id, r.n;
  end loop;
end $$;

drop function if exists public.company_chart_set_digits(uuid, int, text);
drop function if exists public.company_account_link_set(uuid, text, text, text, uuid, text, text);
drop function if exists public.company_account_set_hidden(uuid, boolean, text);
drop function if exists public.company_account_add(uuid, text, text, text, text, text, text, text);
drop function if exists public.company_chart_activate(uuid, boolean, text);
drop function if exists public.company_account_siguiente(uuid, text, int);
drop function if exists public.company_account_length_locked(uuid);
drop table if exists public.company_account_log;
drop table if exists public.company_account_link;
drop table if exists public.company_account;
drop function if exists public.company_account_no_ocultar_enlazada();
drop function if exists public.company_account_misma_cuenta();

alter table public.company_tax_profile drop constraint if exists company_tax_profile_account_digits_check;
alter table public.company_tax_profile add constraint company_tax_profile_account_digits_check check (account_digits between 4 and 12);
