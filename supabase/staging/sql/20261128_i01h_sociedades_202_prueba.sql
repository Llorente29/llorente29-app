-- supabase/staging/sql/20261128_i01h_sociedades_202_prueba.sql
--
-- SOLO STAGING. Prueba de 20261128T0340_i01h_sociedades_202, con \i dentro de
-- la transacción y ROLLBACK: staging no cambia. Cifras inventadas.
--
-- Por sus caminos (regla 10), como el administrador de A (la empresa A no
-- tiene ningún 200 ni 202):
--   1. El 200 de 2024 a mano, con su motivo: el 1P de 2026 sale de él
--      (2.000,00 × 18 % = 360,00 a ingresar). No inventa el 2P ni el 3P de
--      2025 (son de antes de este año y no están en Sumied).
--   2. El 200 de 2025 a cero (a devolver 300,00): el 2P y el 3P de 2026 y el
--      1P de 2027 quedan «No hace falta», con el porqué; el calendario no los
--      cuenta como pendientes.
--   3. Corregir el 200 de 2025 (cuota 1.000,00): el 2P vuelve a borrador con
--      180,00; y otra vez a cero, otra vez «No hace falta».
--   4. Lo que salió a devolver: pendiente hasta que un asiento validado abona
--      la 4709 contra el banco; después, cobrado.
--   5. Lo que no vale: sin motivo, una fecha del mismo ejercicio, cuota
--      negativa, cero con importe, un periodo que no es del 202.
--   6. La cuenta B no lee, ni escribe, ni calcula lo de A; y con la clave
--      anónima no se llama ni al 202 ni al 111 (el hueco de la 0330, cerrado).
--   7. La vuelta atrás, con datos: quita la tabla, las tres funciones y la
--      clave nueva, y devuelve los permisos de antes; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 202: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261128T0340_i01h_sociedades_202.sql

-- ── 0 · La empresa A, sin 200 ni 202 ────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if exists (select 1 from public.tax_return where company_id = emp and form_code in ('200', '202'))
     or exists (select 1 from public.corporate_tax_filing where company_id = emp) then
    raise exception 'PRUEBA 202 · 0: la empresa A ya tiene un 200 o un 202 en staging. Revisa la prueba.';
  end if;
  if extract(year from now() at time zone 'Europe/Madrid') <> 2026 then
    raise exception 'PRUEBA 202 · 0: la prueba está escrita para 2026 (los 202 nuevos son de este año en adelante).';
  end if;
end $$;

-- ── 1 · El 200 de 2024: el 1P de 2026 sale de él ───────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  x jsonb; r public.tax_return;
begin
  x := public.conta_impuesto_200_poner(emp, 2024,
         '{"presentado":"2025-07-20","base_imponible":20000,"cuota":2000,"resultado":"to_pay","importe":2000}', 'Del justificante de la gestoría (prueba)');
  if x->>'mensaje' <> 'Guardado el Impuesto de sociedades de 2024: cuota 2.000,00 €, 2.000,00 € a ingresar. Vueltos a calcular los 202 que salen de él: el 1P/2026, 360,00 € a ingresar.' then
    raise exception 'PRUEBA 202 · 1: el mensaje no dice lo que pasó: %', x->>'mensaje';
  end if;
  select * into r from public.tax_return where company_id = emp and form_code = '202' and fiscal_year = 2026 and period = '1P';
  if r.status <> 'draft' or r.result_kind <> 'to_pay' or r.amount <> 360 then
    raise exception 'PRUEBA 202 · 1: el 1P de 2026 no es un borrador de 360,00 a ingresar (% % %).', r.status, r.result_kind, r.amount;
  end if;
  if (select value from public.tax_return_box where tax_return_id = r.id and box = '01') <> 2000
     or (select value from public.tax_return_box where tax_return_id = r.id and box = '03') <> 360 then
    raise exception 'PRUEBA 202 · 1: las casillas del 1P no son [01] 2.000,00 y [03] 360,00.';
  end if;
  if (select title from public.tax_return_check where tax_return_id = r.id and check_key = 'base_200')
     <> 'La base es la cuota del Impuesto de sociedades de 2024 (presentado el 20/07/2025): 2.000,00 € × 18 % = 360,00 €.' then
    raise exception 'PRUEBA 202 · 1: lo comprobado no dice de dónde sale la base: %', (select title from public.tax_return_check where tax_return_id = r.id and check_key = 'base_200');
  end if;
  if exists (select 1 from public.tax_return where company_id = emp and form_code = '202' and fiscal_year = 2025) then
    raise exception 'PRUEBA 202 · 1: el 200 de 2024 inventa 202 de 2025.';
  end if;
  if (select manual_reason from public.corporate_tax_filing where company_id = emp and fiscal_year = 2024) not like 'Del justificante de la gestoría (prueba) (%' then
    raise exception 'PRUEBA 202 · 1: el 200 no guarda su motivo y quién.';
  end if;
  raise notice 'PRUEBA 202 · 1: el 200 de 2024 da el 1P de 2026: 2.000,00 × 18 %% = 360,00.';
end $$;

-- ── 2 · El 200 de 2025 a cero: no hay que presentar el 2P, el 3P ni el 1P de 2027 ─
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  x jsonb; n int; cal jsonb; fila jsonb;
begin
  x := public.conta_impuesto_200_poner(emp, 2025,
         '{"presentado":"2026-07-14","base_imponible":-5000,"cuota":0,"resultado":"to_refund","importe":300}', 'Del justificante de la gestoría (prueba)');
  if x->>'mensaje' <> 'Guardado el Impuesto de sociedades de 2025: cuota 0,00 €, 300,00 € a devolver. Vueltos a calcular los 202 que salen de él: el 2P/2026, no hay que presentarlo; el 3P/2026, no hay que presentarlo; el 1P/2027, no hay que presentarlo.' then
    raise exception 'PRUEBA 202 · 2: el mensaje no dice lo que pasó: %', x->>'mensaje';
  end if;
  select count(*) into n from public.tax_return
   where company_id = emp and form_code = '202' and status = 'not_required' and not_required_reason = 'el impuesto de 2025 salió a cero'
     and (fiscal_year, period) in ((2026, '2P'), (2026, '3P'), (2027, '1P'));
  if n <> 3 then raise exception 'PRUEBA 202 · 2: no son tres «No hace falta» con el porqué (%).', n; end if;
  -- El calendario: el 2P de 2026 (vencía el 20/10) dice que no hace falta, no que está pendiente.
  cal := public.conta_impuesto_calendario(emp, '2026-10-21');
  select f into fila from jsonb_array_elements(cal->'filas') f where f->>'modelo' = '202' and f->>'periodo' = '2P' and (f->>'ejercicio')::int = 2026;
  if fila is null or fila#>>'{declaracion,estado}' <> 'not_required' or fila#>>'{declaracion,no_hace_falta}' <> 'el impuesto de 2025 salió a cero' then
    raise exception 'PRUEBA 202 · 2: el calendario no dice que el 2P de 2026 no hace falta: %', fila;
  end if;
  raise notice 'PRUEBA 202 · 2: con el 200 de 2025 a cero, el 2P, el 3P y el 1P de 2027 no hacen falta, y el calendario lo dice.';
end $$;

-- ── 3 · Corregir el 200: vuelve a borrador; y otra vez a cero ──────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r public.tax_return; x jsonb;
begin
  perform public.conta_impuesto_200_poner(emp, 2025,
            '{"presentado":"2026-07-14","base_imponible":5000,"cuota":1000,"resultado":"to_pay","importe":1000}', 'Corregido (prueba)');
  select * into r from public.tax_return where company_id = emp and form_code = '202' and fiscal_year = 2026 and period = '2P';
  if r.status <> 'draft' or r.result_kind <> 'to_pay' or r.amount <> 180 then
    raise exception 'PRUEBA 202 · 3: con cuota 1.000,00 el 2P no vuelve a borrador de 180,00 (% %).', r.status, r.amount;
  end if;
  perform public.conta_impuesto_200_poner(emp, 2025,
            '{"presentado":"2026-07-14","base_imponible":-5000,"cuota":0,"resultado":"to_refund","importe":300}', 'Otra vez a cero (prueba)');
  x := public.conta_impuesto_202_calcular(emp, 2026, '2P');
  select * into r from public.tax_return where id = (x->>'declaracion')::uuid;
  if r.status <> 'not_required' or not (x->>'no_hace_falta')::boolean then raise exception 'PRUEBA 202 · 3: otra vez a cero, el 2P no queda «No hace falta» (%).', r.status; end if;
  raise notice 'PRUEBA 202 · 3: corregir el 200 lo devuelve a borrador; a cero, otra vez «No hace falta».';
end $$;

-- ── 4 · Lo que salió a devolver: pendiente hasta que llega al banco ────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  s jsonb; d jsonb; v_y uuid; c4709 uuid; c572 uuid; e uuid;
begin
  s := public.conta_impuesto_sociedades(emp);
  select x->'devolucion' into d from jsonb_array_elements(s->'declaraciones_200') x where (x->>'ejercicio')::int = 2025;
  if d is null or (d->>'pendiente')::numeric <> 300 or (d->>'cobrado')::numeric <> 0 then raise exception 'PRUEBA 202 · 4: la devolución de 2025 no sale pendiente de 300,00: %', d; end if;
  if jsonb_array_length(s->'declaraciones_200') <> 2 then raise exception 'PRUEBA 202 · 4: no salen los dos 200.'; end if;
  if not exists (select 1 from jsonb_array_elements(s->'pagos_202') x where x->>'periodo' = '1P' and (x->>'ejercicio')::int = 2026 and (x->>'esperado')::numeric = 360) then
    raise exception 'PRUEBA 202 · 4: los pagos no dicen que el 1P de 2026 da 360,00.';
  end if;
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select id into c4709 from public.company_account where company_id = emp and code = '47090000';
  select id into c572 from public.company_account where company_id = emp and code = '57200001';
  if v_y is null or c4709 is null or c572 is null then raise exception 'PRUEBA 202 · 4: faltan el ejercicio 2026, la 4709 o la 572 de A.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 3, '2026-10-15', 'Prueba I01h · devolución del Impuesto de sociedades', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e, 1, c572, 300, 0, loc), (a, emp, e, 2, c4709, 0, 300, loc);
  perform public.journal_entry_validar(e);
  s := public.conta_impuesto_sociedades(emp);
  select x->'devolucion' into d from jsonb_array_elements(s->'declaraciones_200') x where (x->>'ejercicio')::int = 2025;
  if (d->>'pendiente')::numeric <> 0 or (d->>'cobrado')::numeric <> 300 or d->>'cobrado_el' <> '2026-10-15' then
    raise exception 'PRUEBA 202 · 4: con el cobro en el banco, la devolución no sale cobrada: %', d;
  end if;
  raise notice 'PRUEBA 202 · 4: la devolución, pendiente hasta que la 4709 se abona contra el banco; después, cobrada.';
end $$;

-- ── 5 · Lo que no vale ─────────────────────────────────────────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  ok constant text := '{"presentado":"2026-07-14","base_imponible":0,"cuota":0,"resultado":"zero","importe":0}';
begin
  begin perform public.conta_impuesto_200_poner(emp, 2023, ok::jsonb, ' '); raise exception 'PRUEBA 202 · 5: sin motivo, entra.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_impuesto_200_poner(emp, 2026, ok::jsonb, 'x'); raise exception 'PRUEBA 202 · 5: un 200 de 2026 presentado en 2026, entra.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_impuesto_200_poner(emp, 2023, '{"presentado":"2024-07-14","base_imponible":0,"cuota":-1,"resultado":"zero","importe":0}', 'x'); raise exception 'PRUEBA 202 · 5: cuota negativa, entra.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_impuesto_200_poner(emp, 2023, '{"presentado":"2024-07-14","base_imponible":0,"cuota":0,"resultado":"zero","importe":5}', 'x'); raise exception 'PRUEBA 202 · 5: cero con importe, entra.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_impuesto_202_calcular(emp, 2026, '4P'); raise exception 'PRUEBA 202 · 5: el 4P, entra.';
  exception when sqlstate '22023' then null; end;
  -- El 200 de 2023 sí entra, y no inventa ningún 202 de 2024 ni de 2025.
  perform public.conta_impuesto_200_poner(emp, 2023, '{"presentado":"2024-07-14","base_imponible":-100,"cuota":0,"resultado":"zero","importe":0}', 'Del justificante (prueba)');
  if exists (select 1 from public.tax_return where company_id = emp and form_code = '202' and fiscal_year in (2024, 2025)) then
    raise exception 'PRUEBA 202 · 5: el 200 de 2023 inventa 202 de 2024 o 2025.';
  end if;
  raise notice 'PRUEBA 202 · 5: sin motivo, con fecha del mismo año, cuota negativa, cero con importe o el 4P, no; el 200 de 2023 no inventa pagos viejos.';
end $$;
reset role;

-- ── 6 · La cuenta B, y la clave anónima ────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform public.conta_impuesto_sociedades('3b34403a-a7d6-4a48-a8d7-737e8cababdc'); raise exception 'PRUEBA 202 · 6: B lee lo de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_impuesto_200_poner('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2022, '{"presentado":"2023-07-14","base_imponible":0,"cuota":0,"resultado":"zero","importe":0}', 'x');
    raise exception 'PRUEBA 202 · 6: B escribe un 200 de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_impuesto_202_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '2P'); raise exception 'PRUEBA 202 · 6: B calcula el 202 de A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.corporate_tax_filing where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') then
    raise exception 'PRUEBA 202 · 6: B ve los 200 de A en la tabla.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin
  begin perform public.conta_impuesto_202_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '2P'); raise exception 'PRUEBA 202 · 6: con la clave anónima se calcula el 202.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_impuesto_retenciones_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T', '111'); raise exception 'PRUEBA 202 · 6: con la clave anónima se calcula el 111.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA 202 · 6: la cuenta B no lee, ni escribe, ni calcula lo de A; la clave anónima no llama ni al 202 ni al 111.';
end $$;
reset role;

-- ── 7 · La vuelta atrás, con datos, y otra vez delante ─────────────────────
do $$ begin
  if not exists (select 1 from public.tax_return_check where check_key = 'base_200') or not exists (select 1 from public.corporate_tax_filing) then
    raise exception 'PRUEBA 202 · 7: no hay datos con que probar la vuelta atrás.';
  end if;
end $$;
\i supabase/vuelta-atras/20261128T0340_i01h_sociedades_202.down.sql
do $$ begin
  if to_regclass('public.corporate_tax_filing') is not null
     or to_regprocedure('public.conta_impuesto_202_calcular(uuid,int,text)') is not null
     or to_regprocedure('public.conta_impuesto_200_poner(uuid,int,jsonb,text)') is not null
     or to_regprocedure('public.conta_impuesto_sociedades(uuid)') is not null then
    raise exception 'PRUEBA 202 · 7: la vuelta atrás deja la tabla o alguna función.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'tax_return_check_check_key_check')) like '%base_200%' then
    raise exception 'PRUEBA 202 · 7: el CHECK sigue con la clave nueva.';
  end if;
  if not has_function_privilege('anon', 'public.conta_impuesto_retenciones_calcular(uuid,int,text,text)', 'execute') then
    raise exception 'PRUEBA 202 · 7: la vuelta atrás no devuelve los permisos de antes a la 0330.';
  end if;
end $$;
\i supabase/migrations/20261128T0340_i01h_sociedades_202.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_202_calcular(uuid,int,text)') is null then raise exception 'PRUEBA 202 · 7: otra vez delante, falta el cálculo.'; end if;
  if has_function_privilege('anon', 'public.conta_impuesto_retenciones_calcular(uuid,int,text,text)', 'execute') then
    raise exception 'PRUEBA 202 · 7: otra vez delante, la clave anónima sigue llamando al 111.';
  end if;
  raise notice 'PRUEBA 202 · 7: la vuelta atrás quita la tabla, las tres funciones y la clave nueva, y devuelve los permisos; y otra vez delante.';
end $$;

rollback;
