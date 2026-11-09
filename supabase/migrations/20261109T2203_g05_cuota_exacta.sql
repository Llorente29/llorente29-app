-- supabase/migrations/20261109T2203_g05_cuota_exacta.sql
-- cambia: public._conta_cobro_facturar · prueba: supabase/staging/sql/20261109_g05_cuota_exacta_prueba.sql
-- cambia: public._conta_cobro_facturar_portal · prueba: supabase/staging/sql/20261109_g05_cuota_exacta_prueba.sql
--
-- G05 · LO QUE PAGA EL CLIENTE NO CAMBIA (Julio, nº 62). Con la tarifa con el IVA
-- dentro, unos 17 de cada 100 totales no salen con ninguna base y su IVA
-- redondeado (145,00 €: 119,83 da 144,99 y 119,84, 145,01). Hasta hoy el
-- núcleo cobraba y facturaba 144,99 € y lo sacaba como «cambio». Ahora la base
-- es la más cercana y el IVA lo que falta hasta el total: 119,83 + 25,17 =
-- 145,00 (un céntimo sobre base × tipo; Verifactu acepta ±10 € en la cuota).
-- El núcleo (_shared/cobro/factura.ts) pone en la factura del recibo la cuota de
-- cada línea (ivaCent); aquí:
--   1. _conta_cobro_cuota_exacta(factura, la del recibo, total) (AÑADE): guarda
--      esa cuota en las líneas del borrador (customer_invoice_line.tax_amount,
--      V01b) y rehace sus cifras (_conta_venta_cifras ya usa la guardada). Así
--      el asiento (430 / 705 + 477), el libro de expedidas, el PDF y Verifactu
--      llevan esa cuota tal cual. Un recibo guardado antes (sin ivaCent) sigue
--      como antes.
--   2. _conta_cobro_facturar y _conta_cobro_facturar_portal (CAMBIAN, misma
--      firma): la llaman antes de comprobar que la factura cuadra con el cobro.
-- Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T2203_g05_cuota_exacta.down.sql

create or replace function public._conta_cobro_cuota_exacta(p_id uuid, p_factura jsonb, p_total numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_l jsonb := coalesce(p_factura->'lineas', '[]'::jsonb); v_c jsonb; v_n int;
begin
  -- Un recibo de antes (sin la cuota de cada línea): como siempre.
  if jsonb_array_length(v_l) = 0 or exists (select 1 from jsonb_array_elements(v_l) x where not (x ? 'ivaCent')) then return p_total; end if;
  if (select status from public.customer_invoice where id = p_id) is distinct from 'borrador' then
    raise exception 'La cuota de las líneas solo se pone en un borrador.' using errcode = '23514';
  end if;
  select count(*) into v_n from public.customer_invoice_line where invoice_id = p_id;
  if v_n <> jsonb_array_length(v_l) then
    raise exception 'La factura tiene % líneas y el recibo, %: no se emite.', v_n, jsonb_array_length(v_l) using errcode = '23514';
  end if;
  -- Línea a línea, en su orden (conta_venta_guardar las numera desde 1).
  update public.customer_invoice_line l set tax_amount = ((v_l->(l.position - 1))->>'ivaCent')::numeric / 100
   where l.invoice_id = p_id;
  v_c := public._conta_venta_cifras(p_id);
  update public.customer_invoice set base = (v_c->>'base')::numeric, tax = (v_c->>'iva')::numeric, surcharge_amount = (v_c->>'recargo')::numeric,
         withholding_amount = (v_c->>'retencion')::numeric, total = (v_c->>'total')::numeric
   where id = p_id;
  return (v_c->>'total')::numeric;
end $$;
revoke all on function public._conta_cobro_cuota_exacta(uuid, jsonb, numeric) from public, anon, authenticated;
comment on function public._conta_cobro_cuota_exacta(uuid, jsonb, numeric) is
  'G05 · nº 62 · La cuota de IVA de cada línea de la factura de un recibo, la del núcleo (ivaCent): se guarda en el borrador para que el total sea justo el del recibo. Sin ella, nada.';

-- Las de antes, guardadas para la vuelta atrás (_restaurar_funcion).
select public._respaldar_funcion('public._conta_cobro_facturar(uuid)', '20261109T2203_g05_cuota_exacta');
select public._respaldar_funcion('public._conta_cobro_facturar_portal(uuid,date,text,text,text)', '20261109T2203_g05_cuota_exacta');

create or replace function public._conta_cobro_facturar(p_recibo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_recibo; v_aj jsonb; v_antes jsonb; v_id uuid; v_g jsonb; v_e jsonb; v_numero text; v_fecha date; v_tipo uuid; v_ret uuid;
  v_705 uuid; v_lin jsonb := '[]'::jsonb; v_x jsonb; v_cli text; v_nombre text; v_pago uuid; v_entry uuid; v_total numeric;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.invoice_id is not null then return jsonb_build_object('ya', true, 'factura', v_r.invoice_id); end if;
  if v_r.gc_estado not in ('confirmed', 'paid_out') then raise exception 'Sin el cobro confirmado no hay factura.' using errcode = '23514'; end if;
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

create or replace function public._conta_cobro_facturar_portal(p_recibo uuid, p_fecha date, p_puente text, p_forma text, p_referencia text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_recibo; v_aj jsonb; v_antes jsonb; v_id uuid; v_g jsonb; v_numero text; v_tipo uuid; v_ret uuid;
  v_705 uuid; v_lin jsonb := '[]'::jsonb; v_x jsonb; v_cli text; v_nombre text; v_pago uuid; v_entry uuid; v_total numeric;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.invoice_id is not null then raise exception 'Este recibo ya tiene su factura.' using errcode = '23514'; end if;
  if v_r.enviado_por is null then raise exception 'No se sabe quién envió el cobro: la factura se emite en su nombre.' using errcode = '23514'; end if;
  if v_r.factura is null or jsonb_array_length(coalesce(v_r.factura->'lineas', '[]'::jsonb)) = 0 then raise exception 'Este recibo no tiene las líneas de su factura.' using errcode = '23514'; end if;
  v_aj := public._conta_cobro_ajustes(v_r.company_id);
  v_antes := public._conta_cobro_como(v_r.enviado_por, v_r.account_id);
  begin
    v_705 := public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_ingresos', 'Prestaciones de servicios', v_r.enviado_por_name);
    select id into v_tipo from public.tax_rate where is_system and code = 'iva_general' and rate = (v_aj->>'iva_pct')::numeric limit 1;
    if v_tipo is null then raise exception 'No encuentro el IVA general al % %%.', v_aj->>'iva_pct' using errcode = '23514'; end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_r.account_id, v_r.company_id, public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_iva', 'IVA repercutido ' || (v_aj->>'iva_pct') || ' %', v_r.enviado_por_name),
            'tax_rate', v_tipo::text, 'repercutido', 'manual')
    on conflict (company_id, entity, entity_id, role) do nothing;
    v_cli := public._conta_cobro_cuenta_cliente(v_r.company_id, v_r.party_id, v_r.enviado_por_name);
    if (v_aj->>'retencion_pct')::numeric > 0 then
      perform public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_retencion', 'Hacienda Pública, retenciones y pagos a cuenta', v_r.enviado_por_name);
      select id into v_ret from public.withholding_rate where is_system and code = case when (v_aj->>'retencion_pct')::numeric = 7 then 'profesional_inicio' else 'profesional' end limit 1;
    end if;
    for v_x in select * from jsonb_array_elements(v_r.factura->'lineas') loop
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('concepto', v_x->>'concepto', 'cantidad', (v_x->>'cantidad')::numeric,
        'precio', (v_x->>'precioCent')::numeric / 100, 'descuento', 0, 'tipo_id', v_tipo, 'cuenta_id', v_705));
    end loop;
    v_g := public.conta_venta_guardar(v_r.company_id, null, jsonb_build_object('cliente_id', v_r.party_id, 'fecha', p_fecha, 'serie', v_aj->>'serie',
      'retencion_id', v_ret, 'notas', 'Recibo de ' || v_r.mes || ', devuelto y pagado después desde el portal.'), v_lin, v_r.enviado_por_name);
    v_id := (v_g->>'id')::uuid;
    -- nº 62 · La cuota de cada línea, la del núcleo: el total es justo el del recibo (119,83 + 25,17 = 145,00).
    v_total := public._conta_cobro_cuota_exacta(v_id, v_r.factura, (v_g->>'total')::numeric);
    if round(v_total * 100) <> coalesce(v_r.cobrar_cent, v_r.total_cent) then
      raise exception 'La factura saldría por % € y el recibo es de % €: no se emite.', v_total, coalesce(v_r.cobrar_cent, v_r.total_cent) / 100.0 using errcode = '23514';
    end if;
    perform public.conta_venta_emitir(v_id, v_r.enviado_por_name);
    select number_text into v_numero from public.customer_invoice where id = v_id;
    perform public.conta_venta_cobrar(v_id, p_fecha, v_total, p_forma, p_referencia, v_r.enviado_por_name);
    select id into v_pago from public.customer_invoice_payment where invoice_id = v_id order by created_at desc limit 1;
    select name into v_nombre from public.party where id = v_r.party_id;
    v_entry := public._conta_cobro_asiento(v_r.company_id, p_fecha, v_numero || '-' || coalesce(v_nombre, 'Cliente'), v_numero, v_r.party_id, v_pago,
      jsonb_build_array(
        jsonb_build_object('cuenta', p_puente, 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', v_total, 'haber', 0),
        jsonb_build_object('cuenta', v_cli, 'tercero_id', v_r.party_id, 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', 0, 'haber', v_total)),
      v_r.enviado_por_name, v_r.enviado_por);
    update public.customer_invoice_payment set entry_id = v_entry where id = v_pago;
  exception when others then
    perform public._conta_cobro_dejar(v_antes);
    raise;
  end;
  perform public._conta_cobro_dejar(v_antes);
  update public.conta_recibo set invoice_id = v_id, asiento_cobro = v_entry, confirmado_el = p_fecha, updated_at = now() where id = p_recibo;
  return jsonb_build_object('factura', v_id, 'numero', v_numero, 'asiento', v_entry);
end $$;
