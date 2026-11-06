-- scripts/conta/produccion/cuentas/s01p-arreglos.sql
--
-- S01p·1 · LO QUE CUENTA LA TANDA (1040, 1041 y 1042), antes y después. SOLO LEE.
select clave, valor from (
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 1 o, 'conta_esperadas_del_mes existe (antes 0, después 1)' clave,
    (to_regprocedure('public.conta_esperadas_del_mes(uuid,date)') is not null)::int::text valor
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 2, 'El aviso de Compras usa conta_esperadas_del_mes (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_esperadas_no_llegadas(uuid,date)'::regprocedure), 'conta_esperadas_del_mes') > 0)::int::text
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 3, 'conta_puerta_fuentes_proponer propone lo quincenal sin día (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_puerta_fuentes_proponer(uuid)'::regprocedure), 'when ''quincenal'' then 0 end') = 0)::int::text
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 4, 'Disparador s01p_factura_su_asiento en journal_entry (antes 0, después 1)',
    (select count(*)::text from pg_trigger where tgname = 's01p_factura_su_asiento' and tgrelid = 'public.journal_entry'::regclass)
  union all
  -- corte: facturas creadas antes del 04/11/2026, cuenta de Foodint.
  select 5, 'Facturas de Foodint (creadas antes del 04/11) cuyo campo no es su asiento propio vivo (antes 147, después 0)',
    (select count(*)::text from public.supplier_invoice f
      where f.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and f.created_at < '2026-11-04'
        and exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = f.id
                     and e.account_id = f.account_id and e.status <> 'anulado')
        and f.journal_entry_id is distinct from (select e.id from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = f.id
                     and e.account_id = f.account_id and e.status <> 'anulado' order by e.created_at desc, e.id desc limit 1))
  union all
  -- corte: facturas creadas antes del 04/11/2026, cuenta de Foodint.
  select 6, 'Facturas de Foodint (creadas antes del 04/11) enlazadas a un migrado de Diez (antes 130, después 130)',
    (select count(*)::text from public.supplier_invoice f join public.journal_entry e on e.id = f.journal_entry_id
      where f.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and f.created_at < '2026-11-04' and e.source_type = 'migrated')
  union all
  -- quieta: un contrato concreto de Foodint; solo lo cambia esta tanda o su ficha en Bancos.
  select 7, 'Cuotas del préstamo BBVA de Foodint (antes 57, después 58)',
    (select installments::text from public.recurring_contract where id = '80cc1993-7429-404f-b2dc-97337364c7eb' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
  union all
  -- quieta: un contrato concreto de Foodint; solo lo cambia esta tanda o su ficha en Bancos.
  select 8, 'Lo prestado del préstamo BBVA de Foodint (antes 35036.59, después 35595.27)',
    (select principal::text from public.recurring_contract where id = '80cc1993-7429-404f-b2dc-97337364c7eb' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) t order by o;
