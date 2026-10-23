-- supabase/vuelta-atras/20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.down.sql
--
-- Vuelta atrás de 20261208T0850: las dos funciones, como en producción byte a
-- byte (cuerpos de la 0300 y la 0410); fuera la función de marcar y las dos
-- columnas del motivo (vat_non_deductible, de la 0190, se queda).
create or replace function public.conta_impuesto_303_cajas(v public.vat_book_entry)
returns table (no_sabe text, cajas text[]) language sql stable set search_path = public as $$
  select n.no_sabe, x.cajas
    from (select 1) uno
    cross join lateral (select
      case
        when coalesce(v.surcharge_amount, 0) <> 0 then 'recargo'
        when v.book = 'issued' and v.invoice_type like 'R%' then 'rectificativa_expedida'
        when v.book in ('received', 'investment') and v.invoice_type like 'R%' and (v.reverse_charge or v.operation_key = '09') then 'rectificativa_isp'
        when v.book in ('received', 'investment') and not v.reverse_charge and v.operation_key <> '09'
             and coalesce(v.counterpart_country, 'ES') <> 'ES' then 'extranjera_sin_isp'
        when v.book = 'issued' and v.qualification = 'S1' and not v.reverse_charge and v.tax_rate not in (4, 10, 21) then 'tipo'
        else null end as no_sabe) n
    cross join lateral (select n.no_sabe,
      case
        when n.no_sabe is not null then '{}'::text[]
        when v.book = 'issued' and v.qualification = 'S1' and not v.reverse_charge then
          case v.tax_rate when 4 then array['01', '03'] when 10 then array['04', '06'] when 21 then array['07', '09'] end
        when v.book = 'issued' and v.qualification = 'S2' then array['122']
        when v.book = 'issued' and v.exempt_cause = 'E5' then array['59']
        when v.book = 'issued' and v.exempt_cause = 'E2' then array['60']
        when v.book = 'not_subject' or (v.book = 'issued' and v.qualification = 'N2') then case when v.qualification = 'N2' then array['120'] else '{}'::text[] end
        when v.book in ('received', 'investment') and v.invoice_type like 'R%' then array['40', '41']
        -- 0300: la autoliquidación. Intracomunitaria (clave 09): devengada en la
        -- [10]/[11] y deducible en la [36]/[37] (bien de inversión: [38]/[39]).
        -- Otra inversión del sujeto pasivo (de fuera de la UE o nacional):
        -- devengada en la [12]/[13] y deducible en la [28]/[29] ([30]/[31]).
        when v.book in ('received', 'investment') and v.operation_key = '09' then
          case when v.book = 'investment' or v.investment_good then array['10', '11', '38', '39'] else array['10', '11', '36', '37'] end
        when v.book in ('received', 'investment') and v.reverse_charge then
          case when v.book = 'investment' or v.investment_good then array['12', '13', '30', '31'] else array['12', '13', '28', '29'] end
        when v.deductible_later then '{}'::text[]
        when v.book = 'investment' or v.investment_good then array['30', '31']
        when v.book = 'received' then array['28', '29']
        else '{}'::text[] end as cajas) x
$$;

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
  v_sp record; v_em record;
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
    -- 0410 · Una factura de lote (los riders y las flotas de Catcher): su
    -- contraparte es su EMISOR, que va en la factura (issuer_*), no la ficha
    -- genérica «RIDERS» ni su tercero, que no tienen NIF.
    if v_e.source_type = 'supplier_invoice' then
      select si.issuer_tax_id, si.issuer_name into v_em
        from public.supplier_invoice si
       where si.id = v_e.source_id and si.account_id = v_e.account_id and si.source = 'lote' and si.issuer_tax_id is not null;
      if found then
        v_nif := v_em.issuer_tax_id; v_nombre := coalesce(v_em.issuer_name, v_nombre); v_tipo_id := null; v_pais := null;
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

drop function if exists public.conta_recibida_iva_no_deducible(uuid, boolean, text, text, text);
alter table public.supplier_invoice drop constraint if exists supplier_invoice_vat_non_deductible_reason_check;
alter table public.supplier_invoice drop column if exists vat_non_deductible_note;
alter table public.supplier_invoice drop column if exists vat_non_deductible_reason;
