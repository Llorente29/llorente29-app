-- supabase/migrations/20261122T0240_i01b_303_no_inventa.sql
-- cambia: public.conta_impuesto_303_calcular · prueba: supabase/staging/sql/20261122_i01b_303_no_inventa_prueba.sql
-- cambia: public.conta_impuesto_303_fichero · prueba: supabase/staging/sql/20261122_i01b_303_no_inventa_prueba.sql
-- cambia: public.conta_impuesto_fuera · prueba: supabase/staging/sql/20261122_i01b_303_no_inventa_prueba.sql
--
-- I01b · EL 303 NO SE INVENTA LO QUE NO SABE (Julio, 18/10: «hay que dejar
-- todo perfecto»). Lo enseñó el 3T de Foodint: el libro de IVA del periodo
-- estaba vacío (los libros de Diez aún no se habían traído), el diario tenía
-- la 477 y la 472 llenas, y la pantalla decía «0,00 € · sin actividad»
-- cuando la gestoría sacaba −3.723,44 € a compensar. El cero no era un
-- resultado: era la falta del libro, dicha como si fuera un dato.
--
-- Cambia en caliente tres funciones (la misma firma) y añade una:
--
--   conta_impuesto_303_calcular(empresa, ejercicio, periodo)   [la persona]
--     La de la 0140, salvo:
--     · Si el libro de emitidas del periodo está vacío y la 477 del diario no,
--       o el de recibidas está vacío y la 472 no, «book_vs_303» sale en ERROR
--       (motivo «libro_vacio», con lo que suman la 477 y la 472) y el 303 NO
--       se calcula: sin resultado, sin importe y sin casillas calculadas. Un
--       error no se puede «dar por bueno»: para revisar, para el fichero y
--       para presentar.
--     · La [110] (lo que quedó por compensar de antes) ya no se da por 0: sale
--       del 303 del periodo INMEDIATAMENTE anterior presentado (su [87] y, si
--       salió a compensar, su resultado) o la escribe una persona, aunque sea
--       0. Si no, «previous_offset» sale en ERROR (antes, aviso) y, si el
--       periodo sale a pagar, tampoco hay resultado: depende de esa casilla.
--     · Las casillas puestas a mano entran en las cuentas: la [27], la [45],
--       la [110], la [78] y la [71] de una persona mandan sobre las calculadas
--       (antes se quedaban en la tabla pero la suma no las miraba).
--     · Si la libreta no está vacía y el diario sí cuadra, todo como antes.
--   conta_impuesto_casillas_poner(declaración, casillas, motivo) [la persona]
--     NUEVA. Escribe a mano casillas del 303 (la [110] de antes, o las del
--     justificante de lo presentado fuera), cada una con el motivo y quién; un
--     valor null quita la que se puso. Solo casillas que el 303 de Sumied
--     calcula. Si a la vez quedan la [27], la [45], la [78] y la [71], tienen
--     que cuadrar ([27]−[45]−[78] = [71]), y la [87] con [110]−[78]. Después
--     vuelve a calcular.
--   conta_impuesto_303_fichero(declaración)                    [solo service_role]
--     La de la 0140, y además: con un aviso sin dar por bueno no se prepara el
--     fichero (antes solo paraban los errores; la pantalla ya lo pedía para
--     presentar, pero «Descargar el fichero oficial» lo saltaba).
--   conta_impuesto_fuera(…)                                    [solo service_role]
--     La de la 0150, y además: con algo en error (menos el formato del
--     fichero), solo se apunta como presentada fuera si una persona ha
--     escrito las casillas del justificante (al menos la [71]) y, si falta lo
--     de antes, la [110]. Así lo que queda como presentado es lo que se
--     presentó, no lo que Sumied no supo calcular.
--
-- No toca el camino del pedido ni ninguna tabla: solo funciones.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0240_i01b_303_no_inventa.down.sql

-- ── 1. Calcular ─────────────────────────────────────────────────────────────
create or replace function public.conta_impuesto_303_calcular(p_company uuid, p_year int, p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; p public.company_tax_profile; o public.tax_obligation; r public.tax_return;
  v_desde date; v_hasta date; v_plazo record; v_quien text := public.conta_impuesto_quien();
  v_no jsonb := '[]'; v_lineas int; v_box jsonb; b record;
  v27 numeric; v45 numeric; v46 numeric; v66 numeric; v110 numeric; v78 numeric; v69 numeric; v71 numeric;
  v_anterior public.tax_return; v_477 numeric; v_472 numeric; v_n int; v_det jsonb; v_kind text;
  v_man jsonb; v_emitidas int; v_recibidas int; v_vacio_exp boolean; v_vacio_rec boolean; v_vacio boolean;
  v_sabe110 boolean; v_sabido boolean; v_ant_y int; v_ant_p text; v_txt_vacio text;
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
                            'no_sabe', x.no_sabe)
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
     and case when v.book in ('received', 'investment') then coalesce(v.received_date, v.issue_date) else coalesce(v.operation_date, v.issue_date) end
         between v_desde and v_hasta;
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
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'out_of_period', case when v_n > 0 then 'warning' else 'ok' end,
          case when v_n = 0 then 'Ninguna factura de otro periodo.'
               when v_n = 1 then '1 factura recibida tiene fecha de antes del periodo, pero llegó en él: va en este 303.'
               else v_n || ' facturas recibidas tienen fecha de antes del periodo, pero llegaron en él: van en este 303.' end,
          jsonb_build_object('facturas', v_det));

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
  'I01a/I01b (0240). El borrador del 303 del periodo desde el libro de IVA. Con el libro vacío y el diario con IVA, o sin saber la [110] cuando sale a pagar, no hay resultado: se dice por qué. Las casillas manuales mandan. Una presentada no se recalcula.';

-- ── 2. Casillas a mano ──────────────────────────────────────────────────────
create or replace function public.conta_impuesto_casillas_poner(p_return uuid, p_casillas jsonb, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.tax_return; k text; v jsonb; n numeric; v_quien text := public.conta_impuesto_quien(); v_motivo text; v_c jsonb;
  v_vale constant text[] := array['01','03','04','06','07','09','27','28','29','30','31','40','41','45','46','59','60','64','66','69','71','78','87','110','120','122'];
  v_calc jsonb; v_n int := 0;
begin
  select * into r from public.tax_return where id = p_return and form_code = '303' for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(r.company_id) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, escribe casillas de sus impuestos.' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'draft', 'reviewed') then
    raise exception 'Esta declaración ya está «%»: sus casillas no se cambian.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if p_casillas is null or jsonb_typeof(p_casillas) <> 'object' or p_casillas = '{}'::jsonb then
    raise exception 'Faltan las casillas que hay que escribir.' using errcode = '22023';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'Para escribir una casilla a mano hace falta decir de dónde sale.' using errcode = '22023'; end if;
  v_motivo := btrim(p_motivo) || ' (' || v_quien || ', ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ')';
  for k, v in select * from jsonb_each(p_casillas) loop
    if not (k = any (v_vale)) then
      raise exception 'La casilla [%] no se escribe aquí: solo las que el 303 de Sumied calcula.', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) not in ('number', 'null') then
      raise exception 'La casilla [%] tiene que ser un importe.', k using errcode = '22023';
    end if;
    if k in ('110', '78', '87') and jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric < 0 then
      raise exception 'La casilla [%] no puede ser negativa: son cuotas a compensar.', k using errcode = '22023';
    end if;
  end loop;
  -- Lo que quedará: las de ahora a mano, con las nuevas encima.
  select coalesce(jsonb_object_agg(box, value), '{}') into v_c from public.tax_return_box where tax_return_id = r.id and origin = 'manual' and value is not null;
  v_c := jsonb_strip_nulls(v_c || p_casillas);
  if v_c ?& array['27', '45', '71'] and abs(((v_c->>'27')::numeric - (v_c->>'45')::numeric - coalesce((v_c->>'78')::numeric, 0)) - (v_c->>'71')::numeric) >= 0.005 then
    raise exception 'Las casillas no cuadran: [27] − [45] − [78] tiene que dar la [71] (% − % − % no es %). Mira el justificante otra vez.',
      v_c->>'27', v_c->>'45', coalesce(v_c->>'78', '0'), v_c->>'71' using errcode = '22023';
  end if;
  if v_c ?& array['110', '87'] and abs(((v_c->>'110')::numeric - coalesce((v_c->>'78')::numeric, 0)) - (v_c->>'87')::numeric) >= 0.005 then
    raise exception 'Las casillas no cuadran: [110] − [78] tiene que dar la [87] (% − % no es %). Mira el justificante otra vez.',
      v_c->>'110', coalesce(v_c->>'78', '0'), v_c->>'87' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_casillas) loop
    if jsonb_typeof(v) = 'null' then
      delete from public.tax_return_box where tax_return_id = r.id and box = k and origin = 'manual';
    else
      insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, origin, manual_reason, source)
      values (r.id, r.account_id, r.company_id, k, round((v #>> '{}')::numeric, 2), 'manual', v_motivo, jsonb_build_object('de', 'a mano', 'quien', v_quien))
      on conflict (tax_return_id, box) do update
        set value = excluded.value, value_text = null, origin = 'manual', manual_reason = excluded.manual_reason, source = excluded.source;
    end if;
    v_n := v_n + 1;
  end loop;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, r.company_id, auth.uid(), v_quien, 'note',
          v_quien || ' escribió a mano ' || (select string_agg('[' || x || ']', ', ' order by x) from jsonb_object_keys(p_casillas) x) || ': ' || btrim(p_motivo) || '.',
          jsonb_build_object('casillas', p_casillas));
  v_calc := public.conta_impuesto_303_calcular(r.company_id, r.fiscal_year, r.period);
  return jsonb_build_object('ok', true, 'calculo', v_calc,
    'mensaje', 'Escritas ' || (select string_agg('[' || x || ']', ', ' order by x) from jsonb_object_keys(p_casillas) x) || ' y vuelto a calcular: ' ||
               case when (v_calc->>'sabido')::boolean
                    then translate(to_char((v_calc->>'importe')::numeric, 'FM999G999G990D00'), ',.', '.,') || ' € ' ||
                         case v_calc->>'resultado' when 'to_pay' then 'a pagar' when 'to_offset' then 'a compensar' when 'to_refund' then 'a devolver' else 'sin nada que pagar' end || '.'
                    else 'todavía no se puede calcular (mira «Lo que ha comprobado Sumied»).' end);
end $$;
comment on function public.conta_impuesto_casillas_poner(uuid, jsonb, text) is
  'I01b (0240). Escribe a mano casillas del 303 (la [110], o las del justificante de lo presentado fuera), con motivo y quién; null quita la manual. Comprueba que cuadran y vuelve a calcular.';

-- ── 3. El fichero: tampoco con un aviso sin mirar ───────────────────────────
create or replace function public.conta_impuesto_303_fichero(p_return uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.tax_return; c public.company; p public.company_tax_profile; v_tipo text; v_71 numeric; v_iban text; v_redeme boolean; v_n int;
begin
  select * into r from public.tax_return where id = p_return and form_code = '303';
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.tax_return_check where tax_return_id = r.id and result = 'error' and check_key <> 'file_layout') then
    raise exception 'Este 303 tiene cosas que Sumied no sabe declarar: no se prepara el fichero.' using errcode = '22023';
  end if;
  select count(*) into v_n from public.tax_return_check where tax_return_id = r.id and result = 'warning' and accepted_at is null;
  if v_n > 0 then
    raise exception 'Antes, mira % de «Lo que ha comprobado Sumied» y dalo por bueno si lo está: con un aviso sin mirar no se prepara el fichero.',
      case when v_n = 1 then 'el aviso' else 'los ' || v_n || ' avisos' end using errcode = '22023';
  end if;
  if r.result_kind is null then
    raise exception 'Este 303 no tiene resultado todavía: no se prepara el fichero.' using errcode = '22023';
  end if;
  select * into c from public.company where id = r.company_id;
  select * into p from public.company_tax_profile where company_id = r.company_id;
  select value into v_71 from public.tax_return_box where tax_return_id = r.id and box = '71';
  select coalesce((value = 'true'::jsonb), false) into v_redeme from public.company_tax_facts where company_id = r.company_id and fact = 'redeme';
  v_tipo := case when coalesce(v_71, 0) = 0 then 'N'
                 when v_71 > 0 then case when r.payment_mode = 'direct_debit' then 'U' else 'I' end
                 when r.result_kind = 'to_refund' then 'D' else 'C' end;
  if v_tipo in ('U', 'D') then
    select iban into v_iban from public.treasury_account where id = r.payment_treasury_account_id and company_id = r.company_id;
  end if;
  return jsonb_build_object('ejercicio', r.fiscal_year, 'periodo', r.period, 'nif', c.tax_id, 'nombre', c.legal_name, 'tipo', v_tipo,
                            'redeme', coalesce(v_redeme, false), 'sii', coalesce(p.sii, false), 'iban', v_iban,
                            'sin_actividad', r.result_kind = 'no_activity',
                            'casillas', (select jsonb_object_agg(box, value) from public.tax_return_box where tax_return_id = r.id and value is not null));
end $$;

-- ── 4. «Ya lo presenté fuera»: lo que se presentó, no lo que no se supo ─────
create or replace function public.conta_impuesto_fuera(p_return uuid, p_user uuid, p_csv text, p_comprobada boolean,
                                                       p_justificante text, p_fecha timestamptz, p_use uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; v_csv text := upper(regexp_replace(coalesce(p_csv, ''), '\s', '', 'g')); v_nombre text := public.conta_impuesto_nombre_de(p_user);
        v_71_mano boolean; v_que text;
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_gestiona(p_user, r.company_id) then
    raise exception 'No puedes apuntar los impuestos de esta empresa.' using errcode = '42501';
  end if;
  if v_csv !~ '^[A-Z0-9]{16}$' then
    raise exception 'Ese CSV no tiene la forma de los de Hacienda: son 16 letras y números, como aparecen en el justificante.' using errcode = '22023';
  end if;
  if r.status not in ('draft', 'reviewed') then
    raise exception 'Esta declaración está «%»: solo se apunta como presentada fuera un borrador o una revisada.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if p_comprobada and not exists (select 1 from public.tax_certificate_use u where u.id = p_use and u.user_id = p_user and u.action = 'query' and u.tax_return_id = r.id) then
    raise exception 'Para darla por comprobada con Hacienda hace falta el uso del certificado con el que se consultó.' using errcode = '42501';
  end if;
  -- Con algo que Sumied no supo calcular, lo presentado lo dicen las casillas
  -- del justificante, escritas a mano: al menos la [71]. Y lo de antes ([110]),
  -- que sin ella el siguiente trimestre no sabe qué arrastra.
  v_71_mano := exists (select 1 from public.tax_return_box where tax_return_id = r.id and box = '71' and origin = 'manual' and value is not null);
  select string_agg(check_key, ', ') into v_que from public.tax_return_check
   where tax_return_id = r.id and result = 'error' and check_key <> 'file_layout' and not (v_71_mano and check_key = 'book_vs_303');
  if v_que is not null then
    raise exception 'Sumied no ha podido calcular este 303 (%): antes de apuntarlo como presentado, escribe las casillas del justificante ([27], [45], [110], [78], [87] y [71]).', v_que using errcode = '22023';
  end if;
  -- Sin calcular, Sumied no sabe qué se presentó (la consulta de Hacienda no da el importe): no se inventa un resultado.
  if r.result_kind is null then
    raise exception 'Antes de apuntarla como presentada, calcúlala en Sumied o escribe las casillas del justificante: así queda qué se presentó.' using errcode = '22023';
  end if;
  update public.tax_return
     set status = 'filed', filed_at = coalesce(p_fecha, now()), filed_by = p_user, filed_by_name = v_nombre, filed_via = 'outside',
         aeat_csv = v_csv, aeat_receipt_number = p_justificante, outside_csv_pasted_at = now(), updated_at = now()
   where id = r.id;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, aeat_service, result, message, detail)
  values (r.id, r.account_id, r.company_id, p_user, v_nombre,
          case when p_comprobada then 'aeat_call' else 'note' end, case when p_comprobada then 'outside_check' end, case when p_comprobada then 'ok' end,
          case when p_comprobada then 'Presentado fuera de Sumied: Hacienda lo confirma (justificante ' || coalesce(p_justificante, '—') || ').'
               else 'Presentado fuera de Sumied, según ' || v_nombre || '. No se ha comprobado con Hacienda.' end,
          jsonb_build_object('csv_cola', right(v_csv, 4), 'comprobada', p_comprobada, 'casillas_a_mano', v_71_mano));
  return jsonb_build_object('ok', true, 'comprobada', p_comprobada,
    'mensaje', case when p_comprobada then 'Apuntado como presentado fuera: Hacienda lo confirma, justificante ' || coalesce(p_justificante, '—') || '.'
                    else 'Apuntado como presentado fuera, con el CSV que has pegado. No se ha podido comprobar con Hacienda.' end);
end $$;

-- ── 5. Quién llama a qué (las otras tres conservan lo suyo: create or replace no lo toca) ──
revoke all on function public.conta_impuesto_casillas_poner(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_impuesto_casillas_poner(uuid, jsonb, text) to authenticated, service_role;
