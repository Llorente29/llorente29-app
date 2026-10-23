-- supabase/staging/sql/20261208_d07a_respaldo_prueba.sql
--
-- SOLO STAGING. Prueba de 20261208T0840_d07a_respaldo_antes_de_reenviar y de la
-- vuelta atrás nueva de la 0820, con \i dentro de la transacción y ROLLBACK:
-- staging no cambia.
--
-- Lo que paró el ensayo del run 190 (23/10): la vuelta atrás de la 0820 no
-- dejaba los envíos como estaban (attempts = 3, pero last_error y next_try_at
-- los de la 0820). Aquí:
--   1. Sin Foodint, la tanda entera (0840, 0820) y su vuelta atrás en orden
--      inverso (0820, 0840) no tocan ningún envío; el respaldo queda vacío y
--      al final no existe.
--   2. CON DATOS: un envío de la empresa A, «pendiente» con el error de la
--      descripción y 3 intentos. Se respalda como lo hace la 0840 (la misma
--      fila), se repone como lo hace la 0820 (attempts 0, next_try_at ahora,
--      last_error «Se vuelve a mandar…») y la vuelta atrás de la 0820 lo deja
--      BYTE A BYTE como estaba: attempts, next_try_at, last_error y
--      updated_at. Uno que ya llegó a Diez no se toca.
--   3. B no ve el respaldo (RLS sin políticas, sin permisos para authenticated).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D07a 0840: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 1 · Sin Foodint: la tanda y su vuelta atrás no tocan nada.
create temp table _antes on commit drop as select id, attempts, next_try_at, last_error, updated_at from public.external_send;
\i supabase/migrations/20261208T0840_d07a_respaldo_antes_de_reenviar.sql
do $$ begin
  if to_regclass('public.conta_respaldo_d07a_envios') is null then raise exception 'PRUEBA D07a 0840 · 1: no ha creado el respaldo.'; end if;
  if exists (select 1 from public.conta_respaldo_d07a_envios) then raise exception 'PRUEBA D07a 0840 · 1: sin Foodint, el respaldo no está vacío.'; end if;
end $$;
\i supabase/migrations/20261208T0820_d07a_diez_reenviar_descripcion.sql
\i supabase/vuelta-atras/20261208T0820_d07a_diez_reenviar_descripcion.down.sql
\i supabase/vuelta-atras/20261208T0840_d07a_respaldo_antes_de_reenviar.down.sql
do $$ begin
  if exists (select 1 from public.external_send x full join _antes a on a.id = x.id
              where a.id is null or x.id is null or a.attempts is distinct from x.attempts or a.next_try_at is distinct from x.next_try_at
                 or a.last_error is distinct from x.last_error or a.updated_at is distinct from x.updated_at) then
    raise exception 'PRUEBA D07a 0840 · 1: sin Foodint, la tanda o su vuelta atrás han tocado external_send.';
  end if;
  if to_regclass('public.conta_respaldo_d07a_envios') is not null then raise exception 'PRUEBA D07a 0840 · 1: la vuelta atrás no ha quitado el respaldo.'; end if;
  raise notice 'D07a 0840 · 1: sin Foodint, la tanda y su vuelta atrás no tocan ningún envío';
end $$;

-- 2 · Con datos: un envío de A, respaldado, repuesto y devuelto byte a byte.
\i supabase/migrations/20261208T0840_d07a_respaldo_antes_de_reenviar.sql
create temp table _c (clave text primary key, id uuid) on commit drop;
-- Dos asientos de A sin envío (external_send_entry_uq: uno por asiento).
insert into _c select 'asiento' || row_number() over (order by e.created_at, e.id), e.id from public.journal_entry e
 where e.account_id = 'c01a0000-0000-4000-8000-00000000000a'
   and not exists (select 1 from public.external_send x where x.entry_id = e.id)
 order by e.created_at, e.id limit 2;
do $$ begin
  if (select count(*) from _c where clave like 'asiento%') < 2 then raise exception 'PRUEBA D07a 0840 · 2: la cuenta A de staging no tiene dos asientos sin envío.'; end if;
end $$;
insert into public.external_send (id, account_id, company_id, entry_id, kind, payload_hash, status, attempts, last_error, next_try_at, created_at, updated_at)
select v.id, 'c01a0000-0000-4000-8000-00000000000a', e.company_id, e.id, 'factura', v.hash, v.status, v.attempts, v.err, v.nt, v.ts, v.ts
  from (values
    ('asiento1', 'd07a0000-0000-4000-8000-000000000841'::uuid, 'prueba-0840-1', 'pendiente', 3::smallint,
     'Diez: factura.Descripcion: debe ser un texto de 40 como máximo (prueba D07a 0840)', timestamptz '2026-10-23 13:52:31.044+00', timestamptz '2026-10-23 13:52:31.044+00'),
    ('asiento2', 'd07a0000-0000-4000-8000-000000000842'::uuid, 'prueba-0840-2', 'pendiente', 3::smallint,
     'Diez: factura.Descripcion: debe ser un texto de 40 como máximo (prueba D07a 0840, la que llega)', timestamptz '2026-10-23 13:40:00+00', timestamptz '2026-10-23 13:40:00+00')
  ) as v(clave, id, hash, status, attempts, err, nt, ts)
  join _c c on c.clave = v.clave
  join public.journal_entry e on e.id = c.id;
create temp table _fila_antes on commit drop as
  select id, attempts, next_try_at, last_error, updated_at from public.external_send where id::text like 'd07a0000-0000-4000-8000-00000000084%';
-- Lo que hace la 0840 con una fila de Foodint, aquí con las de A.
insert into public.conta_respaldo_d07a_envios (id, attempts, next_try_at, last_error, updated_at)
select id, attempts, next_try_at, last_error, updated_at from _fila_antes;
-- Lo que hace la 0820.
update public.external_send x
   set attempts = 0, next_try_at = now(), updated_at = now(),
       last_error = 'Se vuelve a mandar con la descripción en 40 caracteres (D07a). Antes: ' || left(x.last_error, 300)
 where x.id::text like 'd07a0000-0000-4000-8000-00000000084%';
-- La segunda ya ha llegado a Diez mientras tanto: no se toca.
update public.external_send set status = 'enviado', attempts = 1, sent_at = now(), ext_year = '2026', ext_series = '2', ext_number = 990842, ext_invoice_number = 'PRUEBA-0842'
 where id = 'd07a0000-0000-4000-8000-000000000842';
\i supabase/vuelta-atras/20261208T0820_d07a_diez_reenviar_descripcion.down.sql
do $$
declare a record; x record;
begin
  select * into a from _fila_antes where id = 'd07a0000-0000-4000-8000-000000000841';
  select * into x from public.external_send where id = 'd07a0000-0000-4000-8000-000000000841';
  if x.attempts is distinct from a.attempts or x.next_try_at is distinct from a.next_try_at
     or x.last_error is distinct from a.last_error or x.updated_at is distinct from a.updated_at then
    raise exception 'PRUEBA D07a 0840 · 2: la vuelta atrás de la 0820 no deja el envío como estaba (attempts % → %, last_error «%»).',
      a.attempts, x.attempts, x.last_error;
  end if;
  select * into x from public.external_send where id = 'd07a0000-0000-4000-8000-000000000842';
  if x.status <> 'enviado' or x.attempts <> 1 or x.last_error not like 'Se vuelve a mandar%' then
    raise exception 'PRUEBA D07a 0840 · 2: la vuelta atrás ha tocado uno que ya llegó a Diez.';
  end if;
  raise notice 'D07a 0840 · 2: la vuelta atrás de la 0820 deja el envío byte a byte como estaba, y no toca el que ya llegó';
end $$;

-- 3 · B no ve el respaldo.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin
    perform 1 from public.conta_respaldo_d07a_envios;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA D07a 0840 · 3: un usuario puede leer el respaldo.'; end if;
  raise notice 'D07a 0840 · 3: un usuario no lee el respaldo';
end $$;
reset role;

\i supabase/vuelta-atras/20261208T0840_d07a_respaldo_antes_de_reenviar.down.sql
rollback;
