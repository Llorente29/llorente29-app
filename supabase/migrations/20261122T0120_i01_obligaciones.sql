-- supabase/migrations/20261122T0120_i01_obligaciones.sql
--
-- I01a · 3 · QUÉ MODELOS LE TOCAN A CADA EMPRESA, Y POR QUÉ (informe §4).
-- Solo añade funciones. Cada modelo sale de una REGLA CON NOMBRE; se guarda la
-- regla (rule_key), los datos en que se basó (rule_facts) y el porqué en
-- palabras de oficina (why: «Tienes 6 personas en nómina»). Lo que decidió una
-- persona (añadir o quitar, siempre con motivo) no lo pisa ninguna regla.
--
--   conta_impuesto_reglas(empresa)            → lo que dice cada regla (sin escribir)
--   conta_impuesto_obligaciones_calcular(empresa) → lo escribe en tax_obligation
--   conta_impuesto_obligacion_decidir(empresa, modelo, presenta, motivo) → añadir o quitar, con motivo
--
-- Las reglas:
--   iva_303           303: IVA en la Península o Baleares y no solo en recargo
--                     de equivalencia (RIVA art. 71.1). Mensual con SII o
--                     declaración mensual.
--   anual_de_<p>      el resumen anual de cada periódico, de tax_form
--                     (annual_form_code): 303→390, 111→190, 115→180, 202→200.
--   ret_111           111: personas en nómina (payroll_summary, últimos 12
--                     meses), facturas con retención del 111, o lo dicho en el
--                     alta. «No lo sé» lo deja, para que lo confirme el asesor.
--   alq_115           115: facturas con retención del 115, o lo dicho en el alta.
--   is_202, is_200    sociedad (company.entity_kind = 'company').
--   irpf_130          130: autónomo (entity_kind = 'self_employed') con alguna
--                     actividad que no es profesional (company_activity.kind),
--                     o profesional con menos del 70 % de sus ingresos del año
--                     anterior con retención (withheld_income_70). Como el
--                     alta: «No lo sé» deja lo normal (lo presenta) y lo
--                     confirma el asesor; sin la respuesta, no se decide.
--   defecto_347       347: tax_form.default_for = 'company_not_sii'.
--   roi_349           349: dado de alta en el ROI (company_tax_facts).
--
-- Lo que no hace (dicho): la excepción del 390 para quien lleva el SII (marcada
-- [?] en el informe: falta leer la orden); el 202 «a cero» se resuelve en la
-- declaración (no_required con su motivo), no aquí; lo que el alta llama «solo
-- operaciones exentas» (RIVA 71.1) no es un dato guardado: no se deduce aquí.

create or replace function public.conta_impuesto_reglas(p_company uuid)
returns table (form_code text, active boolean, cadence text, rule_key text, rule_facts jsonb, why text)
language plpgsql stable security definer set search_path = public as $$
declare
  p public.company_tax_profile; c public.company;
  v_nomina int; v_f111 int; v_f115 int;
  v_retiene jsonb; v_alquila jsonb; v_roi jsonb; v_hay_retiene boolean; v_hay_alquila boolean;
  v_r70 jsonb; v_hay_r70 boolean; v_actividades int; v_profesionales int;
  v_mensual boolean; v_303 boolean; v_111 boolean; v_115 boolean; v_202 boolean;
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

  -- 349, si está en el ROI.
  if v_roi is not null then
    form_code := '349'; active := v_roi = 'true'::jsonb; cadence := 'quarterly'; rule_key := 'roi_349';
    rule_facts := jsonb_build_object('roi', v_roi);
    why := case when v_roi = 'true'::jsonb then 'Estás dado de alta en el Registro de Operadores Intracomunitarios: declaras tus operaciones con la UE.'
                else 'No estás en el Registro de Operadores Intracomunitarios.' end;
    return next;
  end if;
end $$;
comment on function public.conta_impuesto_reglas(uuid) is
  'I01a. Lo que dice cada regla con nombre sobre los modelos de una empresa, con los datos y el porqué en palabras de oficina. No escribe nada.';

-- Escribir lo que dicen las reglas. Lo que decidió una persona se queda.
create or replace function public.conta_impuesto_obligaciones_calcular(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_nombre text; r record; o public.tax_obligation; v_out jsonb := '[]'; v_hecho text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, recalcula sus modelos.' using errcode = '42501';
  end if;
  v_nombre := public.conta_impuesto_quien();
  for r in select * from public.conta_impuesto_reglas(p_company) loop
    select * into o from public.tax_obligation where company_id = p_company and form_code = r.form_code and valid_to is null;
    if o.id is not null and o.origin in ('added', 'removed') then
      v_hecho := 'lo_decidio_una_persona';
    elsif o.id is not null and o.active = r.active and o.rule_key is not distinct from r.rule_key
          and o.rule_facts = r.rule_facts and o.why = r.why and o.cadence = r.cadence then
      v_hecho := 'igual';
    elsif o.id is null and not r.active then
      v_hecho := 'no_toca';
    else
      if o.id is not null then update public.tax_obligation set valid_to = current_date where id = o.id; end if;
      insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, rule_key, rule_facts, why,
                                         payment_mode, payment_treasury_account_id, decided_by, decided_by_name)
      values (v_acc, p_company, r.form_code, r.cadence, r.active, 'rule', r.rule_key, r.rule_facts, r.why,
              coalesce(o.payment_mode, 'none'), o.payment_treasury_account_id, auth.uid(), v_nombre);
      v_hecho := case when o.id is null then 'nuevo' else 'cambiado' end;
    end if;
    v_out := v_out || jsonb_build_object('modelo', r.form_code, 'presenta', r.active, 'regla', r.rule_key, 'por_que', r.why, 'datos', r.rule_facts,
                                         'hecho', v_hecho, 'motivo_de_la_persona', case when v_hecho = 'lo_decidio_una_persona' then o.reason end);
  end loop;
  return v_out;
end $$;
comment on function public.conta_impuesto_obligaciones_calcular(uuid) is
  'I01a. Escribe en tax_obligation lo que dicen las reglas (conta_impuesto_reglas). No pisa lo que decidió una persona. Devuelve, por modelo, qué dice la regla, por qué y qué se ha hecho.';

-- Añadir o quitar un modelo a mano: siempre con motivo, y queda quién y cuándo.
create or replace function public.conta_impuesto_obligacion_decidir(p_company uuid, p_form text, p_presenta boolean, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_id uuid; o public.tax_obligation;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, cambia sus modelos.' using errcode = '42501';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Para % el % hace falta el motivo.', case when p_presenta then 'añadir' else 'quitar' end, p_form using errcode = '22023';
  end if;
  if not exists (select 1 from public.tax_form where code = p_form) then raise exception 'No hay un modelo %.', p_form using errcode = 'P0002'; end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = p_form and valid_to is null;
  if o.id is not null and o.active = p_presenta then
    raise exception 'El % ya está %.', p_form, case when p_presenta then 'en la lista' else 'fuera de la lista' end using errcode = '22023';
  end if;
  if o.id is not null then update public.tax_obligation set valid_to = current_date where id = o.id; end if;
  insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, why, reason, payment_mode,
                                     payment_treasury_account_id, decided_by, decided_by_name)
  values (v_acc, p_company, p_form, coalesce(o.cadence, public.conta_impuesto_cadencia_de(p_company, p_form)), p_presenta,
          case when p_presenta then 'added' else 'removed' end,
          case when p_presenta then 'Lo añadiste tú: ' else 'Lo quitaste tú: ' end || btrim(p_motivo), btrim(p_motivo),
          coalesce(o.payment_mode, 'none'), o.payment_treasury_account_id, auth.uid(), public.conta_impuesto_quien())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.conta_impuesto_obligaciones_calcular(uuid),
  public.conta_impuesto_obligacion_decidir(uuid, text, boolean, text) from public, anon;
-- Las reglas leen nóminas y datos de cualquier empresa (security definer) y no
-- miran la cuenta: solo las llama calcular, que sí la mira. Fuera también de
-- authenticated, que Supabase da por defecto a toda función nueva.
revoke all on function public.conta_impuesto_reglas(uuid) from public, anon, authenticated;
grant execute on function public.conta_impuesto_obligaciones_calcular(uuid), public.conta_impuesto_obligacion_decidir(uuid, text, boolean, text)
  to authenticated, service_role;
grant execute on function public.conta_impuesto_reglas(uuid) to service_role;
