-- supabase/migrations/20261101T0845_s01j_comision_del_correo.sql
--
-- S01j · Las liquidaciones de Glovo y Just Eat entran solas por correo.
--
--   1. conta_comision_del_correo(liquidación, datos): la factura de comisión
--      que viene ESCRITA en el correo de la liquidación (Just Eat: número, fecha,
--      base, IVA y total en el cuerpo, sin adjunto), como una recibida «Por
--      revisar», con su número y su línea de comisión. La misma factura (mismo
--      proveedor y número) no se crea dos veces. Si no suma, se crea igual en
--      revisión y dice por qué: no se inventa ninguna cifra. Su liquidación la
--      liga el S01i (_conta_comision_ligar); al validarla, queda pagada por
--      compensación. Solo la llama la entrada de correo (rol de servicio).
--   2. conta_correo_releer_lista(empresa, correos, remitente): qué correos de
--      la empresa puede volver a leer quien lo pide (administración o encargado):
--      los que nombra, o los de Glovo o Just Eat (como mucho 60, los últimos).
--
-- Solo añade: dos funciones nuevas. Ninguna fila cambia al aplicarla.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0845_s01j_comision_del_correo.down.sql

create or replace function public.conta_comision_del_correo(p_settlement uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_cs public.channel_settlement; v_e uuid; v_rol public.party_role; v_sup uuid; v_num text; v_clave text;
  v_base numeric; v_iva numeric; v_total numeric; v_ya uuid; v_inv uuid; v_410 text; v_c623 text; v_tasa uuid;
  v_cuadra boolean; v_fecha date; v_porque text; v_periodo text;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement;
  if v_cs.id is null then return jsonb_build_object('estado', 'no', 'factura_id', null, 'texto', 'No está la liquidación.'); end if;
  v_num := nullif(btrim(p->'factura'->>'numero'), '');
  v_base := nullif(p->'factura'->>'base', '')::numeric; v_iva := nullif(p->'factura'->>'iva', '')::numeric; v_total := nullif(p->'factura'->>'total', '')::numeric;
  if v_num is null or v_total is null then
    return jsonb_build_object('estado', 'sin_factura', 'factura_id', null, 'texto', 'El correo no trae su factura de comisión.');
  end if;
  select company_id into v_e from public.platform_store where id = v_cs.store_id;
  if v_e is null then return jsonb_build_object('estado', 'sin_empresa', 'factura_id', null, 'texto', 'La liquidación no dice de qué empresa es: la factura no se ha creado.'); end if;

  -- El proveedor: el de la plataforma del canal (su tercero → su ficha de proveedor).
  select * into v_rol from public.party_role where account_id = v_cs.account_id and role = 'platform' and channel_id = v_cs.channel_id order by created_at limit 1;
  select supplier_id into v_sup from public.party_role where account_id = v_cs.account_id and role = 'supplier' and party_id = v_rol.party_id order by created_at limit 1;
  if v_sup is null then
    return jsonb_build_object('estado', 'falta_proveedor', 'factura_id', null,
      'texto', 'La plataforma no tiene ficha de proveedor: su factura de comisión no se ha creado.');
  end if;

  -- La misma factura (el mismo proveedor y el mismo número): no se crea otra.
  v_clave := upper(regexp_replace(v_num, '[^A-Za-z0-9]', '', 'g'));
  select id into v_ya from public.supplier_invoice
   where account_id = v_cs.account_id and supplier_id = v_sup and status <> 'descartada'
     and upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
   order by created_at limit 1;
  if v_ya is not null then
    return jsonb_build_object('estado', 'ya_estaba', 'factura_id', v_ya, 'texto', format('Su factura de comisión %s ya estaba.', v_num));
  end if;

  v_cuadra := v_base is not null and v_iva is not null and round(v_base * 100) + round(v_iva * 100) = round(v_total * 100);
  v_porque := case when v_base is null or v_iva is null then 'La factura del correo no dice su base o su IVA: revísala con el correo.'
                   when not v_cuadra then format('La factura no suma: base %s + IVA %s no es el total %s. Revísala con el correo.',
                     public.conta_euros_exactos(v_base), public.conta_euros_exactos(v_iva), public.conta_euros_exactos(v_total)) end;
  v_fecha := coalesce(case when p->>'fecha_factura' ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'fecha_factura')::date end, v_cs.period_to, v_cs.settlement_date);
  v_periodo := case when v_cs.period_from is not null then format('del %s al %s', to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM/YYYY')) else 'sin periodo' end;

  -- La cuenta: la que diga la plataforma; si no, la 623x aprendida del libro; si no, la de la plantilla.
  select a.code into v_410 from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = v_e and l.entity = 'supplier' and l.entity_id = v_sup::text and l.role = 'principal' limit 1;
  v_c623 := coalesce(nullif(btrim(v_rol.commission_account_code), ''), public._conta_cuenta_aprendida(v_e, v_410, '623'),
                     (select code from public.company_account where company_id = v_e and kind = 'template' and template_code = '623' order by code limit 1));
  select id into v_tasa from public.tax_rate where code = 'iva_general' and is_system order by valid_to desc nulls first limit 1;

  insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, brand_id, doc_kind, invoice_number, invoice_date, status, source,
                                       arrival_channel, tax_base_total, tax_total, grand_total, needs_review, notes, reading, reading_confidence, created_by_name)
  values (v_cs.account_id, v_e, v_sup, v_cs.location_id, v_cs.brand_id, 'invoice', v_num, v_fecha, 'en_revision', 'liquidacion', 'correo',
          coalesce(v_base, 0), coalesce(v_iva, 0), v_total, not coalesce(v_cuadra, false),
          coalesce(v_porque, format('Leída del correo de la liquidación %s.', v_periodo)),
          jsonb_build_object('origen', 'correo_liquidacion', 'liquidacion_id', v_cs.id, 'email_id', nullif(p->>'email_id', ''),
            'factura', jsonb_build_object('numero', v_num, 'fecha', v_fecha,
              'periodo', jsonb_build_object('desde', v_cs.period_from, 'hasta', v_cs.period_to),
              'tienda', jsonb_build_object('nombre', nullif(p->>'tienda', ''))),
            'requisitos', case when v_porque is not null then jsonb_build_array(jsonb_build_object('id', 'cuadra', 'ok', false, 'texto', v_porque)) else '[]'::jsonb end,
            'avisos', coalesce(p->'avisos', '[]'::jsonb)),
          case when coalesce(v_cuadra, false) then 'probable' else 'duda' end, 'Sumied · leída del correo')
  returning id into v_inv;
  if v_base is not null then
    insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, expense_account_code, position)
    values (v_inv, 'Comisión y cargos de la plataforma', 1, v_base, v_base, 21, v_c623, 1);
  end if;
  if v_base is not null and v_iva is not null then
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
    values (v_cs.account_id, v_inv, v_tasa, 21, v_base, v_iva);
  end if;
  -- Su liquidación es ésta: se liga (S01i). Se paga por compensación al validarla.
  perform public._conta_comision_ligar(v_inv, v_cs.id, 'sumied', null);
  return jsonb_build_object('estado', case when v_porque is null then 'creada' else 'en_revision' end, 'factura_id', v_inv,
    'texto', case when v_porque is null
      then format('Su factura de comisión %s (%s) está en «Por revisar», ligada a su liquidación.', v_num, public.conta_euros_exactos(v_total))
      else format('Su factura de comisión %s está en «Por revisar»: %s', v_num, v_porque) end);
end $$;
revoke all on function public.conta_comision_del_correo(uuid, jsonb) from public, anon, authenticated;

create or replace function public.conta_correo_releer_lista(p_company uuid, p_email_ids text[] default null, p_remitente text default null)
returns text[] language plpgsql stable security definer set search_path to 'public' as $$
declare v_acc uuid; v text[];
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta vuelve a leer correos.' using errcode = '42501';
  end if;
  if p_email_ids is null and coalesce(btrim(p_remitente), '') = '' then raise exception 'Di qué correos hay que volver a leer.' using errcode = '22023'; end if;
  if p_remitente is not null and p_remitente not in ('glovo', 'justeat') then raise exception 'Solo se vuelve a leer todo lo de Glovo o de Just Eat.' using errcode = '22023'; end if;
  select coalesce(array_agg(x.email_id order by x.received_at), '{}'::text[]) into v from (
    select l.email_id, l.received_at from public.inbound_email_log l
     where l.company_id = p_company and l.outcome <> 'confirmacion'
       and (l.email_id = any(coalesce(p_email_ids, '{}'::text[]))
            or (p_remitente = 'glovo' and (l.from_address ~* 'glovo' or l.subject ~* 'glovo'))
            or (p_remitente = 'justeat' and (l.from_address ~* 'just-?eat' or l.subject ~* 'just-?eat')))
     order by l.received_at desc limit 60) x;
  return v;
end $$;
revoke all on function public.conta_correo_releer_lista(uuid, text[], text) from public, anon;
grant execute on function public.conta_correo_releer_lista(uuid, text[], text) to authenticated;
