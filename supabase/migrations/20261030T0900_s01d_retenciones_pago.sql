-- supabase/migrations/20261030T0900_s01d_retenciones_pago.sql
-- cambia: public._journal_entry_proponer · prueba: supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
-- cambia: public.conta_impuesto_retenciones_diario · prueba: supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
-- cambia: public.bank_casar · prueba: supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
-- cambia: public.conta_impuesto_casar_cargo · prueba: supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
--
-- S01d · 1 · LAS RETENCIONES: LA QUE NACE Y LA QUE SE PAGA (encargo de Julio,
-- 30/10; visto bueno al paso 0 en su respuesta 1).
--
-- Hasta hoy, todo apunte de la 4751 pedía tipo, base y modelo. Está bien para
-- la retención que nace (factura, nómina, alquiler) y mal para el pago, la
-- compensación o la devolución de un modelo, que no tienen ni base ni tipo:
-- tres asientos de Foodint estaban parados por eso (el pago del 111 y del 115
-- del 3T y la compensación de Hacienda del 05/10).
--
--   1. (En la 0855, que solo añade.) journal_line.withholding_period: el periodo del
--      modelo que se paga, «2026-3T» (o «2026-01» un mes, «2026-0A» el año).
--      company_account.withholding_model (nueva, admite nulos): el modelo de
--      una subcuenta de la 4751 (en Foodint, la 47510000 es el 111 y la
--      47510019 el 115: lo pone la 0901, con «autorizo»).
--   2. La regla 5 (conta_motivos_para_validar, misma firma): una línea de la
--      4751 valida si lleva tipo, base y modelo, o modelo y periodo sin tipo.
--   3. conta_impuesto_retenciones_diario (misma firma): un asiento cuyas
--      líneas de la 4751 dicen modelo y periodo sin tipo es un pago, toque la
--      57 o no. Nunca entra en el cálculo de lo retenido (hoy la compensación
--      habría contado 641,08 € como retenciones de profesionales).
--   4. _journal_entry_proponer y bank_casar (misma firma): la línea del banco
--      puede llevar «modelo» y «periodo», y el apunte los guarda. Y
--      conta_impuesto_casar_cargo (Impuestos › «Casar el cargo», misma firma):
--      un 111, un 115 o un 123 se paga en la subcuenta de la 4751 de su modelo
--      (hasta hoy, en la 4750 del 303), con su modelo y su periodo.
--   5. conta_apunte_pago_modelo (nueva): desde la pantalla, un apunte de la
--      4751 de un asiento sin validar pasa a ser el pago de un modelo y periodo.
--   6. conta_modelo_pagado (nueva, solo lee): lo pagado y lo que queda de un
--      modelo y periodo, desde la 4751.
--   7. Un disparador nuevo en journal_entry (al validar): si con este asiento
--      lo pagado de un modelo y periodo llega a su importe, la declaración
--      queda pagada, con el asiento en payment_entry_id y, si vino del banco,
--      su casado (lo mismo que «Casar el cargo» de Impuestos), y una nota.
--
-- Nada del camino del pedido.

-- (Abajo, también conta_impuesto_casar_cargo, la de Impuestos › «Casar el cargo».)
-- ── 1 · Las columnas: en la 0855 (solo añade; staging la recibe de verdad) ──

-- ── 2 · Lo de antes, con su huella, para la vuelta atrás ─────────────────
select public._respaldar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261030T0900_s01d_retenciones_pago');
select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261030T0900_s01d_retenciones_pago');
select public._respaldar_funcion('public.conta_impuesto_retenciones_diario(uuid,integer,text)', '20261030T0900_s01d_retenciones_pago');
select public._respaldar_funcion('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)', '20261030T0900_s01d_retenciones_pago');
select public._respaldar_funcion('public.conta_impuesto_casar_cargo(uuid,uuid)', '20261030T0900_s01d_retenciones_pago');

-- ── 3 · Las cuatro, cambiadas sobre lo que hay en producción ─────────────
CREATE OR REPLACE FUNCTION public._journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb, p_quien_nombre text, p_quien uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cuenta uuid; v_fecha date := (p_entry->>'fecha')::date; v_tipo text := p_entry->>'source_type';
  v_origen uuid := nullif(p_entry->>'source_id', '')::uuid; v_clave text; v_y uuid; v_id uuid; v_l jsonb; v_pos int := 0;
  v_cta uuid; v_resumen uuid; v_existente uuid;
  v_unidad text := nullif(p_summary->>'unit_key', ''); v_dia_clave text;
  v_aviso_iva text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then
    raise exception 'La empresa % no existe.', p_company using errcode = '23514';
  end if;
  if v_tipo = 'sales_day' then
    v_dia_clave := (p_summary->>'location_id') || ':' || (p_summary->>'sales_day');
    v_clave := v_dia_clave || coalesce(':' || v_unidad, '');
    -- El botón y el cierre del día pueden llegar a la vez al mismo día: el
    -- cerrojo es del día y el local, también con unidades (C04b R5), para que
    -- un asiento del día entero y uno de una unidad no se crucen.
    perform pg_advisory_xact_lock(hashtextextended('sales_day:' || p_company::text || ':' || v_dia_clave, 0));
    -- C04b R5: con la regla por plataforma, el día entero ya no se propone.
    -- Lo dice (regla 8) en vez de dejar un asiento al lado de los de cada
    -- plataforma: así el front de antes no puede duplicar.
    if v_unidad is null and exists (select 1 from public.conta_ventas_canal v where v.company_id = p_company) then
      raise exception 'Las ventas se asientan ahora por plataforma, local y día, y las propone el cierre del día cada hora. Recarga la página.' using errcode = '23514';
    end if;
  else
    v_clave := v_origen::text;
  end if;
  if v_clave is not null and exists (select 1 from public.journal_dismissal d where d.company_id = p_company and d.source_type = v_tipo
                                        and d.source_key in (v_clave, coalesce(v_dia_clave, v_clave))) then
    return jsonb_build_object('descartada', true);
  end if;

  if v_tipo = 'sales_day' then
    -- Un día ya asentado entero (a la antigua) no se vuelve a asentar por unidades.
    if v_unidad is not null then
      select s.entry_id into v_existente from public.sales_day_summary s join public.journal_entry e on e.id = s.entry_id
       where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date
         and s.unit_key is null and e.status in ('propuesto', 'borrador', 'validado');
      if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
    end if;
    select s.id, s.entry_id into v_resumen, v_existente from public.sales_day_summary s
     where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date
       and s.unit_key is not distinct from v_unidad;
    if v_existente is not null and exists (select 1 from public.journal_entry e where e.id = v_existente and e.status in ('propuesto', 'borrador', 'validado')) then
      return jsonb_build_object('id', v_existente, 'existente', true);
    end if;
    if v_resumen is null then
      insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, unit_key, channel_id, brand_id, tickets_count, total, by_rate, by_channel, by_brand,
                                            first_invoice, last_invoice, detail_hash, sale_ids, base_calculated, created_by)
      values (v_cuenta, p_company, (p_summary->>'location_id')::uuid, (p_summary->>'sales_day')::date,
              v_unidad, nullif(p_summary->>'channel_id', '')::uuid, nullif(p_summary->>'brand_id', '')::uuid, (p_summary->>'tickets_count')::int,
              (p_summary->>'total')::numeric, coalesce(p_summary->'by_rate', '[]'), coalesce(p_summary->'by_channel', '[]'), coalesce(p_summary->'by_brand', '[]'),
              p_summary->>'first_invoice', p_summary->>'last_invoice', p_summary->>'detail_hash',
              coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
              coalesce((p_summary->>'base_calculated')::boolean, false), p_quien)
      returning id into v_resumen;
    else
      -- Un resumen sin asiento vivo (el del 09/10 de Carabanchel, de antes del
      -- cierre del día) se rehace entero con el día de ahora: no se duplica.
      update public.sales_day_summary set tickets_count = (p_summary->>'tickets_count')::int, total = (p_summary->>'total')::numeric,
             by_rate = coalesce(p_summary->'by_rate', '[]'), by_channel = coalesce(p_summary->'by_channel', '[]'), by_brand = coalesce(p_summary->'by_brand', '[]'),
             detail_hash = p_summary->>'detail_hash',
             sale_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
             base_calculated = coalesce((p_summary->>'base_calculated')::boolean, false), entry_id = null
       where id = v_resumen;
    end if;
    v_origen := v_resumen;
  elsif v_origen is not null then
    select id into v_existente from public.journal_entry
     where company_id = p_company and source_type = v_tipo and source_id = v_origen and status in ('propuesto', 'borrador', 'validado');
    if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
  end if;

  -- V04 · candado del IVA (1233): una recibida que llega a un periodo cuyo IVA
  -- ya está presentado se asienta en el primer día abierto, sin preguntar; una
  -- expedida no se mueve: para. La fecha de la factura no se toca.
  p_entry := public._conta_iva_ajustar_propuesta(p_company, p_entry, p_lines);
  -- V04 (1350, regla de Julio del 27/10): una recibida nunca se asienta antes
  -- del día en que entró, aunque su mes esté abierto: asiento e IVA, en el
  -- mismo trimestre. Va después del candado, que ya la lleva a un periodo sin
  -- presentar; los dos avisos se juntan.
  v_aviso_iva := p_entry->>'aviso';
  p_entry := public._conta_recibida_no_antes_de_entrar(p_company, p_entry - 'aviso');
  v_fecha := (p_entry->>'fecha')::date;

  select id into v_y from public.fiscal_year where company_id = p_company and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen, 'propuesto',
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, p_quien, coalesce(p_quien_nombre, 'Folvy'))
  returning id into v_id;

  for v_l in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    select id into v_cta from public.company_account where company_id = p_company and code = v_l->>'cuenta';
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', v_l->>'cuenta' using errcode = '23514'; end if;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     brand_id, party_id, document_ref, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents,
                                     withholding_rate_id, withholding_base, withholding_model, withholding_period)
    values (v_cuenta, p_company, v_id, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto',
            nullif(v_l->>'local_id', '')::uuid, coalesce((v_l->>'comun')::boolean, false), nullif(v_l->>'marca_id', '')::uuid,
            nullif(v_l->>'tercero_id', '')::uuid, v_l->>'documento',
            nullif(v_l->'iva'->>'tipo_id', '')::uuid, (v_l->'iva'->>'base')::numeric, v_l->'iva'->>'libro', v_l->'iva'->>'deducible',
            coalesce((v_l->'iva'->>'facturas')::int, 1),
            nullif(v_l->'retencion'->>'tipo_id', '')::uuid, (v_l->'retencion'->>'base')::numeric, v_l->'retencion'->>'modelo', nullif(v_l->'retencion'->>'periodo', ''));
  end loop;
  if v_resumen is not null then update public.sales_day_summary set entry_id = v_id where id = v_resumen; end if;
  return jsonb_strip_nulls(jsonb_build_object('id', v_id, 'existente', false, 'aviso', nullif(concat_ws(' ', v_aviso_iva, p_entry->>'aviso'), '')));
end $function$;

CREATE OR REPLACE FUNCTION public.conta_motivos_para_validar(p_entry uuid)
 RETURNS TABLE(orden integer, codigo text, motivo text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_n int; v_debe numeric; v_haber numeric; v_cierre boolean; v_mal text; v_aclarar int; v_lista text;
  v_local boolean; v_liquidacion boolean;
  v_hay_isp boolean; v_isp_472 numeric; v_auto_477 numeric; v_p record; v_contra text;
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

    -- I01d (0300): ¿lleva el asiento IVA autoliquidado? (una 472 con el tipo
    -- «Compra en otro país de la UE» o «Inversión del sujeto pasivo»). Su 477
    -- de autorrepercusión va SIN tipo ni libro registro, como la trae Diez:
    -- la regla 10 de abajo la casa con la 472 al céntimo.
    v_hay_isp := exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                           join public.tax_rate t on t.id = l.tax_rate_id
                          where l.entry_id = p_entry and a.template_code like '472%' and t.treatment in ('intra_eu', 'reverse_charge'));

    -- Regla 5, copiada de la vigente (20261113T0100: el céntimo de redondeo).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre and not v_liquidacion
             and not (a.template_code like '477%' and v_hay_isp)
          then 'un apunte de IVA lleva base, tipo y libro registro'
        -- V03 E2 (0146): un apunte con un tipo exento ES la base (la 70x de una
        -- venta sin IVA): su importe es su base, al céntimo.
        when l.tax_rate_id is not null and t.treatment = 'exempt'
             and abs(l.tax_base) <> l.debit + l.credit
          then format('un apunte sin IVA es su base: el importe %s no es la base %s', l.debit + l.credit, l.tax_base)
        when l.tax_rate_id is not null and t.treatment is distinct from 'exempt'
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
             and not (l.withholding_model is not null and l.withholding_period is not null)
          then 'una retención lleva su tipo, su base y su modelo; el pago o la compensación de un modelo, su modelo y su periodo'
        when a.template_code like '4751%' and l.withholding_rate_id is not null and l.withholding_period is not null
          then 'o es una retención que nace (tipo, base y modelo) o el pago de un modelo (modelo y periodo), no las dos'
        when v_local and not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then
      orden := 8; codigo := 'apuntes'; motivo := format('No se valida: %s.', v_mal); return next;
    end if;

    -- I01d (0300), regla 10 · LA AUTOLIQUIDACIÓN. (a) La 477 de la
    -- autorrepercusión (sin tipo) suma lo mismo que la 472 autoliquidada, al
    -- céntimo. (b) En una factura de proveedor, el tipo de cada línea de IVA
    -- es el que dice su ficha (país, NIF-IVA y régimen de IVA): si lo
    -- contradice, no se valida y se dice por qué.
    select coalesce(sum(l.debit - l.credit) filter (where a.template_code like '472%' and t.treatment in ('intra_eu', 'reverse_charge')), 0),
           coalesce(sum(l.credit - l.debit) filter (where a.template_code like '477%' and l.tax_rate_id is null), 0)
      into v_isp_472, v_auto_477
      from public.journal_line l join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
     where l.entry_id = p_entry;
    if v_hay_isp and v_isp_472 <> v_auto_477 then
      orden := 10; codigo := 'autorrepercusion';
      motivo := format('No se valida: falta la autorrepercusión. El IVA autoliquidado de la 472 suma %s y la 477 sin tipo, %s: tienen que ser lo mismo (el IVA lo declaras y lo deduces tú).',
                       public.conta_impuesto_euros(v_isp_472), public.conta_impuesto_euros(v_auto_477)); return next;
    elsif not v_hay_isp and v_auto_477 <> 0 and not v_cierre and not v_liquidacion then
      orden := 10; codigo := 'autorrepercusion';
      motivo := 'No se valida: hay una 477 sin tipo y ninguna compra autoliquidada en el asiento. Un apunte de IVA lleva base, tipo y libro registro.'; return next;
    end if;
    if v_e.source_type = 'supplier_invoice' then
      select s.name, s.country_code, public.conta_proveedor_iva_clase(s.country_code, s.tax_id_type, s.tax_id, s.tax_id_check_status, s.vat_regime) as clase
        into v_p
        from public.supplier_invoice si join public.supplier s on s.id = si.supplier_id and s.account_id = si.account_id
       where si.id = v_e.source_id and si.account_id = v_e.account_id;
      if found then
        select string_agg(format('el apunte %s lleva «%s»', l.position, t.name), ', ' order by l.position) into v_contra
          from public.journal_line l join public.tax_rate t on t.id = l.tax_rate_id
         where l.entry_id = p_entry and l.vat_book in ('received', 'investment')
           and not case v_p.clase
                 when 'intracomunitaria' then t.treatment = 'intra_eu'
                 when 'isp_extranjero' then t.treatment = 'reverse_charge'
                 when 'isp_nacional' then t.treatment = 'reverse_charge'
                 when 'nacional' then t.treatment in ('taxed', 'exempt', 'not_subject')
                 else false end;
        if v_contra is not null then
          orden := 11; codigo := 'tipo_contra_pais';
          motivo := 'No se valida: ' || v_contra || '. ' || v_p.name || ' ' || case v_p.clase
            when 'intracomunitaria' then 'es de ' || public.conta_pais_nombre(v_p.country_code) || ' y tiene NIF-IVA europeo: su compra es intracomunitaria y va con «Compra en otro país de la UE» (el IVA lo declaras tú).'
            when 'isp_extranjero' then 'es de fuera de la UE (' || public.conta_pais_nombre(v_p.country_code) || '): su compra va con «Inversión del sujeto pasivo» (el IVA lo declaras tú).'
            when 'isp_nacional' then 'está marcado con inversión del sujeto pasivo en su ficha: su compra va con «Inversión del sujeto pasivo».'
            when 'nacional' then 'es de España: su compra lleva el IVA de su factura. Si es una inversión del sujeto pasivo (obras, chatarra…), márcalo en su ficha, en «Régimen de IVA».'
            else 'es de ' || public.conta_pais_nombre(v_p.country_code) || ' y no tiene un NIF-IVA europeo válido: sin él su compra no es intracomunitaria. Pon su NIF-IVA en su ficha (se comprueba en VIES).' end;
          return next;
        end if;
      end if;
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

CREATE OR REPLACE FUNCTION public.conta_impuesto_retenciones_diario(p_company uuid, p_year integer, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.company; v_desde date; v_hasta date; v_asientos jsonb; v_sumas jsonb; v_640 jsonb; v_621 numeric; v_4751 jsonb;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  select * into v_desde, v_hasta from public.conta_impuesto_periodo_fechas(p_year, p_period);

  with e as (
    select je.id, je.entry_date, je.series, je.number, je.concept, je.status, je.source_type, je.reverses_entry_id
      from public.journal_entry je
     where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
       and je.entry_date between v_desde and v_hasta
       and exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                    where l.entry_id = je.id and ca.code like '4751%')
  ), x as (
    select e.id, e.entry_date, e.series, e.number, e.concept, e.status, e.source_type, e.reverses_entry_id,
           coalesce(sum(l.credit - l.debit) filter (where ca.code like '4751%'), 0) as retenido,
           bool_or(ca.code ~ '^(10|11|12)') as mueve_grupo_1,
           bool_or(ca.code like '57%') as tesoreria,
           -- S01d: todas sus líneas de la 4751 dicen modelo y periodo y no llevan tipo: es un pago, una compensación o una devolución.
           coalesce(bool_and(l.withholding_rate_id is null and l.withholding_model is not null and l.withholding_period is not null)
                    filter (where ca.code like '4751%'), false) as pago_marcado,
           coalesce(sum(l.debit - l.credit) filter (where ca.code like '621%'), 0) as b621,
           coalesce(sum(l.debit - l.credit) filter (where ca.code like '640%'), 0) as b640,
           coalesce(sum(l.debit - l.credit) filter (where ca.code ~ '^(6|2)' and ca.code !~ '^(621|64)'), 0) as bgasto,
           max(l.withholding_model) filter (where ca.code like '4751%') as modelo_linea,
           max(wr.code) filter (where ca.code like '4751%') as tipo_linea,
           -- La base de la línea de la 4751 (Sumied la exige al validar): manda si la llevan todas.
           case when bool_and(l.withholding_base is not null) filter (where ca.code like '4751%')
                then sum(l.withholding_base) filter (where ca.code like '4751%') end as base_linea,
           string_agg(distinct ca.code, ' ') filter (where ca.code like '4751%') as cuentas_4751,
           -- El perceptor: el tercero de la línea de la 4751 o, si no, la subcuenta del proveedor (40 o 41).
           coalesce(max(l.party_id::text) filter (where ca.code like '4751%'),
                    max(ca.id::text) filter (where ca.code ~ '^(40|41)')) as perceptor,
           max(ca.code || ' · ' || coalesce(nullif(ca.plain_name, ''), ca.name)) filter (where ca.code ~ '^(40|41)') as perceptor_nombre
      from e
      join public.journal_line l on l.entry_id = e.id
      join public.company_account ca on ca.id = l.company_account_id
      left join public.withholding_rate wr on wr.id = l.withholding_rate_id
     group by e.id, e.entry_date, e.series, e.number, e.concept, e.status, e.source_type, e.reverses_entry_id
  ), m0 as (
    select x.*,
           case when x.source_type in ('opening', 'closing') or x.mueve_grupo_1 then 'apertura'
                when x.pago_marcado then 'pago'
                when x.retenido < 0 and x.reverses_entry_id is null and x.tesoreria then 'pago'
                when x.modelo_linea is not null and x.modelo_linea not in ('111', '115') then 'otro_modelo'
                when x.modelo_linea = '115' or (x.modelo_linea is null and x.b621 <> 0) then '115'
                when x.modelo_linea = '111' and x.tipo_linea = 'administradores' then '111_nomina'
                when x.modelo_linea = '111' then '111_profesional'
                when x.b640 <> 0 then '111_nomina'
                when x.bgasto <> 0 then '111_profesional'
                else 'sin_modelo' end as tipo
      from x
  ), m as (
    -- La base: la de la línea de la 4751 si la lleva (con el signo de lo retenido: un
    -- contraasiento resta); si no (lo traído de Diez), la de la regla de arriba.
    select m0.*,
           case when m0.base_linea is not null then sign(m0.retenido) * abs(m0.base_linea)
                else case m0.tipo when '115' then m0.b621 when '111_nomina' then m0.b640 when '111_profesional' then m0.bgasto end end as base
      from m0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'asiento', m.id, 'fecha', m.entry_date, 'serie', m.series, 'numero', m.number, 'concepto', m.concept, 'estado', m.status,
           'tipo', m.tipo, 'retenido', round(m.retenido, 2),
           'base', round(m.base, 2), 'tipo_retencion', m.tipo_linea,
           'perceptor', case when m.tipo in ('115', '111_profesional') then m.perceptor end,
           'perceptor_nombre', case when m.tipo in ('115', '111_profesional') then m.perceptor_nombre end,
           'cuentas_4751', m.cuentas_4751) order by m.entry_date, m.series, m.number), '[]'),
         jsonb_build_object(
           '115', jsonb_build_object('asientos', count(*) filter (where m.tipo = '115'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '115'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '115'), 0), 2)),
           '111_nomina', jsonb_build_object('asientos', count(*) filter (where m.tipo = '111_nomina'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '111_nomina'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '111_nomina'), 0), 2)),
           '111_profesional', jsonb_build_object('asientos', count(*) filter (where m.tipo = '111_profesional'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '111_profesional'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '111_profesional'), 0), 2)),
           'sin_modelo', jsonb_build_object('asientos', count(*) filter (where m.tipo = 'sin_modelo'),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = 'sin_modelo'), 0), 2)),
           'otro_modelo', jsonb_build_object('asientos', count(*) filter (where m.tipo = 'otro_modelo'),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = 'otro_modelo'), 0), 2)),
           'pagos', count(*) filter (where m.tipo = 'pago'),
           'aperturas', count(*) filter (where m.tipo = 'apertura'))
    into v_asientos, v_sumas
    from m;

  -- Los perceptores distintos con algo retenido (un contraasiento lo deja a cero).
  v_sumas := jsonb_set(jsonb_set(v_sumas, '{115,perceptores}', to_jsonb((
      select count(*) from (select a->>'perceptor' from jsonb_array_elements(v_asientos) a where a->>'tipo' = '115' and a->>'perceptor' is not null
                             group by 1 having abs(sum((a->>'retenido')::numeric)) >= 0.005) s))),
    '{111_profesional,perceptores}', to_jsonb((
      select count(*) from (select a->>'perceptor' from jsonb_array_elements(v_asientos) a where a->>'tipo' = '111_profesional' and a->>'perceptor' is not null
                             group by 1 having abs(sum((a->>'retenido')::numeric)) >= 0.005) s)));

  -- Cada línea de la 640 de las nóminas, para explicar una diferencia con lo presentado.
  select coalesce(jsonb_agg(jsonb_build_object('asiento', je.id, 'fecha', je.entry_date, 'importe', round(l.debit - l.credit, 2),
                                               'concepto', coalesce(l.concept, je.concept)) order by je.entry_date, l.position), '[]')
    into v_640
    from public.journal_line l join public.journal_entry je on je.id = l.entry_id
    join public.company_account ca on ca.id = l.company_account_id
   where je.id in (select (a->>'asiento')::uuid from jsonb_array_elements(v_asientos) a where a->>'tipo' = '111_nomina')
     and ca.code like '640%';

  -- La 621 entera del periodo (también los alquileres sin retención) y el haber de cada subcuenta de la 4751.
  select coalesce(sum(l.debit - l.credit), 0) into v_621
    from public.journal_line l join public.journal_entry je on je.id = l.entry_id
    join public.company_account ca on ca.id = l.company_account_id
   where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
     and je.entry_date between v_desde and v_hasta and ca.code like '621%';
  select coalesce(jsonb_agg(jsonb_build_object('cuenta', q.code, 'nombre', q.nombre, 'haber', q.haber, 'debe', q.debe) order by q.code), '[]')
    into v_4751
    from (select ca.code, coalesce(nullif(ca.plain_name, ''), ca.name) as nombre, round(sum(l.credit), 2) as haber, round(sum(l.debit), 2) as debe
            from public.journal_line l join public.journal_entry je on je.id = l.entry_id
            join public.company_account ca on ca.id = l.company_account_id
           where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
             and je.entry_date between v_desde and v_hasta and ca.code like '4751%'
             and je.source_type not in ('opening', 'closing')
             and not exists (select 1 from public.journal_line g join public.company_account gc on gc.id = g.company_account_id
                              where g.entry_id = je.id and gc.code ~ '^(10|11|12)')
           group by 1, 2) q;

  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'asientos', v_asientos, 'sumas', v_sumas,
                            'lineas_640', v_640, 'cuenta_621', round(v_621, 2), 'cuentas_4751', v_4751);
end $function$;

CREATE OR REPLACE FUNCTION public.bank_casar(p_movement uuid, p_destino jsonb, p_confianza text, p_porque text, p_razones jsonb, p_por text, p_regla uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m public.bank_movement; v_t public.treasury_account; v_aj public.bank_settings; v_cuenta uuid; v_tipo text := p_destino->>'tipo';
  v_572 text; v_entry uuid; v_creado boolean := false; v_match uuid; v_lineas jsonb := '[]'::jsonb; v_l jsonb; v_suma numeric := 0;
  v_abs numeric; v_entra boolean; v_local uuid; v_comun boolean; v_concepto text; v_res jsonb; v_validado boolean := false;
  v_f jsonb; v_inv public.supplier_invoice; v_pagado numeric; v_cs public.channel_settlement; v_o public.bank_movement; v_o572 text;
  v_ot public.treasury_account; v_aviso text; v_tercero uuid := nullif(p_destino->>'tercero_id', '')::uuid; v_marcada boolean;
  v_dif numeric := 0; v_dif_cuenta text;
  -- PC01: las facturas emitidas que cobra el movimiento.
  v_ci public.customer_invoice; v_cobrado numeric; v_sumf numeric := 0;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._bank_cuenta_de_empresa(v_m.company_id);
  if p_por not in ('folvy', 'persona') then raise exception 'Quién casa: folvy o persona.' using errcode = '23514'; end if;
  if p_confianza not in ('seguro', 'probable', 'duda') or coalesce(trim(p_porque), '') = '' then
    raise exception 'Todo casado lleva su confianza y su porqué.' using errcode = '23514';
  end if;
  if exists (select 1 from public.bank_match where movement_id = p_movement and status = 'vivo') then
    raise exception 'Este movimiento ya está casado: cada movimiento se casa una sola vez.' using errcode = '23505';
  end if;
  if v_m.status = 'ignorado' then raise exception 'Ese movimiento está ignorado.' using errcode = '23514'; end if;
  if v_m.status = 'posible_repetido' then raise exception 'Primero di si es el mismo que el ya traído.' using errcode = '23514'; end if;
  -- P4: antes del corte el libro ya tiene el banco (traído): solo se enlaza.
  if v_m.before_cutover and v_tipo <> 'asiento' then
    raise exception 'Este movimiento es de antes de la fecha de corte: solo se enlaza con un asiento que ya esté en el libro.' using errcode = '23514';
  end if;
  select * into v_t from public.treasury_account where id = v_m.treasury_account_id;
  v_572 := public._bank_cuenta_572(v_t.id);
  v_aj := public._bank_ajustes(v_m.company_id);
  v_abs := abs(v_m.amount); v_entra := v_m.amount > 0;
  -- El local: el de la tarjeta que pagó, si el destino lo trae; si no, el de la cuenta.
  v_local := coalesce(nullif(p_destino->>'local_id', '')::uuid, v_t.location_id); v_comun := v_local is null;
  v_concepto := coalesce(nullif(trim(p_destino->>'concepto'), ''), nullif(v_m.clean_concept, ''), 'Movimiento del banco');

  if v_tipo = 'asiento' then
    v_entry := (p_destino->>'entry_id')::uuid;
  elsif v_tipo = 'factura_recibida' then
    for v_f in select * from jsonb_array_elements(p_destino->'facturas') loop
      select * into v_inv from public.supplier_invoice where id = (v_f->>'id')::uuid and account_id = v_cuenta for update;
      if v_inv.id is null then raise exception 'Esa factura no es de la cuenta.' using errcode = '23514'; end if;
      select coalesce(sum(i.amount), 0) into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
       where i.supplier_invoice_id = v_inv.id and b.status = 'vivo';
      if v_pagado + (v_f->>'importe')::numeric > coalesce(v_inv.grand_total, 0) + 0.005 then
        raise exception 'La factura % ya tiene casados % de %: este pago la pasaría.', coalesce(v_inv.invoice_number, ''),
          public.conta_euros_exactos(v_pagado), public.conta_euros_exactos(coalesce(v_inv.grand_total, 0)) using errcode = '23514';
      end if;
      v_suma := v_suma + (v_f->>'importe')::numeric;
      -- P2: si su pago ya está apuntado (propuesto o validado), se enlaza ese asiento y no se crea otro.
      -- (B02: no si lleva diferencia: ese asiento no la tiene.)
      if jsonb_array_length(p_destino->'facturas') = 1 and v_entry is null and not (p_destino ? 'diferencia') then
        select e.id into v_entry from public.journal_entry e
         where e.company_id = v_m.company_id and e.status in ('propuesto', 'borrador', 'validado')
           and (e.id = v_inv.payment_entry_id or (e.source_type = 'supplier_payment' and e.source_id = v_inv.id))
           and not exists (select 1 from public.bank_match b where b.journal_entry_id = e.id and b.status = 'vivo')
         limit 1;
      end if;
    end loop;
    -- B02 · La diferencia pequeña (comisión o redondeo), con su cuenta: + pagado de más (gasto, al debe),
    -- − pagado de menos (ingreso, al haber). Hasta 3 € y el 3 % del pago; la propone el motor y la confirma la persona.
    if p_destino ? 'diferencia' then
      v_dif := (p_destino->'diferencia'->>'importe')::numeric;
      v_dif_cuenta := nullif(trim(p_destino->'diferencia'->>'cuenta'), '');
      if v_dif_cuenta is null or v_dif = 0 then raise exception 'La diferencia lleva su cuenta y su importe.' using errcode = '23514'; end if;
      if abs(v_dif) > least(3, round(v_abs * 0.03, 2)) + 0.005 then
        raise exception 'Una diferencia de % no es pequeña (hasta 3 € y el 3 %% del pago): casa la factura en parte o apunta la diferencia aparte.', public.conta_euros_exactos(abs(v_dif)) using errcode = '23514';
      end if;
      if p_por <> 'persona' then raise exception 'Una diferencia no se apunta sola: la confirma la persona.' using errcode = '23514'; end if;
    end if;
    if v_suma + v_dif <> v_abs then raise exception 'Las facturas suman % y el movimiento es de %.', public.conta_euros_exactos(v_suma + v_dif), public.conta_euros_exactos(v_abs) using errcode = '23514'; end if;
    if v_entry is null then
      v_lineas := jsonb_build_array(jsonb_build_object('cuenta', p_destino->>'cuenta_tercero', 'debe', v_suma, 'haber', 0, 'tercero_id', v_tercero,
                                                       'concepto', v_concepto, 'local_id', v_local, 'comun', v_comun));
      if v_dif <> 0 then
        v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_dif_cuenta, 'debe', greatest(v_dif, 0), 'haber', greatest(-v_dif, 0),
          'concepto', coalesce(nullif(trim(p_destino->'diferencia'->>'concepto'), ''), v_concepto), 'local_id', v_local, 'comun', v_comun));
      end if;
    end if;
  elsif v_tipo = 'liquidacion' then
    select * into v_cs from public.channel_settlement where id = (p_destino->>'liquidacion_id')::uuid and account_id = v_cuenta for update;
    if v_cs.id is null then raise exception 'Esa liquidación no es de la cuenta.' using errcode = '23514'; end if;
    if exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id where i.channel_settlement_id = v_cs.id and b.status = 'vivo') then
      raise exception 'Esa liquidación ya está casada con otro movimiento.' using errcode = '23505';
    end if;
    -- P2: «cobrada» a mano y su asiento con el cobro dentro → se enlaza.
    if v_cs.collected_on is not null and v_cs.journal_entry_id is not null then v_entry := v_cs.journal_entry_id; end if;
    if v_entry is null then
      v_lineas := jsonb_build_array(jsonb_build_object('cuenta', p_destino->>'cuenta_cliente', 'debe', 0, 'haber', v_abs, 'tercero_id', v_tercero,
                                                       'concepto', v_concepto, 'local_id', v_local, 'comun', v_comun));
    end if;
  elsif v_tipo = 'traspaso' then
    select * into v_o from public.bank_movement where id = (p_destino->>'otro_movimiento_id')::uuid for update;
    if v_o.id is null or v_o.company_id <> v_m.company_id or v_o.treasury_account_id = v_m.treasury_account_id then
      raise exception 'El otro lado del traspaso tiene que ser un movimiento de otra cuenta de la misma empresa.' using errcode = '23514';
    end if;
    if v_o.amount <> -v_m.amount then raise exception 'Un traspaso sale de una cuenta y entra en otra por el mismo importe.' using errcode = '23514'; end if;
    if exists (select 1 from public.bank_match where movement_id = v_o.id and status = 'vivo') then
      raise exception 'El otro lado del traspaso ya está casado.' using errcode = '23505';
    end if;
    select * into v_ot from public.treasury_account where id = v_o.treasury_account_id;
    v_o572 := public._bank_cuenta_572(v_ot.id);
    if v_o572 is null then raise exception 'La cuenta «%» no tiene su cuenta contable (572).', v_ot.name using errcode = '23514'; end if;
    v_lineas := jsonb_build_array(jsonb_build_object('cuenta', v_o572, 'debe', case when v_entra then 0 else v_abs end,
                                                     'haber', case when v_entra then v_abs else 0 end, 'concepto', v_concepto,
                                                     'local_id', v_ot.location_id, 'comun', v_ot.location_id is null));
  elsif v_tipo in ('cuenta', 'anticipo', 'contrato', 'factura_emitida') then
    for v_l in select * from jsonb_array_elements(p_destino->'lineas') loop
      v_suma := v_suma + (v_l->>'importe')::numeric;
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_l->>'cuenta',
        'debe', case when v_entra then 0 else (v_l->>'importe')::numeric end, 'haber', case when v_entra then (v_l->>'importe')::numeric else 0 end,
        'tercero_id', coalesce(nullif(v_l->>'tercero_id', '')::uuid, v_tercero), 'concepto', coalesce(v_l->>'concepto', v_concepto),
        'local_id', v_local, 'comun', v_comun,
        -- S01d: el pago de un modelo lleva su modelo y su periodo («111 · 3T 2026»).
        'retencion', case when nullif(v_l->>'periodo', '') is not null
                          then jsonb_build_object('modelo', v_l->>'modelo', 'periodo', v_l->>'periodo') end));
    end loop;
    if v_suma <> v_abs then raise exception 'Las líneas suman % y el movimiento es de %.', public.conta_euros_exactos(v_suma), public.conta_euros_exactos(v_abs) using errcode = '23514'; end if;
    -- PC01 · Cobrar facturas emitidas: cada una, de la empresa, emitida y sin pasarse.
    if v_tipo = 'factura_emitida' and jsonb_typeof(p_destino->'facturas') = 'array' and jsonb_array_length(p_destino->'facturas') > 0 then
      if not v_entra then raise exception 'Un cobro de facturas entra en el banco, y este movimiento sale.' using errcode = '23514'; end if;
      for v_f in select * from jsonb_array_elements(p_destino->'facturas') loop
        select * into v_ci from public.customer_invoice where id = (v_f->>'id')::uuid and account_id = v_cuenta and company_id = v_m.company_id for update;
        if v_ci.id is null then raise exception 'Esa factura emitida no es de la empresa.' using errcode = '23514'; end if;
        if v_ci.status <> 'emitida' then raise exception 'La factura % no está emitida (está %).', coalesce(v_ci.number_text, ''), v_ci.status using errcode = '23514'; end if;
        if coalesce((v_f->>'importe')::numeric, 0) <= 0 then raise exception 'Cada factura cobra un importe mayor que cero.' using errcode = '23514'; end if;
        select coalesce(sum(amount), 0) into v_cobrado from public.customer_invoice_payment where invoice_id = v_ci.id;
        if v_cobrado + (v_f->>'importe')::numeric > v_ci.total + 0.005 then
          raise exception 'La factura % ya tiene cobrados % de %: este cobro la pasaría.', coalesce(v_ci.number_text, ''),
            public.conta_euros_exactos(v_cobrado), public.conta_euros_exactos(v_ci.total) using errcode = '23514';
        end if;
        v_sumf := v_sumf + (v_f->>'importe')::numeric;
      end loop;
      if v_sumf > v_abs + 0.005 then
        raise exception 'Las facturas suman % y el movimiento es de %.', public.conta_euros_exactos(v_sumf), public.conta_euros_exactos(v_abs) using errcode = '23514';
      end if;
    end if;
  else
    raise exception 'Tipo de casado no válido: %.', v_tipo using errcode = '23514';
  end if;

  if v_entry is not null then
    -- Enlazar: el asiento es de la empresa, está vivo y lleva este banco por este importe en su lado.
    if not exists (select 1 from public.journal_entry e where e.id = v_entry and e.company_id = v_m.company_id and e.status in ('propuesto', 'borrador', 'validado')) then
      raise exception 'Ese asiento no es de la empresa o no está vivo.' using errcode = '23514';
    end if;
    if v_572 is not null and not exists (select 1 from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id
                       where jl.entry_id = v_entry and ca.code = v_572 and (case when v_entra then jl.debit else jl.credit end) = v_abs) then
      raise exception 'Ese asiento no lleva % en %, en su lado.', public.conta_euros_exactos(v_abs), v_572 using errcode = '23514';
    end if;
    if exists (select 1 from public.bank_match where journal_entry_id = v_entry and status = 'vivo' and kind <> 'traspaso') then
      raise exception 'Ese asiento ya está casado con otro movimiento.' using errcode = '23505';
    end if;
  else
    if v_572 is null then raise exception 'La cuenta «%» no tiene su cuenta contable (572): dila en Cuentas y extractos.', v_t.name using errcode = '23514'; end if;
    v_lineas := jsonb_build_array(jsonb_build_object('cuenta', v_572, 'debe', case when v_entra then v_abs else 0 end,
                                                     'haber', case when v_entra then 0 else v_abs end, 'concepto', v_concepto,
                                                     'local_id', v_local, 'comun', v_comun)) || v_lineas;
    v_res := public._journal_entry_proponer(v_m.company_id,
      jsonb_build_object('fecha', v_m.op_date, 'series', v_aj.treasury_series, 'concepto', v_concepto, 'source_type', 'bank', 'source_id', v_m.id,
                         'confianza', p_confianza, 'porque', p_porque, 'razones', coalesce(p_razones, '[]'::jsonb), 'party_id', v_tercero,
                         'documento', coalesce(v_m.document_no, v_m.reference_1)),
      v_lineas, '{}'::jsonb, case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end, auth.uid());
    if coalesce((v_res->>'descartada')::boolean, false) then raise exception 'Ese movimiento tenía la propuesta descartada.' using errcode = '23514'; end if;
    v_entry := (v_res->>'id')::uuid;
    v_creado := not coalesce((v_res->>'existente')::boolean, false);
  end if;

  insert into public.bank_match (account_id, company_id, movement_id, kind, journal_entry_id, entry_created, amount, confidence, reason, by_who, rule_id,
                                 created_by, created_by_name)
  values (v_cuenta, v_m.company_id, v_m.id, v_tipo, v_entry, v_creado, v_m.amount, p_confianza, p_porque, p_por, p_regla, auth.uid(),
          case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end)
  returning id into v_match;

  -- Respuesta 4: la persona casa con otra cosa lo que proponía una regla → una
  -- corrección para esa regla; a la segunda se apaga sola y lo dice (0150).
  if p_por = 'persona' and nullif(v_m.proposal->>'reglaId', '') is not null
     and (p_regla is null or p_regla::text <> v_m.proposal->>'reglaId') then
    perform public._bank_regla_corregida((v_m.proposal->>'reglaId')::uuid, v_m.id);
  end if;

  -- A qué y por cuánto, y lo que cambia fuera del banco.
  if v_tipo = 'factura_recibida' then
    for v_f in select * from jsonb_array_elements(p_destino->'facturas') loop
      select * into v_inv from public.supplier_invoice where id = (v_f->>'id')::uuid;
      select coalesce(sum(i.amount), 0) + (v_f->>'importe')::numeric into v_pagado from public.bank_match_item i join public.bank_match b on b.id = i.match_id
       where i.supplier_invoice_id = v_inv.id and b.status = 'vivo';
      -- Pagada entera: por el camino de siempre (mark_supplier_invoice_paid), con su freno del IBAN y su registro.
      -- B02: solo si está aprobada. Confirmar el pago de una factura «en revisión» no la aprueba ni la marca:
      -- el casado queda (bank_match_item) y se marcará cuando se apruebe.
      v_marcada := v_pagado >= coalesce(v_inv.grand_total, 0) - 0.005 and v_inv.paid_at is null and v_inv.status = 'aprobada';
      insert into public.bank_match_item (account_id, match_id, supplier_invoice_id, amount, marked_by_bank)
      values (v_cuenta, v_match, v_inv.id, (v_f->>'importe')::numeric, v_marcada);
      if v_marcada then
        perform public.mark_supplier_invoice_paid(v_inv.id, v_m.op_date, coalesce(p_destino->>'metodo', 'transfer'));
      end if;
      update public.supplier_invoice set payment_entry_id = coalesce(payment_entry_id, v_entry) where id = v_inv.id;
    end loop;
  elsif v_tipo = 'liquidacion' then
    -- Cobrada por el camino de siempre (channel_settlement_collect), si no lo estaba.
    insert into public.bank_match_item (account_id, match_id, channel_settlement_id, amount, marked_by_bank)
    values (v_cuenta, v_match, v_cs.id, v_m.amount, v_cs.collected_on is null);
    if v_cs.collected_on is null then
      perform public.channel_settlement_collect(v_cs.id, v_m.op_date, v_m.amount,
        'Casado con el movimiento del banco del ' || to_char(v_m.op_date, 'DD/MM/YYYY'), 'Folvy · banco');
    end if;
  elsif v_tipo = 'traspaso' then
    insert into public.bank_match_item (account_id, match_id, other_movement_id, amount) values (v_cuenta, v_match, v_o.id, v_m.amount);
    insert into public.bank_match (account_id, company_id, movement_id, kind, journal_entry_id, entry_created, amount, confidence, reason, by_who, rule_id,
                                   created_by, created_by_name)
    values (v_cuenta, v_m.company_id, v_o.id, 'traspaso', v_entry, false, v_o.amount, p_confianza, p_porque, p_por, p_regla, auth.uid(),
            case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end);
    update public.bank_movement set status = 'casado', confidence = p_confianza, reason = p_porque, updated_at = now() where id = v_o.id;
  elsif v_tipo = 'factura_emitida' and v_sumf > 0 then
    -- PC01: cada factura emitida con lo que cobra (el disparador de bank_match_item escribe su cobro con este asiento).
    for v_f in select * from jsonb_array_elements(p_destino->'facturas') loop
      insert into public.bank_match_item (account_id, match_id, customer_invoice_id, party_id, amount)
      values (v_cuenta, v_match, (v_f->>'id')::uuid, v_tercero, (v_f->>'importe')::numeric);
    end loop;
  elsif v_tercero is not null then
    insert into public.bank_match_item (account_id, match_id, party_id, amount) values (v_cuenta, v_match, v_tercero, v_m.amount);
  end if;

  update public.bank_movement set status = 'casado', confidence = p_confianza, reason = p_porque, updated_at = now() where id = v_m.id;

  -- Lo seguro se valida solo si la empresa lo ha activado (apagado por defecto).
  if v_creado and p_confianza = 'seguro' and p_por = 'folvy' and v_aj.validate_safe then
    begin
      perform public.journal_entry_validar(v_entry, 'Folvy');
      v_validado := true;
    exception when others then
      v_aviso := 'No se ha podido validar solo: ' || sqlerrm || '. Queda propuesto.';
    end;
  end if;

  perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, case when v_creado then 'casado' else 'enlazado' end, p_por,
    p_porque, jsonb_build_object('tipo', v_tipo, 'asiento', v_entry, 'creado', v_creado, 'validado', v_validado, 'aviso', v_aviso));
  if v_validado then
    perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, 'validado', 'folvy', 'Validado solo: es seguro y la empresa lo tiene activado', '{}'::jsonb);
  end if;
  if p_regla is not null then
    update public.bank_rule set last_used_at = now() where id = p_regla and company_id = v_m.company_id;
  end if;
  return jsonb_build_object('match', v_match, 'asiento', v_entry, 'creado', v_creado, 'validado', v_validado, 'aviso', v_aviso);
end $function$;

-- «111 · 3T 2026»
create or replace function public.conta_modelo_periodo_texto(p_modelo text, p_periodo text)
returns text language sql immutable set search_path = public as $$
  select p_modelo || ' · ' || case when split_part(p_periodo, '-', 2) = '0A' then 'año ' || split_part(p_periodo, '-', 1)
                                   else split_part(p_periodo, '-', 2) || ' ' || split_part(p_periodo, '-', 1) end
$$;
grant execute on function public.conta_modelo_periodo_texto(text, text) to authenticated;

-- ── 6 · Lo pagado y lo que queda de un modelo y periodo (solo lee) ───────
create or replace function public.conta_modelo_pagado(p_company uuid, p_modelo text, p_periodo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c company; t tax_return; v_pagado numeric; v_pendiente numeric;
begin
  select * into c from company where id = p_company;
  if c.id is null or not public.belongs_to_account(c.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_pagado
    from journal_line l join journal_entry e on e.id = l.entry_id join company_account a on a.id = l.company_account_id
   where l.company_id = p_company and e.status = 'validado' and a.template_code like '4751%'
     and l.withholding_model = p_modelo and l.withholding_period = p_periodo and l.withholding_rate_id is null;
  select * into t from tax_return
   where company_id = p_company and form_code = p_modelo and fiscal_year = split_part(p_periodo, '-', 1)::int
     and period = case when split_part(p_periodo, '-', 2) = '0A' then '0A' else split_part(p_periodo, '-', 2) end
     and status = 'filed' order by sequence desc limit 1;
  v_pendiente := case when t.id is not null and t.result_kind = 'to_pay' then round(t.amount - v_pagado, 2) end;
  return jsonb_build_object('modelo', p_modelo, 'periodo', p_periodo, 'texto', public.conta_modelo_periodo_texto(p_modelo, p_periodo),
    'declaracion', t.id, 'importe', t.amount, 'pagado', round(v_pagado, 2), 'pendiente', v_pendiente, 'asiento_pago', t.payment_entry_id);
end $$;
revoke all on function public.conta_modelo_pagado(uuid, text, text) from public, anon;
grant execute on function public.conta_modelo_pagado(uuid, text, text) to authenticated;

-- ── 4b · Impuestos › «Casar el cargo» de un 111, un 115 o un 123: su subcuenta de la 4751 y su periodo ──
CREATE OR REPLACE FUNCTION public.conta_impuesto_casar_cargo(p_return uuid, p_movement uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.tax_return; m public.bank_movement; v_cta text; v_casado jsonb; v_match uuid; v_entry uuid; v_aviso text; v_estado text;
  v_esperado numeric; v_nombre text := public.conta_impuesto_quien();
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(r.account_id) then
    raise exception 'El pago lo casa un administrador o un encargado de la empresa.' using errcode = '42501';
  end if;
  if r.status not in ('filed', 'booked') then
    raise exception 'Esta declaración está «%»: el pago se casa cuando está presentada.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if coalesce(r.result_kind, '') not in ('to_pay', 'to_refund') or coalesce(r.amount, 0) = 0 then
    raise exception 'Este 303 no sale a pagar ni a devolver: no hay cargo que casar.' using errcode = '22023';
  end if;
  select * into m from public.bank_movement where id = p_movement;
  if m.id is null or m.company_id <> r.company_id or m.account_id <> r.account_id then
    raise exception 'Ese movimiento no es de la empresa de la declaración.' using errcode = '42501';
  end if;
  -- (El IF de PL/pgSQL corta en el primer THEN: el CASE, fuera.)
  v_esperado := case when r.result_kind = 'to_pay' then -r.amount else r.amount end;
  if m.amount <> v_esperado then
    raise exception 'El movimiento es de % y la declaración, de % %.', public.conta_impuesto_euros(m.amount), public.conta_impuesto_euros(r.amount),
      case when r.result_kind = 'to_pay' then 'a pagar' else 'a devolver' end using errcode = '22023';
  end if;
  if r.form_code in ('111', '115', '123') then
    -- S01d: una retención se paga en la subcuenta de la 4751 de su modelo (la que lo dice en su
    -- configuración; si ninguna lo dice y solo hay una, ésa), con su modelo y su periodo en la línea.
    select min(code) into v_cta from public.company_account where company_id = r.company_id and template_code like '4751%' and withholding_model = r.form_code
     having count(*) = 1;
    if v_cta is null then
      select min(code) into v_cta from public.company_account where company_id = r.company_id and template_code like '4751%' and kind <> 'template'
       having count(*) = 1;
    end if;
    if v_cta is null then
      raise exception 'No sé en qué subcuenta de la 4751 va el %: dilo en la cuenta (su modelo).', r.form_code using errcode = '23514';
    end if;
  else
    select min(code) into v_cta from public.company_account where company_id = r.company_id
       and template_code = case when r.result_kind = 'to_pay' then '4750' else '4700' end;
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', case when r.result_kind = 'to_pay' then '4750' else '4700' end using errcode = '23514'; end if;
  end if;

  v_casado := public.bank_casar(m.id,
    jsonb_build_object('tipo', 'cuenta', 'concepto', 'Pago del ' || r.form_code || ' ' || r.period || '/' || r.fiscal_year,
                       'lineas', jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'importe', r.amount,
                                                   'concepto', 'Pago del ' || r.form_code || ' ' || r.period || '/' || r.fiscal_year)
                                                   || case when r.form_code in ('111', '115', '123')
                                                           then jsonb_build_object('modelo', r.form_code, 'periodo', r.fiscal_year || '-' || r.period) else '{}'::jsonb end)),
    'seguro', 'Es el ' || case when r.result_kind = 'to_pay' then 'cargo' else 'abono' end || ' del ' || r.form_code || ' ' || r.period || '/' || r.fiscal_year || ' por su importe.',
    jsonb_build_array(jsonb_build_object('decision', 'pago-impuesto', 'declaracion', r.id)), 'persona', null);
  v_match := (v_casado->>'match')::uuid; v_entry := (v_casado->>'asiento')::uuid;
  insert into public.bank_match_item (account_id, match_id, tax_return_id, amount, marked_by_bank)
  values (r.account_id, v_match, r.id, m.amount, true);

  -- El asiento del pago, validado: lo ha confirmado la persona. Si no se puede, queda propuesto y se dice.
  if exists (select 1 from public.journal_entry where id = v_entry and status in ('propuesto', 'borrador')) then
    begin
      perform public.journal_entry_validar(v_entry, v_nombre);
    exception when others then
      v_aviso := ' Su asiento queda propuesto: ' || sqlerrm;
    end;
  end if;

  v_estado := case when r.result_kind = 'to_pay' then 'paid' else 'refunded' end;
  update public.tax_return set status = v_estado, bank_match_id = v_match, payment_entry_id = v_entry, updated_at = now() where id = r.id;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, r.company_id, auth.uid(), v_nombre, 'note',
          format('%s con el movimiento del %s por %s.%s', case when v_estado = 'paid' then 'Pagado' else 'Devuelto' end,
                 to_char(m.op_date, 'DD/MM/YYYY'), public.conta_impuesto_euros(abs(m.amount)), coalesce(v_aviso, '')),
          jsonb_build_object('casado', v_match, 'asiento', v_entry, 'movimiento', m.id));
  return jsonb_build_object('ok', true, 'casado', v_match, 'asiento', v_entry,
    'mensaje', format('%s: casado con el movimiento del %s por %s.%s', case when v_estado = 'paid' then 'Pagado' else 'Devuelto' end,
                      to_char(m.op_date, 'DD/MM/YYYY'), public.conta_impuesto_euros(abs(m.amount)), coalesce(v_aviso, '')));
end $function$;

-- ── 5 · Un apunte de la 4751 es el pago de un modelo ──────────────────────
create or replace function public.conta_apunte_pago_modelo(p_entry uuid, p_posicion int, p_modelo text, p_periodo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e journal_entry; l journal_line; a company_account; v_txt text;
begin
  select * into e from journal_entry where id = p_entry;
  if e.id is null or not public.current_user_is_admin_or_manager_of(e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if e.status not in ('borrador', 'propuesto') then
    raise exception 'El asiento ya está %: un asiento validado no se cambia.', e.status using errcode = '22023';
  end if;
  select * into l from journal_line where entry_id = e.id and position = p_posicion;
  select * into a from company_account where id = l.company_account_id;
  if l.id is null or a.template_code not like '4751%' then
    raise exception 'Solo un apunte de la 4751 es el pago de un modelo.' using errcode = '22023';
  end if;
  if p_modelo is null or p_modelo not in ('111', '115', '123') then raise exception 'Di el modelo: 111, 115 o 123.' using errcode = '22023'; end if;
  if p_periodo is null or p_periodo !~ '^[0-9]{4}-([1-4]T|0[1-9]|1[0-2]|0A)$' then
    raise exception 'Di el periodo: el año y el trimestre (3T), el mes o el año entero.' using errcode = '22023';
  end if;
  update journal_line set withholding_model = p_modelo, withholding_period = p_periodo, withholding_rate_id = null, withholding_base = null
   where id = l.id;
  v_txt := public.conta_modelo_periodo_texto(p_modelo, p_periodo);
  return jsonb_build_object('mensaje', format('Apuntado: el apunte %s (%s) es %s de %s.', p_posicion, a.code,
    case when l.debit > 0 then 'el pago' else 'la devolución' end, v_txt), 'pagado', public.conta_modelo_pagado(e.company_id, p_modelo, p_periodo));
end $$;
revoke all on function public.conta_apunte_pago_modelo(uuid, int, text, text) from public, anon;
grant execute on function public.conta_apunte_pago_modelo(uuid, int, text, text) to authenticated;

-- ── 7 · Al validar: el asiento que acaba de pagar un modelo, en su declaración ──
create or replace function public.tg_journal_entry_pago_modelo()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v jsonb;
begin
  if new.status <> 'validado' or old.status = 'validado' then return null; end if;
  for r in select distinct l.withholding_model m, l.withholding_period p from journal_line l
            where l.entry_id = new.id and l.withholding_period is not null and l.withholding_rate_id is null loop
    v := public.conta_modelo_pagado(new.company_id, r.m, r.p);
    if (v->>'declaracion') is not null and (v->>'pendiente')::numeric <= 0 and (v->>'asiento_pago') is null then
      -- Lo mismo que «Casar el cargo» de Impuestos: pagada, con su asiento y, si vino del banco, su casado.
      update tax_return t set payment_entry_id = new.id,
             status = case when t.status in ('filed', 'booked') then 'paid' else t.status end,
             bank_match_id = coalesce(t.bank_match_id, (select m.id from bank_match m where m.journal_entry_id = new.id and m.status = 'vivo' limit 1)),
             updated_at = now()
       where t.id = (v->>'declaracion')::uuid and t.payment_entry_id is null;
      insert into tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
      values ((v->>'declaracion')::uuid, new.account_id, new.company_id, auth.uid(), coalesce(new.validated_by_name, 'Sumied'), 'note',
              format('Pagado: lo dice el asiento %s/%s del %s (%s).', new.series, new.number, to_char(new.entry_date, 'DD/MM/YYYY'), v->>'texto'),
              jsonb_build_object('asiento', new.id, 'pagado', v->'pagado'));
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.tg_journal_entry_pago_modelo() from public, anon, authenticated;
drop trigger if exists journal_entry_pago_modelo on public.journal_entry;
create trigger journal_entry_pago_modelo after update of status on public.journal_entry
  for each row when (new.status = 'validado' and old.status is distinct from 'validado')
  execute function public.tg_journal_entry_pago_modelo();
