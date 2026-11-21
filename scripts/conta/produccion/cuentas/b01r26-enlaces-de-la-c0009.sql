-- scripts/conta/produccion/cuentas/b01r26-enlaces-de-la-c0009.sql
--
-- B01r26 · los enlaces a la C0009 (0016) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0. Sin Foodint (staging), 0 antes y después.
--   1. Envíos de Foodint «enlazado» o «enviado» de antes de las 22:00 UTC del 14/11 (los de la C0009): 301 → 0.
--   2. Envíos «pendiente» de Foodint con el motivo «Enlace a la C0009», menos 301: −301 → 0.
--   3. Asientos de ajustes de ventas y pagos a proveedor parados por «igual que no viene de Sumied»: 16 → 0.
--   4. Envíos de Foodint «enviado» o «enlazado» de esta noche (en la C0008), menos 332: 0 → 0 (no se tocan).
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay)
select clave, valor from (
  -- quieta: el traspaso de octubre está parado («traspasando») hasta que Julio pulse
  select 1 o, 'Envíos enlazados o enviados de antes de las 22:00 UTC del 14/11' clave,
    (select case when not (select hay from f) then 0 else count(*) end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status in ('enlazado', 'enviado') and s.sent_at < '2026-11-14 22:00+00')::text valor
  union all
  -- quieta: el traspaso de octubre está parado («traspasando») hasta que Julio pulse
  select 2, 'Envíos pendientes con el motivo Enlace a la C0009, menos 301',
    (select case when not (select hay from f) then 0 else count(*) - 301 end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status = 'pendiente' and s.last_error like 'Enlace a la C0009:%')::text
  union all
  -- quieta: el traspaso de octubre está parado («traspasando») hasta que Julio pulse
  select 3, 'Ajustes de ventas y pagos a proveedor parados por la C0009',
    (select case when not (select hay from f) then 0 else count(*) end
       from public.external_send x join public.journal_entry e on e.id = x.entry_id and e.account_id = x.account_id
      where x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.status = 'pendiente' and x.kind = 'asiento'
        and e.source_type in ('sales_adjustment', 'supplier_payment') and x.last_error like 'en Diez ya hay un asiento igual que no viene de Sumied%')::text
  union all
  -- quieta: el traspaso de octubre está parado («traspasando») hasta que Julio pulse
  select 4, 'Envíos de esta noche en la C0008, menos 332',
    (select case when not (select hay from f) then 0 else count(*) - 332 end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status in ('enlazado', 'enviado') and s.sent_at >= '2026-11-14 22:00+00')::text
) x order by o;
