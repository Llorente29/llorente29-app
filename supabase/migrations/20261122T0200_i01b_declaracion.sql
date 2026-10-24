-- supabase/migrations/20261122T0200_i01b_declaracion.sql
--
-- I01b · P2 · EL IVA DE UN PERIODO (tablero 9). Solo añade funciones.
--
--   conta_impuesto_declaracion_ver(empresa, ejercicio, periodo)  [la persona]
--     Lo que pinta «IVA del 3.er trimestre», de una vez: el periodo y sus dos
--     plazos; la declaración si la hay (estado, resultado, pago, presentación,
--     asientos y casado); sus casillas; lo que ha comprobado Sumied (con quién
--     dio por bueno cada aviso); el periodo anterior para comparar; cuántos
--     apuntes de cada libro entran; quién presenta y con qué certificado (sin
--     nada del certificado: el nombre, la caducidad y la última prueba); si
--     quien mira puede presentar con él; los bancos de la empresa (los cuatro
--     últimos del IBAN) y el registro de la declaración. No escribe nada.
--   conta_impuesto_pago_poner(declaración, modo, cuenta)         [la persona]
--     Cómo se paga, antes de presentar: «direct_debit» (domiciliado en un banco
--     de la empresa, solo mientras se puede domiciliar), «self» (pagar yo, sin
--     domiciliar) o «refund» (a devolver, en un banco de la empresa). Queda en
--     el registro de la declaración, con quién.
--
-- Vuelta atrás: supabase/vuelta-atras/20261122T0200_i01b_declaracion.down.sql

create or replace function public.conta_impuesto_declaracion_ver(p_company uuid, p_year int, p_period text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o public.tax_obligation; r public.tax_return; a public.tax_return; pr public.company_tax_presenter; ce public.tax_certificate;
  v_desde date; v_hasta date; v_pres date; v_dom date; v_prov text; v_ant_y int; v_ant_p text; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  if not exists (select 1 from public.company where id = p_company) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = '303' and valid_to is null and active;
  select desde, hasta into v_desde, v_hasta from public.conta_impuesto_periodo_fechas(p_year, p_period);
  if o.id is not null then
    select x.presentacion, x.domiciliacion, x.provisional into v_pres, v_dom, v_prov from public.conta_impuesto_plazo_si_hay('303', o.cadence, p_year, p_period) x;
  end if;
  select * into r from public.tax_return where company_id = p_company and form_code = '303' and fiscal_year = p_year and period = p_period and sequence = 1;

  -- El periodo anterior: el trimestre (o el mes) de antes.
  if p_period ~ '^[1-4]T$' then
    v_ant_y := case when p_period = '1T' then p_year - 1 else p_year end;
    v_ant_p := case when p_period = '1T' then '4T' else (left(p_period, 1)::int - 1)::text || 'T' end;
  else
    v_ant_y := case when p_period = '01' then p_year - 1 else p_year end;
    v_ant_p := case when p_period = '01' then '12' else lpad((p_period::int - 1)::text, 2, '0') end;
  end if;
  select * into a from public.tax_return where company_id = p_company and form_code = '303' and fiscal_year = v_ant_y and period = v_ant_p and sequence = 1;

  select * into pr from public.company_tax_presenter where company_id = p_company;
  if pr.certificate_id is not null then select * into ce from public.tax_certificate where id = pr.certificate_id; end if;

  return jsonb_build_object(
    'hoy', v_hoy, 'ejercicio', p_year, 'periodo', p_period, 'desde', v_desde, 'hasta', v_hasta,
    'presenta_303', o.id is not null, 'cadencia', o.cadence,
    'presentacion', v_pres, 'domiciliacion', v_dom, 'provisional', v_prov,
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'declaracion', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'estado', r.status, 'estado_texto', public.conta_impuesto_estado_texto(r.status),
      'resultado', r.result_kind, 'importe', r.amount,
      'pago', r.payment_mode,
      'pago_cuenta', r.payment_treasury_account_id,
      'pago_cuenta_final', (select right(t.iban, 4) from public.treasury_account t where t.id = r.payment_treasury_account_id and t.company_id = p_company),
      'calculada', r.calculated_at, 'revisada', r.reviewed_at, 'revisada_por', r.reviewed_by_name,
      'presentada', r.filed_at, 'presentada_por', r.filed_by_name, 'por', r.filed_via, 'quien_presenta', r.presenter_kind,
      'csv', r.aeat_csv, 'justificante', r.aeat_receipt_number, 'justificante_pdf', r.receipt_document_path,
      'liquidacion', r.liquidation_entry_id, 'pago_asiento', r.payment_entry_id, 'casado', r.bank_match_id) end,
    'casillas', case when r.id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('casilla', b.box, 'valor', b.value, 'texto', b.value_text, 'origen', b.origin, 'motivo', b.manual_reason)
                                order by lpad(regexp_replace(b.box, '[^0-9]', '', 'g'), 3, '0'), b.box), '[]')
        from public.tax_return_box b where b.tax_return_id = r.id) end,
    'comprobaciones', case when r.id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'clave', k.check_key, 'resultado', k.result, 'titulo', k.title, 'detalle', k.detail,
                                                   'aceptada_por', k.accepted_by_name, 'aceptada_el', k.accepted_at, 'motivo', k.accepted_reason)
                                order by case k.result when 'error' then 0 when 'warning' then 1 else 2 end, k.check_key), '[]')
        from public.tax_return_check k where k.tax_return_id = r.id) end,
    'libros', case when r.id is null then '{}'::jsonb else (
      select coalesce(jsonb_object_agg(libro, n), '{}') from (
        select l.frozen->>'libro' as libro, count(*) as n from public.tax_return_line l where l.tax_return_id = r.id group by 1) x) end,
    'anterior', case when a.id is null then null else jsonb_build_object(
      'ejercicio', a.fiscal_year, 'periodo', a.period, 'estado', a.status, 'resultado', a.result_kind, 'importe', a.amount,
      'c27', (select value from public.tax_return_box where tax_return_id = a.id and box = '27'),
      'c45', (select value from public.tax_return_box where tax_return_id = a.id and box = '45')) end,
    'presentador', jsonb_build_object(
      'modo', coalesce(pr.mode, 'company'),
      'consentida', pr.consented_at is not null and pr.revoked_at is null,
      'certificado', case when ce.id is null then null else jsonb_build_object(
        'id', ce.id, 'nombre', ce.subject_name, 'caduca', ce.valid_to, 'estado', ce.status,
        'probado', ce.last_test_at, 'prueba', ce.last_test_result) end,
      'puedo_presentar', ce.id is not null and ce.status = 'active' and ce.valid_to > now() and public.conta_cert_puede_usar(auth.uid(), ce.id)),
    'bancos', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.name, 'final', right(t.iban, 4)) order by t.name), '[]')
                 from public.treasury_account t where t.company_id = p_company and t.kind = 'bank' and t.iban is not null),
    'registro', case when r.id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('cuando', e.at, 'quien', e.by_name, 'que', e.kind, 'a', e.to_status, 'mensaje', e.message,
                                                   'servicio', e.aeat_service, 'resultado', e.result) order by e.at desc), '[]')
        from (select * from public.tax_return_event where tax_return_id = r.id order by at desc limit 30) e) end);
end $$;

comment on function public.conta_impuesto_declaracion_ver(uuid, int, text) is
  'I01b. Lo que pinta el IVA de un periodo (tablero 9): plazos, declaración, casillas, comprobaciones, el periodo anterior, quién presenta y el registro. No escribe nada.';

create or replace function public.conta_impuesto_pago_poner(p_return uuid, p_modo text, p_cuenta uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; t public.treasury_account; v_hoy date := (now() at time zone 'Europe/Madrid')::date; v_msg text;
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(r.company_id) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, decide cómo se paga.' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'reviewed') then
    raise exception 'Esta declaración ya está «%»: el pago se decide antes de presentar.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if p_modo not in ('direct_debit', 'self', 'refund') then raise exception 'Esa forma de pago no existe.' using errcode = '22023'; end if;
  if p_modo in ('direct_debit', 'refund') then
    select * into t from public.treasury_account where id = p_cuenta and company_id = r.company_id and kind = 'bank' and iban is not null;
    if t.id is null then raise exception 'Elige un banco de la empresa, con su IBAN.' using errcode = '22023'; end if;
  end if;
  if p_modo = 'direct_debit' then
    if r.result_kind is distinct from 'to_pay' then raise exception 'Solo se domicilia lo que sale a pagar.' using errcode = '22023'; end if;
    if r.due_date_direct_debit is null or v_hoy > r.due_date_direct_debit then
      raise exception 'Domiciliar ya no se puede: era hasta el %. Págalo tú hasta el %.',
        to_char(r.due_date_direct_debit, 'DD/MM'), to_char(r.due_date, 'DD/MM') using errcode = '22023';
    end if;
  end if;
  if p_modo = 'refund' and r.result_kind is distinct from 'to_refund' then
    raise exception 'Solo se pide la devolución de lo que sale a devolver.' using errcode = '22023';
  end if;
  update public.tax_return
     set payment_mode = case p_modo when 'self' then null else p_modo end,
         payment_treasury_account_id = case when p_modo = 'self' then null else t.id end,
         updated_at = now()
   where id = r.id;
  v_msg := case p_modo
    when 'direct_debit' then format('Domiciliado en la cuenta ···· %s: Hacienda lo carga el %s.', right(t.iban, 4), to_char(r.due_date, 'DD/MM'))
    when 'refund' then format('A devolver en la cuenta ···· %s.', right(t.iban, 4))
    else format('Sin domiciliar: lo pagas tú hasta el %s.', to_char(r.due_date, 'DD/MM')) end;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message)
  values (r.id, r.account_id, r.company_id, auth.uid(), public.conta_impuesto_quien(), 'note', v_msg);
  return jsonb_build_object('ok', true, 'mensaje', v_msg);
end $$;

revoke all on function public.conta_impuesto_declaracion_ver(uuid, int, text), public.conta_impuesto_pago_poner(uuid, text, uuid) from public, anon;
grant execute on function public.conta_impuesto_declaracion_ver(uuid, int, text), public.conta_impuesto_pago_poner(uuid, text, uuid) to authenticated, service_role;
