-- supabase/migrations/20261122T0250_i01b_349_por_operaciones.sql
-- cambia: public.conta_impuesto_reglas · prueba: supabase/staging/sql/20261122_i01b_349_por_operaciones_prueba.sql
-- cambia: public.conta_impuesto_calendario · prueba: supabase/staging/sql/20261122_i01b_349_por_operaciones_prueba.sql
--
-- I01b · EL 349 LO PROPONEN LAS OPERACIONES CON LA UE, NO SOLO EL ROI.
-- Julio, 18/10: Foodint compra servicios a empresas de la UE (la [37] del 303
-- del 1T y del 3T) y en Sumied no le salía el 349, porque la regla roi_349 solo
-- miraba la respuesta del alta «¿estás en el ROI?», que Foodint no dio. La
-- gestoría no lo presenta: que Sumied lo proponga, con su porqué, y que una
-- persona lo pueda quitar con motivo (conta_impuesto_obligacion_decidir; lo
-- decidido a mano no lo pisa ninguna regla).
--
--   conta_paises_ue()                      [nueva] los 27 de la UE (con EL y GR para Grecia), sin ES.
--   conta_impuesto_reglas(empresa)         [cambia, misma firma] la de la 0120, salvo el 349:
--     lo propone tener en el libro de IVA, en los últimos 12 meses, alguna
--     compra intracomunitaria (clave 09, o autoliquidada con país de la UE) o
--     alguna venta intracomunitaria (exenta E5, o con país de la UE), o estar
--     en el ROI. El porqué dice cuántas de cada; si además dijo que no está en
--     el ROI, pide confirmarlo con el asesor.
--
-- No escribe nada por sí sola: las obligaciones cambian cuando alguien las
-- recalcula (el calendario lo hace al abrirse). No toca el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0250_i01b_349_por_operaciones.down.sql

create or replace function public.conta_paises_ue()
returns text[] language sql immutable as $$
  select array['AT','BE','BG','CY','CZ','DE','DK','EE','EL','GR','FI','FR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']
$$;
comment on function public.conta_paises_ue() is 'I01b (0250). Los códigos de país de la UE sin España (Grecia, como EL y como GR).';
grant execute on function public.conta_paises_ue() to authenticated, service_role;

create or replace function public.conta_impuesto_reglas(p_company uuid)
returns table (form_code text, active boolean, cadence text, rule_key text, rule_facts jsonb, why text)
language plpgsql stable security definer set search_path = public as $$
declare
  p public.company_tax_profile; c public.company;
  v_nomina int; v_f111 int; v_f115 int;
  v_retiene jsonb; v_alquila jsonb; v_roi jsonb; v_hay_retiene boolean; v_hay_alquila boolean;
  v_r70 jsonb; v_hay_r70 boolean; v_actividades int; v_profesionales int;
  v_mensual boolean; v_303 boolean; v_111 boolean; v_115 boolean; v_202 boolean;
  v_ue_compras int; v_ue_ventas int; v_349 boolean;
  t record;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into p from public.company_tax_profile where company_id = p_company;
  v_mensual := coalesce(p.vat_period = 'monthly', false) or coalesce(p.sii, false);

  -- Los datos, siempre de esta empresa y su cuenta (regla 9).
  select coalesce(max(s.employees_count), 0) into v_nomina from public.payroll_summary s
   where s.account_id = c.account_id and s.company_id = p_company and s.period_month >= (date_trunc('month', current_date) - interval '12 months')::date;
  select count(*) filter (where w.filed_in = '111'), count(*) filter (where w.filed_in = '115') into v_f111, v_f115
    from public.supplier_invoice i join public.withholding_rate w on w.id = i.withholding_rate_id
   where i.account_id = c.account_id and i.company_id = p_company and coalesce(i.withholding_amount, 0) <> 0
     and i.invoice_date >= current_date - interval '12 months';
  -- «Lo dijo» (hay fila) y «qué dijo» (null = «No lo sé»), por separado: sin fila, no se dijo nada.
  select value into v_retiene from public.company_tax_facts where company_id = p_company and fact = 'pays_with_withholding';
  v_hay_retiene := found;
  select value into v_alquila from public.company_tax_facts where company_id = p_company and fact = 'rents_premises_with_withholding';
  v_hay_alquila := found;
  select value into v_roi from public.company_tax_facts where company_id = p_company and fact = 'roi_registered';
  select value into v_r70 from public.company_tax_facts where company_id = p_company and fact = 'withheld_income_70';
  v_hay_r70 := found;
  -- Operaciones con la UE en los últimos 12 meses, del libro de IVA (0250):
  -- compras intracomunitarias (clave 09, la que pone el libro a una
  -- adquisición intracomunitaria, o autoliquidada con país de la UE) y ventas
  -- intracomunitarias (exenta E5, o con país de la UE).
  select count(*) filter (where v.book in ('received', 'investment')
                            and (v.operation_key = '09' or (v.reverse_charge and v.counterpart_country = any (public.conta_paises_ue())))),
         count(*) filter (where v.book = 'issued' and (v.exempt_cause = 'E5' or v.counterpart_country = any (public.conta_paises_ue())))
    into v_ue_compras, v_ue_ventas
    from public.vat_book_entry v
   where v.account_id = c.account_id and v.company_id = p_company and v.voided_at is null
     and coalesce(v.received_date, v.operation_date, v.issue_date) >= (current_date - interval '12 months')::date;
  select count(*), count(*) filter (where a.kind = 'professional') into v_actividades, v_profesionales
    from public.company_activity a where a.account_id = c.account_id and a.company_id = p_company and a.ended_on is null;

  -- 303
  v_303 := coalesce(p.tax_territory, 'peninsula_baleares') = 'peninsula_baleares' and coalesce(p.vat_scheme_code, 'general') <> 'recargo_equivalencia';
  form_code := '303'; active := v_303; cadence := case when v_mensual then 'monthly' else 'quarterly' end; rule_key := 'iva_303';
  rule_facts := jsonb_build_object('territorio', coalesce(p.tax_territory, 'peninsula_baleares'), 'regimen', coalesce(p.vat_scheme_code, 'general'),
                                   'mensual', v_mensual, 'sii', coalesce(p.sii, false));
  why := case
    when not v_303 and coalesce(p.tax_territory, '') = 'canarias' then 'En Canarias no hay IVA sino IGIC: sus modelos los confirma tu asesor.'
    when not v_303 and coalesce(p.tax_territory, '') = 'ceuta_melilla' then 'En Ceuta y Melilla no hay IVA sino IPSI: sus modelos los confirma tu asesor.'
    when not v_303 then 'Estás en recargo de equivalencia: el IVA lo paga tu proveedor y no presentas el 303.'
    when coalesce(p.sii, false) then 'Llevas el SII: declaras el IVA cada mes, lo que cobras menos lo que pagas.'
    when v_mensual then 'Declaras el IVA cada mes, lo que cobras menos lo que pagas.'
    else 'Vendes con IVA: cada trimestre declaras lo que cobras menos lo que pagas.' end;
  return next;

  -- 111
  v_111 := v_nomina > 0 or v_f111 > 0 or (v_hay_retiene and coalesce(v_retiene = 'true'::jsonb, true));
  form_code := '111'; active := v_111; cadence := case when coalesce(p.vat_period = 'monthly', false) then 'monthly' else 'quarterly' end; rule_key := 'ret_111';
  rule_facts := jsonb_build_object('personas_en_nomina', v_nomina, 'facturas_con_retencion_111', v_f111, 'dijo_en_el_alta', v_retiene);
  why := case
    when v_nomina > 0 then 'Tienes ' || v_nomina || case when v_nomina = 1 then ' persona' else ' personas' end || ' en nómina: declaras cada trimestre lo que les retienes.'
    when v_f111 > 0 then 'Tienes ' || v_f111 || case when v_f111 = 1 then ' factura' else ' facturas' end || ' de profesionales con retención en los últimos 12 meses: declaras cada trimestre lo retenido.'
    when v_hay_retiene and v_retiene is null then 'Dijiste «No lo sé» a si pagas nóminas o profesionales con retención: lo dejamos hasta que lo confirme tu asesor.'
    when v_hay_retiene and v_retiene = 'true'::jsonb then 'Dijiste en el alta que pagas nóminas o facturas de profesionales con retención.'
    else 'No tienes a nadie en nómina ni facturas de profesionales con retención.' end;
  if v_111 or v_hay_retiene then return next; end if;

  -- 115
  v_115 := v_f115 > 0 or (v_hay_alquila and coalesce(v_alquila = 'true'::jsonb, true));
  form_code := '115'; active := v_115; cadence := case when coalesce(p.vat_period = 'monthly', false) then 'monthly' else 'quarterly' end; rule_key := 'alq_115';
  rule_facts := jsonb_build_object('facturas_con_retencion_115', v_f115, 'dijo_en_el_alta', v_alquila);
  why := case
    when v_f115 > 0 then 'Tienes ' || v_f115 || case when v_f115 = 1 then ' factura' else ' facturas' end || ' de alquiler con retención en los últimos 12 meses: declaras cada trimestre lo retenido.'
    when v_hay_alquila and v_alquila is null then 'Dijiste «No lo sé» a si pagas el alquiler del local con retención: lo dejamos hasta que lo confirme tu asesor.'
    when v_hay_alquila and v_alquila = 'true'::jsonb then 'Dijiste en el alta que pagas el alquiler del local con retención.'
    else 'No pagas el alquiler de un local con retención.' end;
  if v_115 or v_hay_alquila then return next; end if;

  -- 202 y 200
  v_202 := c.entity_kind = 'company';
  if v_202 then
    form_code := '202'; active := true; cadence := 'instalments_202'; rule_key := 'is_202';
    rule_facts := jsonb_build_object('tipo', c.entity_kind);
    why := 'Eres una sociedad: adelantas el Impuesto sobre Sociedades en abril, octubre y diciembre.';
    return next;
    form_code := '200'; active := true; cadence := 'annual'; rule_key := 'is_200';
    why := 'Eres una sociedad: en julio presentas el Impuesto sobre Sociedades del año.';
    return next;
  end if;

  -- 130 (autónomos)
  if c.entity_kind = 'self_employed' and (v_actividades = 0 or v_profesionales < v_actividades or v_hay_r70) then
    form_code := '130'; cadence := 'quarterly'; rule_key := 'irpf_130';
    rule_facts := jsonb_build_object('actividades', v_actividades, 'profesionales', v_profesionales, 'retenido_70', v_r70);
    if v_actividades = 0 or v_profesionales < v_actividades then
      active := true;
      why := 'Como autónomo con actividad empresarial, adelantas el IRPF cada trimestre.';
    elsif v_r70 is null then
      active := true;
      why := 'Dijiste «No lo sé» a si el 70 % de tus ingresos llevó retención: lo dejamos, que es lo normal, hasta que lo confirme tu asesor.';
    elsif v_r70 = 'true'::jsonb then
      active := false;
      why := 'El año pasado al menos el 70 % de tus ingresos llevó retención: no adelantas el IRPF.';
    else
      active := true;
      why := 'Menos del 70 % de tus ingresos llevó retención: adelantas el IRPF cada trimestre.';
    end if;
    return next;
  end if;

  -- Los resúmenes anuales de cada periódico, de la tabla de modelos: van con
  -- su periódico, en el mismo sentido, cuando una regla ha decidido sobre él.
  for t in select f.code, f.annual_form_code, f.annual_legal_ref from public.tax_form f
            where f.code in ('303', '111', '115') and f.annual_form_code is not null loop
    continue when (t.code = '111' and not (v_111 or v_hay_retiene)) or (t.code = '115' and not (v_115 or v_hay_alquila));
    form_code := t.annual_form_code; cadence := 'annual'; rule_key := 'anual_de_' || t.code;
    active := case t.code when '303' then v_303 when '111' then v_111 else v_115 end;
    rule_facts := jsonb_build_object('periodico', t.code, 'presenta_el_periodico', active, 'norma', t.annual_legal_ref);
    why := case when active then 'Presentas el ' || t.code || ': en enero resumes el año en el ' || t.annual_form_code || '.'
                else 'No presentas el ' || t.code || ', así que tampoco su resumen anual.' end;
    return next;
  end loop;

  -- 347, por defecto (tax_form.default_for).
  if exists (select 1 from public.tax_form where code = '347' and default_for = 'company_not_sii') and c.entity_kind = 'company' and not coalesce(p.sii, false) then
    form_code := '347'; active := true; cadence := 'annual'; rule_key := 'defecto_347';
    rule_facts := jsonb_build_object('sii', false, 'tipo', c.entity_kind);
    why := 'No llevas el SII: en febrero declaras a quien te compró o vendió más de 3.005,06 € en el año.';
    return next;
  end if;

  -- 349: lo propone tener operaciones con la UE (compras o ventas
  -- intracomunitarias en el libro de IVA, últimos 12 meses) o estar en el ROI.
  -- Julio, 18/10: Foodint compra servicios en la UE y la gestoría no presenta
  -- el 349; que se proponga, con su porqué, y que se pueda quitar con motivo
  -- (lo quitado a mano no lo pisa ninguna regla).
  -- Sale siempre, también cuando no toca: «No te sale el 349» con su porqué.
  v_349 := v_ue_compras > 0 or v_ue_ventas > 0 or coalesce(v_roi = 'true'::jsonb, false);
  form_code := '349'; active := v_349; cadence := 'quarterly'; rule_key := 'roi_349';
  rule_facts := jsonb_build_object('roi', v_roi, 'compras_ue_12_meses', v_ue_compras, 'ventas_ue_12_meses', v_ue_ventas);
  why := case
    when v_ue_compras > 0 or v_ue_ventas > 0 then
      'En los últimos 12 meses tienes ' ||
      concat_ws(' y ',
        case when v_ue_compras > 0 then v_ue_compras || case when v_ue_compras = 1 then ' compra' else ' compras' end || ' a empresas de la UE' end,
        case when v_ue_ventas > 0 then v_ue_ventas || case when v_ue_ventas = 1 then ' venta' else ' ventas' end || ' a empresas de la UE' end) ||
      ': las operaciones intracomunitarias se declaran en el 349 el trimestre en que se hacen.' ||
      case when v_roi = 'false'::jsonb then ' Dijiste que no estás en el Registro de Operadores Intracomunitarios: confírmalo con tu asesor.' else '' end
    when v_roi = 'true'::jsonb then 'Estás dado de alta en el Registro de Operadores Intracomunitarios: declaras tus operaciones con la UE.'
    when v_roi = 'false'::jsonb then 'No estás en el Registro de Operadores Intracomunitarios ni tienes operaciones con la UE en los últimos 12 meses.'
    else 'No tienes compras ni ventas con empresas de la UE en los últimos 12 meses.' end;
  return next;
end $$;
comment on function public.conta_impuesto_reglas(uuid) is
  'I01a/I01b (0250). Lo que dice cada regla con nombre sobre los modelos de una empresa, con los datos y el porqué en palabras de oficina. El 349, por operaciones con la UE o el ROI. No escribe nada.';

-- ── El calendario: «No te sale el …» también de las reglas sin escribir ──────
create or replace function public.conta_impuesto_calendario(p_company uuid, p_hoy date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  v_y int := extract(year from coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date))::int;
  v_desde date; v_ventana date; v_filas jsonb; v_siguiente jsonb; v_reglas jsonb; v_no jsonb; v_pres jsonb;
begin
  if not exists (select 1 from public.company where id = p_company) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;

  select min(valid_from) into v_desde from public.tax_obligation where company_id = p_company and valid_to is null and active;

  -- La ventana: el mes del próximo plazo de presentación.
  select date_trunc('month', min(presentacion))::date into v_ventana from public.conta_impuesto_periodos(p_company, v_y) where presentacion >= v_hoy;

  with d as (
    select c.*, r.id as rid, r.status, r.result_kind, r.amount, r.previous_period_amount, r.not_required_reason,
           coalesce(r.payment_mode, case when c.pago = 'direct_debit' then 'direct_debit' end) as pago_real,
           coalesce(r.payment_treasury_account_id, c.cuenta) as cuenta_real,
           r.filed_at, r.filed_via, r.due_date
      from public.conta_impuesto_periodos(p_company, v_y) c
      left join public.tax_return r on r.company_id = p_company and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                    and r.period = c.periodo and r.sequence = 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'obligacion', d.obligacion, 'modelo', d.modelo, 'nombre', f.name, 'cadencia', d.cadencia,
           'ejercicio', d.ejercicio, 'periodo', d.periodo,
           'presentacion', d.presentacion, 'domiciliacion', d.domiciliacion, 'provisional', d.provisional,
           'atrasado', d.presentacion < v_hoy,
           'domicilia', coalesce(d.pago_real = 'direct_debit', false),
           'cuenta_final', (select right(t.iban, 4) from public.treasury_account t where t.id = d.cuenta_real and t.company_id = p_company),
           'se_calcula', d.modelo = '303',
           'declaracion', case when d.rid is null then null else jsonb_build_object(
             'id', d.rid, 'estado', d.status, 'estado_texto', public.conta_impuesto_estado_texto(d.status),
             'resultado', d.result_kind, 'importe', d.amount, 'anterior', d.previous_period_amount,
             'no_hace_falta', d.not_required_reason,
             'presentada', d.filed_at, 'por', d.filed_via,
             'errores', (select count(*) from public.tax_return_check k where k.tax_return_id = d.rid and k.result = 'error'),
             'avisos', (select count(*) from public.tax_return_check k where k.tax_return_id = d.rid and k.result = 'warning' and k.accepted_at is null),
             'aviso', (select k.title from public.tax_return_check k where k.tax_return_id = d.rid and k.result in ('error', 'warning') and k.accepted_at is null
                        order by (k.result = 'error') desc, k.checked_at limit 1),
             'cuadra', exists (select 1 from public.tax_return_check k where k.tax_return_id = d.rid and k.check_key = 'book_vs_303' and k.result = 'ok')
                   and exists (select 1 from public.tax_return_check k where k.tax_return_id = d.rid and k.check_key = 'ledger_477_472' and (k.result = 'ok' or k.accepted_at is not null))) end
         ) order by d.presentacion, d.modelo, d.ejercicio, d.periodo), '[]')
    into v_filas
    from d join public.tax_form f on f.code = d.modelo
   where (v_ventana is not null and date_trunc('month', d.presentacion)::date = v_ventana)
      -- Lo de antes que no se ha presentado: desde que lleva aquí sus impuestos, o si tiene declaración.
      or (d.presentacion < v_hoy
          and coalesce(d.status, 'pending') in ('pending', 'draft', 'reviewed')
          and (d.rid is not null or (v_desde is not null and d.presentacion >= v_desde)));

  -- Lo siguiente: los plazos de después de la ventana, hasta un año.
  select coalesce(jsonb_agg(jsonb_build_object('modelo', c.modelo, 'nombre', f.name, 'cadencia', c.cadencia, 'ejercicio', c.ejercicio,
                                               'periodo', c.periodo, 'presentacion', c.presentacion, 'domiciliacion', c.domiciliacion)
                            order by c.presentacion, c.modelo), '[]')
    into v_siguiente
    from public.conta_impuesto_periodos(p_company, v_y) c join public.tax_form f on f.code = c.modelo
   where v_ventana is not null and c.presentacion >= (v_ventana + interval '1 month')::date
     and c.presentacion < (v_ventana + interval '1 year')::date;

  -- Los presentados del año: los periodos con plazo en el año que ya han vencido
  -- (desde que lleva aquí sus impuestos, o con declaración), y cuántos están presentados.
  with v as (
    select c.*, r.id as rid, r.status, r.filed_at, r.due_date
      from public.conta_impuesto_periodos(p_company, v_y) c
      left join public.tax_return r on r.company_id = p_company and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                    and r.period = c.periodo and r.sequence = 1
     where extract(year from c.presentacion) = v_y
       and (c.presentacion < v_hoy or r.filed_at is not null)
       and coalesce(r.status, 'pending') <> 'not_required'
       and (r.id is not null or (v_desde is not null and c.presentacion >= v_desde))
  )
  select jsonb_build_object('ano', v_y, 'desde', v_desde,
           'vencidos', count(*),
           'presentados', count(*) filter (where status in ('filed', 'booked', 'paid', 'offset', 'refunded')),
           'en_plazo', count(*) filter (where filed_at is not null and (filed_at at time zone 'Europe/Madrid')::date <= presentacion),
           'contabilizados', count(*) filter (where status in ('booked', 'paid', 'offset', 'refunded')))
    into v_pres from v;

  -- Por qué le sale cada modelo, y los que no.
  select coalesce(jsonb_agg(jsonb_build_object('modelo', o2.form_code, 'nombre', f.name, 'por_que', o2.why, 'origen', o2.origin,
                                               'cadencia', o2.cadence, 'quien', o2.decided_by_name, 'cuando', o2.decided_at)
                            order by o2.form_code) filter (where o2.active), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('modelo', o2.form_code, 'nombre', f.name, 'por_que', o2.why, 'origen', o2.origin)
                            order by o2.form_code) filter (where not o2.active), '[]')
    into v_reglas, v_no
    from public.tax_obligation o2 join public.tax_form f on f.code = o2.form_code
   where o2.company_id = p_company and o2.valid_to is null;
  -- 0250: y las reglas que dicen que no y nunca se escribieron (calcular no
  -- escribe una regla inactiva sin fila previa): «No te sale el 349: …».
  v_no := v_no || coalesce((select jsonb_agg(jsonb_build_object('modelo', r.form_code, 'nombre', f.name, 'por_que', r.why, 'origen', 'rule')
                                              order by r.form_code)
                              from public.conta_impuesto_reglas(p_company) r join public.tax_form f on f.code = r.form_code
                             where not r.active
                               and not exists (select 1 from public.tax_obligation o3 where o3.company_id = p_company
                                                                                       and o3.valid_to is null and o3.form_code = r.form_code)), '[]');

  return jsonb_build_object(
    'hoy', v_hoy, 'ventana', v_ventana, 'desde', v_desde,
    -- Para los avisos de Inicio: el certificado con que presenta la empresa (su caducidad)…
    'certificado', (select jsonb_build_object('titular', t.subject_name, 'caduca', t.valid_to)
                      from public.company_tax_presenter pr join public.tax_certificate t on t.id = pr.certificate_id
                     where pr.company_id = p_company and pr.mode = 'company' and t.status <> 'removed'),
    -- …y lo presentado a pagar cuyo cargo no ha llegado al banco dos días después del plazo (respuesta 5 de Julio).
    'pagos_sin_llegar', (select coalesce(jsonb_agg(jsonb_build_object('declaracion', r.id, 'modelo', r.form_code, 'ejercicio', r.fiscal_year,
                                                                      'periodo', r.period, 'importe', r.amount, 'plazo', r.due_date,
                                                                      'domicilia', r.payment_mode = 'direct_debit') order by r.due_date), '[]')
                           from public.tax_return r
                          where r.company_id = p_company and r.status in ('filed', 'booked') and r.result_kind = 'to_pay'
                            and r.bank_match_id is null and r.due_date < v_hoy - 2 and r.due_date > v_hoy - 400),
    'puede_gestionar', public.conta_impuesto_puede_gestionar(p_company),
    'filas', v_filas, 'siguiente', v_siguiente, 'presentados', v_pres,
    'modelos', v_reglas, 'no_presenta', v_no,
    -- Para «+ Añadir otro impuesto»: los modelos que conoce Sumied y no están en la lista.
    'se_pueden_anadir', (select coalesce(jsonb_agg(jsonb_build_object('modelo', f.code, 'nombre', f.name) order by f.code), '[]')
                           from public.tax_form f
                          where f.code in (select distinct form_code from public.tax_form_deadline)
                            and not exists (select 1 from public.tax_obligation o3 where o3.company_id = p_company and o3.valid_to is null
                                                                                    and o3.active and o3.form_code = f.code)));
end $$;

comment on function public.conta_impuesto_calendario(uuid, date) is
  'I01b (0250). Lo que pinta Impuestos › Calendario: los periodos que tocan con su plazo y su declaración, lo siguiente, los presentados del año y el porqué de cada modelo. No escribe nada.';
