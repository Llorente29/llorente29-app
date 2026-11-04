-- scripts/conta/produccion/cuentas/s01p-recibido.sql
--
-- S01p · LO QUE CUENTA LA TANDA (1640 y 1641), antes y después. SOLO LEE.
select clave, valor from (
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 1 o, '_compras_fin_de_mes retira las propuestas de lo que no toca (antes 0, después 1)' clave,
    (strpos(pg_get_functiondef('public._compras_fin_de_mes(uuid,date)'::regprocedure), '-- S01p: lo periodificado que ya no hace falta') > 0)::int::text valor
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 2, 'Disparador s01p_albaran_facturado en goods_receipt_path (antes 0, después 1)',
    (select count(*)::text from pg_trigger where tgname = 's01p_albaran_facturado' and tgrelid = 'public.goods_receipt_path'::regclass)
  union all
  -- corte: octubre de 2026, empresa de Foodint, calculadas antes del 04/11 16:30Z (purchase_accrual no tiene created_at: su fecha es computed_at).
  select 3, 'Periodificaciones de octubre de Foodint (antes 1, después 0)',
    (select count(*)::text from public.purchase_accrual
      where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and month = '2026-10-01'
        and computed_at < timestamptz '2026-11-04 16:30:00+00')
  union all
  -- corte: asientos del 31/10 y el 01/11 de 2026, empresa de Foodint.
  select 4, 'Asientos propuestos de lo recibido sin factura de octubre de Foodint (antes 2, después 0)',
    (select count(*)::text from public.journal_entry
      where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and source_type in ('purchase_accrual', 'purchase_accrual_reversal') and entry_date between '2026-10-31' and '2026-11-01'
        and status in ('propuesto', 'borrador'))
) t order by o;
