-- ============================================================================
-- SOLO STAGING-CONTA · B01 · LA VUELTA ATRÁS COMPLETA DE LA TANDA (0100–0170)
-- ----------------------------------------------------------------------------
-- Ensayo #64 de producción (14/10): la vuelta atrás no estaba completa. La de
-- la 0140 borraba el bucket con SQL y Supabase no lo deja («Direct deletion
-- from storage tables is not allowed»). Esta prueba ejecuta, de verdad y en el
-- orden de supabase/produccion/vuelta-atras.txt, los ocho .down.sql de la
-- tanda, y AL FINAL SE DESHACE TODO (rollback): staging queda igual.
--
--   0. Dos fotos: lo que NO es del B01 (tiene que salir igual después de la
--      vuelta atrás) y todo (tiene que salir igual después de volver a aplicar).
--   1. La guarda de la 0140 para con un ticket enlazado.
--   2. Se vacían, dentro de esta transacción, los datos del B01: así está
--      producción justo después de un real (las tablas, nuevas, vacías).
--   3. Las ocho vueltas atrás, en orden inverso, como el workflow.
--   4. Comprobación: no queda ni una tabla, función ni columna del B01; el
--      bucket «banco-tickets» y sus dos políticas SE QUEDAN (no se toca
--      storage con SQL: ver la cabecera del .down.sql de la 0140); y lo que no
--      es del B01, idéntico a la foto de antes.
--   5. Ida otra vez: las ocho migraciones vuelven a entrar y todo queda como al
--      principio (misma foto entera).
--   6. rollback.
--
-- La corre el workflow de staging con psql -1 y ON_ERROR_STOP.
-- sin usuario: la vuelta atrás no la ejecuta nadie desde la app; la aplica el
--   workflow de producción con el rol de su conexión (crear y quitar tablas,
--   funciones y columnas). Aquí, igual: probarla como «authenticated» no
--   probaría lo que corre de verdad.
-- ============================================================================

\set ON_ERROR_STOP 1

-- 0 · Las fotos.
create temp table b01_nombres(t text primary key);
insert into b01_nombres values ('bank_settings'), ('bank_statement'), ('bank_account_iban'), ('bank_movement'), ('bank_match'),
  ('bank_match_item'), ('bank_rule'), ('bank_rule_log'), ('bank_activity_log'), ('recurring_contract'), ('bank_card'),
  ('bank_month_close'), ('bank_agent_run'), ('bank_aggregator_link');

create temp view b01_foto_fuera as
select md5(concat_ws('#',
  (select string_agg(c.relname || ':' || c.relkind::text, ',' order by c.relname) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relname not like 'bank\_%' and c.relname not like 'recurring\_contract%'),
  (select string_agg(table_name || '.' || column_name || ':' || data_type, ',' order by table_name, column_name) from information_schema.columns
    where table_schema = 'public' and table_name not in (select t from b01_nombres)
      and (table_name, column_name) not in (('treasury_account', 'short_name'), ('treasury_account', 'iban_review'))),
  (select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname not like 'bank\_%' and p.proname not like '\_bank\_%'),
  (select string_agg(tablename || '.' || policyname, ',' order by tablename, policyname) from pg_policies
    where schemaname = 'public' and tablename not in (select t from b01_nombres)),
  (select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'storage'),
  (select string_agg(id, ',' order by id) from storage.buckets))) as foto;

create temp view b01_foto_entera as
select md5(concat_ws('#',
  (select string_agg(c.relname || ':' || c.relkind::text, ',' order by c.relname) from pg_class c where c.relnamespace = 'public'::regnamespace),
  (select string_agg(table_name || '.' || column_name || ':' || data_type, ',' order by table_name, column_name) from information_schema.columns where table_schema = 'public'),
  (select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public'::regnamespace),
  (select string_agg(tablename || '.' || policyname, ',' order by tablename, policyname) from pg_policies where schemaname in ('public', 'storage')),
  (select string_agg(conrelid::regclass::text || '.' || conname || ':' || md5(pg_get_constraintdef(oid)), ',' order by conrelid::regclass::text, conname)
     from pg_constraint where connamespace = 'public'::regnamespace),
  (select string_agg(id, ',' order by id) from storage.buckets))) as foto;

create temp table b01_fotos as select (select foto from b01_foto_fuera) fuera, (select foto from b01_foto_entera) entera;

do $$
begin
  if (select count(*) from b01_nombres where to_regclass('public.' || t) is not null) <> 14 then
    raise exception 'PRUEBA B01: staging no tiene las 14 tablas del B01: no hay tanda que deshacer.';
  end if;
  raise notice 'PRUEBA B01 · 0: fotos tomadas (fuera del B01 y entera).';
end $$;

-- 1 · La guarda de la 0140 para con un ticket enlazado.
savepoint guarda_0140;
update public.bank_movement set receipt_path = 'prueba/vuelta-atras/ticket.jpg'
 where id = (select id from public.bank_movement order by id limit 1);
\set ON_ERROR_STOP 0
\ir ../../vuelta-atras/20261101T0140_b01_tarjetas.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint guarda_0140;
select (:'LAST_ERROR_MESSAGE' = 'Hay tickets enlazados a movimientos: guárdalos antes de quitar las tarjetas.') as guarda_0140_ok \gset
\echo 'Guarda 0140 dijo:' :'LAST_ERROR_MESSAGE'
\if :guarda_0140_ok
\else
  do $$ begin raise exception 'PRUEBA B01: la guarda de la 0140 NO ha parado con un ticket enlazado.'; end $$;
\endif

-- 2 · Como producción justo después de un real: las tablas del B01, vacías.
truncate table public.bank_match_item, public.bank_match, public.bank_rule_log, public.bank_rule, public.bank_activity_log,
  public.bank_agent_run, public.bank_aggregator_link, public.bank_month_close, public.bank_movement, public.bank_card,
  public.bank_account_iban, public.bank_statement, public.bank_settings, public.recurring_contract;

-- 3 · Las ocho vueltas atrás, en el orden de supabase/produccion/vuelta-atras.txt.
\ir ../../vuelta-atras/20261101T0170_b01_foodint_cuentas.down.sql
\ir ../../vuelta-atras/20261101T0160_b01_lectura_agente.down.sql
\ir ../../vuelta-atras/20261101T0150_b01_cierre_agente.down.sql
\ir ../../vuelta-atras/20261101T0140_b01_tarjetas.down.sql
\ir ../../vuelta-atras/20261101T0130_b01_lectura.down.sql
\ir ../../vuelta-atras/20261101T0120_b01_foodint.down.sql
\ir ../../vuelta-atras/20261101T0110_b01_funciones.down.sql
\ir ../../vuelta-atras/20261101T0100_b01_bancos.down.sql

-- 4 · No queda nada del B01; el bucket se queda; lo de fuera, igual.
do $$
declare n int; f text;
begin
  select string_agg(t, ', ') into f from b01_nombres where to_regclass('public.' || t) is not null;
  if f is not null then raise exception 'PRUEBA B01 · 4: quedan tablas del B01: %.', f; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into f from pg_proc p
   where p.pronamespace = 'public'::regnamespace and (p.proname like 'bank\_%' or p.proname like '\_bank\_%');
  if f is not null then raise exception 'PRUEBA B01 · 4: quedan funciones del B01: %.', f; end if;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'treasury_account' and column_name in ('short_name', 'iban_review');
  if n <> 0 then raise exception 'PRUEBA B01 · 4: treasury_account sigue con % columnas del B01.', n; end if;
  if not exists (select 1 from storage.buckets where id = 'banco-tickets') then
    raise exception 'PRUEBA B01 · 4: el bucket banco-tickets ha desaparecido (la vuelta atrás no lo toca).';
  end if;
  select count(*) into n from pg_policies where schemaname = 'storage' and policyname in ('banco_tickets_select', 'banco_tickets_insert');
  if n <> 2 then raise exception 'PRUEBA B01 · 4: las políticas del bucket son % (espero las 2: se quedan con él).', n; end if;
  if (select foto from b01_foto_fuera) <> (select fuera from b01_fotos) then
    raise exception 'PRUEBA B01 · 4: lo que no es del B01 ha cambiado con la vuelta atrás.';
  end if;
  raise notice 'PRUEBA B01 · 4 en verde: las ocho vueltas atrás, sin rastro del B01; el bucket banco-tickets y sus 2 políticas se quedan (con % ficheros en staging); lo de fuera, idéntico.',
    (select count(*) from storage.objects where bucket_id = 'banco-tickets');
end $$;

-- 5 · Ida otra vez: las ocho migraciones vuelven a entrar.
\ir ../../migrations/20261101T0100_b01_bancos.sql
\ir ../../migrations/20261101T0110_b01_funciones.sql
\ir ../../migrations/20261101T0120_b01_foodint.sql
\ir ../../migrations/20261101T0130_b01_lectura.sql
\ir ../../migrations/20261101T0140_b01_tarjetas.sql
\ir ../../migrations/20261101T0150_b01_cierre_agente.sql
\ir ../../migrations/20261101T0160_b01_lectura_agente.sql
\ir ../../migrations/20261101T0170_b01_foodint_cuentas.sql

do $$
begin
  if (select foto from b01_foto_entera) <> (select entera from b01_fotos) then
    raise exception 'PRUEBA B01 · 5: después de volver a aplicar, la base no es la del principio.';
  end if;
  raise notice 'PRUEBA B01 · 5 en verde: las ocho migraciones vuelven a entrar y la base queda como al principio (misma foto entera).';
end $$;

-- 6 · Nada de esto se queda: staging, igual que antes.
rollback;
