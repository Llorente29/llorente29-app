-- supabase/staging/sql/20261122_i01c_trimestre_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0280_i01c_trimestre, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Nombra lo nuevo:
-- public.conta_impuesto_trimestre.
--
-- Con la empresa A (Taberna de Prueba Norte, NIF inventado B28000016) y
-- cifras INVENTADAS con la forma del caso del 19/10 (pendiente
-- de antes 1.500,00; el 1T sale a compensar 1.200,50; el 2T aplica 400,25; la
-- [110] del 3T, 2.300,25), en 2026 (los festivos cargados son los de 2026 y 2027):
--   1. El borrador del 303 del 3T, calculado ANTES de apuntar el 1T y el 2T
--      (como el que se vio en producción el 19/10): sin [110].
--   2. Se apuntan el 1T y el 2T por su justificante. El trimestre dice que el
--      borrador del 3T está desfasado y que su [110] tiene que ser 2.300,25.
--   3. La cartera: lo pendiente al empezar el año (1.500,00, la [110] del 1T),
--      y por trimestre la [110], la [78] y la [87].
--   4. Se vuelve a calcular el 3T: trae la [110] 2.300,25 y ya no está desfasado.
--   5. La tira del 3T: 303, 111, 115 y 202 (2P), en ese orden; la del 2T dice
--      que el 202 no toca.
--   6. Otra cuenta no lo ve; un trimestre 5 no existe.
--   7. La vuelta atrás quita la función, y otra vez hacia delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA TRIMESTRE: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0280_i01c_trimestre.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;
insert into _p values
  ('1T', '{"modelo":"303","ejercicio":2026,"periodo":"1T","presentada":"2026-04-20T10:06:28","csv":"PRUEBATRIM1T2026","justificante":"9993030002501","nif":"B28000016","resultado":-1200.50,
           "casillas":{"27":5000,"45":6200.50,"46":-1200.50,"64":-1200.50,"65":100,"66":-1200.50,"110":1500.00,"78":0,"87":1500.00,"69":-1200.50,"71":-1200.50}}'),
  ('2T', '{"modelo":"303","ejercicio":2026,"periodo":"2T","presentada":"2026-07-20T10:51:15","csv":"PRUEBATRIM2T2026","justificante":"9993030002502","nif":"B28000016","resultado":0,
           "casillas":{"27":8000,"45":7599.75,"46":400.25,"64":400.25,"65":100,"66":400.25,"110":2700.50,"78":400.25,"87":2300.25,"69":0,"71":0}}');

do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if (select tax_id from public.company where id = v_a) <> 'B28000016' then
    raise exception 'PRUEBA TRIMESTRE: la empresa A ya no tiene el NIF inventado B28000016: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and fiscal_year = 2026) then
    raise exception 'PRUEBA TRIMESTRE: A ya tiene declaraciones de 2026 en staging: esta prueba ya no mide lo que cree.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 y 2 · El borrador del 3T, calculado antes; después, el 1T y el 2T ──────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; t jsonb; c jsonb;
begin
  perform public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  t := public.conta_impuesto_trimestre(v_a, 2026, 3);
  if (t->'cartera'->>'desfasada')::boolean or t->'cartera'->'esperada_110' <> 'null'::jsonb then
    raise exception 'PRUEBA TRIMESTRE · 1: sin el 2T presentado no hay [110] que esperar, y da %.', t->'cartera';
  end if;
  perform public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '1T'));
  perform public.conta_impuesto_justificante_apuntar(v_a, (select val::jsonb from _p where k = '2T'));
  t := public.conta_impuesto_trimestre(v_a, 2026, 3);
  c := t->'cartera';
  if (c->>'desfasada')::boolean is not true or (c->'esperada_110'->>'importe')::numeric <> 2300.25 or c->'esperada_110'->>'de' <> '2T/2026'
     or c->'borrador'->>'estado' <> 'draft' then
    raise exception 'PRUEBA TRIMESTRE · 2: el 3T tendría que estar desfasado y esperar 2.300,25 del 2T; da %.', c;
  end if;
  raise notice 'PRUEBA TRIMESTRE · 1-2: el borrador calculado antes del 2T está desfasado; su [110] tiene que ser 2.300,25.';
end $$;

-- ── 3 · La cartera ───────────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; f1 jsonb; f2 jsonb;
begin
  c := public.conta_impuesto_trimestre(v_a, 2026, 3)->'cartera';
  select x into f1 from jsonb_array_elements(c->'filas') x where x->>'periodo' = '1T';
  select x into f2 from jsonb_array_elements(c->'filas') x where x->>'periodo' = '2T';
  if (c->'pendiente_al_empezar'->>'importe')::numeric <> 1500.00 or c->'pendiente_al_empezar'->>'de' <> '1T/2026' then
    raise exception 'PRUEBA TRIMESTRE · 3: lo pendiente al empezar el año da %.', c->'pendiente_al_empezar';
  end if;
  if (f1->>'presentada')::boolean is not true or f1->>'resultado' <> 'to_offset' or (f1->>'importe')::numeric <> 1200.50
     or (f2->>'c110')::numeric <> 2700.50 or (f2->>'c78')::numeric <> 400.25 or (f2->>'c87')::numeric <> 2300.25
     or jsonb_array_length(c->'filas') <> 4 then
    raise exception 'PRUEBA TRIMESTRE · 3: la cartera da % y %.', f1, f2;
  end if;
  -- La cadena cuadra: 1.500,00 + 1.200,50 − 400,25 = 2.300,25.
  if (c->'pendiente_al_empezar'->>'importe')::numeric + (f1->>'importe')::numeric - (f2->>'c78')::numeric <> (c->'esperada_110'->>'importe')::numeric then
    raise exception 'PRUEBA TRIMESTRE · 3: la cadena de la cartera no cuadra con la [110] esperada.';
  end if;
  raise notice 'PRUEBA TRIMESTRE · 3: cartera 1.500,00 + 1.200,50 − 400,25 = 2.300,25.';
end $$;

-- ── 4 · Se vuelve a calcular el 3T: trae la [110] ────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; f3 jsonb;
begin
  perform public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  c := public.conta_impuesto_trimestre(v_a, 2026, 3)->'cartera';
  select x into f3 from jsonb_array_elements(c->'filas') x where x->>'periodo' = '3T';
  -- La [110] llega siempre; la [87], solo si el 3T tiene resultado (sin libro de
  -- IVA y con IVA en el diario, como el de Foodint, no lo tiene: run 370).
  if (c->>'desfasada')::boolean or (c->'borrador'->>'c110')::numeric <> 2300.25 or (f3->>'c110')::numeric <> 2300.25
     or (f3->>'resultado' is null and f3->>'c87' is not null)
     or (f3->>'resultado' is not null and (f3->>'c87')::numeric <> 2300.25 - coalesce((f3->>'c78')::numeric, 0)) then
    raise exception 'PRUEBA TRIMESTRE · 4: vuelto a calcular, el 3T da % (borrador %).', f3, c->'borrador';
  end if;
  raise notice 'PRUEBA TRIMESTRE · 4: vuelto a calcular, el 3T trae la [110] 2.300,25 (resultado: %) y no está desfasado.', coalesce(f3->>'resultado', 'sin calcular');
end $$;

-- ── 5 · La tira ──────────────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; t jsonb; m text; m2 jsonb;
begin
  t := public.conta_impuesto_trimestre(v_a, 2026, 3);
  select string_agg(x->>'modelo' || ':' || coalesce(x->>'periodo', '—'), ' ' order by o) into m
    from jsonb_array_elements(t->'modelos') with ordinality e(x, o);
  if m <> '303:3T 111:3T 115:3T 202:2P' then
    raise exception 'PRUEBA TRIMESTRE · 5: la tira del 3T da «%».', m;
  end if;
  if (select x->'declaracion'->>'estado' from jsonb_array_elements(t->'modelos') x where x->>'modelo' = '303') <> 'draft'
     or (select x->'declaracion' from jsonb_array_elements(t->'modelos') x where x->>'modelo' = '111') <> 'null'::jsonb
     or (select x->>'presentacion' from jsonb_array_elements(t->'modelos') x where x->>'modelo' = '202') is null then
    raise exception 'PRUEBA TRIMESTRE · 5: la tira del 3T da %.', t->'modelos';
  end if;
  select x into m2 from jsonb_array_elements(public.conta_impuesto_trimestre(v_a, 2026, 2)->'modelos') x where x->>'modelo' = '202';
  if (m2->>'no_toca')::boolean is not true or m2->>'periodo' is not null then
    raise exception 'PRUEBA TRIMESTRE · 5: en el 2T, el 202 da %.', m2;
  end if;
  -- El 2T presentado: con su justificante y sus casillas.
  if (select jsonb_array_length(x->'declaracion'->'casillas') from jsonb_array_elements(public.conta_impuesto_trimestre(v_a, 2026, 2)->'modelos') x where x->>'modelo' = '303') < 5 then
    raise exception 'PRUEBA TRIMESTRE · 5: el 303 del 2T no trae sus casillas.';
  end if;
  raise notice 'PRUEBA TRIMESTRE · 5: la tira del 3T es 303, 111, 115 y 202 (2P); en el 2T, el 202 no toca.';
end $$;

-- ── 6 · Otra cuenta no lo ve; un trimestre 5 no existe ───────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  begin
    perform public.conta_impuesto_trimestre(v_a, 2026, 5);
    raise exception 'PRUEBA TRIMESTRE · 6: acepta el trimestre 5.';
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
  begin
    perform public.conta_impuesto_trimestre(v_a, 2026, 3);
    raise exception 'PRUEBA TRIMESTRE · 6: otra cuenta ve el trimestre de A.';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  raise notice 'PRUEBA TRIMESTRE · 6: otra cuenta no lo ve, y el trimestre 5 no existe.';
end $$;

-- ── 7 · Vuelta atrás y otra vez hacia delante ──────────────────────────────
reset role;
\i supabase/vuelta-atras/20261122T0280_i01c_trimestre.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_trimestre(uuid,integer,integer)') is not null then
    raise exception 'PRUEBA TRIMESTRE · 7: la vuelta atrás deja la función.';
  end if;
  if (select prosrc from pg_proc where oid = 'public.conta_impuesto_303_calcular(uuid,integer,text)'::regprocedure) like '%(0280)%' then
    raise exception 'PRUEBA TRIMESTRE · 7: la vuelta atrás no devuelve el cálculo del 303 a la 0240.';
  end if;
end $$;
\i supabase/migrations/20261122T0280_i01c_trimestre.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_trimestre(uuid,integer,integer)') is null then
    raise exception 'PRUEBA TRIMESTRE · 7: hacia delante otra vez no vuelve la función.';
  end if;
  if (select prosrc from pg_proc where oid = 'public.conta_impuesto_303_calcular(uuid,integer,text)'::regprocedure) not like '%(0280)%' then
    raise exception 'PRUEBA TRIMESTRE · 7: hacia delante otra vez no vuelve el cálculo del 303 de la 0280.';
  end if;
end $$;

\echo '>>> PRUEBA TRIMESTRE (0280): en verde. ROLLBACK: staging no cambia.'
rollback;
