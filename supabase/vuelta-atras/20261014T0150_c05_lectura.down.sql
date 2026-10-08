-- ============================================================================
-- Vuelta atrás de C05 · lectura: quita a conta_lectura SOLO las 5 tablas que
-- este fichero le dio por primera vez (las otras 4 ya las tenía: quitarlas
-- rompería los agentes de antes). Sin ellas, la parte C05 del agente falla con
-- «permission denied»: es lo que había.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí: nada que quitar.';
    return;
  end if;
  revoke select on table public.annual_accounts_line, public.annual_accounts_mapping, public.annual_accounts_choice,
    public.vat_book_entry, public.fiscal_year_closing from conta_lectura;
end $$;
