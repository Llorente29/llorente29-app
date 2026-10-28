-- supabase/migrations/20261028T1800_l1a3_avisos_olvido_radio_vigia.sql
--
-- L1a · PR 3 · Los avisos que avisan (28/10/2026). Primera de dos: SOLO AÑADE
-- (tablas, columnas que admiten nulos, funciones y el cron del vigía). La
-- segunda (1801) cambia: la detección vieja usa esta, los CHECK de las
-- columnas nuevas y el disparador de fuera del radio en clock_entries.
--
--   1 · La detección nueva del olvido, en hora de Madrid
--       (avisos_olvido_debidos): una entrada abierta —nada fichado después—
--       con un turno publicado que acabó hace más del margen
--       (forgot_clockout_min, 30 min); sin turno, a las 12 h de la entrada.
--       Una por entrada. El WhatsApp sale solo dentro de la franja de la
--       empresa (aviso_olvido_desde / aviso_olvido_hasta, 08:00–22:00 si no
--       dice nada) y en la primera hora; si no, solo el portal.
--   2 · La cola del envío (aviso_olvido_cola): antes de mandar, vuelve a
--       mirar que la entrada sigue abierta y que la hora sigue valiendo.
--   3 · La respuesta en un toque (responder_aviso_olvido_whatsapp, desde el
--       webhook, y responder_aviso_olvido, desde el portal): «Salí a esa hora»
--       u «Otra hora» crean una PETICIÓN de corrección para el encargado.
--       Nunca escriben el fichaje.
--   4 · Lo que llega del webhook (whatsapp_entrada): todo, también lo
--       rechazado por firma; y los estados de entrega (whatsapp_estado).
--   5 · Los avisos a la empresa (aviso_empresa): un fichaje fuera del radio
--       con una ubicación precisa (precision_m de 100 m o menos; la columna
--       es de aquí, el disparador lo pone la 1801 y la precisión la rellena
--       fichar() desde la 1802), y que los avisos de olvido dejan de salir. Los lee «Equipo» y
--       salen por correo (la función de borde clockout-reminder).
--   6 · El vigía (vigia_avisos_olvido, cron cada 15 min): detecta él mismo
--       (no depende de la función de borde) y avisa a la empresa el mismo día
--       si los envíos fallan por algo de la empresa o se quedan en cola.
--
-- No toca el camino del pedido. Se puede pasar dos veces.
-- Vuelta atrás: supabase/vuelta-atras/20261028T1800_l1a3_avisos_olvido_radio_vigia.down.sql

-- ── 0 · La franja del WhatsApp, por empresa ────────────────────────────────
alter table public.app_settings add column if not exists aviso_olvido_desde time;
alter table public.app_settings add column if not exists aviso_olvido_hasta time;
comment on column public.app_settings.aviso_olvido_desde is
  'L1a PR 3: desde qué hora (Madrid) puede salir el WhatsApp del olvido. Null: 08:00.';
comment on column public.app_settings.aviso_olvido_hasta is
  'L1a PR 3: hasta qué hora (Madrid) puede salir el WhatsApp del olvido; después, solo el portal. Null: 22:00.';

-- ── 0b · La precisión de la ubicación en cada fichaje ─────────────────────
-- coords.accuracy del navegador, en metros (el radio del círculo donde está el
-- móvil con un 68 % de probabilidad). Más de 100 m es una ubicación
-- aproximada (la «ubicación aproximada» de Android o iPhone, o la del
-- ordenador por la red): no sirve para decir que alguien estaba fuera del
-- radio. La rellena fichar() desde la 1802; las marcas de antes, nulas.
alter table public.clock_entries add column if not exists precision_m integer;
comment on column public.clock_entries.precision_m is
  'L1a PR 3: la precisión de la ubicación que dio el móvil al fichar (coords.accuracy, metros). Más de 100 m = ubicación aproximada: no cuenta como fuera del radio (within_radius null). Null: sin ubicación, o marca de antes del 28/10.';

-- ── 1 · El registro de cada aviso, con lo que hace falta para contestarlo ──
alter table public.clockout_reminder_log add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.clockout_reminder_log add column if not exists entrada_at timestamptz;
alter table public.clockout_reminder_log add column if not exists inicio_turno timestamptz;
alter table public.clockout_reminder_log add column if not exists fin_turno timestamptz;
alter table public.clockout_reminder_log add column if not exists salta_at timestamptz;
alter table public.clockout_reminder_log add column if not exists canal text;
alter table public.clockout_reminder_log add column if not exists respuesta text;
alter table public.clockout_reminder_log add column if not exists respondida_at timestamptz;
alter table public.clockout_reminder_log add column if not exists respondida_via text;
alter table public.clockout_reminder_log add column if not exists correction_request_id uuid references public.clock_correction_request(id) on delete set null;
alter table public.clockout_reminder_log add column if not exists entregado_at timestamptz;
alter table public.clockout_reminder_log add column if not exists leido_at timestamptz;
create index if not exists ix_clockout_reminder_wamid on public.clockout_reminder_log (provider_message_id) where provider_message_id is not null;
create index if not exists ix_clockout_reminder_empleado on public.clockout_reminder_log (employee_id, created_at desc);
comment on column public.clockout_reminder_log.canal is
  'L1a PR 3: por dónde se avisa. whatsapp: sale el mensaje; portal: solo lo ve al abrir su portal (fuera de la franja, sin teléfono o sin querer WhatsApp).';
comment on column public.clockout_reminder_log.correction_request_id is
  'L1a PR 3: la petición de corrección que creó la respuesta («Salí a esa hora» u «Otra hora» con su hora). Nunca un fichaje: lo aprueba el encargado.';

-- ── 2 · La detección, en hora de Madrid ────────────────────────────────────
create or replace function public.avisos_olvido_debidos(p_ahora timestamptz default now())
returns table (
  clock_entry_id uuid, employee_id uuid, account_id uuid, location_id uuid,
  to_phone text, entrada_at timestamptz, inicio_turno timestamptz, fin_turno timestamptz,
  salta_at timestamptz, canal text, status text, skip_reason text
)
language sql stable security definer set search_path = public
as $$
  with abiertas as (
    -- Una entrada sin nada fichado después (ni salida ni otra entrada).
    select ce.id, ce.employee_id, ce.account_id, ce.datetime,
           coalesce(ce.location_id_at_clock, e.location_id) as loc,
           e.phone, e.active, e.forgot_clockout_reminder
      from public.clock_entries ce
      join public.employees e on e.id = ce.employee_id
     where ce.type = 'entrada' and not ce.voided
       and ce.datetime > p_ahora - interval '36 hours' and ce.datetime <= p_ahora
       and not exists (select 1 from public.clock_entries n
                        where n.employee_id = ce.employee_id and not n.voided
                          and n.id <> ce.id and n.datetime > ce.datetime)
  ),
  turnos as (
    -- Los turnos publicados de esa persona en ese local, el día de la entrada
    -- o el anterior (los de noche), en hora de Madrid.
    select a.id, t.inicio, t.fin
      from abiertas a
      cross join lateral (values ((a.datetime at time zone 'Europe/Madrid')::date),
                                 ((a.datetime at time zone 'Europe/Madrid')::date - 1)) dd(d)
      join public.schedules s on s.location_id = a.loc and s.account_id = a.account_id
                             and s.status = 'published' and s.week_start = date_trunc('week', dd.d)::date
      join public.shift_templates st on st.location_id = a.loc and s.cells ? st.id::text
      cross join lateral (select (dd.d + st.start_time) at time zone 'Europe/Madrid' as inicio,
                                 (dd.d + st.end_time + case when st.end_time <= st.start_time then interval '1 day' else interval '0' end)
                                   at time zone 'Europe/Madrid' as fin) t
     where coalesce(s.cells -> (st.id::text) -> ((extract(isodow from dd.d)::int - 1)::text), '[]'::jsonb) @> to_jsonb(a.employee_id::text)
       and abs(extract(epoch from (t.inicio - a.datetime))) <= 6 * 3600
       and t.fin > a.datetime
  ),
  mejor as (
    select distinct on (t.id) t.id, t.inicio, t.fin
      from turnos t join abiertas a on a.id = t.id
     order by t.id, abs(extract(epoch from (t.inicio - a.datetime)))
  ),
  ajustes as (
    select a.id,
           coalesce((select s.forgot_clockout_min from public.app_settings s where s.account_id = a.account_id order by s.updated_at desc limit 1),
                    (select s.forgot_clockout_min from public.app_settings s where s.scope = 'global' and s.account_id is null limit 1), 30) as margen,
           coalesce((select s.aviso_olvido_desde from public.app_settings s where s.account_id = a.account_id order by s.updated_at desc limit 1),
                    (select s.aviso_olvido_desde from public.app_settings s where s.scope = 'global' and s.account_id is null limit 1), time '08:00') as desde,
           coalesce((select s.aviso_olvido_hasta from public.app_settings s where s.account_id = a.account_id order by s.updated_at desc limit 1),
                    (select s.aviso_olvido_hasta from public.app_settings s where s.scope = 'global' and s.account_id is null limit 1), time '22:00') as hasta
      from abiertas a
  ),
  debidas as (
    select a.*, m.inicio, m.fin, j.desde, j.hasta,
           coalesce(m.fin + make_interval(mins => j.margen), a.datetime + interval '12 hours') as salta
      from abiertas a
      join ajustes j on j.id = a.id
      left join mejor m on m.id = a.id
  )
  select d.id, d.employee_id, d.account_id, d.loc,
         nullif(btrim(d.phone), ''), d.datetime, d.inicio, d.fin, d.salta,
         x.canal,
         case when x.canal = 'whatsapp' then 'queued' else 'skipped' end,
         x.motivo
    from debidas d
    cross join lateral (
      select case
               when not d.active then 'de_baja'
               when not coalesce(d.forgot_clockout_reminder, true) then 'no_quiere_whatsapp'
               when nullif(btrim(d.phone), '') is null then 'sin_telefono'
               when (p_ahora at time zone 'Europe/Madrid')::time < d.desde
                 or (p_ahora at time zone 'Europe/Madrid')::time >= d.hasta then 'fuera_de_hora'
               when p_ahora - d.salta > interval '1 hour' then 'tarde'
             end as motivo
    ) y
    cross join lateral (select case when y.motivo is null then 'whatsapp' else 'portal' end as canal, y.motivo) x
   where d.salta <= p_ahora
     and d.salta > p_ahora - interval '24 hours'
     and not exists (select 1 from public.clockout_reminder_log l where l.clock_entry_id = d.id);
$$;
comment on function public.avisos_olvido_debidos(timestamptz) is
  'L1a PR 3: los olvidos de salida que tocan avisar ahora, en hora de Madrid. Una entrada abierta con turno publicado que acabó hace más de forgot_clockout_min; sin turno, a las 12 h. WhatsApp solo dentro de la franja de la empresa y en la primera hora; si no, solo el portal (status skipped, con el motivo). La usa enqueue_clockout_reminders.';
revoke all on function public.avisos_olvido_debidos(timestamptz) from public, anon, authenticated;

-- ── 3 · Antes de mandar, otra vez: ¿sigue abierta y sigue siendo hora? ─────
create or replace function public.aviso_olvido_cola(p_limite integer default 25, p_ahora timestamptz default now())
returns table (
  id uuid, employee_id uuid, to_phone text, attempts integer, nombre text, username text,
  local_nombre text, fin_hora text, entrada_hora text, con_turno boolean
)
language plpgsql security definer set search_path = public
as $$
declare r record; v_desde time; v_hasta time; v_ahora time := (p_ahora at time zone 'Europe/Madrid')::time;
begin
  for r in
    select l.*, e.name as e_name, e.username as e_username, loc.name as loc_name
      from public.clockout_reminder_log l
      join public.employees e on e.id = l.employee_id
      left join public.locations loc on loc.id = l.location_id
     where l.status = 'queued' and l.attempts < 3
     order by l.created_at
     limit greatest(p_limite, 0)
     for update of l skip locked
  loop
    -- Lo viejo (de antes de la 1800) se manda como siempre: no tiene entrada_at.
    if r.entrada_at is not null then
      if not exists (select 1 from public.clock_entries ce where ce.id = r.clock_entry_id and not ce.voided) then
        update public.clockout_reminder_log set status = 'skipped', skip_reason = 'anulada', updated_at = now() where clockout_reminder_log.id = r.id;
        continue;
      end if;
      if exists (select 1 from public.clock_entries n
                  where n.employee_id = r.employee_id and not n.voided
                    and n.id <> r.clock_entry_id and n.datetime > r.entrada_at) then
        update public.clockout_reminder_log set status = 'skipped', skip_reason = 'ya_fichada', updated_at = now() where clockout_reminder_log.id = r.id;
        continue;
      end if;
      select coalesce((select s.aviso_olvido_desde from public.app_settings s where s.account_id = r.account_id order by s.updated_at desc limit 1),
                      (select s.aviso_olvido_desde from public.app_settings s where s.scope = 'global' and s.account_id is null limit 1), time '08:00'),
             coalesce((select s.aviso_olvido_hasta from public.app_settings s where s.account_id = r.account_id order by s.updated_at desc limit 1),
                      (select s.aviso_olvido_hasta from public.app_settings s where s.scope = 'global' and s.account_id is null limit 1), time '22:00')
        into v_desde, v_hasta;
      if v_ahora < v_desde or v_ahora >= v_hasta then
        update public.clockout_reminder_log set status = 'skipped', canal = 'portal', skip_reason = 'fuera_de_hora', updated_at = now() where clockout_reminder_log.id = r.id;
        continue;
      end if;
    end if;
    id := r.id; employee_id := r.employee_id; to_phone := r.to_phone; attempts := r.attempts;
    nombre := coalesce(nullif(split_part(btrim(coalesce(r.e_name, '')), ' ', 1), ''), 'Hola');
    username := r.e_username;
    local_nombre := coalesce(r.loc_name, 'tu local');
    fin_hora := coalesce(to_char(r.fin_turno at time zone 'Europe/Madrid', 'HH24:MI'), nullif(btrim(r.scheduled_end), ''));
    entrada_hora := to_char(r.entrada_at at time zone 'Europe/Madrid', 'HH24:MI');
    con_turno := r.fin_turno is not null or (r.entrada_at is null and nullif(btrim(r.scheduled_end), '') is not null);
    return next;
  end loop;
end $$;
comment on function public.aviso_olvido_cola(integer, timestamptz) is
  'L1a PR 3: lo que la función de borde puede mandar ya. Antes, vuelve a mirar cada aviso: si la entrada ya tiene algo fichado después, no sale (ya_fichada); si ya no es hora, pasa al portal (fuera_de_hora).';
revoke all on function public.aviso_olvido_cola(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.aviso_olvido_cola(integer, timestamptz) to service_role;

-- ── 4 · Contestar: crea la petición, nunca el fichaje ──────────────────────
create or replace function public._aviso_olvido_responder(p_log_id uuid, p_respuesta text, p_hora timestamptz, p_via text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  l public.clockout_reminder_log;
  v_siguiente timestamptz;
  v_hora timestamptz;
  v_peticion public.clock_correction_request;
  v_existente uuid;
  v_motivo text;
  v_hhmm text;
begin
  if p_respuesta not in ('a_su_hora', 'otra_hora', 'sigo') then
    raise exception 'RESPUESTA_INVALIDA' using errcode = '22023';
  end if;
  select * into l from public.clockout_reminder_log where id = p_log_id for update;
  if not found or l.entrada_at is null then
    return jsonb_build_object('resultado', 'no_existe', 'texto', 'No encontramos ese aviso. Si te falta la salida, pídela desde tu portal.');
  end if;
  if l.correction_request_id is not null then
    return jsonb_build_object('resultado', 'ya_respondida', 'peticion_id', l.correction_request_id,
      'texto', 'Ya nos contestaste: tu encargado tiene la petición para revisarla.');
  end if;

  if not exists (select 1 from public.clock_entries ce where ce.id = l.clock_entry_id and not ce.voided) then
    return jsonb_build_object('resultado', 'anulada', 'texto', 'Esa entrada ya no está en tu registro: no hace falta nada.');
  end if;
  -- ¿Sigue abierta? Si ya hay algo fichado después, no hace falta nada.
  select min(n.datetime) into v_siguiente from public.clock_entries n
   where n.employee_id = l.employee_id and not n.voided and n.id <> l.clock_entry_id and n.datetime > l.entrada_at;
  if v_siguiente is not null then
    update public.clockout_reminder_log set respuesta = p_respuesta, respondida_at = now(), respondida_via = p_via, updated_at = now() where id = l.id;
    return jsonb_build_object('resultado', 'ya_fichada',
      'texto', format('Ya tienes fichado lo siguiente a las %s. No hace falta nada más.', to_char(v_siguiente at time zone 'Europe/Madrid', 'HH24:MI')));
  end if;

  if p_respuesta = 'sigo' then
    update public.clockout_reminder_log set respuesta = 'sigo', respondida_at = now(), respondida_via = p_via, updated_at = now() where id = l.id;
    return jsonb_build_object('resultado', 'apuntado', 'texto', 'Apuntado. Acuérdate de fichar la salida al terminar.');
  end if;

  v_hora := case when p_respuesta = 'a_su_hora' then l.fin_turno else p_hora end;
  if v_hora is null then
    -- «Otra hora» por WhatsApp (o «a su hora» sin turno): la hora la pone en el portal.
    update public.clockout_reminder_log set respuesta = p_respuesta, respondida_at = now(), respondida_via = p_via, updated_at = now() where id = l.id;
    return jsonb_build_object('resultado', 'pide_hora', 'texto', 'Dinos a qué hora saliste desde tu portal. Tu encargado lo revisará.');
  end if;
  if v_hora <= l.entrada_at then
    raise exception 'HORA_ANTES_DE_LA_ENTRADA' using errcode = '22023', hint = 'La salida tiene que ser después de la entrada.';
  end if;
  if v_hora > now() + interval '5 minutes' then
    raise exception 'HORA_FUTURA' using errcode = '22023', hint = 'La salida no puede ser una hora que aún no ha llegado.';
  end if;

  v_hhmm := to_char(v_hora at time zone 'Europe/Madrid', 'HH24:MI');
  -- Si ya hay una petición de esa salida (la pidió desde «Reportar olvido»), se enlaza.
  select r.id into v_existente from public.clock_correction_request r
   where r.employee_id = l.employee_id and r.kind = 'add' and r.proposed_type = 'salida'
     and r.status in ('pending', 'approved') and r.proposed_datetime > l.entrada_at
   order by r.created_at desc limit 1;
  if v_existente is not null then
    update public.clockout_reminder_log set respuesta = p_respuesta, respondida_at = now(), respondida_via = p_via,
           correction_request_id = v_existente, updated_at = now() where id = l.id;
    return jsonb_build_object('resultado', 'ya_pedida', 'peticion_id', v_existente,
      'texto', 'Ya tenías pedida esa salida: tu encargado la tiene para revisarla.');
  end if;

  v_motivo := format('Respuesta al aviso de olvido (%s): %s.',
                     case p_via when 'whatsapp' then 'WhatsApp' else 'portal' end,
                     case when p_respuesta = 'a_su_hora' then format('salí a mi hora, a las %s', v_hhmm)
                          else format('salí a las %s', v_hhmm) end);
  insert into public.clock_correction_request(
    account_id, employee_id, requested_by_employee_id, clock_entry_id, kind, proposed_type, proposed_datetime, reason)
  values (l.account_id, l.employee_id, l.employee_id, null, 'add', 'salida', v_hora, v_motivo)
  returning * into v_peticion;
  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_employee_id, actor_label, reason, after, peticion_id)
  values (null, l.employee_id, l.account_id, 'request', l.employee_id,
          case p_via when 'whatsapp' then 'WhatsApp (aviso de olvido)' else 'Portal (aviso de olvido)' end,
          v_motivo, to_jsonb(v_peticion), v_peticion.id);
  update public.clockout_reminder_log set respuesta = p_respuesta, respondida_at = now(), respondida_via = p_via,
         correction_request_id = v_peticion.id, updated_at = now() where id = l.id;
  return jsonb_build_object('resultado', 'peticion', 'peticion_id', v_peticion.id, 'hora', v_hhmm,
    'texto', format('Hecho: le hemos pedido a tu encargado que apunte tu salida a las %s. Lo verás en tu portal cuando la apruebe.', v_hhmm));
end $$;
revoke all on function public._aviso_olvido_responder(uuid, text, timestamptz, text) from public, anon, authenticated;

-- Desde el webhook (clave de servicio). El teléfono que contesta tiene que ser
-- el mismo al que se mandó el aviso, y el mensaje al que contesta, ese aviso.
create or replace function public.responder_aviso_olvido_whatsapp(p_log_id uuid, p_respuesta text, p_telefono text, p_contexto_wamid text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare l public.clockout_reminder_log;
  v_a text := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 9);
  v_b text;
begin
  select * into l from public.clockout_reminder_log where id = p_log_id;
  if not found then
    return jsonb_build_object('resultado', 'no_existe', 'texto', 'No encontramos ese aviso. Si te falta la salida, pídela desde tu portal.');
  end if;
  v_b := right(regexp_replace(coalesce(l.to_phone, ''), '\D', '', 'g'), 9);
  if length(v_a) < 9 or v_a <> v_b then
    return jsonb_build_object('resultado', 'otro_telefono', 'texto', 'Este aviso no era para este número.');
  end if;
  if p_contexto_wamid is not null and l.provider_message_id is not null and p_contexto_wamid <> l.provider_message_id then
    return jsonb_build_object('resultado', 'otro_mensaje', 'texto', 'Este aviso no era para este número.');
  end if;
  return public._aviso_olvido_responder(p_log_id, p_respuesta, null, 'whatsapp');
end $$;
comment on function public.responder_aviso_olvido_whatsapp(uuid, text, text, text) is
  'L1a PR 3: la respuesta de un toque al WhatsApp del olvido (la llama whatsapp-webhook, después de comprobar la firma de Meta). Crea la petición de corrección; nunca el fichaje.';
revoke all on function public.responder_aviso_olvido_whatsapp(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.responder_aviso_olvido_whatsapp(uuid, text, text, text) to service_role;

-- Desde el portal: solo la propia persona.
create or replace function public.responder_aviso_olvido(p_log_id uuid, p_respuesta text, p_hora timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare l public.clockout_reminder_log;
begin
  select * into l from public.clockout_reminder_log where id = p_log_id;
  if not found or not public.current_user_is_employee(l.employee_id, l.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'Solo puedes contestar tus propios avisos.';
  end if;
  if p_respuesta = 'otra_hora' and p_hora is null then
    raise exception 'FALTA_LA_HORA' using errcode = '22023', hint = 'Di a qué hora saliste.';
  end if;
  return public._aviso_olvido_responder(p_log_id, p_respuesta, p_hora, 'portal');
end $$;
revoke all on function public.responder_aviso_olvido(uuid, text, timestamptz) from public, anon;
grant execute on function public.responder_aviso_olvido(uuid, text, timestamptz) to authenticated;

-- Lo que el portal enseña: las entradas sin salida que ya avisamos y siguen
-- sin contestar (o con «otra hora» sin hora todavía).
create or replace function public.mis_avisos_olvido()
returns table (id uuid, entrada_at timestamptz, fin_turno timestamptz, local_nombre text, respuesta text)
language sql stable security definer set search_path = public
as $$
  select l.id, l.entrada_at, l.fin_turno, coalesce(loc.name, ''), l.respuesta
    from public.clockout_reminder_log l
    left join public.locations loc on loc.id = l.location_id
    join public.current_employee_and_account() yo on yo.employee_id = l.employee_id and yo.account_id = l.account_id
   where l.entrada_at is not null and l.entrada_at > now() - interval '14 days'
     and exists (select 1 from public.clock_entries ce where ce.id = l.clock_entry_id and not ce.voided)
     and l.correction_request_id is null
     and (l.respuesta is null or l.respuesta = 'otra_hora' or (l.respuesta = 'sigo' and l.entrada_at < now() - interval '12 hours'))
     and not exists (select 1 from public.clock_entries n
                      where n.employee_id = l.employee_id and not n.voided
                        and n.id <> l.clock_entry_id and n.datetime > l.entrada_at)
     and not exists (select 1 from public.clock_correction_request r
                      where r.employee_id = l.employee_id and r.kind = 'add' and r.proposed_type = 'salida'
                        and r.status in ('pending', 'approved') and r.proposed_datetime > l.entrada_at)
   order by l.entrada_at desc;
$$;
revoke all on function public.mis_avisos_olvido() from public, anon;
grant execute on function public.mis_avisos_olvido() to authenticated;

-- ── 5 · Lo que llega de Meta ───────────────────────────────────────────────
create table if not exists public.whatsapp_entrada (
  id           uuid primary key default gen_random_uuid(),
  recibido_at  timestamptz not null default now(),
  aceptado     boolean not null,
  motivo       text,             -- por qué se rechazó (sin_firma, firma_mala, sin_secreto, json_malo…)
  tipo         text,             -- boton, estado, texto, otro
  wamid        text,
  telefono_fin text,             -- solo los 4 últimos dígitos
  aviso_id     uuid references public.clockout_reminder_log(id) on delete set null,
  resultado    text,
  datos        jsonb,            -- solo de lo aceptado, y recortado
  bytes        integer
);
create index if not exists ix_whatsapp_entrada_recibido on public.whatsapp_entrada (recibido_at desc);
alter table public.whatsapp_entrada enable row level security;
revoke all on public.whatsapp_entrada from anon, authenticated;
comment on table public.whatsapp_entrada is
  'L1a PR 3: todo lo que llega al webhook de WhatsApp, también lo rechazado (sin la firma de Meta, o con una que no cuadra). Sin políticas: solo la clave de servicio.';

create or replace function public.whatsapp_estado(p_wamid text, p_estado text, p_at timestamptz default now(), p_error text default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  update public.clockout_reminder_log
     set entregado_at = case when p_estado in ('delivered', 'read') then coalesce(entregado_at, p_at) else entregado_at end,
         leido_at     = case when p_estado = 'read' then coalesce(leido_at, p_at) else leido_at end,
         status       = case when p_estado = 'failed' then 'failed' else status end,
         error        = case when p_estado = 'failed' then coalesce(p_error, error) else error end,
         updated_at   = now()
   where provider_message_id = p_wamid
   returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.whatsapp_estado(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.whatsapp_estado(text, text, timestamptz, text) to service_role;

-- ── 6 · Los avisos a la empresa ────────────────────────────────────────────
create table if not exists public.aviso_empresa (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  location_id     uuid references public.locations(id) on delete set null,
  employee_id     uuid references public.employees(id) on delete set null,
  clock_entry_id  uuid references public.clock_entries(id) on delete set null,
  tipo            text not null check (tipo in ('fuera_del_radio', 'avisos_olvido_fallan')),
  clave           text not null unique,
  titulo          text not null,
  texto           text not null,
  creado_at       timestamptz not null default now(),
  correo_estado   text not null default 'pendiente'
                  check (correo_estado in ('pendiente', 'enviado', 'sin_destinatarios', 'sin_clave', 'fallo')),
  correo_a        integer,
  correo_at       timestamptz,
  correo_error    text
);
create index if not exists ix_aviso_empresa_cuenta on public.aviso_empresa (account_id, creado_at desc);
create index if not exists ix_aviso_empresa_correo on public.aviso_empresa (correo_estado) where correo_estado = 'pendiente';
alter table public.aviso_empresa enable row level security;
drop policy if exists aviso_empresa_leer on public.aviso_empresa;
create policy aviso_empresa_leer on public.aviso_empresa for select to authenticated using (
  public.current_user_is_admin_of(account_id)
  or (public.current_user_is_admin_or_manager_of(account_id)
      and (location_id is null or location_id = any (public.current_user_location_ids())))
);
revoke all on public.aviso_empresa from anon;
revoke insert, update, delete on public.aviso_empresa from authenticated;
grant select on public.aviso_empresa to authenticated;
comment on table public.aviso_empresa is
  'L1a PR 3: lo que la empresa tiene que saber el mismo día: un fichaje fuera del radio con ubicación precisa y que los avisos de olvido dejan de salir. Lo enseña «Equipo» y sale por correo a los administradores y a los encargados del local (clockout-reminder).';

-- A quién se le manda cada aviso por correo: los administradores de la
-- cuenta y los encargados de ese local, activos y con correo.
create or replace function public.avisos_empresa_por_enviar(p_limite integer default 20)
returns table (id uuid, account_id uuid, tipo text, titulo text, texto text, destinatarios text[])
language sql stable security definer set search_path = public, auth
as $$
  select a.id, a.account_id, a.tipo, a.titulo, a.texto,
         coalesce((select array_agg(distinct u.email::text)
                     from public.user_profiles up
                     join auth.users u on u.id = up.user_id
                    where up.account_id = a.account_id and up.active and up.suspended_at is null
                      and u.email is not null and u.email not like '%@empleado.folvy.app'
                      and (up.role = 'admin'
                           or (up.role = 'manager' and a.location_id is not null
                               and exists (select 1 from public.manager_locations ml
                                            where ml.user_profile_id = up.id and ml.location_id = a.location_id)))),
                  '{}'::text[])
    from public.aviso_empresa a
   where a.correo_estado = 'pendiente'
   order by a.creado_at
   limit greatest(p_limite, 0);
$$;
revoke all on function public.avisos_empresa_por_enviar(integer) from public, anon, authenticated;
grant execute on function public.avisos_empresa_por_enviar(integer) to service_role;

-- Fuera del radio: aviso al encargado, solo con una ubicación PRECISA (la
-- precisión del móvil, precision_m, de 100 m o menos). Una ubicación
-- aproximada no es «fuera del radio»: fichar() deja within_radius en null y el
-- trabajador ve en el momento cómo activar la ubicación precisa. Nunca rompe
-- el fichaje.
create or replace function public.tg_fichaje_fuera_del_radio()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_nombre text; v_local text; v_radio integer; v_loc uuid; v_tipo text;
begin
  begin
    -- Lo mismo que la condición del disparador (1801), por si se llama sin ella.
    if new.within_radius is distinct from false or new.precision_m is null or new.precision_m > 100 then
      return null;
    end if;
    select e.name, coalesce(new.location_id_at_clock, e.location_id) into v_nombre, v_loc
      from public.employees e where e.id = new.employee_id;
    select l.name, l.clock_radius_m into v_local, v_radio from public.locations l where l.id = v_loc;
    v_tipo := case new.type when 'entrada' then 'la entrada' when 'salida' then 'la salida'
                            when 'pausa_inicio' then 'el inicio de la pausa' when 'pausa_fin' then 'el fin de la pausa' else 'un fichaje' end;
    insert into public.aviso_empresa(account_id, location_id, employee_id, clock_entry_id, tipo, clave, titulo, texto)
    values (new.account_id, v_loc, new.employee_id, new.id, 'fuera_del_radio', 'fuera_del_radio:' || new.id,
            format('%s fichó fuera del radio de %s', coalesce(v_nombre, 'Una persona'), coalesce(v_local, 'su local')),
            format('%s fichó %s el %s a las %s a %s de %s (el radio es de %s m; el móvil daba la ubicación con una precisión de %s m). Si fue a propósito (un recado, un evento), no hace falta nada; si no, revísalo en Equipo › Para revisar.',
                   coalesce(v_nombre, 'Una persona'), v_tipo,
                   to_char(new.datetime at time zone 'Europe/Madrid', 'DD/MM'),
                   to_char(new.datetime at time zone 'Europe/Madrid', 'HH24:MI'),
                   case when new.distance_m is null then 'una distancia que no se pudo medir'
                        when new.distance_m >= 1000 then replace(to_char(new.distance_m / 1000.0, 'FM990.0'), '.', ',') || ' km'
                        else new.distance_m || ' m' end,
                   coalesce(v_local, 'su local'), coalesce(v_radio, 200), new.precision_m))
    on conflict (clave) do nothing;
  exception when others then
    begin
      perform public._queue_system_alert('fichaje_fuera_del_radio', 'Fuera del radio: no se pudo crear el aviso',
        format('El fichaje %s cayó fuera del radio y no se pudo avisar al encargado: %s', new.id, sqlerrm),
        'fichaje_fuera_del_radio', interval '6 hours');
    exception when others then null;
    end;
  end;
  return null;
end $$;
revoke all on function public.tg_fichaje_fuera_del_radio() from public, anon, authenticated;


-- ── 7 · Los errores de WhatsApp, en palabras de oficina ────────────────────
-- de_empresa: el fallo es de la cuenta (la llave, la plantilla, Meta) y deja
-- sin aviso a todos; si es de una persona (su número), no.
create or replace function public.whatsapp_error_en_palabras(p_error text)
returns table (de_empresa boolean, texto text)
language plpgsql immutable set search_path = public
as $$
declare v_code integer := nullif(substring(coalesce(p_error, '') from '"code"\s*:\s*(\d+)'), '')::integer;
begin
  if p_error is null or btrim(p_error) = '' then
    de_empresa := true; texto := 'El envío falló sin decir por qué.'; return next; return;
  end if;
  if p_error like 'magic_link_failed%' then
    de_empresa := true; texto := 'No se pudo preparar el enlace al portal para el mensaje.'; return next; return;
  end if;
  if p_error like 'sin_username%' then
    de_empresa := false; texto := 'Esa persona no tiene usuario del portal.'; return next; return;
  end if;
  case
    -- Por el código, nunca por «OAuthException»: Meta pone ese tipo también
    -- a los errores de plantilla.
    when v_code in (190, 102) then
      de_empresa := true; texto := 'La llave de WhatsApp de la empresa ha caducado o no es válida: hay que renovarla en Meta.';
    when v_code in (10, 200) then
      de_empresa := true; texto := 'La llave de WhatsApp de la empresa no tiene permiso para mandar mensajes desde ese número.';
    when v_code = 132001 then
      de_empresa := true; texto := 'La plantilla de WhatsApp no existe en Meta (o no está aprobada en español).';
    when v_code in (132000, 132005, 132007, 132012, 132015, 132016, 132068, 132069) then
      de_empresa := true; texto := 'La plantilla de WhatsApp está pausada, desactivada o no encaja con lo que se manda.';
    when v_code in (131031, 368, 131042) then
      de_empresa := true; texto := 'Meta tiene bloqueada la cuenta de WhatsApp de la empresa (o su forma de pago).';
    when v_code in (4, 80007, 130429, 131048, 131056) then
      de_empresa := true; texto := 'Meta está frenando los envíos por exceso de mensajes.';
    when v_code = 131030 then
      de_empresa := true; texto := 'La cuenta de WhatsApp sigue en pruebas y solo puede escribir a los números de su lista.';
    when v_code in (131026, 133010, 131021, 131051) then
      de_empresa := false; texto := 'Ese número no tiene WhatsApp o no puede recibir el mensaje.';
    when v_code = 131047 then
      de_empresa := false; texto := 'Han pasado más de 24 h desde su último mensaje.';
    when v_code is not null then
      de_empresa := true; texto := format('WhatsApp rechazó el mensaje (código %s).', v_code);
    else
      de_empresa := true; texto := 'No se pudo hablar con WhatsApp (la red o Meta no contestaron).';
  end case;
  return next;
end $$;

-- ── 8 · El vigía: si los avisos dejan de salir, la empresa lo sabe ese día ─
create or replace function public.vigia_avisos_olvido(p_dry boolean default false, p_ahora timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hoy timestamptz := ((p_ahora at time zone 'Europe/Madrid')::date)::timestamp at time zone 'Europe/Madrid';
  v_cron boolean := true;
  v_detectados integer := 0;
  r record;
  v_avisos jsonb := '[]'::jsonb;
  v_texto text;
begin
  -- Detecta él mismo: si la función de borde no corre, la cola crece y se ve.
  if not p_dry then
    begin
      v_detectados := public.enqueue_clockout_reminders();
    exception when others then
      perform public._queue_system_alert('avisos_olvido', 'Avisos de olvido: la detección falla',
        format('enqueue_clockout_reminders() falló: %s', sqlerrm), 'avisos_olvido_detectar', interval '6 hours');
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select exists (select 1 from cron.job where jobname = 'clockout-reminder-drain' and active) into v_cron;
  end if;

  for r in
    with hoy as (
      select l.account_id, l.status, l.created_at, l.error, w.de_empresa, w.texto
        from public.clockout_reminder_log l
        left join lateral public.whatsapp_error_en_palabras(l.error) w on l.status = 'failed'
       where l.created_at >= v_hoy
    )
    select h.account_id,
           count(*) filter (where h.status = 'failed' and h.de_empresa) as fallos_empresa,
           count(*) filter (where h.status = 'failed' and not h.de_empresa) as fallos_persona,
           count(*) filter (where h.status = 'queued' and h.created_at < p_ahora - interval '30 minutes') as atascados,
           count(*) filter (where h.status = 'sent') as enviados,
           (array_agg(h.texto order by h.created_at desc) filter (where h.status = 'failed' and h.de_empresa))[1] as motivo
      from hoy h
     group by h.account_id
  loop
    if r.fallos_empresa = 0 and r.atascados = 0 and v_cron then continue; end if;
    v_texto := case
      when r.fallos_empresa > 0 then
        format('%s por WhatsApp. El motivo: %s Hasta que se arregle, nadie recibe el WhatsApp: cada persona lo ve al abrir su portal.',
               case when r.fallos_empresa = 1 then 'Hoy no ha salido 1 aviso de olvido'
                    else format('Hoy no han salido %s avisos de olvido', r.fallos_empresa) end,
               r.motivo)
      when not v_cron then
        'El envío de los avisos de olvido por WhatsApp no está programado: no sale ninguno. Mientras tanto, cada persona lo ve al abrir su portal.'
      else
        format('%s más de 30 minutos para salir: el envío por WhatsApp no está corriendo. Mientras tanto, cada persona lo ve al abrir su portal.',
               case when r.atascados = 1 then 'Hay 1 aviso de olvido esperando' else format('Hay %s avisos de olvido esperando', r.atascados) end)
    end;
    v_avisos := v_avisos || jsonb_build_object('cuenta', r.account_id, 'texto', v_texto,
                  'fallos_empresa', r.fallos_empresa, 'atascados', r.atascados, 'enviados', r.enviados);
    if not p_dry then
      insert into public.aviso_empresa(account_id, tipo, clave, titulo, texto, creado_at)
      values (r.account_id, 'avisos_olvido_fallan',
              'avisos_olvido_fallan:' || r.account_id || ':' || to_char(p_ahora at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
              'Los avisos de olvido de fichaje no están saliendo', v_texto, p_ahora)
      on conflict (clave) do nothing;
      perform public._queue_system_alert('avisos_olvido', 'Avisos de olvido: no salen',
        format('Cuenta %s: %s', r.account_id, v_texto), 'avisos_olvido_' || r.account_id, interval '20 hours');
    end if;
  end loop;
  return jsonb_build_object('detectados', v_detectados, 'cron', v_cron, 'avisos', v_avisos);
end $$;
comment on function public.vigia_avisos_olvido(boolean, timestamptz) is
  'L1a PR 3: cada 15 min (cron avisos-olvido-vigia). Detecta los olvidos sin depender de la función de borde y, si hoy los WhatsApp fallan por algo de la empresa o se quedan en cola más de 30 min, avisa a la empresa (aviso_empresa, una vez al día) y a sistema.';
revoke all on function public.vigia_avisos_olvido(boolean, timestamptz) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-olvido-vigia') then
      perform cron.unschedule('avisos-olvido-vigia');
    end if;
    perform cron.schedule('avisos-olvido-vigia', '7,22,37,52 * * * *', $cron$select public.vigia_avisos_olvido()$cron$);
  end if;
end $$;
