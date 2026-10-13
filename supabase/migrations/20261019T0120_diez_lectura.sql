-- ============================================================================
-- C04b · T2 — LO QUE LEERÁ EL AGENTE «CON DIEZ», para conta_lectura
-- ----------------------------------------------------------------------------
-- El agente (tarea 5) mira las lecturas, los envíos, la comparación por día,
-- los documentos pendientes y el testigo de sumas y saldos. Se da explícito
-- para que el fichero diga qué usa el rol. account_connector no lleva secretos
-- (credentials_ref y token_ref son ids de Vault, no el secreto) y el rol no
-- lee vault.
--
-- Solo select. conta_lectura sigue siendo de solo lectura.
-- En staging el rol no existe: el fichero no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261019T0120_diez_lectura.down.sql
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  grant select on table public.import_run, public.external_send, public.external_entry_snapshot,
    public.external_compare_day, public.external_document, public.external_balance_witness,
    public.account_connector to conta_lectura;
  raise notice 'conta_lectura lee lo de Diez (agente «Con Diez»).';
end $$;
