-- supabase/migrations/20261105T1702_dl1_uber_saldos.sql
--
-- DL1 · Uber (43000002) con los saldos limpios a 31/10 (Julio, respuestas DL1·7
-- a DL1·10, 05/11). Propone (no valida) diez asientos en Foodint; Julio los
-- valida en el libro diario. Nada en el camino del pedido.
--
-- Lo que Uber debía en cada cierre de mes es la parte de ese mes de la semana
-- que cruza el cierre (cobro del lunes siguiente + facturas de Uber de esa
-- semana), repartida con la venta de los días (o por días de calendario a
-- 31/12, 31/03 y 30/04, cuando la venta del mes está apuntada de una vez).
--   Promoción del mes = saldo del mes − (deuda al final − deuda al principio).
--
--  1. 01/01  Apertura: Uber debía 1.754,35 a 31/12/2025 y la apertura dice
--            −614,96. Debe 43000002 / Haber 11300000 por 2.369,31.
--  2-7. Fin de cada mes, de enero a junio: promociones de Uber apuntadas como
--            venta (incidencia 1.1). Debe 70009001 por la base y 63400000 por el
--            IVA (sin línea de IVA: no va al 303, que no se toca), Haber 43000002.
--            Base 33.141,68 + IVA 3.314,16 = 36.455,84.
--  8. 31/10  La parte de las promociones que paga Uber en octubre: Debe
--            43000002 468,07 / Haber 70009001 425,52 y 47700000 42,55 (10 %, 4T).
--  9. 31/10  Facturas de Uber con asiento de octubre compensadas: Debe 41000003
--            / Haber 43000002 por 403,55 (las 17, 551,41, menos las 5
--            liquidaciones propuestas de 147,86, que valida Julio aparte).
-- 10. 05/11  Las 43 facturas de Uber con asiento del 05/11, compensadas: Debe
--            41000003 / Haber 43000002 por 6.303,17.
--
-- Lo que tiene que dar, con los diez validados: 43000002 a 01/01 = 1.754,35;
-- a 30/06 = 375,90; a 31/10 = 7.387,89 (7.163,84 + los 224,05 de julio a
-- septiembre, la incidencia 1.9, que no se escribe hasta que decida Julio).
--
-- Cada asiento se propone y, antes de seguir, se le pasan las reglas de validar
-- (conta_motivos_para_validar): si alguno no se podría validar, para y no deja
-- nada. Sin la cuenta de Foodint, no hace nada.

create or replace function public._dl1_asiento_proponer(p_company uuid, p_fecha date, p_concepto text, p_porque text, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_y uuid; v_e uuid; l jsonb; v_pos int := 0; v_cta uuid; v_debe numeric := 0; v_haber numeric := 0; v_mal text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1: esa empresa no está.'; end if;
  if exists (select 1 from public.journal_entry where company_id = p_company and account_id = v_acc and concept = p_concepto and status <> 'anulado') then
    raise exception 'DL1: ya hay un asiento vivo «%»: no se propone otro.', p_concepto;
  end if;
  select id into v_y from public.fiscal_year where company_id = p_company and account_id = v_acc and p_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'DL1: no hay ejercicio para el %.', p_fecha; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_debe := v_debe + coalesce((l->>'debe')::numeric, 0); v_haber := v_haber + coalesce((l->>'haber')::numeric, 0);
  end loop;
  if v_debe <> v_haber or v_debe = 0 then raise exception 'DL1: «%» no cuadra (debe %, haber %).', p_concepto, v_debe, v_haber; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason, created_by_name)
  values (v_acc, p_company, v_y, 4, p_fecha, p_concepto, 'manual', 'propuesto', 'seguro', p_porque, 'Julio (tanda DL1)')
  returning id into v_e;
  for l in select * from jsonb_array_elements(p_lineas) loop
    select id into v_cta from public.company_account where company_id = p_company and account_id = v_acc and code = l->>'cuenta';
    if v_cta is null then raise exception 'DL1: la cuenta % no está en el plan de la empresa.', l->>'cuenta'; end if;
    v_pos := v_pos + 1;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     party_id, tax_rate_id, tax_base, vat_book, tax_documents)
    values (v_acc, p_company, v_e, v_pos, v_cta, coalesce((l->>'debe')::numeric, 0), coalesce((l->>'haber')::numeric, 0), l->>'concepto', null, true,
            nullif(l->>'tercero', '')::uuid, nullif(l->'iva'->>'tipo', '')::uuid, (l->'iva'->>'base')::numeric,
            case when l ? 'iva' then 'issued' end, 1);
  end loop;
  select string_agg(m.motivo, ' · ' order by m.orden) into v_mal from public.conta_motivos_para_validar(v_e) m;
  if v_mal is not null then raise exception 'DL1: «%» no se podría validar: %', p_concepto, v_mal; end if;
  return v_e;
end $$;
revoke all on function public._dl1_asiento_proponer(uuid, date, text, text, jsonb) from public, anon, authenticated, service_role;
comment on function public._dl1_asiento_proponer(uuid, date, text, text, jsonb) is
  'DL1. Propone (no valida) un asiento manual de la serie 4 desde sus líneas; para si no cuadra, si ya hay uno vivo con ese concepto o si no se podría validar. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_uber constant uuid := '477a9cd0-dce2-452d-a68d-cc1d8076c026';   -- el tercero de Uber en la 43000002 y la 41000003
  v_iva10 constant uuid := '79d77d54-606c-4395-b968-02a99eb64dc3';  -- IVA reducido, 10 %
  r record; v_n int := 0;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Uber: sin la cuenta de Foodint, no hay nada que proponer.';
    return;
  end if;

  -- 1. La apertura.
  perform public._dl1_asiento_proponer(v_e, date '2026-01-01',
    'Corrección de la apertura: lo que Uber debía a 31/12/2025 (semana del 29/12 al 04/01)',
    'DL1: la apertura traída de Diez dejó la 43000002 en −614,96; Uber debía 1.754,35 (3/7 del cobro del 05/01 y de sus facturas, 4.093,49). Error de 2025: contra la 113.',
    jsonb_build_array(jsonb_build_object('cuenta', '43000002', 'debe', 2369.31, 'tercero', v_uber),
                      jsonb_build_object('cuenta', '11300000', 'haber', 2369.31)));
  v_n := v_n + 1;

  -- 2-7. Las promociones de enero a junio.
  for r in select * from (values
      (date '2026-01-31', 'enero', 14122.20, 12838.36, 1283.84),
      (date '2026-02-28', 'febrero', 8257.71, 7507.01, 750.70),
      (date '2026-03-31', 'marzo', 3472.95, 3157.23, 315.72),
      (date '2026-04-30', 'abril', 1082.31, 983.92, 98.39),
      (date '2026-05-31', 'mayo', 6303.70, 5730.64, 573.06),
      (date '2026-06-30', 'junio', 3216.97, 2924.52, 292.45)) x(fecha, mes, importe, base, iva) loop
    perform public._dl1_asiento_proponer(v_e, r.fecha,
      format('Promociones de Uber apuntadas como venta, %s 2026 (incidencia 1.1)', r.mes),
      'DL1: la venta de Uber se apuntó con el bruto del portal, antes de las promociones. Saldo del mes menos lo que Uber debía al cierre. El IVA de más se queda como se declaró (decisión de Julio, 05/11): sin línea de IVA.',
      jsonb_build_array(jsonb_build_object('cuenta', '70009001', 'debe', r.base),
                        jsonb_build_object('cuenta', '63400000', 'debe', r.iva),
                        jsonb_build_object('cuenta', '43000002', 'haber', r.importe, 'tercero', v_uber)));
    v_n := v_n + 1;
  end loop;

  -- 8. Lo que paga Uber de las promociones en octubre.
  perform public._dl1_asiento_proponer(v_e, date '2026-10-31',
    'Promociones de Uber que paga Uber, octubre 2026',
    'DL1: Uber ingresa más que la venta apuntada: la parte de la promoción que paga Uber, que el local cobra (base del IVA, art. 78 LIVA). Semanas del 28/09 al 01/11, la parte de octubre repartida con la venta de Folvy.',
    jsonb_build_array(jsonb_build_object('cuenta', '43000002', 'debe', 468.07, 'tercero', v_uber),
                      jsonb_build_object('cuenta', '70009001', 'haber', 425.52),
                      jsonb_build_object('cuenta', '47700000', 'haber', 42.55, 'iva', jsonb_build_object('tipo', v_iva10, 'base', 425.52))));
  v_n := v_n + 1;

  -- 9 y 10. Las facturas de Uber de octubre, compensadas con la fecha de su asiento.
  perform public._dl1_asiento_proponer(v_e, date '2026-10-31',
    'Facturas de Uber de octubre compensadas con sus liquidaciones (asientos de octubre)',
    'DL1: las 17 facturas de Portier Eats con asiento de octubre (551,41) menos las 5 liquidaciones propuestas (147,86), que se validan aparte.',
    jsonb_build_array(jsonb_build_object('cuenta', '41000003', 'debe', 403.55, 'tercero', v_uber),
                      jsonb_build_object('cuenta', '43000002', 'haber', 403.55, 'tercero', v_uber)));
  perform public._dl1_asiento_proponer(v_e, date '2026-11-05',
    'Facturas de Uber de octubre compensadas con sus liquidaciones (asientos del 05/11)',
    'DL1: las 43 facturas de Portier Eats con asiento del 05/11 (fecha de entrada), compensadas ese día.',
    jsonb_build_array(jsonb_build_object('cuenta', '41000003', 'debe', 6303.17, 'tercero', v_uber),
                      jsonb_build_object('cuenta', '43000002', 'haber', 6303.17, 'tercero', v_uber)));
  v_n := v_n + 2;
  raise notice 'DL1 Uber: % asientos propuestos.', v_n;
end $$;
