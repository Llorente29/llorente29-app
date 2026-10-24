-- scripts/conta/produccion/cuentas/v01-liquidaciones.sql
--
-- V01 (24/10) · LO QUE CUENTA LA TANDA DE LAS LIQUIDACIONES, antes y después.
-- SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9): la tanda no toca datos
-- de ninguna cuenta; se mide que las liquidaciones, el libro y los avisos del
-- C11b siguen igual.
--
-- Después del real: lo mismo que antes, y lo resuelto, a cero (nadie ha
-- resuelto aún ninguna diferencia).
select clave, valor from (
  select 1 o, 'asientos' clave, (select count(*) from public.journal_entry)::text valor union all
  select 2, 'liquidaciones de plataforma', (select count(*) from public.channel_settlement)::text union all
  select 3, 'liquidaciones de socios', (select count(*) from public.licensed_settlement)::text union all
  select 4, 'descartes del libro', (select count(*) from public.journal_dismissal)::text union all
  select 5, 'diferencias resueltas', (case when to_regclass('public.conta_liquidacion_resolucion') is null then 'sin tabla'
                                   else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_liquidacion_resolucion', false, true, '')))[1]::text end)
) x order by o;
