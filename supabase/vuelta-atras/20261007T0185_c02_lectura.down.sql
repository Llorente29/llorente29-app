-- supabase/vuelta-atras/20261007T0185_c02_lectura.down.sql
--
-- Deshace 20261007T0185: quita a conta_lectura el SELECT sobre las cuatro
-- tablas del C02, si el rol existe. Si las tablas ya no están (porque se
-- deshizo antes la 0120), no hay nada que quitar.
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then return; end if;
  foreach t in array array['pgc_account', 'company_account', 'company_account_link', 'company_account_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke select on table public.%I from conta_lectura', t);
    end if;
  end loop;
end $$;
