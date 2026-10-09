-- ============================================================================
-- Vuelta atrás de C05 · 1 · lo que se guarda (20261014T0100_c05_libros.sql).
-- Quita las funciones y las tablas nuevas. PARA si hay algo que se perdería:
-- un mapeo propio de alguna empresa, un bien de inversión o un cierre
-- preparado. La 0120 (disparador) y la 0110 (serie) se deshacen antes.
-- ============================================================================
do $$ begin
  if to_regclass('public.annual_accounts_mapping') is not null and exists (select 1 from public.annual_accounts_mapping where company_id is not null) then
    raise exception 'Vuelta atrás C05: hay empresas con su propio mapeo de cuentas anuales; se perderían.';
  end if;
  if to_regclass('public.investment_good') is not null and exists (select 1 from public.investment_good) then
    raise exception 'Vuelta atrás C05: hay bienes de inversión dados de alta; se perderían.';
  end if;
  if to_regclass('public.fiscal_year_closing') is not null and exists (select 1 from public.fiscal_year_closing where status <> 'abierto') then
    raise exception 'Vuelta atrás C05: hay cierres preparados o hechos; se perdería su enlace.';
  end if;
end $$;
drop function if exists public.conta_cierre_reabrir(uuid, text);
drop function if exists public.conta_cierre_cerrar(uuid);
drop function if exists public.conta_cierre_enlazar(uuid, uuid, uuid, uuid);
drop function if exists public.conta_mapeo_volver_al_estandar(uuid, text, text, text);
drop function if exists public.conta_mapeo_cambiar(uuid, text, text, text, text, text, text);
drop function if exists public.conta_saldos_cuentas(uuid, date, date, boolean);
drop function if exists public.conta_vat_book_desde_asiento(uuid);
drop table if exists public.fiscal_year_closing;
drop table if exists public.investment_good_regularization;
drop table if exists public.investment_good;
drop table if exists public.vat_book_entry;
drop table if exists public.annual_accounts_mapping_change;
drop table if exists public.annual_accounts_mapping;
drop table if exists public.annual_accounts_line;
