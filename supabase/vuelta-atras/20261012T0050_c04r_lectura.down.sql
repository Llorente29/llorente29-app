-- ============================================================================
-- Vuelta atrás de C04 R4 · lectura: quita a conta_lectura SOLO las cuatro
-- tablas que este fichero le dio por primera vez (medido en producción el
-- 08/10: las otras 33 y las 2 funciones ya las tenía de ficheros anteriores,
-- y quitarlas rompería los agentes de antes). Sin ellas, el agente del libro
-- vuelve a fallar con «permission denied»: es lo que había.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí: nada que quitar.';
    return;
  end if;
  revoke select on table public.sale, public.supplier_invoice, public.fiscal_period_lock, public.brand from conta_lectura;
end $$;
