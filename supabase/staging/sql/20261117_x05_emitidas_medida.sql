-- supabase/staging/sql/20261117_x05_emitidas_medida.sql
--
-- SOLO STAGING. X05 · Qué facturas emitidas hay en staging, por clase, y cuáles
-- tienen lo que pide ERP10 al importar (encargo X05, punto 2: «antes de escribir,
-- contesta en el PR, contra el esquema y con cifras de staging»; regla 5).
-- Solo lee, y acaba en ROLLBACK. Va la primera en la tanda de staging de la rama.
--
-- Tabla entera, a propósito, y dicho en cada línea (regla 9): son cifras de
-- staging, de todas sus cuentas de prueba, no de ninguna empresa en concreto.
-- Lo que pide la configuración de expedidas medida en ERP10 el 17/11
-- (docs/conta/erp10/configuracion/ConfiguracionExpedidas.XML): fecha, número,
-- subcuenta del cliente, total, IVA 1 a 4, ruta del PDF y contrapartidas de
-- ingreso 1 a 4. No lleva columnas de retención, recargo, tipo de operación,
-- exención ni factura rectificada.

begin;
do $$
declare r record;
begin
  raise notice 'MEDIDA X05 · tabla entera · cuentas con alguna customer_invoice = %',
    (select count(distinct account_id) from public.customer_invoice);

  -- 1 · Las facturas de venta, por origen, tipo y estado.
  for r in
    select ci.origin, ci.doc_type, ci.status, count(*) n,
           count(*) filter (where e.status = 'validado') con_asiento_validado,
           count(*) filter (where ci.import_run_id is not null) traidas_por_carga,
           count(*) filter (where ci.pdf_path is not null) con_pdf,
           count(*) filter (where ci.withholding_amount <> 0) con_retencion,
           count(*) filter (where ci.surcharge_amount <> 0) con_recargo,
           count(*) filter (where coalesce(btrim(ci.customer ->> 'nif'), '') = '') sin_nif
      from public.customer_invoice ci
      left join public.journal_entry e on e.id = ci.entry_id and e.account_id = ci.account_id
     group by 1, 2, 3 order by 1, 2, 3
  loop
    raise notice 'MEDIDA X05 · tabla entera · customer_invoice · origen % · % · % = % (asiento validado %, traídas por carga %, con PDF %, con retención %, con recargo %, sin NIF %)',
      r.origin, r.doc_type, r.status, r.n, r.con_asiento_validado, r.traidas_por_carga, r.con_pdf, r.con_retencion, r.con_recargo, r.sin_nif;
  end loop;

  -- 2 · De las emitidas con asiento validado: el tratamiento del IVA de sus líneas, cuántos tipos y cuántas cuentas de ingreso.
  for r in
    with f as (
      select ci.id, ci.origin, ci.doc_type,
             count(distinct cl.tax_pct) tipos, count(distinct cl.revenue_account_id) cuentas,
             string_agg(distinct t.treatment, '+' order by t.treatment) tratamientos,
             bool_or(cl.tax_pct = 0) con_cero
        from public.customer_invoice ci
        join public.journal_entry e on e.id = ci.entry_id and e.account_id = ci.account_id and e.status = 'validado'
        join public.customer_invoice_line cl on cl.invoice_id = ci.id and cl.account_id = ci.account_id
        left join public.tax_rate t on t.id = cl.tax_rate_id
       group by 1, 2, 3)
    select origin, doc_type, tratamientos, count(*) n,
           count(*) filter (where tipos > 4) mas_de_4_tipos, count(*) filter (where cuentas > 4) mas_de_4_cuentas,
           count(*) filter (where con_cero) con_tipo_cero, max(tipos) max_tipos, max(cuentas) max_cuentas
      from f group by 1, 2, 3 order by 1, 2, 3
  loop
    raise notice 'MEDIDA X05 · tabla entera · emitidas con asiento validado · origen % · % · IVA % = % (más de 4 tipos %, más de 4 cuentas de ingreso %, con un tipo al 0 %, como mucho % tipos y % cuentas)',
      r.origin, r.doc_type, r.tratamientos, r.n, r.mas_de_4_tipos, r.mas_de_4_cuentas, r.con_tipo_cero, r.max_tipos, r.max_cuentas;
  end loop;

  -- 3 · Los asientos validados con libro de expedidas, por su origen: con factura de venta o sin ella.
  for r in
    select e.source_type, (ci.id is not null) con_factura, count(distinct e.id) n,
           count(distinct e.id) filter (where e.import_run_id is not null or e.external_program is not null) traidos,
           count(distinct e.id) filter (where exists (select 1 from public.journal_entry_document d where d.entry_id = e.id and d.account_id = e.account_id)) con_documento
      from public.journal_entry e
      join public.vat_book_entry v on v.entry_id = e.id and v.account_id = e.account_id and v.book = 'issued' and v.voided_at is null
      left join public.customer_invoice ci on ci.entry_id = e.id and ci.account_id = e.account_id
     where e.status = 'validado'
     group by 1, 2 order by 1, 2
  loop
    raise notice 'MEDIDA X05 · tabla entera · asientos validados con libro de expedidas · origen % · con factura de venta % = % (traídos %, con documento en el asiento %)',
      r.source_type, r.con_factura, r.n, r.traidos, r.con_documento;
  end loop;

  -- 4 · El tipo de factura del libro de expedidas (F1 factura, F2 simplificada, F4 resumen, R… rectificativa).
  for r in
    select v.invoice_type, count(distinct v.entry_id) n
      from public.vat_book_entry v
      join public.journal_entry e on e.id = v.entry_id and e.account_id = v.account_id and e.status = 'validado'
     where v.book = 'issued' and v.voided_at is null
     group by 1 order by 1
  loop
    raise notice 'MEDIDA X05 · tabla entera · libro de expedidas · tipo de factura % = % asientos', r.invoice_type, r.n;
  end loop;

  -- 5 · La 430 de cada cliente: con su tercero enlazado y su NIF.
  for r in
    select count(*) n,
           count(*) filter (where k.id is not null) enlazadas,
           count(*) filter (where coalesce(btrim(p.tax_id), '') <> '') con_nif
      from public.company_account a
      left join public.company_account_link k on k.company_account_id = a.id and k.account_id = a.account_id and k.entity = 'customer' and k.role = 'principal'
      left join public.party p on p.id::text = k.entity_id and p.account_id = a.account_id
     where coalesce(a.template_code, a.code) like '430%'
       and exists (select 1 from public.customer_invoice ci join public.journal_line l on l.entry_id = ci.entry_id and l.account_id = ci.account_id
                    where l.company_account_id = a.id)
  loop
    raise notice 'MEDIDA X05 · tabla entera · cuentas 430 usadas por facturas de venta = % (enlazadas a su cliente %, con NIF %)', r.n, r.enlazadas, r.con_nif;
  end loop;
end $$;
rollback;
