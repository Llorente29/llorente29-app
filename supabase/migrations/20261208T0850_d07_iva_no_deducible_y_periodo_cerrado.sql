-- supabase/migrations/20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.sql
-- cambia: public.conta_vat_book_desde_asiento · prueba: supabase/staging/sql/20261208_d07_iva_no_deducible_prueba.sql
-- cambia: public.conta_impuesto_303_cajas · prueba: supabase/staging/sql/20261208_d07_iva_no_deducible_prueba.sql
--
-- D07 · IVA NO DEDUCIBLE CON SU MOTIVO, Y LA RECIBIDA DE UN PERIODO CERRADO
-- (Julio, 23/10; D07 punto 2 y D07b punto 3).
--
-- 1. supplier_invoice.vat_non_deductible_reason y vat_non_deductible_note
--    (AÑADE, columnas que admiten nulos): por qué no se deduce su IVA —
--    'no_a_nombre' (no va a nombre de la empresa), 'ticket_sin_nif' o 'otro'
--    con su texto—. Caso: Orange S11/0177416578 del 05/10.
-- 2. conta_recibida_iva_no_deducible(factura, sí/no, motivo, texto, quién)
--    (AÑADE): lo marca o lo quita desde la ficha, con su historial; si la
--    factura tenía su asiento PROPUESTO, se quita para proponerlo otra vez. Una
--    contabilizada no se cambia (como conta_recibida_guardar).
-- 3. conta_impuesto_303_cajas (CAMBIA en caliente, misma firma): una recibida
--    con IVA no deducible (deducible 0 y cuota distinta de 0, sin inversión del
--    sujeto pasivo) no entra en el 303. Sale en el libro de recibidas, con su
--    cuota y deducible 0 (lo escribe el asiento: la cuota en su propia línea,
--    en la cuenta de gasto, con vat_deductible 'no'). Medido el 23/10 en
--    producción (solo lectura): 0 líneas del libro así, de todas las cuentas:
--    no cambia la casilla de nada de lo que ya hay.
-- 4. conta_vat_book_desde_asiento (CAMBIA en caliente, misma firma): una
--    recibida conserva su FECHA DE FACTURA en el libro (expedición) aunque se
--    asiente otro día, y su fecha de registro es la de entrada o, si es
--    después, la del asiento: su IVA va al periodo en que se asienta. Caso:
--    CARREFOUR 2026FBFN01634861 del 06/08, con agosto cerrado: se asienta el
--    primer día abierto. Antes, la expedición salía de la fecha del asiento (el
--    libro diría octubre) y el registro de created_at (el 303 la pondría en el
--    3T, cerrado). Solo lo escriben los asientos que se validen desde ahora (la
--    función sale si el asiento ya tiene libro): nada de lo que hay cambia.
--    Una factura normal (asiento en su fecha, entrada después) queda igual.
--
-- Cuerpo de partida de las dos funciones, el de PRODUCCIÓN (md5 del cuerpo:
-- conta_vat_book_desde_asiento 2a2b8594c58d568dfc4bf37478306bfd, la 0410;
-- conta_impuesto_303_cajas d15814822393969b4336775f74f96644, la 0300).
-- Misma firma: create or replace, sin sobrecarga (regla 2). No toca filas. No
-- toca el camino del pedido.
-- sin hueco: no retira nada al aplicarse; el «delete from journal_entry» va
-- dentro de conta_recibida_iva_no_deducible y solo quita el asiento PROPUESTO
-- de la recibida que alguien acaba de marcar, para que se proponga otra vez
-- con lo nuevo (como conta_recibida_guardar). Ningún asiento validado.
-- Vuelta atrás: supabase/vuelta-atras/20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.down.sql

-- 1 · El motivo -----------------------------------------------------------------------------
alter table public.supplier_invoice add column if not exists vat_non_deductible_reason text;
alter table public.supplier_invoice add column if not exists vat_non_deductible_note text;
alter table public.supplier_invoice drop constraint if exists supplier_invoice_vat_non_deductible_reason_check;
alter table public.supplier_invoice add constraint supplier_invoice_vat_non_deductible_reason_check
  check (vat_non_deductible_reason is null or vat_non_deductible_reason in ('no_a_nombre', 'ticket_sin_nif', 'otro'));
comment on column public.supplier_invoice.vat_non_deductible_reason is
  'D07 (0850). Por qué su IVA no se deduce: no_a_nombre (no va a nombre de la empresa), ticket_sin_nif u otro (con su texto en vat_non_deductible_note).';
comment on column public.supplier_invoice.vat_non_deductible_note is 'D07 (0850). El texto del motivo «otro».';

-- 2 · Marcarlo desde la ficha ------------------------------------------------------------------
create or replace function public.conta_recibida_iva_no_deducible(p_invoice uuid, p_no_deducible boolean, p_motivo text default null,
  p_texto text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_texto text := nullif(trim(p_texto), '');
  v_motivo text := case when coalesce(p_no_deducible, false) then nullif(trim(p_motivo), '') end;
  v_quitados int := 0;
  v_dicho text;
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'Está %: no se cambia.', v_f.status using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice'
                and e.source_id = v_f.id and e.status = 'validado') then
    raise exception 'Ya está contabilizada: para cambiar si su IVA se deduce, anula su asiento.' using errcode = '22023';
  end if;
  if coalesce(p_no_deducible, false) and (v_motivo is null or v_motivo not in ('no_a_nombre', 'ticket_sin_nif', 'otro')) then
    raise exception 'Di por qué no se deduce: no va a nombre de la empresa, es un ticket sin NIF u otro motivo (con su texto).' using errcode = '22023';
  end if;
  if v_motivo = 'otro' and v_texto is null then
    raise exception 'Con «Otro motivo», escribe cuál.' using errcode = '22023';
  end if;
  v_dicho := case v_motivo when 'no_a_nombre' then 'no va a nombre de la empresa' when 'ticket_sin_nif' then 'es un ticket sin NIF'
                           when 'otro' then v_texto end;
  update public.supplier_invoice
     set vat_non_deductible = coalesce(p_no_deducible, false),
         vat_non_deductible_reason = v_motivo,
         vat_non_deductible_note = case when v_motivo = 'otro' then v_texto end,
         updated_at = now()
   where id = v_f.id;
  delete from public.journal_entry e
   where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id and e.status in ('propuesto', 'borrador');
  get diagnostics v_quitados = row_count;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'guardar', jsonb_build_array(jsonb_build_object('campo', 'iva_no_deducible',
          'antes', jsonb_build_object('no_deducible', v_f.vat_non_deductible, 'motivo', v_f.vat_non_deductible_reason, 'texto', v_f.vat_non_deductible_note),
          'ahora', jsonb_build_object('no_deducible', coalesce(p_no_deducible, false), 'motivo', v_motivo, 'texto', case when v_motivo = 'otro' then v_texto end))));
  return jsonb_build_object('no_deducible', coalesce(p_no_deducible, false), 'motivo', v_motivo, 'asiento_quitado', v_quitados > 0,
    'texto', case when coalesce(p_no_deducible, false)
                  then 'Guardado: su IVA no se deduce (' || v_dicho || '). Va a su gasto, sale en el libro de recibidas como no deducible y no entra en el 303.'
                  else 'Guardado: su IVA se deduce.' end
             || case when v_quitados > 0 then ' Su asiento propuesto se ha quitado para proponerlo otra vez.' else '' end);
end $$;
revoke all on function public.conta_recibida_iva_no_deducible(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.conta_recibida_iva_no_deducible(uuid, boolean, text, text, text) to authenticated;

-- 3 · El 303 ----------------------------------------------------------------------------------
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
        -- D07 (0850): una recibida con IVA NO deducible (la factura no va a
        -- nombre de la empresa, un ticket sin NIF…) sale en el libro, con su
        -- cuota y deducible 0, pero no entra en el 303: ni su base en la [28]
        -- ni nada en la [29]. Medido el 23/10: 0 líneas así en producción.
        when v.book in ('received', 'investment') and not v.reverse_charge and v.operation_key <> '09'
             and coalesce(v.deductible_amount, 0) = 0 and coalesce(v.tax_amount, 0) <> 0 then '{}'::text[]
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

-- 4 · El libro de IVA -----------------------------------------------------------------------
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
  v_sp record; v_em record; v_fac date;
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
    v_fecha_op := null; v_recep := null; v_fac := null; v_corrige := null; v_ret_tipo := null; v_ret := null;
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
      -- D07 (0850): la recibida conserva SU fecha de factura (la de expedición),
      -- aunque se asiente otro día (un periodo cerrado: el primer día abierto);
      -- y se registra el día que entró o, si es después, el del asiento: su IVA
      -- va al periodo en que se asienta (el 303 reparte por esta fecha).
      select si.invoice_number, greatest(si.created_at::date, v_e.entry_date), case when si.doc_kind = 'credit_note' then 'R1' else 'F1' end,
             (select c.invoice_number from public.supplier_invoice c where c.id = si.corrects_invoice_id),
             wr.rate, si.withholding_amount, si.invoice_date
        into v_num, v_recep, v_tipo, v_corrige, v_ret_tipo, v_ret, v_fac
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
      coalesce(l.document_date, v_e.document_date, v_fac, v_e.entry_date), v_fecha_op, v_recep, coalesce(l.party_id, v_e.party_id),
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
