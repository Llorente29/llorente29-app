-- supabase/vuelta-atras/20261026T0146_v03_ventas_sin_iva.down.sql
--
-- Vuelta atrás de 20261026T0146_v03_ventas_sin_iva: las cuatro funciones,
-- como están en producción antes de la tanda, con la misma firma. Cada cuerpo
-- es el de su migración de origen, que casa byte a byte con prosrc de
-- producción (26/10, md5 del cuerpo):
--   conta_venta_guardar           04a94c4aaa0706233888b417630c6a0b (20261024T1441)
--   conta_venta_emitir            99be83503411f6587bba11dc7a12a401 (20261024T1441)
--   conta_motivos_para_validar    ddc58afc55de46de899c47efa8579c10 (20261125T0300)
--   conta_vat_book_desde_asiento  c8d6c25449892cb2ffc4fefc9be2a0c8 (20261208T0850)
--
-- No toca datos. Las facturas sin IVA ya emitidas se quedan como están, con su
-- asiento y su libro; a partir de la vuelta atrás no se puede guardar ninguna
-- nueva (como antes) y un asiento con un apunte exento deja de validarse.

create or replace function public.conta_venta_guardar(p_company uuid, p_id uuid, p_datos jsonb, p_lineas jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_f public.customer_invoice; v_id uuid := p_id; v_l jsonb; v_pos int := 0; v_t public.tax_rate; v_cta uuid;
  v_cli jsonb := '{}'::jsonb; v_party uuid := nullif(p_datos->>'cliente_id', '')::uuid; v_cifras jsonb; v_nuevo boolean := p_id is null;
  v_cant numeric; v_precio numeric; v_dto numeric;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta hace facturas.' using errcode = '42501';
  end if;
  if v_party is not null then
    select jsonb_strip_nulls(jsonb_build_object('nombre', coalesce(f.legal_name, p.name), 'nif', p.tax_id, 'tipo_nif', f.tax_id_type, 'pais', coalesce(f.country_code, 'ES'),
             'calle', f.fiscal_street, 'cp', f.fiscal_postal_code, 'ciudad', f.fiscal_city, 'provincia', f.fiscal_province,
             'nif_comprobado', f.tax_id_check_status = 'valid'))
      into v_cli from public.party p left join public.customer_fiscal f on f.party_id = p.id
     where p.id = v_party and p.account_id = v_cuenta;
    if v_cli is null then raise exception 'Ese cliente no es de esta cuenta.' using errcode = '22023'; end if;
  end if;

  if v_id is null then
    insert into public.customer_invoice (account_id, company_id, created_by, created_by_name)
    values (v_cuenta, p_company, auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
    returning id into v_id;
  end if;
  select * into v_f from public.customer_invoice where id = v_id for update;
  if v_f.company_id is distinct from p_company then raise exception 'Esa factura no es de esta empresa.' using errcode = '22023'; end if;
  if v_f.status <> 'borrador' then raise exception 'La factura % ya está emitida: no se cambia. Se corrige con «Corregir».', v_f.number_text using errcode = '23514'; end if;

  -- El recargo de equivalencia aún no: hoy ninguna 477 se valida sin su tipo
  -- y su cuota, y el 303 no sabe dónde va el recargo («recargo» en
  -- conta_impuesto_303_cajas). La columna queda preparada; se abre con su
  -- propio encargo.
  if coalesce((p_datos->>'recargo')::boolean, false) then
    raise exception 'El recargo de equivalencia todavía no se puede facturar desde Sumied: el libro y el 303 aún no saben llevarlo.' using errcode = '0A000';
  end if;

  -- V01 entrega 2: la de un cierre (la rectificativa de una resumen) no lleva
  -- cliente de Contactos: se queda con el suyo («Ventas del día · canal»).
  update public.customer_invoice set
    party_id = case when v_f.origin = 'cierre_dia' then v_f.party_id else v_party end,
    customer = case when v_f.origin = 'cierre_dia' then v_f.customer
                    else coalesce(v_cli, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('correo', nullif(btrim(p_datos->>'correo'), ''))) end,
    issue_date = coalesce(nullif(p_datos->>'fecha', '')::date, issue_date),
    due_date = nullif(p_datos->>'vence', '')::date,
    series_code = case when v_f.doc_type = 'rectificativa' then 'R' else coalesce(nullif(upper(btrim(p_datos->>'serie')), ''), 'F') end,
    payment_method_id = nullif(p_datos->>'forma_cobro_id', '')::uuid,
    location_id = nullif(p_datos->>'local_id', '')::uuid,
    notes = nullif(btrim(p_datos->>'notas'), ''),
    email_to = nullif(btrim(p_datos->>'correo'), ''),
    withholding_rate_id = nullif(p_datos->>'retencion_id', '')::uuid,
    surcharge = coalesce((p_datos->>'recargo')::boolean, false),
    correction_reason = case when v_f.doc_type = 'rectificativa' then coalesce(nullif(btrim(p_datos->>'motivo'), ''), correction_reason) else null end
  where id = v_id;

  -- Las líneas, de nuevo enteras (una rectificativa para anular no tiene líneas que cambiar).
  if v_f.correction_kind is distinct from 'anular' then
    delete from public.customer_invoice_line where invoice_id = v_id;
    for v_l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
      v_pos := v_pos + 1;
      select * into v_t from public.tax_rate where id = (v_l->>'tipo_id')::uuid;
      if v_t.id is null or (v_t.company_id is not null and v_t.company_id <> p_company) then
        raise exception 'La línea %: ese tipo de IVA no existe.', v_pos using errcode = '22023';
      end if;
      if v_t.treatment <> 'taxed' then
        raise exception 'La línea %: «%» aún no se puede facturar aquí (solo IVA general, reducido o superreducido).', v_pos, v_t.name using errcode = '22023';
      end if;
      select id into v_cta from public.company_account where id = (v_l->>'cuenta_id')::uuid and company_id = p_company and code like '7%';
      if v_cta is null then raise exception 'La línea %: la cuenta de ventas no es de esta empresa.', v_pos using errcode = '22023'; end if;
      v_cant := coalesce((v_l->>'cantidad')::numeric, 1);
      v_precio := coalesce((v_l->>'precio')::numeric, 0);
      v_dto := coalesce((v_l->>'descuento')::numeric, 0);
      insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, discount_pct,
                                             tax_rate_id, tax_pct, surcharge_pct, revenue_account_id, amount)
      values (v_cuenta, p_company, v_id, v_pos, btrim(v_l->>'concepto'), v_cant, v_precio, v_dto,
              v_t.id, v_t.rate, v_t.surcharge_rate, v_cta, round(v_cant * v_precio * (1 - v_dto / 100), 2));
    end loop;
  end if;

  v_cifras := case when v_f.doc_type = 'rectificativa' then public._conta_venta_diferencia(v_id) else public._conta_venta_cifras(v_id) end;
  update public.customer_invoice set base = (v_cifras->>'base')::numeric, tax = (v_cifras->>'iva')::numeric, surcharge_amount = (v_cifras->>'recargo')::numeric,
         withholding_amount = (v_cifras->>'retencion')::numeric, total = (v_cifras->>'total')::numeric
   where id = v_id;
  if v_nuevo then
    perform public._conta_venta_evento(v_id, 'creada', 'Borrador creado a mano.', null, p_quien_nombre);
  end if;
  return jsonb_build_object('id', v_id, 'nuevo', v_nuevo, 'total', (v_cifras->>'total')::numeric, 'lineas', v_pos);
end $$;

create or replace function public.conta_venta_emitir(p_id uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_orig public.customer_invoice; v_c jsonb; v_anio int; v_num int; v_texto text; v_serie text; v_digitos int := 4;
  v_empieza int; v_por_anio boolean; v_cta430 text; v_r jsonb; v_lineas jsonb := '[]'::jsonb; v_x jsonb; v_cta text; v_cta477 text; v_cta473 text; v_entry uuid; v_val jsonb;
  v_nombre text; v_signo numeric; v_prev text; v_hash text; v_emisor text; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_tipo_libro text; v_nif text; v_esta jsonb; v_cierre boolean;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta emite facturas.' using errcode = '42501';
  end if;
  if v_f.status <> 'borrador' then raise exception 'La factura % ya está emitida.', v_f.number_text using errcode = '23514'; end if;
  -- V01 entrega 2: una factura resumen de un cierre no lleva cliente; se emite
  -- al validar su cierre, y aquí solo llega su rectificativa.
  v_cierre := v_f.origin = 'cierre_dia';
  if v_cierre and v_f.doc_type <> 'rectificativa' then
    raise exception 'Una factura resumen se emite al validar su cierre, en Ventas › Cierres del día.' using errcode = '23514';
  end if;
  v_nombre := v_f.customer->>'nombre';
  v_nif := v_f.customer->>'nif';
  if not v_cierre then
    if v_f.party_id is null then raise exception 'Falta el cliente: elige uno de Contactos o dalo de alta.' using errcode = '23514'; end if;
    if coalesce(btrim(v_nif), '') = '' then
      raise exception 'Falta el NIF de %: una factura lo lleva. Ponlo en su ficha de Contactos.', coalesce(v_nombre, 'el cliente') using errcode = '23514';
    end if;
  end if;

  if v_f.doc_type = 'rectificativa' then
    select * into v_orig from public.customer_invoice where id = v_f.corrects_id;
    if v_orig.status <> 'emitida' then raise exception 'La factura que se corrige (%) no está emitida o ya está anulada.', v_orig.number_text using errcode = '23514'; end if;
    if coalesce(btrim(v_f.correction_reason), '') = '' then raise exception 'Falta el motivo de la corrección: va en la factura.' using errcode = '23514'; end if;
    v_c := public._conta_venta_diferencia(p_id);
    if v_f.correction_kind = 'importes' and (v_c->>'total')::numeric = 0 and (v_c->>'base')::numeric = 0 then
      raise exception 'Las líneas son iguales que las de %: no hay nada que corregir.', v_orig.number_text using errcode = '23514';
    end if;
  else
    if not exists (select 1 from public.customer_invoice_line where invoice_id = p_id) then raise exception 'La factura no tiene líneas.' using errcode = '23514'; end if;
    v_c := public._conta_venta_cifras(p_id);
    if (v_c->>'total')::numeric <= 0 then raise exception 'El total de la factura es %: una factura va en positivo (para restar, «Corregir» la que toca).', v_c->>'total' using errcode = '23514'; end if;
  end if;

  -- El número: su serie (la de la empresa en Numeración, si la tiene: sus
  -- cifras, por dónde empieza y si vuelve a 1 cada año; si no, 4 cifras, desde
  -- el 1 y por año) y el año de la fecha.
  v_serie := v_f.series_code;
  select digits, starts_at, reset_yearly into v_digitos, v_empieza, v_por_anio
    from public.invoice_series where company_id = v_f.company_id and code = v_serie and is_active;
  v_digitos := coalesce(v_digitos, 4); v_empieza := coalesce(v_empieza, 1); v_por_anio := coalesce(v_por_anio, true);
  v_anio := extract(year from v_f.issue_date)::int;
  insert into public.customer_invoice_counter (company_id, account_id, series_code, fiscal_year, last_number)
  values (v_f.company_id, v_f.account_id, v_serie, case when v_por_anio then v_anio else 0 end, v_empieza)
  on conflict (company_id, series_code, fiscal_year) do update set last_number = public.customer_invoice_counter.last_number + 1
  returning last_number into v_num;
  v_texto := v_serie || '-' || case when v_por_anio then v_anio || '/' else '' end || lpad(v_num::text, v_digitos, '0');

  -- La 430 del cliente: la suya, o una nueva de la 4300 con su nombre. La de
  -- una factura resumen, la del canal: la que cobra en el asiento de su cierre.
  if v_cierre then
    select a.code into v_cta430 from public.journal_line l join public.company_account a on a.id = l.company_account_id
     where l.entry_id = v_orig.entry_id and a.code like '43%' and l.debit > 0 order by l.debit desc, l.position limit 1;
    if v_cta430 is null then raise exception 'No encuentro la 430 del canal en el asiento de la %.', v_orig.number_text using errcode = '23514'; end if;
  end if;
  if v_cta430 is null then
  select a.code into v_cta430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_f.company_id and k.entity = 'customer' and k.entity_id = v_f.party_id::text and k.role = 'principal' limit 1;
  if v_cta430 is null then
    v_r := public.company_account_add(v_f.company_id, '4300', 'Clientes · ' || coalesce(v_nombre, 'cliente'), null, 'customer', v_f.party_id::text, v_quien, 'manual');
    v_cta430 := v_r->>'code';
  end if;
  end if;

  -- El asiento: 430 por el total; 70x por cuenta; 477 por tipo (con su libro);
  -- el recargo a la misma 477, sin libro; la retención a la 473. Una
  -- rectificativa en negativo pone cada importe en el otro lado.
  v_signo := case when (v_c->>'total')::numeric < 0 then -1 else 1 end;
  if (v_c->>'total')::numeric <> 0 then
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta430, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Factura ' || v_texto,
      'debe', case when v_signo > 0 then (v_c->>'total')::numeric else 0 end, 'haber', case when v_signo < 0 then -(v_c->>'total')::numeric else 0 end));
  end if;
  for v_x in select * from jsonb_array_elements(v_c->'cuentas') loop
    select code into v_cta from public.company_account where id = (v_x->>'cuenta_id')::uuid;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Factura ' || v_texto,
      'haber', greatest((v_x->>'base')::numeric, 0), 'debe', greatest(-(v_x->>'base')::numeric, 0)));
  end loop;
  for v_x in select * from jsonb_array_elements(v_c->'tipos') loop
    select a.code into v_cta477 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
     where k.company_id = v_f.company_id and k.entity = 'tax_rate' and k.entity_id = v_x->>'tipo_id' and k.role = 'repercutido' limit 1;
    if v_cta477 is null then
      select code into v_cta477 from public.company_account where company_id = v_f.company_id and code like '477%' and code <> '47700000'
         and (name ilike '%' || to_char((v_x->>'pct')::numeric, 'FM990') || ' %%' or name ilike '%' || to_char((v_x->>'pct')::numeric, 'FM990') || '%') order by code limit 1;
    end if;
    if v_cta477 is null then raise exception 'Falta en tu plan la 477 del IVA repercutido al % %%.', to_char((v_x->>'pct')::numeric, 'FM990D##') using errcode = '23514'; end if;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta477, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'IVA factura ' || v_texto,
      'haber', greatest((v_x->>'iva')::numeric, 0), 'debe', greatest(-(v_x->>'iva')::numeric, 0),
      'iva', jsonb_build_object('tipo_id', v_x->>'tipo_id', 'base', abs((v_x->>'base')::numeric), 'libro', 'issued', 'facturas', 1)));
    if (v_x->>'rec')::numeric <> 0 then
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta477, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Recargo de equivalencia factura ' || v_texto,
        'haber', greatest((v_x->>'rec')::numeric, 0), 'debe', greatest(-(v_x->>'rec')::numeric, 0)));
    end if;
  end loop;
  if (v_c->>'retencion')::numeric <> 0 then
    -- La retención que te hace el cliente es un pago a cuenta TUYO: 473. El
    -- enlace «retención → cuenta» de la empresa es el de las compras (4751, la
    -- que tú ingresas por otros), y aquí no vale.
    select code into v_cta473 from public.company_account where company_id = v_f.company_id and coalesce(template_code, code) like '473%' order by code limit 1;
    if v_cta473 is null then
      v_r := public.company_account_add(v_f.company_id, '4730', 'Retenciones que te hacen tus clientes', null, null, null, v_quien, 'manual');
      v_cta473 := v_r->>'code';
    end if;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta473, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Retención factura ' || v_texto,
      'debe', greatest((v_c->>'retencion')::numeric, 0), 'haber', greatest(-(v_c->>'retencion')::numeric, 0)));
  end if;

  -- Cada apunte, con el local de la factura o «común» (la analítica por local lo pide al validar).
  select coalesce(jsonb_agg(x || case when v_f.location_id is not null then jsonb_build_object('local_id', v_f.location_id) else jsonb_build_object('comun', true) end order by i), '[]'::jsonb)
    into v_lineas from jsonb_array_elements(v_lineas) with ordinality as t(x, i);
  if jsonb_array_length(v_lineas) > 0 then
    v_r := public._journal_entry_proponer(v_f.company_id,
      jsonb_build_object('series', 1, 'fecha', v_f.issue_date, 'source_type', 'customer_invoice', 'source_id', p_id,
        'concepto', 'Factura ' || v_texto || ' · ' || coalesce(v_nombre, ''), 'party_id', v_f.party_id, 'documento', v_texto, 'fecha_documento', v_f.issue_date,
        'confianza', 'seguro', 'porque', 'Factura de venta emitida en Sumied.'),
      v_lineas, null, v_quien, auth.uid());
    v_entry := (v_r->>'id')::uuid;
    v_val := public.journal_entry_validar(v_entry, v_quien);
    -- Lo que el libro no sabe de una factura de venta: el tipo, la que corrige,
    -- el recargo y la retención (la primera anotación lleva la retención entera).
    -- La rectificativa de una resumen (simplificadas) es R5.
    v_tipo_libro := case when v_f.doc_type = 'rectificativa' then case when v_cierre then 'R5' else 'R4' end else 'F1' end;
    update public.vat_book_entry v set invoice_type = v_tipo_libro,
           corrects_ref = case when v_f.doc_type = 'rectificativa' then v_orig.number_text end,
           counterpart_name = coalesce(v_nombre, v.counterpart_name),
           surcharge_amount = (select nullif((t->>'rec')::numeric, 0) from jsonb_array_elements(v_c->'tipos') t
                                where t->>'tipo_id' = (select jl.tax_rate_id::text from public.journal_line jl where jl.id = v.line_id)),
           updated_at = now()
     where v.entry_id = v_entry;
    if (v_c->>'retencion')::numeric <> 0 then
      update public.vat_book_entry set withholding_rate = (v_c->>'retencion_pct')::numeric, withholding_amount = (v_c->>'retencion')::numeric
       where id = (select id from public.vat_book_entry where entry_id = v_entry order by created_at, id limit 1);
    end if;
  end if;

  -- La huella encadenada con la emitida anterior de la empresa (para Verifactu).
  select hash into v_prev from public.customer_invoice where company_id = v_f.company_id and status <> 'borrador' and hash is not null order by issued_at desc, id desc limit 1;
  select tax_id into v_emisor from public.company where id = v_f.company_id;
  v_hash := encode(sha256(convert_to(concat_ws('|', v_emisor, v_texto, v_f.issue_date::text, (v_c->>'total')::numeric::text, coalesce(v_prev, '')), 'UTF8')), 'hex');

  update public.customer_invoice set status = 'emitida', fiscal_year = v_anio, number = v_num, number_text = v_texto,
         base = (v_c->>'base')::numeric, tax = (v_c->>'iva')::numeric, surcharge_amount = (v_c->>'recargo')::numeric,
         withholding_amount = (v_c->>'retencion')::numeric, total = (v_c->>'total')::numeric,
         due_date = coalesce(v_f.due_date, v_f.issue_date), entry_id = v_entry, prev_hash = v_prev, hash = v_hash,
         issued_at = now(), issued_by_name = v_quien
   where id = p_id;

  perform public._conta_venta_evento(p_id, 'emitida',
    'Emitida con el nº ' || v_texto || coalesce(' y su asiento nº ' || (v_val->>'numero'), ' (sin asiento: no cambia importes)') || '.',
    jsonb_build_object('asiento', v_entry, 'numero_asiento', v_val->'numero'), v_quien);
  if v_f.doc_type = 'rectificativa' then
    perform public._conta_venta_evento(v_f.corrects_id, 'corregida',
      'Corregida con la ' || v_texto || ' (' || case v_f.correction_kind when 'anular' then 'anulada entera' when 'datos' then 'datos del cliente' else 'importes o líneas' end || '): ' || v_f.correction_reason || '.',
      jsonb_build_object('rectificativa', p_id), v_quien);
    if v_f.correction_kind = 'anular' then
      update public.customer_invoice set status = 'anulada' where id = v_f.corrects_id;
    end if;
  end if;

  select jsonb_build_object('id', p_id, 'numero', v_texto, 'total', (v_c->>'total')::numeric, 'asiento', v_entry, 'numero_asiento', v_val->'numero') into v_esta;
  return v_esta;
end $$;

create or replace function public.conta_motivos_para_validar(p_entry uuid)
returns table (orden int, codigo text, motivo text)
language plpgsql
stable
set search_path = public
as $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_n int; v_debe numeric; v_haber numeric; v_cierre boolean; v_mal text; v_aclarar int; v_lista text;
  v_local boolean; v_liquidacion boolean;
  v_hay_isp boolean; v_isp_472 numeric; v_auto_477 numeric; v_p record; v_contra text;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null then return; end if;

  -- Regla 1: cuadra, al céntimo.
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber
    from public.journal_line where entry_id = p_entry;
  if v_n < 2 then
    orden := 1; codigo := 'pocos_apuntes'; motivo := 'Un asiento lleva al menos dos apuntes.'; return next;
  end if;
  if v_debe <> v_haber then
    orden := 2; codigo := 'no_cuadra';
    motivo := format('No cuadra: Debe %s y Haber %s, diferencia %s.', v_debe, v_haber, v_debe - v_haber); return next;
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_e.entry_date not between v_y.starts_on and v_y.ends_on then
    orden := 3; codigo := 'fuera_del_ejercicio';
    motivo := format('La fecha %s no es del ejercicio %s.', to_char(v_e.entry_date, 'DD/MM/YYYY'), v_y.code); return next;
  end if;
  if v_e.source_type <> 'migrated' then
    if v_y.status <> 'open' then
      orden := 4; codigo := 'ejercicio_cerrado'; motivo := format('El ejercicio %s está cerrado.', v_y.code); return next;
    end if;
    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      orden := 5; codigo := 'falta_historico';
      motivo := format('Primero hay que traer el histórico de %s de %s.',
        case lower(v_y.origin_program) when 'diez' then 'Diez' else v_y.origin_program end, v_y.code); return next;
    end if;
    if v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until then
      orden := 6; codigo := 'traido';
      motivo := format('Hasta el %s el ejercicio %s es traído de %s: la fecha abierta más cercana es el %s.',
        to_char(v_y.imported_until, 'DD/MM/YYYY'), v_y.code, v_y.origin_program,
        to_char(public.conta_primer_dia_abierto(v_e.company_id, v_y.imported_until + 1), 'DD/MM/YYYY')); return next;
    end if;
    if public.conta_mes_cerrado(v_e.company_id, v_e.entry_date) then
      orden := 7; codigo := 'mes_cerrado';
      motivo := format('El mes de %s está cerrado: la fecha abierta más cercana es el %s.',
        to_char(v_e.entry_date, 'MM/YYYY'),
        coalesce(to_char(public.conta_primer_dia_abierto(v_e.company_id, v_e.entry_date), 'DD/MM/YYYY'), 'ninguna')); return next;
    end if;

    -- C05 (respuesta 3), copiado de la vigente: un asiento de cierre o de
    -- apertura del generador de cierre (o su contraasiento) se libra de las
    -- reglas de IVA y retención.
    v_cierre := exists (
      select 1 from public.journal_entry o
        join public.fiscal_year oy on oy.id = o.fiscal_year_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.source_type in ('closing', 'opening')
         and coalesce(o.reasons, '[]'::jsonb) @> '[{"decision": "cierre-del-ejercicio"}]'::jsonb
         and exists (
           select 1 from public.fiscal_year_closing c
            where c.company_id = o.company_id
              and ((o.source_type = 'closing' and c.fiscal_year_id = o.fiscal_year_id
                    and o.id in (c.regularization_entry_id, c.closing_entry_id))
                or (o.source_type = 'opening' and c.opening_entry_id = o.id
                    and exists (select 1 from public.fiscal_year a
                                 where a.id = c.fiscal_year_id and a.ends_on + 1 = oy.starts_on)))));

    -- I01b (0180): el asiento de liquidación de un 303 (o su contraasiento)
    -- salda la 477 y la 472 del periodo: sus apuntes no llevan tipo ni libro
    -- registro. Solo si su origen es una declaración 303 de su misma empresa.
    v_liquidacion := exists (
      select 1 from public.journal_entry o
        join public.tax_return t on t.id = o.source_id and t.company_id = o.company_id and t.account_id = o.account_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.company_id = v_e.company_id
         and o.source_type = 'vat_settlement'
         and t.form_code = '303');

    -- S01 (0140): el local solo se pide si el eje «local» de la empresa está encendido
    -- (conta_eje_analitico; sin fila = apagado). Lo demás, como estaba.
    v_local := exists (select 1 from public.conta_eje_analitico x
                        where x.company_id = v_e.company_id and x.account_id = v_e.account_id and x.eje = 'local' and x.activo);

    -- I01d (0300): ¿lleva el asiento IVA autoliquidado? (una 472 con el tipo
    -- «Compra en otro país de la UE» o «Inversión del sujeto pasivo»). Su 477
    -- de autorrepercusión va SIN tipo ni libro registro, como la trae Diez:
    -- la regla 10 de abajo la casa con la 472 al céntimo.
    v_hay_isp := exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                           join public.tax_rate t on t.id = l.tax_rate_id
                          where l.entry_id = p_entry and a.template_code like '472%' and t.treatment in ('intra_eu', 'reverse_charge'));

    -- Regla 5, copiada de la vigente (20261113T0100: el céntimo de redondeo).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre and not v_liquidacion
             and not (a.template_code like '477%' and v_hay_isp)
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
          then 'una retención lleva su tipo, su base y su modelo'
        when v_local and not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then
      orden := 8; codigo := 'apuntes'; motivo := format('No se valida: %s.', v_mal); return next;
    end if;

    -- I01d (0300), regla 10 · LA AUTOLIQUIDACIÓN. (a) La 477 de la
    -- autorrepercusión (sin tipo) suma lo mismo que la 472 autoliquidada, al
    -- céntimo. (b) En una factura de proveedor, el tipo de cada línea de IVA
    -- es el que dice su ficha (país, NIF-IVA y régimen de IVA): si lo
    -- contradice, no se valida y se dice por qué.
    select coalesce(sum(l.debit - l.credit) filter (where a.template_code like '472%' and t.treatment in ('intra_eu', 'reverse_charge')), 0),
           coalesce(sum(l.credit - l.debit) filter (where a.template_code like '477%' and l.tax_rate_id is null), 0)
      into v_isp_472, v_auto_477
      from public.journal_line l join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
     where l.entry_id = p_entry;
    if v_hay_isp and v_isp_472 <> v_auto_477 then
      orden := 10; codigo := 'autorrepercusion';
      motivo := format('No se valida: falta la autorrepercusión. El IVA autoliquidado de la 472 suma %s y la 477 sin tipo, %s: tienen que ser lo mismo (el IVA lo declaras y lo deduces tú).',
                       public.conta_impuesto_euros(v_isp_472), public.conta_impuesto_euros(v_auto_477)); return next;
    elsif not v_hay_isp and v_auto_477 <> 0 and not v_cierre and not v_liquidacion then
      orden := 10; codigo := 'autorrepercusion';
      motivo := 'No se valida: hay una 477 sin tipo y ninguna compra autoliquidada en el asiento. Un apunte de IVA lleva base, tipo y libro registro.'; return next;
    end if;
    if v_e.source_type = 'supplier_invoice' then
      select s.name, s.country_code, public.conta_proveedor_iva_clase(s.country_code, s.tax_id_type, s.tax_id, s.tax_id_check_status, s.vat_regime) as clase
        into v_p
        from public.supplier_invoice si join public.supplier s on s.id = si.supplier_id and s.account_id = si.account_id
       where si.id = v_e.source_id and si.account_id = v_e.account_id;
      if found then
        select string_agg(format('el apunte %s lleva «%s»', l.position, t.name), ', ' order by l.position) into v_contra
          from public.journal_line l join public.tax_rate t on t.id = l.tax_rate_id
         where l.entry_id = p_entry and l.vat_book in ('received', 'investment')
           and not case v_p.clase
                 when 'intracomunitaria' then t.treatment = 'intra_eu'
                 when 'isp_extranjero' then t.treatment = 'reverse_charge'
                 when 'isp_nacional' then t.treatment = 'reverse_charge'
                 when 'nacional' then t.treatment in ('taxed', 'exempt', 'not_subject')
                 else false end;
        if v_contra is not null then
          orden := 11; codigo := 'tipo_contra_pais';
          motivo := 'No se valida: ' || v_contra || '. ' || v_p.name || ' ' || case v_p.clase
            when 'intracomunitaria' then 'es de ' || public.conta_pais_nombre(v_p.country_code) || ' y tiene NIF-IVA europeo: su compra es intracomunitaria y va con «Compra en otro país de la UE» (el IVA lo declaras tú).'
            when 'isp_extranjero' then 'es de fuera de la UE (' || public.conta_pais_nombre(v_p.country_code) || '): su compra va con «Inversión del sujeto pasivo» (el IVA lo declaras tú).'
            when 'isp_nacional' then 'está marcado con inversión del sujeto pasivo en su ficha: su compra va con «Inversión del sujeto pasivo».'
            when 'nacional' then 'es de España: su compra lleva el IVA de su factura. Si es una inversión del sujeto pasivo (obras, chatarra…), márcalo en su ficha, en «Régimen de IVA».'
            else 'es de ' || public.conta_pais_nombre(v_p.country_code) || ' y no tiene un NIF-IVA europeo válido: sin él su compra no es intracomunitaria. Pon su NIF-IVA en su ficha (se comprueba en VIES).' end;
          return next;
        end if;
      end if;
    end if;
  end if;

  -- C06b (#210): un asiento de ventas del día con un envío por aclarar. Copiado
  -- de tg_journal_entry_envio_por_aclarar, que desde aquí lo lee de esta función.
  if v_e.source_type = 'sales_day' then
    select count(*), string_agg(coalesce(s.platform_order_code, left(s.id::text, 8)) || ' (envío ' || public.conta_euros_exactos(c.envio) || ', ' || c.por_que || ')', '; ' order by s.sold_at)
      into v_aclarar, v_lista
      from public.sales_day_summary d
      cross join lateral public.conta_cargos_de_pedidos(d.account_id, d.sale_ids) c
      join public.sale s on s.id = c.id and s.account_id = d.account_id
     where d.entry_id = v_e.id and d.account_id = v_e.account_id and c.clase = 'por_aclarar';
    if v_aclarar > 0 then
      orden := 9; codigo := 'envio_por_aclarar';
      motivo := format('No se valida: %s con envío por aclarar: %s. Se resuelve con la liquidación de esa semana.',
        v_aclarar || case when v_aclarar = 1 then ' pedido' else ' pedidos' end, v_lista); return next;
    end if;
  end if;
end $function$;

create or replace function public.conta_vat_book_desde_asiento(p_entry uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_e public.journal_entry; v_n integer := 0; l record;
  v_tipo text; v_num text; v_hasta text; v_docs int; v_fecha_op date; v_recep date; v_nif text; v_tipo_id text; v_pais text; v_nombre text;
  v_clave text; v_calif text; v_exenta text; v_corrige text; v_ret_tipo numeric; v_ret numeric; v_inv boolean; v_isp boolean;
  v_act_code text := 'A'; v_act_tipo text := '03'; v_iae text;
  v_sp record; v_em record; v_fac date;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or v_e.status not in ('validado', 'anulado') or v_e.source_type = 'reversal' then return 0; end if;
  if exists (select 1 from public.vat_book_entry where entry_id = p_entry) then return 0; end if;
  select iae_code into v_iae from public.company_activity
   where company_id = v_e.company_id and is_main and (ended_on is null or ended_on >= v_e.entry_date) order by started_on desc nulls last limit 1;

  for l in
    select jl.*, t.rate, t.surcharge_rate, t.treatment
      from public.journal_line jl left join public.tax_rate t on t.id = jl.tax_rate_id
     where jl.entry_id = p_entry and jl.vat_book is not null
     order by jl.position
  loop
    v_tipo := 'F1'; v_num := coalesce(l.document_ref, v_e.document_ref); v_hasta := null; v_docs := l.tax_documents;
    v_fecha_op := null; v_recep := null; v_fac := null; v_corrige := null; v_ret_tipo := null; v_ret := null;
    v_nif := null; v_tipo_id := null; v_pais := null; v_nombre := null;
    v_inv := l.vat_book = 'investment';
    -- I01d (0300): la compra intracomunitaria también es inversión del sujeto
    -- pasivo (la declaras tú), como la trae Diez: clave 09 y «ISP» a la vez.
    v_isp := l.treatment = 'reverse_charge' or (l.treatment = 'intra_eu' and l.vat_book in ('received', 'investment'));
    v_clave := case when l.treatment = 'intra_eu' and l.vat_book <> 'issued' then '09' else '01' end;
    v_calif := case when l.vat_book = 'not_subject' then 'N1' when l.treatment = 'exempt' or (l.treatment = 'intra_eu' and l.vat_book = 'issued') then null
                    when v_isp then 'S2' else 'S1' end;
    v_exenta := case when l.treatment = 'exempt' then 'E1' when l.treatment = 'intra_eu' and l.vat_book = 'issued' then 'E5' end;

    if v_e.source_type = 'sales_day' then
      -- Asiento resumen de tiques (RIVA 63.4): F4 con el rango; un tique suelto, F2.
      select first_invoice, last_invoice, tickets_count into v_num, v_hasta, v_docs
        from public.sales_day_summary where entry_id = p_entry or id = v_e.source_id order by (entry_id = p_entry) desc limit 1;
      v_docs := coalesce(nullif(l.tax_documents, 1), v_docs, 1);
      v_tipo := case when coalesce(v_docs, 1) > 1 then 'F4' else 'F2' end;
      v_nombre := 'VENTAS A CONSUMIDOR FINAL';
    elsif v_e.source_type = 'supplier_invoice' then
      -- D07 (0850): la recibida conserva SU fecha de factura (la de expedición),
      -- aunque se asiente otro día (un periodo cerrado: el primer día abierto);
      -- y se registra el día que entró o, si es después, el del asiento: su IVA
      -- va al periodo en que se asienta (el 303 reparte por esta fecha).
      select si.invoice_number, greatest(si.created_at::date, v_e.entry_date), case when si.doc_kind = 'credit_note' then 'R1' else 'F1' end,
             (select c.invoice_number from public.supplier_invoice c where c.id = si.corrects_invoice_id),
             wr.rate, si.withholding_amount, si.invoice_date
        into v_num, v_recep, v_tipo, v_corrige, v_ret_tipo, v_ret, v_fac
        from public.supplier_invoice si left join public.withholding_rate wr on wr.id = si.withholding_rate_id
       where si.id = v_e.source_id;
    elsif v_e.source_type in ('channel_settlement', 'licensed_settlement') then
      v_num := coalesce(v_num, (select settlement_ref from public.channel_settlement where id = v_e.source_id),
                               (select settlement_ref from public.licensed_settlement where id = v_e.source_id));
    end if;

    select p.tax_id, nullif(f.tax_id_type, 'nif'), f.country_code, coalesce(f.legal_name, p.name)
      into v_nif, v_tipo_id, v_pais, v_nombre
      from public.party p left join public.customer_fiscal f on f.party_id = p.id
     where p.id = coalesce(l.party_id, v_e.party_id)
       and v_e.source_type <> 'sales_day';
    if v_e.source_type = 'sales_day' then v_nombre := 'VENTAS A CONSUMIDOR FINAL'; end if;
    -- I01d (0300): una recibida toma de la FICHA DEL PROVEEDOR lo que su
    -- tercero no tiene (no tiene ficha de cliente): el país si no es España,
    -- el tipo de identificación (02 NIF-IVA, 04 extranjero), el NIF y el nombre.
    if v_e.source_type = 'supplier_invoice' then
      select s.country_code, s.tax_id_type, s.tax_id, coalesce(s.legal_name, s.name) as nombre into v_sp
        from public.supplier_invoice si join public.supplier s on s.id = si.supplier_id and s.account_id = si.account_id
       where si.id = v_e.source_id and si.account_id = v_e.account_id;
      if found then
        v_pais := coalesce(v_pais, nullif(v_sp.country_code, 'ES'));
        v_tipo_id := coalesce(v_tipo_id, case v_sp.tax_id_type when 'vat_eu' then '02' when 'foreign' then '04' end);
        v_nif := coalesce(v_nif, v_sp.tax_id);
        v_nombre := coalesce(v_nombre, v_sp.nombre);
      end if;
    end if;
    -- 0410 · Una factura de lote (los riders y las flotas de Catcher): su
    -- contraparte es su EMISOR, que va en la factura (issuer_*), no la ficha
    -- genérica «RIDERS» ni su tercero, que no tienen NIF.
    if v_e.source_type = 'supplier_invoice' then
      select si.issuer_tax_id, si.issuer_name into v_em
        from public.supplier_invoice si
       where si.id = v_e.source_id and si.account_id = v_e.account_id and si.source = 'lote' and si.issuer_tax_id is not null;
      if found then
        v_nif := v_em.issuer_tax_id; v_nombre := coalesce(v_em.issuer_name, v_nombre); v_tipo_id := null; v_pais := null;
      end if;
    end if;
    if v_tipo_id is not null and v_tipo_id not in ('02', '03', '04', '05', '06') then v_tipo_id := null; end if;

    insert into public.vat_book_entry (account_id, company_id, entry_id, line_id, book, invoice_type, number, number_to, documents_count,
      issue_date, operation_date, received_date, party_id, counterpart_tax_id, counterpart_id_type, counterpart_country, counterpart_name,
      operation_key, qualification, exempt_cause, tax_base, tax_rate, tax_amount, surcharge_rate, total,
      deductible_amount, reverse_charge, investment_good, withholding_rate, withholding_amount,
      activity_code, activity_type, activity_iae, corrects_ref, source_type, source_id, voided_at, voided_by_entry_id)
    values (v_e.account_id, v_e.company_id, p_entry, l.id, l.vat_book, v_tipo, v_num, v_hasta, greatest(coalesce(v_docs, 1), 1),
      coalesce(l.document_date, v_e.document_date, v_fac, v_e.entry_date), v_fecha_op, v_recep, coalesce(l.party_id, v_e.party_id),
      v_nif, v_tipo_id, v_pais, v_nombre,
      -- La base lleva el signo de la cuota: en una rectificativa las dos van en
      -- negativo (el validador del C04 compara en valor absoluto y deja la base
      -- en positivo en el apunte).
      v_clave, v_calif, v_exenta,
      case when (case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end) < 0 then -abs(l.tax_base) else abs(l.tax_base) end,
      l.rate,
      case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end,
      nullif(l.surcharge_rate, 0),
      case when (case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end) < 0 then -abs(l.tax_base) else abs(l.tax_base) end
        + case when l.vat_book = 'issued' then l.credit - l.debit else l.debit - l.credit end,
      case when l.vat_book in ('received', 'investment') and l.vat_deductible = 'yes' then l.debit - l.credit when l.vat_book in ('received', 'investment') then 0 end,
      v_isp, v_inv, v_ret_tipo, v_ret,
      case when v_iae is null then null else v_act_code end, case when v_iae is null then null else v_act_tipo end, v_iae,
      v_corrige, v_e.source_type, v_e.source_id,
      case when v_e.status = 'anulado' then coalesce(v_e.voided_at, now()) end, v_e.voided_by_entry_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
