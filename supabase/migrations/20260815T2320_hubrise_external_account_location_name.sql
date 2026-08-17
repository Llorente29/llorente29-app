-- 20260815T2320_hubrise_external_account_location_name.sql
-- ENCARGO CODE — módulo de conexión HubRise, punto 2 de 2.1 (15/08/2026).
-- Aplicada por MCP (verificada: information_schema.columns confirma las dos
-- columnas, text, nullable).
--
-- Columnas dedicadas para lo que exige la guía de integración de HubRise
-- (mostrar cuenta y location tras conectar). NO se reutiliza
-- organization_name: esa columna es del universo lastapp (única fuente que
-- la lee/escribe en runtime es lastappIntegrationService.ts; ningún edge
-- function de hubrise la toca) — mezclar semánticas de dos integraciones en
-- una columna genérica es exactamente cómo nace la próxima confusión.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_integration' and column_name='external_account_name'
  ) then
    alter table public.external_integration add column external_account_name text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_integration' and column_name='external_location_name'
  ) then
    alter table public.external_integration add column external_location_name text;
  end if;
end $$;
