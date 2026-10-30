-- supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
--
-- SOLO STAGING. Prueba del S01d (Bancos y retenciones), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Por sus caminos (regla 10), como
-- el administrador de A. Nada real: importes de la respuesta de Julio, cuentas
-- y periodos de prueba (2024), sin nombres.
--
--   1. La compensación de Hacienda (como la 282630417974P): un asiento con la
--      4751 a los dos lados y sin la 57. Sin modelo ni periodo no valida;
--      dicho cada apunte (111 · 1T 2024 y 115 · 4T 2023), sí. El 111 queda con
--      306,99 € por pagar; el 115 · 4T 2023 no tiene declaración: solo suma.
--   2. El pago de un 115 (como el del 3T): parado por la regla hasta decir su
--      modelo y periodo; al validarlo, la declaración queda pagada, con su
--      asiento y una nota (el disparador).
--   3. Impuestos › «Casar el cargo» de un 111: el asiento va a la subcuenta de
--      la 4751 del 111 (no a la 4750 del 303), con su periodo, por el camino
--      del banco (bank_casar y _journal_entry_proponer), y se valida solo.
--   4. El diario de retenciones: la compensación es un pago (no 641,08 € de
--      profesionales), y una retención que nace sigue contando.
--   5. Lo que no vale: tipo y periodo a la vez, otra cuenta, otro modelo, un
--      periodo mal escrito, un asiento validado.
--   6. La cuenta B no ve ni cambia nada de A.
--   7. La vuelta atrás, y otra vez delante.
--   8. Préstamos y aplazamientos (antes del 7): un cuadro cuyo capital no
--      suma lo aplazado no se guarda; el que sí, con lo pendiente en cada
--      fila y el capital a corto; la póliza, sin cuota; B no da de alta en A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/migrations/20261030T0855_s01d_columnas_retencion.sql
\i supabase/migrations/20261030T0900_s01d_retenciones_pago.sql
\i supabase/migrations/20261030T0901_s01d_modelo_de_la_4751_foodint.sql
\i supabase/migrations/20261030T0934_s01d_contratos_columnas.sql
\i supabase/migrations/20261030T0935_s01d_contratos.sql

create temp table _s01d (k text primary key, v text) on commit drop;
grant all on _s01d to authenticated;

-- ── 0 · Lo de la prueba: la empresa A, sus dos subcuentas de la 4751 y tres declaraciones de 2024 ──
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp uuid := (select id from public.company where account_id = a and tax_id = 'B28000016');
  c4751 public.company_account; v_id uuid;
begin
  if emp is null then raise exception 'PRUEBA S01d · 0: no está la empresa de prueba de A.'; end if;
  select * into c4751 from public.company_account where company_id = emp and code = '47510000';
  if c4751.id is null or not exists (select 1 from public.company_account where company_id = emp and code = '57200001')
     or not exists (select 1 from public.fiscal_year where company_id = emp and code = '2026') then
    raise exception 'PRUEBA S01d · 0: faltan la 47510000, la 57200001 o el ejercicio 2026 de A.';
  end if;
  if exists (select 1 from public.tax_return where company_id = emp and fiscal_year = 2024 and form_code in ('111', '115')) then
    raise exception 'PRUEBA S01d · 0: A ya tiene un 111 o un 115 de 2024 en staging. Revisa la prueba.';
  end if;
  -- La 115 de la prueba: una subcuenta más de la 4751, como la 47510019 de Foodint. Propia
  -- («own»): una de plantilla solo puede ser la 47510000 (company_account_check1).
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, status, is_common, source, created_by_name)
  values (a, emp, c4751.plan, '47510077', c4751.template_code, 'Prueba S01d · retenciones de alquileres', null, 'own', 'activa', false, 'manual', 'prueba')
  returning id into v_id;
  update public.company_account set withholding_model = '111' where id = c4751.id;
  update public.company_account set withholding_model = '115' where id = v_id;
  -- Presentadas: con su CSV de la AEAT (tax_return_check5), inventado.
  insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, period, cadence, kind, status, amount, result_kind, sequence, due_date, filed_at, filed_via, aeat_csv)
  select a, emp, (select id from public.tax_obligation where company_id = emp and form_code = f limit 1), f, 2024, p, 'quarterly', 'normal', 'filed', imp, 'to_pay', 1, d, now(), 'outside', 'PRUEBAS01D' || f || p
    from (values ('111', '1T', 661.33, date '2024-04-20'), ('115', '2T', 1069.02, date '2024-07-20'), ('111', '3T', 578.01, date '2024-10-20')) v(f, p, imp, d);
  insert into _s01d values ('emp', emp::text);
end $$;

-- ── 1 · La compensación ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  emp uuid := (select v::uuid from _s01d where k = 'emp');
  e uuid; m text; r jsonb; p jsonb;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values (a, emp, (select id from public.fiscal_year where company_id = emp and code = '2026'), 4, '2026-10-05', 'Prueba S01d · compensación de Hacienda', 'manual', 'borrador')
  returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e, 1, (select id from public.company_account where company_id = emp and code = '47510000'), 354.34, 0, loc),
         (a, emp, e, 2, (select id from public.company_account where company_id = emp and code = '47510077'), 0, 995.42, loc),
         (a, emp, e, 3, (select id from public.company_account where company_id = emp and code = '57200001'), 641.08, 0, loc);
  select string_agg(motivo, ' ') into m from public.conta_motivos_para_validar(e);
  if m is null or position('el pago o la compensación de un modelo, su modelo y su periodo' in m) = 0 then
    raise exception 'PRUEBA S01d · 1: sin modelo ni periodo, la compensación no dice qué le falta (%).', m;
  end if;
  r := public.conta_apunte_pago_modelo(e, 1, '111', '2024-1T');
  if r->>'mensaje' <> 'Apuntado: el apunte 1 (47510000) es el pago de 111 · 1T 2024.' or (r#>>'{pagado,pendiente}')::numeric <> 661.33 then
    raise exception 'PRUEBA S01d · 1: el apunte 1 no dice lo esperado (%).', r;
  end if;
  r := public.conta_apunte_pago_modelo(e, 2, '115', '2023-4T');
  if r->>'mensaje' <> 'Apuntado: el apunte 2 (47510077) es la devolución de 115 · 4T 2023.' or (r#>>'{pagado,declaracion}') is not null then
    raise exception 'PRUEBA S01d · 2: el apunte 2 no dice lo esperado (%).', r;
  end if;
  if exists (select 1 from public.conta_motivos_para_validar(e) where codigo = 'apuntes') then
    raise exception 'PRUEBA S01d · 1: con modelo y periodo, la compensación sigue parada.';
  end if;
  perform public.journal_entry_validar(e);
  p := public.conta_modelo_pagado(emp, '111', '2024-1T');
  if (p->>'pagado')::numeric <> 354.34 or (p->>'pendiente')::numeric <> 306.99 or (p->>'asiento_pago') is not null then
    raise exception 'PRUEBA S01d · 1: el 111 · 1T 2024 no queda con 306,99 € por pagar (%).', p;
  end if;
  insert into _s01d values ('compensacion', e::text);
  raise notice 'PRUEBA S01d · 1: la compensación no valida sin modelo y periodo; con ellos, sí, y el 111 queda con 306,99 € por pagar.';
end $$;

-- ── 2 · El pago de un 115: parado hasta decir su modelo; al validarlo, la declaración pagada ──
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  emp uuid := (select v::uuid from _s01d where k = 'emp');
  e uuid; t public.tax_return;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values (a, emp, (select id from public.fiscal_year where company_id = emp and code = '2026'), 3, '2026-10-20', 'Prueba S01d · pago del 115', 'manual', 'borrador')
  returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e, 1, (select id from public.company_account where company_id = emp and code = '47510077'), 1069.02, 0, loc),
         (a, emp, e, 2, (select id from public.company_account where company_id = emp and code = '57200001'), 0, 1069.02, loc);
  begin
    perform public.journal_entry_validar(e);
    raise exception 'PRUEBA S01d · 2: el pago se validó sin decir su modelo.';
  exception when others then
    if sqlerrm like 'PRUEBA%' then raise; end if;
  end;
  perform public.conta_apunte_pago_modelo(e, 1, '115', '2024-2T');
  perform public.journal_entry_validar(e);
  select * into t from public.tax_return where company_id = emp and form_code = '115' and fiscal_year = 2024 and period = '2T';
  if t.payment_entry_id is distinct from e or t.status <> 'paid'
     or not exists (select 1 from public.tax_return_event where tax_return_id = t.id and message like 'Pagado: lo dice el asiento%(115 · 2T 2024).') then
    raise exception 'PRUEBA S01d · 2: el 115 no queda pagado con su asiento (estado %, asiento %).', t.status, t.payment_entry_id;
  end if;
  raise notice 'PRUEBA S01d · 2: el pago del 115 se para hasta decir su modelo; al validarlo, la declaración queda pagada con su asiento.';
end $$;

-- ── 3 · Impuestos › «Casar el cargo» de un 111, por el camino del banco ───
reset role;
do $$
declare emp uuid := (select v::uuid from _s01d where k = 'emp'); t public.treasury_account; v_st uuid; v_m uuid;
begin
  select ta.* into t from public.treasury_account ta where ta.company_id = emp and ta.kind = 'bank' and ta.is_active and public._bank_cuenta_572(ta.id) is not null limit 1;
  if t.id is null then raise exception 'PRUEBA S01d · 3: A no tiene un banco con su 572.'; end if;
  select id into v_st from public.bank_statement where treasury_account_id = t.id limit 1;
  if v_st is null then
    -- Sin saldos: «sin_saldo», sin cuadre y con su motivo (bank_statement_sin_saldo).
    insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to, movements_count, new_count, repeated_count, continuity, balanced, unchecked_reason)
    values (t.account_id, emp, t.id, 'fichero', 'csv:prueba', 'prueba-s01d.csv', '2026-10-01', '2026-10-31', 1, 1, 0, 'sin_saldo', null, 'Prueba S01d: sin saldos') returning id into v_st;
  end if;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept, fingerprint, soft_fingerprint)
  values (t.account_id, emp, t.id, v_st, '2026-10-20', '2026-10-20', -578.01, 'PRUEBA S01D AEAT 111', 'PRUEBA S01D AEAT 111', 'prueba-s01d-111', 'prueba-s01d-111')
  returning id into v_m;
  insert into _s01d values ('cargo', v_m::text);
end $$;
set local role authenticated;
do $$
declare
  emp uuid := (select v::uuid from _s01d where k = 'emp');
  t public.tax_return; v jsonb; l record;
begin
  select * into t from public.tax_return where company_id = emp and form_code = '111' and fiscal_year = 2024 and period = '3T';
  v := public.conta_impuesto_casar_cargo(t.id, (select v::uuid from _s01d where k = 'cargo'));
  select * into t from public.tax_return where id = t.id;
  select a.code, ln.withholding_model, ln.withholding_period, ln.debit, e.status into l
    from public.journal_line ln join public.company_account a on a.id = ln.company_account_id join public.journal_entry e on e.id = ln.entry_id
   where ln.entry_id = t.payment_entry_id and a.template_code like '475%';
  if t.status <> 'paid' or l.code <> '47510000' or l.withholding_model <> '111' or l.withholding_period <> '2024-3T' or l.debit <> 578.01 or l.status <> 'validado' then
    raise exception 'PRUEBA S01d · 3: «Casar el cargo» del 111 no deja su pago en la 47510000 con su periodo (%, %, %).', t.status, row_to_json(l), v;
  end if;
  raise notice 'PRUEBA S01d · 3: «%» El pago del 111 va a la 47510000 con «111 · 3T 2024» y se valida solo.', v->>'mensaje';
end $$;

-- ── 4 · El diario de retenciones del 4T de 2026 ───────────────────────────
do $$
declare
  emp uuid := (select v::uuid from _s01d where k = 'emp');
  d jsonb := public.conta_impuesto_retenciones_diario(emp, 2026, '4T');
  x jsonb;
begin
  select a into x from jsonb_array_elements(d->'asientos') a where a->>'asiento' = (select v from _s01d where k = 'compensacion');
  if x is null or x->>'tipo' <> 'pago' then
    raise exception 'PRUEBA S01d · 4: la compensación no es un pago en el diario de retenciones (%).', x;
  end if;
  raise notice 'PRUEBA S01d · 4: en el diario de retenciones, la compensación es un pago: no cuenta como retenido.';
end $$;

-- ── 5 · Lo que no vale ─────────────────────────────────────────────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  emp uuid := (select v::uuid from _s01d where k = 'emp');
  e uuid; m text;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values (a, emp, (select id from public.fiscal_year where company_id = emp and code = '2026'), 4, '2026-10-21', 'Prueba S01d · lo que no vale', 'manual', 'borrador')
  returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model, withholding_period)
  values (a, emp, e, 1, (select id from public.company_account where company_id = emp and code = '47510000'), 10, 0, loc,
          (select id from public.withholding_rate where is_system and code = 'profesional' and valid_to is null), 100, '111', '2024-1T'),
         (a, emp, e, 2, (select id from public.company_account where company_id = emp and code = '57200001'), 0, 10, loc, null, null, null, null);
  select string_agg(motivo, ' ') into m from public.conta_motivos_para_validar(e);
  if position('no las dos' in coalesce(m, '')) = 0 then raise exception 'PRUEBA S01d · 5: tipo y periodo a la vez pasa (%).', m; end if;
  begin perform public.conta_apunte_pago_modelo(e, 2, '111', '2024-1T'); raise exception 'PRUEBA S01d · 5: la 572 es el pago de un modelo.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_apunte_pago_modelo(e, 1, '303', '2024-1T'); raise exception 'PRUEBA S01d · 5: aceptó el 303 en la 4751.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_apunte_pago_modelo(e, 1, '111', '1T 2024'); raise exception 'PRUEBA S01d · 5: aceptó un periodo mal escrito.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_apunte_pago_modelo((select v::uuid from _s01d where k = 'compensacion'), 1, '111', '2024-2T'); raise exception 'PRUEBA S01d · 5: cambió un asiento validado.';
  exception when sqlstate '22023' then null; end;
  raise notice 'PRUEBA S01d · 5: tipo y periodo a la vez, otra cuenta, otro modelo, un periodo mal escrito o un asiento validado: no.';
end $$;
reset role;

-- ── 6 · La cuenta B ────────────────────────────────────────────────────────
select set_config('s01d.emp', (select v from _s01d where k = 'emp'), true);
select set_config('s01d.comp', (select v from _s01d where k = 'compensacion'), true);
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform public.conta_modelo_pagado(current_setting('s01d.emp')::uuid, '111', '2024-1T'); raise exception 'PRUEBA S01d · 6: B lee lo pagado de A.';
  exception when no_data_found then null; end;
  begin perform public.conta_apunte_pago_modelo(current_setting('s01d.comp')::uuid, 1, '111', '2024-1T'); raise exception 'PRUEBA S01d · 6: B cambia un apunte de A.';
  exception when no_data_found then null; end;
  raise notice 'PRUEBA S01d · 6: la cuenta B no lee ni cambia nada de A.';
end $$;
reset role;

-- ── 8 · Préstamos y aplazamientos ─────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  emp uuid := (select v::uuid from _s01d where k = 'emp');
  corto text := coalesce((select code from public.company_account where company_id = emp and code like '520%' order by code limit 1), '47510000');
  intereses text := coalesce((select code from public.company_account where company_id = emp and code like '662%' order by code limit 1), '47510077');
  cuadro jsonb := '[{"fecha":"2026-11-30","cuota":520,"capital":500,"intereses":20},{"fecha":"2026-12-30","cuota":510,"capital":500,"intereses":10}]';
  v jsonb; c public.recurring_contract;
begin
  begin
    perform public.bank_contrato_guardar(emp, jsonb_build_object('tipo', 'aplazamiento', 'nombre', 'Prueba S01d · aplazamiento', 'contiene', 'PRUEBA S01D APLAZ',
      'importe', 1000.01, 'capital_corto', corto, 'intereses', intereses, 'cuadro', cuadro));
    raise exception 'PRUEBA S01d · 8: guarda un cuadro cuyo capital no suma lo aplazado.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%no cuadra%' then raise exception 'PRUEBA S01d · 8: el aviso del cuadro dice otra cosa: %', sqlerrm; end if;
  end;
  v := public.bank_contrato_guardar(emp, jsonb_build_object('tipo', 'aplazamiento', 'nombre', 'Prueba S01d · aplazamiento', 'contiene', 'PRUEBA S01D APLAZ',
    'importe', 1000, 'capital_corto', corto, 'intereses', intereses, 'cuadro', cuadro, 'documento', 'resolucion-prueba.pdf', 'documento_tipo', 'pdf'));
  select * into c from public.recurring_contract where id = (v->>'id')::uuid;
  if c.kind <> 'aplazamiento' or c.amount <> 520 or c.principal <> 1000 or c.installments <> 2 or c.short_capital_account <> corto or c.capital_account <> corto
     or (c.schedule->0->>'pendiente')::numeric <> 500 or (c.schedule->1->>'pendiente')::numeric <> 0 then
    raise exception 'PRUEBA S01d · 8: el contrato no queda como debe: %', row_to_json(c);
  end if;
  if v->>'mensaje' not like 'Guardado «Prueba S01d · aplazamiento»: 2 cuotas%' then raise exception 'PRUEBA S01d · 8: la confirmación dice %', v->>'mensaje'; end if;
  v := public.bank_contrato_guardar(emp, jsonb_build_object('tipo', 'poliza', 'nombre', 'Prueba S01d · póliza', 'contiene', 'PRUEBA S01D POLIZA', 'capital_corto', corto, 'intereses', intereses));
  if (select amount from public.recurring_contract where id = (v->>'id')::uuid) is not null then raise exception 'PRUEBA S01d · 8: la póliza lleva cuota.'; end if;
  insert into _s01d values ('contrato_emp', emp::text) on conflict do nothing;
  raise notice 'PRUEBA S01d · 8: el cuadro que no cuadra no se guarda; el que sí, con lo pendiente por fila; la póliza, sin cuota. %', v->>'mensaje';
end $$;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$ begin
  begin perform public.bank_contrato_guardar(current_setting('s01d.emp')::uuid, '{"tipo":"poliza","nombre":"x","contiene":"x","capital_corto":"x","intereses":"x"}');
    raise exception 'PRUEBA S01d · 8: B da de alta un contrato en A.';
  exception when no_data_found then null; end;
  raise notice 'PRUEBA S01d · 8: la cuenta B no da de alta contratos en A.';
end $$;
reset role;

-- ── 7 · La vuelta atrás, y otra vez delante ────────────────────────────────
delete from public.recurring_contract where company_id = (select v::uuid from _s01d where k = 'emp') and name like 'Prueba S01d%';
\i supabase/vuelta-atras/20261030T0935_s01d_contratos.down.sql
\i supabase/vuelta-atras/20261030T0934_s01d_contratos_columnas.down.sql
\i supabase/vuelta-atras/20261030T0901_s01d_modelo_de_la_4751_foodint.down.sql
\i supabase/vuelta-atras/20261030T0900_s01d_retenciones_pago.down.sql
\i supabase/vuelta-atras/20261030T0855_s01d_columnas_retencion.down.sql
do $$ begin
  if to_regprocedure('public.conta_apunte_pago_modelo(uuid,integer,text,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'journal_line' and column_name = 'withholding_period')
     or exists (select 1 from public.funcion_respaldo where migracion = '20261030T0900_s01d_retenciones_pago')
     or exists (select 1 from pg_trigger where tgname = 'journal_entry_pago_modelo')
     or to_regprocedure('public.bank_contrato_guardar(uuid,jsonb)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring_contract' and column_name = 'short_capital_account')
     or position('su modelo y su periodo' in pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA S01d · 7: la vuelta atrás deja algo del S01d.';
  end if;
end $$;
\i supabase/migrations/20261030T0855_s01d_columnas_retencion.sql
\i supabase/migrations/20261030T0900_s01d_retenciones_pago.sql
\i supabase/migrations/20261030T0901_s01d_modelo_de_la_4751_foodint.sql
\i supabase/migrations/20261030T0934_s01d_contratos_columnas.sql
\i supabase/migrations/20261030T0935_s01d_contratos.sql
do $$ begin raise notice 'PRUEBA S01d · 7: la vuelta atrás quita lo del S01d y deja las funciones como estaban; y otra vez delante.'; end $$;

rollback;
