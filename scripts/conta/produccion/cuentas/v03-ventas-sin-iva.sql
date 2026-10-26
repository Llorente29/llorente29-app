-- scripts/conta/produccion/cuentas/v03-ventas-sin-iva.sql
--
-- V03 · Entrega 2 (26/10) · LO QUE CUENTA LA TANDA DE LAS VENTAS SIN IVA,
-- antes y después. SOLO LEE. Las facturas y el libro son de Foodint (regla 9);
-- los apuntes exentos, de la base entera, y se dice.
-- Lo que tiene que cambiar: la huella de las cuatro funciones. Lo demás, igual:
-- las facturas de Foodint, las filas del libro que vienen de ellas (las de los
-- cierres del día no: crecen cada hora) y ningún apunte exento ni no sujeto en
-- ninguna cuenta.
-- W06 (26/10): las tres que leen datos llevan un corte fijo (creadas antes de
-- las 09:00 UTC del 26/10): lo que entre durante el ensayo no las mueve.
-- Medido en producción el 26/10 a las 00:56 UTC, antes: 0 / 1286 / 0 · 0 (las
-- 1.286 son las traídas de Diez, sin asiento en Sumied) · 0 · 04a94c4a ·
-- 99be8350 · ddc58afc · c8d6c254.
select clave, valor from (
  select 1 o, 'facturas de venta de Foodint (borrador / emitidas / anuladas)' clave,
    (select count(*) filter (where status = 'borrador') || ' / ' || count(*) filter (where status = 'emitida') || ' / ' || count(*) filter (where status = 'anulada')
       from public.customer_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-26 09:00:00+00') valor union all
  select 2, 'filas del libro de emitidas de Foodint que vienen de facturas de venta',
    (select count(*) from public.vat_book_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and book = 'issued' and source_type = 'customer_invoice' and created_at < timestamptz '2026-10-26 09:00:00+00')::text union all
  select 3, 'apuntes exentos o no sujetos (base entera)',
    (select count(*) from public.journal_line l left join public.tax_rate t on t.id = l.tax_rate_id
      where l.vat_book is not null and (t.treatment = 'exempt' or l.vat_book = 'not_subject') and l.created_at < timestamptz '2026-10-26 09:00:00+00')::text union all
  select 4, 'huella de conta_venta_guardar', (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_venta_guardar') union all
  select 5, 'huella de conta_venta_emitir', (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_venta_emitir') union all
  select 6, 'huella de conta_motivos_para_validar', (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_motivos_para_validar') union all
  select 7, 'huella de conta_vat_book_desde_asiento', (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_vat_book_desde_asiento')
) t order by o;
