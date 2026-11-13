-- supabase/staging/sql/20261113_dl1_facturas_a_su_fecha_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · facturas de octubre a su fecha (0905). Todo
-- en una transacción con ROLLBACK. Lo que mueve lo hace _s01p_facturas_a_su_fecha
-- (S01p·4), con su propia prueba; aquí, lo que añade la 0905: la copia del 303.
--   1. Sin Foodint, la migración no mueve nada (ningún asiento cambia).
--   2. La tabla de la copia existe, con seguridad por filas y sin acceso para
--      los usuarios, y se puede pasar dos veces.
--   3. La función que usa existe con su firma.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 facturas a su fecha: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda corre como el dueño; dentro, la función pone el usuario de la persona al validar.
set constraints all immediate;

create temp table prueba_antes on commit drop as select count(*) n, coalesce(sum(extract(epoch from updated_at)), 0) h from public.journal_entry;
\i supabase/migrations/20261113T0905_dl1_facturas_a_su_fecha.sql
\i supabase/migrations/20261113T0905_dl1_facturas_a_su_fecha.sql

do $$
begin
  -- 1. Sin Foodint, nada.
  if (select count(*) from public.journal_entry) <> (select n from prueba_antes)
     or (select coalesce(sum(extract(epoch from updated_at)), 0) from public.journal_entry) <> (select h from prueba_antes) then
    raise exception 'PRUEBA DL1 facturas a su fecha 1: sin Foodint la migración ha cambiado algún asiento.';
  end if;
  -- 2. La copia.
  if not exists (select 1 from pg_class where relname = 'conta_dl1_303_4t_antes' and relrowsecurity) then
    raise exception 'PRUEBA DL1 facturas a su fecha 2: falta la tabla de la copia o no tiene seguridad por filas.';
  end if;
  if has_table_privilege('authenticated', 'public.conta_dl1_303_4t_antes', 'select') then
    raise exception 'PRUEBA DL1 facturas a su fecha 2: los usuarios pueden leer la copia.';
  end if;
  -- 3. La función.
  if to_regprocedure('public._s01p_facturas_a_su_fecha(uuid,uuid[],uuid,uuid,text)') is null then
    raise exception 'PRUEBA DL1 facturas a su fecha 3: falta _s01p_facturas_a_su_fecha.';
  end if;
end $$;

select 'PRUEBA DL1 facturas a su fecha: en verde' as resultado;
rollback;
