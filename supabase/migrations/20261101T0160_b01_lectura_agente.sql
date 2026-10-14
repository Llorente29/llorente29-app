-- ============================================================================
-- B01 · LO QUE LEE EL AGENTE «CONCILIACIÓN» (la parte de cada noche), para
-- conta_lectura
-- ----------------------------------------------------------------------------
-- La lista NO es de memoria: sale de scripts/conta/agente-conciliacion.sql
-- (todos sus «public.x», 11 objetos). Ocho son nuevas de esta tanda (0100 y
-- 0150); company_account_link, journal_entry y journal_line ya las leía el
-- rol (C02 y C04). Aquí se dan las 11 (GRANT es idempotente) para que el
-- fichero diga entero qué lee el rol, y PARA si alguna no existe: va detrás
-- de la 0100 y la 0150.
--
-- Solo SELECT. conta_lectura sigue siendo de solo lectura.
-- En staging el rol no existe: el fichero no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0160_b01_lectura_agente.down.sql
-- (quita SOLO las 8 nuevas).
-- ============================================================================

do $$
declare
  t text; faltan text := ''; n int := 0;
  tablas constant text[] := array[
    -- Nuevas del B01.
    'bank_agent_run', 'bank_aggregator_link', 'bank_match', 'bank_month_close', 'bank_movement', 'bank_rule', 'bank_rule_log', 'bank_statement',
    -- Ya las leía (C02, C04).
    'company_account_link', 'journal_entry', 'journal_line'];
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  foreach t in array tablas loop
    if to_regclass('public.' || t) is null then
      faltan := faltan || ' ' || t;
    else
      execute format('grant select on table public.%I to conta_lectura', t);
      n := n + 1;
    end if;
  end loop;
  if faltan <> '' then
    raise exception 'conta_lectura: no existen%; el agente las lee y fallaría. PARA.', faltan;
  end if;
  raise notice 'conta_lectura lee las % tablas del agente «Conciliación».', n;
end $$;
