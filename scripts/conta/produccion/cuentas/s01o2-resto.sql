-- scripts/conta/produccion/cuentas/s01o2-resto.sql
--
-- S01o·2 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres de personas.
-- Lo que tiene que pasar: Foodint, de «sin contestar» a «no está en el ROI»; Anthropic
-- con su NIF «IE4276970QH» y su cuenta de gasto; sus 4 facturas sin proveedor, de 4 a
-- 0 (2 ligadas y 2 recibos descartados como repetidas); 2 llegadas repetidas más.
select clave, valor from (
  select 1 o, 'Foodint en el ROI' clave,
    (select coalesce(to_jsonb(p)->>'en_roi', 'sin contestar') from public.company_tax_profile p
      -- quieta: el ROI solo lo cambia un administrador desde Ajustes
      where p.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor union all
  select 2, 'NIF de la ficha de Anthropic',
    (select string_agg(s.tax_id, ',') from public.supplier s
      -- quieta: la ficha de Anthropic solo la cambia una persona desde su ficha
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.id = 'ff2629d5-e6d1-4093-98dd-1b00b3fe9cf8') union all
  select 3, 'Cuenta de gasto en la ficha de Anthropic',
    (select coalesce(string_agg(a.code, ','), 'ninguna') from public.company_account_link k join public.company_account a on a.id = k.company_account_id
      -- quieta: las cuentas de una ficha solo las pone una persona desde la ficha
      where k.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and k.entity = 'supplier' and k.entity_id = 'ff2629d5-e6d1-4093-98dd-1b00b3fe9cf8' and k.role = 'gasto') union all
  select 4, 'Facturas de Anthropic sin proveedor por revisar',
    (select count(*)::text from public.supplier_invoice si
      where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.supplier_id is null and si.status in ('en_revision', 'aprobada')
        and upper(regexp_replace(coalesce(si.reading->'factura'->'proveedor'->>'nif', ''), '[^A-Za-z0-9]', '', 'g')) like '%IE4276970QH'
        and si.created_at < timestamptz '2026-11-01 23:00+00') union all
  select 5, 'Facturas de Anthropic descartadas',
    (select count(*)::text from public.supplier_invoice si
      where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.status = 'descartada'
        and upper(regexp_replace(coalesce(si.reading->'factura'->'proveedor'->>'nif', ''), '[^A-Za-z0-9]', '', 'g')) like '%IE4276970QH'
        and si.created_at < timestamptz '2026-11-01 23:00+00') union all
  select 6, 'Llegadas repetidas de Foodint',
    (select count(*)::text from public.document_inbox d
      where d.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and d.status = 'repetida' and d.created_at < timestamptz '2026-11-01 23:00+00')
) q order by o;
