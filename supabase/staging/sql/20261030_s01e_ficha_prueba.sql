-- supabase/staging/sql/20261030_s01e_ficha_prueba.sql
--
-- SOLO STAGING. Prueba de la 2210 y la 2211 (S01e, la ficha de cada
-- préstamo o aplazamiento), por los caminos de la pantalla (bank_casar y
-- bank_contrato_guardar), como el administrador de A, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Números inventados.
--
--   1. Un préstamo de 1.000 € en 4 cuotas: guarda cuándo se subió el cuadro.
--   2. Casar el cargo de la cuota del 03/11 guarda el contrato y su fila; la
--      misma fila no se casa dos veces; una fecha que no es del cuadro, no.
--   3. «Sustituir las pendientes»: no empieza en una cuota pagada; no cuadra
--      sin lo amortizado de golpe; con él, se van 3 y entran 2, y la del
--      03/11 (pagada) se queda. Un aplazamiento no se sustituye. «Más
--      acciones»: lo que pone el banco y darlo por terminado.
--   4. La vuelta atrás deja las dos funciones como estaban y quita las tres
--      columnas (con un cargo casado dentro), y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01e: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261030T2210_s01e_columnas.sql
\i supabase/migrations/20261030T2211_s01e_ficha.sql

create temp table _s01e (k text primary key, v text) on commit drop;
grant all on _s01e to authenticated;
insert into _s01e select 'emp', id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'B28000016';
insert into _s01e select 'corto', coalesce((select code from public.company_account where company_id = x.v::uuid and code like '521%' order by code limit 1),
                                          (select code from public.company_account where company_id = x.v::uuid and code like '520%' order by code limit 1)) from _s01e x where x.k = 'emp';
insert into _s01e select 'intereses', coalesce((select code from public.company_account where company_id = x.v::uuid and code like '662%' order by code limit 1),
                                              (select code from public.company_account where company_id = x.v::uuid and code like '669%' order by code limit 1)) from _s01e x where x.k = 'emp';

-- Los cargos del banco (los de las cuotas), antes de entrar como A.
do $$
declare emp uuid := (select x.v::uuid from _s01e x where x.k = 'emp'); t public.treasury_account; v_st uuid; v_m uuid; n int;
begin
  select ta.* into t from public.treasury_account ta where ta.company_id = emp and ta.kind = 'bank' and ta.is_active and public._bank_cuenta_572(ta.id) is not null limit 1;
  if t.id is null then raise exception 'PRUEBA S01e: A no tiene un banco con su 572.'; end if;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to, movements_count, new_count, repeated_count, continuity, balanced, unchecked_reason)
  values (t.account_id, emp, t.id, 'fichero', 'csv:prueba', 'prueba-s01e.csv', '2026-11-01', '2026-11-30', 2, 2, 0, 'sin_saldo', null, 'Prueba S01e: sin saldos') returning id into v_st;
  for n in 1..2 loop
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept, fingerprint, soft_fingerprint)
    values (t.account_id, emp, t.id, v_st, '2026-11-03', '2026-11-03', -330, 'PRUEBA S01E PRESTAMO ' || n, 'PRUEBA S01E PRESTAMO ' || n, 'prueba-s01e-' || n, 'prueba-s01e-' || n)
    returning id into v_m;
    insert into _s01e values ('cargo' || n, v_m::text);
  end loop;
end $$;

-- ── 1 · El préstamo, con la fecha de subida del cuadro ─────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  emp uuid := (select x.v::uuid from _s01e x where x.k = 'emp');
  res jsonb; c public.recurring_contract;
begin
  res := public.bank_contrato_guardar(emp, jsonb_build_object('tipo', 'prestamo', 'nombre', 'Prueba S01e · préstamo', 'contiene', 'PRUEBA S01E PRESTAMO',
    'importe', 1000, 'capital_corto', (select x.v from _s01e x where x.k = 'corto'), 'intereses', (select x.v from _s01e x where x.k = 'intereses'),
    'documento', 'cuadro-inventado.xlsx', 'documento_tipo', 'excel',
    'cuadro', '[{"fecha":"2026-11-03","cuota":330,"capital":300,"intereses":30},{"fecha":"2026-12-03","cuota":330,"capital":305,"intereses":25},
               {"fecha":"2027-01-03","cuota":330,"capital":310,"intereses":20},{"fecha":"2027-02-03","cuota":100,"capital":85,"intereses":15}]'::jsonb));
  select * into c from public.recurring_contract where id = (res->>'id')::uuid;
  if c.document_uploaded_at is null or jsonb_array_length(c.schedule) <> 4 then
    raise exception 'PRUEBA S01e · 1: el préstamo no guarda cuándo se subió el cuadro: %', row_to_json(c);
  end if;
  insert into _s01e values ('contrato', c.id::text);
  raise notice 'PRUEBA S01e · 1: el préstamo guarda cuándo se subió su cuadro. %', res->>'mensaje';
end $$;

-- ── 2 · Casar la cuota guarda el contrato y su fila ────────────────────────
do $$
declare
  id_c uuid := (select x.v::uuid from _s01e x where x.k = 'contrato');
  destino jsonb := jsonb_build_object('tipo', 'contrato', 'contrato_id', (select x.v from _s01e x where x.k = 'contrato'), 'fila', '2026-11-03',
    'concepto', 'Cuota de Prueba S01e · préstamo', 'lineas', jsonb_build_array(
      jsonb_build_object('cuenta', (select x.v from _s01e x where x.k = 'corto'), 'importe', 300),
      jsonb_build_object('cuenta', (select x.v from _s01e x where x.k = 'intereses'), 'importe', 30)));
  res jsonb; m public.bank_match;
begin
  res := public.bank_casar((select x.v::uuid from _s01e x where x.k = 'cargo1'), destino, 'seguro', 'Prueba S01e: la cuota del 03/11', '[]'::jsonb, 'persona', null);
  select * into m from public.bank_match where movement_id = (select x.v::uuid from _s01e x where x.k = 'cargo1') and status = 'vivo';
  if m.contract_id is distinct from id_c or m.contract_due_date is distinct from date '2026-11-03' then
    raise exception 'PRUEBA S01e · 2: casar la cuota no guarda su contrato y su fila: %', row_to_json(m);
  end if;
  begin
    perform public.bank_casar((select x.v::uuid from _s01e x where x.k = 'cargo2'), destino, 'seguro', 'Prueba S01e: otra vez', '[]'::jsonb, 'persona', null);
    raise exception 'PRUEBA S01e · 2: la misma cuota se casa dos veces.';
  exception when sqlstate '23505' then null; end;
  begin
    perform public.bank_casar((select x.v::uuid from _s01e x where x.k = 'cargo2'), destino || '{"fila":"2026-11-04"}', 'seguro', 'Prueba S01e: fecha mala', '[]'::jsonb, 'persona', null);
    raise exception 'PRUEBA S01e · 2: casa una fecha que no está en el cuadro.';
  exception when sqlstate '22023' then null; end;
  raise notice 'PRUEBA S01e · 2: el cargo del 03/11 queda casado con su contrato y su fila; la misma fila no se casa dos veces, ni una fecha que no es del cuadro.';
end $$;

-- ── 3 · «Sustituir las pendientes» de un préstamo ──────────────────────────
do $$
declare
  emp uuid := (select x.v::uuid from _s01e x where x.k = 'emp');
  id_c uuid := (select x.v::uuid from _s01e x where x.k = 'contrato');
  nuevo jsonb := '[{"fecha":"2026-12-03","cuota":270,"capital":250,"intereses":20},{"fecha":"2027-01-03","cuota":260,"capital":250,"intereses":10}]';
  res jsonb; c public.recurring_contract; v_msg text;
begin
  begin
    perform public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'modo', 'sustituir', 'amortizado', 200,
      'cuadro', '[{"fecha":"2026-11-03","cuota":330,"capital":300,"intereses":30}]'::jsonb || nuevo));
    raise exception 'PRUEBA S01e · 3: sustituye desde una cuota ya pagada.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%ya está pagada%' then raise exception 'PRUEBA S01e · 3: el aviso dice otra cosa: %', sqlerrm; end if;
  end;
  begin
    perform public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'modo', 'sustituir', 'cuadro', nuevo));
    raise exception 'PRUEBA S01e · 3: sustituye sin lo amortizado de golpe, y no cuadra.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%no cuadra%' then raise exception 'PRUEBA S01e · 3: el aviso dice otra cosa: %', sqlerrm; end if;
  end;
  res := public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'modo', 'sustituir', 'amortizado', 200, 'cuadro', nuevo,
    'documento', 'cuadro-nuevo-inventado.xlsx'));
  select * into c from public.recurring_contract where id = id_c;
  if jsonb_array_length(c.schedule) <> 3 or c.installments <> 3 or c.schedule->0->>'fecha' <> '2026-11-03'
     or (c.schedule->0->>'capital')::numeric <> 300 or (c.schedule->1->>'amortizado_antes')::numeric <> 200
     or (c.schedule->2->>'pendiente')::numeric <> 0 or c.document_name <> 'cuadro-nuevo-inventado.xlsx' then
    raise exception 'PRUEBA S01e · 3: el cuadro sustituido no queda como debe: %', row_to_json(c);
  end if;
  if res->>'mensaje' <> 'Cambiado el cuadro de «Prueba S01e · préstamo»: se van 3 cuotas pendientes y entran 2. Desde el 03/12/2026 quedan 500,00 € de capital.' then
    raise exception 'PRUEBA S01e · 3: la confirmación dice %', res->>'mensaje';
  end if;
  v_msg := res->>'mensaje';
  -- Un aplazamiento no se sustituye: se le añaden las cuotas del año nuevo.
  res := public.bank_contrato_guardar(emp, jsonb_build_object('tipo', 'aplazamiento', 'nombre', 'Prueba S01e · aplazamiento', 'contiene', 'PRUEBA S01E APLAZ',
    'importe', 100, 'capital_corto', (select x.v from _s01e x where x.k = 'corto'), 'intereses', (select x.v from _s01e x where x.k = 'intereses'),
    'cuadro', '[{"fecha":"2026-11-30","cuota":101,"capital":100,"intereses":1}]'::jsonb));
  begin
    perform public.bank_contrato_guardar(emp, jsonb_build_object('contrato', res->>'id', 'modo', 'sustituir', 'cuadro', '[{"fecha":"2026-11-30","cuota":101,"capital":100,"intereses":1}]'::jsonb));
    raise exception 'PRUEBA S01e · 3: sustituye las cuotas de un aplazamiento.';
  exception when sqlstate '22023' then null; end;
  raise notice 'PRUEBA S01e · 3: «%» La pagada se queda; desde una pagada o sin cuadrar, no; un aplazamiento, tampoco.', v_msg;
  -- «Más acciones»: lo que pone el banco, y darlo por terminado.
  res := public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'modo', 'datos', 'contiene', 'PRUEBA S01E NUEVO'));
  if res->>'mensaje' not like 'Guardado «Prueba S01e · préstamo»: %el banco pone «PRUEBA S01E NUEVO».' then
    raise exception 'PRUEBA S01e · 3: cambiar lo que pone el banco dice %', res->>'mensaje';
  end if;
  begin
    perform public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'modo', 'datos', 'intereses', '00000000'));
    raise exception 'PRUEBA S01e · 3: acepta una cuenta que no está en el plan.';
  exception when sqlstate '22023' then null; end;
  res := public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'modo', 'datos', 'activo', false));
  if (select is_active from public.recurring_contract where id = id_c) or res->>'mensaje' not like '%dado por terminado%' then
    raise exception 'PRUEBA S01e · 3: darlo por terminado no lo deja terminado: %', res->>'mensaje';
  end if;
  raise notice 'PRUEBA S01e · 3: «Más acciones» cambia lo que pone el banco (no una cuenta de fuera del plan) y lo da por terminado.';
end $$;
reset role;

-- ── 4 · La vuelta atrás, y otra vez delante ────────────────────────────────
\i supabase/vuelta-atras/20261030T2211_s01e_ficha.down.sql
\i supabase/vuelta-atras/20261030T2210_s01e_columnas.down.sql
do $$ begin
  -- Con el cargo casado del paso 2 dentro: las columnas se van con lo que guardaban.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'bank_match' and column_name in ('contract_id', 'contract_due_date'))
                or (table_name = 'recurring_contract' and column_name = 'document_uploaded_at'))) then
    raise exception 'PRUEBA S01e · 4: la vuelta atrás de la 2210 deja alguna columna.';
  end if;
  if position('v_contrato' in pg_get_functiondef('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure)) > 0
     or position('sustituir' in pg_get_functiondef('public.bank_contrato_guardar(uuid,jsonb)'::regprocedure)) > 0
     or exists (select 1 from public.funcion_respaldo where migracion = '20261030T2211_s01e_ficha') then
    raise exception 'PRUEBA S01e · 4: la vuelta atrás deja algo de la 2211.';
  end if;
end $$;
\i supabase/migrations/20261030T2210_s01e_columnas.sql
\i supabase/migrations/20261030T2211_s01e_ficha.sql
do $$ begin raise notice 'PRUEBA S01e · 4: la vuelta atrás deja bank_casar y bank_contrato_guardar como estaban y quita las tres columnas; y otra vez delante.'; end $$;

rollback;
