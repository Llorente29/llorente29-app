-- supabase/migrations/20261110T1217_g05_liquidado_devuelto.sql
-- cambia: public._conta_cobro_facturar · prueba: supabase/staging/sql/20261110_g05_liquidado_devuelto_prueba.sql
-- cambia: public.conta_cobro_seguir · prueba: supabase/staging/sql/20261110_g05_liquidado_devuelto_prueba.sql
--
-- G05 · nº 79 · UN COBRO QUE GOCARDLESS LIQUIDÓ Y QUE LLEGA YA DEVUELTO O
-- RECLAMADO. Si entre dos lecturas GoCardless cobra un recibo, lo ingresa en el
-- banco (una liquidación) y después el cliente lo reclama o el banco lo devuelve,
-- Sumied nunca lo veía «cobrado»: se quedaba sin factura y sin asientos, aunque el
-- dinero llegó al banco (Veterinaria Cuatro Patas en la demo, 10/11: 145,00 € y un
-- ingreso de 142,77 € sin factura). La maqueta dice que un retrocedido después de
-- cobrarse conserva su factura y lleva su asiento de devolución.
--
--   1. _conta_cobro_facturar, la misma firma: además de un cobro confirmado o
--      ingresado, factura uno que ya no lo está si GoCardless lo liquidó (su cobro
--      tiene liquidación en lo leído, conta_gc_cobro.payout_gc_id). Lo demás, igual.
--   2. conta_cobro_seguir, la misma firma: un devuelto o retrocedido sin factura y
--      liquidado → primero la factura y el asiento del cobro (57200002 / 430) y
--      después el de la devolución (430 / 57200002); el recibo queda devuelto o
--      retrocedido, con su factura. Uno sin liquidar sigue como antes: sin factura.
-- La liquidación de cada cobro la trae la lectura (también de las partidas de la
-- liquidación, payout_items). Con sus respaldos. Nada en el camino del pedido. No
-- toca datos: lo que esté así lo arregla el «seguir» de la siguiente lectura.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1217_g05_liquidado_devuelto.down.sql

select public._respaldar_funcion('public._conta_cobro_facturar(uuid)', '20261110T1217_g05_liquidado_devuelto');
select public._respaldar_funcion('public.conta_cobro_seguir(uuid)', '20261110T1217_g05_liquidado_devuelto');

create or replace function public._conta_cobro_facturar(p_recibo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_recibo; v_aj jsonb; v_antes jsonb; v_id uuid; v_g jsonb; v_e jsonb; v_numero text; v_fecha date; v_tipo uuid; v_ret uuid;
  v_705 uuid; v_lin jsonb := '[]'::jsonb; v_x jsonb; v_cli text; v_nombre text; v_pago uuid; v_entry uuid; v_total numeric;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.invoice_id is not null then return jsonb_build_object('ya', true, 'factura', v_r.invoice_id); end if;
  -- nº 79 · O ya no confirmado, pero GoCardless lo liquidó (llegó al banco): también se factura.
  if v_r.gc_estado not in ('confirmed', 'paid_out')
     and not exists (select 1 from public.conta_gc_cobro b where b.company_id = v_r.company_id and b.gc_id = v_r.gc_cobro_id and b.payout_gc_id is not null) then
    raise exception 'Sin el cobro confirmado no hay factura.' using errcode = '23514';
  end if;
  if v_r.enviado_por is null then raise exception 'No se sabe quién envió el cobro: la factura se emite en su nombre.' using errcode = '23514'; end if;
  v_aj := public._conta_cobro_ajustes(v_r.company_id);
  v_fecha := least(coalesce(v_r.confirmado_el, v_r.cargo_el, (now() at time zone 'Europe/Madrid')::date), (now() at time zone 'Europe/Madrid')::date);
  v_antes := public._conta_cobro_como(v_r.enviado_por, v_r.account_id);
  begin
    -- Las subcuentas que hacen falta, con su código exacto: 705, 477 (enlazada al IVA general), 430 + código del cliente y la puente.
    v_705 := public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_ingresos', 'Prestaciones de servicios', v_r.enviado_por_name);
    select id into v_tipo from public.tax_rate where is_system and code = 'iva_general' and rate = (v_aj->>'iva_pct')::numeric limit 1;
    if v_tipo is null then raise exception 'No encuentro el IVA general al % %%.', v_aj->>'iva_pct' using errcode = '23514'; end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_r.account_id, v_r.company_id, public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_iva', 'IVA repercutido ' || (v_aj->>'iva_pct') || ' %', v_r.enviado_por_name),
            'tax_rate', v_tipo::text, 'repercutido', 'manual')
    on conflict (company_id, entity, entity_id, role) do nothing;
    v_cli := public._conta_cobro_cuenta_cliente(v_r.company_id, v_r.party_id, v_r.enviado_por_name);
    perform public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_plataforma', 'Plataforma GoCardless', v_r.enviado_por_name);
    if (v_aj->>'retencion_pct')::numeric > 0 then
      perform public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_retencion', 'Hacienda Pública, retenciones y pagos a cuenta', v_r.enviado_por_name);
      select id into v_ret from public.withholding_rate where is_system and code = case when (v_aj->>'retencion_pct')::numeric = 7 then 'profesional_inicio' else 'profesional' end limit 1;
    end if;
    -- La factura de la V01, con las líneas que calculó el núcleo (cantidad × precio, la base sin IVA).
    for v_x in select * from jsonb_array_elements(v_r.factura->'lineas') loop
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('concepto', v_x->>'concepto', 'cantidad', (v_x->>'cantidad')::numeric,
        'precio', (v_x->>'precioCent')::numeric / 100, 'descuento', 0, 'tipo_id', v_tipo, 'cuenta_id', v_705));
    end loop;
    v_g := public.conta_venta_guardar(v_r.company_id, null, jsonb_build_object('cliente_id', v_r.party_id, 'fecha', v_fecha, 'serie', v_aj->>'serie',
      'retencion_id', v_ret, 'notas', 'Recibo de ' || v_r.mes || ', cobrado por domiciliación SEPA (GoCardless).'), v_lin, v_r.enviado_por_name);
    v_id := (v_g->>'id')::uuid;
    -- nº 62 · La cuota de cada línea, la del núcleo: el total es justo el del recibo (119,83 + 25,17 = 145,00).
    v_total := public._conta_cobro_cuota_exacta(v_id, v_r.factura, (v_g->>'total')::numeric);
    -- Nunca una factura que no cuadra con su cobro.
    if round(v_total * 100) <> v_r.cobrar_cent then
      raise exception 'La factura saldría por % € y el cobro fue de % €: no se emite.', v_total, v_r.cobrar_cent / 100.0 using errcode = '23514';
    end if;
    v_e := public.conta_venta_emitir(v_id, v_r.enviado_por_name);
    select number_text into v_numero from public.customer_invoice where id = v_id;
    -- Cobrada: su cobro (sin asiento en la V01: no es en efectivo) y el asiento del G05, 57200002 / 430, con la fecha del cobro.
    perform public.conta_venta_cobrar(v_id, v_fecha, v_r.cobrar_cent / 100.0, 'GoCardless', 'Domiciliación SEPA ' || coalesce(v_r.gc_cobro_id, ''), v_r.enviado_por_name);
    select id into v_pago from public.customer_invoice_payment where invoice_id = v_id order by created_at desc limit 1;
    select name into v_nombre from public.party where id = v_r.party_id;
    v_entry := public._conta_cobro_asiento(v_r.company_id, v_fecha, v_numero || '-' || coalesce(v_nombre, 'Cliente'), v_numero, v_r.party_id, v_pago,
      jsonb_build_array(
        jsonb_build_object('cuenta', v_aj->>'cuenta_plataforma', 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', v_r.cobrar_cent / 100.0, 'haber', 0),
        jsonb_build_object('cuenta', v_cli, 'tercero_id', v_r.party_id, 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', 0, 'haber', v_r.cobrar_cent / 100.0)),
      v_r.enviado_por_name, v_r.enviado_por);
    update public.customer_invoice_payment set entry_id = v_entry where id = v_pago;
  exception when others then
    perform public._conta_cobro_dejar(v_antes);
    raise;
  end;
  perform public._conta_cobro_dejar(v_antes);
  update public.conta_recibo set invoice_id = v_id, asiento_cobro = v_entry, confirmado_el = v_fecha, estado = 'facturado', updated_at = now() where id = p_recibo;
  perform public._conta_cobro_evento(p_recibo, 'facturado', format('Cobrado el %s y facturado: %s.', to_char(v_fecha, 'DD/MM/YYYY'), v_numero),
    jsonb_build_object('factura', v_id, 'numero', v_numero, 'asiento', v_entry), v_r.enviado_por_name);
  return jsonb_build_object('factura', v_id, 'numero', v_numero, 'asiento', v_entry);
end $$;

create or replace function public.conta_cobro_seguir(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_x record; v_nuevo text; v_facturadas int := 0; v_deshechos int := 0; v_cambios int := 0; v_fallos int := 0; v_msg text;
begin
  -- Después de cada lectura (que renueva las diferencias), los clientes sin código vuelven a «Pendiente de revisar».
  perform public._conta_cobro_codigos(p_company);
  for v_x in
    select r.id, r.estado, r.gc_estado, r.invoice_id, r.asiento_cobro, r.asiento_devolucion, b.estado as gc, b.fecha,
           r.motivo_devolucion, b.motivo_es as motivo_gc, (b.payout_gc_id is not null) as liquidado
      from public.conta_recibo r join public.conta_gc_cobro b on b.company_id = r.company_id and b.gc_id = r.gc_cobro_id
     where r.company_id = p_company and r.gc_cobro_id is not null
  loop
    if v_x.gc is distinct from v_x.gc_estado then
      v_nuevo := public._conta_cobro_estado(v_x.gc, v_x.invoice_id is not null);
      update public.conta_recibo set gc_estado = v_x.gc, estado = v_nuevo,
        confirmado_el = case when v_x.gc in ('confirmed', 'paid_out') then coalesce(confirmado_el, v_x.fecha) else confirmado_el end, updated_at = now()
       where id = v_x.id;
      perform public._conta_cobro_evento(v_x.id, v_nuevo, case v_nuevo
        when 'en_el_banco' then 'Cobro en el banco del cliente.'
        when 'cobrado' then 'Cobro confirmado.'
        when 'devuelto' then case when v_x.asiento_cobro is null then 'Devuelto sin fondos: pasa a «Te deben» y no tiene factura.' else 'Devuelto.' end
        when 'retrocedido' then 'Retrocedido: el cliente lo reclamó a su banco.'
        when 'cancelado' then 'Cancelado en GoCardless: no se ha cobrado.'
        else 'Enviado.' end, jsonb_build_object('gocardless', v_x.gc), null);
      v_cambios := v_cambios + 1;
    end if;
    -- nº 77 · El motivo del devuelto o el retrocedido, en el recibo (en cuanto la lectura lo trae).
    if v_x.gc in ('failed', 'charged_back', 'customer_approval_denied') and v_x.motivo_gc is not null
       and v_x.motivo_devolucion is distinct from v_x.motivo_gc then
      update public.conta_recibo set motivo_devolucion = v_x.motivo_gc, updated_at = now() where id = v_x.id;
    end if;
    begin
      if v_x.gc in ('confirmed', 'paid_out') and v_x.invoice_id is null then
        perform public._conta_cobro_facturar(v_x.id);
        v_facturadas := v_facturadas + 1;
      elsif v_x.gc in ('failed', 'charged_back') and v_x.invoice_id is null and v_x.liquidado then
        -- nº 79 · Liquidado y después devuelto o reclamado: su factura y su cobro, y después la devolución.
        perform public._conta_cobro_facturar(v_x.id);
        perform public._conta_cobro_devolver(v_x.id);
        update public.conta_recibo set estado = public._conta_cobro_estado(v_x.gc, true), updated_at = now() where id = v_x.id;
        v_facturadas := v_facturadas + 1;
        v_deshechos := v_deshechos + 1;
      elsif v_x.gc in ('failed', 'charged_back') and v_x.asiento_cobro is not null and v_x.asiento_devolucion is null then
        perform public._conta_cobro_devolver(v_x.id);
        v_deshechos := v_deshechos + 1;
      end if;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_fallos := v_fallos + 1;
      perform public._conta_cobro_evento(v_x.id, 'fallo', 'No se ha podido terminar: ' || v_msg, null, null);
    end;
  end loop;
  return jsonb_build_object('cambios', v_cambios, 'facturadas', v_facturadas, 'deshechos', v_deshechos, 'fallos', v_fallos);
end $$;
