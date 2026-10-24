-- scripts/conta/produccion/cuentas/d07-uber-y-no-deducible.sql
--
-- D07 · LO QUE CUENTA LA TANDA 0850–0870, antes y después. SOLO LEE.
-- Medido antes (23/10, solo lectura): 8 facturas de liquidación (provisionales)
-- en Foodint, con 13 líneas y 8 de IVA; 8 liquidaciones de Foodint con factura
-- enlazada; 0 líneas del libro de IVA con IVA no deducible (de todas las
-- cuentas). Después: 0 provisionales, 0 liquidaciones enlazadas (esperan su
-- factura de la semana), las funciones con su md5 nuevo, y la HUELLA DEL 303
-- IGUAL: la casilla de cada línea del libro que ya existe, de TODAS las
-- cuentas (tabla entera, a propósito: es más fuerte así), no se mueve.
-- Foodint por cuenta (regla 9).
select clave, valor from (
  select 1 o, 'facturas de liquidación (provisionales) de Foodint' clave,
         (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'liquidacion')::text valor union all
  select 2, 'sus líneas y su IVA',
         (select count(*) from public.supplier_invoice_line l join public.supplier_invoice i on i.id = l.supplier_invoice_id
           where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and i.source = 'liquidacion') || ' y ' ||
         (select count(*) from public.supplier_invoice_tax t join public.supplier_invoice i on i.id = t.supplier_invoice_id
           where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and i.source = 'liquidacion') union all
  select 3, 'liquidaciones de Foodint con factura de comisión enlazada',
         (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and commission_invoice_id is not null)::text union all
  select 4, 'liquidaciones de Foodint por revisar',
         (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and needs_review)::text union all
  select 5, 'facturas recibidas de Foodint',
         (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 6, 'md5 del cuerpo de conta_vat_book_desde_asiento', (select md5(prosrc) from pg_proc where oid = 'public.conta_vat_book_desde_asiento(uuid)'::regprocedure) union all
  select 7, 'md5 del cuerpo de conta_impuesto_303_cajas', (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_303_cajas(public.vat_book_entry)'::regprocedure) union all
  select 8, 'md5 del cuerpo de conta_liquidacion_factura_proponer', (select md5(prosrc) from pg_proc where oid = 'public.conta_liquidacion_factura_proponer(uuid,text)'::regprocedure) union all
  select 9, 'funciones nuevas (marcar no deducible, enlazar factura)',
         ((to_regprocedure('public.conta_recibida_iva_no_deducible(uuid,boolean,text,text,text)') is not null)::text || ' y ' ||
          (to_regprocedure('public.conta_liquidacion_enlazar_factura(uuid,uuid[],text)') is not null)::text) union all
  select 10, 'columnas del motivo del IVA no deducible',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice'
             and column_name in ('vat_non_deductible_reason', 'vat_non_deductible_note'))::text union all
  select 11, 'líneas del libro de IVA (todas las cuentas) y las recibidas con IVA no deducible',
         (select count(*) from public.vat_book_entry)::text || ' y ' ||
         (select count(*) from public.vat_book_entry where book in ('received', 'investment') and coalesce(deductible_amount, 0) = 0 and coalesce(tax_amount, 0) <> 0)::text union all
  select 12, 'huella del 303: la casilla de cada línea del libro (todas las cuentas)',
         (select md5(coalesce(string_agg(v.id::text || ':' || coalesce(x.no_sabe, '') || ':' || array_to_string(x.cajas, ','), '|' order by v.id), ''))
            from public.vat_book_entry v cross join lateral public.conta_impuesto_303_cajas(v) x)
) t order by o;
