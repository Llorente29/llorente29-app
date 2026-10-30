-- cambia: public.bank_casar · prueba: supabase/staging/sql/20261030_s01e_ficha_prueba.sql
-- cambia: public.bank_contrato_guardar · prueba: supabase/staging/sql/20261030_s01e_ficha_prueba.sql
--
-- S01e · La ficha de cada préstamo o aplazamiento (encargo del 30/10; tanda
-- aceptada por Julio después del paso 0). Usa las columnas de la 2210.
--
--   1. bank_casar (misma firma): al casar la cuota de un contrato
--      (destino «contrato» con contrato_id) guarda en bank_match el contrato
--      y la fecha de la fila que paga («fila»). El contrato tiene que ser de
--      la empresa del movimiento, la fecha una fila de su cuadro, y una fila
--      no se paga dos veces. Lo demás, igual.
--   2. bank_contrato_guardar (misma firma): modo «sustituir» para un préstamo
--      con un cuadro nuevo. Se van las cuotas desde la primera del cuadro
--      nuevo y entran las suyas; las pagadas no se tocan. La comprobación:
--      lo prestado, menos el capital de las cuotas que se quedan y lo
--      amortizado de golpe, es el capital del cuadro nuevo. Además, guarda
--      cuándo se subió el cuadro (document_uploaded_at), y el modo «datos»
--      para «Más acciones» de la ficha (cambiar las cuentas, lo que pone el
--      banco o darlo por terminado): recurring_contract solo se lee.

select public._respaldar_funcion('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)', '20261030T2211_s01e_ficha');
select public._respaldar_funcion('public.bank_contrato_guardar(uuid,jsonb)', '20261030T2211_s01e_ficha');

-- ── 1 · bank_casar ──
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
  v_contrato uuid; v_fila date;
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
  -- S01e · La cuota de un contrato: el contrato (de esta empresa) y la fila del cuadro que paga.
  if v_tipo = 'contrato' and nullif(p_destino->>'contrato_id', '') is not null then
    select c.id into v_contrato from public.recurring_contract c
     where c.id = (p_destino->>'contrato_id')::uuid and c.company_id = v_m.company_id;
    if v_contrato is null then raise exception 'Ese contrato no es de esta empresa.' using errcode = '22023'; end if;
    v_fila := nullif(p_destino->>'fila', '')::date;
    if v_fila is not null then
      if not exists (select 1 from public.recurring_contract c, jsonb_array_elements(coalesce(c.schedule, '[]'::jsonb)) f
                      where c.id = v_contrato and (f->>'fecha')::date = v_fila) then
        raise exception 'El % no es una cuota del cuadro de ese contrato.', to_char(v_fila, 'DD/MM/YYYY') using errcode = '22023';
      end if;
      if exists (select 1 from public.bank_match bm where bm.contract_id = v_contrato and bm.contract_due_date = v_fila and bm.status = 'vivo') then
        raise exception 'La cuota del % de ese contrato ya está casada con otro cargo.', to_char(v_fila, 'DD/MM/YYYY') using errcode = '23505';
      end if;
    end if;
  end if;
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
                                 created_by, created_by_name, contract_id, contract_due_date)
  values (v_cuenta, v_m.company_id, v_m.id, v_tipo, v_entry, v_creado, v_m.amount, p_confianza, p_porque, p_por, p_regla, auth.uid(),
          case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end, v_contrato, v_fila)
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

-- ── 2 · bank_contrato_guardar ──
create or replace function public.bank_contrato_guardar(p_company uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account uuid; v_id uuid; v_kind text := p_datos->>'tipo'; v_cuadro jsonb := p_datos->'cuadro';
  v_importe numeric := nullif(p_datos->>'importe', '')::numeric; v_suma numeric; v_filas int; v_cuotas int;
  v_total int := nullif(p_datos->>'cuotas', '')::int; v_pendiente numeric := nullif(p_datos->>'pendiente', '')::numeric;
  v_banco uuid := nullif(p_datos->>'banco', '')::uuid; v_corto text := nullif(p_datos->>'capital_corto', '');
  v_largo text := nullif(p_datos->>'capital_largo', ''); v_int text := nullif(p_datos->>'intereses', '');
  v_contrato uuid := nullif(p_datos->>'contrato', '')::uuid; c public.recurring_contract; v_ultima date; v_nuevas int;
  v_aviso text;
  v_modo text := coalesce(nullif(p_datos->>'modo', ''), 'anadir'); v_amortizado numeric := coalesce(nullif(p_datos->>'amortizado', '')::numeric, 0);
  v_desde date; v_quedan jsonb; v_quedan_suma numeric; v_quitadas int; v_pagada date; v_resto numeric;
begin
  select account_id into v_account from public.company where id = p_company;
  if v_account is null or not public.current_user_is_admin_or_manager_of(v_account) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;

  -- ── Añadir las filas del año nuevo a un contrato que ya existe ──────────
  if v_contrato is not null then
    select * into c from public.recurring_contract where id = v_contrato and company_id = p_company;
    if c.id is null then raise exception 'Ese contrato no está.' using errcode = 'P0002'; end if;
    -- S01e · «Más acciones» de la ficha: cambiar las cuentas, lo que pone el banco o darlo por terminado.
    if v_modo = 'datos' then
      if exists (select 1 from unnest(array[v_corto, v_largo, v_int]) cu(code)
                  where cu.code is not null and not exists (select 1 from public.company_account a where a.company_id = p_company and a.code = cu.code)) then
        raise exception 'Alguna de las cuentas no está en el plan de la empresa.' using errcode = '22023';
      end if;
      if p_datos ? 'contiene' and coalesce(trim(p_datos->>'contiene'), '') = '' then
        raise exception 'Di qué pone el banco en el concepto de la cuota.' using errcode = '22023';
      end if;
      update public.recurring_contract set
             short_capital_account = coalesce(v_corto, short_capital_account), capital_account = coalesce(v_corto, capital_account),
             long_capital_account = case when p_datos ? 'capital_largo' then v_largo else long_capital_account end,
             interest_account = coalesce(v_int, interest_account),
             concept_contains = coalesce(nullif(trim(p_datos->>'contiene'), ''), concept_contains),
             is_active = case when p_datos ? 'activo' then (p_datos->>'activo')::boolean else is_active end
       where id = c.id returning * into c;
      return jsonb_build_object('id', c.id, 'mensaje', case when not c.is_active
        then format('«%s», dado por terminado: ya no sale en la lista ni casa cuotas.', c.name)
        else format('Guardado «%s»: capital a corto %s%s, intereses %s; el banco pone «%s».', c.name, coalesce(c.short_capital_account, c.capital_account),
          coalesce(', a largo ' || c.long_capital_account, ''), c.interest_account, c.concept_contains) end);
    end if;
    if c.kind = 'poliza' or c.principal is null then
      raise exception 'Una póliza no tiene cuadro: sus liquidaciones se reparten con la del banco.' using errcode = '22023';
    end if;
    if v_cuadro is null or jsonb_typeof(v_cuadro) <> 'array' or jsonb_array_length(v_cuadro) = 0 then
      raise exception 'Falta el cuadro: las fechas, las cuotas, el capital y los intereses.' using errcode = '22023';
    end if;
    -- S01e · Un préstamo con un cuadro nuevo (después de amortizar de golpe, o si el banco lo
    -- rehace): se van las cuotas desde la primera del cuadro nuevo y entran las suyas. Las pagadas
    -- no se tocan: si el cuadro nuevo empieza en una cuota ya pagada, no se cambia nada.
    if v_modo = 'sustituir' then
      if c.kind <> 'prestamo' then
        raise exception 'Cambiar las cuotas pendientes es para un préstamo: a un aplazamiento se le añaden las del año nuevo.' using errcode = '22023';
      end if;
      if v_amortizado < 0 then raise exception 'Lo amortizado de golpe no puede ser negativo.' using errcode = '22023'; end if;
      select min((f->>'fecha')::date) into v_desde from jsonb_array_elements(v_cuadro) f;
      select min(bm.contract_due_date) into v_pagada from public.bank_match bm
       where bm.contract_id = c.id and bm.status = 'vivo' and bm.contract_due_date >= v_desde;
      if v_pagada is not null then
        raise exception 'La cuota del % ya está pagada: el cuadro nuevo tiene que empezar después de ella.', to_char(v_pagada, 'DD/MM/YYYY') using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(f order by (f->>'fecha')::date), '[]'::jsonb), coalesce(round(sum((f->>'capital')::numeric), 2), 0)
        into v_quedan, v_quedan_suma from jsonb_array_elements(coalesce(c.schedule, '[]'::jsonb)) f where (f->>'fecha')::date < v_desde;
      v_quitadas := jsonb_array_length(coalesce(c.schedule, '[]'::jsonb)) - jsonb_array_length(v_quedan);
      select round(sum((f->>'capital')::numeric), 2), count(*) into v_suma, v_nuevas from jsonb_array_elements(v_cuadro) f;
      v_resto := round(c.principal - v_quedan_suma - v_amortizado, 2);
      -- La comprobación: lo prestado, menos el capital de las cuotas que se quedan y lo amortizado de golpe, es el capital del cuadro nuevo.
      if v_resto <> v_suma then
        raise exception 'Lo prestado (%) menos el capital de las % cuotas que se quedan (%) y lo amortizado de golpe (%) da %, y el capital del cuadro nuevo suma %: no cuadra, no lo cambio.',
          public.conta_impuesto_euros(c.principal), jsonb_array_length(v_quedan), public.conta_impuesto_euros(v_quedan_suma),
          public.conta_impuesto_euros(v_amortizado), public.conta_impuesto_euros(v_resto), public.conta_impuesto_euros(v_suma) using errcode = '22023';
      end if;
      v_cuadro := public.conta_cuadro_con_pendiente((select jsonb_agg(f - 'pendiente' order by (f->>'fecha')::date) from jsonb_array_elements(v_cuadro) f), v_resto);
      if v_amortizado > 0 then v_cuadro := jsonb_set(v_cuadro, '{0,amortizado_antes}', to_jsonb(v_amortizado)); end if;
      update public.recurring_contract set schedule = v_quedan || v_cuadro, installments = jsonb_array_length(v_quedan) + v_nuevas,
             amount = (v_cuadro->0->>'cuota')::numeric, document_name = coalesce(nullif(p_datos->>'documento', ''), document_name),
             document_uploaded_at = now()
       where id = c.id;
      return jsonb_build_object('id', c.id, 'mensaje', format('Cambiado el cuadro de «%s»: se van %s cuotas pendientes y entran %s. Desde el %s quedan %s de capital.',
        c.name, v_quitadas, v_nuevas, to_char(v_desde, 'DD/MM/YYYY'), public.conta_impuesto_euros(v_resto)));
    end if;
    if v_modo <> 'anadir' then raise exception 'Qué hago con el contrato: añadir las cuotas nuevas, cambiar las pendientes o sus datos.' using errcode = '22023'; end if;
    select max((f->>'fecha')::date) into v_ultima from jsonb_array_elements(coalesce(c.schedule, '[]'::jsonb)) f;
    -- Solo las filas de después de la última que tiene: subir otra vez el mismo cuadro no duplica nada.
    select coalesce(jsonb_agg(f order by (f->>'fecha')::date), '[]'::jsonb), count(*) into v_cuadro, v_nuevas
      from jsonb_array_elements(v_cuadro) f where v_ultima is null or (f->>'fecha')::date > v_ultima;
    if v_nuevas = 0 then
      raise exception 'Ese cuadro no trae ninguna cuota después de la última que ya tiene «%» (%): no añado nada.',
        c.name, to_char(v_ultima, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    v_cuadro := coalesce((select jsonb_agg(f - 'pendiente' order by (f->>'fecha')::date) from jsonb_array_elements(coalesce(c.schedule, '[]'::jsonb)) f), '[]'::jsonb) || v_cuadro;
    select round(sum((f->>'capital')::numeric), 2), count(*) into v_suma, v_filas from jsonb_array_elements(v_cuadro) f;
    v_cuotas := greatest(coalesce(c.installments, 0), v_filas);
    if v_filas < v_cuotas then
      if v_pendiente is null then
        raise exception 'Con las cuotas de este cuadro quedan % sin conocer: di la deuda pendiente que trae el cuadro, para comprobarlo.', v_cuotas - v_filas using errcode = '22023';
      end if;
      if round(c.principal - v_suma, 2) <> round(v_pendiente, 2) then
        raise exception 'Lo aplazado (%) menos el capital de las % cuotas conocidas (%) da %, y el cuadro dice que quedan %: no cuadra, no lo añado.',
          public.conta_impuesto_euros(c.principal), v_filas, public.conta_impuesto_euros(v_suma),
          public.conta_impuesto_euros(c.principal - v_suma), public.conta_impuesto_euros(v_pendiente) using errcode = '22023';
      end if;
    elsif v_suma <> round(c.principal, 2) then
      raise exception 'Con este cuadro están las % cuotas, y el capital suma % de los % aplazados: no cuadra, no lo añado.',
        v_filas, public.conta_impuesto_euros(v_suma), public.conta_impuesto_euros(c.principal) using errcode = '22023';
    end if;
    update public.recurring_contract set schedule = public.conta_cuadro_con_pendiente(v_cuadro, c.principal), installments = v_cuotas,
           document_name = coalesce(nullif(p_datos->>'documento', ''), document_name), document_uploaded_at = now()
     where id = c.id;
    v_aviso := case when v_filas < v_cuotas then format(' Faltan las cuotas de %s: sube el cuadro de ese año cuando llegue.',
      extract(year from (select max((f->>'fecha')::date) from jsonb_array_elements(v_cuadro) f))::int + 1) else '' end;
    return jsonb_build_object('id', c.id, 'mensaje', format('Añadidas %s cuotas a «%s»: ya tiene %s de %s.%s', v_nuevas, c.name, v_filas, v_cuotas, v_aviso));
  end if;

  -- ── Un contrato nuevo ─────────────────────────────────────────────────────
  if v_kind is null or v_kind not in ('prestamo', 'aplazamiento', 'poliza') then
    raise exception 'Di qué es: un préstamo, un aplazamiento o una póliza.' using errcode = '22023';
  end if;
  if coalesce(trim(p_datos->>'nombre'), '') = '' then raise exception 'Ponle un nombre al contrato.' using errcode = '22023'; end if;
  if coalesce(trim(p_datos->>'contiene'), '') = '' then
    raise exception 'Di qué pone el banco en el concepto de la cuota.' using errcode = '22023';
  end if;
  if v_corto is null or v_int is null then
    raise exception 'Faltan las cuentas: el capital a corto y los intereses.' using errcode = '22023';
  end if;
  if v_banco is not null and not exists (select 1 from public.treasury_account t where t.id = v_banco and t.company_id = p_company) then
    raise exception 'Ese banco no es de esta empresa.' using errcode = '22023';
  end if;
  -- Las cuentas, del plan de esta empresa (regla 9: nunca por nombre ni de otra cuenta).
  if exists (select 1 from unnest(array[v_corto, v_largo, v_int]) cu(code)
              where cu.code is not null and not exists (select 1 from public.company_account a where a.company_id = p_company and a.code = cu.code)) then
    raise exception 'Alguna de las cuentas no está en el plan de la empresa.' using errcode = '22023';
  end if;

  if v_kind <> 'poliza' then
    if v_cuadro is null or jsonb_typeof(v_cuadro) <> 'array' or jsonb_array_length(v_cuadro) = 0 then
      raise exception 'Falta el cuadro: las fechas, las cuotas, el capital y los intereses.' using errcode = '22023';
    end if;
    if v_importe is null then raise exception 'Falta el importe prestado o aplazado.' using errcode = '22023'; end if;
    select round(sum((f->>'capital')::numeric), 2), count(*) into v_suma, v_filas from jsonb_array_elements(v_cuadro) f;
    v_cuotas := greatest(coalesce(v_total, 0), v_filas);
    if v_filas < v_cuotas then
      -- Cuadro parcial: lo aplazado menos el capital de las filas leídas es la deuda pendiente del cuadro.
      if v_pendiente is null then
        raise exception 'El cuadro trae % de % cuotas: di la deuda pendiente que trae, para comprobarlo.', v_filas, v_cuotas using errcode = '22023';
      end if;
      if round(v_importe - v_suma, 2) <> round(v_pendiente, 2) then
        raise exception 'Lo aplazado (%) menos el capital de las % cuotas del cuadro (%) da %, y el cuadro dice que quedan %: no cuadra, no lo guardo.',
          public.conta_impuesto_euros(v_importe), v_filas, public.conta_impuesto_euros(v_suma),
          public.conta_impuesto_euros(v_importe - v_suma), public.conta_impuesto_euros(v_pendiente) using errcode = '22023';
      end if;
      v_aviso := format(' Faltan las cuotas de %s: sube el cuadro de ese año cuando llegue.',
        extract(year from (select max((f->>'fecha')::date) from jsonb_array_elements(v_cuadro) f))::int + 1);
    elsif v_suma <> round(v_importe, 2) then
      raise exception 'La suma del capital da % y lo aplazado es %: el cuadro no cuadra, no lo guardo.',
        public.conta_impuesto_euros(v_suma), public.conta_impuesto_euros(v_importe) using errcode = '22023';
    end if;
    v_cuadro := public.conta_cuadro_con_pendiente(v_cuadro, v_importe);
  end if;

  insert into public.recurring_contract (account_id, company_id, kind, name, concept_contains, amount, schedule, capital_account, interest_account,
    long_capital_account, short_capital_account, treasury_account_id, principal, installments, document_name, document_kind, created_by, created_by_name,
    document_uploaded_at)
  values (v_account, p_company, v_kind, trim(p_datos->>'nombre'), trim(p_datos->>'contiene'),
    case when v_kind = 'poliza' then null else (v_cuadro->0->>'cuota')::numeric end,
    case when v_kind = 'poliza' then null else v_cuadro end,
    v_corto, v_int, v_largo, v_corto, v_banco, v_importe, v_cuotas,
    nullif(p_datos->>'documento', ''), coalesce(nullif(p_datos->>'documento_tipo', ''), 'a_mano'), auth.uid(), public.conta_nombre_actor(),
    case when nullif(p_datos->>'documento', '') is not null then now() end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'mensaje', case when v_kind = 'poliza'
    then format('Guardada la póliza «%s»: sus liquidaciones se reparten con la del banco.', trim(p_datos->>'nombre'))
    else format('Guardado «%s»: %s cuotas, %s aplazados. Cada cuota se casará sola con su fila del cuadro.%s',
      trim(p_datos->>'nombre'), v_cuotas, public.conta_impuesto_euros(v_importe), coalesce(v_aviso, '')) end);
end $$;
revoke all on function public.bank_contrato_guardar(uuid, jsonb) from public, anon;
grant execute on function public.bank_contrato_guardar(uuid, jsonb) to authenticated;
comment on function public.bank_contrato_guardar(uuid, jsonb) is
  'S01d. Alta de un préstamo, aplazamiento o póliza desde «Subir el cuadro» (tablero 3). S01d-b: cuadro parcial (cuotas del texto y deuda pendiente) y añadir las filas del año nuevo a un contrato que ya existe. S01e: modo «sustituir» (las cuotas pendientes de un préstamo) y la fecha de subida del cuadro.';
