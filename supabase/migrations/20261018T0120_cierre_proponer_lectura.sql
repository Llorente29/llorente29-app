-- ============================================================================
-- Cierre del día · 2 — LO QUE LEE EL AGENTE «LIBRO DIARIO», para conta_lectura
-- ----------------------------------------------------------------------------
-- La comprobación nueva del agente (dia_sin_asiento, scripts/conta/agente-libro.sql)
-- nombra public.journal_dismissal: un día descartado no se cuenta como día sin
-- asiento. Las demás tablas que lee (company, company_tax_profile, sale, brand,
-- fiscal_year, fiscal_period_lock, company_account, sales_day_summary,
-- journal_entry) ya las tenía de 20261012T0050_c04r_lectura.sql.
-- Medido en producción el 11/10 (solo lectura): has_table_privilege da true
-- también para journal_dismissal; se da EXPLÍCITO para que el fichero diga qué
-- usa el rol (la prueba del analizador lo exige).
--
-- Solo select. conta_lectura sigue siendo de solo lectura.
-- En staging el rol no existe: el fichero no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261018T0120_cierre_proponer_lectura.down.sql
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  grant select on table public.journal_dismissal to conta_lectura;
  raise notice 'conta_lectura lee journal_dismissal (agente «Libro diario», día sin asiento).';
end $$;
