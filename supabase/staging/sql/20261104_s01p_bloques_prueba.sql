-- supabase/staging/sql/20261104_s01p_bloques_prueba.sql
--
-- SOLO STAGING. Prueba del S01p · 3 · los bloques de «Cerrar el mes» (1720).
-- Todo en una transacción con ROLLBACK, en la cuenta A. Nombra lo que añade,
-- para el analizador: conta_cierre_mes, conta_cierre_bloque_ventas,
-- conta_cierre_bloque_compras, conta_cierre_bloque_plataformas,
-- conta_cierre_bloque_bancos, conta_cierre_bloque_justificantes,
-- conta_cierre_bloque_laboral, conta_cierre_bloque_repite,
-- conta_cierre_bloque_asientos, conta_cierre_bloque_iva, _s01p_bloque,
-- _s01p_cuenta_de, _s01p_euros.
--   1. Todas son stable o immutable (en producción, solo esas se pasan).
--   2. Octubre de A: los 9 bloques, siempre (regla 7), cada uno con un estado
--      de los cinco, su frase y sus cifras; el IVA, «no aplica» (no es fin de
--      trimestre); «listo» y «faltan» cuadran con ellos.
--   3. Diciembre de A: el IVA sí aplica; las amortizaciones, nunca en verde.
--   4. Permisos: anon no puede; una persona de otra cuenta recibe 42501.
--   5. Otra vez la 1720: las mismas respuestas. La vuelta atrás las quita, y
--      otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p bloques: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la prueba crea las funciones (hace falta el dueño); las llama con los «claims» del administrador de A, que es lo que miran (son security definer y piden persona de la cuenta).
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

\i supabase/migrations/20261104T1720_s01p_bloques.sql

create temp table _r (clave text primary key, v jsonb) on commit drop;

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c uuid; r jsonb; b jsonb; n int;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p bloques: la cuenta A no tiene empresa.'; end if;

  -- 1. Volatilidad.
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'conta_cierre_bloque_%' or p.proname in ('conta_cierre_mes', '_s01p_bloque', '_s01p_cuenta_de', '_s01p_euros'))
     and p.provolatile = 'v';
  if n <> 0 then raise exception 'PRUEBA S01p bloques 1: % funciones volatile.', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'conta_cierre_bloque_%' or p.proname = 'conta_cierre_mes');
  if n <> 10 then raise exception 'PRUEBA S01p bloques 1: % funciones de bloque, esperaba 10.', n; end if;

  -- 2. Octubre.
  r := public.conta_cierre_mes(c, '2026-10-15');
  if r->>'mes' <> '2026-10-01' then raise exception 'PRUEBA S01p bloques 2: mes %', r->>'mes'; end if;
  if (select string_agg(x->>'codigo', ',') from jsonb_array_elements(r->'bloques') x) <> 'ventas,compras,plataformas,bancos,justificantes,laboral,repite,asientos,iva' then
    raise exception 'PRUEBA S01p bloques 2: los bloques de octubre no son los nueve: %', r;
  end if;
  if (select x->>'estado' from jsonb_array_elements(r->'bloques') x where x->>'codigo' = 'iva') <> 'no_aplica' then raise exception 'PRUEBA S01p bloques 2: el IVA aplica en octubre.'; end if;
  for b in select * from jsonb_array_elements(r->'bloques') loop
    if b->>'estado' not in ('verde', 'ambar', 'rojo', 'sin_medir', 'no_aplica') or coalesce(b->>'frase', '') = '' or jsonb_typeof(b->'cifras') <> 'object' or jsonb_typeof(b->'ejemplos') <> 'array' then
      raise exception 'PRUEBA S01p bloques 2: bloque mal formado: %', b;
    end if;
    if jsonb_array_length(b->'ejemplos') > 5 then raise exception 'PRUEBA S01p bloques 2: más de 5 ejemplos en %', b->>'codigo'; end if;
  end loop;
  if (r->>'listo')::boolean <> not exists (select 1 from jsonb_array_elements(r->'bloques') x where x->>'estado' not in ('verde', 'no_aplica')) then
    raise exception 'PRUEBA S01p bloques 2: «listo» no cuadra con los bloques.';
  end if;
  if (r->>'faltan')::int <> (select count(*) from jsonb_array_elements(r->'bloques') x where x->>'estado' in ('rojo', 'ambar')) then
    raise exception 'PRUEBA S01p bloques 2: «faltan» no cuadra.';
  end if;
  insert into _r values ('octubre', r);

  -- 3. Diciembre: con el IVA; las amortizaciones, sin medir.
  r := public.conta_cierre_mes(c, '2026-12-01');
  if jsonb_array_length(r->'bloques') <> 9 then raise exception 'PRUEBA S01p bloques 3: % bloques en diciembre (esperaba 9)', jsonb_array_length(r->'bloques'); end if;
  if (select x->>'estado' from jsonb_array_elements(r->'bloques') x where x->>'codigo' = 'iva') = 'no_aplica' then raise exception 'PRUEBA S01p bloques 3: el IVA no aplica en diciembre.'; end if;
  if (select x->>'estado' from jsonb_array_elements(r->'bloques') x where x->>'codigo' = 'repite') = 'verde' then
    raise exception 'PRUEBA S01p bloques 3: «Lo que se repite» en verde sin registro de bienes.';
  end if;
  if (r->>'listo')::boolean then raise exception 'PRUEBA S01p bloques 3: diciembre «listo» con algo sin medir.'; end if;
  insert into _r values ('diciembre', r);

  raise notice 'PRUEBA S01p bloques 1-3: bien. Octubre %, diciembre %.',
    (select string_agg((x->>'codigo') || '=' || (x->>'estado'), ' ') from jsonb_array_elements((select v from _r where clave = 'octubre')->'bloques') x),
    (select string_agg((x->>'codigo') || '=' || (x->>'estado'), ' ') from jsonb_array_elements(r->'bloques') x);
end $$;

-- 4. Permisos.
do $$ begin
  if has_function_privilege('anon', 'public.conta_cierre_mes(uuid,date)', 'execute') then raise exception 'PRUEBA S01p bloques 4: anon puede.'; end if;
  if not has_function_privilege('authenticated', 'public.conta_cierre_mes(uuid,date)', 'execute') then raise exception 'PRUEBA S01p bloques 4: authenticated no puede.'; end if;
  if has_function_privilege('authenticated', 'public._s01p_cuenta_de(uuid)', 'execute') then raise exception 'PRUEBA S01p bloques 4: authenticated llama al ayudante.'; end if;
end $$;
savepoint ajena;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000ff","role":"authenticated"}', true);
do $$
declare c uuid;
begin
  select id into c from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1;
  begin
    perform public.conta_cierre_mes(c, '2026-10-01');
    raise exception 'PRUEBA S01p bloques 4: otra persona ve el cierre de A.';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback to savepoint ajena;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- 5. Otra vez, vuelta atrás y otra vez delante.
\i supabase/migrations/20261104T1720_s01p_bloques.sql
do $$
declare c uuid;
begin
  select id into c from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1;
  if public.conta_cierre_mes(c, '2026-10-01') is distinct from (select v from _r where clave = 'octubre') then
    raise exception 'PRUEBA S01p bloques 5: otra vez, octubre cambia.';
  end if;
end $$;
\i supabase/vuelta-atras/20261104T1720_s01p_bloques.down.sql
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and (p.proname like 'conta_cierre_bloque_%' or p.proname in ('conta_cierre_mes', '_s01p_bloque', '_s01p_cuenta_de', '_s01p_euros'))) then
    raise exception 'PRUEBA S01p bloques 5: la vuelta atrás deja funciones.';
  end if;
end $$;
\i supabase/migrations/20261104T1720_s01p_bloques.sql
do $$ begin
  if to_regprocedure('public.conta_cierre_mes(uuid,date)') is null then raise exception 'PRUEBA S01p bloques 5: otra vez delante no está.'; end if;
  raise notice 'PRUEBA S01p bloques 4-5: bien.';
end $$;

rollback;
