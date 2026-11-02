-- supabase/migrations/20261102T1838_s01q_foodint_duplicados.sql
--
-- S01q · Foodint: se BORRAN los 123 asientos que la pasada del S01o hizo el
-- 01/11 de facturas que Diez ya tenía (Julio, 02/11, respuestas S01q·3 y S01q·5:
-- «A, renumerar, sí»). Mueve filas: va con autorizo.
--   · Cuáles: las facturas apuntadas solas con su número en el concepto de un
--     asiento traído de Diez y su proveedor (su subcuenta) por el total, en su
--     lado: la lista aprobada (123 asientos, 9.584,37 € netos).
--   · Cómo: con _conta_asientos_borrar (1837): respaldo, renumera la serie 2
--     desde el 3292 y recalcula la cadena desde el primer borrado.
--   · Cada factura queda «Ya contabilizada en Diez», enlazada a su asiento de
--     Diez (la guarda del #448).
--   · El IVA soportado del 4T baja 1.663,42 € (sus 123 filas del libro, que
--     cuentan en noviembre y no se han presentado).
-- Para si algo no es lo medido. Sin Foodint (staging), no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_entries uuid[]; v_facturas uuid[]; v_n int; v_total numeric; v_iva_antes numeric; v_iva_despues numeric; v_iva_borrado numeric; r jsonb; v_ok int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01q: sin la cuenta de Foodint, no hay nada que borrar.';
    return;
  end if;

  select array_agg(distinct a.entry_id), array_agg(distinct a.invoice_id) into v_entries, v_facturas
    from public.supplier_invoice_auto a join public.supplier_invoice si on si.id = a.invoice_id
   where a.account_id = v_acc and a.company_id = v_e and a.estado = 'apuntada'
     and length(upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g'))) >= 4
     and exists (select 1 from public.journal_entry e
                  where e.company_id = si.company_id and e.source_type = 'migrated' and e.status = 'validado'
                    and upper(regexp_replace(e.concept, '[^A-Za-z0-9]', '', 'g')) like '%' || upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) || '%'
                    and exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                                 and k.entity = 'supplier' and k.entity_id = si.supplier_id::text and k.role = 'principal'
                                 where l.entry_id = e.id and (case when si.grand_total >= 0 then l.credit - l.debit else l.debit - l.credit end) = abs(si.grand_total)));
  select count(*), coalesce(sum(si.grand_total), 0) into v_n, v_total from public.supplier_invoice si where si.id = any(v_facturas);
  if coalesce(array_length(v_entries, 1), 0) <> 123 or v_n <> 123 or v_total <> 9584.37 then
    raise exception 'S01q: la lista aprobada son 123 asientos y 9.584,37 €; ahora salen % asientos, % facturas y % €: no se borra nada.',
      coalesce(array_length(v_entries, 1), 0), v_n, v_total;
  end if;
  if exists (select 1 from public.journal_entry e where e.id = any(v_entries) and (e.status <> 'validado' or e.series <> 2 or e.entry_date <> date '2026-11-01')) then
    raise exception 'S01q: algún asiento de la lista no es el medido (validado, serie 2, del 01/11): no se borra nada.';
  end if;

  -- El IVA soportado del 4T, antes (la misma vara después).
  select coalesce(sum(v.tax_amount), 0) into v_iva_antes from public.vat_book_entry v
   where v.company_id = v_e and v.book = 'received' and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';
  select coalesce(sum(v.tax_amount), 0) into v_iva_borrado from public.vat_book_entry v where v.entry_id = any(v_entries);

  r := public._conta_asientos_borrar(v_e, v_entries,
         'S01q · Duplicado: la factura ya estaba en Diez (la pasada del S01o del 01/11 la apuntó otra vez). Julio, 02/11.',
         'Julio (tanda S01q)');
  raise notice 'S01q: %', r->>'texto';

  -- Cada factura, «Ya contabilizada en Diez» y enlazada a su asiento (la guarda).
  update public.supplier_invoice_auto set estado = 'no', entry_id = null, at = now() where invoice_id = any(v_facturas);
  perform public._conta_factura_guarda(x) from unnest(v_facturas) x;
  select count(*) into v_ok from public.supplier_invoice_auto a join public.supplier_invoice si on si.id = a.invoice_id
   where a.invoice_id = any(v_facturas) and a.estado = 'ya_contabilizada' and si.journal_entry_id is not null
     and exists (select 1 from public.journal_entry e where e.id = si.journal_entry_id and e.source_type = 'migrated');
  if v_ok <> 123 then raise exception 'S01q: solo % de las 123 facturas quedan enlazadas a su asiento de Diez: no se borra nada.', v_ok; end if;

  select coalesce(sum(v.tax_amount), 0) into v_iva_despues from public.vat_book_entry v
   where v.company_id = v_e and v.book = 'received' and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';
  if v_iva_antes - v_iva_despues <> 1663.42 or v_iva_borrado <> 1663.42 then
    raise exception 'S01q: el IVA soportado del 4T tenía que bajar 1.663,42 € y baja % € (de % a %): no se borra nada.', v_iva_antes - v_iva_despues, v_iva_antes, v_iva_despues;
  end if;
  raise notice 'S01q: IVA soportado del 4T, de % a % € (−1.663,42 €). 123 facturas «Ya contabilizada en Diez».', v_iva_antes, v_iva_despues;
end $$;
