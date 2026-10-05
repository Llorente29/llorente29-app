-- ============================================================================
-- C02 · Plan contable — 9 · LECTURA para los agentes (respuesta 3, punto 3)
-- ----------------------------------------------------------------------------
-- Da SELECT sobre las tablas nuevas del C02 al rol `conta_lectura`, si existe,
-- para que los agentes y el nocturno lean el plan desde el primer día sin que
-- Julio toque nada en Supabase. En producción el rol existe (lo creó Julio con
-- scripts/conta/crear-usuario-lectura.sql); en staging no, y entonces se dice
-- y no se hace nada.
--
--   pgc_account            la serie del BOE (0100/0110)
--   company_account        el plan de cada empresa (0120)
--   company_account_link   los enlaces (0120)
--   company_account_log    «Lo que ha hecho Folvy» del plan (0120)
--
-- El C02 no crea vistas. Solo SELECT y solo estas cuatro: lo mismo que
-- crear-usuario-lectura.sql, que también las lleva ya en su lista. Va en la
-- tanda 1, después de la 0180. Fuera del camino del pedido: un GRANT no toma
-- cierre sobre tablas del pedido.
-- ============================================================================

do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'C02 0185: no existe el rol conta_lectura (normal en staging): no se da ningún permiso.';
    return;
  end if;
  foreach t in array array['pgc_account', 'company_account', 'company_account_link', 'company_account_log'] loop
    execute format('grant select on table public.%I to conta_lectura', t);
  end loop;
  raise notice 'C02 0185: conta_lectura puede leer pgc_account, company_account, company_account_link y company_account_log.';
end $$;
