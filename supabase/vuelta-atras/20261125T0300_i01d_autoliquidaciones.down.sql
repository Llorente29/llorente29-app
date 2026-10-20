-- supabase/vuelta-atras/20261125T0300_i01d_autoliquidaciones.down.sql
--
-- Vuelta atrás de 20261125T0300_i01d_autoliquidaciones: las cuatro funciones
-- que cambia, BYTE A BYTE como estaban (las de la 0290, la 0100 del C05 y la
-- 0180 del I01b; md5 comprobado contra producción el 20/10), y fuera las cuatro
-- nuevas. Primero se devuelve el cálculo del 303, que usa conta_impuesto_303_cajas.
-- No toca datos.

create or replace function public.conta_impuesto_303_calcular(p_company uuid, p_year int, p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; p public.company_tax_profile; o public.tax_obligation; r public.tax_return;
  v_desde date; v_hasta date; v_plazo record; v_quien text := public.conta_impuesto_quien();
  v_no jsonb := '[]'; v_lineas int; v_box jsonb; b record;
  v27 numeric; v45 numeric; v46 numeric; v66 numeric; v110 numeric; v78 numeric; v69 numeric; v71 numeric;
  v_anterior public.tax_return; v_477 numeric; v_472 numeric; v_n int; v_det jsonb; v_kind text;
  v_man jsonb; v_emitidas int; v_recibidas int; v_vacio_exp boolean; v_vacio_rec boolean; v_vacio boolean;
  v_sabe110 boolean; v_sabido boolean; v_ant_y int; v_ant_p text; v_txt_vacio text; v_vienen int; v_van int;
  e text := 'FM999G999G990D00';
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, calcula sus impuestos.' using errcode = '42501';
  end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = '303' and valid_to is null and active;
  if o.id is null then raise exception 'Esta empresa no presenta el 303 (no está en sus modelos).' using errcode = 'P0002'; end if;
  if (o.cadence = 'quarterly' and p_period !~ '^[1-4]T$') or (o.cadence = 'monthly' and p_period !~ '^(0[1-9]|1[0-2])$') then
    raise exception 'Esta empresa presenta el 303 %, y «%» no es un periodo suyo.', case o.cadence when 'monthly' then 'cada mes' else 'cada trimestre' end, p_period using errcode = '22023';
  end if;
  select * into v_desde, v_hasta from public.conta_impuesto_periodo_fechas(p_year, p_period);
  select * into p from public.company_tax_profile where company_id = p_company;

  -- La declaración: la de este periodo, o una nueva en borrador.
  select * into r from public.tax_return where company_id = p_company and form_code = '303' and fiscal_year = p_year and period = p_period and sequence = 1 for update;
  if r.id is not null and r.status not in ('pending', 'draft', 'reviewed') then
    raise exception 'El 303 del % de % ya está «%»: no se recalcula.', p_period, p_year, public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if r.id is null then
    select * into v_plazo from public.conta_impuesto_plazo('303', o.cadence, p_year, p_period, 'ES-MD');
    -- La forma de pago, la de su obligación (sin ella, null: se dice al presentar).
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date,
                                   due_date_direct_debit, due_provisional, alert_on, status, payment_mode, payment_treasury_account_id)
    values (c.account_id, p_company, o.id, '303', p_year, o.cadence, p_period, v_plazo.presentacion, v_plazo.domiciliacion, v_plazo.provisional,
            case when o.payment_mode = 'direct_debit' then v_plazo.domiciliacion else v_plazo.presentacion end, 'draft',
            nullif(o.payment_mode, 'none'), case when o.payment_mode = 'direct_debit' then o.payment_treasury_account_id end)
    returning * into r;
  elsif r.status <> 'draft' then
    update public.tax_return set status = 'draft' where id = r.id returning * into r;
  end if;

  -- Lo que la empresa es y Sumied no sabe declarar.
  if coalesce(p.tax_territory, 'peninsula_baleares') <> 'peninsula_baleares' then v_no := v_no || jsonb_build_object('motivo', 'territorio', 'texto', 'La empresa no está en la Península ni en Baleares: allí no hay 303.'); end if;
  if coalesce(p.vat_scheme_code, 'general') not in ('general') then v_no := v_no || jsonb_build_object('motivo', 'regimen', 'texto', 'La empresa no está en el régimen general («' || p.vat_scheme_code || '»): Sumied todavía no lo declara.'); end if;
  if coalesce(p.vat_prorata, false) then v_no := v_no || jsonb_build_object('motivo', 'prorrata', 'texto', 'La empresa aplica prorrata: Sumied todavía no la declara.'); end if;
  if coalesce(p.vat_cash_basis, false) then v_no := v_no || jsonb_build_object('motivo', 'criterio_caja', 'texto', 'La empresa está en el criterio de caja: Sumied todavía no lo declara.'); end if;

  -- Las líneas: cada apunte vivo del libro del periodo, con sus casillas y su foto.
  delete from public.tax_return_line where tax_return_id = r.id;
  insert into public.tax_return_line (tax_return_id, account_id, company_id, vat_book_entry_id, journal_line_id, boxes, frozen)
  select r.id, v.account_id, v.company_id, v.id, v.line_id, x.cajas,
         jsonb_build_object('libro', v.book, 'tipo_factura', v.invoice_type, 'serie', v.series, 'numero', v.number, 'expedida', v.issue_date,
                            'operacion', v.operation_date, 'recibida', v.received_date, 'contraparte', v.counterpart_name, 'base', v.tax_base,
                            'tipo', v.tax_rate, 'cuota', v.tax_amount, 'deducible', v.deductible_amount, 'calificacion', v.qualification,
                            'exencion', v.exempt_cause, 'recargo', v.surcharge_amount, 'isp', v.reverse_charge, 'pais', v.counterpart_country,
                            'no_sabe', x.no_sabe,
                            -- 0290: dónde se dedujo, si no es el periodo de su fecha (con su porqué).
                            'deducida_en', case when v.deduction_period is not null then v.deduction_period || '/' || v.deduction_year end,
                            'deducida_porque', v.deduction_reason)
    from public.vat_book_entry v
    cross join lateral (select
      case
        when coalesce(v.surcharge_amount, 0) <> 0 then 'recargo'
        when v.book = 'issued' and v.invoice_type like 'R%' then 'rectificativa_expedida'
        when v.book in ('received', 'investment') and (v.reverse_charge or coalesce(v.counterpart_country, 'ES') <> 'ES') then 'autorrepercusion'
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
        when v.deductible_later then '{}'::text[]
        when v.book = 'investment' or v.investment_good then array['30', '31']
        when v.book = 'received' then array['28', '29']
        else '{}'::text[] end as cajas) x
   where v.account_id = c.account_id and v.company_id = p_company and v.voided_at is null
     -- 0290: una recibida con «deducida en» va en ESE periodo, no en el de su fecha.
     and case when v.book in ('received', 'investment') and v.deduction_period is not null
              then v.deduction_year = p_year and v.deduction_period = p_period
              else case when v.book in ('received', 'investment') then coalesce(v.received_date, v.issue_date) else coalesce(v.operation_date, v.issue_date) end
                   between v_desde and v_hasta end;
  get diagnostics v_lineas = row_count;
  select count(*) filter (where frozen->>'libro' in ('issued', 'not_subject')), count(*) filter (where frozen->>'libro' in ('received', 'investment'))
    into v_emitidas, v_recibidas from public.tax_return_line where tax_return_id = r.id;
  select coalesce(jsonb_agg(jsonb_build_object('motivo', k, 'apuntes', n, 'texto', case k
           when 'recargo' then n || ' con recargo de equivalencia: Sumied todavía no lo declara.'
           when 'rectificativa_expedida' then n || ' facturas rectificativas emitidas: Sumied todavía no las declara.'
           when 'autorrepercusion' then n || ' compras con inversión del sujeto pasivo o de fuera de España: falta la autorrepercusión.'
           when 'tipo' then n || ' ventas a un tipo que no es 4, 10 ni 21 %: falta cotejar sus casillas con la orden de 2026.' end)), '[]')
    into v_det
    from (select l.frozen->>'no_sabe' as k, count(*) as n from public.tax_return_line l where l.tax_return_id = r.id and l.frozen->>'no_sabe' is not null group by 1) q;
  v_no := v_no || v_det;

  -- 477 y 472 del diario del periodo (los anulados y sus contraasientos se compensan entre sí).
  select coalesce(sum(jl.credit - jl.debit) filter (where ca.code like '477%'), 0), coalesce(sum(jl.debit - jl.credit) filter (where ca.code like '472%'), 0)
    into v_477, v_472
    from public.journal_line jl
    join public.journal_entry je on je.id = jl.entry_id
    join public.company_account ca on ca.id = jl.company_account_id
   where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
     and je.source_type not in ('vat_settlement', 'opening', 'closing') and je.entry_date between v_desde and v_hasta;

  -- El libro vacío con el diario lleno: no hay nada que calcular, falta el libro.
  v_vacio_exp := v_emitidas = 0 and abs(v_477) >= 0.005;
  v_vacio_rec := v_recibidas = 0 and abs(v_472) >= 0.005;
  v_vacio := v_vacio_exp or v_vacio_rec;
  if v_vacio then
    v_txt_vacio := 'El libro de IVA de este periodo ' ||
      case when v_vacio_exp and v_vacio_rec then 'está vacío' when v_vacio_exp then 'no tiene ninguna factura emitida' else 'no tiene ninguna factura recibida' end ||
      ', pero el diario tiene IVA: la 477 suma ' || translate(to_char(v_477, e), ',.', '.,') || ' € y la 472, ' || translate(to_char(v_472, e), ',.', '.,') ||
      ' €. Sin el libro, Sumied no calcula el 303: tráelo a Libros y vuelve a calcular. Si ya lo presentó tu asesoría, apúntalo con «Ya lo presenté fuera» y las casillas del justificante.';
    v_no := jsonb_build_array(jsonb_build_object('motivo', 'libro_vacio', 'texto', v_txt_vacio, 'emitidas', v_emitidas, 'recibidas', v_recibidas,
                                                 'cuenta_477', v_477, 'cuenta_472', v_472)) || v_no;
  end if;

  -- Las casillas calculadas (las puestas a mano se quedan, y mandan).
  delete from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
  select coalesce(jsonb_object_agg(box, value), '{}') into v_man from public.tax_return_box
   where tax_return_id = r.id and origin = 'manual' and value is not null;
  for b in
    with l as (select l.boxes, (l.frozen->>'base')::numeric as base, (l.frozen->>'cuota')::numeric as cuota,
                      (l.frozen->>'deducible')::numeric as ded, l.frozen->>'libro' as libro, l.vat_book_entry_id
                 from public.tax_return_line l where l.tax_return_id = r.id)
    select caja, sum(valor) as valor, count(*) as n
      from (select boxes[1] as caja, base as valor from l where cardinality(boxes) >= 1
            union all
            select boxes[2], case when libro = 'issued' then cuota else ded end from l where cardinality(boxes) = 2) s
     group by caja
  loop
    insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
    values (r.id, c.account_id, p_company, b.caja, round(b.valor, 2), jsonb_build_object('apuntes', b.n, 'de', 'libro de IVA'))
    on conflict (tax_return_id, box) do nothing;
  end loop;
  -- Las sumas, como el diseño (una [27] o [45] escrita a mano manda).
  select coalesce(sum(value) filter (where box in ('152','167','03','155','06','09','11','13','15','158','170','18','21','24','26')), 0),
         coalesce(sum(value) filter (where box in ('29','31','33','35','37','39','41','42','43','44')), 0)
    into v27, v45 from public.tax_return_box where tax_return_id = r.id;
  v27 := coalesce((v_man->>'27')::numeric, v27);
  v45 := coalesce((v_man->>'45')::numeric, v45);
  v46 := v27 - v45;
  v66 := round(v46 * 100 / 100, 2);
  -- [110]: la escrita a mano, o lo que quedó por compensar del 303 del periodo
  -- INMEDIATAMENTE anterior ya presentado (su [87] y, si salió a compensar, su
  -- resultado). Si no hay ninguna de las dos, no se sabe: no es 0.
  if p_period ~ '^[1-4]T$' then
    v_ant_y := case when p_period = '1T' then p_year - 1 else p_year end;
    v_ant_p := case when p_period = '1T' then '4T' else (left(p_period, 1)::int - 1) || 'T' end;
  else
    v_ant_y := case when p_period = '01' then p_year - 1 else p_year end;
    v_ant_p := case when p_period = '01' then '12' else lpad((p_period::int - 1)::text, 2, '0') end;
  end if;
  select * into v_anterior from public.tax_return
   where company_id = p_company and form_code = '303' and fiscal_year = v_ant_y and period = v_ant_p and sequence = 1;
  if v_man ? '110' then
    v110 := (v_man->>'110')::numeric; v_sabe110 := true;
  elsif v_anterior.status in ('filed', 'booked', 'paid', 'offset', 'refunded') then
    v110 := coalesce((select value from public.tax_return_box where tax_return_id = v_anterior.id and box = '87'), 0)
          + case when v_anterior.result_kind = 'to_offset' then v_anterior.amount else 0 end;
    v_sabe110 := true;
  else
    v110 := 0; v_sabe110 := false;
  end if;
  v78 := coalesce((v_man->>'78')::numeric, least(v110, greatest(v66, 0)));
  v69 := v66 - v78;
  v71 := coalesce((v_man->>'71')::numeric, v69);
  -- ¿Se sabe el resultado? Con la [71] a mano, sí (es la del justificante). Si
  -- no, hace falta el libro (o la [27] y la [45] a mano) y, si sale a pagar,
  -- lo que quedaba de antes.
  v_sabido := v_man ? '71'
           or ((not v_vacio_exp or v_man ? '27') and (not v_vacio_rec or v_man ? '45') and (v_sabe110 or v66 <= 0));
  if v_sabido then
    insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
    select r.id, c.account_id, p_company, k, round(val, 2), jsonb_build_object('de', como)
      from (values ('27', v27, '[152]+[167]+[03]+[155]+[06]+[09]+[11]+[13]+[15]+[158]+[170]+[18]+[21]+[24]+[26]'),
                   ('45', v45, '[29]+[31]+[33]+[35]+[37]+[39]+[41]+[42]+[43]+[44]'), ('46', v46, '[27]−[45]'), ('64', v46, '[46]+[58]+[76]'),
                   ('65', 100, 'no foral: todo a la Administración del Estado'), ('66', v66, '[64]×[65] %'),
                   ('110', v110, case when v_anterior.id is null or not v_sabe110 then 'nadie ha dicho lo que quedó por compensar de antes'
                                      else 'lo que quedó por compensar del ' || v_anterior.period || '/' || v_anterior.fiscal_year || ': su [87] y, si salió a compensar, su resultado' end),
                   ('78', v78, 'lo que se compensa ahora, hasta el resultado'), ('87', v110 - v78, '[110]−[78]'),
                   ('69', v69, '[66]+[77]−[78]+[68]+[108]'), ('71', v71, '[69]−[70]+[109]−[112]')) t(k, val, como)
     where k <> '110' or v_sabe110
    on conflict (tax_return_id, box) do nothing;
  else
    -- Sin resultado, ninguna casilla calculada: un cero aquí parecería un dato.
    delete from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
    -- Salvo la [110] (0280): no sale del libro de este periodo sino del 303
    -- anterior presentado, así que se sabe aunque falte el libro. Sin ella, un
    -- borrador calculado antes de tener el anterior se quedaba sin [110] para
    -- siempre (Foodint, 19/10: el 3T con la 477 y la 472 llenas y el libro vacío).
    if v_sabe110 then
      insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
      values (r.id, c.account_id, p_company, '110', round(v110, 2),
              jsonb_build_object('de', 'lo que quedó por compensar del ' || v_anterior.period || '/' || v_anterior.fiscal_year || ': su [87] y, si salió a compensar, su resultado'))
      on conflict (tax_return_id, box) do nothing;
    end if;
  end if;

  -- El resultado, en la declaración (sin saberlo, ninguno).
  v_kind := case when not v_sabido then null
                 when v_lineas = 0 and v71 = 0 then 'no_activity' when v71 > 0 then 'to_pay' when v71 = 0 then 'zero'
                 when p_period in ('4T', '12') and r.payment_mode = 'refund' then 'to_refund' else 'to_offset' end;
  update public.tax_return set result_kind = v_kind, amount = case when v_sabido then abs(v71) end, calculated_at = now(), updated_at = now() where id = r.id;

  -- Lo comprobado (se rehace entero: si cambian los números, se vuelve a mirar).
  delete from public.tax_return_check where tax_return_id = r.id;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'book_vs_303', case when jsonb_array_length(v_no) > 0 then 'error' else 'ok' end,
          case when v_vacio
               then v_txt_vacio || coalesce(' Y además: ' || (select string_agg(x->>'texto', ' ') from jsonb_array_elements(v_no) x where x->>'motivo' <> 'libro_vacio'), '')
               when jsonb_array_length(v_no) > 0
               then 'Hay cosas que Sumied todavía no sabe declarar en este 303. Preséntalo con tu asesor o espera a que lo sepa: ' ||
                    (select string_agg(x->>'texto', ' ') from jsonb_array_elements(v_no) x)
               when v_lineas = 0 then 'No hay facturas en el libro de IVA de este periodo, y el diario tampoco tiene IVA.'
               else 'Las ' || v_lineas || ' facturas del libro de IVA de este periodo están en el 303, cada una en su casilla.' end,
          jsonb_build_object('apuntes', v_lineas, 'emitidas', v_emitidas, 'recibidas', v_recibidas, 'no_sabe', v_no));

  -- El diario contra el 303 (con el libro vacío no hay 303 con que comparar: lo dice la de arriba).
  if not v_vacio then
    insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
    values (r.id, c.account_id, p_company, 'ledger_477_472',
            case when abs(v_477 - v27) < 0.005 and abs(v_472 - v45) < 0.005 then 'ok' else 'warning' end,
            case when abs(v_477 - v27) < 0.005 and abs(v_472 - v45) < 0.005
                 then 'El diario dice lo mismo que el 303: la 477 (' || translate(to_char(v_477, e), ',.', '.,') || ' €) y la 472 (' || translate(to_char(v_472, e), ',.', '.,') || ' €).'
                 else 'El diario no dice lo mismo que el 303: la 477 suma ' || translate(to_char(v_477, e), ',.', '.,') || ' € frente a ' || translate(to_char(v27, e), ',.', '.,') ||
                      ' €, y la 472, ' || translate(to_char(v_472, e), ',.', '.,') || ' € frente a ' || translate(to_char(v45, e), ',.', '.,') || ' €. Puede ser una factura recibida apuntada en un trimestre y llegada en otro.' end,
            jsonb_build_object('cuenta_477', v_477, 'casilla_27', v27, 'cuenta_472', v_472, 'casilla_45', v45));
  end if;

  -- Recibidas que llegaron en el periodo con fecha de antes: van en este.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('numero', frozen->>'numero', 'expedida', frozen->>'expedida', 'recibida', frozen->>'recibida', 'contraparte', frozen->>'contraparte')), '[]')
    into v_n, v_det
    from public.tax_return_line where tax_return_id = r.id and frozen->>'libro' in ('received', 'investment') and (frozen->>'expedida')::date < v_desde;
  -- 0290: y las que se dedujeron en otro periodo que el de su fecha, a los dos
  -- lados: las que vienen a este y las de este que se fueron a otro (regla 7).
  select count(*) into v_vienen from public.tax_return_line
   where tax_return_id = r.id and frozen->>'deducida_en' is not null
     and coalesce((frozen->>'recibida')::date, (frozen->>'expedida')::date) not between v_desde and v_hasta;
  select count(*) into v_van from public.vat_book_entry v
   where v.account_id = c.account_id and v.company_id = p_company and v.voided_at is null and v.book in ('received', 'investment')
     and v.deduction_period is not null and not (v.deduction_year = p_year and v.deduction_period = p_period)
     and coalesce(v.received_date, v.issue_date) between v_desde and v_hasta;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'out_of_period', case when v_n + v_vienen + v_van > 0 then 'warning' else 'ok' end,
          case when v_n + v_vienen + v_van = 0 then 'Ninguna factura de otro periodo.'
               else concat_ws(' ',
                 case when v_n = 1 then '1 factura recibida tiene fecha de antes del periodo, pero llegó en él: va en este 303.'
                      when v_n > 1 then v_n || ' facturas recibidas tienen fecha de antes del periodo, pero llegaron en él: van en este 303.' end,
                 case when v_vienen = 1 then '1 recibida de otro periodo se dedujo en este (deducida en): va en este 303.'
                      when v_vienen > 1 then v_vienen || ' recibidas de otro periodo se dedujeron en este (deducida en): van en este 303.' end,
                 case when v_van = 1 then '1 recibida de este periodo se dedujo en otro (deducida en): no va en este 303.'
                      when v_van > 1 then v_van || ' recibidas de este periodo se dedujeron en otro (deducida en): no van en este 303.' end) end,
          jsonb_build_object('facturas', v_det, 'deducidas_aqui_de_otro_periodo', v_vienen, 'de_aqui_deducidas_en_otro', v_van));

  -- Recibidas por correo (D01) sin apuntar: no entran hasta que se validen.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', si.id, 'numero', si.invoice_number, 'fecha', si.invoice_date, 'emisor', si.issuer_name)), '[]')
    into v_n, v_det
    from public.supplier_invoice si
   where si.account_id = c.account_id and si.company_id = p_company and si.arrival_channel = 'correo'
     and si.status not in ('anulada', 'descartada') and si.journal_entry_id is null and si.invoice_date <= v_hasta;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'mail_invoices_missing', case when v_n > 0 then 'warning' else 'ok' end,
          case when v_n = 0 then 'No falta ninguna factura recibida por correo.'
               when v_n = 1 then '1 factura que llegó por correo está sin apuntar: no entra en este 303 hasta que se valide.'
               else v_n || ' facturas que llegaron por correo están sin apuntar: no entran en este 303 hasta que se validen.' end,
          jsonb_build_object('facturas', v_det));

  -- Lo que quedó por compensar antes: si no se sabe, se pide (no se da por 0).
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'previous_offset',
          case when v_sabe110 then 'ok' else 'error' end,
          case when v_man ? '110'
               then 'Lo que quedaba por compensar de antes lo escribió una persona: ' || translate(to_char(v110, e), ',.', '.,') || ' €.'
               when v_sabe110
               then 'Del 303 del ' || v_anterior.period || '/' || v_anterior.fiscal_year || ' quedaron ' || translate(to_char(v110, e), ',.', '.,') || ' € por compensar.'
               else 'No sé lo que te quedó por compensar de antes: el 303 del ' || v_ant_p || '/' || v_ant_y ||
                    case when v_anterior.id is null then ' no está en Sumied' else ' no está presentado en Sumied' end ||
                    '. Escríbelo en la casilla [110], aunque sea 0 (está en el justificante del ' || v_ant_p || '/' || v_ant_y || ', casilla [87], más el resultado si salió a compensar).' end,
          jsonb_build_object('casilla_110', case when v_sabe110 then v110 end, 'anterior', v_anterior.id, 'periodo_anterior', v_ant_p || '/' || v_ant_y,
                             'a_mano', v_man ? '110'));

  select jsonb_object_agg(box, value) into v_box from public.tax_return_box where tax_return_id = r.id and value is not null;
  return jsonb_build_object('declaracion', r.id, 'desde', v_desde, 'hasta', v_hasta, 'apuntes', v_lineas, 'resultado', v_kind,
                            'importe', case when v_sabido then abs(v71) end, 'sabido', v_sabido,
                            'casillas', coalesce(v_box, '{}'), 'no_sabe', v_no, 'quien', v_quien);
end $$;

comment on function public.conta_impuesto_303_calcular(uuid, int, text) is
  'I01a/I01b (0240), I01c (0280, 0290). El borrador del 303 del periodo desde el libro de IVA. Una recibida con «deducida en» va en ese periodo (0290). Con el libro vacío y el diario con IVA, o sin saber la [110] cuando sale a pagar, no hay resultado: se dice por qué. Las casillas manuales mandan. La [110] del 303 anterior presentado se escribe también sin resultado (0280). Una presentada no se recalcula.';

create or replace function public.conta_libro_iva_deducir_en(p_company uuid, p_claves jsonb, p_year int, p_period text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; v_pedidas int; v_halladas int; v_marcadas int; v_faltan jsonb; v_testigo jsonb;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo quien gestiona los impuestos de la empresa cambia dónde se dedujo una factura.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_claves) <> 'array' or jsonb_array_length(p_claves) = 0 then
    raise exception 'Faltan las facturas: una lista de claves de Diez (ejercicio, serie y documento).' using errcode = '22023';
  end if;
  if p_period is not null and (p_year is null or p_period !~ '^([1-4]T|0[1-9]|1[0-2])$') then
    raise exception '«%» no es un periodo del 303.', p_period using errcode = '22023';
  end if;
  if p_period is not null and (p_motivo is null or btrim(p_motivo) = '') then
    raise exception 'Di por qué: de dónde sale que se dedujo en el % de %.', p_period, p_year using errcode = '22023';
  end if;

  -- Cada clave, su asiento de Diez en ESTA empresa (regla 9: cuenta y empresa).
  drop table if exists pg_temp._claves;
  create temporary table _claves on commit drop as
  select x->>'e' e, x->>'s' s, x->>'n' n, je.id entry_id
    from jsonb_array_elements(p_claves) x
    left join public.journal_entry je on je.account_id = c.account_id and je.company_id = p_company
     and je.external_program = 'diez' and je.external_year = x->>'e' and je.external_series = x->>'s' and je.external_number = x->>'n';
  select count(*), count(entry_id) into v_pedidas, v_halladas from _claves;
  select coalesce(jsonb_agg(jsonb_build_object('e', e, 's', s, 'n', n)), '[]') into v_faltan from _claves where entry_id is null
     or not exists (select 1 from public.vat_book_entry v where v.entry_id = _claves.entry_id and v.book in ('received', 'investment') and v.voided_at is null);
  -- Si falta alguna, ninguna: o la lista entera, o nada.
  if jsonb_array_length(v_faltan) > 0 then
    return jsonb_build_object('marcadas', 0, 'pedidas', v_pedidas, 'faltan', v_faltan,
                              'texto', jsonb_array_length(v_faltan) || ' de ' || v_pedidas || ' no son recibidas de esta empresa en el libro de IVA: no se ha marcado ninguna.');
  end if;
  update public.vat_book_entry v
     set deduction_year = case when p_period is null then null else p_year end,
         deduction_period = p_period,
         deduction_reason = case when p_period is null then null else btrim(p_motivo) end,
         updated_at = now()
    from _claves k
   where v.entry_id = k.entry_id and v.account_id = c.account_id and v.company_id = p_company
     and v.book in ('received', 'investment') and v.voided_at is null;
  get diagnostics v_marcadas = row_count;
  -- El testigo: en cada trimestre del año que toca la carga, la [28] y la [29]
  -- del libro (recibidas interiores corrientes, ya con «deducida en») contra
  -- las del 303 PRESENTADO (con su justificante). Al céntimo; sin 303
  -- presentado, se dice y no se compara.
  with ef as (
    select v.tax_base, coalesce(v.deductible_amount, v.tax_amount) ded,
           case when v.deduction_period is not null then v.deduction_year else extract(year from coalesce(v.received_date, v.issue_date))::int end y,
           coalesce(v.deduction_period, extract(quarter from coalesce(v.received_date, v.issue_date))::int || 'T') per
      from public.vat_book_entry v
     where v.account_id = c.account_id and v.company_id = p_company and v.voided_at is null and v.book = 'received'
       and not v.reverse_charge and not v.investment_good and not v.deductible_later and v.invoice_type not like 'R%'
  ), periodos as (
    select distinct y, per from ef
     where per ~ '^[1-4]T$' and y = coalesce(p_year, (select min(je.external_year)::int from _claves k join public.journal_entry je on je.id = k.entry_id))
  ), libro as (
    select y, per, round(sum(tax_base), 2) c28, round(sum(ded), 2) c29 from ef group by y, per
  )
  select coalesce(jsonb_agg(jsonb_build_object('periodo', p.per || '/' || p.y,
           'libro_28', l.c28, 'libro_29', l.c29,
           'presentado_28', (select b.value from public.tax_return_box b where b.tax_return_id = r.id and b.box = '28'),
           'presentado_29', (select b.value from public.tax_return_box b where b.tax_return_id = r.id and b.box = '29'),
           'presentado', r.id is not null,
           'casa', r.id is not null
                   and coalesce(l.c28, 0) = coalesce((select b.value from public.tax_return_box b where b.tax_return_id = r.id and b.box = '28'), 0)
                   and coalesce(l.c29, 0) = coalesce((select b.value from public.tax_return_box b where b.tax_return_id = r.id and b.box = '29'), 0))
           order by p.per), '[]')
    into v_testigo
    from periodos p left join libro l on l.y = p.y and l.per = p.per
    left join lateral (select r.id from public.tax_return r
                        where r.account_id = c.account_id and r.company_id = p_company and r.form_code = '303'
                          and r.fiscal_year = p.y and r.period = p.per and r.sequence = 1
                          and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
                          and exists (select 1 from public.tax_return_box b where b.tax_return_id = r.id and b.origin = 'justificante')) r on true;
  return jsonb_build_object('marcadas', v_marcadas, 'pedidas', v_pedidas, 'faltan', '[]'::jsonb, 'testigo', v_testigo,
    'casa', not exists (select 1 from jsonb_array_elements(v_testigo) x where not (x->>'casa')::boolean),
    'texto', case when p_period is null
                  then v_marcadas || ' líneas del libro de ' || v_pedidas || ' facturas vuelven al periodo de su fecha.'
                  else v_marcadas || ' líneas del libro de ' || v_pedidas || ' facturas, deducidas en el ' || p_period || ' de ' || p_year || '.' end);
end $$;

create or replace function public.conta_vat_book_desde_asiento(p_entry uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_e public.journal_entry; v_n integer := 0; l record;
  v_tipo text; v_num text; v_hasta text; v_docs int; v_fecha_op date; v_recep date; v_nif text; v_tipo_id text; v_pais text; v_nombre text;
  v_clave text; v_calif text; v_exenta text; v_corrige text; v_ret_tipo numeric; v_ret numeric; v_inv boolean; v_isp boolean;
  v_act_code text := 'A'; v_act_tipo text := '03'; v_iae text;
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
    v_inv := l.vat_book = 'investment'; v_isp := l.treatment = 'reverse_charge';
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
end $$;

create or replace function public.conta_motivos_para_validar(p_entry uuid)
returns table (orden int, codigo text, motivo text)
language plpgsql
stable
set search_path = public
as $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_n int; v_debe numeric; v_haber numeric; v_cierre boolean; v_mal text; v_aclarar int; v_lista text;
  v_local boolean; v_liquidacion boolean;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null then return; end if;

  -- Regla 1: cuadra, al céntimo.
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber
    from public.journal_line where entry_id = p_entry;
  if v_n < 2 then
    orden := 1; codigo := 'pocos_apuntes'; motivo := 'Un asiento lleva al menos dos apuntes.'; return next;
  end if;
  if v_debe <> v_haber then
    orden := 2; codigo := 'no_cuadra';
    motivo := format('No cuadra: Debe %s y Haber %s, diferencia %s.', v_debe, v_haber, v_debe - v_haber); return next;
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_e.entry_date not between v_y.starts_on and v_y.ends_on then
    orden := 3; codigo := 'fuera_del_ejercicio';
    motivo := format('La fecha %s no es del ejercicio %s.', to_char(v_e.entry_date, 'DD/MM/YYYY'), v_y.code); return next;
  end if;
  if v_e.source_type <> 'migrated' then
    if v_y.status <> 'open' then
      orden := 4; codigo := 'ejercicio_cerrado'; motivo := format('El ejercicio %s está cerrado.', v_y.code); return next;
    end if;
    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      orden := 5; codigo := 'falta_historico';
      motivo := format('Primero hay que traer el histórico de %s de %s.',
        case lower(v_y.origin_program) when 'diez' then 'Diez' else v_y.origin_program end, v_y.code); return next;
    end if;
    if v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until then
      orden := 6; codigo := 'traido';
      motivo := format('Hasta el %s el ejercicio %s es traído de %s: la fecha abierta más cercana es el %s.',
        to_char(v_y.imported_until, 'DD/MM/YYYY'), v_y.code, v_y.origin_program,
        to_char(public.conta_primer_dia_abierto(v_e.company_id, v_y.imported_until + 1), 'DD/MM/YYYY')); return next;
    end if;
    if public.conta_mes_cerrado(v_e.company_id, v_e.entry_date) then
      orden := 7; codigo := 'mes_cerrado';
      motivo := format('El mes de %s está cerrado: la fecha abierta más cercana es el %s.',
        to_char(v_e.entry_date, 'MM/YYYY'),
        coalesce(to_char(public.conta_primer_dia_abierto(v_e.company_id, v_e.entry_date), 'DD/MM/YYYY'), 'ninguna')); return next;
    end if;

    -- C05 (respuesta 3), copiado de la vigente: un asiento de cierre o de
    -- apertura del generador de cierre (o su contraasiento) se libra de las
    -- reglas de IVA y retención.
    v_cierre := exists (
      select 1 from public.journal_entry o
        join public.fiscal_year oy on oy.id = o.fiscal_year_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.source_type in ('closing', 'opening')
         and coalesce(o.reasons, '[]'::jsonb) @> '[{"decision": "cierre-del-ejercicio"}]'::jsonb
         and exists (
           select 1 from public.fiscal_year_closing c
            where c.company_id = o.company_id
              and ((o.source_type = 'closing' and c.fiscal_year_id = o.fiscal_year_id
                    and o.id in (c.regularization_entry_id, c.closing_entry_id))
                or (o.source_type = 'opening' and c.opening_entry_id = o.id
                    and exists (select 1 from public.fiscal_year a
                                 where a.id = c.fiscal_year_id and a.ends_on + 1 = oy.starts_on)))));

    -- I01b (0180): el asiento de liquidación de un 303 (o su contraasiento)
    -- salda la 477 y la 472 del periodo: sus apuntes no llevan tipo ni libro
    -- registro. Solo si su origen es una declaración 303 de su misma empresa.
    v_liquidacion := exists (
      select 1 from public.journal_entry o
        join public.tax_return t on t.id = o.source_id and t.company_id = o.company_id and t.account_id = o.account_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.company_id = v_e.company_id
         and o.source_type = 'vat_settlement'
         and t.form_code = '303');

    -- S01 (0140): el local solo se pide si el eje «local» de la empresa está encendido
    -- (conta_eje_analitico; sin fila = apagado). Lo demás, como estaba.
    v_local := exists (select 1 from public.conta_eje_analitico x
                        where x.company_id = v_e.company_id and x.account_id = v_e.account_id and x.eje = 'local' and x.activo);

    -- Regla 5, copiada de la vigente (20261113T0100: el céntimo de redondeo).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre and not v_liquidacion
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
          then 'una retención lleva su tipo, su base y su modelo'
        when v_local and not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then
      orden := 8; codigo := 'apuntes'; motivo := format('No se valida: %s.', v_mal); return next;
    end if;
  end if;

  -- C06b (#210): un asiento de ventas del día con un envío por aclarar. Copiado
  -- de tg_journal_entry_envio_por_aclarar, que desde aquí lo lee de esta función.
  if v_e.source_type = 'sales_day' then
    select count(*), string_agg(coalesce(s.platform_order_code, left(s.id::text, 8)) || ' (envío ' || public.conta_euros_exactos(c.envio) || ', ' || c.por_que || ')', '; ' order by s.sold_at)
      into v_aclarar, v_lista
      from public.sales_day_summary d
      cross join lateral public.conta_cargos_de_pedidos(d.account_id, d.sale_ids) c
      join public.sale s on s.id = c.id and s.account_id = d.account_id
     where d.entry_id = v_e.id and d.account_id = v_e.account_id and c.clase = 'por_aclarar';
    if v_aclarar > 0 then
      orden := 9; codigo := 'envio_por_aclarar';
      motivo := format('No se valida: %s con envío por aclarar: %s. Se resuelve con la liquidación de esa semana.',
        v_aclarar || case when v_aclarar = 1 then ' pedido' else ' pedidos' end, v_lista); return next;
    end if;
  end if;
end $function$;

drop function if exists public.conta_impuesto_303_desde_libro(uuid, int, text);
drop function if exists public.conta_impuesto_303_cajas(public.vat_book_entry);
drop function if exists public.conta_proveedor_iva_clase(text, text, text, text, text);
drop function if exists public.conta_pais_nombre(text);
