-- supabase/staging/sql/20261104_s01p_falsos_rojos_prueba.sql
--
-- SOLO STAGING. Prueba del S01p · 5 · los falsos rojos (1905). Todo en una
-- transacción con ROLLBACK, en la cuenta A. Nombra lo que cambia, para el
-- analizador: conta_cierre_bloque_plataformas, conta_cierre_bloque_justificantes,
-- conta_cierre_bloque_laboral, conta_cierre_bloque_repite, conta_cierre_mes,
-- _s01p_sin_medir.
--   1. Siguen siendo stable; el ayudante, immutable.
--   2. «Sin medir» cuenta lo que está sin medir dentro de un bloque en rojo:
--      un bloque de Bancos en rojo con una cuenta sin saldo, «Lo que se repite»
--      en rojo con las amortizaciones, Laboral sin el mes; y no cuenta uno verde.
--   3. Octubre y diciembre de A: los nueve bloques; «sin_medir» y
--      «por_justificar» cuadran con el ayudante; «listo» con rojos y ámbar.
--      Las cifras nuevas están: por canal, por tipo y el 642 de fuera.
--   4. Otra vez la 1905: lo mismo. La vuelta atrás deja las cinco con la huella
--      de la 1720 en producción y quita el ayudante; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p falsos rojos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la prueba cambia las funciones (hace falta el dueño); las llama con los «claims» del administrador de A, que es lo que miran.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- Las huellas de la 1720, medidas en producción el 04/11 (el workflow aplica la 1905 del manifiesto antes que
-- esta prueba, en la misma transacción: medirlas aquí daría las de la 1905).
create temp table _h (f text primary key, md5 text) on commit drop;
insert into _h values ('conta_cierre_bloque_justificantes', 'c1508f3dd49b9a821e75b159dbe18004'), ('conta_cierre_bloque_laboral', 'acf984648132b1bdaeeadc0954a0a5b5'),
  ('conta_cierre_bloque_plataformas', '1d1b3e0147047e5853b80e9427a122fc'), ('conta_cierre_bloque_repite', '984c800897d3315c06348706fc697af2'),
  ('conta_cierre_mes', '9544b61aac0fab745e8233d7662d96b1');

\i supabase/migrations/20261104T1905_s01p_falsos_rojos.sql

create temp table _r (clave text primary key, v jsonb) on commit drop;
do $$
declare c uuid; r jsonb; b jsonb; n int;
begin
  -- 1. Volatilidad.
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'conta_cierre_bloque_%' or p.proname in ('conta_cierre_mes', '_s01p_sin_medir')) and p.provolatile = 'v';
  if n <> 0 then raise exception 'PRUEBA S01p falsos rojos 1: % funciones volatile.', n; end if;

  -- 2. El ayudante.
  if not public._s01p_sin_medir('{"codigo":"bancos","estado":"rojo","cifras":{"sin_medir":2}}') then raise exception 'PRUEBA S01p falsos rojos 2: Bancos en rojo con 2 sin medir no cuenta.'; end if;
  if not public._s01p_sin_medir('{"codigo":"repite","estado":"rojo","cifras":{"amortizaciones":"sin_medir"}}') then raise exception 'PRUEBA S01p falsos rojos 2: las amortizaciones no cuentan.'; end if;
  if not public._s01p_sin_medir('{"codigo":"laboral","estado":"rojo","cifras":{"laboral_personas":0}}') then raise exception 'PRUEBA S01p falsos rojos 2: Laboral sin el mes no cuenta.'; end if;
  if public._s01p_sin_medir('{"codigo":"bancos","estado":"verde","cifras":{"sin_medir":0}}') then raise exception 'PRUEBA S01p falsos rojos 2: un Bancos en verde cuenta.'; end if;
  if public._s01p_sin_medir('{"codigo":"laboral","estado":"no_aplica","cifras":{}}') then raise exception 'PRUEBA S01p falsos rojos 2: Laboral que no aplica cuenta.'; end if;

  -- 3. Octubre y diciembre de A.
  select id into c from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1;
  foreach b in array array['"2026-10-01"'::jsonb, '"2026-12-01"'::jsonb] loop
    r := public.conta_cierre_mes(c, (b #>> '{}')::date);
    if jsonb_array_length(r->'bloques') <> 9 then raise exception 'PRUEBA S01p falsos rojos 3: % bloques.', jsonb_array_length(r->'bloques'); end if;
    if (r->>'sin_medir')::int <> (select count(*) from jsonb_array_elements(r->'bloques') x where public._s01p_sin_medir(x)) then raise exception 'PRUEBA S01p falsos rojos 3: «sin_medir» no cuadra.'; end if;
    if jsonb_array_length(r->'por_justificar') <> (r->>'sin_medir')::int then raise exception 'PRUEBA S01p falsos rojos 3: «por_justificar» no cuadra.'; end if;
    if (r->>'sin_medir')::int < 1 then raise exception 'PRUEBA S01p falsos rojos 3: sin el registro de bienes, «sin_medir» no puede ser 0.'; end if;
    if (r->>'listo')::boolean <> not exists (select 1 from jsonb_array_elements(r->'bloques') x where x->>'estado' in ('rojo', 'ambar')) then raise exception 'PRUEBA S01p falsos rojos 3: «listo» no cuadra.'; end if;
    for b in select * from jsonb_array_elements(r->'bloques') loop
      if b->>'codigo' = 'plataformas' and b->>'estado' <> 'no_aplica' and not (b->'cifras' ? 'por_canal') then raise exception 'PRUEBA S01p falsos rojos 3: Plataformas sin «por_canal».'; end if;
      if b->>'codigo' = 'justificantes' and b->>'estado' <> 'no_aplica' and not (b->'cifras' ? 'sin_documento_por_tipo') then raise exception 'PRUEBA S01p falsos rojos 3: Justificantes sin «por_tipo».'; end if;
      if b->>'codigo' = 'laboral' and b->>'estado' <> 'no_aplica' and not (b->'cifras' ? 'otro_642') then raise exception 'PRUEBA S01p falsos rojos 3: Laboral sin «otro_642».'; end if;
    end loop;
    insert into _r values (b #>> '{}', r) on conflict do nothing;
    insert into _r values ((r->>'mes'), r) on conflict (clave) do update set v = excluded.v;
  end loop;
  raise notice 'PRUEBA S01p falsos rojos 1-3: bien. Octubre: sin medir %, por justificar %.',
    (select v->>'sin_medir' from _r where clave = '2026-10-01'), (select v->'por_justificar' from _r where clave = '2026-10-01');
end $$;

-- 4. Otra vez, vuelta atrás y otra vez delante.
\i supabase/migrations/20261104T1905_s01p_falsos_rojos.sql
do $$
declare c uuid;
begin
  select id into c from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1;
  if public.conta_cierre_mes(c, '2026-10-01') is distinct from (select v from _r where clave = '2026-10-01') then raise exception 'PRUEBA S01p falsos rojos 4: otra vez, octubre cambia.'; end if;
end $$;
\i supabase/vuelta-atras/20261104T1905_s01p_falsos_rojos.down.sql
do $$ begin
  if exists (select 1 from _h where md5 is distinct from (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                                            where n.nspname = 'public' and p.proname = _h.f)) then
    raise exception 'PRUEBA S01p falsos rojos 4: la vuelta atrás no deja las funciones como las dejó la 1720.';
  end if;
  if to_regprocedure('public._s01p_sin_medir(jsonb)') is not null then raise exception 'PRUEBA S01p falsos rojos 4: el ayudante sigue.'; end if;
end $$;
\i supabase/migrations/20261104T1905_s01p_falsos_rojos.sql
do $$ begin
  if to_regprocedure('public._s01p_sin_medir(jsonb)') is null then raise exception 'PRUEBA S01p falsos rojos 4: otra vez delante no está.'; end if;
  raise notice 'PRUEBA S01p falsos rojos 4: bien.';
end $$;

rollback;
