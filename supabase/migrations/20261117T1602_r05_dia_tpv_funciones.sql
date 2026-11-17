-- supabase/migrations/20261117T1602_r05_dia_tpv_funciones.sql
--
-- R05 · Un día del TPV se propone y se valida como uno de Folvy (encargo R05 y
-- respuesta R05 · 1, 17/11).
--
-- Solo AÑADE: cuatro funciones nuevas. No cambia ninguna que exista: ni
-- conta_pedidos_del_dia, ni la propuesta de Folvy, ni el cron del cierre del día,
-- ni conta_resumen_ventas, ni nada de Diez. `sale` no se toca.
--
--   _conta_tpv_propuesta(día) → jsonb (interna, solo lee)
--     El asiento del día, o por qué no se puede proponer. Al debe, cada cobro en
--     su cuenta (conta_tpv_forma_cuenta: la forma de pago con su canal, o sin
--     canal); «Deliverect» no es una cuenta: va siempre por el canal de cada
--     orden. Al haber, las ventas (la 700 de la hoja) y el IVA repercutido, una
--     línea por tipo (su 477, por el enlace del tipo). Las devoluciones ya restan
--     dentro del día: son facturas del TPV en negativo. Todos los apuntes, comunes
--     (el día es de la empresa, no de un local).
--     No se propone, con su frase, si la empresa envía a Diez (respuesta R05 · 1,
--     §2), si falta la cuenta de una forma de pago, la 700, o la 477 de un tipo.
--     El asiento es uno más de «ventas del día» (sales_day, con el día del TPV de
--     origen): hereda el libro de IVA, el libro diario y el resto. Sin factura de
--     Sumied: las facturas son las del TPV.
--   conta_tpv_dias(empresa, desde, hasta) → jsonb (solo lee)
--     Los días del TPV para Cierres del día, una fila por día: por validar (se
--     puede proponer), en espera con su motivo, o validado. Y el aviso de un
--     salto con el día guardado anterior (decisión 8): no para nada.
--   conta_tpv_dia_para_validar(día) → jsonb (solo lee)
--     Lo que necesita la pantalla para hacer el PDF antes de validar: el día, el
--     asiento que saldría (con el nombre de cada cuenta), la empresa y el número
--     de asiento que le tocaría. Para, con su frase, si no se puede proponer.
--   conta_tpv_dia_validar(día, asiento, número, ruta, nombre, sha256, bytes, quién) → jsonb
--     Propone y valida en UNA transacción (respuesta R05 · 1, §4): el asiento
--     (con el id que trae la pantalla, el de la ruta de su PDF), su validación,
--     su PDF «Resumen de ventas» (obligatorio, como el de Folvy) y en el libro
--     de IVA el primer y el último número del TPV. El día pasa a «contabilizado».
--     Si el número de asiento no es el del PDF (se ha validado otro a la vez),
--     no se valida nada (40001) y la pantalla vuelve a empezar.
--
-- Se puede pasar dos veces (create or replace, firmas nuevas).
-- Prueba: supabase/staging/sql/20261117_r05_dia_tpv_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261117T1602_r05_dia_tpv_funciones.down.sql

create or replace function public._conta_tpv_propuesta(p_dia uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_d public.conta_tpv_dia; v_programa text; v_ventas text; v_faltan text[] := '{}';
  v_lineas jsonb := '[]'::jsonb; v_t record; v_c record; v_tasa uuid; v_477 text;
  v_debe bigint := 0; v_haber bigint := 0; v_base bigint := 0; v_nif int; v_dev int; v_c_dev bigint; v_razones jsonb;
  v_rango text;
  linea constant text := '{"local_id": null, "comun": true, "marca_id": null, "tercero_id": null, "documento": null, "iva": null, "retencion": null}';
begin
  select * into v_d from public.conta_tpv_dia where id = p_dia;
  if v_d.id is null then return jsonb_build_object('sin_propuesta', 'Ese día no está guardado.'); end if;
  v_programa := case v_d.programa when 'revo' then 'Revo' else v_d.programa end;
  v_rango := case when v_d.primer_numero = v_d.ultimo_numero then v_d.primer_numero::text else v_d.primer_numero || ' a ' || v_d.ultimo_numero end;

  -- Diez: las ventas de un TPV de fuera todavía no se envían (respuesta R05 · 1, §2).
  if exists (select 1 from public.conta_diez_envio_empresa z where z.company_id = v_d.company_id and z.account_id = v_d.account_id and z.enviar) then
    return jsonb_build_object('sin_propuesta', 'Esta empresa envía su contabilidad a Diez, y las ventas de un TPV de fuera todavía no se pueden enviar a Diez.');
  end if;

  -- La 700 de la hoja, como la propuesta de Folvy.
  select min(a.code) into v_ventas from public.company_account a
   where a.company_id = v_d.company_id and a.kind = 'template' and a.template_code = '700' and a.status is distinct from 'cerrada';
  if v_ventas is null then v_faltan := v_faltan || 'Falta la cuenta de ventas (700) en el plan de la empresa.'::text; end if;

  -- Los cobros, por forma de pago y por el canal de su orden. «Deliverect» va siempre por canal.
  for v_c in
    with cob as (
      select c.forma, c.importe,
             coalesce((select d.canal from public.conta_tpv_documento d where d.dia_id = c.dia_id and d.orden = c.orden order by d.numero limit 1), 'local') as canal
        from public.conta_tpv_cobro c where c.dia_id = p_dia
    ), m as (
      select cob.*,
             (select a.code from public.conta_tpv_forma_cuenta f join public.company_account a on a.id = f.company_account_id and a.company_id = f.company_id
               where f.company_id = v_d.company_id and lower(f.forma) = lower(cob.forma) and f.canal = cob.canal and a.status is distinct from 'cerrada') as por_canal,
             (select a.code from public.conta_tpv_forma_cuenta f join public.company_account a on a.id = f.company_account_id and a.company_id = f.company_id
               where f.company_id = v_d.company_id and lower(f.forma) = lower(cob.forma) and f.canal is null and a.status is distinct from 'cerrada') as general,
             lower(cob.forma) = 'deliverect' as por_canales
        from cob
    )
    select forma, case when por_canales or por_canal is not null then canal end as canal,
           case when por_canales then por_canal else coalesce(por_canal, general) end as cuenta,
           round(sum(importe) * 100)::bigint as c
      from m group by 1, 2, 3 order by 1, 2
  loop
    if v_c.cuenta is null then
      v_faltan := v_faltan || format('Falta decir a qué cuenta va «%s»%s.', v_c.forma,
                                     case when v_c.canal is null then '' when v_c.canal = 'local' then ' en lo vendido en el local' else ' en los pedidos de ' || v_c.canal end);
      continue;
    end if;
    v_lineas := v_lineas || (linea::jsonb || jsonb_build_object(
      'cuenta', v_c.cuenta, 'debe', round(greatest(v_c.c, 0) / 100.0, 2), 'haber', round(greatest(-v_c.c, 0) / 100.0, 2),
      'concepto', 'Cobra ' || v_c.forma || case when v_c.canal is null then '' when v_c.canal = 'local' then ' · en el local' else ' · ' || v_c.canal end,
      'forma', v_c.forma, 'canal', v_c.canal));
    v_debe := v_debe + greatest(v_c.c, 0); v_haber := v_haber + greatest(-v_c.c, 0);
  end loop;

  -- El IVA, una línea por tipo, a la 477 de su tipo; la base suma las ventas.
  for v_t in
    select i.tipo, round(sum(i.base) * 100)::bigint as b, round(sum(i.cuota) * 100)::bigint as q, count(distinct i.documento_id)::int as n
      from public.conta_tpv_impuesto i join public.conta_tpv_documento d on d.id = i.documento_id
     where d.dia_id = p_dia group by i.tipo order by i.tipo
  loop
    v_base := v_base + v_t.b;
    select r.id into v_tasa from public.tax_rate r
     where r.tax_system = 'iva' and r.treatment = 'taxed' and r.rate = v_t.tipo and r.valid_to is null and (r.is_system or r.account_id = v_d.account_id)
     order by r.is_system, r.id limit 1;
    if v_tasa is null then
      v_faltan := v_faltan || format('No sé qué IVA es el %s %%: no es uno de los tipos de la empresa.', public.conta_numero_texto(v_t.tipo));
      continue;
    end if;
    select a.code into v_477 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
     where k.company_id = v_d.company_id and k.entity = 'tax_rate' and k.entity_id = v_tasa::text and k.role = 'repercutido' and a.status is distinct from 'cerrada'
     order by a.code limit 1;
    if v_477 is null then
      v_faltan := v_faltan || format('Falta la cuenta del IVA repercutido al %s %%.', public.conta_numero_texto(v_t.tipo));
      continue;
    end if;
    v_lineas := v_lineas || (linea::jsonb || jsonb_build_object(
      'cuenta', v_477, 'debe', round(greatest(-v_t.q, 0) / 100.0, 2), 'haber', round(greatest(v_t.q, 0) / 100.0, 2),
      'concepto', 'IVA repercutido ' || public.conta_numero_texto(v_t.tipo) || ' %', 'tipo', v_t.tipo,
      'iva', jsonb_build_object('tipo_id', v_tasa, 'base', round(v_t.b / 100.0, 2), 'libro', 'issued', 'deducible', null, 'facturas', v_t.n)));
    v_haber := v_haber + greatest(v_t.q, 0); v_debe := v_debe + greatest(-v_t.q, 0);
  end loop;

  if cardinality(v_faltan) > 0 then
    return jsonb_build_object('sin_propuesta', (select string_agg(x, ' ' order by o) from (select x, min(o) as o from unnest(v_faltan) with ordinality as u(x, o) group by x) z));
  end if;

  v_lineas := v_lineas || (linea::jsonb || jsonb_build_object(
    'cuenta', v_ventas, 'debe', round(greatest(-v_base, 0) / 100.0, 2), 'haber', round(greatest(v_base, 0) / 100.0, 2),
    'concepto', 'Ventas del día · TPV ' || v_programa));
  v_haber := v_haber + greatest(v_base, 0); v_debe := v_debe + greatest(-v_base, 0);
  if v_debe <> v_haber then
    return jsonb_build_object('sin_propuesta', format('Lo cobrado (%s) y lo vendido (%s) no dan lo mismo: vuelve a subir los ficheros de ese día.',
                                                     public.conta_euros_exactos(v_debe / 100.0), public.conta_euros_exactos(v_haber / 100.0)));
  end if;

  select count(*) filter (where cliente_nif is not null), count(*) filter (where total < 0), coalesce(round(sum(total) filter (where total < 0) * 100), 0)
    into v_nif, v_dev, v_c_dev from public.conta_tpv_documento where dia_id = p_dia;
  select jsonb_agg(r.j order by r.k) into v_razones from (
    select 1 as k, jsonb_build_object('decision', v_d.documentos || ' factura' || case when v_d.documentos = 1 then '' else 's' end || ' del TPV (' || v_programa || '), ' || public.conta_euros_exactos(v_d.total),
             'porque', 'las facturas son las del TPV, con su numeración (' || v_rango || '): Sumied no emite factura; van juntas en un asiento resumen del día, con base y cuota por tipo',
             'cita', 'RD 1624/1992 (Reglamento del IVA), art. 63.4') as j
    union all
    select 2, jsonb_build_object('decision', v_nif || ' factura' || case when v_nif = 1 then '' else 's' end || ' con NIF',
             'porque', 'van dentro del día, contadas; irán una a una al libro cuando la gestoría confirme la forma del rango') where v_nif > 0
    union all
    select 3, jsonb_build_object('decision', v_dev || ' devolución' || case when v_dev = 1 then '' else 'es' end || ' de ' || public.conta_euros_exactos(abs(v_c_dev) / 100.0),
             'porque', 'son facturas del TPV en negativo: restan en su día, menos venta y menos IVA', 'cita', 'Ley 37/1992, art. 80.Dos') where v_dev > 0
  ) r;

  return jsonb_build_object(
    'entrada', jsonb_build_object(
      'series', 1, 'fecha', v_d.dia, 'concepto', 'Ventas del día · TPV ' || v_programa,
      'source_type', 'sales_day', 'source_id', v_d.id, 'confianza', 'seguro',
      'porque', v_d.documentos || ' factura' || case when v_d.documentos = 1 then '' else 's' end || ' del TPV, ' || case when v_d.primer_numero = v_d.ultimo_numero then 'la ' else 'de la ' end || replace(v_rango, ' a ', ' a la ')
                || ', cuadran con lo cobrado, al céntimo.',
      'razones', v_razones, 'party_id', null, 'documento', v_d.primer_numero || case when v_d.primer_numero = v_d.ultimo_numero then '' else '-' || v_d.ultimo_numero end),
    'lineas', v_lineas);
end
$function$;

create or replace function public.conta_tpv_dias(p_company uuid, p_desde date default null, p_hasta date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare v_acc uuid; v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  with d as (
    select t.*, lag(t.dia) over w as dia_antes, lag(t.ultimo_numero) over w as ultimo_antes
      from public.conta_tpv_dia t where t.company_id = p_company and t.account_id = v_acc
    window w as (partition by t.programa order by t.dia)
  ), x as (
    select d.*, e.status as estado_asiento, e.number as numero_asiento, e.series as serie_asiento, doc.storage_path as documento,
           case when d.estado = 'guardado' then public._conta_tpv_propuesta(d.id) ->> 'sin_propuesta' end as motivo,
           (select coalesce(jsonb_agg(jsonb_build_object('forma', f.forma, 'importe', f.importe) order by f.forma), '[]'::jsonb)
              from (select c.forma, sum(c.importe) as importe from public.conta_tpv_cobro c where c.dia_id = d.id group by c.forma) f) as formas,
           (select count(*) from public.conta_tpv_documento o where o.dia_id = d.id and o.cliente_nif is not null) as con_nif
      from d
      left join public.journal_entry e on e.id = d.entry_id and e.account_id = v_acc
      left join public.journal_entry_document doc on doc.entry_id = d.entry_id and doc.kind = 'resumen_ventas'
     where (p_desde is null or d.dia >= p_desde) and (p_hasta is null or d.dia <= p_hasta)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'dia', x.dia, 'programa', x.programa, 'programa_nombre', case x.programa when 'revo' then 'Revo' else x.programa end,
           'facturas', x.documentos, 'primero', x.primer_numero, 'ultimo', x.ultimo_numero,
           'base', x.base, 'cuota', x.cuota, 'total', x.total, 'formas', x.formas, 'con_nif', x.con_nif,
           'subido_por', x.subido_por_nombre, 'subido_en', x.subido_en,
           'asiento_id', x.entry_id, 'estado_asiento', x.estado_asiento, 'numero_asiento', x.numero_asiento, 'serie_asiento', x.serie_asiento,
           'documento', x.documento,
           'estado', case when x.estado = 'contabilizado' then 'validado' when x.motivo is not null then 'en_espera' else 'por_validar' end,
           'motivo', x.motivo,
           'aviso', case
             when x.dia_antes is null then null
             when x.primer_numero = x.ultimo_antes + 1 then null
             when x.primer_numero = x.ultimo_antes + 2 then format('Entre el %s y el %s falta la factura %s, o falta por subir un día.',
                    to_char(x.dia_antes, 'DD/MM'), to_char(x.dia, 'DD/MM'), x.ultimo_antes + 1)
             when x.primer_numero > x.ultimo_antes + 2 then format('Entre el %s y el %s faltan las facturas %s a %s, o falta por subir un día.',
                    to_char(x.dia_antes, 'DD/MM'), to_char(x.dia, 'DD/MM'), x.ultimo_antes + 1, x.primer_numero - 1)
             else format('La primera factura del %s (%s) no va detrás de la última del %s (%s).',
                    to_char(x.dia, 'DD/MM'), x.primer_numero, to_char(x.dia_antes, 'DD/MM'), x.ultimo_antes) end
         ) order by x.dia desc, x.programa), '[]'::jsonb) into v_r
    from x;
  return v_r;
end
$function$;

create or replace function public.conta_tpv_dia_para_validar(p_dia uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare v_d public.conta_tpv_dia; v_p jsonb; v_y uuid; v_num int; v_lineas jsonb;
begin
  select * into v_d from public.conta_tpv_dia where id = p_dia;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese día no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida las ventas del día.' using errcode = '42501';
  end if;
  if v_d.estado <> 'guardado' then
    raise exception 'Las ventas del % ya están validadas.', to_char(v_d.dia, 'DD/MM/YYYY') using errcode = '23514', hint = 'r05:validado';
  end if;
  v_p := public._conta_tpv_propuesta(p_dia);
  if v_p ? 'sin_propuesta' then raise exception '%', v_p->>'sin_propuesta' using errcode = '23514', hint = 'r05:espera'; end if;
  select id into v_y from public.fiscal_year where company_id = v_d.company_id and v_d.dia between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_d.dia, 'DD/MM/YYYY') using errcode = '23514'; end if;
  select coalesce(max(number), 0) + 1 into v_num from public.journal_entry
   where company_id = v_d.company_id and fiscal_year_id = v_y and series = 1 and number is not null;
  select jsonb_agg(l || jsonb_build_object('nombre', (select a.name from public.company_account a where a.company_id = v_d.company_id and a.code = l->>'cuenta')) order by o)
    into v_lineas from jsonb_array_elements(v_p->'lineas') with ordinality as z(l, o);
  return jsonb_build_object(
    'dia', public.conta_tpv_dia_leer(v_d.company_id, v_d.dia, v_d.programa),
    'empresa', (select jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id) from public.company c where c.id = v_d.company_id),
    'account_id', v_d.account_id, 'serie', 1, 'numero_previsto', v_num,
    'concepto', v_p->'entrada'->>'concepto', 'lineas', v_lineas);
end
$function$;

create or replace function public.conta_tpv_dia_validar(p_dia uuid, p_entry uuid, p_numero integer, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_d public.conta_tpv_dia; v_p jsonb; v_e jsonb; v_y uuid; v_fecha date; v_l jsonb; v_pos int := 0; v_cta uuid; v_v jsonb;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_prefijo text; v_obj record;
begin
  select * into v_d from public.conta_tpv_dia where id = p_dia for update;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese día no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida las ventas del día.' using errcode = '42501';
  end if;
  if v_d.estado <> 'guardado' then
    raise exception 'Las ventas del % ya están validadas.', to_char(v_d.dia, 'DD/MM/YYYY') using errcode = '23514', hint = 'r05:validado';
  end if;
  if p_entry is null or exists (select 1 from public.journal_entry where id = p_entry) then
    raise exception 'El asiento de ese PDF ya existe: vuelve a pulsar.' using errcode = '40001';
  end if;
  if p_numero is null then raise exception 'Falta el número con el que se hizo el PDF.' using errcode = '22023'; end if;

  -- 1 · Proponer: el asiento, con el id de la ruta del PDF.
  v_p := public._conta_tpv_propuesta(p_dia);
  if v_p ? 'sin_propuesta' then raise exception '%', v_p->>'sin_propuesta' using errcode = '23514', hint = 'r05:espera'; end if;
  -- El candado del IVA, como cualquier asiento de ventas: una expedida no se mueve de su periodo (para).
  v_e := public._conta_iva_ajustar_propuesta(v_d.company_id, v_p->'entrada', v_p->'lineas');
  v_fecha := (v_e->>'fecha')::date;
  select id into v_y from public.fiscal_year where company_id = v_d.company_id and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (p_entry, v_d.account_id, v_d.company_id, v_y, (v_e->>'series')::smallint, v_fecha, v_e->>'concepto', 'sales_day', v_d.id, 'propuesto',
          v_e->>'confianza', v_e->>'porque', coalesce(v_e->'razones', '[]'), null, v_e->>'documento', v_d.dia, auth.uid(), v_quien);
  for v_l in select * from jsonb_array_elements(v_p->'lineas') loop
    v_pos := v_pos + 1;
    select id into v_cta from public.company_account where company_id = v_d.company_id and code = v_l->>'cuenta';
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', v_l->>'cuenta' using errcode = '23514'; end if;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     brand_id, party_id, document_ref, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents)
    values (v_d.account_id, v_d.company_id, p_entry, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto',
            null, true, null, null, null,
            nullif(v_l->'iva'->>'tipo_id', '')::uuid, (v_l->'iva'->>'base')::numeric, v_l->'iva'->>'libro', v_l->'iva'->>'deducible',
            coalesce((v_l->'iva'->>'facturas')::int, 1));
  end loop;

  -- 2 · Validar (las mismas comprobaciones que cualquier asiento) con el número del PDF.
  v_v := public.journal_entry_validar(p_entry, v_quien);
  if (v_v->>'numero')::int <> p_numero then
    raise exception 'El PDF se hizo con el nº % y al validar le toca el nº % (se ha validado otro asiento de la serie a la vez): no se valida. Vuelve a pulsar.',
      p_numero, (v_v->>'numero')::int using errcode = '40001';
  end if;

  -- 3 · Su PDF «Resumen de ventas», obligatorio (como conta_documento_guardar, que es solo de las plataformas).
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'La huella del documento no es un sha256.' using errcode = '22023'; end if;
  v_prefijo := v_d.account_id::text || '/' || p_entry::text || '/';
  if p_ruta is null or left(p_ruta, length(v_prefijo)) <> v_prefijo or substr(p_ruta, length(v_prefijo) + 1) !~ '^[0-9a-f]{16,64}\.pdf$' then
    raise exception 'La ruta del documento no es la de este asiento (%<huella>.pdf).', v_prefijo using errcode = '22023';
  end if;
  select o.name, (o.metadata->>'size')::bigint as bytes into v_obj from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then raise exception 'El documento no está subido (%): no se valida nada.', p_ruta using errcode = 'P0002'; end if;
  if v_obj.bytes is not null and v_obj.bytes <> p_bytes then
    raise exception 'El documento subido no es el del PDF (% bytes y no %).', v_obj.bytes, p_bytes using errcode = '22023';
  end if;
  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by, created_by_name)
  values (v_d.account_id, v_d.company_id, p_entry, 'resumen_ventas', p_ruta, p_nombre, p_sha256, p_bytes, auth.uid(), v_quien);

  -- 4 · En el libro de IVA, el rango del TPV: el primer número y el último (RIVA 63.4).
  update public.vat_book_entry set number = v_d.primer_numero::text, number_to = v_d.ultimo_numero::text, updated_at = now()
   where entry_id = p_entry and book = 'issued';

  -- 5 · El día, contabilizado: ya no se sustituye subiéndolo otra vez.
  update public.conta_tpv_dia set estado = 'contabilizado', entry_id = p_entry where id = p_dia;

  return jsonb_build_object('id', p_entry, 'dia', v_d.dia, 'serie', v_v->'serie', 'numero', v_v->'numero',
    'facturas', v_d.documentos, 'primero', v_d.primer_numero, 'ultimo', v_d.ultimo_numero, 'total', v_d.total,
    'texto', format('Ventas del %s (TPV · %s): validadas con su PDF y el asiento nº %s · %s factura%s, %s, %s.',
      to_char(v_d.dia, 'DD/MM/YYYY'), case v_d.programa when 'revo' then 'Revo' else v_d.programa end, v_v->>'numero',
      v_d.documentos, case when v_d.documentos = 1 then '' else 's' end,
      case when v_d.primer_numero = v_d.ultimo_numero then 'la ' || v_d.primer_numero else 'de la ' || v_d.primer_numero || ' a la ' || v_d.ultimo_numero end,
      public.conta_euros_exactos(v_d.total)));
end
$function$;

comment on function public._conta_tpv_propuesta(uuid) is 'R05: el asiento de un día del TPV (cobros por forma de pago, ventas e IVA por tipo), o por qué no se puede proponer. Solo lee.';
comment on function public.conta_tpv_dias(uuid, date, date) is 'R05: los días del TPV de una empresa para Cierres del día: por validar, en espera con su motivo, o validados, y el aviso de un salto de numeración. Solo lee.';
comment on function public.conta_tpv_dia_para_validar(uuid) is 'R05: lo que hace falta para el PDF de un día del TPV antes de validarlo: el día, el asiento que saldría y el número que le tocaría. Solo lee.';
comment on function public.conta_tpv_dia_validar(uuid, uuid, integer, text, text, text, integer, text) is
  'R05: propone y valida un día del TPV en una transacción, con su PDF obligatorio y el rango del TPV en el libro de IVA. El día queda contabilizado.';

revoke all on function public._conta_tpv_propuesta(uuid) from public, anon, authenticated;
grant execute on function public._conta_tpv_propuesta(uuid) to service_role;
revoke all on function public.conta_tpv_dias(uuid, date, date) from public, anon;
revoke all on function public.conta_tpv_dia_para_validar(uuid) from public, anon;
revoke all on function public.conta_tpv_dia_validar(uuid, uuid, integer, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_tpv_dias(uuid, date, date) to authenticated, service_role;
grant execute on function public.conta_tpv_dia_para_validar(uuid) to authenticated, service_role;
grant execute on function public.conta_tpv_dia_validar(uuid, uuid, integer, text, text, text, integer, text) to authenticated, service_role;
