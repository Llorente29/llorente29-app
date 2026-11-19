-- supabase/migrations/20261119T2040_r08_conciliar_valida.sql
--
-- R08 · 2 · Conciliar es el último paso (Julio, 19/11: «si he conciliado un movimiento
-- bancario no veo qué necesidad hay de confirmar luego otra vez»).
--
--   1. _bank_casar_nucleo (el texto de la 1310 del B01o, md5 9b90a7d3…, medido en staging y en
--      la base local) con un cambio: el asiento que crea o enlaza, si está propuesto, queda
--      VALIDADO en la misma transacción, lo concilie una persona, Sumied solo, una remesa o
--      un abono de pasarela (todos pasan por aquí). Si no se puede validar, no se concilia:
--      el error sube y no queda nada propuesto. Antes, solo lo «seguro» de Sumied y solo con
--      el ajuste validate_safe encendido. Y el movimiento apartado lo dice en palabras.
--   2. bank_deshacer (el texto de la 0110 del B01, md5 2bd49860…) con dos guardas: un asiento
--      validado que ya salió a ERP10, o que lleva IVA de un trimestre presentado, no se
--      deshace en silencio: lo dice en palabras. Lo demás, igual (un validado se anula con su
--      contraasiento, journal_entry_anular, el camino de la ficha del asiento del núcleo).
-- Misma firma las dos (create or replace, sin sobrecargas: regla 2). Las de antes, al
-- respaldo. Guarda: si no son las medidas, PARA antes de tocar nada.
-- No está en el camino del pedido.
-- sin hueco: el fichero no retira nada al aplicarse. El «delete from journal_entry» es el de
-- bank_deshacer de siempre (quita un asiento PROPUESTO de un casado que se deshace), sin cambios.
-- cambia: public._bank_casar_nucleo · prueba: supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
-- cambia: public.bank_deshacer · prueba: supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261119T2040_r08_conciliar_valida.down.sql

set local lock_timeout = '5s';

do $$ begin
  if md5(pg_get_functiondef('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure)) <> '9b90a7d302bebf86aa7ad582e41bf5e2' then
    raise exception 'R08 · 2040: _bank_casar_nucleo no es el medido (9b90a7d3): no se toca nada.';
  end if;
  if md5(pg_get_functiondef('public.bank_deshacer(uuid,text)'::regprocedure)) <> '2bd4986001f368ade6dd483b9b23dc54' then
    raise exception 'R08 · 2040: bank_deshacer no es el medido (2bd49860): no se toca nada.';
  end if;
end $$;

select public._respaldar_funcion('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', '20261119T2040_r08_conciliar_valida');
select public._respaldar_funcion('public.bank_deshacer(uuid,text)', '20261119T2040_r08_conciliar_valida');

-- ── 1 · Conciliar valida ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._bank_casar_nucleo(p_movement uuid, p_destino jsonb, p_confianza text, p_porque text, p_razones jsonb, p_por text, p_regla uuid)
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
  -- Sin guarda: la pone quien la llama (bank_casar, o la clave de servicio por el núcleo de casar).
  select account_id into v_cuenta from public.company where id = v_m.company_id;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if p_por not in ('folvy', 'persona') then raise exception 'Quién casa: folvy o persona.' using errcode = '23514'; end if;
  if p_confianza not in ('seguro', 'probable', 'duda') or coalesce(trim(p_porque), '') = '' then
    raise exception 'Todo casado lleva su confianza y su porqué.' using errcode = '23514';
  end if;
  if exists (select 1 from public.bank_match where movement_id = p_movement and status = 'vivo') then
    raise exception 'Este movimiento ya está casado: cada movimiento se casa una sola vez.' using errcode = '23505';
  end if;
  if v_m.status = 'ignorado' then raise exception '%', case when v_m.ignored_reason ilike 'Anulado por el banco%' then 'Este movimiento está apartado: el banco no lo cobró. Vuelve a abrirlo para conciliarlo.' else 'Este movimiento está apartado (' || coalesce(nullif(trim(v_m.ignored_reason), ''), 'sin motivo') || '). Vuelve a abrirlo para conciliarlo.' end using errcode = '23514'; end if;
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
      -- Cola 2 (02/11): nunca con una factura anulada o descartada (Olimpo, 30/10: una propuesta vieja casó un pago con el albarán anulado).
      if v_inv.status = 'anulada' or v_inv.discarded_at is not null then
        raise exception 'La factura % está %: no se casa un pago con ella. Vuelve a calcular la propuesta de este movimiento.',
          coalesce(v_inv.invoice_number, v_inv.code, ''), case when v_inv.status = 'anulada' then 'anulada' else 'descartada' end using errcode = '23514';
      end if;
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
        perform public._mark_supplier_invoice_paid_nucleo(v_inv.id, v_m.op_date, coalesce(p_destino->>'metodo', 'transfer'), case when auth.uid() is null then 'Sumied' end);
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

  -- R08 (Julio, 19/11): conciliar es el último paso. El asiento queda validado, en el diario,
  -- en esta misma transacción, lo case una persona o Sumied solo. Si no se puede validar (un
  -- periodo cerrado, por ejemplo), no se concilia: el error sube, en palabras, y no queda nada
  -- propuesto esperando otro botón.
  if exists (select 1 from public.journal_entry e where e.id = v_entry and e.status in ('propuesto', 'borrador')) then
    perform public._journal_entry_validar(v_entry, case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end);
    v_validado := true;
  end if;

  perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, case when v_creado then 'casado' else 'enlazado' end, p_por,
    p_porque, jsonb_build_object('tipo', v_tipo, 'asiento', v_entry, 'creado', v_creado, 'validado', v_validado, 'aviso', v_aviso));
  if v_validado then
    perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, 'validado', p_por, 'Conciliado: el asiento está en el diario', '{}'::jsonb);
  end if;
  if p_regla is not null then
    update public.bank_rule set last_used_at = now() where id = p_regla and company_id = v_m.company_id;
  end if;
  return jsonb_build_object('match', v_match, 'asiento', v_entry, 'creado', v_creado, 'validado', v_validado, 'aviso', v_aviso);
end $function$;

revoke all on function public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid) from public, anon, authenticated, service_role;

-- ── 2 · Deshacer avisa ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bank_deshacer(p_match uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_b public.bank_match; v_e public.journal_entry; v_que text; v_otros uuid[]; i record;
begin
  select * into v_b from public.bank_match where id = p_match for update;
  if v_b.id is null then raise exception 'Ese movimiento ya no está conciliado: vuelve a cargar.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_b.company_id);
  if v_b.status <> 'vivo' then raise exception 'Este movimiento ya está deshecho: vuelve a cargar.' using errcode = '23514'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Para deshacer hay que decir por qué.' using errcode = '23514'; end if;
  -- Un traspaso se deshace por los dos lados.
  select array_agg(id) into v_otros from public.bank_match where status = 'vivo' and kind = 'traspaso' and journal_entry_id = v_b.journal_entry_id and v_b.kind = 'traspaso';
  v_otros := coalesce(v_otros, array[v_b.id]);
  select * into v_e from public.journal_entry where id = v_b.journal_entry_id;
  if v_e.id is not null and (v_b.entry_created or v_b.kind = 'traspaso') and exists (select 1 from public.bank_match where id = any(v_otros) and entry_created) then
    if v_e.status in ('propuesto', 'borrador') then
      delete from public.journal_entry where id = v_e.id;  -- una propuesta no deja rastro en el libro; su rastro es este casado deshecho
      v_que := 'su asiento propuesto se quita';
    elsif v_e.status = 'validado' then
      -- R08: lo que ya salió a ERP10, o lleva IVA de un trimestre presentado, no se deshace en silencio.
      if exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = v_e.id and p.estado = 'salida') then
        raise exception 'No se deshace: el asiento %/% ya salió a ERP10. Si está mal, corrígelo allí y aquí con un asiento a mano.', v_e.series, v_e.number using errcode = '23514';
      end if;
      if public.conta_iva_presentado(v_e.company_id, v_e.entry_date) is not null and public._conta_asiento_lleva_iva(v_e.id) is not null then
        raise exception 'No se deshace: el asiento %/% lleva IVA y el trimestre del % ya está presentado.', v_e.series, v_e.number, to_char(v_e.entry_date, 'DD/MM/YYYY') using errcode = '23514';
      end if;
      perform public.journal_entry_anular(v_e.id, 'Deshecho en Bancos: ' || trim(p_motivo), current_date, public.conta_nombre_actor());
      v_que := format('su asiento %s/%s se anula con un contraasiento', v_e.series, v_e.number);
    end if;
  else
    v_que := 'el asiento enlazado se queda como estaba';
  end if;
  update public.bank_match set status = 'deshecho', undone_at = now(), undone_by = auth.uid(), undone_by_name = public.conta_nombre_actor(),
         undo_reason = trim(p_motivo) where id = any(v_otros);
  update public.bank_movement set status = 'pendiente', confidence = null, reason = null, proposal = null, updated_at = now()
   where id in (select movement_id from public.bank_match where id = any(v_otros));
  -- Lo que se puso fuera del banco por este casado, se quita.
  for i in select it.* from public.bank_match_item it where it.match_id = any(v_otros) loop
    if i.supplier_invoice_id is not null then
      if i.marked_by_bank and exists (select 1 from public.supplier_invoice where id = i.supplier_invoice_id and status = 'pagada') then
        perform public.unmark_supplier_invoice_paid(i.supplier_invoice_id);
      end if;
      update public.supplier_invoice set payment_entry_id = null where id = i.supplier_invoice_id and payment_entry_id = v_b.journal_entry_id;
    elsif i.channel_settlement_id is not null and i.marked_by_bank then
      perform public.channel_settlement_uncollect(i.channel_settlement_id);
    end if;
  end loop;
  perform public._bank_log(v_b.account_id, v_b.company_id, v_b.movement_id, v_b.id, null, 'deshecho', 'persona',
    'Deshecho: ' || trim(p_motivo) || ' (' || v_que || ')', jsonb_build_object('asiento', v_b.journal_entry_id));
  return jsonb_build_object('deshechos', to_jsonb(v_otros), 'asiento', v_que);
end $function$;
grant execute on function public.bank_deshacer(uuid, text) to authenticated;
