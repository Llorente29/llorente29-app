-- scripts/conta/produccion/cuentas/s01h-abonos.sql
--
-- S01h · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Sin comas en los valores.
--
-- Lo que tiene que pasar:
--   1. paid_method admite «compensation»: de false a true;
--   2. existe conta_abono_compensar: de false a true;
--   3. el total del abono FAC-00120 de Foodint: de -146.46 a -175.46;
--   4. su IVA: de 14.50 a -14.50;
--   5. ligado a la FAC-00006: de false a true;
--   6. las recibidas de Foodint de antes del 31/10 18:00 UTC: las mismas;
--   7. las pagadas de Foodint de antes del 31/10 18:00 UTC: las mismas (la
--      tanda no paga nada: compensa al validar el asiento del abono, después);
--   8. los asientos de Foodint de antes del 31/10 18:00 UTC: los mismos.
select clave, valor from (
  select 1 o, 'paid_method admite compensation' clave,
    (position('compensation' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'supplier_invoice_paid_method_check')) > 0)::text valor union all
  select 2, 'existe conta_abono_compensar',
    (to_regprocedure('public.conta_abono_compensar(uuid)') is not null)::text union all
  select 3, 'total del abono FAC-00120',
    -- quieta: una fila por su id
    (select grand_total::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'f9e2738d-675c-4502-a6e9-c6eb71081633') union all
  select 4, 'IVA del abono FAC-00120',
    -- quieta: una fila por su id
    (select tax_total::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'f9e2738d-675c-4502-a6e9-c6eb71081633') union all
  select 5, 'el abono FAC-00120 ligado a la FAC-00006',
    -- quieta: una fila por su id
    (select (corrects_invoice_id is not distinct from '0d18e0ea-04fe-4ceb-9890-1d1ce122b532'::uuid)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'f9e2738d-675c-4502-a6e9-c6eb71081633') union all
  select 6, 'recibidas de Foodint de antes del 31/10 18:00 UTC',
    (select count(*)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-31 18:00+00') union all
  select 7, 'pagadas de Foodint de antes del 31/10 18:00 UTC',
    (select count(*)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pagada' and created_at < timestamptz '2026-10-31 18:00+00') union all
  select 8, 'asientos de Foodint de antes del 31/10 18:00 UTC',
    (select count(*)::text from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-31 18:00+00')
) q order by o;
