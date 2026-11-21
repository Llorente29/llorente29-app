-- supabase/migrations/20261121T1600_x22_nombre_de_la_cuenta.sql
-- cambia: public.bank_saldos_cuentas(uuid,date,text[]) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
-- cambia: public.conta_banco_a_mano(uuid,date,text,text,numeric,text) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
-- cambia: public.conta_impuesto_retenciones_diario(uuid,integer,text) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
-- cambia: public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
-- cambia: public.conta_saldos_terceros(uuid,date) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
-- cambia: public.conta_tpv_dia_ejemplo(uuid,jsonb,uuid) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
-- cambia: public.conta_tpv_factura_de(uuid,date) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
-- cambia: public.conta_tpv_factura_guardar(uuid,text,text) · prueba: supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
--
-- X22 · Cada cuenta, con su nombre guardado (encargo del 21/11). La regla de Julio: «las definiciones de las cuentas
-- contables no se deben interpretar; es mejor que se use siempre su definición guardada». Estas ocho funciones
-- devolvían la explicación de la cuenta (company_account.plain_name, «Lo que vendes: comida y bebida…») en lugar de
-- su nombre del plan (company_account.name, «Ventas de mercaderías») cuando la cuenta la tenía. Ahora, el nombre:
--
--   bank_saldos_cuentas: la lectura del banco (los saldos de las cuentas).
--   conta_banco_a_mano: el banco a mano (el nombre de la 572 y el concepto por defecto del apunte).
--   conta_impuesto_retenciones_diario: las retenciones del diario (el perceptor y cada cuenta).
--   conta_recibida_pagar_con_cuenta: el pago con cuenta (K06).
--   conta_saldos_terceros: las cifras (los saldos de los terceros); «por localizar» se sigue reconociendo como antes.
--   conta_tpv_dia_ejemplo: el día de ejemplo de «A qué cuenta va cada forma de pago» (cada línea de sus asientos).
--   conta_tpv_factura_de: la factura del día (la cuenta elegida y la propuesta); «contado» se sigue buscando como antes.
--   conta_tpv_factura_guardar: guardar la factura del día (lo que contesta y su frase).
--
-- Cada una, la que vive hoy en la base (su huella md5, medida en la estructura de staging) con SOLO esa expresión
-- cambiada. Misma firma: create or replace, no una sobrecarga (regla 2). LA GUARDA: si la que vive no es la medida,
-- PARA, sin tocar nada: se volvería a escribir encima de un cambio que esta tanda no conoce.
-- Antes de cambiarlas se guardan byte a byte (_respaldar_funcion); la vuelta atrás
-- (supabase/vuelta-atras/20261121T1600_x22_nombre_de_la_cuenta.down.sql) las restaura de ahí, comprobando la huella.
--
-- Nada en el camino del pedido. El real lo lanza Julio.

-- ── La guarda ──────────────────────────────────────────────────────────────────────
do $guarda$
declare r record;
begin
  for r in select x.firma, x.huella, md5(p.prosrc) viva
             from (values
               ('public.bank_saldos_cuentas(uuid,date,text[])', 'bbed3c914944a06024830b4d1763ea06'),
               ('public.conta_banco_a_mano(uuid,date,text,text,numeric,text)', 'd3f920d897bd9e6e337d0970dbdfb9b3'),
               ('public.conta_impuesto_retenciones_diario(uuid,integer,text)', '5e0734d5dfffa15752173ad32753cc0d'),
               ('public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)', '6d94ed17d431258186a60dc358e0c921'),
               ('public.conta_saldos_terceros(uuid,date)', '004163e9d95d0ad5ade86b2899833504'),
               ('public.conta_tpv_dia_ejemplo(uuid,jsonb,uuid)', '1dbb8fa8ea073a32a8c64ff66760ebc9'),
               ('public.conta_tpv_factura_de(uuid,date)', 'e8b999171a6ef123efe488fb3268b469'),
               ('public.conta_tpv_factura_guardar(uuid,text,text)', 'dfb1d86fd898a386c7c6096d8d97a637')
             ) x(firma, huella)
             left join pg_proc p on p.oid = to_regprocedure(x.firma) loop
    if r.viva is distinct from r.huella then
      raise exception 'X22: % no es la que se midió (huella %, viva %): PARA, no se toca nada.', r.firma, r.huella, coalesce(r.viva, 'no existe');
    end if;
  end loop;
end $guarda$;

select public._respaldar_funcion('public.bank_saldos_cuentas(uuid,date,text[])', '20261121T1600_x22_nombre_de_la_cuenta');
select public._respaldar_funcion('public.conta_banco_a_mano(uuid,date,text,text,numeric,text)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._respaldar_funcion('public.conta_impuesto_retenciones_diario(uuid,integer,text)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._respaldar_funcion('public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._respaldar_funcion('public.conta_saldos_terceros(uuid,date)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._respaldar_funcion('public.conta_tpv_dia_ejemplo(uuid,jsonb,uuid)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._respaldar_funcion('public.conta_tpv_factura_de(uuid,date)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._respaldar_funcion('public.conta_tpv_factura_guardar(uuid,text,text)', '20261121T1600_x22_nombre_de_la_cuenta');

-- ── bank_saldos_cuentas: la lectura del banco (los saldos de las cuentas) ──
CREATE OR REPLACE FUNCTION public.bank_saldos_cuentas(p_company uuid, p_hasta date, p_prefijos text[])
 RETURNS TABLE(cuenta text, nombre text, saldo numeric, tercero_entidad text, tercero_id text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select ca.code, ca.name, coalesce(sum(jl.debit - jl.credit), 0),
         (select l.entity from public.company_account_link l where l.company_account_id = ca.id and l.entity in ('supplier', 'customer') limit 1),
         (select l.entity_id from public.company_account_link l where l.company_account_id = ca.id and l.entity in ('supplier', 'customer') limit 1)
    from public.company_account ca
    left join public.journal_line jl on jl.company_account_id = ca.id
    left join public.journal_entry je on je.id = jl.entry_id
   where ca.company_id = p_company and ca.code like any (select p || '%' from unnest(p_prefijos) p)
     and (je.id is null or (je.status in ('validado', 'anulado', 'propuesto') and je.entry_date <= p_hasta and je.source_type not in ('closing')))
   group by ca.id, ca.code, ca.plain_name, ca.name
  having coalesce(sum(jl.debit - jl.credit), 0) <> 0
$function$;

-- ── conta_banco_a_mano: el banco a mano (el nombre de la 572 y el concepto por defecto del apunte) ──
CREATE OR REPLACE FUNCTION public.conta_banco_a_mano(p_banco uuid, p_fecha date, p_cuenta text, p_concepto text, p_importe numeric, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.treasury_account; v_572 text; v_nombre572 text; v_cta public.company_account; v_imp numeric := round(coalesce(p_importe, 0), 2);
  v_concepto text := nullif(btrim(p_concepto), ''); v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_res jsonb; v_entry uuid; v_val jsonb; v_lineas jsonb;
begin
  select * into t from public.treasury_account where id = p_banco;
  if t.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(t.account_id)) then
    raise exception 'Ese banco no es de tu cuenta.' using errcode = '42501';
  end if;
  -- La 572 del banco (regla 9: de su empresa y su cuenta).
  select a.code, a.name into v_572, v_nombre572
    from public.company_account_link l join public.company_account a on a.id = l.company_account_id and a.company_id = t.company_id
   where l.account_id = t.account_id and l.company_id = t.company_id and l.entity = 'bank_account' and l.entity_id = t.id::text and l.role = 'principal'
   limit 1;
  if v_572 is null then raise exception 'Este banco no tiene su cuenta (572) en el plan: dásela en Cuentas y extractos.' using errcode = '22023'; end if;
  if p_fecha is null then raise exception 'Pon la fecha.' using errcode = '22023'; end if;
  if v_imp = 0 then raise exception 'Pon el ingreso o el pago.' using errcode = '22023'; end if;
  select * into v_cta from public.company_account a
   where a.company_id = t.company_id and a.account_id = t.account_id and a.code = btrim(coalesce(p_cuenta, ''));
  if v_cta.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(p_cuenta), ''), '(vacía)') using errcode = '22023'; end if;
  if v_cta.code = v_572 then raise exception 'La cuenta no puede ser la del propio banco (%).', v_572 using errcode = '22023'; end if;
  v_concepto := coalesce(v_concepto, v_cta.name);
  -- Ingreso: el banco al debe; pago: al haber. La otra cuenta, al revés.
  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta', v_572, 'debe', case when v_imp > 0 then v_imp else 0 end, 'haber', case when v_imp > 0 then 0 else -v_imp end,
                       'concepto', v_concepto, 'comun', true),
    jsonb_build_object('cuenta', v_cta.code, 'debe', case when v_imp > 0 then 0 else -v_imp end, 'haber', case when v_imp > 0 then v_imp else 0 end,
                       'concepto', v_concepto, 'comun', true));
  v_res := public._journal_entry_proponer(t.company_id,
    jsonb_build_object('series', 3, 'fecha', p_fecha, 'concepto', v_concepto, 'source_type', 'manual', 'source_id', null,
                       'confianza', 'seguro', 'porque', format('Escrito a mano en Bancos (%s): no venía en el extracto.', coalesce(t.short_name, t.name)),
                       'razones', jsonb_build_array(jsonb_build_object('decision', 'Escrito a mano', 'porque', 'no venía en el extracto'))),
    v_lineas, null, v_quien, null);
  v_entry := nullif(v_res->>'id', '')::uuid;
  if v_entry is null then raise exception 'No ha salido su asiento (%).', v_res using errcode = 'P0001'; end if;
  -- Validado al momento, como en ERP10: con las reglas de siempre. Si no se puede, no queda nada.
  v_val := public._journal_entry_validar(v_entry, v_quien);
  return jsonb_build_object('asiento_id', v_entry, 'numero', v_val->>'numero', 'serie', v_val->>'serie',
    'texto', format('Apuntado y validado: asiento %s, %s de %s en %s (%s). Cuando llegue en el extracto, se enlaza con él: no se duplica.',
                    v_val->>'numero', case when v_imp > 0 then 'ingreso' else 'pago' end,
                    public.conta_euros_exactos(abs(v_imp)), v_cta.code, v_concepto));
end $function$;

-- ── conta_impuesto_retenciones_diario: las retenciones del diario (el perceptor y cada cuenta) ──
CREATE OR REPLACE FUNCTION public.conta_impuesto_retenciones_diario(p_company uuid, p_year integer, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.company; v_desde date; v_hasta date; v_asientos jsonb; v_sumas jsonb; v_640 jsonb; v_621 numeric; v_4751 jsonb;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  select * into v_desde, v_hasta from public.conta_impuesto_periodo_fechas(p_year, p_period);

  with e as (
    select je.id, je.entry_date, je.series, je.number, je.concept, je.status, je.source_type, je.reverses_entry_id
      from public.journal_entry je
     where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
       and je.entry_date between v_desde and v_hasta
       and exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                    where l.entry_id = je.id and ca.code like '4751%')
  ), x as (
    select e.id, e.entry_date, e.series, e.number, e.concept, e.status, e.source_type, e.reverses_entry_id,
           coalesce(sum(l.credit - l.debit) filter (where ca.code like '4751%'), 0) as retenido,
           bool_or(ca.code ~ '^(10|11|12)') as mueve_grupo_1,
           bool_or(ca.code like '57%') as tesoreria,
           -- S01d: todas sus líneas de la 4751 dicen modelo y periodo y no llevan tipo: es un pago, una compensación o una devolución.
           coalesce(bool_and(l.withholding_rate_id is null and l.withholding_model is not null and l.withholding_period is not null)
                    filter (where ca.code like '4751%'), false) as pago_marcado,
           coalesce(sum(l.debit - l.credit) filter (where ca.code like '621%'), 0) as b621,
           coalesce(sum(l.debit - l.credit) filter (where ca.code like '640%'), 0) as b640,
           coalesce(sum(l.debit - l.credit) filter (where ca.code ~ '^(6|2)' and ca.code !~ '^(621|64)'), 0) as bgasto,
           max(l.withholding_model) filter (where ca.code like '4751%') as modelo_linea,
           max(wr.code) filter (where ca.code like '4751%') as tipo_linea,
           -- La base de la línea de la 4751 (Sumied la exige al validar): manda si la llevan todas.
           case when bool_and(l.withholding_base is not null) filter (where ca.code like '4751%')
                then sum(l.withholding_base) filter (where ca.code like '4751%') end as base_linea,
           string_agg(distinct ca.code, ' ') filter (where ca.code like '4751%') as cuentas_4751,
           -- El perceptor: el tercero de la línea de la 4751 o, si no, la subcuenta del proveedor (40 o 41).
           coalesce(max(l.party_id::text) filter (where ca.code like '4751%'),
                    max(ca.id::text) filter (where ca.code ~ '^(40|41)')) as perceptor,
           max(ca.code || ' · ' || ca.name) filter (where ca.code ~ '^(40|41)') as perceptor_nombre
      from e
      join public.journal_line l on l.entry_id = e.id
      join public.company_account ca on ca.id = l.company_account_id
      left join public.withholding_rate wr on wr.id = l.withholding_rate_id
     group by e.id, e.entry_date, e.series, e.number, e.concept, e.status, e.source_type, e.reverses_entry_id
  ), m0 as (
    select x.*,
           case when x.source_type in ('opening', 'closing') or x.mueve_grupo_1 then 'apertura'
                when x.pago_marcado then 'pago'
                when x.retenido < 0 and x.reverses_entry_id is null and x.tesoreria then 'pago'
                when x.modelo_linea is not null and x.modelo_linea not in ('111', '115') then 'otro_modelo'
                when x.modelo_linea = '115' or (x.modelo_linea is null and x.b621 <> 0) then '115'
                when x.modelo_linea = '111' and x.tipo_linea = 'administradores' then '111_nomina'
                when x.modelo_linea = '111' then '111_profesional'
                when x.b640 <> 0 then '111_nomina'
                when x.bgasto <> 0 then '111_profesional'
                else 'sin_modelo' end as tipo
      from x
  ), m as (
    -- La base: la de la línea de la 4751 si la lleva (con el signo de lo retenido: un
    -- contraasiento resta); si no (lo traído de Diez), la de la regla de arriba.
    select m0.*,
           case when m0.base_linea is not null then sign(m0.retenido) * abs(m0.base_linea)
                else case m0.tipo when '115' then m0.b621 when '111_nomina' then m0.b640 when '111_profesional' then m0.bgasto end end as base
      from m0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'asiento', m.id, 'fecha', m.entry_date, 'serie', m.series, 'numero', m.number, 'concepto', m.concept, 'estado', m.status,
           'tipo', m.tipo, 'retenido', round(m.retenido, 2),
           'base', round(m.base, 2), 'tipo_retencion', m.tipo_linea,
           'perceptor', case when m.tipo in ('115', '111_profesional') then m.perceptor end,
           'perceptor_nombre', case when m.tipo in ('115', '111_profesional') then m.perceptor_nombre end,
           'cuentas_4751', m.cuentas_4751) order by m.entry_date, m.series, m.number), '[]'),
         jsonb_build_object(
           '115', jsonb_build_object('asientos', count(*) filter (where m.tipo = '115'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '115'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '115'), 0), 2)),
           '111_nomina', jsonb_build_object('asientos', count(*) filter (where m.tipo = '111_nomina'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '111_nomina'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '111_nomina'), 0), 2)),
           '111_profesional', jsonb_build_object('asientos', count(*) filter (where m.tipo = '111_profesional'),
                                     'base', round(coalesce(sum(m.base) filter (where m.tipo = '111_profesional'), 0), 2),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = '111_profesional'), 0), 2)),
           'sin_modelo', jsonb_build_object('asientos', count(*) filter (where m.tipo = 'sin_modelo'),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = 'sin_modelo'), 0), 2)),
           'otro_modelo', jsonb_build_object('asientos', count(*) filter (where m.tipo = 'otro_modelo'),
                                     'retenido', round(coalesce(sum(m.retenido) filter (where m.tipo = 'otro_modelo'), 0), 2)),
           'pagos', count(*) filter (where m.tipo = 'pago'),
           'aperturas', count(*) filter (where m.tipo = 'apertura'))
    into v_asientos, v_sumas
    from m;

  -- Los perceptores distintos con algo retenido (un contraasiento lo deja a cero).
  v_sumas := jsonb_set(jsonb_set(v_sumas, '{115,perceptores}', to_jsonb((
      select count(*) from (select a->>'perceptor' from jsonb_array_elements(v_asientos) a where a->>'tipo' = '115' and a->>'perceptor' is not null
                             group by 1 having abs(sum((a->>'retenido')::numeric)) >= 0.005) s))),
    '{111_profesional,perceptores}', to_jsonb((
      select count(*) from (select a->>'perceptor' from jsonb_array_elements(v_asientos) a where a->>'tipo' = '111_profesional' and a->>'perceptor' is not null
                             group by 1 having abs(sum((a->>'retenido')::numeric)) >= 0.005) s)));

  -- Cada línea de la 640 de las nóminas, para explicar una diferencia con lo presentado.
  select coalesce(jsonb_agg(jsonb_build_object('asiento', je.id, 'fecha', je.entry_date, 'importe', round(l.debit - l.credit, 2),
                                               'concepto', coalesce(l.concept, je.concept)) order by je.entry_date, l.position), '[]')
    into v_640
    from public.journal_line l join public.journal_entry je on je.id = l.entry_id
    join public.company_account ca on ca.id = l.company_account_id
   where je.id in (select (a->>'asiento')::uuid from jsonb_array_elements(v_asientos) a where a->>'tipo' = '111_nomina')
     and ca.code like '640%';

  -- La 621 entera del periodo (también los alquileres sin retención) y el haber de cada subcuenta de la 4751.
  select coalesce(sum(l.debit - l.credit), 0) into v_621
    from public.journal_line l join public.journal_entry je on je.id = l.entry_id
    join public.company_account ca on ca.id = l.company_account_id
   where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
     and je.entry_date between v_desde and v_hasta and ca.code like '621%';
  select coalesce(jsonb_agg(jsonb_build_object('cuenta', q.code, 'nombre', q.nombre, 'haber', q.haber, 'debe', q.debe) order by q.code), '[]')
    into v_4751
    from (select ca.code, ca.name as nombre, round(sum(l.credit), 2) as haber, round(sum(l.debit), 2) as debe
            from public.journal_line l join public.journal_entry je on je.id = l.entry_id
            join public.company_account ca on ca.id = l.company_account_id
           where je.account_id = c.account_id and je.company_id = p_company and je.status in ('validado', 'anulado')
             and je.entry_date between v_desde and v_hasta and ca.code like '4751%'
             and je.source_type not in ('opening', 'closing')
             and not exists (select 1 from public.journal_line g join public.company_account gc on gc.id = g.company_account_id
                              where g.entry_id = je.id and gc.code ~ '^(10|11|12)')
           group by 1, 2) q;

  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'asientos', v_asientos, 'sumas', v_sumas,
                            'lineas_640', v_640, 'cuenta_621', round(v_621, 2), 'cuentas_4751', v_4751);
end $function$;

-- ── conta_recibida_pagar_con_cuenta: el pago con cuenta (K06) ──
CREATE OR REPLACE FUNCTION public.conta_recibida_pagar_con_cuenta(p_company uuid, p_invoice uuid, p_cuenta text, p_fecha date, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cuenta uuid := public._pc01e2_empresa(p_company);
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'Sumied');
  v_inv public.supplier_invoice; v_s public.supplier; v_prov text; v_ca public.company_account;
  v_pend numeric; v_party uuid; v_pago uuid; v_r jsonb; v_entry uuid; v_val jsonb; v_numero text; v_concepto text; v_nombre text;
begin
  if p_fecha is null then raise exception 'Falta el día del pago.' using errcode = '22023'; end if;
  if p_fecha > public.conta_hoy() then
    raise exception 'El pago es de un día que aún no ha llegado (%): queda pendiente de pagar.', to_char(p_fecha, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select * into v_inv from public.supplier_invoice where id = p_invoice and account_id = v_cuenta for update;
  if v_inv.id is null or coalesce(v_inv.company_id, p_company) <> p_company then raise exception 'Esa factura no es de la empresa.' using errcode = '23514'; end if;
  v_numero := coalesce(v_inv.invoice_number, 'sin número');
  if v_inv.status <> 'aprobada' then raise exception 'La factura % no está por pagar (está %).', v_numero, v_inv.status using errcode = '23514'; end if;
  if v_inv.payment_method is not distinct from 'compensation' then
    raise exception 'La factura % se paga con su liquidación (compensación): no con otra cuenta.', v_numero using errcode = '23514';
  end if;
  select * into v_s from public.supplier where id = v_inv.supplier_id;
  v_prov := public._pc01e2_cuenta_proveedor(p_company, v_s.id);
  if v_prov is null then
    raise exception '% no tiene su cuenta de proveedor (400) en el plan: sin ella el pago no tendría asiento.', coalesce(v_s.name, 'Su proveedor') using errcode = '23514';
  end if;
  select * into v_ca from public.company_account where company_id = p_company and code = btrim(coalesce(p_cuenta, ''));
  if v_ca.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(p_cuenta), ''), '(vacía)') using errcode = '23514'; end if;
  if v_ca.kind = 'group' then raise exception 'La % es un grupo del plan: elige una subcuenta.', v_ca.code using errcode = '23514'; end if;
  if v_ca.code = v_prov then raise exception 'La % es la del proveedor: no es una cuenta de pago.', v_ca.code using errcode = '23514'; end if;
  if exists (select 1 from public.company_account_link l where l.company_id = p_company and l.entity = 'bank_account' and l.company_account_id = v_ca.id) then
    raise exception 'La % es de un banco, una tarjeta o la caja: ese pago espera el cargo y se casa en Bancos.', v_ca.code using errcode = '23514';
  end if;
  select pendiente into v_pend from public.conta_recibida_pago where invoice_id = v_inv.id;
  v_pend := round(coalesce(v_pend, 0) - public._pc01e2_en_remesa(v_inv.id), 2);
  if v_pend <= 0 then raise exception 'A la factura % no le queda nada por pagar.', v_numero using errcode = '23514'; end if;

  select party_id into v_party from public.party_role where account_id = v_cuenta and supplier_id = v_s.id and role = 'supplier' order by created_at limit 1;
  v_nombre := v_ca.name;
  v_concepto := 'Pago factura ' || v_numero;
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by, created_by_name)
  values (v_cuenta, p_company, v_inv.id, p_fecha, v_pend, null, format('Pagada con la %s (%s), desde su ficha', v_ca.code, v_nombre), auth.uid(), v_quien)
  returning id into v_pago;
  v_r := public._journal_entry_proponer(p_company,
    jsonb_build_object('series', 4, 'fecha', p_fecha, 'source_type', 'supplier_payment', 'source_id', v_pago,
      'concepto', v_concepto, 'party_id', v_party, 'documento', v_inv.invoice_number, 'fecha_documento', v_inv.invoice_date,
      'confianza', 'seguro', 'porque', format('Pago de la factura con la %s, desde su ficha.', v_ca.code)),
    jsonb_build_array(
      jsonb_build_object('cuenta', v_prov, 'tercero_id', v_party, 'documento', v_inv.invoice_number, 'concepto', v_concepto, 'debe', v_pend, 'haber', 0, 'comun', true),
      jsonb_build_object('cuenta', v_ca.code, 'documento', v_inv.invoice_number, 'concepto', v_concepto, 'debe', 0, 'haber', v_pend, 'comun', true)),
    null, v_quien, auth.uid());
  v_entry := nullif(v_r->>'id', '')::uuid;
  if v_entry is null then raise exception 'El asiento del pago no se ha podido proponer (%).', v_r using errcode = '23514'; end if;
  v_val := public.journal_entry_validar(v_entry, v_quien);
  update public.supplier_invoice_payment set entry_id = v_entry where id = v_pago;
  perform public.mark_supplier_invoice_paid(v_inv.id, p_fecha, null);
  return jsonb_build_object('asiento', v_entry, 'serie', 4, 'numero', v_val->'numero', 'importe', v_pend, 'cuenta', v_ca.code,
    'frase', format('Pago apuntado con la %s (%s): %s el %s, asiento 4 / %s. La factura %s queda pagada.',
      v_ca.code, v_nombre, public.conta_euros_exactos(v_pend), to_char(p_fecha, 'DD/MM/YYYY'), v_val->>'numero', v_numero));
end $function$;

-- ── conta_saldos_terceros: las cifras (los saldos de los terceros); «por localizar» se sigue reconociendo como antes ──
CREATE OR REPLACE FUNCTION public.conta_saldos_terceros(p_company uuid, p_hasta date)
 RETURNS TABLE(cuenta text, nombre text, party_id uuid, grupo text, saldo_deudor numeric, saldo_acreedor numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_acc uuid;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  if p_hasta is null then
    raise exception 'Falta la fecha.' using errcode = '22023';
  end if;

  return query
  with s as (
    -- La misma vara que Inicio: conta_saldos_cuentas desde el día 1 del mes.
    select x.company_account_id,
           round(sum(x.inicial_debe - x.inicial_haber + x.apertura_debe - x.apertura_haber
                     + x.periodo_debe - x.periodo_haber + x.regularizacion_debe - x.regularizacion_haber), 2) as saldo
      from public.conta_saldos_cuentas(p_company, date_trunc('month', p_hasta)::date, p_hasta) x
     where x.code ~ '^4[0134]'
     group by x.company_account_id
  )
  select ca.code, ca.name,
         coalesce(
           (select p.id from public.company_account_link l join public.party p on p.account_id = v_acc and p.id::text = l.entity_id
             where l.account_id = v_acc and l.company_id = p_company and l.company_account_id = ca.id
               and l.entity = 'customer' and l.role in ('principal', 'liquidacion')
             order by (l.role = 'principal') desc, l.created_at limit 1),
           (select pr.party_id from public.company_account_link l join public.party_role pr
                on pr.account_id = v_acc and pr.role = 'supplier' and pr.supplier_id::text = l.entity_id
             where l.account_id = v_acc and l.company_id = p_company and l.company_account_id = ca.id
               and l.entity = 'supplier' and l.role in ('principal', 'pago')
             order by (l.role = 'principal') desc, l.created_at, pr.created_at limit 1)),
         case when left(ca.code, 2) in ('43', '44') then 'cliente'
              when left(ca.code, 3) = '407' then 'anticipo'
              when coalesce(ca.plain_name, ca.name) ilike '%por localizar%' then 'por_localizar'
              when left(ca.code, 2) = '40' then 'proveedor'
              else 'acreedor' end,
         greatest(s.saldo, 0), greatest(-s.saldo, 0)
    from s
    join public.company_account ca on ca.id = s.company_account_id and ca.account_id = v_acc and ca.company_id = p_company
   where s.saldo <> 0
   order by ca.code;
end $function$;

-- ── conta_tpv_dia_ejemplo: el día de ejemplo de «A qué cuenta va cada forma de pago» (cada línea de sus asientos) ──
CREATE OR REPLACE FUNCTION public.conta_tpv_dia_ejemplo(p_dia uuid, p_cuentas jsonb DEFAULT '[]'::jsonb, p_factura uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_d public.conta_tpv_dia; v_ventas uuid; v_falta record; v_p jsonb; v_res jsonb; v_c jsonb; v_cta uuid;
  v_sustitutas jsonb := '[]'::jsonb; v_contado_falta boolean := false; v_contado text;
begin
  select * into v_d from public.conta_tpv_dia where id = p_dia;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese día no está.' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_cuentas, '[]'::jsonb)) <> 'array' then raise exception 'Las cuentas van en una lista.' using errcode = '22023'; end if;
  if p_factura is not null and not exists (select 1 from public.company_account where id = p_factura and company_id = v_d.company_id and status is distinct from 'cerrada') then
    raise exception 'La cuenta elegida para la factura del día no es de esta empresa.' using errcode = '22023';
  end if;
  begin
    for v_c in select * from jsonb_array_elements(coalesce(p_cuentas, '[]'::jsonb)) loop
      delete from public.conta_tpv_forma_cuenta
       where company_id = v_d.company_id and lower(forma) = lower(v_c ->> 'forma') and canal is not distinct from nullif(v_c ->> 'canal', '');
      v_cta := nullif(v_c ->> 'cuenta_id', '')::uuid;
      if v_cta is not null then
        if not exists (select 1 from public.company_account where id = v_cta and company_id = v_d.company_id and status is distinct from 'cerrada') then
          raise exception 'La cuenta elegida para «%» no es de esta empresa.', v_c ->> 'forma' using errcode = '22023';
        end if;
        insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
        values (v_d.account_id, v_d.company_id, v_c ->> 'forma', nullif(v_c ->> 'canal', ''), v_cta, 'ejemplo');
      end if;
    end loop;
    select id into v_ventas from public.company_account
     where company_id = v_d.company_id and kind = 'template' and template_code = '700' and status is distinct from 'cerrada' order by code limit 1;
    -- La factura del día: la que se está eligiendo, la guardada o, si no hay, una cualquiera en su lugar («sin cuenta»).
    if p_factura is not null then
      insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name)
      values (v_d.account_id, v_d.company_id, p_factura, 'ejemplo')
      on conflict (company_id) do update set company_account_id = excluded.company_account_id;
    elsif not exists (select 1 from public.conta_tpv_factura_cuenta where company_id = v_d.company_id) then
      -- En su lugar, una cuenta que el día no usa (ni ventas, ni IVA, ni la de una forma de pago): se enseña «sin cuenta».
      select a.id into v_cta from public.company_account a
       where a.company_id = v_d.company_id and a.status is distinct from 'cerrada' and length(a.code) >= 8 and a.code !~ '^(6|7|477)'
         and not exists (select 1 from public.conta_tpv_forma_cuenta k where k.company_id = v_d.company_id and k.company_account_id = a.id)
       order by a.code limit 1;
      if v_cta is not null then
        insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name) values (v_d.account_id, v_d.company_id, v_cta, 'ejemplo');
        v_contado_falta := true;
      end if;
    end if;
    select a.code into v_contado from public.conta_tpv_factura_cuenta f join public.company_account a on a.id = f.company_account_id where f.company_id = v_d.company_id;
    if v_ventas is not null then
      for v_falta in
        select distinct on (lower(x.forma), x.canal) x.forma, x.canal from public._conta_tpv_formas_de(v_d.company_id, array[p_dia]) x
         where public._conta_tpv_cuenta_de(v_d.company_id, x.forma, x.canal) is null
           and (x.canal is not null or not exists (
             select 1 from public.conta_tpv_forma_cuenta k where k.company_id = v_d.company_id and lower(k.forma) = lower(x.forma) and k.canal is not null))
      loop
        insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
        values (v_d.account_id, v_d.company_id, v_falta.forma, v_falta.canal, v_ventas, 'ejemplo');
        v_sustitutas := v_sustitutas || jsonb_build_object('forma', lower(v_falta.forma), 'canal', v_falta.canal);
      end loop;
    end if;
    v_p := public._conta_tpv_propuesta(p_dia);
    raise exception using errcode = 'RR007', message = 'deshacer el ejemplo';
  exception when sqlstate 'RR007' then
    null;
  end;

  if v_p ? 'sin_propuesta' then
    return jsonb_build_object('dia', v_d.dia, 'motivo', v_p ->> 'sin_propuesta', 'factura', null, 'cobro', null);
  end if;
  with uno as (
    select q.que, jsonb_agg(
             case when l ->> 'cuenta' = v_contado and v_contado_falta
                  then jsonb_build_object('cuenta', null, 'nombre', null, 'sin_cuenta', true, 'forma', 'Clientes de contado', 'canal', null, 'contado', true,
                                          'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto')
                  when v_sustitutas @> jsonb_build_array(jsonb_build_object('forma', lower(l ->> 'forma'), 'canal', l -> 'canal'))
                  then jsonb_build_object('cuenta', null, 'nombre', null, 'sin_cuenta', true, 'forma', l ->> 'forma', 'canal', l -> 'canal', 'contado', false,
                                          'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto')
                  else jsonb_build_object('cuenta', l ->> 'cuenta', 'sin_cuenta', false, 'forma', l ->> 'forma', 'canal', l -> 'canal', 'tipo', l -> 'tipo',
                                          'contado', l ->> 'cuenta' = v_contado,
                                          'nombre', (select a.name from public.company_account a where a.company_id = v_d.company_id and a.code = l ->> 'cuenta'),
                                          'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto') end
             order by o) as lineas
      from (values ('factura', v_p -> 'lineas'), ('cobro', v_p -> 'cobro' -> 'lineas')) q(que, ls)
      cross join lateral jsonb_array_elements(coalesce(q.ls, '[]'::jsonb)) with ordinality as z(l, o)
     group by q.que
  )
  select jsonb_build_object('dia', v_d.dia, 'motivo', null,
           'primero', v_d.primer_numero, 'ultimo', v_d.ultimo_numero, 'facturas', v_d.documentos,
           'factura', (select jsonb_build_object('lineas', u.lineas,
                         'debe', (select sum((l ->> 'debe')::numeric) from jsonb_array_elements(u.lineas) l),
                         'haber', (select sum((l ->> 'haber')::numeric) from jsonb_array_elements(u.lineas) l)) from uno u where u.que = 'factura'),
           'cobro', (select jsonb_build_object('lineas', u.lineas,
                         'debe', (select sum((l ->> 'debe')::numeric) from jsonb_array_elements(u.lineas) l),
                         'haber', (select sum((l ->> 'haber')::numeric) from jsonb_array_elements(u.lineas) l)) from uno u where u.que = 'cobro'),
           'sin_cuenta', (select count(*) from uno u, jsonb_array_elements(u.lineas) l where (l ->> 'sin_cuenta')::boolean))
    into v_res;
  return v_res;
end $function$;

-- ── conta_tpv_factura_de: la factura del día (la cuenta elegida y la propuesta); «contado» se sigue buscando como antes ──
CREATE OR REPLACE FUNCTION public.conta_tpv_factura_de(p_company uuid, p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_acc uuid; v jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select jsonb_build_object('cuenta', a.code, 'nombre', a.name, 'desde', coalesce(f.desde, (f.created_at at time zone 'Europe/Madrid')::date),
           'mes', coalesce((select sum(l.debit) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
                             where l.company_account_id = a.id and e.status = 'validado' and e.source_type = 'sales_day'
                               and e.entry_date >= date_trunc('month', coalesce(p_mes, current_date))::date
                               and e.entry_date < (date_trunc('month', coalesce(p_mes, current_date)) + interval '1 month')::date), 0))
    into v from public.conta_tpv_factura_cuenta f join public.company_account a on a.id = f.company_account_id
   where f.company_id = p_company and f.account_id = v_acc;
  return jsonb_build_object('factura', v,
    -- Lo que propone Sumied si no hay ninguna: una 430 que ya se llame «contado».
    'propuesta', (select jsonb_build_object('cuenta', a.code, 'nombre', a.name) from public.company_account a
                   where a.company_id = p_company and a.account_id = v_acc and a.code like '430%' and length(a.code) >= 8
                     and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') and a.status is distinct from 'cerrada'
                   order by a.code limit 1));
end $function$;

-- ── conta_tpv_factura_guardar: guardar la factura del día (lo que contesta y su frase) ──
CREATE OR REPLACE FUNCTION public.conta_tpv_factura_guardar(p_company uuid, p_cuenta text, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_acc uuid; v_a public.company_account; v_desde date;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then raise exception 'Solo un administrador o un encargado de la cuenta elige la cuenta de la factura del día.' using errcode = '42501'; end if;
  select * into v_a from public.company_account where company_id = p_company and account_id = v_acc and code = p_cuenta and status is distinct from 'cerrada';
  if v_a.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', p_cuenta using errcode = '23514'; end if;
  if length(v_a.code) < 8 then raise exception 'La % es una cuenta de grupo: elige una subcuenta.', v_a.code using errcode = '23514'; end if;
  insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name, desde)
  values (v_acc, p_company, v_a.id, coalesce(p_quien_nombre, public.conta_nombre_actor()), (now() at time zone 'Europe/Madrid')::date)
  on conflict (company_id) do update set company_account_id = excluded.company_account_id, created_by_name = excluded.created_by_name
  returning coalesce(desde, (created_at at time zone 'Europe/Madrid')::date) into v_desde;
  return jsonb_build_object('cuenta', v_a.code, 'nombre', v_a.name, 'desde', v_desde,
    'texto', format('La factura del día va a la %s · %s. Desde el %s, cada día va en dos asientos: la factura del día y su cobro.',
                    v_a.code, v_a.name, to_char(v_desde, 'DD/MM/YYYY')));
end $function$;

