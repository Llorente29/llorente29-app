-- supabase/vuelta-atras/20261025T0917_pc01_motor_cambia.down.sql
--
-- Vuelta atrás de 20261025T0917_pc01_motor_cambia: los disparadores se quitan,
-- los dos CHECK vuelven a como estaban y cada función, como está en producción
-- antes de la tanda (pg_get_functiondef, 25/10), con la misma firma. No toca
-- datos: los pagos y cobros ya escritos se quedan (los quita la vuelta atrás de
-- la 0918, que va antes). Si queda un cobro negativo, el CHECK de antes no
-- entra y esto para: primero la vuelta atrás de la 0918.

drop trigger if exists pc01_liquidacion_cobrada on public.channel_settlement;
drop trigger if exists pc01_tienda_cambiada on public.platform_store;
drop trigger if exists pc01_factura_cierre_vence on public.customer_invoice;
drop trigger if exists pc01_factura_cierre_nace on public.customer_invoice;
drop trigger if exists pc01_recibida_vence on public.supplier_invoice;
drop trigger if exists pc01_recibida_pago_lote on public.supplier_invoice;
drop trigger if exists pc01_casado_item on public.bank_match_item;
drop trigger if exists pc01_casado_deshecho on public.bank_match;

alter table public.customer_invoice_payment drop constraint if exists customer_invoice_payment_amount_check;
alter table public.customer_invoice_payment add constraint customer_invoice_payment_amount_check check (amount > 0);
alter table public.bank_match_item drop constraint if exists bank_match_item_uno;
alter table public.bank_match_item add constraint bank_match_item_uno
  check (num_nonnulls(supplier_invoice_id, channel_settlement_id, other_movement_id, party_id, tax_return_id) >= 1);

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
        'local_id', v_local, 'comun', v_comun));
    end loop;
    if v_suma <> v_abs then raise exception 'Las líneas suman % y el movimiento es de %.', public.conta_euros_exactos(v_suma), public.conta_euros_exactos(v_abs) using errcode = '23514'; end if;
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
end $function$

;

CREATE OR REPLACE FUNCTION public.mark_supplier_invoice_paid(p_invoice_id uuid, p_paid_at date, p_method text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv supplier_invoice%rowtype; v_name text;
begin
  select * into v_inv from supplier_invoice where id = p_invoice_id for update;
  if not found or not belongs_to_account(v_inv.account_id) then raise exception 'No encuentro esa factura.'; end if;
  if v_inv.status not in ('aprobada','pagada') then
    raise exception 'Solo se puede marcar como pagada una factura aprobada.';
  end if;
  if p_paid_at is null then raise exception 'Falta la fecha de pago.'; end if;
  if p_method is not null and p_method not in ('transfer','direct_debit','card','cash','prepaid') then
    raise exception 'No conozco la forma de pago «%». Puede ser: Transferencia, Domiciliación, Tarjeta, Efectivo o Saldo prepago Catcher (40700001).', p_method;
  end if;
  v_name := _actor_name(v_inv.account_id);
  update supplier_invoice set status = 'pagada', paid_at = p_paid_at, paid_method = p_method,
         paid_by = auth.uid(), paid_by_name = v_name, updated_at = now()
   where id = p_invoice_id;
  insert into supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
  values (v_inv.account_id, p_invoice_id, 'paid', p_paid_at, p_method, auth.uid(), v_name);
end $function$

;

CREATE OR REPLACE FUNCTION public.unmark_supplier_invoice_paid(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv supplier_invoice%rowtype; v_name text;
begin
  select * into v_inv from supplier_invoice where id = p_invoice_id for update;
  if not found or not belongs_to_account(v_inv.account_id) then raise exception 'No encuentro esa factura.'; end if;
  if v_inv.status <> 'pagada' then raise exception 'Esa factura no está marcada como pagada.'; end if;
  v_name := _actor_name(v_inv.account_id);
  update supplier_invoice set status = 'aprobada', paid_at = null, paid_method = null,
         paid_by = null, paid_by_name = null, updated_at = now()
   where id = p_invoice_id;
  insert into supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
  values (v_inv.account_id, p_invoice_id, 'unpaid', v_inv.paid_at, v_inv.paid_method, auth.uid(), v_name);
end $function$

;

CREATE OR REPLACE FUNCTION public.journal_entry_anular(p_entry uuid, p_motivo text, p_fecha date DEFAULT NULL::date, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_e public.journal_entry; v_fecha date; v_y uuid; v_nuevo uuid; v_r jsonb; v_quien text; v_factura text; v_pago public.customer_invoice_payment;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_e.account_id) then
    raise exception 'Solo un administrador de la cuenta anula asientos.' using errcode = '42501';
  end if;
  if v_e.status <> 'validado' then
    raise exception 'Solo se anula un asiento validado (este está %).', v_e.status using errcode = '23514';
  end if;
  if v_e.source_type = 'reversal' then
    raise exception 'Un contraasiento no se anula: si hace falta, se hace el asiento bueno.' using errcode = '23514';
  end if;
  -- V01 entrega 2 (Julio, 24/10): el asiento de una factura emitida, o el de
  -- un cierre con su factura resumen, no se anula desde aquí: la factura
  -- quedaría viva sin su asiento. Se corrige desde la factura («Corregir»).
  select number_text into v_factura from public.customer_invoice where entry_id = v_e.id and status <> 'borrador' limit 1;
  if v_factura is not null then
    raise exception 'Este asiento es el de la factura %: no se anula desde Contabilidad. Se corrige desde la factura, con «Corregir».', v_factura using errcode = '23514';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Para anular hay que decir por qué.' using errcode = '23514';
  end if;
  v_quien := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_fecha := coalesce(p_fecha, greatest(v_e.entry_date, current_date));
  if public.conta_mes_cerrado(v_e.company_id, v_fecha) then
    v_fecha := public.conta_primer_dia_abierto(v_e.company_id, v_fecha);
  end if;
  select id into v_y from public.fiscal_year
   where company_id = v_e.company_id and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio abierto para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id,
                                    status, party_id, document_ref, document_date, reverses_entry_id, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_y, v_e.series, v_fecha,
          format('Anula %s nº %s: %s', case v_e.series when 1 then 'Ventas' when 2 then 'Compras' when 3 then 'Banco' when 9 then 'Nóminas' else 'General' end, v_e.number, trim(p_motivo)), 'reversal', v_e.id,
          'borrador', v_e.party_id, v_e.document_ref, v_e.document_date, v_e.id, auth.uid(), v_quien)
  returning id into v_nuevo;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                   location_id, is_common, brand_id, party_id, document_ref, document_date,
                                   tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model)
  select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
         location_id, is_common, brand_id, party_id, document_ref, document_date,
         tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model
    from public.journal_line where entry_id = v_e.id;
  v_r := public.journal_entry_validar(v_nuevo, v_quien);

  update public.journal_entry set status = 'anulado', voided_by_entry_id = v_nuevo, voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_quien, void_reason = trim(p_motivo)
   where id = v_e.id;
  -- V01: anular el asiento de un cobro en efectivo deshace ese cobro en su factura.
  select * into v_pago from public.customer_invoice_payment where entry_id = v_e.id;
  if v_pago.id is not null then
    delete from public.customer_invoice_payment where id = v_pago.id;
    perform public._conta_venta_evento(v_pago.invoice_id, 'cobro_anulado',
      'Cobro en efectivo de ' || to_char(v_pago.amount, 'FM999G999G990D00') || ' € anulado desde Contabilidad (asiento nº ' || v_e.number || '): ' || trim(p_motivo) || '.',
      jsonb_build_object('asiento', v_e.id, 'contraasiento', v_nuevo), v_quien);
  end if;
  return jsonb_build_object('anulado', v_e.id, 'contraasiento', v_nuevo, 'serie', v_r->'serie', 'numero', v_r->'numero', 'fecha', v_fecha);
end $function$

;

