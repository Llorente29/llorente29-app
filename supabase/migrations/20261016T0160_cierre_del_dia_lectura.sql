-- ============================================================================
-- El día se cierra a las 6:00 — 7 · LO QUE LEE EL AGENTE «LIBRO DIARIO», para conta_lectura
-- ----------------------------------------------------------------------------
-- La comprobación nueva del agente (cierre_dia, scripts/conta/agente-libro.sql)
-- nombra public.conta_cerrado_hasta. Las tablas que lee (sale, brand, company)
-- ya las tenía de 20261012T0050_c04r_lectura.sql. Se da EXPLÍCITO el execute
-- de la función, para que el fichero diga qué usa el rol (la prueba del
-- analizador lo exige: lo que nombran los agentes, dado en un _lectura).
-- conta_cerrado_hasta llama a conta_ultimo_dia_cerrado: las dos son security
-- invoker y ejecutables por PUBLIC (no se les quitó), así que no hace falta más.
--
-- Solo execute. conta_lectura sigue siendo de solo lectura.
-- En staging el rol no existe: el fichero no hace nada y lo dice.
-- Va detrás de la 0100 (PARA si la función no existe).
-- Vuelta atrás: supabase/vuelta-atras/20261016T0160_cierre_del_dia_lectura.down.sql
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  if to_regprocedure('public.conta_cerrado_hasta(uuid, timestamptz)') is null then
    raise exception 'conta_lectura: no existe conta_cerrado_hasta; el agente la usa y fallaría. PARA (va detrás de la 0100).';
  end if;
  grant execute on function public.conta_cerrado_hasta(uuid, timestamptz) to conta_lectura;
  raise notice 'conta_lectura ejecuta conta_cerrado_hasta (agente «Libro diario», cierre del día).';
end $$;
