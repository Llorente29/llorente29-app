-- supabase/migrations/20261123T0920_k10c_varios_pagos.sql
--
-- K10c · Varios pagos de una factura recibida, como ERP10 (el ⊕ del bloque «Pago factura»). Lo que ya había (medido el
-- 23/11): supplier_invoice_payment guarda N pagos por factura con su asiento (PC01), el tope no deja que pasen del total
-- (tg_invoice_payment_tope), y conta_recibida_pago da lo pendiente y el estado (por pagar, pagada en parte, pagada…).
-- Todo lo que paga desde fuera ya escribe ahí: Bancos al casar (R08), las remesas, la liquidación de la plataforma, el
-- abono que compensa y el K06. Este fichero solo AÑADE lo que faltaba; nada que exista cambia, y el pago de hoy (el
-- primero) se queda con su asiento y su huella:
--
--   1. conta_recibida_pago_apuntar(empresa, factura, cuenta, fecha, importe, concepto, quién): un pago POR UN IMPORTE con
--      una cuenta que no es del banco (el K06 pagaba siempre lo que quedaba). Su asiento, validado, como el del K06:
--      serie 4, Debe la subcuenta del proveedor / Haber la cuenta del pago. El de un banco, una tarjeta o la caja sigue
--      por conta_pago_a_mano (que ya admite un importe): espera el cargo y nace al casarlo.
--   2. conta_recibida_pago_se_puede_cambiar(pago): si se puede cambiar o borrar y, si no, por qué. Solo un pago apuntado
--      con su asiento propio (no uno casado en el banco, ni el de una liquidación o una remesa: se deshacen allí), con el
--      IVA de su trimestre sin presentar, su mes y su ejercicio abiertos, sin salir a Diez ni a ERP10 y la cadena íntegra.
--   3. conta_recibida_pago_cambiar(pago, cuenta, fecha, importe, concepto, quién): el pago y su asiento, con el MISMO
--      número (como el X26): los candados de «inalterable» quitados solo en la transacción, la cadena vuelta a encadenar
--      y comprobada. El tope sigue mandando (no pasa del total).
--   4. conta_recibida_pago_borrar(pago, motivo, quién): quita el pago y borra su asiento con el «Borrar» del S01q
--      (_conta_asientos_borrar: respaldo, la serie renumerada sin huecos y la cadena comprobada) (Julio, 23/11).
-- Al cambiar o borrar, la factura vuelve a «pagada en parte» o «por pagar» si ya no está cubierta, y queda en su
-- historial (supplier_invoice_change).
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita las cuatro funciones.

-- 1 · Apuntar un pago por un importe ---------------------------------------------------------------------------------
create or replace function public.conta_recibida_pago_apuntar(p_company uuid, p_invoice uuid, p_cuenta text, p_fecha date, p_importe numeric,
                                                              p_concepto text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_cuenta uuid := public._pc01e2_empresa(p_company);
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'Sumied');
  v_inv public.supplier_invoice; v_s public.supplier; v_prov text; v_ca public.company_account;
  v_pend numeric; v_imp numeric := round(coalesce(p_importe, 0), 2); v_party uuid; v_pago uuid; v_r jsonb; v_entry uuid; v_val jsonb;
  v_numero text; v_concepto text; v_nombre text; v_queda numeric;
begin
  if p_fecha is null then raise exception 'Falta el día del pago.' using errcode = '22023'; end if;
  if p_fecha > public.conta_hoy() then
    raise exception 'El pago es de un día que aún no ha llegado (%): queda pendiente de pagar.', to_char(p_fecha, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select * into v_inv from public.supplier_invoice where id = p_invoice and account_id = v_cuenta for update;
  if v_inv.id is null or coalesce(v_inv.company_id, p_company) <> p_company then raise exception 'Esa factura no es de la empresa.' using errcode = '23514'; end if;
  v_numero := coalesce(v_inv.invoice_number, 'sin número');
  if v_inv.status <> 'aprobada' then raise exception 'La factura % no está por pagar (está %).', v_numero, v_inv.status using errcode = '23514'; end if;
  if v_inv.payment_method is not distinct from 'compensation' then
    raise exception 'La factura % se paga con su liquidación (compensación): no con otra cuenta.', v_numero using errcode = '23514';
  end if;
  select * into v_s from public.supplier where id = v_inv.supplier_id;
  v_prov := public._pc01e2_cuenta_proveedor(p_company, v_s.id);
  if v_prov is null then
    raise exception '% no tiene su cuenta de proveedor (400) en el plan: sin ella el pago no tendría asiento.', coalesce(v_s.name, 'Su proveedor') using errcode = '23514';
  end if;
  select * into v_ca from public.company_account where company_id = p_company and code = btrim(coalesce(p_cuenta, ''));
  if v_ca.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(p_cuenta), ''), '(vacía)') using errcode = '23514'; end if;
  if v_ca.kind = 'group' then raise exception 'La % es un grupo del plan: elige una subcuenta.', v_ca.code using errcode = '23514'; end if;
  if v_ca.code = v_prov then raise exception 'La % es la del proveedor: no es una cuenta de pago.', v_ca.code using errcode = '23514'; end if;
  if exists (select 1 from public.company_account_link l where l.company_id = p_company and l.entity = 'bank_account' and l.company_account_id = v_ca.id) then
    raise exception 'La % es de un banco, una tarjeta o la caja: ese pago espera el cargo y se casa en Bancos.', v_ca.code using errcode = '23514';
  end if;
  select pendiente into v_pend from public.conta_recibida_pago where invoice_id = v_inv.id;
  v_pend := round(coalesce(v_pend, 0) - public._pc01e2_en_remesa(v_inv.id), 2);
  if v_imp <= 0 then raise exception 'El importe del pago tiene que ser mayor que cero.' using errcode = '22023'; end if;
  if v_imp > v_pend + 0.005 then
    raise exception 'A la factura % le quedan % por pagar: este pago de % pasa del total.', v_numero,
      public.conta_euros_exactos(greatest(v_pend, 0)), public.conta_euros_exactos(v_imp) using errcode = '23514';
  end if;

  select party_id into v_party from public.party_role where account_id = v_cuenta and supplier_id = v_s.id and role = 'supplier' order by created_at limit 1;
  v_nombre := coalesce(nullif(v_ca.plain_name, ''), v_ca.name);
  v_concepto := coalesce(nullif(btrim(p_concepto), ''), 'Pago factura ' || v_numero);
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by, created_by_name)
  values (v_cuenta, p_company, v_inv.id, p_fecha, v_imp, null, format('Pagada con la %s (%s): %s', v_ca.code, v_nombre, v_concepto), auth.uid(), v_quien)
  returning id into v_pago;
  v_r := public._journal_entry_proponer(p_company,
    jsonb_build_object('series', 4, 'fecha', p_fecha, 'source_type', 'supplier_payment', 'source_id', v_pago,
      'concepto', v_concepto, 'party_id', v_party, 'documento', v_inv.invoice_number, 'fecha_documento', v_inv.invoice_date,
      'confianza', 'seguro', 'porque', format('Pago de la factura con la %s.', v_ca.code)),
    jsonb_build_array(
      jsonb_build_object('cuenta', v_prov, 'tercero_id', v_party, 'documento', v_inv.invoice_number, 'concepto', v_concepto, 'debe', v_imp, 'haber', 0, 'comun', true),
      jsonb_build_object('cuenta', v_ca.code, 'documento', v_inv.invoice_number, 'concepto', v_concepto, 'debe', 0, 'haber', v_imp, 'comun', true)),
    null, v_quien, auth.uid());
  v_entry := nullif(v_r->>'id', '')::uuid;
  if v_entry is null then raise exception 'El asiento del pago no se ha podido proponer (%).', v_r using errcode = '23514'; end if;
  v_val := public.journal_entry_validar(v_entry, v_quien);
  update public.supplier_invoice_payment set entry_id = v_entry where id = v_pago;
  v_queda := round(v_pend - v_imp, 2);
  if v_queda < 0.005 then perform public.mark_supplier_invoice_paid(v_inv.id, p_fecha, null); end if;
  return jsonb_build_object('pago', v_pago, 'asiento', v_entry, 'serie', 4, 'numero', v_val->'numero', 'importe', v_imp, 'cuenta', v_ca.code, 'pendiente', greatest(v_queda, 0),
    'frase', format('Pago apuntado con la %s (%s): %s el %s, asiento 4 / %s. La factura %s %s.',
      v_ca.code, v_nombre, public.conta_euros_exactos(v_imp), to_char(p_fecha, 'DD/MM/YYYY'), v_val->>'numero', v_numero,
      case when v_queda < 0.005 then 'queda pagada' else format('queda pagada en parte: faltan %s', public.conta_euros_exactos(v_queda)) end));
end $function$;
comment on function public.conta_recibida_pago_apuntar(uuid, uuid, text, date, numeric, text, text) is
  'K10c · Un pago de una recibida validada, POR UN IMPORTE, con una cuenta que no es del banco: su asiento validado (serie 4, Debe 400 / Haber la cuenta), su fila en supplier_invoice_payment y, si queda cubierta, la factura pagada. No pasa de lo pendiente.';
revoke all on function public.conta_recibida_pago_apuntar(uuid, uuid, text, date, numeric, text, text) from public, anon;
grant execute on function public.conta_recibida_pago_apuntar(uuid, uuid, text, date, numeric, text, text) to authenticated, service_role;

-- La factura, según lo que la cubre: pagada si sus pagos llegan al total; si no, aprobada (por pagar o pagada en parte).
create or replace function public._conta_k10c_estado(p_invoice uuid, p_quien text)
returns void language plpgsql security definer set search_path = public as $function$
declare v_inv public.supplier_invoice; v_pagado numeric; v_ultimo date;
begin
  select * into v_inv from public.supplier_invoice where id = p_invoice for update;
  select coalesce(sum(amount), 0), max(paid_on) into v_pagado, v_ultimo from public.supplier_invoice_payment where invoice_id = p_invoice and entry_id is not null;
  if v_inv.status = 'pagada' and v_pagado < coalesce(v_inv.grand_total, 0) - 0.005 then
    update public.supplier_invoice set status = 'aprobada', paid_at = null, paid_method = null, paid_by = null, paid_by_name = null, updated_at = now() where id = p_invoice;
    insert into public.supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
    values (v_inv.account_id, p_invoice, 'unpaid', v_inv.paid_at, v_inv.paid_method, auth.uid(), p_quien);
  elsif v_inv.status = 'aprobada' and v_pagado >= coalesce(v_inv.grand_total, 0) - 0.005 and coalesce(v_inv.grand_total, 0) <> 0 then
    perform public.mark_supplier_invoice_paid(p_invoice, v_ultimo, null);
  end if;
end $function$;
revoke all on function public._conta_k10c_estado(uuid, text) from public, anon, authenticated;

-- 2 · ¿Se puede cambiar o borrar? --------------------------------------------------------------------------------------
create or replace function public.conta_recibida_pago_se_puede_cambiar(p_pago uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare p public.supplier_invoice_payment; e public.journal_entry; y public.fiscal_year; v_p jsonb; v_no text;
begin
  select * into p from public.supplier_invoice_payment where id = p_pago;
  if p.id is null or not public.belongs_to_account(p.account_id) then return jsonb_build_object('puede', false, 'porque', 'Ese pago no está.'); end if;
  if p.bank_match_id is not null then
    return jsonb_build_object('puede', false, 'porque', 'Este pago está conciliado con un movimiento del banco: se deshace en Bancos.');
  end if;
  select * into e from public.journal_entry where id = p.entry_id;
  if e.id is null or e.source_type <> 'supplier_payment' or e.source_id is distinct from p.id then
    return jsonb_build_object('puede', false, 'porque', 'Este pago viene de una remesa, una liquidación o un abono: se deshace allí.');
  end if;
  if not public.current_user_is_admin_or_manager_of(p.account_id) then v_no := 'Solo un administrador o un encargado de la cuenta cambia un pago.'; end if;
  if v_no is null then
    v_p := public.conta_iva_presentado(e.company_id, e.entry_date);
    if v_p is not null then
      v_no := format('El IVA del %s ya está presentado: este pago no se cambia.', case when v_p->>'periodo' ~ 'T$' then v_p->>'periodo' else 'mes ' || (v_p->>'periodo') end);
    end if;
  end if;
  if v_no is null then
    select * into y from public.fiscal_year where id = e.fiscal_year_id;
    if y.status is distinct from 'open' then v_no := format('El ejercicio %s está cerrado: este pago no se cambia.', coalesce(y.code, '')); end if;
  end if;
  if v_no is null and public.conta_mes_cerrado(e.company_id, e.entry_date) then
    v_no := format('El mes de %s está cerrado: reábrelo antes de cambiar este pago.', to_char(e.entry_date, 'MM/YYYY'));
  end if;
  if v_no is null and exists (select 1 from public.external_send x where x.entry_id = e.id and x.status in ('enviado', 'enlazado')) then
    v_no := 'Su asiento ya salió a Diez o a ERP10: se cambia allí, no aquí.';
  end if;
  if v_no is null and public._conta_cadena_rota(e.company_id) <> 0 then
    v_no := 'La cadena de huellas de la empresa ya estaba rota: no se cambia nada hasta arreglarla.';
  end if;
  return jsonb_build_object('puede', v_no is null, 'porque', v_no, 'asiento', e.id, 'serie', e.series, 'numero', e.number);
end $function$;
comment on function public.conta_recibida_pago_se_puede_cambiar(uuid) is
  'K10c · Si un pago de una recibida se puede cambiar o borrar y, si no, por qué (conciliado en el banco, de una remesa o una liquidación, IVA presentado, ejercicio o mes cerrado, ya en Diez o ERP10, cadena rota, sin permiso).';
revoke all on function public.conta_recibida_pago_se_puede_cambiar(uuid) from public, anon;
grant execute on function public.conta_recibida_pago_se_puede_cambiar(uuid) to authenticated, service_role;

-- 3 · Cambiar: el pago y su asiento, con el mismo número ---------------------------------------------------------------
create or replace function public.conta_recibida_pago_cambiar(p_pago uuid, p_cuenta text, p_fecha date, p_importe numeric,
                                                              p_concepto text default null, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  p public.supplier_invoice_payment; e public.journal_entry; y public.fiscal_year; v_inv public.supplier_invoice; v_se jsonb; v_quien text;
  v_ca public.company_account; v_prov text; v_imp numeric := round(coalesce(p_importe, 0), 2); v_concepto text; v_lp public.journal_line; v_lc public.journal_line;
  v_canon text; v_prev text; r record; v_antes jsonb; v_iva jsonb;
begin
  select * into p from public.supplier_invoice_payment where id = p_pago for update;
  v_se := public.conta_recibida_pago_se_puede_cambiar(p_pago);
  if not coalesce((v_se->>'puede')::boolean, false) then raise exception '%', v_se->>'porque' using errcode = '23514'; end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  select * into e from public.journal_entry where id = p.entry_id for update;
  select * into v_inv from public.supplier_invoice where id = p.invoice_id for update;
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || e.company_id, 0));
  if p_fecha is null or p_fecha > public.conta_hoy() then raise exception 'El día del pago falta o aún no ha llegado.' using errcode = '22023'; end if;
  select * into y from public.fiscal_year where id = e.fiscal_year_id;
  if p_fecha not between y.starts_on and y.ends_on then
    raise exception 'El % no es del ejercicio %: el pago no cambia de ejercicio.', to_char(p_fecha, 'DD/MM/YYYY'), y.code using errcode = '22023';
  end if;
  if p_fecha <> e.entry_date then
    v_iva := public.conta_iva_presentado(e.company_id, p_fecha);
    if v_iva is not null then raise exception 'El IVA del % ya está presentado: el pago no va a esa fecha.', v_iva->>'periodo' using errcode = '23514'; end if;
    if public.conta_mes_cerrado(e.company_id, p_fecha) then raise exception 'El mes de % está cerrado: el pago no va a esa fecha.', to_char(p_fecha, 'MM/YYYY') using errcode = '23514'; end if;
  end if;
  if v_imp <= 0 then raise exception 'El importe del pago tiene que ser mayor que cero.' using errcode = '22023'; end if;
  v_prov := public._pc01e2_cuenta_proveedor(e.company_id, v_inv.supplier_id);
  select * into v_ca from public.company_account where company_id = e.company_id and account_id = e.account_id and code = btrim(coalesce(p_cuenta, ''));
  if v_ca.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(p_cuenta), ''), '(vacía)') using errcode = '23514'; end if;
  if v_ca.kind = 'group' then raise exception 'La % es un grupo del plan: elige una subcuenta.', v_ca.code using errcode = '23514'; end if;
  if v_ca.code = v_prov then raise exception 'La % es la del proveedor: no es una cuenta de pago.', v_ca.code using errcode = '23514'; end if;
  if exists (select 1 from public.company_account_link l where l.company_id = e.company_id and l.entity = 'bank_account' and l.company_account_id = v_ca.id) then
    raise exception 'La % es de un banco, una tarjeta o la caja: ese pago espera el cargo y se casa en Bancos.', v_ca.code using errcode = '23514';
  end if;
  v_concepto := coalesce(nullif(btrim(p_concepto), ''), e.concept);
  -- Las dos líneas del asiento del pago: la del proveedor (al debe) y la de la cuenta (al haber).
  select l.* into v_lp from public.journal_line l join public.company_account c on c.id = l.company_account_id where l.entry_id = e.id and c.code = v_prov and l.debit > 0;
  select l.* into v_lc from public.journal_line l where l.entry_id = e.id and l.credit > 0 and l.id <> coalesce(v_lp.id, '00000000-0000-0000-0000-000000000000');
  if v_lp.id is null or v_lc.id is null or (select count(*) from public.journal_line where entry_id = e.id) <> 2 then
    raise exception 'El asiento %/% del pago no es el de siempre (proveedor al debe y la cuenta al haber): no se cambia aquí.', e.series, e.number using errcode = '23514';
  end if;
  v_antes := jsonb_build_object('fecha', p.paid_on, 'importe', p.amount, 'cuenta', (select code from public.company_account where id = v_lc.company_account_id), 'concepto', e.concept);

  -- El pago (el tope sigue mandando: no pasa del total).
  update public.supplier_invoice_payment set amount = v_imp, paid_on = p_fecha,
         note = format('Pagada con la %s (%s): %s', v_ca.code, coalesce(nullif(v_ca.plain_name, ''), v_ca.name), v_concepto) where id = p.id;

  -- Su asiento, con el mismo número: solo en esta transacción, sin los candados de «inalterable» (como el X26).
  v_canon := public.journal_entry_canonico(e.id);
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  alter table public.journal_line disable trigger trg_journal_line_inalterable;
  update public.journal_entry set entry_date = p_fecha, concept = v_concepto, updated_at = now() where id = e.id;
  update public.journal_line set debit = v_imp, concept = v_concepto where id = v_lp.id;
  update public.journal_line set credit = v_imp, company_account_id = v_ca.id, concept = v_concepto where id = v_lc.id;
  if public.journal_entry_canonico(e.id) is distinct from v_canon then
    select hash into v_prev from public.journal_entry where company_id = e.company_id and chain_seq is not null and chain_seq < e.chain_seq order by chain_seq desc limit 1;
    for r in select o.id from public.journal_entry o where o.company_id = e.company_id and o.chain_seq >= e.chain_seq order by o.chain_seq loop
      update public.journal_entry set prev_hash = v_prev where id = r.id;
      update public.journal_entry set hash = public.journal_huella(v_prev, public.journal_entry_canonico(r.id)) where id = r.id returning hash into v_prev;
    end loop;
  end if;
  alter table public.journal_line enable trigger trg_journal_line_inalterable;
  alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;
  if public._conta_cadena_rota(e.company_id) <> 0 then raise exception 'No se cambia nada: después de cambiarlo, la cadena de huellas no cuadra.' using errcode = '23514'; end if;

  perform public._conta_k10c_estado(v_inv.id, v_quien);
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_inv.account_id, v_inv.id, v_quien, 'guardar', jsonb_build_object('pago_cambiado', true, 'asiento', e.number, 'antes', v_antes,
          'despues', jsonb_build_object('fecha', p_fecha, 'importe', v_imp, 'cuenta', v_ca.code, 'concepto', v_concepto)));
  return jsonb_build_object('pago', p.id, 'asiento', e.id, 'serie', e.series, 'numero', e.number,
    'frase', format('Pago cambiado: el asiento %s / %s sigue siendo el %s, con %s el %s con la %s.', e.series, e.number, e.number,
                    public.conta_euros_exactos(v_imp), to_char(p_fecha, 'DD/MM/YYYY'), v_ca.code));
end $function$;
comment on function public.conta_recibida_pago_cambiar(uuid, text, date, numeric, text, text) is
  'K10c · Cambiar un pago apuntado de una recibida (cuenta, fecha, importe, concepto) y su asiento, con el mismo número: candados quitados solo en la transacción, cadena reencadenada y comprobada. El tope manda; la factura vuelve a pagada en parte si ya no queda cubierta.';
revoke all on function public.conta_recibida_pago_cambiar(uuid, text, date, numeric, text, text) from public, anon;
grant execute on function public.conta_recibida_pago_cambiar(uuid, text, date, numeric, text, text) to authenticated, service_role;

-- 4 · Borrar: el pago y su asiento, con el «Borrar» del S01q ----------------------------------------------------------
create or replace function public.conta_recibida_pago_borrar(p_pago uuid, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare p public.supplier_invoice_payment; e public.journal_entry; v_se jsonb; v_quien text; v_r jsonb;
begin
  select * into p from public.supplier_invoice_payment where id = p_pago for update;
  v_se := public.conta_recibida_pago_se_puede_cambiar(p_pago);
  if not coalesce((v_se->>'puede')::boolean, false) then raise exception '%', v_se->>'porque' using errcode = '23514'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Falta por qué se borra el pago.' using errcode = '22023'; end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  select * into e from public.journal_entry where id = p.entry_id;
  delete from public.supplier_invoice_payment where id = p.id;
  v_r := public._conta_asientos_borrar(e.company_id, array[e.id], format('K10c · pago de %s borrado: %s', public.conta_euros_exactos(p.amount), btrim(p_motivo)), v_quien);
  perform public._conta_k10c_estado(p.invoice_id, v_quien);
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (p.account_id, p.invoice_id, v_quien, 'guardar', jsonb_build_object('pago_borrado', true, 'asiento', e.number, 'importe', p.amount, 'fecha', p.paid_on, 'motivo', btrim(p_motivo)));
  return jsonb_build_object('borrado', v_r,
    'frase', format('Pago de %s del %s borrado, con su asiento %s / %s (la serie se ha renumerado sin huecos).',
                    public.conta_euros_exactos(p.amount), to_char(p.paid_on, 'DD/MM/YYYY'), e.series, e.number));
end $function$;
comment on function public.conta_recibida_pago_borrar(uuid, text, text) is
  'K10c · Borrar un pago apuntado de una recibida y su asiento, con el «Borrar» del S01q (_conta_asientos_borrar: respaldo, serie renumerada, cadena comprobada). La factura vuelve a pagada en parte o por pagar.';
revoke all on function public.conta_recibida_pago_borrar(uuid, text, text) from public, anon;
grant execute on function public.conta_recibida_pago_borrar(uuid, text, text) to authenticated, service_role;
