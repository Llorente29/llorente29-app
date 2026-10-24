-- supabase/vuelta-atras/20261130T0410_e05_riders_ficha_y_libro.down.sql
--
-- Vuelta atrás de la 0410: compras_ficha_le_falta y conta_vat_book_desde_asiento
-- vuelven a los cuerpos de producción del 21/10, tal cual (md5 del cuerpo:
-- 5dbcedf7… y 08eb4f42…). No toca datos: las filas del libro de IVA que se
-- hayan escrito con la 0410 se quedan como están (llevan el NIF de verdad).

create or replace function public.compras_ficha_le_falta(p_proveedor uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s supplier; v jsonb := '[]'::jsonb; v_nif record; v_otros int; v_ultimo text;
begin
  select * into s from supplier where id = p_proveedor;
  if s.id is null or not (select belongs_to_account(s.account_id)) then
    raise exception 'Ese proveedor no es de tu cuenta.' using errcode = '42501';
  end if;
  if s.tax_id is null then
    select public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') nif, count(*) veces into v_nif
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado'
       and public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') is not null
     group by 1 order by 2 desc, 1 limit 1;
    select count(distinct public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id')) - 1 into v_otros
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado'
       and public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') is not null;
    v := v || jsonb_build_object('falta', 'nif', 'ofrece', v_nif.nif, 'veces', v_nif.veces, 'otros_distintos', greatest(coalesce(v_otros, 0), 0));
  end if;
  if s.expense_category_id is null then
    v := v || jsonb_build_object('falta', 'tipo_gasto');
  end if;
  if s.invoicing_mode is null then
    select a.parsed_result->'document'->>'doc_type' into v_ultimo
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado' and a.parsed_result->'document'->>'doc_type' is not null
     order by g.receipt_date desc, g.created_at desc limit 1;
    v := v || jsonb_build_object('falta', 'forma_facturar', 'ultimo_papel', v_ultimo);
  end if;
  return v;
end $function$;

create or replace function public.conta_vat_book_desde_asiento(p_entry uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_e public.journal_entry; v_n integer := 0; l record;
  v_tipo text; v_num text; v_hasta text; v_docs int; v_fecha_op date; v_recep date; v_nif text; v_tipo_id text; v_pais text; v_nombre text;
  v_clave text; v_calif text; v_exenta text; v_corrige text; v_ret_tipo numeric; v_ret numeric; v_inv boolean; v_isp boolean;
  v_act_code text := 'A'; v_act_tipo text := '03'; v_iae text;
  v_sp record;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or v_e.status not in ('validado', 'anulado') or v_e.source_type = 'reversal' then return 0; end if;
  if exists (select 1 from public.vat_book_entry where entry_id = p_entry) then return 0; end if;
  select iae_code into v_iae from public.company_activity
   where company_id = v_e.company_id and is_main and (ended_on is null or ended_on >= v_e.entry_date) order by started_on desc nulls last limit 1;

  for l in
    select jl.*, t.rate, t.surcharge_rate, t.treatment
      from public.journal_line jl left join public.tax_rate t on t.id = jl.tax_rate_id
     where jl.entry_id = p_entry and jl.vat_book is not null
     order by jl.position
  loop
    v_tipo := 'F1'; v_num := coalesce(l.document_ref, v_e.document_ref); v_hasta := null; v_docs := l.tax_documents;
    v_fecha_op := null; v_recep := null; v_corrige := null; v_ret_tipo := null; v_ret := null;
    v_nif := null; v_tipo_id := null; v_pais := null; v_nombre := null;
    v_inv := l.vat_book = 'investment';
    -- I01d (0300): la compra intracomunitaria también es inversión del sujeto
    -- pasivo (la declaras tú), como la trae Diez: clave 09 y «ISP» a la vez.
    v_isp := l.treatment = 'reverse_charge' or (l.treatment = 'intra_eu' and l.vat_book in ('received', 'investment'));
    v_clave := case when l.treatment = 'intra_eu' and l.vat_book <> 'issued' then '09' else '01' end;
    v_calif := case when l.vat_book = 'not_subject' then 'N1' when l.treatment = 'exempt' or (l.treatment = 'intra_eu' and l.vat_book = 'issued') then null
                    when v_isp then 'S2' else 'S1' end;
    v_exenta := case when l.treatment = 'exempt' then 'E1' when l.treatment = 'intra_eu' and l.vat_book = 'issued' then 'E5' end;

    if v_e.source_type = 'sales_day' then
      -- Asiento resumen de tiques (RIVA 63.4): F4 con el rango; un tique suelto, F2.
      select first_invoice, last_invoice, tickets_count into v_num, v_hasta, v_docs
        from public.sales_day_summary where entry_id = p_entry or id = v_e.source_id order by (entry_id = p_entry) desc limit 1;
      v_docs := coalesce(nullif(l.tax_documents, 1), v_docs, 1);
      v_tipo := case when coalesce(v_docs, 1) > 1 then 'F4' else 'F2' end;
      v_nombre := 'VENTAS A CONSUMIDOR FINAL';
    elsif v_e.source_type = 'supplier_invoice' then
      select si.invoice_number, si.created_at::date, case when si.doc_kind = 'credit_note' then 'R1' else 'F1' end,
             (select c.invoice_number from public.supplier_invoice c where c.id = si.corrects_invoice_id),
             wr.rate, si.withholding_amount
        into v_num, v_recep, v_tipo, v_corrige, v_ret_tipo, v_ret
        from public.supplier_invoice si left join public.withholding_rate wr on wr.id = si.withholding_rate_id
       where si.id = v_e.source_id;
    elsif v_e.source_type in ('channel_settlement', 'licensed_settlement') then
      v_num := coalesce(v_num, (select settlement_ref from public.channel_settlement where id = v_e.source_id),
                               (select settlement_ref from public.licensed_settlement where id = v_e.source_id));
    end if;

    select p.tax_id, nullif(f.tax_id_type, 'nif'), f.country_code, coalesce(f.legal_name, p.name)
      into v_nif, v_tipo_id, v_pais, v_nombre
      from public.party p left join public.customer_fiscal f on f.party_id = p.id
     where p.id = coalesce(l.party_id, v_e.party_id)
       and v_e.source_type <> 'sales_day';
    if v_e.source_type = 'sales_day' then v_nombre := 'VENTAS A CONSUMIDOR FINAL'; end if;
    -- I01d (0300): una recibida toma de la FICHA DEL PROVEEDOR lo que su
    -- tercero no tiene (no tiene ficha de cliente): el país si no es España,
    -- el tipo de identificación (02 NIF-IVA, 04 extranjero), el NIF y el nombre.
    if v_e.source_type = 'supplier_invoice' then
      select s.country_code, s.tax_id_type, s.tax_id, coalesce(s.legal_name, s.name) as nombre into v_sp
        from public.supplier_invoice si join public.supplier s on s.id = si.supplier_id and s.account_id = si.account_id
       where si.id = v_e.source_id and si.account_id = v_e.account_id;
      if found then
        v_pais := coalesce(v_pais, nullif(v_sp.country_code, 'ES'));
        v_tipo_id := coalesce(v_tipo_id, case v_sp.tax_id_type when 'vat_eu' then '02' when 'foreign' then '04' end);
        v_nif := coalesce(v_nif, v_sp.tax_id);
        v_nombre := coalesce(v_nombre, v_sp.nombre);
      end if;
    end if;
    if v_tipo_id is not null and v_tipo_id not in ('02', '03', '04', '05', '06') then v_tipo_id := null; end if;

    insert into public.vat_book_entry (account_id, company_id, entry_id, line_id, book, invoice_type, number, number_to, documents_count,
      issue_date, operation_date, received_date, party_id, counterpart_tax_id, counterpart_id_type, counterpart_country, counterpart_name,
      operation_key, qualification, exempt_cause, tax_base, tax_rate, tax_amount, surcharge_rate, total,
      deductible_amount, reverse_charge, investment_good, withholding_rate, withholding_amount,
      activity_code, activity_type, activity_iae, corrects_ref, source_type, source_id, voided_at, voided_by_entry_id)
    values (v_e.account_id, v_e.company_id, p_entry, l.id, l.vat_book, v_tipo, v_num, v_hasta, greatest(coalesce(v_docs, 1), 1),
      coalesce(l.document_date, v_e.document_date, v_e.entry_date), v_fecha_op, v_recep, coalesce(l.party_id, v_e.party_id),
      v_nif, v_tipo_id, v_pais, v_nombre,
      -- La base lleva el signo de la cuota: en una rectificativa las dos van en
      -- negativo (el validador del C04 compara en valor absoluto y deja la base
      -- en positivo en el apunte).
      v_clave, v_calif, v_exenta,
      case when (case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end) < 0 then -abs(l.tax_base) else abs(l.tax_base) end,
      l.rate,
      case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end,
      nullif(l.surcharge_rate, 0),
      case when (case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end) < 0 then -abs(l.tax_base) else abs(l.tax_base) end
        + case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end,
      case when l.vat_book in ('received', 'investment') and l.vat_deductible = 'yes' then l.debit - l.credit when l.vat_book in ('received', 'investment') then 0 end,
      v_isp, v_inv, v_ret_tipo, v_ret,
      case when v_iae is null then null else v_act_code end, case when v_iae is null then null else v_act_tipo end, v_iae,
      v_corrige, v_e.source_type, v_e.source_id,
      case when v_e.status = 'anulado' then coalesce(v_e.voided_at, now()) end, v_e.voided_by_entry_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
