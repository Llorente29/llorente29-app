-- supabase/migrations/20261122T0140_i01_calculo_303.sql
-- cambia: public.tax_return_check · prueba: supabase/staging/sql/20261122_i01_calculo_303_prueba.sql
--
-- I01a · 5b · EL 303, CALCULADO DESDE EL LIBRO DE IVA, CON LO QUE SE HA
-- COMPROBADO. Añade funciones y amplía el CHECK de tax_return_check (de la
-- 0110, que aún no está en producción) con «previous_offset».
--
--   conta_impuesto_303_calcular(empresa, ejercicio, periodo)   [la persona]
--     Crea (o recalcula) el borrador del 303 del periodo: cada apunte vivo del
--     libro de IVA del periodo pasa a tax_return_line con sus casillas y una
--     foto de lo que dice hoy (lo que se presente queda congelado así); las
--     casillas, a tax_return_box (las que una persona puso a mano se quedan);
--     y lo comprobado, a tax_return_check. Una declaración ya presentada no se
--     recalcula. Recalcular una revisada la devuelve a borrador.
--   conta_impuesto_303_fichero(declaración)                    [solo service_role]
--     Lo que necesita el fichero (NIF, razón social, casillas, tipo de
--     declaración, IBAN): lo pide la función que presenta (pieza 6).
--   conta_impuesto_303_fichero_comprobado(declaración, ok, fallos, huella)
--                                                              [solo service_role]
--     Apunta la comprobación «file_layout» con lo que dijo comprobar303.
--
-- De dónde sale cada casilla (régimen general; el diseño de registro, en
-- docs/conta/referencia/dr303e26v101.json):
--   · expedidas, sujetas y no exentas (S1), por tipo: 4 % → [01] [03];
--     10 % → [04] [06]; 21 % → [07] [09]. Fecha: la de la operación, o la de
--     expedición.
--   · recibidas (S1, deducibles ahora): [28] base y [29] la cuota deducible;
--     bienes de inversión: [30] [31]; rectificativas recibidas: [40] [41].
--     Fecha: la de recepción (lo que llegó en el periodo), o la de expedición.
--   · información: entregas UE exentas (E5) → [59]; exportaciones (E2) → [60];
--     no sujetas por localización (N2) → [120]; con inversión del sujeto
--     pasivo (S2) → [122].
--   · [27] [45] [46] [64] [66] [69] [71] y [87], como dice el diseño. [65] =
--     100 (no foral). [110]: lo que quedó por compensar del 303 anterior
--     presentado desde Sumied (su [87] más su resultado, si salió a
--     compensar); si no lo hay, 0 y se avisa («previous_offset»).
--     [78] = lo que se puede compensar ahora, hasta el resultado.
--
-- Lo que Sumied no sabe declarar todavía no se pone a cero: la comprobación
-- «book_vs_303» sale en error con cada motivo y cuántos apuntes:
--   tipos que no son 4, 10 o 21 % (las casillas [150] [153] [165] llevan el
--   tipo en blanco en el diseño: falta cotejarlas con la orden de 2026), el
--   recargo de equivalencia, la inversión del sujeto pasivo y las compras en
--   la UE (falta la autorrepercusión), las rectificativas expedidas, la
--   prorrata, el criterio de caja, el régimen simplificado y fuera de la
--   Península y Baleares.

-- ── 1. El CHECK de lo comprobado (solo amplía) ─────────────────────────────
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset'));

-- ── 2. Las fechas de un periodo ─────────────────────────────────────────────
create or replace function public.conta_impuesto_periodo_fechas(p_year int, p_period text, out desde date, out hasta date)
language plpgsql immutable as $$
begin
  if p_period ~ '^[1-4]T$' then
    desde := make_date(p_year, (left(p_period, 1)::int - 1) * 3 + 1, 1);
    hasta := (desde + interval '3 months' - interval '1 day')::date;
  elsif p_period ~ '^(0[1-9]|1[0-2])$' then
    desde := make_date(p_year, p_period::int, 1);
    hasta := (desde + interval '1 month' - interval '1 day')::date;
  else
    raise exception 'El periodo «%» no es un trimestre ni un mes.', p_period using errcode = '22023';
  end if;
end $$;

-- ── 3. Calcular ─────────────────────────────────────────────────────────────
create or replace function public.conta_impuesto_303_calcular(p_company uuid, p_year int, p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; p public.company_tax_profile; o public.tax_obligation; r public.tax_return;
  v_desde date; v_hasta date; v_plazo record; v_quien text := public.conta_impuesto_quien();
  v_no jsonb := '[]'; v_lineas int; v_box jsonb; b record;
  v27 numeric; v45 numeric; v46 numeric; v66 numeric; v110 numeric; v78 numeric; v69 numeric; v71 numeric;
  v_anterior public.tax_return; v_477 numeric; v_472 numeric; v_n int; v_det jsonb; v_kind text;
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
  select coalesce(jsonb_agg(jsonb_build_object('motivo', k, 'apuntes', n, 'texto', case k
           when 'recargo' then n || ' con recargo de equivalencia: Sumied todavía no lo declara.'
           when 'rectificativa_expedida' then n || ' facturas rectificativas emitidas: Sumied todavía no las declara.'
           when 'autorrepercusion' then n || ' compras con inversión del sujeto pasivo o de fuera de España: falta la autorrepercusión.'
           when 'tipo' then n || ' ventas a un tipo que no es 4, 10 ni 21 %: falta cotejar sus casillas con la orden de 2026.' end)), '[]')
    into v_det
    from (select l.frozen->>'no_sabe' as k, count(*) as n from public.tax_return_line l where l.tax_return_id = r.id and l.frozen->>'no_sabe' is not null group by 1) q;
  v_no := v_no || v_det;

  -- Las casillas calculadas (las puestas a mano se quedan).
  delete from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
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
  -- Las sumas, como el diseño.
  select coalesce(sum(value) filter (where box in ('152','167','03','155','06','09','11','13','15','158','170','18','21','24','26')), 0),
         coalesce(sum(value) filter (where box in ('29','31','33','35','37','39','41','42','43','44')), 0)
    into v27, v45 from public.tax_return_box where tax_return_id = r.id;
  v46 := v27 - v45;
  v66 := round(v46 * 100 / 100, 2);
  -- [110]: lo que quedó por compensar del 303 anterior presentado desde Sumied
  -- (lo que arrastraba, su [87], más su propio resultado si salió a compensar),
  -- o lo que una persona puso.
  select * into v_anterior from public.tax_return
   where company_id = p_company and form_code = '303' and status in ('filed', 'booked', 'paid', 'offset', 'refunded')
     and (fiscal_year, period) < (p_year, p_period) order by fiscal_year desc, period desc limit 1;
  select value into v110 from public.tax_return_box where tax_return_id = r.id and box = '110' and origin = 'manual';
  if v110 is null then
    v110 := coalesce((select value from public.tax_return_box where tax_return_id = v_anterior.id and box = '87'), 0)
          + case when v_anterior.result_kind = 'to_offset' then v_anterior.amount else 0 end;
  end if;
  v78 := least(v110, greatest(v66, 0));
  v69 := v66 - v78;
  v71 := v69;
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
  select r.id, c.account_id, p_company, k, round(val, 2), jsonb_build_object('de', como)
    from (values ('27', v27, '[152]+[167]+[03]+[155]+[06]+[09]+[11]+[13]+[15]+[158]+[170]+[18]+[21]+[24]+[26]'),
                 ('45', v45, '[29]+[31]+[33]+[35]+[37]+[39]+[41]+[42]+[43]+[44]'), ('46', v46, '[27]−[45]'), ('64', v46, '[46]+[58]+[76]'),
                 ('65', 100, 'no foral: todo a la Administración del Estado'), ('66', v66, '[64]×[65] %'),
                 ('110', v110, case when v_anterior.id is null then 'no hay un 303 anterior presentado desde Sumied' else 'lo que quedó por compensar del ' || v_anterior.period || '/' || v_anterior.fiscal_year || ': su [87] y, si salió a compensar, su resultado' end),
                 ('78', v78, 'lo que se compensa ahora, hasta el resultado'), ('87', v110 - v78, '[110]−[78]'),
                 ('69', v69, '[66]+[77]−[78]+[68]+[108]'), ('71', v71, '[69]−[70]+[109]−[112]')) t(k, val, como)
  on conflict (tax_return_id, box) do nothing;

  -- El resultado, en la declaración.
  v_kind := case when v_lineas = 0 and v71 = 0 then 'no_activity' when v71 > 0 then 'to_pay' when v71 = 0 then 'zero'
                 when p_period in ('4T', '12') and r.payment_mode = 'refund' then 'to_refund' else 'to_offset' end;
  update public.tax_return set result_kind = v_kind, amount = abs(v71), calculated_at = now(), updated_at = now() where id = r.id;

  -- Lo comprobado (se rehace entero: si cambian los números, se vuelve a mirar).
  delete from public.tax_return_check where tax_return_id = r.id;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'book_vs_303', case when jsonb_array_length(v_no) > 0 then 'error' else 'ok' end,
          case when jsonb_array_length(v_no) > 0
               then 'Hay cosas que Sumied todavía no sabe declarar en este 303. Preséntalo con tu asesor o espera a que lo sepa: ' ||
                    (select string_agg(e->>'texto', ' ') from jsonb_array_elements(v_no) e)
               when v_lineas = 0 then 'No hay facturas en el libro de IVA de este periodo.'
               else 'Las ' || v_lineas || ' facturas del libro de IVA de este periodo están en el 303, cada una en su casilla.' end,
          jsonb_build_object('apuntes', v_lineas, 'no_sabe', v_no));

  -- 477 y 472 del diario del periodo (los anulados y sus contraasientos se compensan entre sí).
  select coalesce(sum(jl.credit - jl.debit) filter (where ca.code like '477%'), 0), coalesce(sum(jl.debit - jl.credit) filter (where ca.code like '472%'), 0)
    into v_477, v_472
    from public.journal_line jl
    join public.journal_entry je on je.id = jl.entry_id
    join public.company_account ca on ca.id = jl.company_account_id
   where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
     and je.source_type not in ('vat_settlement', 'opening', 'closing') and je.entry_date between v_desde and v_hasta;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'ledger_477_472',
          case when abs(v_477 - v27) < 0.005 and abs(v_472 - v45) < 0.005 then 'ok' else 'warning' end,
          case when abs(v_477 - v27) < 0.005 and abs(v_472 - v45) < 0.005
               then 'El diario dice lo mismo que el 303: la 477 (' || translate(to_char(v_477, 'FM999G999G990D00'), ',.', '.,') || ' €) y la 472 (' || translate(to_char(v_472, 'FM999G999G990D00'), ',.', '.,') || ' €).'
               else 'El diario no dice lo mismo que el 303: la 477 suma ' || translate(to_char(v_477, 'FM999G999G990D00'), ',.', '.,') || ' € frente a ' || translate(to_char(v27, 'FM999G999G990D00'), ',.', '.,') ||
                    ' €, y la 472, ' || translate(to_char(v_472, 'FM999G999G990D00'), ',.', '.,') || ' € frente a ' || translate(to_char(v45, 'FM999G999G990D00'), ',.', '.,') || ' €. Puede ser una factura recibida apuntada en un trimestre y llegada en otro.' end,
          jsonb_build_object('cuenta_477', v_477, 'casilla_27', v27, 'cuenta_472', v_472, 'casilla_45', v45));

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

  -- Lo que quedó por compensar antes: si no se sabe, se dice.
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'previous_offset',
          case when v_anterior.id is null and not exists (select 1 from public.tax_return_box where tax_return_id = r.id and box = '110' and origin = 'manual') then 'warning' else 'ok' end,
          case when exists (select 1 from public.tax_return_box where tax_return_id = r.id and box = '110' and origin = 'manual')
               then 'Las cuotas a compensar de antes las puso una persona: ' || translate(to_char(v110, 'FM999G999G990D00'), ',.', '.,') || ' €.'
               when v_anterior.id is null
               then 'No hay un 303 anterior presentado desde Sumied: si te quedó algo por compensar de antes, escríbelo; si no, se queda en 0.'
               else 'Del 303 del ' || v_anterior.period || '/' || v_anterior.fiscal_year || ' quedaron ' || translate(to_char(v110, 'FM999G999G990D00'), ',.', '.,') || ' € por compensar.' end,
          jsonb_build_object('casilla_110', v110, 'anterior', v_anterior.id));

  select jsonb_object_agg(box, value) into v_box from public.tax_return_box where tax_return_id = r.id and value is not null;
  return jsonb_build_object('declaracion', r.id, 'desde', v_desde, 'hasta', v_hasta, 'apuntes', v_lineas, 'resultado', v_kind, 'importe', abs(v71),
                            'casillas', v_box, 'no_sabe', v_no, 'quien', v_quien);
end $$;
comment on function public.conta_impuesto_303_calcular(uuid, int, text) is
  'I01a. El borrador del 303 del periodo desde el libro de IVA: líneas con su foto, casillas (las manuales se quedan) y lo comprobado. Una presentada no se recalcula.';

-- ── 4. Lo que necesita el fichero (pieza 6) ─────────────────────────────────
create or replace function public.conta_impuesto_303_fichero(p_return uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.tax_return; c public.company; p public.company_tax_profile; v_tipo text; v_71 numeric; v_iban text; v_redeme boolean;
begin
  select * into r from public.tax_return where id = p_return and form_code = '303';
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.tax_return_check where tax_return_id = r.id and result = 'error' and check_key <> 'file_layout') then
    raise exception 'Este 303 tiene cosas que Sumied no sabe declarar: no se prepara el fichero.' using errcode = '22023';
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

create or replace function public.conta_impuesto_303_fichero_comprobado(p_return uuid, p_ok boolean, p_fallos jsonb, p_huella text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.tax_return;
begin
  select * into r from public.tax_return where id = p_return;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, r.account_id, r.company_id, 'file_layout', case when p_ok then 'ok' else 'error' end,
          case when p_ok then 'El fichero cumple el diseño de registro de la AEAT (DR303e26v101): medidas, tipos, constantes y sumas.'
               else 'El fichero no cumple el diseño de registro: ' || coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(p_fallos) x), 'sin detalle') end,
          jsonb_build_object('fallos', coalesce(p_fallos, '[]'), 'huella', p_huella))
  on conflict (tax_return_id, check_key) do update set result = excluded.result, title = excluded.title, detail = excluded.detail, checked_at = now();
end $$;

-- ── 5. Quién llama a qué ────────────────────────────────────────────────────
revoke all on function public.conta_impuesto_303_calcular(uuid, int, text) from public, anon;
grant execute on function public.conta_impuesto_303_calcular(uuid, int, text) to authenticated, service_role;
revoke all on function public.conta_impuesto_303_fichero(uuid), public.conta_impuesto_303_fichero_comprobado(uuid, boolean, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.conta_impuesto_303_fichero(uuid), public.conta_impuesto_303_fichero_comprobado(uuid, boolean, jsonb, text) to service_role;
grant execute on function public.conta_impuesto_periodo_fechas(int, text) to authenticated, service_role;
