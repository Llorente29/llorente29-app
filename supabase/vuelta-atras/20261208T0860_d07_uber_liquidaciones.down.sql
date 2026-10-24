-- supabase/vuelta-atras/20261208T0860_d07_uber_liquidaciones.down.sql
--
-- Vuelta atrás de 20261208T0860: conta_liquidacion_factura_proponer como en
-- producción byte a byte (la 0100 del D01: vuelve a crear la provisional), y
-- fuera la función de enlazar. Los enlaces ya hechos se quedan (son una
-- factura de verdad con sus liquidaciones).
create or replace function public.conta_liquidacion_factura_proponer(p_settlement uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cs public.channel_settlement; v_e uuid; v_f jsonb; v_sup uuid; v_rol public.party_role; v_inv uuid; v_410 text;
  v_c623 text; v_c627 text; v_tasa uuid; v_fecha date; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Liquidación por correo');
  v_base numeric; v_iva numeric; v_total numeric; v_bc numeric; v_ba numeric; v_sem int; v_corte date;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement for update;
  if v_cs.id is null then raise exception 'Esa liquidación no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_cs.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone facturas.' using errcode = '42501';
  end if;
  if v_cs.commission_invoice_id is not null then
    return jsonb_build_object('estado', 'ya_estaba', 'factura_id', v_cs.commission_invoice_id, 'texto', 'La factura de comisión ya estaba.');
  end if;
  -- El corte (Julio, 16/10): la contabilidad está cerrada hasta la fecha de corte
  -- de Bancos. Una liquidación que ACABA antes es solo de referencia: sin
  -- factura ni asiento (sirve para contrastar y para casar su cobro). La que
  -- cruza el corte es real: su factura va entera con su fecha (después del fin
  -- del periodo, así que ya del periodo abierto).
  v_corte := public._conta_corte((select company_id from public.platform_store where id = v_cs.store_id));
  if v_corte is not null and v_cs.period_to < v_corte then
    update public.channel_settlement set is_reference = true, updated_at = now() where id = v_cs.id and is_reference is distinct from true;
    perform public._conta_liquidacion_marcar(v_cs.id);
    return jsonb_build_object('estado', 'referencia', 'corte', v_corte,
      'texto', 'De referencia: es de antes del cierre (' || to_char(v_corte - 1, 'DD/MM/YYYY') || '), así que no lleva factura de comisión ni asiento.');
  end if;
  v_f := v_cs.raw->'factura';
  if v_f is null or jsonb_typeof(v_f) <> 'object' or coalesce((v_f->>'total')::numeric, 0) = 0 then
    return jsonb_build_object('estado', 'sin_factura', 'texto', 'Esta liquidación no tiene comisión ni cargos que facturar.');
  end if;
  v_base := (v_f->>'base')::numeric; v_iva := (v_f->>'iva')::numeric; v_total := (v_f->>'total')::numeric;
  v_bc := (v_f->'comision'->>'base')::numeric; v_ba := (v_f->'publicidad'->>'base')::numeric;
  if round(v_base * 100) + round(v_iva * 100) <> round(v_total * 100) or round(v_bc * 100) + round(v_ba * 100) <> round(v_base * 100) then
    raise exception 'La factura de comisión no cuadra: base + IVA no es el total.' using errcode = '22023';
  end if;
  select company_id into v_e from public.platform_store where id = v_cs.store_id;
  if v_e is null then raise exception 'La liquidación no dice de qué empresa es (no tiene tienda).' using errcode = '22023'; end if;

  -- El proveedor: el de la plataforma del canal (tercero de la plataforma → su ficha de proveedor).
  select * into v_rol from public.party_role where account_id = v_cs.account_id and role = 'platform' and channel_id = v_cs.channel_id order by created_at limit 1;
  select supplier_id into v_sup from public.party_role where account_id = v_cs.account_id and role = 'supplier' and party_id = v_rol.party_id order by created_at limit 1;
  if v_sup is null then
    update public.channel_settlement set needs_review = true,
           review_note = 'Falta el proveedor de la plataforma: dale a su tercero su ficha de proveedor y vuelve a proponer la factura.', updated_at = now()
     where id = v_cs.id;
    return jsonb_build_object('estado', 'falta_proveedor', 'texto', 'La plataforma no tiene ficha de proveedor: la factura de comisión no se ha creado.');
  end if;

  -- Las cuentas: las que diga la plataforma; si no, LO APRENDIDO del libro (la 623x y
  -- la 627x más usadas en la serie 2 validada junto a la 410 de su proveedor: en
  -- Foodint, la 62300002 en 1.300 apuntes y la 62700002 en 54, lo traído de Diez);
  -- si no, la 623 / 627 de la plantilla.
  select a.code into v_410 from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = v_e and l.entity = 'supplier' and l.entity_id = v_sup::text and l.role = 'principal' limit 1;
  v_c623 := coalesce(nullif(btrim(v_rol.commission_account_code), ''), public._conta_cuenta_aprendida(v_e, v_410, '623'),
                     (select code from public.company_account where company_id = v_e and kind = 'template' and template_code = '623' order by code limit 1));
  v_c627 := coalesce(nullif(btrim(v_rol.ads_account_code), ''), public._conta_cuenta_aprendida(v_e, v_410, '627'),
                     (select code from public.company_account where company_id = v_e and kind = 'template' and template_code = '627' order by code limit 1));
  select id into v_tasa from public.tax_rate where code = 'iva_general' and is_system order by valid_to desc nulls first limit 1;

  -- La fecha la pone la plataforma con el número: se propone el martes siguiente (Uber, medido en Diez).
  v_fecha := v_cs.period_to + 2;
  v_sem := ((v_cs.period_to - v_cs.period_from) + 1) / 7;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, brand_id, doc_kind, invoice_number, invoice_date, status, source,
                                       arrival_channel, tax_base_total, tax_total, grand_total, needs_review, notes, reading, reading_confidence, created_by_name)
  values (v_cs.account_id, v_e, v_sup, v_cs.location_id, v_cs.brand_id, 'invoice', null, v_fecha, 'en_revision', 'liquidacion', 'correo',
          v_base, v_iva, v_total, true,
          'De la liquidación del ' || to_char(v_cs.period_from, 'DD/MM/YYYY') || ' al ' || to_char(v_cs.period_to, 'DD/MM/YYYY') ||
          '. Falta el número: la plataforma no lo manda en el correo.',
          jsonb_build_object('origen', 'liquidacion', 'liquidacion_id', v_cs.id,
            'requisitos', jsonb_build_array(
              jsonb_build_object('id', 'numero', 'ok', false, 'texto', 'Falta el número: la plataforma no lo manda en el correo.'),
              jsonb_build_object('id', 'fecha', 'ok', false, 'texto', 'Fecha propuesta: la pone la plataforma con el número.')) ||
              case when v_sem > 1 then jsonb_build_array(jsonb_build_object('id', 'semanas', 'ok', false,
                'texto', 'La liquidación es de ' || v_sem || ' semanas: la plataforma puede haber hecho una factura por semana.')) else '[]'::jsonb end,
            'avisos', coalesce(v_f->'avisos', '[]'::jsonb)),
          'duda', v_quien)
  returning id into v_inv;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, expense_account_code, position)
  select v_inv, x.texto, 1, x.base, x.base, 21, x.cuenta, x.pos
    from (values (1, 'Comisión y cargos de la plataforma', v_bc, v_c623), (2, 'Publicidad (anuncios)', v_ba, v_c627)) as x(pos, texto, base, cuenta)
   where x.base <> 0;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
  values (v_cs.account_id, v_inv, v_tasa, 21, v_base, v_iva);
  update public.channel_settlement set commission_invoice_id = v_inv, updated_at = now() where id = v_cs.id;
  perform public._conta_liquidacion_marcar(v_cs.id);
  return jsonb_build_object('estado', 'creada', 'factura_id', v_inv, 'total', v_total,
    'texto', 'Factura de comisión propuesta: ' || public.conta_euros_exactos(v_total) || ', a falta del número.');
end $$;

drop function if exists public.conta_liquidacion_enlazar_factura(uuid, uuid[], text);
