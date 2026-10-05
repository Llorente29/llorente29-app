-- supabase/vuelta-atras/20261008T0120_c02c_lectura.down.sql
--
-- Deshace 20261008T0120: quita a conta_lectura la lectura de company_chart_import (si existen los dos).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') and to_regclass('public.company_chart_import') is not null then
    revoke select on table public.company_chart_import from conta_lectura;
  end if;
end $$;
