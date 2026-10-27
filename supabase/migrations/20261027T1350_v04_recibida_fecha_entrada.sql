-- supabase/migrations/20261027T1350_v04_recibida_fecha_entrada.sql
--
-- cambia: public._journal_entry_proponer · prueba: supabase/staging/sql/20261027_v04_recibida_fecha_entrada_prueba.sql
--
-- V04 · Respuesta 6, punto 2 · LA RECIBIDA NUNCA SE ASIENTA ANTES DEL DÍA EN
-- QUE ENTRÓ. La regla de Julio (27/10): «el asiento de una factura recibida
-- nunca va antes del día en que entró, aunque el mes esté abierto. Así el
-- asiento y su IVA caen siempre en el mismo trimestre.»
--
-- Por qué: su libro de IVA la registra el día que entró, o el del asiento si es
-- después (D07, 0850, conta_vat_book_desde_asiento), y el 303 la deduce por esa
-- fecha. Una factura del 30/09 que entra el 01/10 y se asienta el 30/09 dejaba
-- el asiento en el 3T y su IVA en el 4T (F-2026-0915 en staging).
--
--   1. _conta_recibida_no_antes_de_entrar: si la propuesta de una factura de
--      proveedor (source_type supplier_invoice) lleva una fecha anterior al día
--      en que entró la factura (supplier_invoice.created_at, en Madrid), la
--      pasa a ese día (o al primer día abierto y sin presentar desde él) y lo
--      dice: «Esta factura entró el 01/10: se contabiliza el 01/10.» La fecha
--      de la factura (fecha_documento) no se toca.
--   2. _journal_entry_proponer (misma firma, con su respaldo): la llama después
--      del candado del IVA (1233), y junta los dos avisos.
--
-- Lo que ya está asentado no se toca. Medido en producción (solo lectura,
-- 27/10): de las 95 recibidas validadas de Foodint, 90 tienen el asiento antes
-- del día en que entraron (todas en la fecha de su factura, de 1 a 14 días
-- antes, mediana 3), y ninguna en otro mes ni en otro trimestre.

select public._respaldar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261027T1350_v04_recibida_fecha_entrada');

-- ── 1 · No antes del día en que entró ──────────────────────────────────────
create or replace function public._conta_recibida_no_antes_de_entrar(p_company uuid, p_entry jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_fecha date := (p_entry->>'fecha')::date; v_entro date; v_nueva date; v_aviso text;
begin
  if p_entry->>'source_type' is distinct from 'supplier_invoice' or nullif(p_entry->>'source_id', '') is null then return p_entry; end if;
  select (si.created_at at time zone 'Europe/Madrid')::date into v_entro
    from public.supplier_invoice si join public.company c on c.id = p_company and c.account_id = si.account_id
   where si.id = (p_entry->>'source_id')::uuid;
  if v_entro is null or v_fecha is null or v_fecha >= v_entro then return p_entry; end if;
  v_nueva := coalesce(public.conta_primer_dia_iva_abierto(p_company, v_entro), v_entro);
  v_aviso := format('Esta factura entró el %s: se contabiliza el %s%s.', to_char(v_entro, 'DD/MM'), to_char(v_nueva, 'DD/MM'),
                    case when v_nueva <> v_entro then ', el primer día abierto' else '' end);
  return p_entry || jsonb_build_object('fecha', v_nueva, 'aviso', v_aviso,
    'razones', coalesce(p_entry->'razones', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'decision', v_aviso,
      'porque', format('Una factura recibida no se contabiliza antes del día en que entró (el %s): su IVA se deduce desde ese día, y así el asiento y su IVA caen en el mismo trimestre. Su fecha de factura no cambia.',
                       to_char(v_entro, 'DD/MM/YYYY')))));
end $$;
revoke all on function public._conta_recibida_no_antes_de_entrar(uuid, jsonb) from public, anon, authenticated;
comment on function public._conta_recibida_no_antes_de_entrar(uuid, jsonb) is
  'V04 (1350). La propuesta de una factura recibida, sin fecha anterior al día en que entró (supplier_invoice.created_at, en Madrid): si la lleva, va a ese día o al primer día abierto y sin presentar desde él, con su aviso y su razón. La usa _journal_entry_proponer.';

-- ── 2 · _journal_entry_proponer (misma firma), con su respaldo arriba ──────
create or replace function public._journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb, p_quien_nombre text, p_quien uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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
                                     withholding_rate_id, withholding_base, withholding_model)
    values (v_cuenta, p_company, v_id, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto',
            nullif(v_l->>'local_id', '')::uuid, coalesce((v_l->>'comun')::boolean, false), nullif(v_l->>'marca_id', '')::uuid,
            nullif(v_l->>'tercero_id', '')::uuid, v_l->>'documento',
            nullif(v_l->'iva'->>'tipo_id', '')::uuid, (v_l->'iva'->>'base')::numeric, v_l->'iva'->>'libro', v_l->'iva'->>'deducible',
            coalesce((v_l->'iva'->>'facturas')::int, 1),
            nullif(v_l->'retencion'->>'tipo_id', '')::uuid, (v_l->'retencion'->>'base')::numeric, v_l->'retencion'->>'modelo');
  end loop;
  if v_resumen is not null then update public.sales_day_summary set entry_id = v_id where id = v_resumen; end if;
  return jsonb_strip_nulls(jsonb_build_object('id', v_id, 'existente', false, 'aviso', nullif(concat_ws(' ', v_aviso_iva, p_entry->>'aviso'), '')));
end $$;
revoke all on function public._journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text, uuid) from public, anon, authenticated;
comment on function public._journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text, uuid) is
  'Propone un asiento (el cuerpo de journal_entry_proponer y del cierre del día). V04 (1233): una recibida de un periodo con el IVA presentado se asienta en el primer día abierto; una expedida para. V04 (1350): una recibida nunca antes del día en que entró. Los avisos, en «aviso».';
