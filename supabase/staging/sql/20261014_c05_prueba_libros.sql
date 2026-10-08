-- supabase/staging/sql/20261014_c05_prueba_libros.sql
--
-- SOLO STAGING. Prueba de las funciones NUEVAS del C05 por sus caminos
-- (regla 10), como las usa la pantalla. Todo en una transacción con ROLLBACK.
--
--   1. conta_saldos_cuentas: lo validado del ejercicio cuadra (Debe = Haber).
--   2. Mapeo: cambiar una cuenta de línea, dejarla fuera, volver al estándar;
--      cada paso deja su fila en el historial. Un usuario ajeno no puede.
--   3. annual_accounts_choice (0130): elegir modelo; con la empresa de otra
--      cuenta, no.
--   4. Cierre: preparar (proponer los tres asientos + enlazar) → cerrar falla
--      con propuestas vivas o sin validar → validar → cerrar → un asiento en
--      el ejercicio cerrado no entra → reabrir con motivo anula apertura y
--      cierre, y el ejercicio vuelve a abrirse.
-- Sobre la empresa A de la semilla (cuenta c01a…). Ninguna cuenta real.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C05 libros: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

-- Preparación (como dueño de la base): el ejercicio siguiente, para la apertura.
insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, previous_year_id)
values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2027', '2027-01-01', '2027-12-31', 'cdb1bd7a-67ef-45be-9179-cc866e42432d');

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

\echo '>>> 0. La serie de la respuesta 3: 510 a «otras deudas», 2935 con la 2405'
do $$
declare v text; n int;
begin
  select string_agg(line_code, ',') , count(*) into v, n from public.annual_accounts_mapping
   where company_id is null and model = 'abreviado' and statement = 'balance' and account_prefix = '510';
  if n <> 1 or v <> 'PNP.C.III.3' then raise exception 'PRUEBA C05 · 0: la 510 del abreviado está en % (% filas); espero una, en PNP.C.III.3.', v, n; end if;
  select string_agg(line_code, ',') into v from public.annual_accounts_mapping
   where company_id is null and model = 'abreviado' and statement = 'balance' and account_prefix = '2935';
  if v is distinct from 'ACT.A.V' then raise exception 'PRUEBA C05 · 0: la 2935 del abreviado está en «%»; espero ACT.A.V, con la 2405.', v; end if;
  select count(*) into n from (select model, account_prefix, coalesce(by_balance, '') from public.annual_accounts_mapping
   where company_id is null and statement = 'balance' group by 1, 2, 3 having count(distinct line_code) > 1) x;
  if n <> 0 then raise exception 'PRUEBA C05 · 0: % cuentas de serie con dos líneas a la vez.', n; end if;
  raise notice 'PRUEBA C05 · 0 en verde: 510 en «Otras deudas a corto plazo», 2935 en V, ninguna cuenta con dos líneas.';
end $$;

\echo '>>> 1. Saldos del ejercicio: lo validado cuadra'
do $$
declare d numeric; h numeric; n int;
begin
  select count(*), sum(inicial_debe + apertura_debe + periodo_debe + regularizacion_debe + cierre_debe),
         sum(inicial_haber + apertura_haber + periodo_haber + regularizacion_haber + cierre_haber)
    into n, d, h from public.conta_saldos_cuentas('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-01-01', '2026-12-31', false);
  if n = 0 then raise exception 'PRUEBA C05 · 1: conta_saldos_cuentas no devuelve ninguna cuenta (la semilla tiene asientos validados).'; end if;
  if d <> h then raise exception 'PRUEBA C05 · 1: no cuadra: Debe % y Haber %.', d, h; end if;
  raise notice 'PRUEBA C05 · 1 en verde: % cuentas, Debe = Haber = %.', n, d;
end $$;

\echo '>>> 2. Mapeo: cambiar, dejar fuera, volver al estándar (con historial)'
do $$
declare r jsonb; v record; n int;
begin
  r := public.conta_mapeo_cambiar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'pymes', 'pyg', '6290', 'OR', null, 'Prueba C05');
  if r->>'de' <> '7' or r->>'a' <> 'OR' then raise exception 'PRUEBA C05 · 2a: cambio mal contado: %', r; end if;
  select * into v from public.annual_accounts_mapping where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and model = 'pymes' and statement = 'pyg' and account_prefix = '6290';
  if v.line_code <> 'OR' or v.origin <> 'empresa' or v.excluded then raise exception 'PRUEBA C05 · 2a: fila propia mal: % % %', v.line_code, v.origin, v.excluded; end if;

  r := public.conta_mapeo_cambiar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'pymes', 'pyg', '6290', null, null, 'Prueba C05: fuera');
  select * into v from public.annual_accounts_mapping where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and model = 'pymes' and statement = 'pyg' and account_prefix = '6290';
  if not v.excluded or r->>'de' <> 'OR' then raise exception 'PRUEBA C05 · 2b: dejar fuera mal: excluida % de %', v.excluded, r->>'de'; end if;
  select count(*) into n from public.annual_accounts_mapping where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and account_prefix = '6290';
  if n <> 1 then raise exception 'PRUEBA C05 · 2b: hay % filas propias de la 6290 (espero 1: la última manda).', n; end if;

  r := public.conta_mapeo_volver_al_estandar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'pymes', 'pyg', '6290');
  if (r->>'vueltas')::int <> 1 then raise exception 'PRUEBA C05 · 2c: volver al estándar devolvió %', r; end if;
  if exists (select 1 from public.annual_accounts_mapping where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and account_prefix = '6290') then
    raise exception 'PRUEBA C05 · 2c: tras volver al estándar sigue habiendo fila propia.';
  end if;
  select count(*) into n from public.annual_accounts_mapping_change where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and account_prefix = '6290';
  if n <> 3 then raise exception 'PRUEBA C05 · 2d: el historial tiene % filas de la 6290 (espero 3).', n; end if;
  raise notice 'PRUEBA C05 · 2 en verde: 6290 de «7» a «OR», fuera, y de vuelta al estándar; 3 filas de historial.';
end $$;

\echo '>>> 2e. Un usuario ajeno no cambia el mapeo'
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.conta_mapeo_cambiar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'pymes', 'pyg', '6290', 'OR', null, null);
    raise exception 'PRUEBA C05 · 2e: un usuario ajeno ha cambiado el mapeo.';
  exception when insufficient_privilege then raise notice 'PRUEBA C05 · 2e en verde: un ajeno recibe 42501.';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
end $$;

\echo '>>> 3. El modelo elegido (0130)'
do $$
declare n int;
begin
  insert into public.annual_accounts_choice (fiscal_year_id, account_id, company_id, model, proposed_model, figures, chosen_by_name)
  values ('cdb1bd7a-67ef-45be-9179-cc866e42432d', 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'abreviado', 'pymes',
          '{"actual": {"activo": 1000}}', 'Prueba C05');
  select count(*) into n from public.annual_accounts_choice where fiscal_year_id = 'cdb1bd7a-67ef-45be-9179-cc866e42432d' and model = 'abreviado';
  if n <> 1 then raise exception 'PRUEBA C05 · 3a: el modelo elegido no se ha guardado.'; end if;
  begin
    insert into public.annual_accounts_choice (fiscal_year_id, account_id, company_id, model, proposed_model)
    values ((select id from public.fiscal_year where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '2027'),
            'c01a0000-0000-4000-8000-00000000000a', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', 'pymes', 'pymes');
    raise exception 'PRUEBA C05 · 3b: se ha guardado un modelo con la empresa de otra cuenta.';
  exception when others then
    if sqlerrm like 'PRUEBA C05%' then raise; end if;
    raise notice 'PRUEBA C05 · 3 en verde: elegido «abreviado»; con la empresa de otra cuenta, rechazado (%).', sqlerrm;
  end;
end $$;

\echo '>>> 4. Cierre: preparar, cerrar, reabrir'
do $$
declare
  v_fy uuid := 'cdb1bd7a-67ef-45be-9179-cc866e42432d';
  v_co uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_reg jsonb := '[]'; v_cie jsonb := '[]'; v_ape jsonb := '[]';
  s record; v_res numeric := 0; r jsonb; v_ids uuid[]; v_n int; v_estado text; v_falla text; v_tarde text;
begin
  -- Regularización: cada 6 y 7 con saldo a cero, contra la 129 (lo mismo que src/modules/conta/lib/cierre.ts).
  for s in select code, sum(inicial_debe + apertura_debe + periodo_debe) - sum(inicial_haber + apertura_haber + periodo_haber) as saldo
             from public.conta_saldos_cuentas(v_co, '2026-01-01', '2026-12-31', false)
            where coalesce(template_code, code) ~ '^[67]' group by code having sum(inicial_debe + apertura_debe + periodo_debe) <> sum(inicial_haber + apertura_haber + periodo_haber) loop
    v_reg := v_reg || jsonb_build_array(jsonb_build_object('cuenta', s.code, 'debe', greatest(-s.saldo, 0), 'haber', greatest(s.saldo, 0), 'comun', true));
    v_res := v_res + s.saldo;
  end loop;
  if jsonb_array_length(v_reg) = 0 then raise exception 'PRUEBA C05 · 4: la semilla no tiene gastos ni ingresos validados que regularizar.'; end if;
  v_reg := v_reg || jsonb_build_array(jsonb_build_object('cuenta', '12900000', 'debe', greatest(v_res, 0), 'haber', greatest(-v_res, 0), 'comun', true));
  r := public.journal_entry_proponer(v_co, jsonb_build_object('fecha', '2026-12-31', 'source_type', 'closing', 'series', 4, 'concepto', 'Regularización 2026 (prueba)', 'confianza', 'seguro', 'porque', 'Prueba C05: cierre por sus caminos.', 'razones', '[{"decision": "cierre-del-ejercicio", "porque": "Prueba C05"}]'::jsonb), v_reg, null, 'Prueba C05');
  v_ids[1] := (r->>'id')::uuid;
  -- Enlazada antes de validarse (como en la pantalla): así cuenta como regularización y no como cierre.
  perform public.conta_cierre_enlazar(v_fy, v_ids[1], null, null);
  perform public.journal_entry_validar(v_ids[1], 'Prueba C05');

  -- Tras regularizar: ninguna 6 ni 7 con saldo (con la regularización dentro).
  select count(*) into v_n from (select code from public.conta_saldos_cuentas(v_co, '2026-01-01', '2026-12-31', false)
   where coalesce(template_code, code) ~ '^[67]'
   group by code having sum(inicial_debe + apertura_debe + periodo_debe + regularizacion_debe) <> sum(inicial_haber + apertura_haber + periodo_haber + regularizacion_haber)) x;
  if v_n <> 0 then raise exception 'PRUEBA C05 · 4a: tras regularizar quedan % cuentas de 6 o 7 con saldo.', v_n; end if;

  -- Cierre: cada 1–5 con saldo a cero; apertura: al revés, el 01/01/2027.
  for s in select code, sum(inicial_debe + apertura_debe + periodo_debe + regularizacion_debe) - sum(inicial_haber + apertura_haber + periodo_haber + regularizacion_haber) as saldo
             from public.conta_saldos_cuentas(v_co, '2026-01-01', '2026-12-31', false)
            where coalesce(template_code, code) ~ '^[1-5]' group by code
           having sum(inicial_debe + apertura_debe + periodo_debe + regularizacion_debe) <> sum(inicial_haber + apertura_haber + periodo_haber + regularizacion_haber) loop
    v_cie := v_cie || jsonb_build_array(jsonb_build_object('cuenta', s.code, 'debe', greatest(-s.saldo, 0), 'haber', greatest(s.saldo, 0), 'comun', true));
    v_ape := v_ape || jsonb_build_array(jsonb_build_object('cuenta', s.code, 'debe', greatest(s.saldo, 0), 'haber', greatest(-s.saldo, 0), 'comun', true));
  end loop;
  r := public.journal_entry_proponer(v_co, jsonb_build_object('fecha', '2026-12-31', 'source_type', 'closing', 'series', 4, 'concepto', 'Cierre 2026 (prueba)', 'confianza', 'seguro', 'porque', 'Prueba C05: cierre por sus caminos.', 'razones', '[{"decision": "cierre-del-ejercicio", "porque": "Prueba C05"}]'::jsonb), v_cie, null, 'Prueba C05');
  v_ids[2] := (r->>'id')::uuid;
  r := public.journal_entry_proponer(v_co, jsonb_build_object('fecha', '2027-01-01', 'source_type', 'opening', 'series', 4, 'concepto', 'Apertura 2027 (prueba)', 'confianza', 'seguro', 'porque', 'Prueba C05: cierre por sus caminos.', 'razones', '[{"decision": "cierre-del-ejercicio", "porque": "Prueba C05"}]'::jsonb), v_ape, null, 'Prueba C05');
  v_ids[3] := (r->>'id')::uuid;

  -- 4a2. Un closing SUELTO (con la marca, pero sin enlazar) con la 477 y la 4751: el validador lo rechaza (0140).
  begin
    r := public.journal_entry_proponer(v_co, jsonb_build_object('fecha', '2026-12-31', 'source_type', 'closing', 'series', 4, 'concepto', 'Cierre suelto (prueba)',
      'confianza', 'seguro', 'porque', 'Prueba C05.', 'razones', '[{"decision": "cierre-del-ejercicio", "porque": "Prueba C05"}]'::jsonb), v_cie, null, 'Prueba C05');
    perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba C05');
    v_falla := null;
  exception when others then v_falla := sqlerrm; end;
  if v_falla is null or v_falla not like '%apunte de IVA lleva base%' then
    raise exception 'PRUEBA C05 · 4a2: un cierre suelto sin enlazar con la 477 dio «%» (espero el rechazo de la regla de IVA).', coalesce(v_falla, 'validado');
  end if;
  raise notice 'PRUEBA C05 · 4a2 en verde: closing suelto rechazado (%).', left(v_falla, 90);

  r := public.conta_cierre_enlazar(v_fy, v_ids[1], v_ids[2], v_ids[3]);
  select status into v_estado from public.fiscal_year_closing where fiscal_year_id = v_fy;
  if v_estado <> 'preparado' then raise exception 'PRUEBA C05 · 4b: enlazar deja el cierre en «%».', v_estado; end if;

  -- Cerrar con el cierre y la apertura sin validar: no.
  begin perform public.conta_cierre_cerrar(v_fy); v_falla := null;
  exception when others then v_falla := sqlerrm; end;
  if v_falla is null or v_falla not like '%Faltan por validar%' then raise exception 'PRUEBA C05 · 4c: cerrar sin validar dio «%».', coalesce(v_falla, 'ningún error'); end if;
  perform public.journal_entry_validar(v_ids[2], 'Prueba C05');
  perform public.journal_entry_validar(v_ids[3], 'Prueba C05');

  -- Con propuestas vivas en el ejercicio: no.
  begin perform public.conta_cierre_cerrar(v_fy); v_falla := null;
  exception when others then v_falla := sqlerrm; end;
  if v_falla is null or v_falla not like '%Quedan asientos propuestos%' then raise exception 'PRUEBA C05 · 4d: cerrar con propuestas dio «%».', coalesce(v_falla, 'ningún error'); end if;
  for s in select id from public.journal_entry where company_id = v_co and fiscal_year_id = v_fy and status in ('propuesto', 'borrador') loop
    perform public.journal_entry_descartar(s.id, 'Prueba C05: cierre del ejercicio');
  end loop;

  r := public.conta_cierre_cerrar(v_fy);
  select status into v_estado from public.fiscal_year where id = v_fy;
  if v_estado <> 'closed' then raise exception 'PRUEBA C05 · 4e: cerrar deja el ejercicio «%».', v_estado; end if;
  -- Todo el balance a cero en 2026 tras el cierre.
  select count(*) into v_n from (select code from public.conta_saldos_cuentas(v_co, '2026-01-01', '2026-12-31', false)
   group by code having sum(inicial_debe + apertura_debe + periodo_debe + regularizacion_debe + cierre_debe) <> sum(inicial_haber + apertura_haber + periodo_haber + regularizacion_haber + cierre_haber)) x;
  if v_n <> 0 then raise exception 'PRUEBA C05 · 4e: tras el cierre quedan % cuentas con saldo en 2026.', v_n; end if;

  -- Un asiento con fecha en el ejercicio cerrado: no entra.
  begin
    perform public.journal_entry_proponer(v_co, jsonb_build_object('fecha', '2026-11-15', 'source_type', 'manual', 'series', 4, 'concepto', 'Tarde (prueba)', 'confianza', 'seguro', 'porque', 'Prueba C05.'),
      '[{"cuenta": "62900000", "debe": 10}, {"cuenta": "57200001", "haber": 10}]'::jsonb, null, 'Prueba C05');
    v_tarde := null;
  exception when others then v_tarde := sqlerrm; end;
  if v_tarde is null then raise exception 'PRUEBA C05 · 4f: ha entrado un asiento en el ejercicio cerrado.'; end if;
  if v_tarde not like '%ejercicio%' then raise exception 'PRUEBA C05 · 4f: el asiento tardío falló por otra cosa: %', v_tarde; end if;

  -- Reabrir: sin motivo no; con motivo anula apertura y cierre.
  begin perform public.conta_cierre_reabrir(v_fy, ' '); v_falla := null;
  exception when others then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C05 · 4g: se ha reabierto sin motivo.'; end if;
  r := public.conta_cierre_reabrir(v_fy, 'Prueba C05: falta una factura');
  select status into v_estado from public.fiscal_year where id = v_fy;
  if v_estado <> 'open' or jsonb_array_length(r->'anulados') <> 2 then raise exception 'PRUEBA C05 · 4g: reabrir: ejercicio «%», anulados %.', v_estado, r->'anulados'; end if;
  if (select status from public.journal_entry where id = v_ids[2]) <> 'anulado' or (select status from public.journal_entry where id = v_ids[3]) <> 'anulado' then
    raise exception 'PRUEBA C05 · 4g: el cierre o la apertura no han quedado anulados.';
  end if;
  if (select status from public.journal_entry where id = v_ids[1]) <> 'validado' then raise exception 'PRUEBA C05 · 4g: la regularización no debía tocarse.'; end if;
  -- 4h. Tras reabrir, la regularización sigue contando como tal (la pantalla no regulariza dos veces).
  select count(*) into v_n from (select code from public.conta_saldos_cuentas(v_co, '2026-01-01', '2026-12-31', false)
   where coalesce(template_code, code) ~ '^[67]'
   group by code having sum(inicial_debe + apertura_debe + periodo_debe + regularizacion_debe) <> sum(inicial_haber + apertura_haber + periodo_haber + regularizacion_haber)) x;
  if v_n <> 0 then raise exception 'PRUEBA C05 · 4h: tras reabrir, % cuentas de 6 o 7 vuelven a tener saldo: la regularización ya no cuenta como tal.', v_n; end if;
  raise notice 'PRUEBA C05 · 4 en verde: resultado % a la 129; cierre con % apuntes; cerrar rechaza sin validar y con propuestas; cerrado no admite asientos (%); reabierto con 2 anulados.',
    -v_res, jsonb_array_length(v_cie), v_tarde;
end $$;

rollback;
