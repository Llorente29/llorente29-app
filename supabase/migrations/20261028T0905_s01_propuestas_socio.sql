-- supabase/migrations/20261028T0905_s01_propuestas_socio.sql
--
-- S01 · PR 3 · Entrega 5 · ORIGEN 4 DE 5: EL SOCIO DE MARCA (licensed_settlement).
-- Se propone solo al recibir su resumen mensual (cuando su liquidación pasa a
-- confirmada o saldada) y en la pasada de noche. Como hoy, no se valida. Lo
-- que no se puede proponer se dice en Ventas › Liquidaciones, donde se decide
-- (SE_DECIDE_EN, V01 · Entrega 3).
--
-- cambia: public.licensed_settlement · prueba: supabase/staging/sql/20261028_s01_propuestas_socio_prueba.sql
--
-- Las dos fórmulas del navegador, en SQL, una sola copia:
--   1. _conta_cuotas_y_redondeo: cuotasYRedondeo() (las cuotas por tipo, al
--      céntimo, y el céntimo que el documento redondea en su total).
--   2. _conta_aprendizaje: aplicarAprendizaje() (regla 11: la corrección más
--      reciente de cada cuenta del mismo origen se repite, y se dice).
--   3. conta_propuestas_socio(empresa, liquidación): liquidacionMensual()
--      (fórmula «documentos»: su factura, la que le haces y la compensación) y
--      liquidacionSocio() con lo que le añadía el servicio (fórmula «compras,
--      aportaciones y comisión»: las cuentas que faltan, lo cobrado por cuenta
--      de él, los avisos y el aprendizaje). Solo lee.
--   4. conta_proponer_socios(empresa, desde, hasta, quién): las de un rango,
--      como el navegador; y _conta_proponer_socio, una sola (la usa el disparador).
--   5. El disparador de licensed_settlement: al confirmarse o saldarse.
--
-- Dos diferencias a propósito, dichas en el parte:
--   · el nombre del producto en «no sabe si … es un servicio»: el navegador
--     ponía el de la marca que se enseña; aquí, «Sumied» (contabilidad es Sumied);
--   · una liquidación «documentos» sin su factura registrada (received_invoice_id
--     nulo) no se propone y se dice; el navegador mandaba el texto «null» como
--     origen de la compra y de la compensación.
--
-- Medido en producción el 28/10, solo lectura: 3 liquidaciones de socio, las
-- tres de la fórmula «anterior» (junio), ninguna de las que se proponen; 0
-- correcciones aprendidas (journal_correction); 0 asientos licensed_settlement.
-- La regla se compara con la del navegador sobre la semilla de staging (las 6
-- de Marcas del Sur y la de Distribuciones Prueba Aurora): regla 31, dicho en el parte.

-- ── 1 · Las cuotas por tipo y el redondeo del documento ─────────────────────
create or replace function public._conta_cuotas_y_redondeo(p_lineas jsonb, p_total numeric)
returns jsonb language sql immutable set search_path = public as $$
  with b as (
    select (l->>'tipo')::numeric as tipo, sum(round((l->>'base')::numeric, 2)) as base
      from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) l group by 1
  ), f as (
    select tipo, base, sign(base) * round(abs(base * 100 * tipo) / 100) / 100 as cuota from b
  ), s as (
    select coalesce(sum(round(base * 100) + round(cuota * 100)), 0) as suma, count(*) as n from f
  )
  select case when abs(round(p_total * 100) - s.suma) > s.n then null
    else jsonb_build_object(
      'porTipo', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'base', base, 'cuota', cuota) order by tipo) from f), '[]'::jsonb),
      'redondeo', (round(p_total * 100) - s.suma) / 100) end
  from s
$$;
comment on function public._conta_cuotas_y_redondeo(jsonb, numeric) is
  'S01 · PR 3: cuotasYRedondeo() del navegador: {porTipo: [{tipo, base, cuota}], redondeo} o null si el documento no cuadra por más de un céntimo por tipo.';

-- ── 2 · Regla 11 · lo aprendido ─────────────────────────────────────────────
-- Recibe la propuesta con sus razones SIN los avisos (como el navegador, que
-- aprende antes de convertirla) y devuelve la misma con las cuentas corregidas.
create or replace function public._conta_aprendizaje(p_company uuid, p_clave text, p_lineas jsonb, p_razones jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (
    select x.proposed_code, x.chosen_code, x.created_by_name, x.created_at,
           row_number() over (partition by x.proposed_code order by x.created_at desc) as rn
      from public.journal_correction x where x.company_id = p_company and x.origin_key = p_clave
  ), ultima as (select * from c where rn = 1),
  l as (
    select o, case when u.chosen_code is not null and u.chosen_code <> l.v->>'cuenta' then l.v || jsonb_build_object('cuenta', u.chosen_code) else l.v end as v,
           (u.chosen_code is not null and u.chosen_code <> l.v->>'cuenta') as cambia
      from jsonb_array_elements(p_lineas) with ordinality l(v, o) left join ultima u on u.proposed_code = l.v->>'cuenta'
  ), ult as (select * from c order by created_at desc limit 1)
  select case when not exists (select 1 from l where cambia) then jsonb_build_object('lineas', p_lineas, 'razones', p_razones)
    else jsonb_build_object('lineas', (select jsonb_agg(v order by o) from l),
      'razones', p_razones || jsonb_build_array(jsonb_build_object('decision', 'Lo has corregido antes',
        'porque', (select 'en la anterior del mismo origen cambiaste ' || proposed_code || ' por ' || chosen_code
                          || coalesce(' (' || nullif(created_by_name, '') || ')', '') || ': lo hago igual' from ult)))) end
$$;
revoke all on function public._conta_aprendizaje(uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- ── 3 · La regla del socio ──────────────────────────────────────────────────
create or replace function public.conta_propuestas_socio(p_company uuid, p_liq uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  l public.licensed_settlement; v_cuenta uuid; v_socio text; v_local text; v_que text; loc uuid; comun boolean;
  sup uuid; v_cat uuid; c_cliente text; c_proveedor text; c_compras text; c_705 text; c_669 text; c_769 text;
  d jsonb; em jsonb; rc jsonb; v_saldo_doc numeric; v_saldo numeric; v_bloq text; v_rara text;
  cr jsonb; ce jsonb; t jsonb; v_cta text; v_tipo uuid;
  lr jsonb := '[]'::jsonb; le jsonb := '[]'::jsonb; ar jsonb := '[]'::jsonb; ae jsonb := '[]'::jsonb;
  v_serv bigint; v_merc bigint; v_menor bigint; v_r numeric; v_idx int; v_lado text; v_imp numeric; v_que_doc text; v_calc text;
  -- fórmula compras, aportaciones y comisión
  c_400 text; c_430 text; c_pend text; c_477 text; t21 uuid; t10 uuid; t10_rate numeric; v_faltan text[]; v_cobradas numeric;
  lin jsonb := '[]'::jsonb; avisos jsonb := '[]'::jsonb; razones jsonb; v_compras bigint := 0; v_cuota numeric; v_factura bigint; v_iva_com numeric;
  v_contra_liq bigint; v_contra_com bigint; v_neto bigint; v_ap jsonb;
  v_meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  select * into l from public.licensed_settlement where id = p_liq;
  if l.id is null then return jsonb_build_object('que', 'Liquidación del socio', 'sin_propuesta', 'No existe.'); end if;
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is distinct from l.account_id then return jsonb_build_object('que', 'Liquidación del socio', 'sin_propuesta', 'No es de esta cuenta.'); end if;
  loc := l.location_id; comun := loc is null;
  v_local := coalesce((select name from public.locations where id = loc and account_id = v_cuenta), 'local');

  -- ════ Fórmula «documentos» (liquidacionMensual) ════
  if l.formula = 'documentos' then
    sup := l.supplier_id;
    select coalesce((select name from public.party where id = l.party_id), (select name from public.supplier where id = sup), 'el socio'),
           (select expense_category_id from public.supplier where id = sup)
      into v_socio, v_cat;
    v_que := 'Liquidación de ' || v_socio || ' · ' || coalesce(l.settlement_ref, '') || ' · ' || v_local;
    c_cliente := public._conta_enlace(p_company, 'customer', l.party_id::text, 'principal');
    c_proveedor := public._conta_enlace(p_company, 'supplier', sup::text, 'principal');
    c_compras := coalesce(public._conta_enlace(p_company, 'supplier', sup::text, 'gasto'),
                          case when v_cat is not null then public._conta_enlace(p_company, 'expense_category', v_cat::text, 'principal') end);
    c_705 := public._conta_hoja(p_company, '705'); c_669 := public._conta_hoja(p_company, '669'); c_769 := public._conta_hoja(p_company, '769');
    d := coalesce(l.detail, '{}'::jsonb); em := coalesce(d->'emitida', '{}'::jsonb); rc := coalesce(d->'recibida', '{}'::jsonb);
    v_saldo_doc := case when d->'transaccion'->'saldo' is not null and jsonb_typeof(d->'transaccion'->'saldo') = 'object' then coalesce((d->'transaccion'->'saldo'->>'importe')::numeric, 0) end;
    select string_agg(x, ' ' order by o) into v_bloq from jsonb_array_elements_text(coalesce(d->'bloqueos', '[]'::jsonb)) with ordinality b(x, o);
    if v_bloq is not null then return jsonb_build_object('que', v_que, 'sin_propuesta', v_bloq); end if;
    if c_proveedor is null then return jsonb_build_object('que', v_que, 'sin_propuesta', v_socio || ' no tiene su cuenta de proveedor (Contabilidad de su ficha).'); end if;
    if c_cliente is null then return jsonb_build_object('que', v_que, 'sin_propuesta', v_socio || ' no tiene su cuenta de cliente: es a quien le facturas.'); end if;
    if c_compras is null then return jsonb_build_object('que', v_que, 'sin_propuesta', 'A ' || v_socio || ' le falta el tipo de gasto: ponlo en su ficha y su factura se propone.'); end if;
    select x->>'concepto' into v_rara from jsonb_array_elements(coalesce(em->'lineas', '[]'::jsonb)) with ordinality e(x, o)
     where not (x->>'concepto' ~* 'mercader') and not (x->>'concepto' ~* '(servicio|fee|comisi|reparto|delivery|env[ií]o)') order by o limit 1;
    if v_rara is not null then
      return jsonb_build_object('que', v_que, 'sin_propuesta', 'En la factura que le haces, Sumied no sabe si «' || v_rara || '» es un servicio o una venta de mercaderías: dímelo.');
    end if;
    if jsonb_array_length(coalesce(em->'lineas', '[]'::jsonb)) > 0 and c_705 is null then
      return jsonb_build_object('que', v_que, 'sin_propuesta', 'Falta en tu plan la cuenta de ingresos por servicios (705).');
    end if;
    cr := public._conta_cuotas_y_redondeo(rc->'lineas', coalesce((rc->>'total')::numeric, 0));
    ce := public._conta_cuotas_y_redondeo(em->'lineas', coalesce((em->>'total')::numeric, 0));
    if cr is null then return jsonb_build_object('que', v_que, 'sin_propuesta', 'Su factura ' || coalesce(rc->>'numero', 'undefined') || ' no cuadra: sus bases y su IVA no dan su total, y no es un céntimo de redondeo.'); end if;
    if ce is null then return jsonb_build_object('que', v_que, 'sin_propuesta', 'La factura que le haces ' || coalesce(em->>'numero', 'undefined') || ' no cuadra: sus bases y su IVA no dan su total, y no es un céntimo de redondeo.'); end if;
    v_saldo := (round(coalesce((em->>'total')::numeric, 0) * 100) - round(coalesce((rc->>'total')::numeric, 0) * 100)) / 100;
    if v_saldo_doc is not null and round(v_saldo_doc * 100) <> round(v_saldo * 100) then
      return jsonb_build_object('que', v_que, 'sin_propuesta', 'La transacción dice ' || public.conta_euros_exactos(v_saldo_doc) || ' de saldo y las dos facturas dan ' || public.conta_euros_exactos(v_saldo) || '.');
    end if;
    if l.received_invoice_id is null then
      return jsonb_build_object('que', v_que, 'sin_propuesta', 'Su factura ' || coalesce(rc->>'numero', '') || ' aún no está registrada en Compras: confirma la liquidación y se propone.');
    end if;

    -- 1 · Su factura: la compra.
    lr := jsonb_build_array(jsonb_build_object('cuenta', c_compras,
            'debe', (select coalesce(round(sum((x->>'base')::numeric), 2), 0) from jsonb_array_elements(coalesce(rc->'lineas', '[]'::jsonb)) x), 'haber', 0,
            'concepto', null, 'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', rc->>'numero', 'iva', null, 'retencion', null));
    for t in select * from jsonb_array_elements(cr->'porTipo') loop
      continue when (t->>'tipo')::numeric = 0;
      v_tipo := public._conta_tipo_iva(v_cuenta, (t->>'tipo')::numeric);
      v_cta := case when v_tipo is not null then public._conta_enlace(p_company, 'tax_rate', v_tipo::text, 'soportado') end;
      if v_cta is null then return jsonb_build_object('que', v_que, 'sin_propuesta', 'No hay 472 del ' || public.conta_numero_texto((t->>'tipo')::numeric) || ' % en tu plan.'); end if;
      lr := lr || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'debe', (t->>'cuota')::numeric, 'haber', 0, 'concepto', null, 'local_id', loc, 'comun', comun,
              'marca_id', null, 'tercero_id', null, 'documento', rc->>'numero',
              'iva', jsonb_build_object('tipo_id', v_tipo, 'base', (t->>'base')::numeric, 'libro', 'received', 'deducible', 'yes', 'facturas', 1), 'retencion', null));
    end loop;
    lr := lr || jsonb_build_array(jsonb_build_object('cuenta', c_proveedor, 'debe', 0, 'haber', (rc->>'total')::numeric, 'concepto', null, 'local_id', loc, 'comun', comun,
            'marca_id', null, 'tercero_id', l.party_id, 'documento', rc->>'numero', 'iva', null, 'retencion', null));
    -- Pagas su total: si es más que lo calculado, la diferencia es gasto (debe); si es menos, ingreso (haber).
    v_r := (cr->>'redondeo')::numeric;
    if round(v_r * 100) <> 0 then
      v_que_doc := 'su factura ' || coalesce(rc->>'numero', '');
      v_calc := public.conta_euros_exactos((round((rc->>'total')::numeric * 100) - round(v_r * 100)) / 100);
      v_imp := abs(v_r);
      v_cta := case when v_r > 0 then c_669 else c_769 end;
      if v_cta is not null then
        lr := lr || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'debe', case when v_r > 0 then v_imp else 0 end, 'haber', case when v_r > 0 then 0 else v_imp end,
                'concepto', 'Redondeo del total de ' || v_que_doc, 'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
        ar := ar || to_jsonb(upper(left(v_que_doc, 1)) || substr(v_que_doc, 2) || ' dice ' || public.conta_euros_exactos((rc->>'total')::numeric) || '; base y cuota de cada tipo dan '
                || v_calc || '. Las cuotas van como en la factura y el ' || case when v_imp = 0.01 then 'céntimo' else 'redondeo' end || ', a «redondeos».');
      else
        v_lado := case when ((lr->0->>'debe')::numeric) <> 0 then 'debe' else 'haber' end;
        lr := jsonb_set(lr, array['0', v_lado], to_jsonb((round((lr->0->>v_lado)::numeric * 100) + (case when v_lado = 'debe' then 1 else -1 end) * round(v_r * 100)) / 100));
        ar := ar || to_jsonb(upper(left(v_que_doc, 1)) || substr(v_que_doc, 2) || ' dice ' || public.conta_euros_exactos((rc->>'total')::numeric) || ' y base y cuota dan '
                || v_calc || ': el redondeo va a la línea principal (no hay 669/769 en tu plan).');
      end if;
    end if;

    -- 2 · La que le haces: el ingreso (entera a la 705, V01 · Entrega 3).
    select coalesce(sum(round((x->>'base')::numeric * 100)) filter (where x->>'concepto' ~* '(servicio|fee|comisi|reparto|delivery|env[ií]o)'), 0),
           coalesce(sum(round((x->>'base')::numeric * 100)) filter (where x->>'concepto' ~* 'mercader'), 0)
      into v_serv, v_merc from jsonb_array_elements(coalesce(em->'lineas', '[]'::jsonb)) x;
    le := jsonb_build_array(jsonb_build_object('cuenta', c_cliente, 'debe', (em->>'total')::numeric, 'haber', 0, 'concepto', null, 'local_id', loc, 'comun', comun,
            'marca_id', null, 'tercero_id', l.party_id, 'documento', em->>'numero', 'iva', null, 'retencion', null));
    if v_serv + v_merc <> 0 then
      le := le || jsonb_build_array(jsonb_build_object('cuenta', c_705, 'debe', 0, 'haber', (v_serv + v_merc) / 100.0,
              'concepto', case when v_merc <> 0 then 'Servicios por sus ventas y el género aportado' else 'Servicios por sus ventas' end,
              'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', em->>'numero', 'iva', null, 'retencion', null));
    end if;
    for t in select * from jsonb_array_elements(ce->'porTipo') loop
      continue when (t->>'tipo')::numeric = 0;
      v_tipo := public._conta_tipo_iva(v_cuenta, (t->>'tipo')::numeric);
      v_cta := case when v_tipo is not null then public._conta_enlace(p_company, 'tax_rate', v_tipo::text, 'repercutido') end;
      if v_cta is null then return jsonb_build_object('que', v_que, 'sin_propuesta', 'No hay 477 del ' || public.conta_numero_texto((t->>'tipo')::numeric) || ' % en tu plan.'); end if;
      le := le || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'debe', 0, 'haber', (t->>'cuota')::numeric, 'concepto', null, 'local_id', loc, 'comun', comun,
              'marca_id', null, 'tercero_id', null, 'documento', em->>'numero',
              'iva', jsonb_build_object('tipo_id', v_tipo, 'base', (t->>'base')::numeric, 'libro', 'issued', 'deducible', null, 'facturas', 1), 'retencion', null));
    end loop;
    -- Cobras su total: si es menos que lo calculado, la diferencia es gasto (debe); si es más, ingreso (haber).
    v_r := (ce->>'redondeo')::numeric;
    if round(v_r * 100) <> 0 then
      v_que_doc := 'la factura que le haces ' || coalesce(em->>'numero', '');
      v_calc := public.conta_euros_exactos((round((em->>'total')::numeric * 100) - round(v_r * 100)) / 100);
      v_imp := abs(v_r);
      v_cta := case when v_r < 0 then c_669 else c_769 end;
      if v_cta is not null then
        le := le || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'debe', case when v_r < 0 then v_imp else 0 end, 'haber', case when v_r < 0 then 0 else v_imp end,
                'concepto', 'Redondeo del total de ' || v_que_doc, 'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
        ae := ae || to_jsonb(upper(left(v_que_doc, 1)) || substr(v_que_doc, 2) || ' dice ' || public.conta_euros_exactos((em->>'total')::numeric) || '; base y cuota de cada tipo dan '
                || v_calc || '. Las cuotas van como en la factura y el ' || case when v_imp = 0.01 then 'céntimo' else 'redondeo' end || ', a «redondeos».');
      else
        v_idx := case when jsonb_array_length(le) > 1 then 1 else 0 end;
        v_lado := case when ((le->v_idx->>'debe')::numeric) <> 0 then 'debe' else 'haber' end;
        le := jsonb_set(le, array[v_idx::text, v_lado], to_jsonb((round((le->v_idx->>v_lado)::numeric * 100) + (case when v_lado = 'debe' then 1 else -1 end) * round(v_r * 100) * -1) / 100));
        ae := ae || to_jsonb(upper(left(v_que_doc, 1)) || substr(v_que_doc, 2) || ' dice ' || public.conta_euros_exactos((em->>'total')::numeric) || ' y base y cuota dan '
                || v_calc || ': el redondeo va a la línea principal (no hay 669/769 en tu plan).');
      end if;
    end if;

    -- 3 · La compensación: su factura se paga con lo que te debe.
    v_menor := least(round((em->>'total')::numeric * 100), round((rc->>'total')::numeric * 100));
    return jsonb_build_object('que', v_que, 'propuestas', jsonb_build_array(
      jsonb_build_object(
        'entrada', jsonb_build_object('series', 2, 'fecha', rc->>'fecha', 'concepto', 'Factura ' || v_socio || ' · ' || coalesce(rc->>'numero', ''),
          'source_type', 'supplier_invoice', 'source_id', l.received_invoice_id,
          'confianza', case when round((cr->>'redondeo')::numeric * 100) <> 0 then 'probable' else 'seguro' end,
          'porque', 'Lo que te factura cada mes: compra, con su IVA por tipo, a su cuenta de proveedor.',
          'razones', jsonb_build_array(jsonb_build_object('decision', 'Su factura de la liquidación del mes', 'porque', 'no factura las entregas: sus albaranes no se apuntan uno a uno'))
                     || coalesce((select jsonb_agg(jsonb_build_object('decision', 'Mira esto', 'porque', a #>> '{}') order by o) from jsonb_array_elements(ar) with ordinality z(a, o)), '[]'::jsonb),
          'party_id', l.party_id, 'documento', rc->>'numero'),
        'lineas', lr),
      jsonb_build_object(
        'entrada', jsonb_build_object('series', 4, 'fecha', em->>'fecha', 'concepto', 'Le facturas a ' || v_socio || ' · ' || coalesce(em->>'numero', ''),
          'source_type', 'licensed_settlement', 'source_id', l.id,
          'confianza', case when round((ce->>'redondeo')::numeric * 100) <> 0 then 'probable' else 'seguro' end,
          'porque', 'La factura que le haces (la extiende él en tu nombre): ingreso con su IVA, a su cuenta de cliente, con su número en el libro de expedidas.',
          'razones', jsonb_build_array(
                       jsonb_build_object('decision', 'Servicios a la 705, el género que pones tú a la 700', 'porque', 'cada línea por lo que es'),
                       jsonb_build_object('decision', 'Nº ' || coalesce(em->>'numero', '') || ' en el libro de expedidas', 'porque', 'es una factura tuya aunque la haya extendido él'))
                     || coalesce((select jsonb_agg(jsonb_build_object('decision', 'Mira esto', 'porque', a #>> '{}') order by o) from jsonb_array_elements(ae) with ordinality z(a, o)), '[]'::jsonb),
          'party_id', l.party_id, 'documento', em->>'numero'),
        'lineas', le),
      jsonb_build_object(
        'entrada', jsonb_build_object('series', 4, 'fecha', greatest(em->>'fecha', rc->>'fecha'),
          'concepto', 'Compensación con ' || v_socio || ' · ' || coalesce(em->>'numero', '') || ' y ' || coalesce(rc->>'numero', ''),
          'source_type', 'supplier_payment', 'source_id', l.received_invoice_id, 'confianza', 'seguro',
          'porque', case when v_saldo >= 0
                         then 'Su factura se paga con lo que te debe. Te paga ' || public.conta_euros_exactos(v_saldo) || ': es lo que queda en su cuenta de cliente, y llega por el banco.'
                         else 'Lo que le facturas se descuenta de su factura. Le pagas ' || public.conta_euros_exactos(-v_saldo) || ': es lo que queda en su cuenta de proveedor.' end,
          'razones', jsonb_build_array(jsonb_build_object('decision', 'Una factura contra otra', 'porque', 'así lo liquida: se paga la diferencia')),
          'party_id', l.party_id, 'documento', null),
        'lineas', jsonb_build_array(
          jsonb_build_object('cuenta', c_proveedor, 'debe', v_menor / 100.0, 'haber', 0, 'concepto', null, 'local_id', loc, 'comun', comun,
            'marca_id', null, 'tercero_id', l.party_id, 'documento', rc->>'numero', 'iva', null, 'retencion', null),
          jsonb_build_object('cuenta', c_cliente, 'debe', 0, 'haber', v_menor / 100.0, 'concepto', null, 'local_id', loc, 'comun', comun,
            'marca_id', null, 'tercero_id', l.party_id, 'documento', em->>'numero', 'iva', null, 'retencion', null)))));
  end if;

  -- ════ Fórmula «compras, aportaciones y comisión» (liquidacionSocio) ════
  if l.formula = 'compras_aportaciones_comision' then
    v_socio := coalesce((select name from public.party where id = l.party_id and account_id = v_cuenta), 'el socio');
    v_que := 'Liquidación de ' || v_socio || ' · ' || v_local || ' · ' || to_char(l.period_to, 'MM/YYYY');
    sup := (select pr.supplier_id from public.party_role pr where pr.account_id = v_cuenta and pr.role = 'supplier' and pr.party_id = l.party_id and pr.supplier_id is not null
             order by pr.supplier_id limit 1);
    c_400 := case when sup is not null then public._conta_enlace(p_company, 'supplier', sup::text, 'principal') end;
    c_430 := public._conta_enlace(p_company, 'customer', l.party_id::text, 'principal');
    c_pend := public._conta_enlace(p_company, 'customer', l.party_id::text, 'liquidacion');
    c_705 := public._conta_hoja(p_company, '705');
    t21 := (select r.id from public.tax_rate r where r.code = 'iva_general' and r.tax_system = 'iva' and r.valid_to is null and (r.is_system or r.account_id = v_cuenta) order by r.is_system, r.id limit 1);
    select r.id, r.rate into t10, t10_rate from public.tax_rate r where r.code = 'iva_reducido' and r.tax_system = 'iva' and r.valid_to is null and (r.is_system or r.account_id = v_cuenta)
     order by r.is_system, r.id limit 1;
    c_477 := case when t21 is not null then public._conta_enlace(p_company, 'tax_rate', t21::text, 'repercutido') end;
    v_faltan := array_remove(array[case when c_400 is null then 'su 400' end, case when c_430 is null then 'su 430' end,
                                   case when c_pend is null then 'su «Liquidación pendiente»' end, case when c_705 is null then 'la 705' end,
                                   case when c_477 is null then 'la 477 del 21 %' end], null);
    if cardinality(v_faltan) > 0 or t21 is null then
      return jsonb_build_object('que', v_que, 'sin_propuesta', 'Falta ' || array_to_string(v_faltan, ', ') || ': revisa su ficha (Contabilidad).');
    end if;
    -- Lo cobrado por cuenta de él ese mes en ese local: las liquidaciones de sus marcas cedidas.
    v_cobradas := coalesce((select sum(cs.collected_amount) from public.channel_settlement cs
                             where cs.account_id = v_cuenta and cs.flow_type = 'licensed'
                               and cs.brand_id in (select a.brand_id from public.brand_licensing_agreement a where a.account_id = v_cuenta and a.party_id = l.party_id)
                               and cs.collected_on >= l.period_from and cs.collected_on <= l.period_to
                               and (loc is null or cs.location_id is null or cs.location_id = loc)), 0);
    -- Su resumen mensual: las compras, al 10 % (los albaranes no traen IVA).
    if round(coalesce(l.purchases_amount, 0) * 100) <> 0 and t10 is not null then
      v_cuota := sign(l.purchases_amount) * round(abs(round(l.purchases_amount, 2) * 100 * t10_rate) / 100) / 100;
      v_cta := public._conta_enlace(p_company, 'tax_rate', t10::text, 'soportado');
      lin := lin || jsonb_build_array(jsonb_build_object('cuenta', coalesce(public._conta_hoja(p_company, '600'), '60000000'), 'debe', l.purchases_amount, 'haber', 0,
               'concepto', null, 'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
      if v_cuota <> 0 and v_cta is not null then
        lin := lin || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'debe', v_cuota, 'haber', 0, 'concepto', null, 'local_id', loc, 'comun', comun,
                 'marca_id', null, 'tercero_id', null, 'documento', null,
                 'iva', jsonb_build_object('tipo_id', t10, 'base', l.purchases_amount, 'libro', 'received', 'deducible', 'yes', 'facturas', 1), 'retencion', null));
      elsif v_cuota <> 0 then
        avisos := avisos || to_jsonb('No hay 472 del ' || public.conta_numero_texto(t10_rate) || ' %.');
      end if;
      v_compras := round(l.purchases_amount * 100) + round(v_cuota * 100);
    end if;
    if v_compras <> 0 then
      lin := lin || jsonb_build_array(jsonb_build_object('cuenta', c_400, 'debe', 0, 'haber', v_compras / 100.0, 'concepto', 'Su resumen mensual (compras)',
               'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', l.party_id, 'documento', null, 'iva', null, 'retencion', null));
    end if;
    v_iva_com := sign(coalesce(l.commission_amount, 0)) * round(abs(round(coalesce(l.commission_amount, 0), 2) * 100 * 21) / 100) / 100;
    v_factura := round(coalesce(l.commission_amount, 0) * 100) + round(v_iva_com * 100);
    if v_factura <> 0 then
      lin := lin || jsonb_build_array(
        jsonb_build_object('cuenta', c_430, 'debe', v_factura / 100.0, 'haber', 0, 'concepto', 'Tu factura de comisión', 'local_id', loc, 'comun', comun,
          'marca_id', null, 'tercero_id', l.party_id, 'documento', null, 'iva', null, 'retencion', null),
        jsonb_build_object('cuenta', c_705, 'debe', 0, 'haber', coalesce(l.commission_amount, 0), 'concepto', 'Comisión sobre sus ventas', 'local_id', loc, 'comun', comun,
          'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
        jsonb_build_object('cuenta', c_477, 'debe', 0, 'haber', v_iva_com, 'concepto', null, 'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null,
          'iva', jsonb_build_object('tipo_id', t21, 'base', coalesce(l.commission_amount, 0), 'libro', 'issued', 'deducible', null, 'facturas', 1), 'retencion', null));
    end if;
    -- La compensación: tu comisión se cobra primero de lo cobrado por cuenta de él y, si no llega, de sus compras.
    v_contra_liq := least(round(v_cobradas * 100), v_factura);
    if v_contra_liq > 0 then
      lin := lin || jsonb_build_array(
        jsonb_build_object('cuenta', c_pend, 'debe', v_contra_liq / 100.0, 'haber', 0, 'concepto', 'Compensación con lo cobrado por cuenta de él', 'local_id', loc, 'comun', comun,
          'marca_id', null, 'tercero_id', l.party_id, 'documento', null, 'iva', null, 'retencion', null),
        jsonb_build_object('cuenta', c_430, 'debe', 0, 'haber', v_contra_liq / 100.0, 'concepto', 'Compensación con lo cobrado por cuenta de él', 'local_id', loc, 'comun', comun,
          'marca_id', null, 'tercero_id', l.party_id, 'documento', null, 'iva', null, 'retencion', null));
    end if;
    v_contra_com := least(v_compras, v_factura - v_contra_liq);
    if v_contra_com > 0 then
      lin := lin || jsonb_build_array(
        jsonb_build_object('cuenta', c_400, 'debe', v_contra_com / 100.0, 'haber', 0, 'concepto', 'Compensación con sus compras', 'local_id', loc, 'comun', comun,
          'marca_id', null, 'tercero_id', l.party_id, 'documento', null, 'iva', null, 'retencion', null),
        jsonb_build_object('cuenta', c_430, 'debe', 0, 'haber', v_contra_com / 100.0, 'concepto', 'Compensación con sus compras', 'local_id', loc, 'comun', comun,
          'marca_id', null, 'tercero_id', l.party_id, 'documento', null, 'iva', null, 'retencion', null));
    end if;
    if jsonb_array_length(lin) < 2 then return jsonb_build_object('que', v_que, 'sin_propuesta', 'La liquidación del socio está a cero.'); end if;
    v_neto := v_compras + round(v_cobradas * 100) - v_factura;
    razones := jsonb_build_array(
      jsonb_build_object('decision', 'Su resumen mensual es la factura de compra', 'porque', 'lo que te llega con albarán a su nombre sirve para contrastar, no se asienta'),
      jsonb_build_object('decision', 'Tu comisión, ingreso por servicios (705) con IVA 21 %', 'porque', 'es lo único tuyo de sus ventas', 'cita', 'Ley 37/1992, art. 11.Dos.15.º'))
      || case when round(v_cobradas * 100) <> 0 then jsonb_build_array(jsonb_build_object('decision', 'Lo cobrado por cuenta de él, en su cuenta de liquidación',
               'porque', 'no es tuyo ni es lo que le compras: se compensa con tu comisión y el resto se le paga', 'cita', 'PGC de Pymes, NRV 16.ª')) else '[]'::jsonb end;
    if round(coalesce(l.purchases_amount, 0) * 100) <> 0 then
      avisos := avisos || to_jsonb('El IVA de sus compras va al ' || coalesce(public.conta_numero_texto(t10_rate), '10') || ' %: los albaranes no lo traen. Compruébalo con su resumen mensual.');
    end if;
    if round(coalesce(l.contributions_amount, 0) * 100) <> 0 then
      -- toLocaleString('es-ES') del navegador: separa los miles solo desde 10.000.
      avisos := avisos || to_jsonb('Sus aportaciones del mes (' || case when abs(l.contributions_amount) >= 10000 then replace(public.conta_euros_exactos(l.contributions_amount), ' €', '')
                                     else replace(to_char(round(l.contributions_amount, 2), 'FM999999990.00'), '.', ',') end || ' €) no entran aquí: van por el banco cuando llegan.');
    end if;
    v_ap := public._conta_aprendizaje(p_company, 'licensed_settlement:' || l.party_id::text, lin, razones);
    return jsonb_build_object('que', v_que, 'propuestas', jsonb_build_array(jsonb_build_object(
      'entrada', jsonb_build_object('series', 4, 'fecha', l.period_to, 'concepto', 'Liquidación ' || v_socio,
        'source_type', 'licensed_settlement', 'source_id', l.id,
        'confianza', case when jsonb_array_length(avisos) > 0 then 'duda' else 'seguro' end,
        'porque', 'Su resumen mensual como compra, tu comisión como ingreso con IVA, y se compensan: '
                  || case when v_neto >= 0 then 'le pagas ' || public.conta_euros_exactos(v_neto / 100.0) else 'te paga ' || public.conta_euros_exactos(-v_neto / 100.0) end || '.',
        'razones', (v_ap->'razones') || coalesce((select jsonb_agg(jsonb_build_object('decision', 'Mira esto', 'porque', a #>> '{}') order by o)
                                                    from jsonb_array_elements(avisos) with ordinality z(a, o)), '[]'::jsonb),
        'party_id', l.party_id, 'documento', null),
      'lineas', v_ap->'lineas')));
  end if;

  return jsonb_build_object('que', 'Liquidación de ' || coalesce((select name from public.party where id = l.party_id), 'el socio'),
    'sin_propuesta', 'Esta liquidación (fórmula «' || coalesce(l.formula, 'sin fórmula') || '») no se asienta sola: es de antes de la contabilidad.');
end $$;
comment on function public.conta_propuestas_socio(uuid, uuid) is
  'S01 · PR 3: la regla del socio de marca (liquidacionMensual y liquidacionSocio del navegador), en SQL: {que, propuestas: [...]} como aJson, o {que, sin_propuesta}. Solo lee.';
revoke all on function public.conta_propuestas_socio(uuid, uuid) from public, anon, authenticated;

-- Las tres ayudas que necesita (las mismas que el contexto del navegador).
create or replace function public._conta_hoja(p_company uuid, p_template text)
returns text language sql stable security definer set search_path = public as $$
  select ca.code from public.company_account ca where ca.company_id = p_company and ca.kind = 'template'
     and ca.status is distinct from 'cerrada' and ca.template_code = p_template order by ca.code limit 1
$$;
create or replace function public._conta_enlace(p_company uuid, p_entity text, p_entity_id text, p_role text)
returns text language sql stable security definer set search_path = public as $$
  select ca.code from public.company_account_link k join public.company_account ca on ca.id = k.company_account_id
   where k.company_id = p_company and k.entity = p_entity and k.entity_id = p_entity_id and k.role = p_role order by ca.code limit 1
$$;
create or replace function public._conta_tipo_iva(p_cuenta uuid, p_rate numeric)
returns uuid language sql stable security definer set search_path = public as $$
  select r.id from public.tax_rate r where r.tax_system = 'iva' and r.valid_to is null and r.code like 'iva\_%' and r.rate = p_rate
     and (r.is_system or r.account_id = p_cuenta) order by r.is_system, r.code limit 1
$$;
revoke all on function public._conta_hoja(uuid, text) from public, anon, authenticated;
revoke all on function public._conta_enlace(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public._conta_tipo_iva(uuid, numeric) from public, anon, authenticated;

-- ── 4 · Proponerlas ─────────────────────────────────────────────────────────
-- Una: lo que no puede, a «Lo que no he podido proponer» (Ventas › Liquidaciones).
create or replace function public._conta_proponer_socio(p_company uuid, p_liq uuid, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; q jsonb; v_res jsonb; v_prop int := 0; v_ya int := 0; v_desc int := 0; l public.licensed_settlement;
begin
  -- La de «compras, aportaciones y comisión»: si ya tiene asiento vivo, ya estaba; y va el último día de su mes, si está abierto.
  select * into l from public.licensed_settlement where id = p_liq;
  if l.formula = 'compras_aportaciones_comision' then
    if exists (select 1 from public.journal_entry e where e.company_id = p_company and e.source_type = 'licensed_settlement' and e.source_id = l.id
                 and e.status in ('propuesto', 'borrador', 'validado')) then
      return jsonb_build_object('propuestas', 0, 'yaEstaban', 1, 'descartadas', 0, 'sinPropuesta', '[]'::jsonb);
    end if;
    if not public.conta_dia_abierto(p_company, l.period_to) then
      return jsonb_build_object('propuestas', 0, 'yaEstaban', 0, 'descartadas', 0, 'sinPropuesta', '[]'::jsonb);
    end if;
  end if;
  x := public.conta_propuestas_socio(p_company, p_liq);
  if x ? 'sin_propuesta' then
    perform public._conta_no_propuesta(p_company, 'licensed_settlement', p_liq::text, x->>'que', x->>'sin_propuesta', 'Ventas › Liquidaciones');
    return jsonb_build_object('propuestas', 0, 'yaEstaban', 0, 'descartadas', 0, 'sinPropuesta', jsonb_build_array(jsonb_build_object('que', x->>'que', 'porque', x->>'sin_propuesta')));
  end if;
  for q in select * from jsonb_array_elements(x->'propuestas') loop
    continue when not public.conta_dia_abierto(p_company, (q->'entrada'->>'fecha')::date);
    v_res := public._conta_proponer(p_company, q, p_quien);
    if (v_res->>'descartada')::boolean then v_desc := v_desc + 1;
    elsif (v_res->>'existente')::boolean then v_ya := v_ya + 1;
    else v_prop := v_prop + 1; end if;
  end loop;
  -- Se ha podido: lo de antes, fuera (aunque el día de alguna estuviera cerrado).
  delete from public.conta_propuesta_pendiente where company_id = p_company and origen = 'licensed_settlement' and origen_id = p_liq::text;
  return jsonb_build_object('propuestas', v_prop, 'yaEstaban', v_ya, 'descartadas', v_desc, 'sinPropuesta', '[]'::jsonb);
end $$;
revoke all on function public._conta_proponer_socio(uuid, uuid, text) from public, anon, authenticated;

-- Las de un rango, como el navegador: las de «documentos» confirmadas de la
-- empresa (sus asientos llevan la fecha de sus facturas: se leen las de los dos
-- meses de antes), y las de «compras, aportaciones y comisión» confirmadas o
-- saldadas sin asiento vivo, de su último día abierto.
create or replace function public.conta_proponer_socios(p_company uuid, p_desde date, p_hasta date, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; r record; x jsonb; v_prop int := 0; v_ya int := 0; v_desc int := 0; v_sin jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  -- Una persona, solo si administra o encarga la cuenta; desde un disparador propone Sumied.
  if auth.uid() is not null and pg_trigger_depth() = 0 and not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone asientos.' using errcode = '42501';
  end if;
  for r in select l.id from public.licensed_settlement l
            where l.account_id = v_cuenta and l.company_id = p_company and l.formula = 'documentos' and l.status = 'confirmada'
              and l.period_to >= (date_trunc('month', p_desde) - interval '2 months')::date and l.period_from <= p_hasta
            order by l.period_to desc loop
    x := public._conta_proponer_socio(p_company, r.id, p_quien);
    v_prop := v_prop + (x->>'propuestas')::int; v_ya := v_ya + (x->>'yaEstaban')::int; v_desc := v_desc + (x->>'descartadas')::int; v_sin := v_sin || (x->'sinPropuesta');
  end loop;
  for r in select l.id from public.licensed_settlement l
            where l.account_id = v_cuenta and l.formula = 'compras_aportaciones_comision' and l.status in ('confirmada', 'saldada')
              and l.period_to >= p_desde and l.period_to <= p_hasta
            order by l.period_to desc loop
    x := public._conta_proponer_socio(p_company, r.id, p_quien);
    v_prop := v_prop + (x->>'propuestas')::int; v_ya := v_ya + (x->>'yaEstaban')::int; v_desc := v_desc + (x->>'descartadas')::int; v_sin := v_sin || (x->'sinPropuesta');
  end loop;
  return jsonb_build_object('propuestas', v_prop, 'yaEstaban', v_ya, 'descartadas', v_desc, 'sinPropuesta', v_sin);
end $$;
revoke all on function public.conta_proponer_socios(uuid, date, date, text) from public, anon;
grant execute on function public.conta_proponer_socios(uuid, date, date, text) to authenticated, service_role;
comment on function public.conta_proponer_socios(uuid, date, date, text) is
  'S01 · PR 3: propone las liquidaciones del socio de un rango (navegador, pasada de noche); lo que no puede, a conta_propuesta_pendiente (Ventas › Liquidaciones). No valida.';

-- ── 5 · Al recibir su resumen mensual (al confirmarse o saldarse) ──────────
create or replace function public.tg_conta_socio_proponer()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  -- Las de «documentos» son de su empresa; las otras, de cada empresa activa de la
  -- cuenta (como el navegador y la pasada de las ventas).
  for c in select co.id from public.company co
            where co.is_active and co.account_id = new.account_id and (new.company_id is null or co.id = new.company_id) loop
    begin
      perform public._conta_proponer_socio(c.id, new.id, 'Sumied (al recibir su liquidación)');
    exception when others then
      perform public._conta_no_propuesta(c.id, 'licensed_settlement', new.id::text, 'Liquidación del socio',
        'No he podido proponerla al recibirla: ' || sqlerrm, 'Ventas › Liquidaciones');
    end;
  end loop;
  return null;
end $$;
revoke all on function public.tg_conta_socio_proponer() from public, anon, authenticated;
drop trigger if exists conta_socio_proponer on public.licensed_settlement;
create trigger conta_socio_proponer after insert or update of status on public.licensed_settlement
  for each row when (new.status in ('confirmada', 'saldada') and new.formula in ('documentos', 'compras_aportaciones_comision'))
  execute function public.tg_conta_socio_proponer();
