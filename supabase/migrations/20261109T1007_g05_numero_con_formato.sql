-- supabase/migrations/20261109T1007_g05_numero_con_formato.sql
--
-- cambia: public.conta_venta_emitir · prueba: supabase/staging/sql/20261109_g05_cobro_prueba.sql
--
-- G05 · Tarea 3 · EL NÚMERO DE LA FACTURA CON EL FORMATO DE SU SERIE (nº 28):
-- QBO numera «año/serie/número» (2026/1/2740) y Sumied sigue esa numeración,
-- sin serie nueva. En la demo, 2026/1/141 en adelante.
--
--   1. _conta_numero_con_formato (AÑADE): la plantilla de la serie, con
--      {año}, {aa}, {serie} y {número} (o {número:6}), como
--      _shared/cobro/numeracion.ts · numeroDeFactura.
--   2. conta_venta_emitir (CAMBIA, misma firma): si la serie tiene formato
--      (invoice_series.formato, de la 1006), el número sale con él. Sin
--      formato, EXACTAMENTE como hasta hoy: ninguna serie que exista lo tiene.
--      Parte de la versión de producción (md5 c26235137cb955f95056b676e638498e,
--      la de la 0146); el contador, sus huecos y el resto no cambian.
--
-- Por dónde empieza cada serie lo dice invoice_series.starts_at, como siempre
-- (QBO: el último de Cegid + 1; en la demo, 141). No es el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1007_g05_numero_con_formato.down.sql

create or replace function public._conta_numero_con_formato(p_formato text, p_anio int, p_serie text, p_numero int)
returns text language plpgsql immutable as $$
declare v text := p_formato; v_m text[];
begin
  if p_formato !~ '\{número' or (p_formato !~ '\{año\}' and p_formato !~ '\{aa\}') then
    raise exception 'El formato «%» de la serie no vale: necesita el año y el número.', p_formato using errcode = '22023';
  end if;
  v := replace(v, '{año}', p_anio::text);
  v := replace(v, '{aa}', right(p_anio::text, 2));
  v := replace(v, '{serie}', p_serie);
  v_m := regexp_match(v, '\{número:(\d{1,2})\}');
  if v_m is not null then v := regexp_replace(v, '\{número:\d{1,2}\}', lpad(p_numero::text, v_m[1]::int, '0')); end if;
  v := replace(v, '{número}', p_numero::text);
  if v ~ '[{}]' then raise exception 'El formato «%» de la serie tiene piezas que no existen.', p_formato using errcode = '22023'; end if;
  return v;
end $$;
revoke all on function public._conta_numero_con_formato(text, int, text, int) from public, anon;
grant execute on function public._conta_numero_con_formato(text, int, text, int) to authenticated, service_role;

-- La de antes, guardada para la vuelta atrás (_restaurar_funcion).
select public._respaldar_funcion('public.conta_venta_emitir(uuid,text)', '20261109T1007_g05_numero_con_formato');

create or replace function public.conta_venta_emitir(p_id uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_f public.customer_invoice; v_orig public.customer_invoice; v_c jsonb; v_anio int; v_num int; v_texto text; v_serie text; v_digitos int := 4;
  v_empieza int; v_por_anio boolean; v_cta430 text; v_r jsonb; v_lineas jsonb := '[]'::jsonb; v_x jsonb; v_cta text; v_cta477 text; v_cta473 text; v_entry uuid; v_val jsonb;
  v_nombre text; v_signo numeric; v_prev text; v_hash text; v_emisor text; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_tipo_libro text; v_nif text; v_esta jsonb; v_cierre boolean; v_formato text;
  v_falta text; v_trato text;
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

  -- V03 E2 · Una línea sin IVA necesita su porqué, con Verifactu encendido o
  -- no: la ley pide en la factura la causa de la exención o de la no sujeción
  -- (RD 1619/2012, art. 6.1.j), y el libro y el 303 la necesitan. La regla y
  -- sus frases son las de la comprobación de Verifactu (tablero 27). Antes del
  -- número: si falta, la factura sigue en borrador y no gasta ninguno. La
  -- rectificativa hereda el porqué de la que corrige.
  if v_f.doc_type = 'rectificativa' and not exists (select 1 from public.verifactu_operacion where invoice_id = p_id) then
    insert into public.verifactu_operacion (invoice_id, account_id, company_id, calificacion, exenta, clave_regimen, updated_by_name)
    select p_id, o.account_id, o.company_id, o.calificacion, o.exenta, o.clave_regimen, v_quien
      from public.verifactu_operacion o where o.invoice_id = v_f.corrects_id and o.account_id = v_f.account_id;
  end if;
  select x->>'frase' into v_falta from jsonb_array_elements(public._verifactu_desglose(p_id)->'faltas') x
   where x->>'campo' = 'tipo_venta' limit 1;
  if v_falta is not null then
    raise exception '%', v_falta using errcode = '23514', hint = 'tipo_venta';
  end if;

  -- El número: su serie (la de la empresa en Numeración, si la tiene: sus
  -- cifras, por dónde empieza y si vuelve a 1 cada año; si no, 4 cifras, desde
  -- el 1 y por año) y el año de la fecha.
  v_serie := v_f.series_code;
  select digits, starts_at, reset_yearly, formato into v_digitos, v_empieza, v_por_anio, v_formato
    from public.invoice_series where company_id = v_f.company_id and code = v_serie and is_active;
  v_digitos := coalesce(v_digitos, 4); v_empieza := coalesce(v_empieza, 1); v_por_anio := coalesce(v_por_anio, true);
  v_anio := extract(year from v_f.issue_date)::int;
  insert into public.customer_invoice_counter (company_id, account_id, series_code, fiscal_year, last_number)
  values (v_f.company_id, v_f.account_id, v_serie, case when v_por_anio then v_anio else 0 end, v_empieza)
  on conflict (company_id, series_code, fiscal_year) do update set last_number = public.customer_invoice_counter.last_number + 1
  returning last_number into v_num;
  v_texto := v_serie || '-' || case when v_por_anio then v_anio || '/' else '' end || lpad(v_num::text, v_digitos, '0');
  -- G05 (1007): la serie con su formato, el de la gestoría («{año}/{serie}/{número}» en QBO: 2026/1/141).
  if v_formato is not null then v_texto := public._conta_numero_con_formato(v_formato, v_anio, v_serie, v_num); end if;

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
  -- V03 E2: la 70x por cuenta Y, dentro de ella, la parte sin IVA aparte: esa
  -- parte es la base de su tipo exento y lleva en su apunte el tipo, la base y
  -- el libro (no hay 477 a cero). Por cuenta suma lo mismo que v_c->'cuentas'
  -- (las mismas líneas: las suyas y, en una rectificativa, menos las de la que
  -- corrige; «datos» no cambia importes y «anular» deja las nuevas a cero).
  for v_x in
    with d as (
      select l.revenue_account_id as c, case when t.treatment = 'exempt' then l.tax_rate_id end as k, l.amount as b
        from public.customer_invoice_line l join public.tax_rate t on t.id = l.tax_rate_id
       where l.invoice_id = p_id and coalesce(v_f.correction_kind, '') not in ('anular', 'datos')
      union all
      select l.revenue_account_id, case when t.treatment = 'exempt' then l.tax_rate_id end, -l.amount
        from public.customer_invoice_line l join public.tax_rate t on t.id = l.tax_rate_id
       where v_f.doc_type = 'rectificativa' and coalesce(v_f.correction_kind, '') <> 'datos' and l.invoice_id = v_f.corrects_id)
    select jsonb_build_object('cuenta_id', c, 'tipo_id', k, 'base', sum(b)) from d group by c, k having sum(b) <> 0 order by c, k nulls first
  loop
    select code into v_cta from public.company_account where id = (v_x->>'cuenta_id')::uuid;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Factura ' || v_texto,
      'haber', greatest((v_x->>'base')::numeric, 0), 'debe', greatest(-(v_x->>'base')::numeric, 0))
      || case when v_x->>'tipo_id' is not null
              then jsonb_build_object('iva', jsonb_build_object('tipo_id', v_x->>'tipo_id', 'base', abs((v_x->>'base')::numeric), 'libro', 'issued', 'facturas', 1))
              else '{}'::jsonb end);
  end loop;
  for v_x in select * from jsonb_array_elements(v_c->'tipos') loop
    -- V03 E2: el tipo exento no lleva 477 (va en su 70x, arriba).
    select treatment into v_trato from public.tax_rate where id = (v_x->>'tipo_id')::uuid;
    continue when v_trato = 'exempt';
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
end $function$;
