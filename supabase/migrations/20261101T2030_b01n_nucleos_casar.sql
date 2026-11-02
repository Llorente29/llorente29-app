-- supabase/migrations/20261101T2030_b01n_nucleos_casar.sql
-- cambia: public.bank_casar · prueba: supabase/staging/sql/20261101_b01n_nucleos_prueba.sql
-- cambia: public.conta_remesa_casar · prueba: supabase/staging/sql/20261101_b01n_nucleos_prueba.sql
-- cambia: public.mark_supplier_invoice_paid · prueba: supabase/staging/sql/20261101_b01n_nucleos_prueba.sql
--
-- B01 · PR 3a · LOS NÚCLEOS DE CASAR (decisión de Julio, 01/11). Para que el
-- cargo de un pago por el banco (Revolut) se case solo, con la clave de
-- servicio, sin abrir las guardas de Bancos y sin copiar la lógica de casar:
--
--   · Cada función que casa se parte en dos: un NÚCLEO sin guarda, que nadie
--     de fuera puede llamar (revoke a public, anon, authenticated y
--     service_role), y la
--     pública de siempre, que hace su guarda de siempre y llama a su núcleo.
--     Lo que hace la pública no cambia: la prueba de staging lo mide, antes =
--     después, con el mismo caso a los dos lados.
--       mark_supplier_invoice_paid → _mark_supplier_invoice_paid_nucleo
--       bank_casar                 → _bank_casar_nucleo
--       conta_remesa_casar         → _conta_remesa_casar_nucleo
--       journal_entry_validar      → ya lo tenía: _journal_entry_validar (S01 · PR 3)
--     Los núcleos se llaman entre ellos, nunca a una pública: dentro de un
--     casado la guarda ya se ha hecho una vez, a la entrada.
--   · conta_pago_casar_banco(p_salida), solo para la clave de servicio: el pago
--     que el banco ha pagado y su cargo, que es el movimiento de la misma
--     empresa y la misma cuenta que lleva el id del pago en el banco (Revolut:
--     reference_2 = «transacción:pata»), sin casar y por el importe exacto. Lo
--     casa con su remesa «banco» por el núcleo, como «folvy».
--
-- Las tres públicas de antes van al respaldo (_respaldar_funcion) y la vuelta
-- atrás las restaura de ahí (_restaurar_funcion).
--
-- El texto de cada núcleo es el de la función de producción del 01/11 (md5 de
-- pg_get_functiondef: bank_casar 0f253b11, conta_remesa_casar 57bb45e3,
-- mark_supplier_invoice_paid 927ffeee), con solo estos cambios:
--   · la guarda de la entrada, fuera (la empresa se lee, sin mirar quién llama);
--   · las llamadas a una pública, a su núcleo;
--   · sin sesión (la clave de servicio), quien marca pagada la factura es
--     «Sumied» (con sesión, su nombre, como siempre);
--   · conta_remesa_casar dice quién casa (persona, como siempre; o folvy).
--
-- Lo que NO cambia y se apunta: channel_settlement_collect (el cobro de una
-- liquidación de plataforma, dentro de bank_casar) sigue mirando la sesión.
-- Con la clave de servicio, casar una liquidación pararía. No es el camino de
-- una remesa ni de un pago, y no se ha tocado.
--
-- No está en el camino del pedido.

set local lock_timeout = '5s';

-- Las de antes, al respaldo (la vuelta atrás las restaura de ahí, byte a byte).
select public._respaldar_funcion('public.mark_supplier_invoice_paid(uuid,date,text)', '20261101T2030_b01n_nucleos_casar');
select public._respaldar_funcion('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)', '20261101T2030_b01n_nucleos_casar');
select public._respaldar_funcion('public.conta_remesa_casar(uuid,uuid,uuid[])', '20261101T2030_b01n_nucleos_casar');

-- ── 1 · mark_supplier_invoice_paid: su núcleo, y la pública con su guarda ──
CREATE OR REPLACE FUNCTION public._mark_supplier_invoice_paid_nucleo(p_invoice_id uuid, p_paid_at date, p_method text, p_quien_nombre text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv supplier_invoice%rowtype; v_name text; v_pagos numeric;
begin
  select * into v_inv from supplier_invoice where id = p_invoice_id for update;
  -- Sin guarda: la pone quien la llama (mark_supplier_invoice_paid, o la clave de servicio por el núcleo de casar).
  if not found then raise exception 'No encuentro esa factura.'; end if;
  if v_inv.status not in ('aprobada','pagada') then
    raise exception 'Solo se puede marcar como pagada una factura aprobada.';
  end if;
  if p_paid_at is null then raise exception 'Falta la fecha de pago.'; end if;
  if p_method is not null and p_method not in ('transfer','direct_debit','card','cash','prepaid') then
    raise exception 'No conozco la forma de pago «%». Puede ser: Transferencia, Domiciliación, Tarjeta, Efectivo o Saldo prepago Catcher (40700001).', p_method;
  end if;
  -- PC01 (Julio, 25/10): o hay un pago con asiento, o no está pagada. Solo la
  -- marcan pagada los pagos con asiento que la cubren (Bancos al casar, el pago
  -- del lote de prepago); a mano, no.
  select coalesce(sum(amount), 0) into v_pagos from supplier_invoice_payment where invoice_id = p_invoice_id and entry_id is not null;
  if v_pagos < coalesce(v_inv.grand_total, 0) - 0.005 then
    raise exception 'La factura % no se marca pagada a mano: queda pagada sola cuando su pago tiene asiento (al casarlo en Bancos). Lleva pagado con asiento % de %.',
      coalesce(v_inv.invoice_number, ''), public.conta_euros_exactos(v_pagos), public.conta_euros_exactos(coalesce(v_inv.grand_total, 0)) using errcode = '23514';
  end if;
  -- Sin sesión (la clave de servicio), el nombre lo da quien llama.
  v_name := coalesce(_actor_name(v_inv.account_id), p_quien_nombre);
  update supplier_invoice set status = 'pagada', paid_at = p_paid_at, paid_method = p_method,
         paid_by = auth.uid(), paid_by_name = v_name, updated_at = now()
   where id = p_invoice_id;
  insert into supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
  values (v_inv.account_id, p_invoice_id, 'paid', p_paid_at, p_method, auth.uid(), v_name);
end $function$;

CREATE OR REPLACE FUNCTION public.mark_supplier_invoice_paid(p_invoice_id uuid, p_paid_at date, p_method text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_acc uuid;
begin
  -- B01 · La guarda de siempre, y después el núcleo (una sola lógica).
  select account_id into v_acc from supplier_invoice where id = p_invoice_id;
  if not found or not belongs_to_account(v_acc) then raise exception 'No encuentro esa factura.'; end if;
  perform public._mark_supplier_invoice_paid_nucleo(p_invoice_id, p_paid_at, p_method, null);
end $function$;

-- ── 2 · bank_casar: su núcleo, y la pública con su guarda ──
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

  -- Lo seguro se valida solo si la empresa lo ha activado (apagado por defecto).
  if v_creado and p_confianza = 'seguro' and p_por = 'folvy' and v_aj.validate_safe then
    begin
      perform public._journal_entry_validar(v_entry, 'Folvy');
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

CREATE OR REPLACE FUNCTION public.bank_casar(p_movement uuid, p_destino jsonb, p_confianza text, p_porque text, p_razones jsonb, p_por text, p_regla uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_company uuid;
begin
  -- B01 · La guarda de siempre, y después el núcleo (una sola lógica).
  select company_id into v_company from public.bank_movement where id = p_movement;
  if not found then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_company);
  return public._bank_casar_nucleo(p_movement, p_destino, p_confianza, p_porque, p_razones, p_por, p_regla);
end $function$;

-- ── 3 · conta_remesa_casar: su núcleo, y la pública con su guarda ──
CREATE OR REPLACE FUNCTION public._conta_remesa_casar_nucleo(p_movement uuid, p_remesa uuid, p_lineas uuid[], p_por text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r public.conta_pago_remesa; v_m public.bank_movement; v_cuenta uuid; v_suma numeric := 0; v_lineas jsonb := '[]'::jsonb;
  v_res jsonb; v_match uuid; v_l record; v_inv public.supplier_invoice; v_n int := 0; v_pagadas int := 0; v_ids uuid[];
  v_entry uuid; v_total numeric; v_vivas int; v_sin_confirmar int; v_solo boolean := false; v_porque text;
begin
  select * into v_r from public.conta_pago_remesa where id = p_remesa for update;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  -- Sin guarda: la pone quien la llama (conta_remesa_casar, o conta_pago_casar_banco con la clave de servicio).
  select account_id into v_cuenta from public.company where id = v_r.company_id;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  select * into v_m from public.bank_movement where id = p_movement;
  if v_m.id is null or v_m.company_id <> v_r.company_id then raise exception 'Ese movimiento no es de la empresa de la remesa.' using errcode = '23514'; end if;
  if v_m.amount >= 0 then raise exception 'El cargo de una remesa sale del banco, y este movimiento entra.' using errcode = '23514'; end if;
  if v_r.kind = 'fichero' and v_r.file_at is null then raise exception 'El fichero de la remesa % no se ha descargado: el banco aún no la tiene.', v_r.code using errcode = '23514'; end if;
  select array_agg(id order by id) into v_ids from public.conta_pago_remesa_linea_estado
   where remesa_id = p_remesa and estado = 'pendiente' and (p_lineas is null or id = any(p_lineas));
  if v_ids is null then raise exception 'La remesa % no tiene pagos esperando el cargo.', v_r.code using errcode = '23514'; end if;
  if p_lineas is not null and cardinality(v_ids) <> cardinality(p_lineas) then raise exception 'Alguno de esos pagos no está esperando el cargo.' using errcode = '23514'; end if;
  -- Una línea del asiento por proveedor.
  for v_l in select l.supplier_id, s.name, public._pc01e2_cuenta_proveedor(v_r.company_id, l.supplier_id) as cuenta,
                    (select pr.party_id from public.party_role pr where pr.supplier_id = l.supplier_id and pr.role = 'supplier' limit 1) as tercero,
                    sum(l.amount) as importe, string_agg(coalesce(si.invoice_number, 'sin número'), ', ' order by si.invoice_date) as facturas
               from public.conta_pago_remesa_linea l join public.supplier_invoice si on si.id = l.invoice_id left join public.supplier s on s.id = l.supplier_id
              where l.id = any(v_ids) group by l.supplier_id, s.name loop
    if v_l.cuenta is null then raise exception '% no tiene su cuenta de proveedor (400) en el plan.', coalesce(v_l.name, 'Un proveedor') using errcode = '23514'; end if;
    v_suma := v_suma + v_l.importe;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_l.cuenta, 'importe', v_l.importe, 'tercero_id', v_l.tercero,
      'concepto', format('Pago remesa %s · %s · %s', v_r.code, coalesce(v_l.name, ''), v_l.facturas)));
  end loop;
  if abs(v_suma - abs(v_m.amount)) >= 0.005 then
    raise exception 'El cargo es de % y lo que espera la remesa % es %.', public.conta_euros_exactos(abs(v_m.amount)), v_r.code, public.conta_euros_exactos(v_suma) using errcode = '23514';
  end if;
  v_res := public._bank_casar_nucleo(p_movement, jsonb_build_object('tipo', 'cuenta', 'concepto', format('Pago remesa %s', v_r.code), 'lineas', v_lineas),
    'seguro', format('Es el cargo de la remesa %s: %s.', v_r.code, public.conta_euros_exactos(v_suma)), '[]'::jsonb, p_por, null);
  select id into v_match from public.bank_match where movement_id = p_movement and status = 'vivo';
  -- Cada factura con lo que paga: el disparador del casado apunta su pago con este asiento.
  for v_l in select l.id, l.invoice_id, l.amount from public.conta_pago_remesa_linea l where l.id = any(v_ids) loop
    select * into v_inv from public.supplier_invoice where id = v_l.invoice_id for update;
    insert into public.bank_match_item (account_id, match_id, supplier_invoice_id, amount, marked_by_bank)
    values (v_cuenta, v_match, v_inv.id, v_l.amount, false);
    update public.conta_pago_remesa_linea set bank_match_id = v_match where id = v_l.id;
    update public.supplier_invoice set payment_entry_id = coalesce(payment_entry_id, (select journal_entry_id from public.bank_match where id = v_match)) where id = v_inv.id;
    if v_inv.status = 'aprobada' and coalesce((select sum(amount) from public.supplier_invoice_payment where invoice_id = v_inv.id and entry_id is not null), 0) >= coalesce(v_inv.grand_total, 0) - 0.005 then
      perform public._mark_supplier_invoice_paid_nucleo(v_inv.id, v_m.op_date, 'transfer', case when auth.uid() is null then 'Sumied' end);
      update public.bank_match_item set marked_by_bank = true where match_id = v_match and supplier_invoice_id = v_inv.id;
      v_pagadas := v_pagadas + 1;
    end if;
    v_n := v_n + 1;
  end loop;
  perform public._pc01e2_evento(v_cuenta, p_remesa, null, format('Llega el cargo del %s en el banco: %s %s casados, %s %s.',
    to_char(v_m.op_date, 'DD/MM/YYYY'), v_n, case when v_n = 1 then 'pago' else 'pagos' end, v_pagadas, case when v_pagadas = 1 then 'factura pagada' else 'facturas pagadas' end));

  -- Respuesta 7 · El asiento se valida solo, y solo si: es una remesa de
  -- transferencias, el cargo es su total entero al céntimo (todos sus pagos
  -- en este cargo, ninguno casado antes), cada IBAN está comprobado (el mismo
  -- de pagos anteriores) o confirmado por alguien, y el asiento pasa las reglas
  -- de validar (cuadra, mes abierto, local…). Si no, queda en «Por validar».
  select journal_entry_id into v_entry from public.bank_match where id = v_match;
  select total, vivas into v_total, v_vivas from public.conta_pago_remesa_estado where id = p_remesa;
  select count(*) into v_sin_confirmar from public.conta_pago_remesa_linea
   where id = any(v_ids) and not (iban_check = 'comprobado' or iban_confirmed_at is not null);
  v_porque := case
    when v_r.kind <> 'fichero' then 'es un pago a mano'
    when p_lineas is not null or cardinality(v_ids) <> v_vivas then 'el banco ha cargado solo una parte de la remesa'
    when abs(v_m.amount) <> v_total then 'el cargo no es el total de la remesa'
    when v_sin_confirmar > 0 then format('%s IBAN sin confirmar', v_sin_confirmar)
    when v_entry is null then 'no hay asiento'
    when exists (select 1 from public.journal_entry where id = v_entry and status not in ('propuesto', 'borrador')) then null
    else (select m.motivo from public.conta_motivos_para_validar(v_entry) m order by m.orden limit 1)
  end;
  if v_porque is null and v_entry is not null and exists (select 1 from public.journal_entry where id = v_entry and status in ('propuesto', 'borrador')) then
    perform public._journal_entry_validar(v_entry, format('%s · el cargo cuadra con la remesa %s', coalesce(public.conta_nombre_actor(), 'Sumied'), v_r.code));
    update public.conta_pago_remesa set validated_solo_at = now(), validated_solo_entry = v_entry where id = p_remesa;
    perform public._pc01e2_evento(v_cuenta, p_remesa, null, 'Asiento validado solo: el cargo cuadra con la remesa.');
    v_solo := true;
  end if;

  return jsonb_build_object('casado', v_match, 'pagos', v_n, 'pagadas', v_pagadas, 'validado_solo', v_solo,
    'frase', format('Casado con la remesa %s: %s %s, %s. %s %s %s.', v_r.code, v_n, case when v_n = 1 then 'pago' else 'pagos' end,
      public.conta_euros_exactos(v_suma), v_pagadas, case when v_pagadas = 1 then 'factura queda pagada' else 'facturas quedan pagadas' end,
      case when v_solo then 'y su asiento validado solo: el cargo cuadra con la remesa'
           else format('con su asiento propuesto, en «Por validar» (no se valida solo: %s)', coalesce(v_porque, 'ya estaba validado')) end));
end $function$;

CREATE OR REPLACE FUNCTION public.conta_remesa_casar(p_movement uuid, p_remesa uuid, p_lineas uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_company uuid;
begin
  -- B01 · La guarda de siempre, y después el núcleo (una sola lógica).
  select company_id into v_company from public.conta_pago_remesa where id = p_remesa;
  if not found then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  perform public._pc01e2_empresa(v_company);
  return public._conta_remesa_casar_nucleo(p_movement, p_remesa, p_lineas, 'persona');
end $function$;

-- ── 4 · Nadie de fuera llama a un núcleo ──
-- También a la clave de servicio: Supabase le da «execute» por defecto en cada función nueva. A un núcleo
-- solo se llega desde dentro de la base; la entrada de la clave de servicio es conta_pago_casar_banco.
revoke all on function public._mark_supplier_invoice_paid_nucleo(uuid, date, text, text) from public, anon, authenticated, service_role;
revoke all on function public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public._conta_remesa_casar_nucleo(uuid, uuid, uuid[], text) from public, anon, authenticated, service_role;
comment on function public._mark_supplier_invoice_paid_nucleo(uuid, date, text, text) is
  'B01 · El núcleo de mark_supplier_invoice_paid, sin guarda: solo desde dentro de la base (los núcleos de casar). La guarda la pone mark_supplier_invoice_paid.';
comment on function public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid) is
  'B01 · El núcleo de bank_casar, sin guarda: solo desde dentro de la base. La guarda la pone bank_casar (persona) o conta_pago_casar_banco (clave de servicio).';
comment on function public._conta_remesa_casar_nucleo(uuid, uuid, uuid[], text) is
  'B01 · El núcleo de conta_remesa_casar, sin guarda: solo desde dentro de la base. La guarda la pone conta_remesa_casar (persona) o conta_pago_casar_banco (clave de servicio).';

-- ── 5 · El cargo de un pago por el banco, casado solo (clave de servicio) ──
create or replace function public.conta_pago_casar_banco(p_salida uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.conta_pago_salida; v_l public.conta_pago_lote; v_e text; v_n int; v_movs uuid[]; v_r jsonb;
begin
  select * into v_s from public.conta_pago_salida where id = p_salida;
  if v_s.id is null then raise exception 'Ese pago no existe.' using errcode = 'P0002'; end if;
  if v_s.estado <> 'pagada' or v_s.banco_id is null or v_s.remesa_id is null or v_s.remesa_linea_id is null then
    return jsonb_build_object('casado', false, 'porque', 'El banco aún no lo ha pagado.');
  end if;
  select estado into v_e from public.conta_pago_remesa_linea_estado where id = v_s.remesa_linea_id;
  if v_e is distinct from 'pendiente' then
    return jsonb_build_object('casado', false, 'porque', format('El pago ya no espera su cargo (está %s).', coalesce(v_e, 'sin su línea')));
  end if;
  select * into v_l from public.conta_pago_lote where id = v_s.lote_id;
  -- El cargo: de la misma empresa y cuenta, con el id del pago en el banco, el
  -- importe exacto y sin casar. Ni la comisión ni una devolución (sus ids llevan
  -- «:comision» o «:vuelta»).
  select array_agg(m.id order by m.id) into v_movs from public.bank_movement m
   where m.company_id = v_s.company_id and m.treasury_account_id = v_l.treasury_account_id
     and split_part(coalesce(m.reference_2, ''), ':', 1) = v_s.banco_id and m.reference_2 !~ ':(comision|vuelta)'
     and m.amount = -v_s.amount and m.status not in ('ignorado', 'posible_repetido')
     and not exists (select 1 from public.bank_match b where b.movement_id = m.id and b.status = 'vivo');
  v_n := coalesce(cardinality(v_movs), 0);
  if v_n = 0 then return jsonb_build_object('casado', false, 'porque', 'El cargo aún no ha llegado del banco.'); end if;
  if v_n > 1 then return jsonb_build_object('casado', false, 'porque', format('Hay %s cargos con el id de este pago: cásalo a mano en Bancos.', v_n)); end if;
  v_r := public._conta_remesa_casar_nucleo(v_movs[1], v_s.remesa_id, array[v_s.remesa_linea_id], 'folvy');
  -- El núcleo dice en «casado» el id del casado: aquí «casado» es sí o no, y el id va en «match».
  return v_r || jsonb_build_object('casado', true, 'match', v_r->>'casado', 'movimiento', v_movs[1]);
end $$;
revoke all on function public.conta_pago_casar_banco(uuid) from public, anon, authenticated;
grant execute on function public.conta_pago_casar_banco(uuid) to service_role;
comment on function public.conta_pago_casar_banco(uuid) is
  'B01 · PR 3a · Solo la clave de servicio: casa solo el cargo de un pago que el banco ha pagado (el movimiento con su id del banco, el importe exacto y sin casar) con su remesa «banco», por el núcleo de casar.';
