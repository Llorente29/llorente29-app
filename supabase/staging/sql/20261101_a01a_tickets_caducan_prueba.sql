-- supabase/staging/sql/20261101_a01a_tickets_caducan_prueba.sql
--
-- SOLO STAGING. Prueba de la 1906 (A01a: un ticket viejo caduca y el aviso
-- deja de repetirse), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. Nombra lo que cambia: public.print_job, public.db_health_watchdog,
-- public.print_job_vigia, public.print_job_aviso y
-- public._print_job_caducado_no_vuelve.
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás. Y ROJO A PROPÓSITO: con lo de antes, un trabajo no puede caducar (la
--       base rechaza «expired»): uno de hace 3 h se queda «pending» para siempre.
--   1 · recién aplicada.
--   2 · un trabajo viejo (3 h) caduca, con su motivo; uno reciente (5 min), no.
--   3 · un caducado no vuelve a la cola.
--   4 · el aviso: sale una vez al abrirse; con la cola igual no se repite; sale
--       otra vez si se dobla; y «Resuelto» al vaciarse.
--   5 · la impresión normal no cambia: un trabajo nuevo pasa a «sent» y «done».
--   6 · la vuelta atrás: el vigía byte a byte como estaba y el caducado, otra
--       vez «pending».

-- sin usuario: print_job lo escriben las funciones de la base (por token de
-- la tablet) y lo lee el vigía (cron); ninguna pantalla lo toca. Se prueba
-- como lo hacen ellas.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA A01a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _s (clave text primary key, v text) on commit drop;
insert into _s values
  ('a', 'c01a0000-0000-4000-8000-00000000000a'),
  ('local', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('huella', 'dd8f4ead3f4fe4bf6fbcbe10cd09f5dc');

-- Un trabajo de A en su local, de hace p_hace.
create function pg_temp.trabajo(p_hace interval) returns uuid language plpgsql as $f$
declare v_id uuid; v_st text;
begin
  insert into public.print_job (account_id, location_id, printer_id, doc_type, payload, status, created_at)
  values ((select v::uuid from _s where clave = 'a'), (select v::uuid from _s where clave = 'local'),
          (select id from public.printer where account_id = (select v::uuid from _s where clave = 'a') order by id limit 1),
          'kitchen', '{"prueba": "A01a"}'::jsonb, 'pending', now() - p_hace)
  returning id, status into v_id, v_st;
  if v_id is null then raise exception 'PRUEBA A01a: el trabajo de prueba no se ha guardado.'; end if;
  if v_st <> 'pending' then
    raise notice 'A01a: un disparador de esta base deja el trabajo nuevo en «%»; se pone «pending» para la prueba.', v_st;
    update public.print_job set status = 'pending' where id = v_id;
  end if;
  return v_id;
end $f$;
-- Lo que tiene print_job en esta base, para leerlo en el registro.
do $$ begin
  raise notice 'A01a · print_job aquí: CHECK de estado «%»; disparadores: %; vigía md5 %.',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'print_job_status_check'),
    coalesce((select string_agg(tgname, ', ') from pg_trigger where tgrelid = 'public.print_job'::regclass and not tgisinternal), 'ninguno'),
    left(md5(pg_get_functiondef('public.db_health_watchdog()'::regprocedure)), 8);
end $$;
create function pg_temp.avisos() returns bigint language sql as $f$
  select count(*) from public.system_alert_queue
   where location_id = (select v::uuid from _s where clave = 'local')
     and (subject like 'Tickets sin imprimir%' or subject like 'Resuelto: ya no hay tickets%');
$f$;
-- Lo que hubiera de antes en ese local no cuenta: se aparta (todo en ROLLBACK).
delete from public.print_job where location_id = (select v::uuid from _s where clave = 'local') and status in ('pending', 'sent');
delete from public.system_alert_queue where location_id = (select v::uuid from _s where clave = 'local');

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
-- El manifiesto de staging aplica la 1906 justo antes de esta prueba, en la
-- misma transacción: si ya está, primero su vuelta atrás.
select to_regprocedure('public.print_job_vigia()') is not null as a01a_aplicada \gset
\if :a01a_aplicada
\i supabase/vuelta-atras/20261101T1906_a01a_tickets_caducan.down.sql
\endif
create temp table _ids (clave text primary key, id uuid) on commit drop;
insert into _ids values ('viejo0', pg_temp.trabajo(interval '3 hours'));
do $$
declare v_ok boolean := false;
begin
  -- ROJO A PROPÓSITO: con lo de antes, un trabajo no puede caducar.
  begin
    update public.print_job set status = 'expired' where id = (select id from _ids where clave = 'viejo0');
    if not found then raise exception 'PRUEBA A01a · 0: el trabajo de prueba no está.'; end if;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA A01a · 0: con lo de antes ya existe el estado «expired»: la prueba no mediría nada.'; end if;
  raise notice 'A01a · 0 (rojo a propósito): con lo de antes, un trabajo no puede caducar (la base rechaza «expired»). Aquí, el vigía tiene md5 %.',
    left(md5(pg_get_functiondef('public.db_health_watchdog()'::regprocedure)), 8);
end $$;
delete from public.print_job where id = (select id from _ids where clave = 'viejo0');

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261101T1906_a01a_tickets_caducan.sql

-- ── 2 · Viejo caduca; reciente, no ──────────────────────────────────────────
insert into _ids values ('viejo', pg_temp.trabajo(interval '3 hours')), ('reciente', pg_temp.trabajo(interval '5 minutes'));
select public.print_job_vigia();
do $$
declare v record;
begin
  select status, expired_at, expire_reason into v from public.print_job where id = (select id from _ids where clave = 'viejo');
  if v.status <> 'expired' or v.expired_at is null or coalesce(v.expire_reason, '') = '' then
    raise exception 'PRUEBA A01a · 2: el trabajo de hace 3 h no ha caducado con su motivo (%).', v.status;
  end if;
  if (select status from public.print_job where id = (select id from _ids where clave = 'reciente')) <> 'pending' then
    raise exception 'PRUEBA A01a · 2: el trabajo de hace 5 min ha cambiado de estado.';
  end if;
  raise notice 'A01a · 2: el de hace 3 h caduca («%»); el de hace 5 min sigue pendiente.', v.expire_reason;
end $$;

-- ── 3 · Un caducado no vuelve a la cola ─────────────────────────────────────
do $$
begin
  begin
    update public.print_job set status = 'pending' where id = (select id from _ids where clave = 'viejo');
    raise exception 'PRUEBA A01a · 3: un caducado ha vuelto a «pending».';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'PRUEBA%' then raise; end if;
  end;
  if (select status from public.print_job where id = (select id from _ids where clave = 'viejo')) <> 'expired' then
    raise exception 'PRUEBA A01a · 3: el caducado no sigue caducado.';
  end if;
  raise notice 'A01a · 3: un caducado no vuelve a la cola.';
end $$;

-- ── 4 · El aviso: una vez, otra si se dobla, y «Resuelto» ───────────────────
update public.print_job set created_at = now() - interval '20 minutes' where id = (select id from _ids where clave = 'reciente');
select public.print_job_vigia();
select public.print_job_vigia();
select public.print_job_vigia();
do $$ begin
  if pg_temp.avisos() <> 1 then raise exception 'PRUEBA A01a · 4: con la cola igual, % avisos (se esperaba 1).', pg_temp.avisos(); end if;
end $$;
insert into _ids values ('segundo', pg_temp.trabajo(interval '20 minutes'));
select public.print_job_vigia();
select public.print_job_vigia();
do $$ begin
  if pg_temp.avisos() <> 2 then raise exception 'PRUEBA A01a · 4: con la cola doblada, % avisos (se esperaban 2).', pg_temp.avisos(); end if;
end $$;
update public.print_job set status = 'done', done_at = now() where id in (select id from _ids where clave in ('reciente', 'segundo'));
select public.print_job_vigia();
select public.print_job_vigia();
do $$ begin
  if pg_temp.avisos() <> 3 then raise exception 'PRUEBA A01a · 4: al vaciarse, % avisos (se esperaban 3: abre, se dobla y resuelto).', pg_temp.avisos(); end if;
  if not exists (select 1 from public.system_alert_queue where location_id = (select v::uuid from _s where clave = 'local') and subject like 'Resuelto: ya no hay tickets%') then
    raise exception 'PRUEBA A01a · 4: no ha salido el «Resuelto».';
  end if;
  if exists (select 1 from public.print_job_aviso where location_id = (select v::uuid from _s where clave = 'local')) then
    raise exception 'PRUEBA A01a · 4: el aviso sigue abierto después de resolverse.';
  end if;
  raise notice 'A01a · 4: el aviso sale al abrirse, no se repite con la cola igual, sale otra vez al doblarse y «Resuelto» al vaciarse (3 avisos en 7 pasadas).';
end $$;

-- ── 5 · La impresión normal no cambia ───────────────────────────────────────
insert into _ids values ('nuevo', pg_temp.trabajo(interval '0 seconds'));
select public.db_health_watchdog();
update public.print_job set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = (select id from _ids where clave = 'nuevo');
update public.print_job set status = 'done', done_at = now() where id = (select id from _ids where clave = 'nuevo');
do $$ begin
  if (select status from public.print_job where id = (select id from _ids where clave = 'nuevo')) <> 'done' then
    raise exception 'PRUEBA A01a · 5: un trabajo nuevo no ha llegado a «done».';
  end if;
  raise notice 'A01a · 5: un trabajo nuevo pasa por «sent» y «done» como hoy, con el vigía nuevo corriendo.';
end $$;

-- ── 6 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261101T1906_a01a_tickets_caducan.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.db_health_watchdog()'::regprocedure)) <> (select v from _s where clave = 'huella') then
    raise exception 'PRUEBA A01a · 6: la vuelta atrás no deja db_health_watchdog como estaba.';
  end if;
  if (select status from public.print_job where id = (select id from _ids where clave = 'viejo')) <> 'pending' then
    raise exception 'PRUEBA A01a · 6: el caducado no ha vuelto a «pending».';
  end if;
  if to_regprocedure('public.print_job_vigia()') is not null or to_regclass('public.print_job_aviso') is not null then
    raise exception 'PRUEBA A01a · 6: quedan print_job_vigia o print_job_aviso.';
  end if;
  raise notice 'A01a · 6: la vuelta atrás deja el vigía byte a byte como estaba y el caducado, otra vez pendiente.';
end $$;

rollback;
