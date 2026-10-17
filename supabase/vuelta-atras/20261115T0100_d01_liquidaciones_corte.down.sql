-- supabase/vuelta-atras/20261115T0100_d01_liquidaciones_corte.down.sql
-- Deshace la 0100 del 15: las dos funciones como las dejó la 0100 del 13 (su
-- texto, tal cual), y fuera _conta_corte y la columna is_reference.
-- Freno: si alguna liquidación está marcada de referencia, se pararía de saber
-- que lo es (y su factura se volvería a proponer): no se toca nada y lo dice.
do $$
declare n int;
begin
  if to_regclass('public.channel_settlement') is null then return; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'channel_settlement' and column_name = 'is_reference') then
    execute 'select count(*) from public.channel_settlement where is_reference' into n;
    if n > 0 then
      raise exception 'VUELTA ATRÁS 0100 del 15 (corte) PARADA: hay % liquidación(es) de referencia. Deshaz antes la tanda que las marcó (0110 del 15).', n using errcode = 'P0001';
    end if;
  end if;
end $$;

create or replace function public._conta_liquidacion_marcar(p_settlement uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cs public.channel_settlement; v_sin boolean; v_avisos jsonb; v_n int; v_solape text; v_req jsonb;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement;
  if v_cs.id is null or v_cs.store_id is null then return; end if;
  v_sin := v_cs.brand_id is null or v_cs.location_id is null;
  v_avisos := case when jsonb_typeof(v_cs.raw->'avisos') = 'array' then v_cs.raw->'avisos' else '[]'::jsonb end;
  v_n := jsonb_array_length(v_avisos);
  v_solape := public._conta_liquidacion_solape(v_cs.id);
  update public.channel_settlement set
    needs_review = v_sin or v_n > 0 or v_solape is not null,
    review_note = nullif(concat_ws(' ',
      case when v_sin then 'Tienda sin asignar: dale su marca y su local.' end,
      case when v_n > 0 then 'Por aclarar: ' || v_n || case when v_n = 1 then ' cosa no cuadra al leer.' else ' cosas no cuadran al leer.' end end,
      case when v_solape is not null then 'Por aclarar: ' || v_solape || '. Cada día cuenta una sola vez: ninguna de las dos se asienta hasta aclararlo.' end), ''),
    updated_at = now()
   where id = v_cs.id;
  if v_cs.commission_invoice_id is not null then
    v_req := coalesce((select jsonb_agg(x) from public.supplier_invoice i, jsonb_array_elements(coalesce(i.reading->'requisitos', '[]'::jsonb)) x
                        where i.id = v_cs.commission_invoice_id and x->>'id' not in ('solape', 'cuadre')), '[]'::jsonb)
             || case when v_n > 0 then jsonb_build_array(jsonb_build_object('id', 'cuadre', 'ok', false,
                  'texto', 'Por aclarar: la liquidación no cuadra al leer (' || (select string_agg(a #>> '{}', ' ') from jsonb_array_elements(v_avisos) a) || ')')) else '[]'::jsonb end
             || case when v_solape is not null then jsonb_build_array(jsonb_build_object('id', 'solape', 'ok', false,
                  'texto', 'Por aclarar: ' || v_solape || ': esta factura puede repetir cargos ya facturados.')) else '[]'::jsonb end;
    update public.supplier_invoice set reading = jsonb_set(coalesce(reading, '{}'::jsonb), '{requisitos}', v_req), updated_at = now()
     where id = v_cs.commission_invoice_id;
  end if;
end $$;
revoke all on function public._conta_liquidacion_marcar(uuid) from public, anon, authenticated;

create or replace function public.conta_liquidacion_factura_proponer(p_settlement uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cs public.channel_settlement; v_e uuid; v_f jsonb; v_sup uuid; v_rol public.party_role; v_inv uuid; v_410 text;
  v_c623 text; v_c627 text; v_tasa uuid; v_fecha date; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Liquidación por correo');
  v_base numeric; v_iva numeric; v_total numeric; v_bc numeric; v_ba numeric; v_sem int;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement for update;
  if v_cs.id is null then raise exception 'Esa liquidación no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_cs.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone facturas.' using errcode = '42501';
  end if;
  if v_cs.commission_invoice_id is not null then
    return jsonb_build_object('estado', 'ya_estaba', 'factura_id', v_cs.commission_invoice_id, 'texto', 'La factura de comisión ya estaba.');
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
revoke all on function public.conta_liquidacion_factura_proponer(uuid, text) from public, anon;
grant execute on function public.conta_liquidacion_factura_proponer(uuid, text) to authenticated, service_role;

drop function if exists public._conta_corte(uuid);
alter table public.channel_settlement drop column if exists is_reference;
