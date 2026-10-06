-- ============================================================================
-- C03 · 6 · LECTURA para los agentes
-- ----------------------------------------------------------------------------
-- SELECT de lo nuevo al rol `conta_lectura`, si existe (en producción sí, en
-- staging no): el agente «Datos maestros e impuestos» comprueba NIF únicos,
-- netos de las liquidaciones y subcuentas por papel. Mismo patrón que la 0120
-- del C02c. Un GRANT no toma cierre sobre tablas del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261009T0150_c03_lectura.down.sql
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'C03 0150: no existe el rol conta_lectura (normal en staging): no se da ningún permiso.';
    return;
  end if;
  grant select on table public.party, public.party_role, public.customer_fiscal, public.brand_partner_contribution,
                        public.channel_settlement, public.licensed_settlement, public.brand_licensing_agreement to conta_lectura;
  raise notice 'C03 0150: conta_lectura puede leer los terceros, sus papeles y las liquidaciones.';
end $$;
