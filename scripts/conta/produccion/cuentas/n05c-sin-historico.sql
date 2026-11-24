-- scripts/conta/produccion/cuentas/n05c-sin-historico.sql
--
-- N05c · Empezar a trabajar sin el histórico (1655, 1656) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1655 solo añade (tres columnas que admiten nulos y cinco funciones) y la 1656 cambia una función con la
-- misma firma: no cambia ni una fila. Se mide que todo sigue igual, con corte fijo (el #241): lo creado antes del
-- 17/11/2026 a las 00:00 de Madrid. Cifras de todas las cuentas, a propósito (regla 9, excepción: la huella de
-- «esto no se ha movido»), y se etiquetan como tal.
select clave, valor from (
  -- corte: ejercicios creados antes del 17/11 a las 00:00
  select 1 o, 'todas las cuentas · ejercicios ' || origin || coalesce(' · ' || origin_program, '') || case when history_imported_at is null then ' · sin histórico' else ' · con histórico' end clave,
         count(*)::text valor
    from public.fiscal_year where created_at < timestamptz '2026-11-17 00:00:00+01'
   group by origin, origin_program, history_imported_at is null
  union all
  -- corte: asientos creados antes del 17/11 a las 00:00
  select 2, 'todas las cuentas · asientos ' || status, count(*)::text
    from public.journal_entry where created_at < timestamptz '2026-11-17 00:00:00+01' group by status
) t order by o, clave;
