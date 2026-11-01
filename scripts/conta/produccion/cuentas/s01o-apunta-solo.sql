-- scripts/conta/produccion/cuentas/s01o-apunta-solo.sql
--
-- S01o · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Lo que tiene que pasar con la tanda: las fichas de las plataformas de Foodint,
-- de 0 a 3 con cuenta de gasto y de 0 a 2 con cuenta de publicidad; y nada más.
-- El interruptor sigue apagado y no se apunta ninguna (172 por revisar, 0 solas):
-- lo apuntado lo medirá la sesión principal después de que Julio lo encienda.
select clave, valor from (
  select 1 o, 'Facturas de plataforma de Foodint por revisar sin asiento' clave,
    (select count(*)::text from public.supplier_invoice si
      where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.status in ('en_revision', 'aprobada')
        and exists (select 1 from public.party_role ps join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
                     where ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id)
        and not exists (select 1 from public.journal_entry e where e.account_id = si.account_id and e.source_type = 'supplier_invoice' and e.source_id = si.id and e.status in ('propuesto', 'borrador', 'validado'))
        and si.created_at < timestamptz '2026-11-01 18:00+00') valor union all
  select 2, 'Asientos de Foodint apuntados solos (validados)',
    (select count(*)::text from public.journal_entry e join public.supplier_invoice si on si.id = e.source_id and si.account_id = e.account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.source_type = 'supplier_invoice' and e.status = 'validado'
        and e.created_by_name = 'Folvy (apunta solo · plataforma)' and si.created_at < timestamptz '2026-11-01 18:00+00') union all
  select 3, 'Fichas de plataforma de Foodint con cuenta de gasto',
    (select count(*)::text from public.company_account_link k
      where k.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and k.entity = 'supplier' and k.role = 'gasto'
        -- quieta: las fichas de las plataformas solo las cambia una persona desde la ficha del proveedor; hoy no tienen ninguna
        and k.entity_id in (select ps.supplier_id::text from public.party_role ps join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
                             where ps.account_id = k.account_id and ps.role = 'supplier')) union all
  select 4, 'Fichas de plataforma de Foodint con cuenta de publicidad',
    (select count(*)::text from public.company_account_link k
      -- quieta: el papel «publicidad» nace con la tanda (1729)
      where k.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and k.entity = 'supplier' and k.role = 'publicidad') union all
  select 5, 'Foodint apunta solo lo seguro',
    (select coalesce(bool_or(post_safe_invoices), false)::text from public.company_purchase_setting
      -- quieta: el interruptor solo lo cambia un administrador desde Ajustes
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9')
) q order by o;
