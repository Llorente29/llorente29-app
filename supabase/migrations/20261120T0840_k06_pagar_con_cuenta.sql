-- supabase/migrations/20261120T0840_k06_pagar_con_cuenta.sql
--
-- K06 · «Cómo se paga» es la cuenta del pago (Julio, 19/11: «los pagos pueden
-- ser por más que bancos»). Esta solo AÑADE una función nueva; no cambia
-- ninguna tabla ni función que exista, y se puede pasar dos veces seguidas.
--
-- La ficha de la recibida propone la cuenta del pago y, al validar la factura,
-- hace con ella lo que ya hace la base hoy, sin camino nuevo, salvo uno:
--   · un banco, una tarjeta o la caja (su tesorería): conta_pago_a_mano, lo
--     mismo que «Ya la he pagado» de Pagos (espera el cargo; al casarlo en
--     Bancos, su asiento y su pago);
--   · la 430 de la plataforma: la forma de pago «compensation» de la 0790; al
--     validarla queda pagada con su liquidación (S01i, _conta_comision_pagar);
--   · OTRA cuenta (la 551 del socio que la pagó, una tarjeta que no es una
--     tesorería…): eso no lo hacía nada. Es esta función.
--
-- conta_recibida_pagar_con_cuenta(empresa, factura, cuenta, fecha, quien):
--   1. lo que Pagos pide para pagar (_pc01e2_empresa: administrador o
--      encargado; la factura de la empresa, validada y con algo por pagar, la
--      subcuenta del proveedor en el plan) y que la cuenta sea del plan, no un
--      grupo, ni la del proveedor, ni una tesorería (esa va por Bancos), y que
--      la factura no sea de las que se compensan con su liquidación;
--   2. el pago, por lo que queda (conta_recibida_pago.pendiente menos lo que
--      está en remesas sin casar): «+ Otro pago» no entra en el K06;
--   3. su asiento, validado: serie 4, Debe la subcuenta del proveedor / Haber la
--      cuenta del pago, con el número de la factura en el documento (el mismo
--      molde que el cobro en efectivo de conta_venta_cobrar);
--   4. el pago en supplier_invoice_payment con su asiento: así lo cuentan
--      _bank_recibida_pagado (N10, que no se toca), conta_recibida_pago y Pagos,
--      y Bancos deja de proponerla para casar;
--   5. la factura, pagada (mark_supplier_invoice_paid, la de siempre).
--   Devuelve la frase de lo que ha hecho (regla 8).
--
-- Nada en el camino del pedido: no lee ni escribe ventas, pedidos ni stock.
-- Vuelta atrás: supabase/vuelta-atras/20261120T0840_k06_pagar_con_cuenta.down.sql

create or replace function public.conta_recibida_pagar_con_cuenta(p_company uuid, p_invoice uuid, p_cuenta text, p_fecha date, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public._pc01e2_empresa(p_company);
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'Sumied');
  v_inv public.supplier_invoice; v_s public.supplier; v_prov text; v_ca public.company_account;
  v_pend numeric; v_party uuid; v_pago uuid; v_r jsonb; v_entry uuid; v_val jsonb; v_numero text; v_concepto text; v_nombre text;
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
  if v_pend <= 0 then raise exception 'A la factura % no le queda nada por pagar.', v_numero using errcode = '23514'; end if;

  select party_id into v_party from public.party_role where account_id = v_cuenta and supplier_id = v_s.id and role = 'supplier' order by created_at limit 1;
  v_nombre := coalesce(nullif(v_ca.plain_name, ''), v_ca.name);
  v_concepto := 'Pago factura ' || v_numero;
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by, created_by_name)
  values (v_cuenta, p_company, v_inv.id, p_fecha, v_pend, null, format('Pagada con la %s (%s), desde su ficha', v_ca.code, v_nombre), auth.uid(), v_quien)
  returning id into v_pago;
  v_r := public._journal_entry_proponer(p_company,
    jsonb_build_object('series', 4, 'fecha', p_fecha, 'source_type', 'supplier_payment', 'source_id', v_pago,
      'concepto', v_concepto, 'party_id', v_party, 'documento', v_inv.invoice_number, 'fecha_documento', v_inv.invoice_date,
      'confianza', 'seguro', 'porque', format('Pago de la factura con la %s, desde su ficha.', v_ca.code)),
    jsonb_build_array(
      jsonb_build_object('cuenta', v_prov, 'tercero_id', v_party, 'documento', v_inv.invoice_number, 'concepto', v_concepto, 'debe', v_pend, 'haber', 0, 'comun', true),
      jsonb_build_object('cuenta', v_ca.code, 'documento', v_inv.invoice_number, 'concepto', v_concepto, 'debe', 0, 'haber', v_pend, 'comun', true)),
    null, v_quien, auth.uid());
  v_entry := nullif(v_r->>'id', '')::uuid;
  if v_entry is null then raise exception 'El asiento del pago no se ha podido proponer (%).', v_r using errcode = '23514'; end if;
  v_val := public.journal_entry_validar(v_entry, v_quien);
  update public.supplier_invoice_payment set entry_id = v_entry where id = v_pago;
  perform public.mark_supplier_invoice_paid(v_inv.id, p_fecha, null);
  return jsonb_build_object('asiento', v_entry, 'serie', 4, 'numero', v_val->'numero', 'importe', v_pend, 'cuenta', v_ca.code,
    'frase', format('Pago apuntado con la %s (%s): %s el %s, asiento 4 / %s. La factura %s queda pagada.',
      v_ca.code, v_nombre, public.conta_euros_exactos(v_pend), to_char(p_fecha, 'DD/MM/YYYY'), v_val->>'numero', v_numero));
end $$;
revoke all on function public.conta_recibida_pagar_con_cuenta(uuid, uuid, text, date, text) from public, anon;
grant execute on function public.conta_recibida_pagar_con_cuenta(uuid, uuid, text, date, text) to authenticated;
comment on function public.conta_recibida_pagar_con_cuenta(uuid, uuid, text, date, text) is
  'K06 · El pago de una recibida validada con una cuenta que no es una tesorería ni la 430 de su liquidación (la 551 del socio…): su asiento validado (serie 4, Debe 400 / Haber la cuenta), su pago en supplier_invoice_payment y la factura pagada.';
