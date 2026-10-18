-- supabase/staging/sql/20261122_i01b_calendario_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0190_i01b_calendario (la 0100 a la 0150 ya
-- están en staging de verdad), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. Como usuario de la empresa A y de la cuenta B.
--
--   1. A ve su calendario el 18/10/2026: la ventana es octubre; cada fila es
--      de un modelo suyo, con su plazo de verdad (el 303 del 3T: domiciliado
--      hasta el 15/10, presentar hasta el 20/10, del calendario de la AEAT);
--      lo siguiente, después de octubre; los presentados, del año.
--   2. Con el 303 del 3T calculado, su fila lleva la declaración (borrador).
--   3. «+ Añadir otro impuesto»: con motivo, sale en sus modelos.
--   4. B no ve el calendario de A. Y anon no puede ni llamarla.
--   5. Su vuelta atrás quita las tres funciones, y se puede volver a aplicar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA calendario: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0190_i01b_calendario.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · El calendario de A ───────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; f jsonb; n int;
begin
  -- A tiene sus modelos (si aún no, los que dicen las reglas: lo que hace el alta).
  if not exists (select 1 from public.tax_obligation where company_id = v_a and valid_to is null and active) then
    perform public.conta_impuesto_obligaciones_calcular(v_a);
  end if;
  if not exists (select 1 from public.tax_obligation where company_id = v_a and valid_to is null and active and form_code = '303') then
    raise exception 'PRUEBA calendario · 1: A no presenta el 303; la prueba lo necesita.';
  end if;
  c := public.conta_impuesto_calendario(v_a, '2026-10-18');
  if c->>'ventana' <> '2026-10-01' then raise exception 'PRUEBA calendario · 1: la ventana es %, no octubre.', c->>'ventana'; end if;
  select count(*) into n from jsonb_array_elements(c->'filas') x
   where not exists (select 1 from public.tax_obligation o where o.company_id = v_a and o.valid_to is null and o.active and o.form_code = x->>'modelo');
  if n > 0 then raise exception 'PRUEBA calendario · 1: % filas de modelos que A no presenta.', n; end if;
  select x into f from jsonb_array_elements(c->'filas') x where x->>'modelo' = '303' and x->>'periodo' = '3T' and (x->>'ejercicio')::int = 2026;
  if f is null or f->>'presentacion' <> '2026-10-20' or f->>'domiciliacion' <> '2026-10-15' or (f->>'atrasado')::boolean then
    raise exception 'PRUEBA calendario · 1: el 303 del 3T sale %.', f;
  end if;
  select count(*) into n from jsonb_array_elements(c->'siguiente') x where (x->>'presentacion')::date < '2026-11-01';
  if n > 0 or jsonb_array_length(c->'siguiente') = 0 then raise exception 'PRUEBA calendario · 1: lo siguiente no va después de octubre (% antes).', n; end if;
  if (c->'presentados'->>'ano')::int <> 2026 or (c->'presentados'->>'presentados')::int > (c->'presentados'->>'vencidos')::int then
    raise exception 'PRUEBA calendario · 1: los presentados salen %.', c->'presentados';
  end if;
  if jsonb_typeof(c->'pagos_sin_llegar') <> 'array' or not (c ? 'certificado') then
    raise exception 'PRUEBA calendario · 1: faltan los avisos de Inicio (certificado, pagos sin llegar).';
  end if;
  raise notice 'PRUEBA calendario · 1: % filas en octubre, % plazos después, presentados %.',
    jsonb_array_length(c->'filas'), jsonb_array_length(c->'siguiente'), c->'presentados';
end $$;

-- ── 2 · Con el 303 calculado ─────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; f jsonb; v jsonb;
begin
  v := public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  select x into f from jsonb_array_elements(public.conta_impuesto_calendario(v_a, '2026-10-18')->'filas') x where x->>'modelo' = '303' and x->>'periodo' = '3T';
  if f->'declaracion'->>'id' <> v->>'declaracion' or f->'declaracion'->>'estado' <> 'draft' or f->'declaracion'->>'resultado' <> v->>'resultado' then
    raise exception 'PRUEBA calendario · 2: la fila del 303 lleva %.', f->'declaracion';
  end if;
  raise notice 'PRUEBA calendario · 2: el 303 del 3T, % (%), en su fila.', f->'declaracion'->>'estado_texto', f->'declaracion'->>'resultado';
end $$;

-- ── 3 · Añadir otro impuesto ─────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; v_m text;
begin
  c := public.conta_impuesto_calendario(v_a, '2026-10-18');
  v_m := c->'se_pueden_anadir'->0->>'modelo';
  if v_m is null then raise exception 'PRUEBA calendario · 3: A ya presenta todos los modelos; no hay qué añadir.'; end if;
  perform public.conta_impuesto_obligacion_decidir(v_a, v_m, true, 'PRUEBA I01b: lo añade la prueba del calendario');
  c := public.conta_impuesto_calendario(v_a, '2026-10-18');
  if not exists (select 1 from jsonb_array_elements(c->'modelos') x where x->>'modelo' = v_m and x->>'origen' = 'added')
     or exists (select 1 from jsonb_array_elements(c->'se_pueden_anadir') x where x->>'modelo' = v_m) then
    raise exception 'PRUEBA calendario · 3: el % añadido no sale en sus modelos.', v_m;
  end if;
  raise notice 'PRUEBA calendario · 3: añadido el %; sale en sus modelos y ya no en los que se pueden añadir.', v_m;
end $$;

-- ── 4 · B no ve el de A; anon, ni llamarla ───────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  begin
    perform public.conta_impuesto_calendario(v_a, '2026-10-18');
    raise exception 'PRUEBA calendario · 4: la cuenta B ve el calendario de A.';
  exception when insufficient_privilege then
    raise notice 'PRUEBA calendario · 4: la cuenta B no ve el calendario de A.';
  end;
  if has_function_privilege('anon', 'public.conta_impuesto_calendario(uuid, date)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_impuesto_periodos(uuid, int)', 'execute') then
    raise exception 'PRUEBA calendario · 4: anon puede llamar al calendario, o authenticated a sus piezas de dentro.';
  end if;
end $$;

-- ── 5 · Su vuelta atrás: fuera las tres funciones, y otra vez delante ─────────
reset role;
\i supabase/vuelta-atras/20261122T0190_i01b_calendario.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_calendario(uuid, date)') is not null or to_regprocedure('public.conta_impuesto_periodos(uuid, int)') is not null
     or to_regprocedure('public.conta_impuesto_plazo_si_hay(text, text, int, text)') is not null then
    raise exception 'PRUEBA calendario · 5: la vuelta atrás deja funciones de la 0190.';
  end if;
  raise notice 'PRUEBA calendario · 5: vuelta atrás, fuera las tres funciones.';
end $$;
\i supabase/migrations/20261122T0190_i01b_calendario.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_calendario(uuid, date)') is null then raise exception 'PRUEBA calendario · 5: no se vuelve a aplicar.'; end if;
  raise notice 'PRUEBA calendario · 5: y otra vez delante.';
end $$;

\echo '>>> Prueba del calendario (0190) en verde. ROLLBACK: no queda nada.'
rollback;
