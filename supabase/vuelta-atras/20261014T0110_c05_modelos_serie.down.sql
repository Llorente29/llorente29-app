-- ============================================================================
-- Vuelta atrás de C05 · 2 · la serie de los modelos. Quita solo la serie
-- (filas sin empresa); el mapeo propio de una empresa, si lo hay, para antes.
-- ============================================================================
do $$ begin
  if exists (select 1 from public.annual_accounts_mapping where company_id is not null) then
    raise exception 'Vuelta atrás C05 · serie: hay mapeos propios que apuntan a estas líneas.';
  end if;
end $$;
delete from public.annual_accounts_mapping where company_id is null;
delete from public.annual_accounts_line;
