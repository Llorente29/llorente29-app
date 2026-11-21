-- supabase/migrations/20261117T2231_x05_emitidas_por_salir.sql
--
-- X05 · Las facturas emitidas que salen a ERP10, con lo que necesita su fila
-- (encargo X05, 17/11). SOLO AÑADE: una función nueva, que solo lee. No cambia
-- ninguna de la X02 ni del X04 (regla 2), ni nada de Diez. Nada en el camino del
-- pedido.
--
-- conta_erp10_emitidas_por_salir(empresa, mes): de cada factura emitida que sale
-- ese mes (las que conta_erp10_por_salir da como «emitida» y que salen; sin los
-- días de ventas de un TPV, que no son una factura por cliente e irán como
-- asiento), lo que necesita prepararExpedidas (src/modules/conta/erp10/
-- ficheros.ts):
--   · la factura: número, fecha, si es rectificativa (su tipo en el libro, R1 a
--     R5, o la factura de venta de Sumied) y el tipo del libro (F1, F2, F4…);
--   · el cliente: nombre y NIF;
--   · de dónde viene (customer_invoice.origin: a mano, recurrente, cierre del
--     día…; nulo si es un asiento a mano con su libro de expedidas);
--   · la operación ya decidida con el tratamiento del IVA de sus tipos:
--     intracomunitaria, inversión del sujeto pasivo, exenta, no sujeta o interior;
--   · las líneas del asiento con su plantilla, tipo y base del IVA;
--   · el recargo de equivalencia y la retención, si los lleva;
--   · el PDF: el del asiento o, si no, el de la factura de venta
--     (customer_invoice.pdf_path), con su ruta en el almacén;
--   · de cada cuenta que usan, lo que lleva su fila de subcuentas (el NIF del
--     cliente enlazado a su 430), y las ya salidas para ver las que chocan.
--   · las que ya salieron y después se corrigieron con una rectificativa: el
--     asiento de una factura de venta no se anula (se corrige desde la factura),
--     así que conta_erp10_cambiadas no las ve. ERP10 tiene la de antes.
--
-- Vuelta atrás: supabase/vuelta-atras/20261117T2231_x05_emitidas_por_salir.down.sql

create or replace function public.conta_erp10_emitidas_por_salir(p_company uuid, p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_ps jsonb;
  v_ids uuid[];
  v_r jsonb;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  -- Las mismas reglas que enseña la pantalla: solo las emitidas que salen, sin los días del TPV.
  v_ps := public.conta_erp10_por_salir(v_c.id, p_mes);
  select coalesce(array_agg((p ->> 'entry_id')::uuid), '{}') into v_ids
    from jsonb_array_elements(v_ps -> 'partidas') p
   where p ->> 'clase' = 'emitida' and (p ->> 'sale')::boolean and p ->> 'origen' <> 'sales_day';

  with e as (
    select e.* from public.journal_entry e
     where e.id = any (v_ids) and e.company_id = v_c.id and e.account_id = v_c.account_id
  ),
  ci as (
    select distinct on (e.id) e.id as entry_id, f.id, f.number_text, f.issue_date, f.doc_type, f.origin, f.customer, f.party_id,
           f.pdf_path, f.surcharge_amount, f.withholding_amount
      from e
      join public.customer_invoice f on f.account_id = e.account_id and f.company_id = e.company_id
                                    and (f.entry_id = e.id or (e.source_type = 'customer_invoice' and f.id = e.source_id))
     order by e.id, (f.entry_id = e.id) desc
  ),
  libro as (
    select v.entry_id, min(v.number) as numero, min(v.issue_date) as fecha, min(v.counterpart_tax_id) as nif, min(v.counterpart_name) as nombre,
           min(v.invoice_type) as tipo, bool_or(v.invoice_type like 'R%') as rect,
           sum(coalesce(v.surcharge_amount, 0)) as recargo, sum(coalesce(v.withholding_amount, 0)) as retencion
      from public.vat_book_entry v join e on e.id = v.entry_id
     where v.account_id = v_c.account_id and v.voided_at is null and v.book = 'issued'
     group by v.entry_id
  ),
  lineas as (
    select l.entry_id, l.position, a.code, a.template_code, l.debit, l.credit, t.rate, t.treatment, l.tax_base, l.vat_book
      from public.journal_line l
      join e on e.id = l.entry_id
      join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
     where l.account_id = v_c.account_id
  ),
  trato as (
    -- El tratamiento del IVA: el de los tipos del asiento y, si es una factura de venta, el de sus líneas.
    select x.entry_id, array_agg(distinct x.treatment) as tratos
      from (select l.entry_id, l.treatment from lineas l where l.treatment is not null
            union all
            select c.entry_id, t.treatment
              from ci c join public.customer_invoice_line cl on cl.invoice_id = c.id and cl.account_id = v_c.account_id
              join public.tax_rate t on t.id = cl.tax_rate_id) x
     group by x.entry_id
  ),
  doc as (
    select distinct on (d.entry_id) d.entry_id, d.storage_path, d.file_name
      from public.journal_entry_document d join e on e.id = d.entry_id
     where d.account_id = v_c.account_id
     order by d.entry_id, d.created_at desc
  ),
  cuentas as (
    select distinct a.id, a.code, a.template_code, a.name
      from lineas l join public.company_account a on a.company_id = v_c.id and a.account_id = v_c.account_id and a.code = l.code
  ),
  terceros as (
    -- El cliente enlazado a la cuenta: su NIF y su nombre.
    select distinct on (c.id) c.id, p.tax_id, p.name
      from cuentas c
      join public.company_account_link k on k.company_account_id = c.id and k.company_id = v_c.id and k.account_id = v_c.account_id
                                        and k.entity = 'customer' and k.role = 'principal'
      join public.party p on p.id::text = k.entity_id and p.account_id = v_c.account_id
     order by c.id, k.created_at
  )
  select jsonb_build_object(
    'mes', v_ps -> 'mes', 'codigo', v_ps -> 'codigo', 'largo', v_ps -> 'largo',
    'emitidas', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', e.id, 'fecha', e.entry_date,
        'factura', jsonb_build_object('numero', coalesce(nullif(btrim(ci.number_text), ''), lb.numero, e.document_ref),
                                      'fecha', coalesce(ci.issue_date, lb.fecha, e.document_date, e.entry_date)),
        'cliente', jsonb_build_object(
            'nombre', coalesce(nullif(btrim(ci.customer ->> 'nombre'), ''), lb.nombre, e.concept),
            'nif', coalesce(nullif(btrim(ci.customer ->> 'nif'), ''), lb.nif)),
        'origen', ci.origin,
        'rectificativa', coalesce(ci.doc_type = 'rectificativa', false) or coalesce(lb.rect, false),
        'tipoFactura', lb.tipo,
        'operacion', case
            when 'intra_eu' = any (tr.tratos) then 'intra'
            when 'reverse_charge' = any (tr.tratos) then 'isp'
            when 'exempt' = any (tr.tratos) then 'exenta'
            when 'not_subject' = any (tr.tratos) then 'no_sujeta'
            else 'interior' end,
        'recargo', greatest(coalesce(ci.surcharge_amount, 0), coalesce(lb.recargo, 0)),
        'retencion', greatest(coalesce(ci.withholding_amount, 0), coalesce(lb.retencion, 0)),
        'lineas', (select jsonb_agg(jsonb_build_object('cuenta', l.code, 'plantilla', l.template_code, 'debe', l.debit, 'haber', l.credit,
                      'tipoIva', l.rate, 'baseIva', l.tax_base, 'conLibro', coalesce(l.vat_book = 'issued', false))
                      order by l.position) from lineas l where l.entry_id = e.id),
        'tienePdf', d.entry_id is not null or ci.pdf_path is not null,
        'pdf', case when d.entry_id is not null then jsonb_build_object('ruta', d.storage_path, 'nombre', d.file_name)
                    when ci.pdf_path is not null then jsonb_build_object('ruta', ci.pdf_path, 'nombre', regexp_replace(ci.pdf_path, '^.*/', ''))
               end)
        order by e.entry_date, e.series, e.number)
      from e left join ci on ci.entry_id = e.id left join libro lb on lb.entry_id = e.id
             left join trato tr on tr.entry_id = e.id left join doc d on d.entry_id = e.id), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.code, 'plantilla', c.template_code, 'nombre', c.name,
        'nif', t.tax_id, 'gastoHabitual', null) order by c.code)
      from cuentas c left join terceros t on t.id = c.id), '[]'::jsonb),
    'yaSalidas', coalesce((select jsonb_object_agg(s.codigo_erp10, s.codigo)
      from public.conta_erp10_subcuenta_salida s where s.company_id = v_c.id and s.account_id = v_c.account_id), '{}'::jsonb),
    'corregidas', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', p.entry_id, 'numero', f.number_text, 'salioEn', l.creado_en,
        'rectificativa', r.number_text, 'fecha', r.issue_date,
        'queHacer', format('Salió a ERP10 y después se corrigió con la %s: métela a mano en ERP10. No se vuelve a mandar.', r.number_text))
        order by r.issue_date, r.number_text)
      from public.conta_erp10_salida_partida p
      join public.conta_erp10_salida_lote l on l.id = p.lote_id
      join public.customer_invoice f on f.entry_id = p.entry_id and f.account_id = p.account_id
      join public.customer_invoice r on r.corrects_id = f.id and r.account_id = f.account_id and r.status <> 'borrador'
     where p.company_id = v_c.id and p.account_id = v_c.account_id and p.estado = 'salida' and p.clase = 'emitida'), '[]'::jsonb)
  ) into v_r;
  return v_r;
end $$;
comment on function public.conta_erp10_emitidas_por_salir(uuid, date) is
  'X05 · De cada factura emitida que sale a ERP10 ese mes (las de conta_erp10_por_salir que salen, sin los días del TPV), lo que necesita su fila: factura, cliente, origen, si es rectificativa, la operación decidida, las líneas con su IVA, recargo, retención y su PDF; las cuentas que usan con el NIF de su cliente; las ya salidas; y las que salieron y después se corrigieron. Solo lee.';
revoke all on function public.conta_erp10_emitidas_por_salir(uuid, date) from public, anon;
grant execute on function public.conta_erp10_emitidas_por_salir(uuid, date) to authenticated, service_role;
