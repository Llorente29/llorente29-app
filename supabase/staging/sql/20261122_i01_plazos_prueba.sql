-- supabase/staging/sql/20261122_i01_plazos_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0100_i01_plazos (tax_holiday_year,
-- tax_holiday, tax_form_deadline, conta_impuesto_habil,
-- conta_impuesto_fin_periodo y conta_impuesto_plazo). La migración se aplica
-- DENTRO de la transacción (\i) y todo acaba en ROLLBACK: staging no cambia.
-- Las llamadas van como usuario (role authenticated).
--
--   1. Las 14 fechas de domiciliación del calendario oficial de la AEAT de
--      2026 («Plazos de presentación de autoliquidaciones con domiciliación
--      bancaria»): 303 4T/2025 y trimestres de 2026, 111/115 trimestral y los
--      doce mensuales, 200 de 2025 y los tres 202. Las 14 fechas distintas,
--      todas.
--   2. Los últimos días de presentación del calendario de 2026 (§6.3 del
--      informe del paso 1), también los trasladados: 190/180 al 02/02, 347 al
--      02/03, 200 al 27/07 y 202 3P al 21/12.
--   3. 2027 sale con su fecha y marcado provisional (falta el BOCM); el 303
--      4T/2026: presentación 01/02/2027, domiciliación 27/01/2027.
--   4. Lo que no hay no se inventa: un año sin festivos, una regla que no está
--      (349 mensual) y un periodo que no es de esa periodicidad, paran.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA plazos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

\i supabase/migrations/20261122T0100_i01_plazos.sql

set local role authenticated;

do $$
declare
  c record; p record; v_ok int := 0; v_fechas date[] := '{}'; v_err text;
begin
  -- 1 y 2 · El calendario oficial de 2026.
  for c in select * from (values
    -- modelo, periodicidad, ejercicio, periodo, presentación, domiciliación (null = sin ingreso)
    ('303', 'trimestral',       2025, '4T', date '2026-01-30', date '2026-01-27'),
    ('303', 'trimestral',       2026, '1T', date '2026-04-20', date '2026-04-15'),
    ('303', 'trimestral',       2026, '2T', date '2026-07-20', date '2026-07-15'),
    ('303', 'trimestral',       2026, '3T', date '2026-10-20', date '2026-10-15'),
    ('111', 'trimestral',       2025, '4T', date '2026-01-20', date '2026-01-15'),
    ('115', 'trimestral',       2025, '4T', date '2026-01-20', date '2026-01-15'),
    ('111', 'mensual',          2025, '12', date '2026-01-20', date '2026-01-15'),
    ('111', 'mensual',          2026, '01', date '2026-02-20', date '2026-02-17'),
    ('111', 'mensual',          2026, '02', date '2026-03-20', date '2026-03-16'),
    ('111', 'mensual',          2026, '03', date '2026-04-20', date '2026-04-15'),
    ('111', 'mensual',          2026, '04', date '2026-05-20', date '2026-05-15'),
    ('111', 'mensual',          2026, '05', date '2026-06-22', date '2026-06-17'),
    ('111', 'mensual',          2026, '06', date '2026-07-20', date '2026-07-15'),
    ('111', 'mensual',          2026, '07', date '2026-08-20', date '2026-08-17'),
    ('111', 'mensual',          2026, '08', date '2026-09-21', date '2026-09-16'),
    ('111', 'mensual',          2026, '09', date '2026-10-20', date '2026-10-15'),
    ('111', 'mensual',          2026, '10', date '2026-11-20', date '2026-11-17'),
    ('115', 'mensual',          2026, '11', date '2026-12-21', date '2026-12-16'),
    ('200', 'anual',            2025, '0A', date '2026-07-27', date '2026-07-22'),
    ('202', 'pago_fraccionado', 2026, '1P', date '2026-04-20', date '2026-04-15'),
    ('202', 'pago_fraccionado', 2026, '2P', date '2026-10-20', date '2026-10-15'),
    ('202', 'pago_fraccionado', 2026, '3P', date '2026-12-21', date '2026-12-16'),
    ('390', 'anual',            2025, '0A', date '2026-01-30', null::date),
    ('349', 'trimestral',       2025, '4T', date '2026-01-30', null::date),
    ('190', 'anual',            2025, '0A', date '2026-02-02', null::date),
    ('180', 'anual',            2025, '0A', date '2026-02-02', null::date),
    ('347', 'anual',            2025, '0A', date '2026-03-02', null::date)
  ) as t(modelo, periodicidad, ejercicio, periodo, pres, dom) loop
    select * into p from public.conta_impuesto_plazo(c.modelo, c.periodicidad, c.ejercicio, c.periodo);
    if p.presentacion is distinct from c.pres or p.domiciliacion is distinct from c.dom then
      raise exception 'PRUEBA plazos: % % % %: presentación % (espera %), domiciliación % (espera %).',
        c.modelo, c.periodicidad, c.ejercicio, c.periodo, p.presentacion, c.pres, p.domiciliacion, c.dom;
    end if;
    if p.provisional is not null and c.pres < date '2027-01-01' then
      raise exception 'PRUEBA plazos: % % de 2026 sale provisional: %.', c.modelo, c.periodo, p.provisional;
    end if;
    if p.regla is null or p.regla = '' then raise exception 'PRUEBA plazos: % % sin norma.', c.modelo, c.periodo; end if;
    if c.dom is not null and not (c.dom = any (v_fechas)) then v_fechas := v_fechas || c.dom; end if;
    v_ok := v_ok + 1;
  end loop;
  if cardinality(v_fechas) <> 14 then
    raise exception 'PRUEBA plazos: salen % fechas de domiciliación distintas y el calendario oficial de 2026 tiene 14.', cardinality(v_fechas);
  end if;
  raise notice 'PRUEBA plazos 1 y 2: % casos del calendario oficial de 2026; las 14 fechas de domiciliación, 14 de 14.', v_ok;

  -- 3 · 2027, provisional.
  select * into p from public.conta_impuesto_plazo('303', 'trimestral', 2026, '4T');
  if p.presentacion <> date '2027-02-01' or p.domiciliacion <> date '2027-01-27' or p.provisional is null then
    raise exception 'PRUEBA plazos 3: 303 4T/2026: % / % / provisional «%».', p.presentacion, p.domiciliacion, p.provisional;
  end if;
  raise notice 'PRUEBA plazos 3: 303 4T/2026 → 01/02/2027 y 27/01/2027, provisional: %', p.provisional;

  -- 4 · Lo que no hay, para.
  begin
    perform public.conta_impuesto_plazo('303', 'trimestral', 2028, '1T');
    raise exception 'PRUEBA plazos 4: un año sin festivos ha dado fecha.';
  exception when sqlstate 'P0002' then get stacked diagnostics v_err = message_text;
    if v_err not like 'No están cargados los festivos de 2028%' then raise exception 'PRUEBA plazos 4: mensaje «%».', v_err; end if;
  end;
  begin
    perform public.conta_impuesto_plazo('349', 'mensual', 2026, '07');
    raise exception 'PRUEBA plazos 4: el 349 mensual ha dado fecha sin regla.';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.conta_impuesto_plazo('303', 'trimestral', 2026, '07');
    raise exception 'PRUEBA plazos 4: «07» ha valido como trimestre.';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PRUEBA plazos 4: sin festivos, sin regla o con un periodo que no es, para con su motivo.';
end $$;

reset role;
rollback;
