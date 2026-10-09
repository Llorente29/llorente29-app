-- ============================================================================
-- C05 · LO QUE LEE LA PARTE «LIBROS Y BALANCES» DEL AGENTE, para conta_lectura
-- ----------------------------------------------------------------------------
-- La lista NO es de memoria: sale de scripts/conta/agente-libros.sql (todos
-- sus «public.x», 9 objetos). Preguntado a producción el 08/10 (solo lectura,
-- has_table_privilege): conta_lectura ya lee fiscal_year, company_account,
-- journal_entry y journal_ledger; las otras 5 son nuevas del C05 (0100 y 0130)
-- y aún no existen allí. Aquí se dan las 9 (GRANT es idempotente) para que el
-- fichero diga entero qué lee el rol, y PARA si alguna no existe: va detrás
-- de la 0100 y la 0130.
--
-- Solo SELECT. conta_lectura sigue siendo de solo lectura.
-- En staging el rol no existe: el fichero no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261014T0150_c05_lectura.down.sql
-- (quita SOLO las 5 nuevas).
-- ============================================================================

do $$
declare
  t text; faltan text := ''; n int := 0;
  tablas constant text[] := array[
    -- Nuevas del C05.
    'annual_accounts_line', 'annual_accounts_mapping', 'annual_accounts_choice', 'vat_book_entry', 'fiscal_year_closing',
    -- Ya las leía (C00, C02, C04).
    'fiscal_year', 'company_account', 'journal_entry', 'journal_ledger'];
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
  raise notice 'conta_lectura lee las % tablas de la parte C05 del agente.', n;
end $$;
