-- supabase/staging/sql/20261127_i01g_retenciones_prueba.sql
--
-- SOLO STAGING. Prueba de 20261127T0330_i01g_retenciones_111_115, con \i
-- dentro de la transacción y ROLLBACK: staging no cambia.
--
-- Por sus caminos (regla 10), como el administrador de A, en el 4T de 2026:
-- se validan asientos de verdad (la retención de un administrador, que va con
-- las nóminas; una factura de un profesional; dos alquileres del mismo
-- arrendador; un pago a Hacienda; uno que mueve el grupo 1, y uno del 123), se
-- calcula el 111 y el 115, se escriben los perceptores a mano y se revisa.
-- Sumied no valida una línea de la 4751 sin su tipo, su base y su modelo (lo
-- dijo la primera pasada de esta prueba, run 391): aquí todas los llevan. El
-- camino sin ellos (lo traído de Diez) no se puede validar en staging; se
-- midió contra los 11 trimestres de Foodint en producción, solo leyendo. Lo que ya hubiera en el 4T de A se mide antes y se compara la
-- diferencia: la prueba no supone que el trimestre esté vacío.
--   1. El diario: cada asiento con su modelo; el pago y el del grupo 1, fuera.
--   2. El 111 sin la [01]: sus casillas, el error de los perceptores y que no
--      se puede revisar.
--   3. La [01] a mano (con su motivo): ya se revisa; recalcular lo devuelve a
--      borrador.
--   4. El 115: un arrendador con dos facturas cuenta una vez.
--   5. Una retención del 123 (capital): no va ni en el 111 ni en el 115.
--   6. Lo que no vale: 0 perceptores, sin motivo, otro modelo.
--   7. La cuenta B no lee ni calcula lo de A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA RETENCIONES: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261127T0330_i01g_retenciones_111_115.sql

create temp table prueba_ret (k text primary key, v jsonb) on commit drop;
grant all on prueba_ret to authenticated;

-- ── 0 · Lo que ya hay en el 4T de A ─────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if exists (select 1 from public.tax_return where company_id = emp and form_code in ('111', '115') and fiscal_year = 2026 and period = '4T') then
    raise exception 'PRUEBA RETENCIONES · 0: la empresa A ya tiene un 111 o un 115 del 4T de 2026 en staging. Revisa la prueba.';
  end if;
  insert into prueba_ret values ('antes', public.conta_impuesto_retenciones_diario(emp, 2026, '4T')->'sumas');
end $$;

-- ── 1 · Los asientos, validados de verdad ──────────────────────────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; c640 uuid; c465 uuid; c4751 uuid; c623 uuid; c41p uuid; c621 uuid; c41a uuid; c572 uuid; c100 uuid; e uuid;
  procedure_n int := 0; w_adm uuid; w_prof uuid; w_alq uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select id into c640 from public.company_account where company_id = emp and code = '64000000';
  select id into c465 from public.company_account where company_id = emp and code = '46500000';
  select id into c4751 from public.company_account where company_id = emp and code = '47510000';
  select id into c623 from public.company_account where company_id = emp and code = '62300000';
  select id into c41p from public.company_account where company_id = emp and code = '41000002';
  select id into c621 from public.company_account where company_id = emp and code = '62100000';
  select id into c41a from public.company_account where company_id = emp and code = '41000001';
  select id into c572 from public.company_account where company_id = emp and code = '57200001';
  select id into c100 from public.company_account where company_id = emp and code = '10000000';
  select id into w_adm from public.withholding_rate where is_system and code = 'administradores' and valid_to is null;
  select id into w_prof from public.withholding_rate where is_system and code = 'profesional' and valid_to is null;
  select id into w_alq from public.withholding_rate where is_system and code = 'alquiler' and valid_to is null;
  if w_adm is null or w_prof is null or w_alq is null then raise exception 'PRUEBA RETENCIONES · 1: faltan los tipos de retención administradores, profesional o alquiler.'; end if;
  if v_y is null or c640 is null or c465 is null or c4751 is null or c623 is null or c41p is null or c621 is null or c41a is null or c572 is null or c100 is null then
    raise exception 'PRUEBA RETENCIONES · 1: faltan el ejercicio 2026 o cuentas de la empresa A.';
  end if;
  -- Un administrador (rendimientos del trabajo, con las nóminas): 1.000, 350 retenidos al 35 %.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-05', 'Prueba I01g · administrador', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c640, 1000, 0, loc, null, null, null), (a, emp, e, 2, c4751, 0, 350, loc, w_adm, 1000, '111'), (a, emp, e, 3, c465, 0, 650, loc, null, null, null);
  perform public.journal_entry_validar(e);
  -- Un profesional: 500 de gasto, 75 retenidos.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 2, '2026-10-06', 'Prueba I01g · profesional', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c623, 500, 0, loc, null, null, null), (a, emp, e, 2, c4751, 0, 75, loc, w_prof, 500, '111'), (a, emp, e, 3, c41p, 0, 425, loc, null, null, null);
  perform public.journal_entry_validar(e);
  -- Dos alquileres del mismo arrendador: 1.000 cada uno, 190 retenidos cada uno.
  for procedure_n in 1 .. 2 loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, emp, v_y, 2, make_date(2026, 10, procedure_n), 'Prueba I01g · alquiler ' || procedure_n, 'manual') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
    values (a, emp, e, 1, c621, 1000, 0, loc, null, null, null), (a, emp, e, 2, c4751, 0, 190, loc, w_alq, 1000, '115'), (a, emp, e, 3, c41a, 0, 810, loc, null, null, null);
    perform public.journal_entry_validar(e);
  end loop;
  -- El pago a Hacienda: fuera.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 3, '2026-10-07', 'Prueba I01g · pago del 111', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c4751, 100, 0, loc, w_prof, 0, '111'), (a, emp, e, 2, c572, 0, 100, loc, null, null, null);
  perform public.journal_entry_validar(e);
  -- Uno que mueve el grupo 1 (como la apertura): fuera.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-08', 'Prueba I01g · con el grupo 1', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c100, 5, 0, loc, null, null, null), (a, emp, e, 2, c4751, 0, 5, loc, w_prof, 33.33, '111');
  perform public.journal_entry_validar(e);
end $$;

-- ── 1b · El diario: lo de antes más lo de la prueba ────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  s0 jsonb := (select v from prueba_ret where k = 'antes');
  d jsonb := public.conta_impuesto_retenciones_diario(emp, 2026, '4T');
  s jsonb := d->'sumas';
  f numeric;
begin
  -- dif(ruta) = lo de ahora menos lo de antes.
  if (s#>>'{111_nomina,base}')::numeric - (s0#>>'{111_nomina,base}')::numeric <> 1000
     or (s#>>'{111_nomina,retenido}')::numeric - (s0#>>'{111_nomina,retenido}')::numeric <> 350 then
    raise exception 'PRUEBA RETENCIONES · 1b: el administrador no va con las nóminas con 1.000 de base y 350 retenidos (%).', s->'111_nomina';
  end if;
  if (s#>>'{111_profesional,base}')::numeric - (s0#>>'{111_profesional,base}')::numeric <> 500
     or (s#>>'{111_profesional,retenido}')::numeric - (s0#>>'{111_profesional,retenido}')::numeric <> 75 then
    raise exception 'PRUEBA RETENCIONES · 1b: el profesional no suma 500 de base y 75 retenidos (%).', s->'111_profesional';
  end if;
  if (s#>>'{115,base}')::numeric - (s0#>>'{115,base}')::numeric <> 2000
     or (s#>>'{115,retenido}')::numeric - (s0#>>'{115,retenido}')::numeric <> 380 then
    raise exception 'PRUEBA RETENCIONES · 1b: los alquileres no suman 2.000 de base y 380 retenidos (%).', s->'115';
  end if;
  if (s->>'pagos')::int - (s0->>'pagos')::int <> 1 or (s->>'aperturas')::int - (s0->>'aperturas')::int <> 1 then
    raise exception 'PRUEBA RETENCIONES · 1b: el pago y el del grupo 1 no salen fuera (pagos %, aperturas %).', s->'pagos', s->'aperturas';
  end if;
  if (s#>>'{sin_modelo,asientos}')::int <> (s0#>>'{sin_modelo,asientos}')::int then
    raise exception 'PRUEBA RETENCIONES · 1b: hay asientos de la prueba sin modelo.';
  end if;
  if jsonb_array_length(d->'lineas_640') = 0 then raise exception 'PRUEBA RETENCIONES · 1b: no salen las líneas de la 640.'; end if;
  raise notice 'PRUEBA RETENCIONES · 1: administrador (con las nóminas), profesional y alquileres con su modelo y su base; el pago y el del grupo 1, fuera.';
end $$;

-- ── 2 · El 111 sin la [01] ─────────────────────────────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  s0 jsonb := (select v from prueba_ret where k = 'antes');
  r jsonb := public.conta_impuesto_retenciones_calcular(emp, 2026, '4T', '111');
  c jsonb := r->'casillas';
  v_esperado numeric := (s0#>>'{111_nomina,retenido}')::numeric + (s0#>>'{111_profesional,retenido}')::numeric + 425;
begin
  if (c->>'03')::numeric <> (s0#>>'{111_nomina,retenido}')::numeric + 350 or (c->>'09')::numeric <> (s0#>>'{111_profesional,retenido}')::numeric + 75
     or (c->>'28')::numeric <> v_esperado or (c->>'30')::numeric <> v_esperado then
    raise exception 'PRUEBA RETENCIONES · 2: casillas del 111 mal: %', c;
  end if;
  if c ? '01' then raise exception 'PRUEBA RETENCIONES · 2: la [01] salió calculada; va a mano.'; end if;
  if not (r->>'falta_perceptores')::boolean then raise exception 'PRUEBA RETENCIONES · 2: no dice que faltan los perceptores.'; end if;
  if r->>'resultado' <> 'to_pay' then raise exception 'PRUEBA RETENCIONES · 2: el resultado es «%», no a ingresar.', r->>'resultado'; end if;
  if (select result from public.tax_return_check where tax_return_id = (r->>'declaracion')::uuid and check_key = 'payees_111') <> 'error' then
    raise exception 'PRUEBA RETENCIONES · 2: sin la [01] no hay error de perceptores.';
  end if;
  begin
    perform public.conta_impuesto_revisar((r->>'declaracion')::uuid);
    raise exception 'PRUEBA RETENCIONES · 2: se revisó un 111 sin perceptores.';
  exception when invalid_parameter_value then null;
  end;
  insert into prueba_ret values ('d111', to_jsonb(r->>'declaracion'));
  raise notice 'PRUEBA RETENCIONES · 2: el 111 sale del administrador y el profesional; sin la [01] no se revisa.';
end $$;

-- ── 3 · La [01] a mano ─────────────────────────────────────────────────────
do $$
declare
  d uuid := (select v #>> '{}' from prueba_ret where k = 'd111')::uuid;
  r jsonb := public.conta_impuesto_perceptores_poner(d, 3, 'Prueba: tres nóminas en el trimestre');
begin
  if not (r->>'ok')::boolean or (r#>>'{calculo,casillas,01}')::numeric <> 3 then raise exception 'PRUEBA RETENCIONES · 3: la [01] no queda en 3 (%).', r; end if;
  if r->>'mensaje' not like 'Escrita la [01]: 3 personas%' then raise exception 'PRUEBA RETENCIONES · 3: el mensaje no lo dice: %', r->>'mensaje'; end if;
  if (select origin from public.tax_return_box where tax_return_id = d and box = '01') <> 'manual' then raise exception 'PRUEBA RETENCIONES · 3: la [01] no está como escrita a mano.'; end if;
  if (select result from public.tax_return_check where tax_return_id = d and check_key = 'payees_111') <> 'ok' then raise exception 'PRUEBA RETENCIONES · 3: con la [01], sigue el error.'; end if;
  perform public.conta_impuesto_revisar(d);
  if (select status from public.tax_return where id = d) <> 'reviewed' then raise exception 'PRUEBA RETENCIONES · 3: no queda revisado.'; end if;
  -- Recalcular una revisada la devuelve a borrador, con la [01] de antes.
  perform public.conta_impuesto_retenciones_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T', '111');
  if (select status from public.tax_return where id = d) <> 'draft' then raise exception 'PRUEBA RETENCIONES · 3: recalcular no la devuelve a borrador.'; end if;
  if (select value from public.tax_return_box where tax_return_id = d and box = '01') <> 3 then raise exception 'PRUEBA RETENCIONES · 3: recalcular borró la [01] escrita a mano.'; end if;
  raise notice 'PRUEBA RETENCIONES · 3: la [01] a mano con su motivo, revisado; recalcular vuelve a borrador y la [01] se queda.';
end $$;

-- ── 4 · El 115 ─────────────────────────────────────────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  s0 jsonb := (select v from prueba_ret where k = 'antes');
  r jsonb := public.conta_impuesto_retenciones_calcular(emp, 2026, '4T', '115');
  c jsonb := r->'casillas';
  v_p0 int := coalesce((s0#>>'{115,perceptores}')::int, 0);
begin
  if (c->>'02')::numeric <> (s0#>>'{115,base}')::numeric + 2000 or (c->>'03')::numeric <> (s0#>>'{115,retenido}')::numeric + 380
     or (c->>'05')::numeric <> (c->>'03')::numeric then
    raise exception 'PRUEBA RETENCIONES · 4: casillas del 115 mal: %', c;
  end if;
  -- El arrendador de la prueba cuenta una vez, aunque tenga dos facturas (si ya estaba, ninguna más).
  if (c->>'01')::int not in (v_p0, v_p0 + 1) or (c->>'01')::int < 1 then raise exception 'PRUEBA RETENCIONES · 4: los arrendadores son %, y antes eran %.', c->>'01', v_p0; end if;
  perform public.conta_impuesto_revisar((r->>'declaracion')::uuid);
  raise notice 'PRUEBA RETENCIONES · 4: el 115 sale de los alquileres, un arrendador con dos facturas cuenta una vez, y se revisa.';
end $$;

-- ── 5 · Una retención del 123 (capital): ni en el 111 ni en el 115 ──────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  e uuid; r111 jsonb; r115 jsonb; s jsonb; v_antes111 numeric; v_antes115 numeric;
begin
  v_antes111 := (select value from public.tax_return_box b join public.tax_return t on t.id = b.tax_return_id
                  where t.company_id = emp and t.form_code = '111' and t.fiscal_year = 2026 and t.period = '4T' and b.box = '28');
  v_antes115 := (select value from public.tax_return_box b join public.tax_return t on t.id = b.tax_return_id
                  where t.company_id = emp and t.form_code = '115' and t.fiscal_year = 2026 and t.period = '4T' and b.box = '03');
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, (select id from public.fiscal_year where company_id = emp and code = '2026'), 4, '2026-10-09', 'Prueba I01g · capital (123)', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, (select id from public.company_account where company_id = emp and code = '57200001'), 19, 0, loc, null, null, null),
         (a, emp, e, 2, (select id from public.company_account where company_id = emp and code = '47510000'), 0, 19, loc,
          (select id from public.withholding_rate where is_system and code = 'capital' and valid_to is null), 100, '123');
  perform public.journal_entry_validar(e);
  s := public.conta_impuesto_retenciones_diario(emp, 2026, '4T')->'sumas';
  if (s#>>'{otro_modelo,retenido}')::numeric < 19 then raise exception 'PRUEBA RETENCIONES · 5: el 123 no sale aparte (%).', s->'otro_modelo'; end if;
  r111 := public.conta_impuesto_retenciones_calcular(emp, 2026, '4T', '111');
  r115 := public.conta_impuesto_retenciones_calcular(emp, 2026, '4T', '115');
  if (r111#>>'{casillas,28}')::numeric <> v_antes111 or (r115#>>'{casillas,03}')::numeric <> v_antes115 then
    raise exception 'PRUEBA RETENCIONES · 5: el 123 se coló en el 111 o en el 115 (% y %).', r111->'casillas', r115->'casillas';
  end if;
  raise notice 'PRUEBA RETENCIONES · 5: la retención del 123 sale aparte y no entra ni en el 111 ni en el 115.';
end $$;

-- ── 6 · Lo que no vale ─────────────────────────────────────────────────────
do $$
declare d uuid := (select v #>> '{}' from prueba_ret where k = 'd111')::uuid;
begin
  begin perform public.conta_impuesto_perceptores_poner(d, 0, 'cero'); raise exception 'PRUEBA RETENCIONES · 6: aceptó 0 perceptores.';
  exception when invalid_parameter_value then null; end;
  begin perform public.conta_impuesto_perceptores_poner(d, 3, '  '); raise exception 'PRUEBA RETENCIONES · 6: aceptó la [01] sin motivo.';
  exception when invalid_parameter_value then null; end;
  begin perform public.conta_impuesto_retenciones_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T', '303'); raise exception 'PRUEBA RETENCIONES · 6: calculó un 303 aquí.';
  exception when invalid_parameter_value then null; end;
  raise notice 'PRUEBA RETENCIONES · 6: sin perceptores, sin motivo u otro modelo, no.';
end $$;
reset role;

-- ── 7 · La cuenta B ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform public.conta_impuesto_retenciones_diario('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T'); raise exception 'PRUEBA RETENCIONES · 7: B lee el diario de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_impuesto_retenciones_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T', '111'); raise exception 'PRUEBA RETENCIONES · 7: B calcula el 111 de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA RETENCIONES · 7: la cuenta B no lee ni calcula lo de A.';
end $$;
reset role;

rollback;
