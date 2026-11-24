-- supabase/staging/sql/20261113_dl1_liquidaciones_octubre_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · liquidaciones de octubre (0935). Todo en una
-- transacción con ROLLBACK. La 0935 no añade objetos: propone con
-- _conta_proponer_plataforma (S01q·10, con su prueba) y valida con _dl1_validar
-- (1750, con la suya).
--   1. Sin Foodint, la migración no hace nada (ningún asiento cambia).
--   2. Las dos funciones que usa existen con su firma.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 liquidaciones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda corre como el dueño; dentro, _dl1_validar pone el usuario de la persona al validar.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
create temp table prueba_antes on commit drop as select count(*) n, coalesce(sum(extract(epoch from updated_at)), 0) h from public.journal_entry;
\i supabase/migrations/20261113T0935_dl1_liquidaciones_octubre.sql

do $$
begin
  if (select count(*) from public.journal_entry) <> (select n from prueba_antes)
     or (select coalesce(sum(extract(epoch from updated_at)), 0) from public.journal_entry) <> (select h from prueba_antes) then
    raise exception 'PRUEBA DL1 liquidaciones 1: sin Foodint la migración ha cambiado algún asiento.';
  end if;
  if to_regprocedure('public._conta_proponer_plataforma(uuid,uuid,text)') is null or to_regprocedure('public._dl1_validar(uuid,uuid,text,jsonb)') is null then
    raise exception 'PRUEBA DL1 liquidaciones 2: falta _conta_proponer_plataforma o _dl1_validar.';
  end if;
end $$;

select 'PRUEBA DL1 liquidaciones: en verde' as resultado;
rollback;
