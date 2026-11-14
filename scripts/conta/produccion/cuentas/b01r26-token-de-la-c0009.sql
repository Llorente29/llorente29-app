-- scripts/conta/produccion/cuentas/b01r26-token-de-la-c0009.sql
--
-- B01r26 · el token de la C0009 (2256) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0. Sin Foodint (staging), 0 antes y después.
--   1. La conexión de Foodint con un token guardado: 1 → 0.
--   2. Envíos parados por «iguales» (banco, liquidaciones y a mano): 333 → 0.
--   3. Fallos en el detalle del traspaso de octubre, menos 21: 333 → 0.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay)
select clave, valor from (
  -- quieta: el token solo lo guarda conta-diez-traspaso, y Julio no pulsa nada hasta que se aplique
  select 1 o, 'Conexión de Foodint con token guardado' clave,
    (select case when not (select hay from f) then 0 else count(*) end from public.account_connector c
      where c.id = '860fcb61-9b95-46da-bc1a-ad73d665f19b' and c.token_ref is not null)::text valor
  union all
  -- quieta: el traspaso de octubre está parado («traspasando») hasta que Julio pulse
  select 2, 'Envíos parados por iguales (banco, liquidaciones y a mano)',
    (select case when not (select hay from f) then 0 else count(*) end
       from public.external_send x join public.journal_entry e on e.id = x.entry_id and e.account_id = x.account_id
      where x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.status = 'pendiente' and x.kind = 'asiento'
        and e.source_type in ('bank', 'channel_settlement', 'licensed_settlement', 'vat_settlement', 'manual')
        and (x.last_error like 'en Diez ya hay un asiento igual que no viene de Sumied%' or x.last_error ~ '^hay [0-9]+ asientos iguales en Diez ese día'))::text
  union all
  -- quieta: el traspaso de octubre está parado («traspasando») hasta que Julio pulse
  select 3, 'Fallos en el detalle del traspaso de octubre, menos 21',
    (select case when not (select hay from f) then 0 else coalesce(sum(jsonb_array_length(t.detalle)), 0) - 21 end from public.conta_diez_traspaso t
      where t.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and t.mes = date '2026-10-01')::text
) x order by o;
