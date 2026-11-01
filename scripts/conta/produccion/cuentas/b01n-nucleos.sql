-- scripts/conta/produccion/cuentas/b01n-nucleos.sql
--
-- B01 · PR 3a (01/11) · LO QUE CUENTA LA TANDA DE LOS NÚCLEOS DE CASAR, antes
-- y después. SOLO LEE. Las funciones, de la base entera, y se dice; lo de los
-- casados, de Foodint (regla 9), con un corte fijo.
-- Lo que tiene que cambiar: las huellas de las tres públicas (cambian: ahora
-- llaman a su núcleo) y las funciones nuevas (0 → 4). Lo demás, igual: la tanda
-- no casa nada, no marca ninguna factura ni valida ningún asiento.
select clave, valor from (
  select 1 o, 'huellas de bank_casar, conta_remesa_casar y mark_supplier_invoice_paid (base entera)' clave,
    (select string_agg(p.proname || '=' || left(md5(pg_get_functiondef(p.oid)), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('bank_casar', 'conta_remesa_casar', 'mark_supplier_invoice_paid')) valor union all
  select 2, 'núcleos y conta_pago_casar_banco (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('_bank_casar_nucleo', '_conta_remesa_casar_nucleo', '_mark_supplier_invoice_paid_nucleo', 'conta_pago_casar_banco'))::text union all
  select 3, 'casados vivos de Foodint, hasta el corte',
    -- quieta: la tanda no casa nada
    (select count(*)::text from public.bank_match where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'vivo' and created_at < timestamptz '2026-11-01 20:25:00+00') union all
  select 4, 'facturas recibidas pagadas de Foodint, hasta el corte',
    -- quieta: la tanda no marca ninguna
    (select count(*)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pagada' and paid_at < date '2026-11-01') union all
  select 5, 'asientos validados de Foodint, hasta el corte',
    -- quieta: la tanda no valida ninguno
    (select count(*)::text from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'validado' and validated_at < timestamptz '2026-11-01 20:25:00+00')
) t order by o;
