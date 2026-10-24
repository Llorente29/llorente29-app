-- supabase/vuelta-atras/20261024T1441_v01_cierres_cambia.down.sql
--
-- Vuelta atrás de 20261024T1441_v01_cierres_cambia: cada función, como está
-- en producción antes de la tanda (pg_get_functiondef, 24/10), con la misma
-- firma. No toca datos: los cambios guardados en conta_cierre_ajuste dejan de
-- contar (la tabla se queda hasta la vuelta atrás de la 1440), los cobros en
-- efectivo ya asentados se quedan con su asiento, y los PDF ya enlazados a su
-- asiento se quedan enlazados.

CREATE OR REPLACE FUNCTION public.conta_pedidos_del_dia(p_company uuid, p_location uuid, p_dia date)
 RETURNS TABLE(id uuid, codigo text, canal_id uuid, marca_id uuid, propia boolean, estado text, total numeric, base numeric, cuota numeric, tipos numeric[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select s.id, coalesce(s.platform_order_code, s.pos_short_code, s.external_ref), s.channel_id, s.brand_id,
         coalesce(b.ownership_type, 'own') = 'own',
         -- Cierre del día: el no confirmado no es una anulación; se dice aparte.
         case when s.status = 'cancelled' and s.unconfirmed_at is not null then 'unconfirmed' else s.status end,
         s.total, s.taxable_base, s.tax,
         coalesce((select array_agg(distinct (it->>'tax_rate')::numeric)
                     from jsonb_array_elements(case when jsonb_typeof(public.conta_json_seguro(s.raw_tab)->'items') = 'array'
                                                    then public.conta_json_seguro(s.raw_tab)->'items' else '[]'::jsonb end) it
                    where it->>'tax_rate' ~ '^[0-9]+(\.[0-9]+)?$'), '{}')
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.location_id = p_location and s.is_active
     and s.sold_at >= (p_dia::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_dia + 1)::timestamp at time zone 'Europe/Madrid')
     and s.status in ('closed', 'cancelled', 'open')
$function$;

CREATE OR REPLACE FUNCTION public.conta_dias_por_asentar(p_company uuid, p_desde date, p_hasta date)
 RETURNS TABLE(location_id uuid, dia date, pedidos bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date, count(*)
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.is_active and s.status = 'closed' and coalesce(b.ownership_type, 'own') = 'own' and s.location_id is not null
     and s.sold_at >= (p_desde::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid')
     -- Cierre del día: solo días que ya han llegado a su hora de cierre.
     and s.sold_at < (select public.conta_cerrado_hasta(p_company))
     -- El día entero, asentado a la antigua (unit_key nulo)…
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.company_id = p_company and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                        and d.unit_key is null and e.status in ('propuesto', 'borrador', 'validado'))
     -- …o la unidad de este pedido, con la regla por plataforma (C04b R5).
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.company_id = p_company and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                        and d.unit_key = public.conta_unidad_ventas(p_company, s.channel_id, s.brand_id)
                        and e.status in ('propuesto', 'borrador', 'validado'))
     and not exists (select 1 from public.journal_dismissal x
                      where x.company_id = p_company and x.source_type = 'sales_day'
                        and x.source_key in (s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date,
                                             s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date || ':' || public.conta_unidad_ventas(p_company, s.channel_id, s.brand_id)))
   group by 1, 2
   order by 2, 1
$function$;

CREATE OR REPLACE FUNCTION public.conta_resumen_ventas(p_entry uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e public.journal_entry;
  v_d public.sales_day_summary;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not (public.belongs_to_account(v_e.account_id) or auth.role() = 'service_role') then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  select * into v_d from public.sales_day_summary
   where entry_id = v_e.id and account_id = v_e.account_id and company_id = v_e.company_id;
  if v_d.id is null or v_d.channel_id is null then
    raise exception 'Ese asiento no es de las ventas de una plataforma: no lleva resumen de ventas.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id,
    'estado', v_e.status, 'serie', v_e.series, 'numero', v_e.number,
    'fecha', v_d.sales_day, 'validado_en', v_e.validated_at,
    'empresa', (select jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id)
                  from public.company c where c.id = v_e.company_id and c.account_id = v_e.account_id),
    'local', (select jsonb_build_object('id', l.id, 'nombre', l.name)
                from public.locations l where l.id = v_d.location_id and l.account_id = v_e.account_id),
    'canal', (select jsonb_build_object('id', ch.id, 'slug', ch.slug, 'nombre', ch.name)
                from public.sales_channel ch where ch.id = v_d.channel_id and ch.account_id = v_e.account_id),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'hora', to_char(s.sold_at at time zone 'Europe/Madrid', 'HH24:MI'),
               'codigo', coalesce(s.platform_order_code, left(s.id::text, 8)),
               'marca', b.name, 'total', s.total, 'base', s.taxable_base, 'cuota', s.tax,
               -- C06b (16/10): el descuento y el envío, y qué se hizo con el envío (conta_cargos_de_pedidos).
               'descuento', coalesce(c.descuento, 0), 'envio', coalesce(c.envio, 0), 'clase', coalesce(c.clase, 'ninguno')) order by s.sold_at, s.id)
        from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
        left join public.conta_cargos_de_pedidos(v_e.account_id, v_d.sale_ids) c on c.id = s.id
       where s.id = any (v_d.sale_ids) and s.account_id = v_e.account_id), '[]'::jsonb),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'marca', b.name,
               'tipoIva', t.rate, 'documento', l.document_ref,
               -- C06b (16/10): si la línea es la de promociones o la de envíos de su plataforma.
               'papel', (select v.papel from public.conta_ventas_canal_cuenta v
                          where v.company_id = v_e.company_id and v.channel_id = v_d.channel_id and v.company_account_id = a.id)) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.brand b on b.id = l.brand_id and b.account_id = v_e.account_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id and l.account_id = v_e.account_id), '[]'::jsonb),
    'documento', (
      select jsonb_build_object('id', x.id, 'ruta', x.storage_path, 'nombre', x.file_name, 'sha256', x.sha256,
                                'bytes', x.size_bytes, 'creado_en', x.created_at, 'creado_por', x.created_by_name)
        from public.journal_entry_document x
       where x.entry_id = v_e.id and x.account_id = v_e.account_id and x.kind = 'resumen_ventas'));
end $function$;

CREATE OR REPLACE FUNCTION public.journal_entry_anular(p_entry uuid, p_motivo text, p_fecha date DEFAULT NULL::date, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_e public.journal_entry; v_fecha date; v_y uuid; v_nuevo uuid; v_r jsonb; v_quien text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_e.account_id) then
    raise exception 'Solo un administrador de la cuenta anula asientos.' using errcode = '42501';
  end if;
  if v_e.status <> 'validado' then
    raise exception 'Solo se anula un asiento validado (este está %).', v_e.status using errcode = '23514';
  end if;
  if v_e.source_type = 'reversal' then
    raise exception 'Un contraasiento no se anula: si hace falta, se hace el asiento bueno.' using errcode = '23514';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Para anular hay que decir por qué.' using errcode = '23514';
  end if;
  v_quien := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_fecha := coalesce(p_fecha, greatest(v_e.entry_date, current_date));
  if public.conta_mes_cerrado(v_e.company_id, v_fecha) then
    v_fecha := public.conta_primer_dia_abierto(v_e.company_id, v_fecha);
  end if;
  select id into v_y from public.fiscal_year
   where company_id = v_e.company_id and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio abierto para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id,
                                    status, party_id, document_ref, document_date, reverses_entry_id, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_y, v_e.series, v_fecha,
          format('Anula %s nº %s: %s', case v_e.series when 1 then 'Ventas' when 2 then 'Compras' when 3 then 'Banco' when 9 then 'Nóminas' else 'General' end, v_e.number, trim(p_motivo)), 'reversal', v_e.id,
          'borrador', v_e.party_id, v_e.document_ref, v_e.document_date, v_e.id, auth.uid(), v_quien)
  returning id into v_nuevo;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                   location_id, is_common, brand_id, party_id, document_ref, document_date,
                                   tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model)
  select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
         location_id, is_common, brand_id, party_id, document_ref, document_date,
         tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model
    from public.journal_line where entry_id = v_e.id;
  v_r := public.journal_entry_validar(v_nuevo, v_quien);

  update public.journal_entry set status = 'anulado', voided_by_entry_id = v_nuevo, voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_quien, void_reason = trim(p_motivo)
   where id = v_e.id;
  return jsonb_build_object('anulado', v_e.id, 'contraasiento', v_nuevo, 'serie', v_r->'serie', 'numero', v_r->'numero', 'fecha', v_fecha);
end $function$;

-- Las cinco de la factura de venta, como las dejó la 0835.
create or replace function public.conta_venta_emitir(p_id uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_orig public.customer_invoice; v_c jsonb; v_anio int; v_num int; v_texto text; v_serie text; v_digitos int := 4;
  v_empieza int; v_por_anio boolean; v_cta430 text; v_r jsonb; v_lineas jsonb := '[]'::jsonb; v_x jsonb; v_cta text; v_cta477 text; v_cta473 text; v_entry uuid; v_val jsonb;
  v_nombre text; v_signo numeric; v_prev text; v_hash text; v_emisor text; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_tipo_libro text; v_nif text; v_esta jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta emite facturas.' using errcode = '42501';
  end if;
  if v_f.status <> 'borrador' then raise exception 'La factura % ya está emitida.', v_f.number_text using errcode = '23514'; end if;
  if v_f.party_id is null then raise exception 'Falta el cliente: elige uno de Contactos o dalo de alta.' using errcode = '23514'; end if;
  v_nombre := v_f.customer->>'nombre';
  v_nif := v_f.customer->>'nif';
  if coalesce(btrim(v_nif), '') = '' then
    raise exception 'Falta el NIF de %: una factura lo lleva. Ponlo en su ficha de Contactos.', coalesce(v_nombre, 'el cliente') using errcode = '23514';
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

  -- La 430 del cliente: la suya, o una nueva de la 4300 con su nombre.
  select a.code into v_cta430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_f.company_id and k.entity = 'customer' and k.entity_id = v_f.party_id::text and k.role = 'principal' limit 1;
  if v_cta430 is null then
    v_r := public.company_account_add(v_f.company_id, '4300', 'Clientes · ' || coalesce(v_nombre, 'cliente'), null, 'customer', v_f.party_id::text, v_quien, 'manual');
    v_cta430 := v_r->>'code';
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
    v_tipo_libro := case when v_f.doc_type = 'rectificativa' then 'R4' else 'F1' end;
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
revoke all on function public.conta_venta_emitir(uuid, text) from public, anon;
grant execute on function public.conta_venta_emitir(uuid, text) to authenticated;

-- 8 · Corregir: una rectificativa en borrador, con los datos de la original ---------------
create or replace function public.conta_venta_corregir(p_id uuid, p_tipo text, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.customer_invoice; v_id uuid; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_c jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta corrige facturas.' using errcode = '42501';
  end if;
  if v_f.status <> 'emitida' then raise exception 'Solo se corrige una factura emitida y viva (esta está %).', v_f.status using errcode = '23514'; end if;
  if v_f.doc_type = 'rectificativa' then raise exception 'Una rectificativa no se corrige con otra: corrige la factura de origen.' using errcode = '23514'; end if;
  if p_tipo not in ('importes', 'anular', 'datos') then raise exception 'Qué se corrige: importes, anular o datos.' using errcode = '22023'; end if;
  if exists (select 1 from public.customer_invoice where corrects_id = p_id and status = 'borrador') then
    select id into v_id from public.customer_invoice where corrects_id = p_id and status = 'borrador' limit 1;
    return jsonb_build_object('id', v_id, 'ya_estaba', true);
  end if;
  insert into public.customer_invoice (account_id, company_id, doc_type, origin, series_code, issue_date, due_date, party_id, customer, location_id,
                                    payment_method_id, notes, email_to, withholding_rate_id, surcharge, corrects_id, correction_kind, correction_reason,
                                    created_by, created_by_name)
  values (v_f.account_id, v_f.company_id, 'rectificativa', v_f.origin, 'R', (now() at time zone 'Europe/Madrid')::date, null, v_f.party_id, v_f.customer, v_f.location_id,
          v_f.payment_method_id, null, v_f.email_to, v_f.withholding_rate_id, v_f.surcharge, p_id, p_tipo, nullif(btrim(p_motivo), ''), auth.uid(), v_quien)
  returning id into v_id;
  -- Las líneas de la original: lo que se cambia en «importes»; en «anular» y
  -- «datos», solo se enseñan (la diferencia no las usa).
  insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, discount_pct, tax_rate_id, tax_pct, surcharge_pct, revenue_account_id, amount)
  select account_id, company_id, v_id, position, concept, quantity, unit_price, discount_pct, tax_rate_id, tax_pct, surcharge_pct, revenue_account_id, amount
    from public.customer_invoice_line where invoice_id = p_id;
  v_c := public._conta_venta_diferencia(v_id);
  update public.customer_invoice set base = (v_c->>'base')::numeric, tax = (v_c->>'iva')::numeric, surcharge_amount = (v_c->>'recargo')::numeric,
         withholding_amount = (v_c->>'retencion')::numeric, total = (v_c->>'total')::numeric where id = v_id;
  perform public._conta_venta_evento(v_id, 'creada', 'Rectificativa de la ' || v_f.number_text || ' preparada (' ||
    case p_tipo when 'anular' then 'anularla entera' when 'datos' then 'datos del cliente' else 'importes o líneas' end || ').', jsonb_build_object('corrige', p_id), v_quien);
  return jsonb_build_object('id', v_id, 'ya_estaba', false, 'total', (v_c->>'total')::numeric);
end $$;
revoke all on function public.conta_venta_corregir(uuid, text, text, text) from public, anon;
grant execute on function public.conta_venta_corregir(uuid, text, text, text) to authenticated;

-- 9 · Cobros -------------------------------------------------------------------------------
create or replace function public.conta_venta_cobrar(p_id uuid, p_fecha date, p_importe numeric, p_forma text, p_nota text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.customer_invoice; v_cobrado numeric; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_queda numeric;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta apunta cobros.' using errcode = '42501';
  end if;
  if v_f.status <> 'emitida' or v_f.total <= 0 then raise exception 'Solo se cobra una factura emitida con importe a cobrar.' using errcode = '23514'; end if;
  if p_importe is null or p_importe <= 0 then raise exception 'El cobro tiene que ser mayor que cero.' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_cobrado from public.customer_invoice_payment where invoice_id = p_id;
  v_queda := v_f.total - v_cobrado;
  if p_importe > v_queda then
    raise exception 'Quedan % € por cobrar de la %: no se puede apuntar %.', to_char(v_queda, 'FM999G999G990D00'), v_f.number_text, to_char(p_importe, 'FM999G999G990D00') using errcode = '22023';
  end if;
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by, created_by_name)
  values (v_f.account_id, v_f.company_id, p_id, coalesce(p_fecha, (now() at time zone 'Europe/Madrid')::date), p_importe, nullif(btrim(p_forma), ''), nullif(btrim(p_nota), ''), auth.uid(), v_quien);
  v_queda := v_queda - p_importe;
  perform public._conta_venta_evento(p_id, 'cobro',
    'Cobro de ' || to_char(p_importe, 'FM999G999G990D00') || ' €' || case when v_queda = 0 then ': cobrada entera.' else '; quedan ' || to_char(v_queda, 'FM999G999G990D00') || ' €.' end,
    jsonb_build_object('importe', p_importe, 'fecha', p_fecha), v_quien);
  return jsonb_build_object('id', p_id, 'cobrado', v_cobrado + p_importe, 'queda', v_queda);
end $$;
revoke all on function public.conta_venta_cobrar(uuid, date, numeric, text, text, text) from public, anon;
grant execute on function public.conta_venta_cobrar(uuid, date, numeric, text, text, text) to authenticated;

-- 10 · Lo del servidor: el PDF y el correo (conta-venta-documento) ----------------------------
create or replace function public.conta_venta_pdf_guardar(p_id uuid, p_ruta text, p_sha256 text, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare v_f public.customer_invoice; v_obj record;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  -- Lo llama el navegador de quien emite (el PDF se hace allí, como el resumen
  -- de ventas): sus permisos, y la ruta tiene que ser la de ESTA factura.
  if v_f.id is null or not (public.belongs_to_account(v_f.account_id) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa factura no está.' using errcode = 'P0002';
  end if;
  if not (public.current_user_is_admin_or_manager_of(v_f.account_id) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Solo un administrador o un encargado de la cuenta guarda el PDF de una factura.' using errcode = '42501';
  end if;
  if v_f.status = 'borrador' then raise exception 'Un borrador no lleva PDF: se hace al emitir.' using errcode = '23514'; end if;
  if v_f.pdf_sha256 is not null then
    if v_f.pdf_sha256 = p_sha256 then return jsonb_build_object('id', p_id, 'ruta', v_f.pdf_path, 'ya_estaba', true); end if;
    raise exception 'La % ya tiene su PDF: no se cambia.', v_f.number_text using errcode = '23505';
  end if;
  if p_ruta is null or left(p_ruta, length(v_f.account_id::text || '/ventas/' || p_id::text || '/')) <> v_f.account_id::text || '/ventas/' || p_id::text || '/' then
    raise exception 'La ruta del PDF no es la de esta factura.' using errcode = '22023';
  end if;
  select o.name into v_obj from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then raise exception 'El PDF no está subido (%).', p_ruta using errcode = 'P0002'; end if;
  update public.customer_invoice set pdf_path = p_ruta, pdf_sha256 = p_sha256, pdf_bytes = p_bytes where id = p_id;
  return jsonb_build_object('id', p_id, 'ruta', p_ruta, 'ya_estaba', false);
end $$;
revoke all on function public.conta_venta_pdf_guardar(uuid, text, text, integer) from public, anon;
grant execute on function public.conta_venta_pdf_guardar(uuid, text, text, integer) to authenticated, service_role;

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

  update public.customer_invoice set
    party_id = v_party, customer = coalesce(v_cli, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('correo', nullif(btrim(p_datos->>'correo'), ''))),
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
revoke all on function public.conta_venta_guardar(uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.conta_venta_guardar(uuid, uuid, jsonb, jsonb, text) to authenticated;
