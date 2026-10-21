-- supabase/staging/sql/20261117_m01_motivos_para_validar_vuelta_atras_prueba.sql
--
-- SOLO STAGING. La vuelta atrás de la tanda de «Esperan», ejecutada de verdad
-- (regla 8: que no sea una vuelta atrás que nadie ha corrido):
--   supabase/vuelta-atras/20261117T0100_m01_motivos_para_validar.down.sql
--
--   1. Si staging aún no tiene la tanda de C (20261116T0100), se aplica aquí,
--      dentro de la transacción: en producción ya está (16/10, 21:29), y esta
--      tanda va encima.
--   2. Lo de antes: journal_entry_validar y tg_journal_entry_envio_por_aclarar
--      (huella de prosrc y de la definición entera), cuántas firmas tienen y
--      que las dos nuevas no existen. Se toma con la misma consulta antes y
--      después (regla 31).
--   3. \i 0100: las dos que cambian tienen OTRA huella y las dos nuevas existen.
--   4. \i 0100.down: todo como antes, parte por parte; y el freno de C sigue
--      puesto en journal_entry.
--
-- Todo acaba en ROLLBACK: staging es compartido y no cambia.
-- sin usuario: aplica la migración y su vuelta atrás, que en producción corren
-- como dueño de la base; aquí se comprueba lo que dejan, no lo que ve un
-- usuario (eso lo prueba 20261117_m01_motivos_para_validar_prueba.sql).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA vuelta atrás motivos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 1 · La tanda de C, si staging aún no la tiene (en producción ya está).
select not exists (select 1 from pg_proc where proname = 'tg_journal_entry_envio_por_aclarar' and pronamespace = 'public'::regnamespace) as falta_c06b \gset
\if :falta_c06b
\echo '>>> Staging aún no tiene la tanda de C: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql
\endif

-- W03 (20/10): la M01 ya está de verdad en staging (20261126_w03_c06b_y_m01_de_verdad.sql).
-- Para probarla desde antes, como se probó, se quita aquí dentro con su vuelta
-- atrás; el ROLLBACK del final la devuelve.
select coalesce((select position('conta_motivos_para_validar' in p.prosrc) > 0
                   from pg_proc p where p.oid = to_regprocedure('public.journal_entry_validar(uuid,text)')), false) as m01_de_verdad \gset
\if :m01_de_verdad
\echo '>>> La M01 ya está de verdad en staging: se quita dentro de la transacción para probarla desde antes.'
\i supabase/vuelta-atras/20261117T0100_m01_motivos_para_validar.down.sql
\endif

-- La foto: la misma consulta a los dos lados.
create temporary table prueba_foto (lado text, clave text, valor text) on commit drop;
create function pg_temp.foto(p_lado text) returns void language sql as $f$
  insert into prueba_foto
  select p_lado, x.clave, x.valor from (
    select 'validar prosrc' clave, (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.journal_entry_validar(uuid,text)')) valor union all
    select 'validar definición', (select md5(pg_get_functiondef(to_regprocedure('public.journal_entry_validar(uuid,text)')))) union all
    select 'freno prosrc', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.tg_journal_entry_envio_por_aclarar()')) union all
    select 'freno definición', (select md5(pg_get_functiondef(to_regprocedure('public.tg_journal_entry_envio_por_aclarar()')))) union all
    select 'firmas', (select count(*)::text from pg_proc where proname in ('journal_entry_validar', 'tg_journal_entry_envio_por_aclarar') and pronamespace = 'public'::regnamespace) union all
    select 'nuevas', concat_ws(' · ',
        (to_regprocedure('public.conta_motivos_para_validar(uuid)') is not null)::text,
        (to_regprocedure('public.conta_esperan(uuid,date,date)') is not null)::text) union all
    select 'disparador', (select string_agg(tgname || ' ' || tgenabled::text, ' · ') from pg_trigger
        where tgrelid = 'public.journal_entry'::regclass and tgname = 'trg_journal_entry_envio_por_aclarar' and not tgisinternal)
  ) x
$f$;

-- 2 · Antes.
select pg_temp.foto('antes');
do $$ begin
  if (select valor from prueba_foto where lado = 'antes' and clave = 'nuevas') <> 'false · false' then
    raise exception 'PRUEBA vuelta atrás: las funciones nuevas ya existen antes de aplicar.';
  end if;
  if (select valor from prueba_foto where lado = 'antes' and clave = 'disparador') is null then
    raise exception 'PRUEBA vuelta atrás: el freno de C no está puesto antes de aplicar.';
  end if;
end $$;

-- 3 · La tanda.
\i supabase/migrations/20261117T0100_m01_motivos_para_validar.sql
select pg_temp.foto('aplicada');
do $$ begin
  if (select valor from prueba_foto where lado = 'aplicada' and clave = 'nuevas') <> 'true · true' then
    raise exception 'PRUEBA vuelta atrás: después de aplicar no están las dos funciones nuevas.';
  end if;
  if exists (select 1 from prueba_foto a join prueba_foto d using (clave)
              where a.lado = 'antes' and d.lado = 'aplicada' and clave in ('validar prosrc', 'freno prosrc') and a.valor = d.valor) then
    raise exception 'PRUEBA vuelta atrás: la tanda no ha cambiado alguna de las dos funciones que declara.';
  end if;
  if (select valor from prueba_foto where lado = 'aplicada' and clave = 'firmas') <> (select valor from prueba_foto where lado = 'antes' and clave = 'firmas') then
    raise exception 'PRUEBA vuelta atrás: la tanda ha dejado una sobrecarga.';
  end if;
end $$;

-- 4 · La vuelta atrás, y todo como antes.
\i supabase/vuelta-atras/20261117T0100_m01_motivos_para_validar.down.sql
select pg_temp.foto('después');
do $$
declare r record; n int := 0;
begin
  for r in select a.clave, a.valor antes, d.valor despues from prueba_foto a join prueba_foto d using (clave)
            where a.lado = 'antes' and d.lado = 'después' and a.valor is distinct from d.valor loop
    raise warning 'distinto tras deshacer: % (antes %, después %)', r.clave, r.antes, r.despues;
    n := n + 1;
  end loop;
  if n > 0 then raise exception 'PRUEBA vuelta atrás: % cosa(s) no han vuelto a como estaban.', n; end if;
  if (select count(*) from prueba_foto where lado = 'después') <> 7 then
    raise exception 'PRUEBA vuelta atrás: la foto de después no tiene sus 7 partes.';
  end if;
end $$;

select clave, valor from prueba_foto where lado = 'después' order by clave;
\echo '>>> Vuelta atrás de los motivos para validar en verde: todo como antes. ROLLBACK: no queda nada.'
rollback;
