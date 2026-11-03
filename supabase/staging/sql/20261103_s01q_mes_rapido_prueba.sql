-- supabase/staging/sql/20261103_s01q_mes_rapido_prueba.sql
--
-- SOLO STAGING. Prueba del S01q·11 (1527: conta_liquidaciones y
-- conta_liquidaciones_mes con sus CTE «as materialized»). Todo en una
-- transacción con ROLLBACK, en la empresa A, sin datos nuevos: lo que se
-- prueba es que las dos dicen LO MISMO que antes, más deprisa.
-- Nombra lo que toca, para el analizador: conta_liquidaciones,
-- conta_liquidaciones_mes.
--   1. Antes de aplicar: el mes de cinco meses y el motor de tres, guardados.
--   2. Aplicada: los mismos seis, idénticos byte a byte; las dos llevan sus
--      «materialized» y nada más ha cambiado de su texto.
--   3. Otra vez: no cambia nada y lo dice.
--   4. La vuelta atrás las deja como estaban (el mismo md5), y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01q·11 mes rápido: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); las dos se leen con los claims del administrador de A, porque miran que la empresa sea de quien pregunta.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create temp table _antes (que text primary key, r jsonb, ms numeric) on commit drop;
create temp table _md5 (f text primary key, antes text) on commit drop;
insert into _md5 values
  ('motor', md5(pg_get_functiondef('public.conta_liquidaciones(uuid,date,date)'::regprocedure))),
  ('mes', md5(pg_get_functiondef('public.conta_liquidaciones_mes(uuid,date)'::regprocedure)));

-- 1 · Lo de antes.
do $$
declare c uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; m date; t0 timestamptz; x jsonb;
begin
  foreach m in array array[date '2026-08-01', date '2026-09-01', date '2026-10-01', date '2026-11-01', date '2025-12-01'] loop
    t0 := clock_timestamp(); x := public.conta_liquidaciones_mes(c, m);
    insert into _antes values ('mes ' || m, x, round(extract(epoch from clock_timestamp() - t0) * 1000));
  end loop;
  t0 := clock_timestamp(); x := public.conta_liquidaciones(c, date '2026-08-01', date '2026-10-31');
  insert into _antes values ('motor 01/08–31/10', x, round(extract(epoch from clock_timestamp() - t0) * 1000));
  raise notice 'PRUEBA S01q·11 · 1: guardados % (filas del motor: %).', (select count(*) from _antes), jsonb_array_length(x);
end $$;

\i supabase/migrations/20261103T1527_s01q_mes_rapido.sql

-- 2 · Lo mismo, y con sus «materialized».
create function pg_temp.comprobar(paso text) returns void language plpgsql as $$
declare c uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; a record; x jsonb; t0 timestamptz; ms numeric; motor text; mes text;
begin
  for a in select * from _antes order by que loop
    t0 := clock_timestamp();
    x := case when a.que like 'mes %' then public.conta_liquidaciones_mes(c, substr(a.que, 5)::date)
              else public.conta_liquidaciones(c, date '2026-08-01', date '2026-10-31') end;
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    if x is distinct from a.r then raise exception 'PRUEBA S01q·11 · %: «%» no dice lo mismo que antes.', paso, a.que; end if;
    raise notice 'PRUEBA S01q·11 · %: «%» igual que antes (% ms antes, % ms ahora).', paso, a.que, a.ms, ms;
  end loop;
  motor := pg_get_functiondef('public.conta_liquidaciones(uuid,date,date)'::regprocedure);
  mes := pg_get_functiondef('public.conta_liquidaciones_mes(uuid,date)'::regprocedure);
  if strpos(motor, E'\n  filas as materialized (') = 0 or strpos(mes, '), g as materialized (') = 0 or strpos(mes, '), k as materialized (') = 0 then
    raise exception 'PRUEBA S01q·11 · %: falta algún «materialized».', paso;
  end if;
  -- Nada más ha cambiado de su texto.
  if md5(replace(motor, 'filas as materialized (', 'filas as (')) <> (select antes from _md5 where f = 'motor')
     or md5(replace(replace(mes, 'g as materialized (', 'g as ('), 'k as materialized (', 'k as (')) <> (select antes from _md5 where f = 'mes') then
    raise exception 'PRUEBA S01q·11 · %: ha cambiado algo más que los «materialized».', paso;
  end if;
  raise notice 'PRUEBA S01q·11 · %: las dos llevan sus «materialized», y nada más ha cambiado.', paso;
end $$;
select pg_temp.comprobar('2');

-- 3 · Otra vez: no cambia nada.
\i supabase/migrations/20261103T1527_s01q_mes_rapido.sql
select pg_temp.comprobar('3');

-- 4 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261103T1527_s01q_mes_rapido.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.conta_liquidaciones(uuid,date,date)'::regprocedure)) <> (select antes from _md5 where f = 'motor')
     or md5(pg_get_functiondef('public.conta_liquidaciones_mes(uuid,date)'::regprocedure)) <> (select antes from _md5 where f = 'mes') then
    raise exception 'PRUEBA S01q·11 · 4: la vuelta atrás no las deja como estaban.';
  end if;
  raise notice 'PRUEBA S01q·11 · 4: la vuelta atrás las deja como estaban (el mismo md5).';
end $$;
\i supabase/migrations/20261103T1527_s01q_mes_rapido.sql
select pg_temp.comprobar('4');

rollback;
