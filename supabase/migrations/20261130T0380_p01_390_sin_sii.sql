-- cambia: public.conta_impuesto_reglas · prueba: supabase/staging/sql/20261130_p01_390_sin_sii_prueba.sql
-- PENDIENTE (22/10): el 0380 ya lo usa la C06b (#275, aplicada) y la más alta
-- registrada es la 0420: renumerar por encima antes de pedir su tanda (y volver
-- a medir su contexto). Rama aparcada; sigue en otra sesión.
--
-- P01 · El alta no propone el 390 a quien lleva el SII (Julio, 21/10).
--
--   conta_impuesto_reglas(empresa)     [CAMBIA, misma firma] lo de la 0250
--     byte a byte (medido en producción y en staging el 21/10: md5 del cuerpo
--     8d6cce36…), y una condición más en los resúmenes anuales: con el SII,
--     el 390 sale inactivo con su porqué («Llevas el SII: no presentas el
--     390»), en vez de activo. Es la misma regla que ya usan la app
--     (src/modules/conta/lib/modelos.ts, ANUAL_SIN_SII) y el agente de
--     cumplimiento (#268). Sin el SII, todo sale exactamente igual que antes:
--     mismas filas, mismos datos y mismo porqué, así que recalcular los
--     modelos de una empresa sin SII no escribe nada nuevo.
--
-- Medido en producción el 21/10: 0 empresas con el SII, 0 con el SII y el
-- 390. Solo lee: aplicar no cambia ningún dato; los modelos de una empresa se
-- reescriben cuando alguien los recalcula (conta_impuesto_obligaciones_calcular,
-- que respeta lo que decidió una persona).
-- Vuelta atrás: el cuerpo de la 0250, tal cual.

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
    -- 0380 (Julio, 21/10): quien lleva el SII no presenta el 390 (instrucciones
    -- del modelo 390, AEAT). Sale igual, inactivo y con su porqué: no se esconde.
    if t.annual_form_code = '390' and active and coalesce(p.sii, false) then
      active := false;
      rule_facts := jsonb_build_object('periodico', t.code, 'presenta_el_periodico', true, 'sii', true,
                                       'norma', 'Instrucciones del modelo 390 (AEAT): no lo presentan quienes llevan los libros registro en el SII');
      why := 'Llevas el SII: no presentas el 390 (instrucciones del modelo 390, AEAT).';
      return next;
      continue;
    end if;
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
  'I01a/I01b (0250) y P01 (0380). Lo que dice cada regla con nombre sobre los modelos de una empresa, con los datos y el porqué en palabras de oficina. El 349, por operaciones con la UE o el ROI. Con el SII, sin el 390. No escribe nada.';
