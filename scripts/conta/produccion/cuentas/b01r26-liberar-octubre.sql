-- scripts/conta/produccion/cuentas/b01r26-liberar-octubre.sql
--
-- B01r26 · liberar octubre (1745) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0. Sin Foodint (staging), 0 antes y después.
--   1. Envíos de Foodint en «enviado» o «enlazado»: 215 → 0.
--   2. Envíos de Foodint en «rechazado» por el borrado de Diez, menos 215: −215 → 0.
--   3. Envíos «pendiente» de Foodint, menos 27: 0 → 0 (no se tocan).
--   4. Asientos validados de octubre, sin anular, que el traspaso NO lleva (_conta_traspaso_va): los ya en Diez → 0.
--   5. Anulaciones de octubre que el traspaso SÍ lleva (su original estaba en Diez) → 0: no viaja ninguno de los dos.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay)
select clave, valor from (
  -- quieta: con Foodint en modo mensual y sin traspaso confirmado, nada escribe en external_send hasta que Julio confirme
  select 1 o, 'Envíos de Foodint en enviado o enlazado' clave,
    (select case when not (select hay from f) then 0 else count(*) end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status in ('enviado', 'enlazado'))::text valor
  union all
  -- quieta: con Foodint en modo mensual y sin traspaso confirmado, nada escribe en external_send hasta que Julio confirme
  select 2, 'Envíos de Foodint rechazados por el borrado de Diez, menos 215',
    (select case when not (select hay from f) then 0 else count(*) - 215 end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status = 'rechazado' and s.last_error like 'Borrado en Diez (C0008) por Julio%')::text
  union all
  -- quieta: con Foodint en modo mensual y sin traspaso confirmado, nada escribe en external_send hasta que Julio confirme
  select 3, 'Envíos pendientes de Foodint, menos 27',
    (select case when not (select hay from f) then 0 else count(*) - 27 end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status = 'pendiente')::text
  union all
  -- quieta: lo que escriba otro proceso en octubre (un asiento nuevo validado) va en el traspaso y no suma aquí
  select 4, 'Validados de octubre sin anular que el traspaso no lleva',
    (select case when not (select hay from f) then 0 else count(*) end from public.journal_entry e
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.entry_date between date '2026-10-01' and date '2026-10-31'
        and e.status = 'validado' and e.reverses_entry_id is null and e.source_type not in ('migrated', 'opening', 'closing', 'template')
        and not public._conta_traspaso_va(e.id))::text
  union all
  -- quieta: una anulación nueva de octubre solo viaja si su original estaba en Diez, y después de la tanda no hay ninguno
  select 5, 'Anulaciones de octubre que el traspaso lleva',
    (select case when not (select hay from f) then 0 else count(*) end from public.journal_entry e
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.entry_date between date '2026-10-01' and date '2026-10-31'
        and e.reverses_entry_id is not null and public._conta_traspaso_va(e.id))::text
) x order by o;
