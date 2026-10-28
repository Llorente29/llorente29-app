-- supabase/staging/sql/20261028_l1a3_avisos_prueba.sql
--
-- SOLO STAGING. Prueba de la 1800, la 1801 y la 1934 (L1a · PR 3: el aviso de olvido
-- rehecho, la respuesta en un toque, el aviso fuera del radio y el vigía de
-- los envíos), con \i dentro de la transacción y ROLLBACK: staging no cambia.
--
-- Un miércoles inventado (21/10/2026) en «Norte Centro» de la cuenta A, con
-- un cuadrante publicado: el turno de mañana (10:00–17:00) y el de noche
-- (20:00–00:00). Las «horas de ahora» se pasan a la detección (p_ahora), así
-- que la prueba no depende de cuándo corra. Personas inventadas:
--
--   marcos    entrada 09:58, sin salida, con teléfono  → WhatsApp a las 17:30
--   cumple    entrada 09:55 y salida 17:10              → nada (el caso de los
--             48 falsos de antes: la salida ya estaba fichada)
--   tarde     entrada 10:02, sin salida; a las 17:20    → todavía no
--   noche     entrada 19:58, sin salida; turno a 00:00  → solo portal (las
--             00:30 están fuera de la franja)
--   sintel    entrada 10:00, sin salida, sin teléfono   → solo portal
--   sinturno  entrada 06:00, sin turno                  → WhatsApp a las 18:00
--   renuncia  no quiere el WhatsApp                     → solo portal
--   portal    la del usuario «trabajador» de la cuenta A → contesta en el portal
--   lejos     ficha con fichar() desde el móvil         → aviso solo con ubicación
--             precisa fuera del radio; la aproximada (más de 100 m de
--             precisión) no es ni dentro ni fuera
--
--   0 · lo de antes: si ya están aplicadas, sus vueltas atrás; la huella de
--       enqueue_clockout_reminders para compararla al final.
--   1 · la detección: quién, cuándo y por qué canal; una por entrada.
--   2 · la cola: no manda lo ya fichado; fuera de la franja, al portal.
--   3 · contestar por WhatsApp: el teléfono y el mensaje tienen que cuadrar;
--       «Salí a esa hora» crea la petición (nunca el fichaje), una vez;
--       «Sigo trabajando» y «Otra hora» no crean nada; lo ya fichado, tampoco.
--   4 · contestar en el portal: solo lo suyo; «Otra hora» pide la hora; la
--       tarjeta desaparece al contestar.
--   5 · los estados de Meta: entregado, leído y fallido.
--   6 · fuera del radio y la precisión (la 1934): fichar_con_precision guarda la
--       precisión; con más de 100 m es «ubicación aproximada» (ni dentro ni
--       fuera, no bloquea); solo avisa al encargado la precisa fuera del
--       radio; sin precisión (el front de antes), fuera pero sin aviso; quién
--       lee los avisos; y fichar() de siempre sigue fichando, sin precisión.
--   7 · el vigía: sin el cron del envío, lo dice (staging no lo tiene); un
--       fallo de la empresa avisa una vez al día; el de una persona, no; lo
--       atascado, también; y en palabras de oficina.
--   8 · la vuelta atrás: las huellas de antes (fichar con sus permisos) y nada
--       de lo nuevo.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L1A3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261028T1934_l1a3_fichar_con_precision') as l1a3_c_aplicada \gset
\if :l1a3_c_aplicada
\i supabase/vuelta-atras/20261028T1934_l1a3_fichar_con_precision.down.sql
\endif
select exists (select 1 from public.funcion_respaldo where migracion = '20261028T1801_l1a3_olvido_detectar_en_madrid') as l1a3_b_aplicada \gset
\if :l1a3_b_aplicada
\i supabase/vuelta-atras/20261028T1801_l1a3_olvido_detectar_en_madrid.down.sql
\endif
select to_regprocedure('public.avisos_olvido_debidos(timestamptz)') is not null as l1a3_a_aplicada \gset
\if :l1a3_a_aplicada
\i supabase/vuelta-atras/20261028T1800_l1a3_avisos_olvido_radio_vigia.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('centro', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('trabajador', 'c01a0000-0000-4000-8000-0000000000a7'), ('admin_b', 'c01b0000-0000-4000-8000-0000000000b1');
insert into _s select 'huella', md5(pg_get_functiondef('public.enqueue_clockout_reminders()'::regprocedure));
insert into _s select 'huella_fichar', md5(pg_get_functiondef(to_regprocedure('public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)')));

do $$ begin
  if to_regclass('public.aviso_empresa') is not null or to_regclass('public.whatsapp_entrada') is not null
     or exists (select 1 from pg_trigger where tgname = 'trg_fichaje_fuera_del_radio') then
    raise exception 'PRUEBA L1A3 · 0: ya hay cosas de la 1800 antes de aplicarla.';
  end if;
  raise notice '0 · lo de antes: enqueue_clockout_reminders medida y nada de la 1800';
end $$;

-- El miércoles inventado: el cuadrante y las personas.
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
        centro uuid := (select v::uuid from _s where clave = 'centro');
        t_m uuid; t_n uuid; p record;
        d date := date '2026-10-21';
        h timestamp := timestamp '2026-10-21 00:00';
begin
  update public.locations set lat = 40.4168, lng = -3.7038, clock_geofence_mode = 'warn', clock_radius_m = 200 where id = centro;
  delete from public.schedules where location_id = centro and week_start = date '2026-10-19';
  insert into public.shift_templates (account_id, location_id, label, start_time, end_time)
  values (a, centro, 'Mañana prueba L1a3', '10:00', '17:00') returning id into t_m;
  insert into public.shift_templates (account_id, location_id, label, start_time, end_time)
  values (a, centro, 'Noche prueba L1a3', '20:00', '00:00') returning id into t_n;
  insert into _s values ('t_m', t_m), ('t_n', t_n);

  for p in select * from (values
      ('marcos',   'Marcos Prueba L1a3',   '+34 600 000 001', true),
      ('cumple',   'Cumple Prueba L1a3',   '600000002', true),
      ('tarde',    'Tarde Prueba L1a3',    '600000003', true),
      ('noche',    'Noche Prueba L1a3',    '600000004', true),
      ('sintel',   'Sintel Prueba L1a3',   null, true),
      ('sinturno', 'Sinturno Prueba L1a3', '600000006', true),
      ('renuncia', 'Renuncia Prueba L1a3', '600000007', false),
      ('portal',   'Portal Prueba L1a3',   '600000008', true),
      ('lejos',    'Lejos Prueba L1a3',    '600000009', true)) x(clave, nombre, tel, quiere)
  loop
    with e as (
      insert into public.employees (name, location_id, account_id, "position", salary, phone, forgot_clockout_reminder, active)
      values (p.nombre, centro, a, 'Sala', 1200, p.tel, p.quiere, true) returning id)
    insert into _s select p.clave, e.id from e;
  end loop;

  insert into public.schedules (account_id, location_id, week_start, status, published_at, cells)
  values (a, centro, date '2026-10-19', 'published', now(), jsonb_build_object(
    t_m::text, jsonb_build_object('2', (select jsonb_agg(v) from _s where clave in ('marcos', 'cumple', 'tarde', 'sintel', 'renuncia', 'portal'))),
    t_n::text, jsonb_build_object('2', (select jsonb_agg(v) from _s where clave = 'noche'))));

  -- Los fichajes (hora de Madrid).
  insert into public.clock_entries (employee_id, account_id, type, datetime, real_datetime, source, location_id_at_clock, created_at)
  select (select v::uuid from _s where clave = x.quien), a, x.tipo,
         x.hora::timestamp at time zone 'Europe/Madrid', x.hora::timestamp at time zone 'Europe/Madrid', 'movil', centro,
         x.hora::timestamp at time zone 'Europe/Madrid'
    from (values ('marcos', 'entrada', '2026-10-21 09:58'),
                 ('cumple', 'entrada', '2026-10-21 09:55'), ('cumple', 'salida', '2026-10-21 17:10'),
                 ('tarde', 'entrada', '2026-10-21 10:02'),
                 ('noche', 'entrada', '2026-10-21 19:58'),
                 ('sintel', 'entrada', '2026-10-21 10:00'),
                 ('sinturno', 'entrada', '2026-10-21 06:00'),
                 ('renuncia', 'entrada', '2026-10-21 10:01'),
                 ('portal', 'entrada', '2026-10-21 09:59')) x(quien, tipo, hora);
  update public.user_profiles set employee_id = (select v::uuid from _s where clave = 'portal')
   where user_id = (select v::uuid from _s where clave = 'trabajador') and account_id = a;
  insert into public.manager_locations (user_profile_id, location_id)
  select up.id, centro from public.user_profiles up
   where up.user_id = (select v::uuid from _s where clave = 'encargado') and up.account_id = a
     and not exists (select 1 from public.manager_locations ml where ml.user_profile_id = up.id and ml.location_id = centro);
end $$;
set constraints all immediate;

\i supabase/migrations/20261028T1800_l1a3_avisos_olvido_radio_vigia.sql
-- La 1800 se puede pasar dos veces (W05: desde la rama va de verdad).
\i supabase/migrations/20261028T1800_l1a3_avisos_olvido_radio_vigia.sql
\i supabase/migrations/20261028T1801_l1a3_olvido_detectar_en_madrid.sql
\i supabase/migrations/20261028T1934_l1a3_fichar_con_precision.sql

-- Lo que hace enqueue_clockout_reminders, con la hora de la prueba.
create temp table _encolar (ahora timestamptz) on commit drop;
create or replace function pg_temp.encolar(p_ahora timestamptz) returns integer language plpgsql as $f$
declare n integer;
begin
  insert into public.clockout_reminder_log (account_id, employee_id, clock_entry_id, location_id, to_phone, scheduled_end,
    entrada_at, inicio_turno, fin_turno, salta_at, canal, status, skip_reason)
  select d.account_id, d.employee_id, d.clock_entry_id, d.location_id, d.to_phone, to_char(d.fin_turno at time zone 'Europe/Madrid', 'HH24:MI'),
         d.entrada_at, d.inicio_turno, d.fin_turno, d.salta_at, d.canal, d.status, d.skip_reason
    from public.avisos_olvido_debidos(p_ahora) d
   where d.employee_id in (select v::uuid from _s where clave in ('marcos','cumple','tarde','noche','sintel','sinturno','renuncia','portal','lejos'))
  on conflict (clock_entry_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;
create or replace function pg_temp.aviso(p_quien text) returns public.clockout_reminder_log language sql as $f$
  select l.* from public.clockout_reminder_log l where l.employee_id = (select v::uuid from _s where clave = p_quien);
$f$;

-- ── 1 · La detección ────────────────────────────────────────────────────────
do $$
declare n integer; r public.clockout_reminder_log;
begin
  -- 17:20: nadie (el turno de mañana acabó a las 17:00 y el margen es de 30 min).
  n := pg_temp.encolar(timestamp '2026-10-21 17:20' at time zone 'Europe/Madrid');
  if n <> 0 then raise exception 'PRUEBA L1A3 · 1: a las 17:20 ya avisa a % (el margen es de 30 min).', n; end if;
  -- 17:35: marcos (WhatsApp), tarde (WhatsApp), sintel y renuncia (portal), portal (WhatsApp). cumple, no.
  n := pg_temp.encolar(timestamp '2026-10-21 17:35' at time zone 'Europe/Madrid');
  if n <> 5 then raise exception 'PRUEBA L1A3 · 1: a las 17:35 tenían que ser 5 avisos y son %.', n; end if;
  r := pg_temp.aviso('marcos');
  if r.status <> 'queued' or r.canal <> 'whatsapp' or r.scheduled_end <> '17:00'
     or r.fin_turno <> timestamp '2026-10-21 17:00' at time zone 'Europe/Madrid'
     or r.salta_at <> timestamp '2026-10-21 17:30' at time zone 'Europe/Madrid' then
    raise exception 'PRUEBA L1A3 · 1: el aviso de marcos no es el esperado: % % % %.', r.status, r.canal, r.scheduled_end, r.salta_at;
  end if;
  if (pg_temp.aviso('cumple')).id is not null then
    raise exception 'PRUEBA L1A3 · 1: avisa a quien ya fichó la salida (el fallo de los 48).';
  end if;
  r := pg_temp.aviso('sintel');
  if r.status <> 'skipped' or r.canal <> 'portal' or r.skip_reason <> 'sin_telefono' then
    raise exception 'PRUEBA L1A3 · 1: sin teléfono no va al portal (% % %).', r.status, r.canal, r.skip_reason;
  end if;
  r := pg_temp.aviso('renuncia');
  if r.canal <> 'portal' or r.skip_reason <> 'no_quiere_whatsapp' then
    raise exception 'PRUEBA L1A3 · 1: quien no quiere el WhatsApp lo recibe (% %).', r.canal, r.skip_reason;
  end if;
  -- 18:05: sinturno (12 h después de las 06:00). Y una por entrada: marcos no repite.
  n := pg_temp.encolar(timestamp '2026-10-21 18:05' at time zone 'Europe/Madrid');
  if n <> 1 then raise exception 'PRUEBA L1A3 · 1: a las 18:05 tenía que ser solo el de sinturno, y son %.', n; end if;
  r := pg_temp.aviso('sinturno');
  if r.fin_turno is not null or r.canal <> 'whatsapp' or r.salta_at <> timestamp '2026-10-21 18:00' at time zone 'Europe/Madrid' then
    raise exception 'PRUEBA L1A3 · 1: sin turno no avisa a las 12 h (% %).', r.fin_turno, r.salta_at;
  end if;
  -- 00:35 del jueves: noche, fuera de la franja (08:00–22:00) → solo portal.
  n := pg_temp.encolar(timestamp '2026-10-22 00:35' at time zone 'Europe/Madrid');
  r := pg_temp.aviso('noche');
  if n <> 1 or r.canal <> 'portal' or r.skip_reason <> 'fuera_de_hora'
     or r.fin_turno <> timestamp '2026-10-22 00:00' at time zone 'Europe/Madrid' then
    raise exception 'PRUEBA L1A3 · 1: el turno de noche no va al portal a las 00:35 (n % · % % %).', n, r.canal, r.skip_reason, r.fin_turno;
  end if;
  -- Y enqueue_clockout_reminders corre (con la hora de verdad: estas entradas ya son viejas).
  perform public.enqueue_clockout_reminders();
  raise notice '1 · la detección: 17:20 nadie; 17:35 cinco (cumple no); 18:05 sinturno; 00:35 noche al portal';
end $$;

-- ── 2 · La cola ─────────────────────────────────────────────────────────────
do $$
declare n integer; r public.clockout_reminder_log; v_ids uuid[];
begin
  -- tarde fichó la salida a las 17:40, antes de que saliera el WhatsApp.
  insert into public.clock_entries (employee_id, account_id, type, datetime, real_datetime, source, location_id_at_clock, created_at)
  values ((select v::uuid from _s where clave = 'tarde'), (select v::uuid from _s where clave = 'cuenta'), 'salida',
          timestamp '2026-10-21 17:40' at time zone 'Europe/Madrid', timestamp '2026-10-21 17:40' at time zone 'Europe/Madrid', 'movil',
          (select v::uuid from _s where clave = 'centro'), timestamp '2026-10-21 17:40' at time zone 'Europe/Madrid');
  select array_agg(c.id) into v_ids from public.aviso_olvido_cola(500, timestamp '2026-10-21 17:45' at time zone 'Europe/Madrid') c;
  if (pg_temp.aviso('tarde')).skip_reason is distinct from 'ya_fichada' or (pg_temp.aviso('tarde')).id = any (v_ids) then
    raise exception 'PRUEBA L1A3 · 2: la cola manda el aviso de quien ya fichó la salida.';
  end if;
  if not ((pg_temp.aviso('marcos')).id = any (v_ids)) then
    raise exception 'PRUEBA L1A3 · 2: la cola no manda el de marcos.';
  end if;
  if (select c.fin_hora || ' ' || c.nombre || ' ' || c.local_nombre from public.aviso_olvido_cola(500, timestamp '2026-10-21 17:46' at time zone 'Europe/Madrid') c
       where c.id = (pg_temp.aviso('marcos')).id) is distinct from '17:00 Marcos Norte Centro' then
    raise exception 'PRUEBA L1A3 · 2: el mensaje de marcos no dice «Marcos», «Norte Centro» y «17:00».';
  end if;
  -- A las 22:05 ya no sale: pasa al portal (sinturno).
  perform public.aviso_olvido_cola(500, timestamp '2026-10-21 22:05' at time zone 'Europe/Madrid');
  r := pg_temp.aviso('sinturno');
  if r.status <> 'skipped' or r.canal <> 'portal' or r.skip_reason <> 'fuera_de_hora' then
    raise exception 'PRUEBA L1A3 · 2: a las 22:05 la cola todavía manda (% % %).', r.status, r.canal, r.skip_reason;
  end if;
  raise notice '2 · la cola: lo ya fichado no sale; a las 22:05, al portal';
end $$;

-- ── 3 · Contestar por WhatsApp ─────────────────────────────────────────────
update public.clockout_reminder_log set status = 'sent', provider_message_id = 'wamid.prueba.marcos', sent_at = now()
 where id = (pg_temp.aviso('marcos')).id;
do $$
declare j jsonb; l public.clockout_reminder_log; v_marcas integer; pet public.clock_correction_request;
        marcos uuid := (select v::uuid from _s where clave = 'marcos');
begin
  select count(*) into v_marcas from public.clock_entries where employee_id = marcos;
  l := pg_temp.aviso('marcos');
  j := public.responder_aviso_olvido_whatsapp(l.id, 'a_su_hora', '34600000099', 'wamid.prueba.marcos');
  if j->>'resultado' <> 'otro_telefono' then raise exception 'PRUEBA L1A3 · 3: contesta otro teléfono y vale (%).', j; end if;
  j := public.responder_aviso_olvido_whatsapp(l.id, 'a_su_hora', '34600000001', 'wamid.otro');
  if j->>'resultado' <> 'otro_mensaje' then raise exception 'PRUEBA L1A3 · 3: contesta a otro mensaje y vale (%).', j; end if;
  j := public.responder_aviso_olvido_whatsapp(l.id, 'a_su_hora', '34600000001', 'wamid.prueba.marcos');
  if j->>'resultado' <> 'peticion' or j->>'hora' <> '17:00' then raise exception 'PRUEBA L1A3 · 3: «Salí a esa hora» no crea la petición (%).', j; end if;
  select * into pet from public.clock_correction_request where id = (j->>'peticion_id')::uuid;
  if pet.status <> 'pending' or pet.kind <> 'add' or pet.proposed_type <> 'salida'
     or pet.proposed_datetime <> timestamp '2026-10-21 17:00' at time zone 'Europe/Madrid'
     or pet.requested_by_employee_id <> marcos or pet.reason not like 'Respuesta al aviso de olvido (WhatsApp)%' then
    raise exception 'PRUEBA L1A3 · 3: la petición no es la esperada (% % % %).', pet.status, pet.kind, pet.proposed_datetime, pet.reason;
  end if;
  if (select count(*) from public.clock_entries where employee_id = marcos) <> v_marcas then
    raise exception 'PRUEBA L1A3 · 3: la respuesta escribe un fichaje.';
  end if;
  if not exists (select 1 from public.clock_entry_audit a where a.peticion_id = pet.id and a.action = 'request' and a.actor_employee_id = marcos) then
    raise exception 'PRUEBA L1A3 · 3: la petición no deja rastro.';
  end if;
  j := public.responder_aviso_olvido_whatsapp(l.id, 'a_su_hora', '+34 600 000 001', 'wamid.prueba.marcos');
  if j->>'resultado' <> 'ya_respondida' or (select count(*) from public.clock_correction_request where employee_id = marcos) <> 1 then
    raise exception 'PRUEBA L1A3 · 3: contestar dos veces crea dos peticiones (%).', j;
  end if;
  -- «Sigo trabajando»: apuntado y sin petición.
  j := public.responder_aviso_olvido_whatsapp((pg_temp.aviso('renuncia')).id, 'sigo', '600000007');
  if j->>'resultado' <> 'apuntado' or (pg_temp.aviso('renuncia')).correction_request_id is not null then
    raise exception 'PRUEBA L1A3 · 3: «Sigo trabajando» no queda apuntado (%).', j;
  end if;
  -- «Otra hora» por WhatsApp: la hora la pone en el portal.
  j := public.responder_aviso_olvido_whatsapp((pg_temp.aviso('noche')).id, 'otra_hora', '600000004');
  if j->>'resultado' <> 'pide_hora' or (pg_temp.aviso('noche')).respuesta <> 'otra_hora' then
    raise exception 'PRUEBA L1A3 · 3: «Otra hora» no pide la hora (%).', j;
  end if;
  -- Lo ya fichado: nada.
  j := public.responder_aviso_olvido_whatsapp((pg_temp.aviso('tarde')).id, 'a_su_hora', '600000003');
  if j->>'resultado' <> 'ya_fichada' or (pg_temp.aviso('tarde')).correction_request_id is not null then
    raise exception 'PRUEBA L1A3 · 3: contestar algo ya fichado crea una petición (%).', j;
  end if;
  -- Una respuesta que no existe.
  begin
    perform public.responder_aviso_olvido_whatsapp(l.id, 'borrar', '600000001');
    raise exception 'PRUEBA L1A3 · 3: acepta una respuesta inventada.';
  exception when invalid_parameter_value then null; end;
  raise notice '3 · WhatsApp: teléfono y mensaje cuadran; «Salí a esa hora» crea la petición (17:00) sin fichaje, una vez; sigo y otra hora no';
end $$;

-- Desde fuera, nada de esto se puede llamar.
set local role authenticated;
do $$ begin
  begin
    perform public.responder_aviso_olvido_whatsapp((select l.id from public.clockout_reminder_log l limit 1), 'sigo', '600000001');
    raise exception 'PRUEBA L1A3 · 3: un usuario llama a la respuesta del webhook.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.avisos_olvido_debidos(now());
    raise exception 'PRUEBA L1A3 · 3: un usuario llama a la detección.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vigia_avisos_olvido(true);
    raise exception 'PRUEBA L1A3 · 3: un usuario llama al vigía.';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.whatsapp_entrada;
    raise exception 'PRUEBA L1A3 · 3: un usuario lee lo que llega de Meta.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── 4 · Contestar en el portal ─────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true) \gset _
set local role authenticated;
do $$
declare j jsonb; n integer; v_log uuid;
begin
  select count(*), (array_agg(m.id))[1] into n, v_log from public.mis_avisos_olvido() m;
  if n <> 1 then raise exception 'PRUEBA L1A3 · 4: el portal enseña % tarjetas y era 1.', n; end if;
  if (select m.local_nombre || ' ' || to_char(m.fin_turno at time zone 'Europe/Madrid', 'HH24:MI') from public.mis_avisos_olvido() m) <> 'Norte Centro 17:00' then
    raise exception 'PRUEBA L1A3 · 4: la tarjeta no dice el local y la hora del turno.';
  end if;
  begin
    perform public.responder_aviso_olvido((select id from public.clockout_reminder_log where employee_id = (select v::uuid from _s where clave = 'renuncia')), 'sigo');
    raise exception 'PRUEBA L1A3 · 4: contesta el aviso de otra persona.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.responder_aviso_olvido(v_log, 'otra_hora', null);
    raise exception 'PRUEBA L1A3 · 4: «Otra hora» sin hora vale.';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.responder_aviso_olvido(v_log, 'otra_hora', timestamp '2026-10-21 09:00' at time zone 'Europe/Madrid');
    raise exception 'PRUEBA L1A3 · 4: una salida antes de la entrada vale.';
  exception when invalid_parameter_value then null; end;
  insert into _s values ('log_portal', v_log);
end $$;
-- Una entrada anulada no pide nada (ni tarjeta ni petición): se anula y se devuelve.
reset role;
update public.clock_entries set voided = true
 where id = (select clock_entry_id from public.clockout_reminder_log where id = (select v::uuid from _s where clave = 'log_portal'));
set local role authenticated;
do $$ begin
  if exists (select 1 from public.mis_avisos_olvido()) then raise exception 'PRUEBA L1A3 · 4: la tarjeta sale con la entrada anulada.'; end if;
  if (public.responder_aviso_olvido((select v::uuid from _s where clave = 'log_portal'), 'a_su_hora'))->>'resultado' <> 'anulada' then
    raise exception 'PRUEBA L1A3 · 4: contestar una entrada anulada no lo dice.';
  end if;
end $$;
reset role;
update public.clock_entries set voided = false
 where id = (select clock_entry_id from public.clockout_reminder_log where id = (select v::uuid from _s where clave = 'log_portal'));
set local role authenticated;
do $$
declare j jsonb; v_log uuid := (select v::uuid from _s where clave = 'log_portal');
begin
  j := public.responder_aviso_olvido(v_log, 'otra_hora', timestamp '2026-10-21 16:45' at time zone 'Europe/Madrid');
  if j->>'resultado' <> 'peticion' or j->>'hora' <> '16:45' then raise exception 'PRUEBA L1A3 · 4: «Otra hora» no crea la petición (%).', j; end if;
  if exists (select 1 from public.mis_avisos_olvido()) then raise exception 'PRUEBA L1A3 · 4: la tarjeta sigue después de contestar.'; end if;
  raise notice '4 · portal: una tarjeta (Norte Centro, 17:00); solo lo suyo; anulada, nada; «Otra hora» pide la hora y crea la petición (16:45)';
end $$;
reset role;
select set_config('request.jwt.claims', '', true) \gset _

-- ── 5 · Los estados de Meta ────────────────────────────────────────────────
do $$ begin
  if not public.whatsapp_estado('wamid.prueba.marcos', 'delivered', timestamp '2026-10-21 17:41' at time zone 'Europe/Madrid') then
    raise exception 'PRUEBA L1A3 · 5: no encuentra el mensaje por su wamid.';
  end if;
  perform public.whatsapp_estado('wamid.prueba.marcos', 'read', timestamp '2026-10-21 17:50' at time zone 'Europe/Madrid');
  if (pg_temp.aviso('marcos')).entregado_at is null or (pg_temp.aviso('marcos')).leido_at is null then
    raise exception 'PRUEBA L1A3 · 5: no apunta entregado y leído.';
  end if;
  if public.whatsapp_estado('wamid.que.no.existe', 'read') then raise exception 'PRUEBA L1A3 · 5: encuentra un mensaje que no existe.'; end if;
  raise notice '5 · estados: entregado y leído apuntados';
end $$;

-- ── 6 · Fuera del radio y la ubicación aproximada, fichando con fichar() ───
-- El usuario «trabajador» pasa a ser «lejos» y ficha desde el móvil. Las
-- horas, como sin cobertura (p_hora_declarada), para separarlas una hora.
-- Norte Centro está en (40.4168, -3.7038), radio 200 m.
reset role;
update public.user_profiles set employee_id = (select v::uuid from _s where clave = 'lejos')
 where user_id = (select v::uuid from _s where clave = 'trabajador') and account_id = (select v::uuid from _s where clave = 'cuenta');
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true) \gset _
set local role authenticated;
do $$
declare lejos uuid := (select v::uuid from _s where clave = 'lejos'); centro uuid := (select v::uuid from _s where clave = 'centro');
        r jsonb;
begin
  -- 1 · Precisa (12 m) y a 670 m: fuera del radio, con aviso.
  r := public.fichar_con_precision(lejos, 'entrada', 'movil', centro, 40.4228, -3.7038, p_hora_declarada => now() - interval '10 hours', p_precision_m => 12);
  if (r->>'dentro_del_radio')::boolean is distinct from false or (r->>'ubicacion_aproximada')::boolean or (r->>'precision_m')::int <> 12 then
    raise exception 'PRUEBA L1A3 · 6: una ubicación precisa a 670 m no sale fuera del radio (%).', r;
  end if;
  insert into _s values ('m_precisa', r->>'id');
  -- 2 · Aproximada (1.500 m de precisión), en el mismo punto: ni dentro ni fuera.
  r := public.fichar_con_precision(lejos, 'salida', 'movil', centro, 40.4228, -3.7038, p_hora_declarada => now() - interval '9 hours', p_precision_m => 1500);
  if r->>'dentro_del_radio' is not null or not (r->>'ubicacion_aproximada')::boolean or (r->>'distancia_m')::int not between 660 and 680 then
    raise exception 'PRUEBA L1A3 · 6: una ubicación aproximada cuenta como dentro o fuera (%).', r;
  end if;
  insert into _s values ('m_aproximada', r->>'id');
  -- 3 · Precisa y dentro: nada.
  r := public.fichar_con_precision(lejos, 'entrada', 'movil', centro, 40.4169, -3.7038, p_hora_declarada => now() - interval '8 hours', p_precision_m => 5);
  if not (r->>'dentro_del_radio')::boolean then raise exception 'PRUEBA L1A3 · 6: a 11 m con 5 m de precisión no sale dentro (%).', r; end if;
  -- 4 · fichar() de siempre (el front de antes, sin precisión) y fuera: fuera del radio, pero sin aviso.
  r := public.fichar(lejos, 'salida', 'movil', centro, 40.4357, -3.7038, p_hora_declarada => now() - interval '7 hours');
  if (r->>'dentro_del_radio')::boolean is distinct from false or r->>'precision_m' is not null then
    raise exception 'PRUEBA L1A3 · 6: sin precisión no se guarda como antes (%).', r;
  end if;
  insert into _s values ('m_sin_precision', r->>'id');
end $$;
-- 5 · El local en «bloquear»: una ubicación aproximada no bloquea; una precisa fuera, sí.
reset role;
update public.locations set clock_geofence_mode = 'block' where id = (select v::uuid from _s where clave = 'centro');
set local role authenticated;
do $$
declare lejos uuid := (select v::uuid from _s where clave = 'lejos'); centro uuid := (select v::uuid from _s where clave = 'centro'); r jsonb;
begin
  begin
    perform public.fichar_con_precision(lejos, 'entrada', 'movil', centro, 40.4357, -3.7038, p_hora_declarada => now() - interval '6 hours', p_precision_m => 20);
    raise exception 'PRUEBA L1A3 · 6: en «bloquear», una ubicación precisa a 2,1 km ficha.';
  exception when insufficient_privilege then
    if sqlerrm not like 'FUERA_DE_ZONA%' then raise; end if;
  end;
  r := public.fichar_con_precision(lejos, 'entrada', 'movil', centro, 40.4357, -3.7038, p_hora_declarada => now() - interval '5 hours', p_precision_m => 2000);
  if not (r->>'ubicacion_aproximada')::boolean then raise exception 'PRUEBA L1A3 · 6: en «bloquear», la aproximada no ficha como aproximada (%).', r; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true) \gset _
update public.locations set clock_geofence_mode = 'warn' where id = (select v::uuid from _s where clave = 'centro');
do $$
declare lejos uuid := (select v::uuid from _s where clave = 'lejos'); n integer; t text;
begin
  select count(*), min(texto) into n, t from public.aviso_empresa where employee_id = lejos and tipo = 'fuera_del_radio';
  if n <> 1 or not exists (select 1 from public.aviso_empresa where clock_entry_id = (select v::uuid from _s where clave = 'm_precisa')) then
    raise exception 'PRUEBA L1A3 · 6: tenía que avisar solo de la precisa fuera del radio, y hay % avisos: %.', n,
      (select string_agg(texto, ' | ') from public.aviso_empresa where employee_id = lejos);
  end if;
  if t not like '%a 66_ m de Norte Centro (el radio es de 200 m; el móvil daba la ubicación con una precisión de 12 m)%' then
    raise exception 'PRUEBA L1A3 · 6: el aviso no lo dice en palabras: %', t;
  end if;
  if (select precision_m from public.clock_entries where id = (select v::uuid from _s where clave = 'm_aproximada')) <> 1500
     or (select within_radius from public.clock_entries where id = (select v::uuid from _s where clave = 'm_aproximada')) is not null then
    raise exception 'PRUEBA L1A3 · 6: la marca aproximada no guarda su precisión, o dice dentro o fuera.';
  end if;
  -- Y un disparador que falla nunca rompe el fichaje: lo prueba el «exception» de la función.
  insert into _s values ('aviso_radio', (select id from public.aviso_empresa where employee_id = lejos limit 1));
  raise notice '6 · fuera del radio: solo la precisa (12 m) avisa: «%»; la aproximada (1.500 m), ni dentro ni fuera y sin aviso; sin precisión, fuera y sin aviso; en «bloquear», la aproximada ficha y la precisa fuera no', t;
end $$;
-- Lo leen el administrador y el encargado del local; el trabajador y la otra cuenta, no.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true) \gset _
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.aviso_empresa where id = (select v::uuid from _s where clave = 'aviso_radio')) then
    raise exception 'PRUEBA L1A3 · 6: el encargado del local no ve el aviso.';
  end if;
  begin
    insert into public.aviso_empresa(account_id, tipo, clave, titulo, texto) values ((select v::uuid from _s where clave = 'cuenta'), 'fuera_del_radio', 'x', 'x', 'x');
    raise exception 'PRUEBA L1A3 · 6: el encargado escribe avisos.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true) \gset _
set local role authenticated;
do $$ begin
  if exists (select 1 from public.aviso_empresa) then raise exception 'PRUEBA L1A3 · 6: el trabajador ve los avisos de la empresa.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_b'), 'role', 'authenticated')::text, true) \gset _
set local role authenticated;
do $$ begin
  if exists (select 1 from public.aviso_empresa where account_id = (select v::uuid from _s where clave = 'cuenta')) then
    raise exception 'PRUEBA L1A3 · 6: otra cuenta ve los avisos.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true) \gset _
do $$ begin
  if not exists (select 1 from public.avisos_empresa_por_enviar(500) x where x.id = (select v::uuid from _s where clave = 'aviso_radio')) then
    raise exception 'PRUEBA L1A3 · 6: el aviso no queda para el correo.';
  end if;
end $$;

-- ── 7 · El vigía ───────────────────────────────────────────────────────────
do $$
declare j jsonb; a uuid := (select v::uuid from _s where clave = 'cuenta'); n integer; t text; v_hay_cron boolean;
        ahora timestamptz := timestamp '2026-10-21 18:30' at time zone 'Europe/Madrid';
begin
  -- Las palabras.
  select w.texto into t from public.whatsapp_error_en_palabras('{"message":"(#132001) Template name does not exist in the translation","type":"OAuthException","code":132001}') w;
  if t not like 'La plantilla de WhatsApp no existe en Meta%' then raise exception 'PRUEBA L1A3 · 7: el 132001 no se dice en palabras (%).', t; end if;
  if (select w.de_empresa from public.whatsapp_error_en_palabras('{"code":131026,"message":"Message undeliverable"}') w) then
    raise exception 'PRUEBA L1A3 · 7: un número sin WhatsApp cuenta como fallo de la empresa.';
  end if;
  -- Los avisos de la prueba son «de hoy» para el vigía: se mueven a esa mañana.
  update public.clockout_reminder_log set created_at = ahora - interval '1 hour', status = 'sent'
   where employee_id in (select v::uuid from _s where clave in ('marcos','tarde','noche','sintel','sinturno','renuncia','portal'));
  -- Sin el cron del envío (staging no lo tiene: es de producción), el vigía lo
  -- dice; y se programa aquí, dentro de la transacción, para lo que sigue.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select exists (select 1 from cron.job where jobname = 'clockout-reminder-drain' and active)$q$ into v_hay_cron;
    if not v_hay_cron then
      j := public.vigia_avisos_olvido(true, ahora);
      if (j->>'cron')::boolean or j->'avisos'->0->>'texto' not like 'El envío de los avisos de olvido por WhatsApp no está programado%' then
        raise exception 'PRUEBA L1A3 · 7: sin el cron del envío, el vigía no lo dice (%).', j;
      end if;
      execute $q$select cron.schedule('clockout-reminder-drain', '*/10 * * * *', 'select 1')$q$;
    end if;
  end if;
  -- Un fallo de una persona: nada.
  update public.clockout_reminder_log set status = 'failed', error = '{"code":131026,"message":"Message undeliverable"}'
   where id = (pg_temp.aviso('tarde')).id;
  j := public.vigia_avisos_olvido(false, ahora);
  if exists (select 1 from public.aviso_empresa where account_id = a and tipo = 'avisos_olvido_fallan') then
    raise exception 'PRUEBA L1A3 · 7: un número sin WhatsApp avisa a la empresa (%).', j;
  end if;
  -- Un fallo de la empresa: aviso, una vez al día.
  update public.clockout_reminder_log set status = 'failed', error = '{"message":"(#132001) Template name does not exist","code":132001}'
   where id = (pg_temp.aviso('marcos')).id;
  perform public.vigia_avisos_olvido(false, ahora);
  perform public.vigia_avisos_olvido(false, ahora + interval '15 minutes');
  select count(*), min(texto) into n, t from public.aviso_empresa where account_id = a and tipo = 'avisos_olvido_fallan';
  if n <> 1 then raise exception 'PRUEBA L1A3 · 7: el fallo de la empresa avisa % veces (y era 1).', n; end if;
  if t not like 'Hoy no ha salido 1 aviso de olvido por WhatsApp. El motivo: La plantilla de WhatsApp no existe en Meta%' then
    raise exception 'PRUEBA L1A3 · 7: el aviso no lo dice en palabras: %', t;
  end if;
  if not exists (select 1 from public.system_alert_queue where kind = 'avisos_olvido') then
    raise exception 'PRUEBA L1A3 · 7: el fallo no llega a sistema.';
  end if;
  -- Lo atascado: el día siguiente, un aviso que lleva 40 min en cola.
  update public.clockout_reminder_log set status = 'queued', error = null, created_at = ahora + interval '1 day' - interval '40 minutes'
   where id = (pg_temp.aviso('marcos')).id;
  j := public.vigia_avisos_olvido(true, ahora + interval '1 day');
  if jsonb_array_length(j->'avisos') < 1 or (j->'avisos'->0->>'atascados')::int <> 1 then
    raise exception 'PRUEBA L1A3 · 7: lo atascado no avisa (%).', j;
  end if;
  raise notice '7 · vigía: «%»', t;
end $$;

-- ── 8 · La vuelta atrás ────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T1934_l1a3_fichar_con_precision.down.sql
\i supabase/vuelta-atras/20261028T1801_l1a3_olvido_detectar_en_madrid.down.sql
\i supabase/vuelta-atras/20261028T1800_l1a3_avisos_olvido_radio_vigia.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.enqueue_clockout_reminders()'::regprocedure)) <> (select v from _s where clave = 'huella') then
    raise exception 'PRUEBA L1A3 · 8: la vuelta atrás no deja enqueue_clockout_reminders como estaba.';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)')))
       is distinct from (select v from _s where clave = 'huella_fichar')
     or (select count(*) from pg_proc where proname = 'fichar' and pronamespace = 'public'::regnamespace) <> 1
     or exists (select 1 from pg_proc where proname = 'fichar_con_precision' and pronamespace = 'public'::regnamespace)
     or not has_function_privilege('authenticated', 'public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)', 'EXECUTE') then
    raise exception 'PRUEBA L1A3 · 8: la vuelta atrás no deja fichar() como estaba (una sola firma, su huella y sus permisos).';
  end if;
  if to_regclass('public.aviso_empresa') is not null or to_regclass('public.whatsapp_entrada') is not null
     or to_regprocedure('public.avisos_olvido_debidos(timestamptz)') is not null
     or exists (select 1 from pg_trigger where tgname = 'trg_fichaje_fuera_del_radio')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clockout_reminder_log' and column_name = 'canal')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = 'aviso_olvido_hasta')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clock_entries' and column_name = 'precision_m') then
    raise exception 'PRUEBA L1A3 · 8: la vuelta atrás deja cosas de la 1800.';
  end if;
  raise notice '8 · vuelta atrás: enqueue_clockout_reminders y fichar() con su huella (fichar, una firma y sus permisos; sin fichar_con_precision) y nada de la 1800';
end $$;

rollback;
