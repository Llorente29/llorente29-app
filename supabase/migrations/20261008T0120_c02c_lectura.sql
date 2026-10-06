-- ============================================================================
-- C02c · Traer el plan de otro programa — 3 · LECTURA para los agentes
-- ----------------------------------------------------------------------------
-- SELECT sobre company_chart_import al rol `conta_lectura`, si existe (en
-- producción sí, en staging no): el agente «Plan contable» comprueba que una
-- importación deshecha no deja nada (encargo §6). Mismo patrón que la 0185 del
-- C02. Un GRANT no toma cierre sobre tablas del pedido.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'C02c 0120: no existe el rol conta_lectura (normal en staging): no se da ningún permiso.';
    return;
  end if;
  grant select on table public.company_chart_import to conta_lectura;
  raise notice 'C02c 0120: conta_lectura puede leer company_chart_import.';
end $$;
