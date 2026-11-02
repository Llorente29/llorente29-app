-- cambia: public.print_job · prueba: supabase/staging/sql/20261101_a01a_tickets_caducan_prueba.sql
-- cambia: public.db_health_watchdog · prueba: supabase/staging/sql/20261101_a01a_tickets_caducan_prueba.sql
--
-- supabase/migrations/20261101T1906_a01a_tickets_caducan.sql
--
-- A01a · Un ticket viejo caduca y el aviso deja de repetirse (01/11/2026).
--
-- Por qué: en Alcalá había 17 print_job «pending» del 29/10 (20:13–22:50), de
-- una avería de red (la impresora cambió de IP). Ya no se iban a imprimir:
-- claim_print_jobs no coge nada de más de 2 h. Pero seguían «pending», y el
-- Aviso 4 de db_health_watchdog mandaba «Tickets sin imprimir desde hace horas:
-- 17 en cola» cada hora (23 veces en 24 h), que con lo demás agotó el 01/11 el
-- cupo diario de Resend.
--
-- Qué hace:
--   1. print_job: estado nuevo «expired» (caducado), con expired_at y
--      expire_reason. Un caducado no vuelve a la cola (disparador).
--   2. print_job_vigia(), que llama db_health_watchdog cada minuto en lugar de
--      su Aviso 4:
--        · caduca lo que lleva MÁS DE 2 H pendiente. Medido en 30 días: de
--          10.637 impresos, el más lento tardó 407 s (7 min), el 99,9 % menos de
--          285 s y ninguno más de 10 min. 2 h es además donde claim_print_jobs
--          deja de cogerlos: un pendiente de más de 2 h ya no se imprimía nunca;
--        · avisa por local, solo de cuentas que operan: UNA vez al abrirse el
--          problema (algo pendiente más de 15 min, el doble del más lento), otra
--          si la cola se dobla, y «Resuelto» al vaciarse (impreso o caducado).
--          El estado de cada aviso, en print_job_aviso. Nunca cada hora.
--   3. Los 17 de Alcalá caducan aquí, por su cuenta (Foodint) y sus ids.
--
-- Guarda: db_health_watchdog tiene que ser la medida el 01/11 (md5 dd8f4ead…);
-- si no, para. Se respalda antes. Lleva «autorizo»: corre por cron (camino del
-- pedido para el analizador) y cambia datos (los 17).
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T1906_a01a_tickets_caducan.down.sql

do $$
begin
  if md5(pg_get_functiondef('public.db_health_watchdog()'::regprocedure)) <> 'dd8f4ead3f4fe4bf6fbcbe10cd09f5dc' then
    raise exception 'A01a PARADA: db_health_watchdog no es la medida el 01/11 (md5 dd8f4ead…). Reescribirlo pisaría ese cambio.';
  end if;
end $$;

-- Los cierres, de entrada: las tablets reclaman e informan cada pocos segundos.
lock table public.print_job in access exclusive mode;

select public._respaldar_funcion('public.db_health_watchdog()', '20261101T1906_a01a_tickets_caducan');

-- ── 1. El estado «caducado» ─────────────────────────────────────────────────
alter table public.print_job
  add column if not exists expired_at    timestamptz,
  add column if not exists expire_reason text;
comment on column public.print_job.expired_at is
  'A01a (01/11/2026). Cuándo caducó: pendiente demasiado tiempo, ya no se imprime (una comanda vieja confunde a la cocina).';
comment on column public.print_job.expire_reason is
  'A01a (01/11/2026). Por qué caducó, dicho para quien lo lea.';
alter table public.print_job drop constraint if exists print_job_status_check;
alter table public.print_job add constraint print_job_status_check
  check (status = any (array['pending', 'sent', 'done', 'error', 'cancelled', 'expired']));

create or replace function public._print_job_caducado_no_vuelve()
returns trigger language plpgsql set search_path = public as $f$
begin
  if coalesce(current_setting('folvy.print_job_reabrir', true), '') <> 'on' then
    raise exception 'print_job %: está caducado y no vuelve a la cola (una comanda vieja confunde a la cocina)', old.id
      using errcode = 'P0001';
  end if;
  return new;
end $f$;
comment on function public._print_job_caducado_no_vuelve() is
  'A01a (01/11/2026). Un print_job caducado no cambia de estado: nunca se imprime. Solo la vuelta atrás lo reabre (folvy.print_job_reabrir = on).';
drop trigger if exists print_job_caducado_no_vuelve on public.print_job;
create trigger print_job_caducado_no_vuelve
  before update of status on public.print_job
  for each row when (old.status = 'expired' and new.status is distinct from 'expired')
  execute function public._print_job_caducado_no_vuelve();

-- ── 2. El aviso, una vez por problema ───────────────────────────────────────
create table if not exists public.print_job_aviso (
  location_id uuid primary key references public.locations(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  opened_at   timestamptz not null default now(),
  alerted_n   integer not null check (alerted_n > 0),
  alerted_at  timestamptz not null default now()
);
comment on table public.print_job_aviso is
  'A01a (01/11/2026). Un problema de «tickets sin imprimir» abierto por local: cuántos había la última vez que se avisó. Se borra al resolverse.';
alter table public.print_job_aviso enable row level security;
revoke all on public.print_job_aviso from anon, authenticated;

create or replace function public.print_job_vigia()
returns void language plpgsql security definer set search_path = public as $f$
declare
  r  record;
  a  public.print_job_aviso%rowtype;
  v_impresos  integer;
  v_caducados integer;
begin
  -- 1. Caduca lo que lleva más de 2 h pendiente: claim_print_jobs ya no lo coge.
  update public.print_job
     set status = 'expired', expired_at = now(),
         expire_reason = 'Más de 2 h sin imprimir: ya no se imprime. Una comanda vieja impresa tarde confunde a la cocina.'
   where status = 'pending' and created_at < now() - interval '2 hours';

  -- 2. Abre o se dobla: lo pendiente más de 15 min, por local, de cuentas que operan.
  for r in
    select j.account_id, j.location_id, count(*)::integer as n, min(j.created_at) as mas_viejo
      from public.print_job j
     where j.status = 'pending' and j.created_at < now() - interval '15 minutes'
       and public.cuenta_opera(j.account_id)
     group by j.account_id, j.location_id
  loop
    select * into a from public.print_job_aviso where location_id = r.location_id;
    if not found then
      perform public.encolar_alerta(
        p_kind => 'db-health',
        p_subject => 'Tickets sin imprimir: ' || r.n || ' en cola',
        p_message => r.n || ' ticket(s) llevan más de 15 minutos en cola sin imprimirse. El más viejo, desde las '
          || to_char(r.mas_viejo at time zone 'Europe/Madrid', 'HH24:MI') || ' del '
          || to_char(r.mas_viejo at time zone 'Europe/Madrid', 'DD/MM') || '.' || chr(10) || chr(10)
          || 'Mira la impresora del local: encendida, con papel y con la tablet conectada.' || chr(10)
          || 'Este aviso no se repite: vuelve solo si la cola se dobla, y avisa «Resuelto» al vaciarse. '
          || 'Lo que pase de 2 horas caduca y ya no se imprime.',
        p_account_id => r.account_id, p_location_id => r.location_id,
        p_severity => case when public.is_brand_open(r.location_id, NULL::uuid, now()) then 'critico' else 'alto' end);
      insert into public.print_job_aviso (location_id, account_id, alerted_n) values (r.location_id, r.account_id, r.n);
    elsif r.n >= 2 * a.alerted_n then
      perform public.encolar_alerta(
        p_kind => 'db-health',
        p_subject => 'Tickets sin imprimir: la cola se ha doblado, ' || r.n || ' en cola',
        p_message => 'Eran ' || a.alerted_n || ' al avisar (' || to_char(a.alerted_at at time zone 'Europe/Madrid', 'HH24:MI')
          || ') y ahora son ' || r.n || '. El más viejo, desde las '
          || to_char(r.mas_viejo at time zone 'Europe/Madrid', 'HH24:MI') || '.' || chr(10) || chr(10)
          || 'Mira la impresora del local: encendida, con papel y con la tablet conectada.',
        p_account_id => r.account_id, p_location_id => r.location_id,
        p_severity => case when public.is_brand_open(r.location_id, NULL::uuid, now()) then 'critico' else 'alto' end);
      update public.print_job_aviso set alerted_n = r.n, alerted_at = now() where location_id = r.location_id;
    end if;
  end loop;

  -- 3. Resuelto: ya no queda nada pendiente más de 15 min en ese local.
  for a in
    select pa.* from public.print_job_aviso pa
     where not exists (select 1 from public.print_job j
                        where j.location_id = pa.location_id and j.status = 'pending'
                          and j.created_at < now() - interval '15 minutes'
                          and public.cuenta_opera(j.account_id))
  loop
    select count(*) filter (where status = 'done'), count(*) filter (where status = 'expired')
      into v_impresos, v_caducados
      from public.print_job
     where location_id = a.location_id and created_at <= a.opened_at
       and coalesce(done_at, expired_at) >= a.opened_at;
    perform public.encolar_alerta(
      p_kind => 'db-health',
      p_subject => 'Resuelto: ya no hay tickets sin imprimir',
      p_message => 'La cola del local se ha vaciado. Desde el aviso de las '
        || to_char(a.opened_at at time zone 'Europe/Madrid', 'HH24:MI') || ' del '
        || to_char(a.opened_at at time zone 'Europe/Madrid', 'DD/MM') || ': '
        || v_impresos || ' impreso(s) y ' || v_caducados || ' caducado(s), que ya no se imprimen.',
      p_account_id => a.account_id, p_location_id => a.location_id, p_severity => 'info');
    delete from public.print_job_aviso where location_id = a.location_id;
  end loop;
end $f$;
comment on function public.print_job_vigia() is
  'A01a (01/11/2026). La llama db_health_watchdog cada minuto: caduca los print_job de más de 2 h pendientes y avisa de tickets sin imprimir una vez al abrirse (más de 15 min), otra si la cola se dobla y «Resuelto» al vaciarse.';
revoke all on function public.print_job_vigia() from public, anon, authenticated;

-- ── 3. Los 17 de Alcalá, por su cuenta y sus ids ────────────────────────────
do $$
declare
  v_ids uuid[] := array[
    '7a13c6e4-5b77-458f-aedf-490ae5a9b4cb',
    'ccc5ac13-8a82-43c4-a34c-4a1ed59fc69f',
    '8c8648df-3cdb-4868-bfd2-a81955c37cb6',
    '45cb5c97-9fec-47db-a9c5-abbac6652756',
    'a90cfdbd-c1eb-4e39-bc4a-9cb8c5257593',
    'ab1b986a-0a2f-4d5f-a492-8a45ff3eb3e4',
    'dbcad391-231e-47f9-8900-00d680cfdc03',
    '26ad6b8c-c25c-4cf8-881c-73ab90f48796',
    '56f9d5f2-a8d4-4e00-ad6f-3a0662a026a5',
    '0ab6d35c-9baf-47f1-ba87-ac9502e7d0f5',
    '17703587-89fe-4396-88e4-956aa34ce097',
    'e66fe835-17a8-4acd-9afa-d46e758b19c8',
    'ea13ec52-859d-42ad-b632-77f88c9d39bc',
    'e7649e90-14a1-4a55-99ed-3cba8b5c0a73',
    'c2b22975-728d-4ea1-af25-4daf45780e2b',
    '9d6298df-23f3-4ac3-b701-c7016b11632b',
    '99b0b5d2-461d-436f-ae1a-82b62448546d'
  ]::uuid[];
  n integer;
begin
  select count(*) into n from public.print_job
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = any(v_ids);
  if n = 0 then
    raise notice 'A01a: los 17 de Alcalá no están en esta base (no es producción): nada que caducar a mano.';
    return;
  end if;
  update public.print_job
     set status = 'expired', expired_at = now(),
         expire_reason = 'Caducado en la tanda del A01a (01/11): avería de red del 29/10 en Alcalá; la impresora funciona desde entonces y ya son historia.'
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = any(v_ids) and status = 'pending';
  get diagnostics n = row_count;
  if n <> 17 then
    raise exception 'A01a PARADA: se esperaban 17 tickets pendientes de Alcalá y hay % — algo ha cambiado desde la medida.', n;
  end if;
  raise notice 'A01a: los 17 de Alcalá, caducados.';
end $$;

-- ── 4. El vigía llama a print_job_vigia en lugar de su Aviso 4 ──────────────
CREATE OR REPLACE FUNCTION public.db_health_watchdog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_snap            jsonb;
  v_waiting         int;
  v_total_conn      int;
  v_max_conn        int;
  v_n_snapshots     int;
  v_n_breaching     int;
  v_stuck_print     int;
  v_inactive_print  int;
  v_route_failures  int;
begin
  begin
    v_snap       := public.db_health_snapshot();
    v_waiting    := (v_snap->>'waiting_locks')::int;
    v_total_conn := (v_snap->>'total_connections')::int;
    v_max_conn   := (v_snap->>'max_connections')::int;

    insert into public.db_health_snapshot_log
      (total_connections, waiting_locks, oldest_tx_seconds)
    values
      (v_total_conn, v_waiting, (v_snap->>'oldest_tx_seconds')::numeric);

    delete from public.db_health_snapshot_log where checked_at < now() - interval '48 hours';
    delete from public.db_health_alert_log where sent_at < now() - interval '30 days';

    -- Aviso 1 — bloqueos sostenidos. CRITICO, y dicho, no caido por defecto.
    -- Sin cuenta ni local a proposito: esto es la BASE ENTERA, y rellenar un
    -- campo de local aqui seria mentir en un campo.
    --
    -- La ventana pasa a los 15 minutos que el codigo decia. Antes decia 15 y
    -- hacia 20 HORAS: el `not exists` miraba `sent_at` (cuando se envio) y el
    -- envoltorio viejo traia `p_debounce_window default '20:00:00'`, que gana
    -- por ser mas ancha. Un segundo episodio dentro de esas 20 h no avisaba.
    select count(*), count(*) filter (where waiting_locks > 3)
      into v_n_snapshots, v_n_breaching
      from public.db_health_snapshot_log
      where checked_at >= now() - interval '2 minutes';
    if v_n_snapshots >= 2 and v_n_breaching = v_n_snapshots then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'La base de datos esta bloqueada: ' || v_waiting
                     || ' proceso(s) esperando, y van mas de 2 min',
        p_message =>
          'Mas de 3 procesos llevan esperando un lock en ' || v_n_snapshots
          || ' medidas seguidas de los ultimos 2 minutos; ahora mismo hay ' || v_waiting || '.'
          || chr(10)
          || 'Conexiones de cliente: ' || v_total_conn
          || '. Transaccion mas antigua: ' || (v_snap->>'oldest_tx_seconds') || ' s.'
          || chr(10) || chr(10)
          || 'Asi empezo el incidente del 11/08. Mirar pg_stat_activity YA.',
        p_debounce_kind   => 'db-health-lock',
        p_debounce_window => interval '15 minutes',
        p_account_id      => NULL,
        p_location_id     => NULL,
        p_brand_id        => NULL,
        p_severity        => 'critico'
      );
    end if;

    -- Aviso 2 — conexiones de CLIENTE cerca del maximo. ALTO, y dicho.
    -- Se queda en el MISMO valor al que caia por defecto. Ese es todo el
    -- cambio, y es el que importa: ahora esta escrito, asi que se puede
    -- discutir. Antes no era una decision, era un hueco.
    if v_max_conn > 0 and v_total_conn > 0.8 * v_max_conn then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'La base de datos se acerca a su limite de conexiones: '
                     || v_total_conn || ' de ' || v_max_conn,
        p_message =>
          'Hay ' || v_total_conn || ' conexiones de CLIENTE abiertas de un maximo de '
          || v_max_conn || ', mas del 80 %.' || chr(10) || chr(10)
          || 'Mirar pg_stat_activity: puede ser el mismo patron del 11/08.',
        p_debounce_kind   => 'db-health-connections',
        p_debounce_window => interval '15 minutes',
        p_account_id      => NULL,
        p_location_id     => NULL,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      );
    end if;

    -- Aviso 4 — tickets sin imprimir. Desde el A01a (01/11) vive en
    -- print_job_vigia(): caduca lo que lleva más de 2 h pendiente (claim_print_jobs
    -- ya no lo coge) y avisa UNA vez al abrirse el problema (más de 15 min sin
    -- imprimir), otra si la cola se dobla y «Resuelto» al vaciarse. Antes
    -- repetía el mismo aviso cada hora: 24 al día con los 17 de Alcalá del 29/10.
    perform public.print_job_vigia();

    -- Aviso 5 — tickets encolados a una impresora marcada como inactiva, POR
    -- LOCAL, y SOLO de cuentas que operan.
    --
    -- Mismo arreglo que el 4, y aqui ademas se puede decir QUE impresora: sin
    -- el nombre, el aviso obliga a ir a buscarla a mano.
    --
    -- Se agrupa por el local del TRABAJO, no por el de la impresora. No es lo
    -- mismo por definicion, asi que se comprobo sobre la tabla entera: de los
    -- 9.488 print_job, CERO apuntan a una impresora de otro local. Agrupar por
    -- el del trabajo no parte hoy ningun aviso en dos.
    select count(*) into v_inactive_print
    from public.print_job pj
    join public.printer p on p.id = pj.printer_id
    where pj.status in ('pending', 'sent') and p.is_active = false
      and public.cuenta_opera(pj.account_id);
    if v_inactive_print > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Tickets encolados a una impresora apagada en Folvy: ' || t.n,
        p_message =>
          t.n || ' ticket(s) estan esperando en una impresora que en Folvy figura como INACTIVA: '
          || t.impresoras || '.' || chr(10) || chr(10)
          || 'No se van a imprimir nunca: la tablet solo recoge trabajos de impresoras activas.'
          || chr(10)
          || 'O se vuelve a marcar activa esa impresora, o esos tickets hay que mandarlos a otra.',
        p_debounce_kind   => 'db-health-print-inactive-printer_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select j.account_id, j.location_id, count(*) as n,
                   string_agg(distinct pr.name, ', ') as impresoras
              from public.print_job j
              join public.printer pr on pr.id = j.printer_id
             where j.status in ('pending', 'sent') and pr.is_active = false
               and public.cuenta_opera(j.account_id)
             group by j.account_id, j.location_id) t;
    end if;

    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa, POR LOCAL, y
    -- SOLO de cuentas que operan.
    --
    -- `print_route_failure_log` ya trae account_id y location_id: no habia que
    -- buscarlos, habia que dejar de tirarlos. El antirruido va por local, que
    -- antes era global y un local tapaba al otro durante una hora.
    --
    -- `perform ... from (...)` llama a encolar_alerta una vez por fila sin
    -- declarar variables nuevas: el resto de este cuerpo no se toca.
    --
    -- Este es el aviso que hizo ver el problema: las 100 filas de la tabla son
    -- 98 de una cuenta SUSPENDIDA y 2 de la plantilla. Cero de un cliente vivo.
    select count(*) into v_route_failures
    from public.print_route_failure_log
    where created_at >= now() - interval '10 minutes'
      and public.cuenta_opera(account_id);
    if v_route_failures > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Pedidos aceptados y sin imprimir: no hay ninguna impresora activa',
        p_message =>
          t.n || ' pedido(s) se han aceptado en los ultimos 10 minutos y no se han podido '
          || 'enviar a imprimir: el local no tiene ninguna impresora activa dada de alta.'
          || chr(10) || chr(10)
          || 'El pedido esta cocinandose sin ticket. Da de alta una impresora en ese local, '
          || 'o marcala como activa si ya existe.',
        p_debounce_kind   => 'db-health-print-no-active-printer_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select f.account_id, f.location_id, count(*) as n
              from public.print_route_failure_log f
             where f.created_at >= now() - interval '10 minutes'
               and public.cuenta_opera(f.account_id)
             group by f.account_id, f.location_id) t;
    end if;

  exception when others then
    -- raise warning PRIMERO: va a los logs del servidor y NO se revierte con
    -- el raise de abajo. El encolado si se revierte — se mantiene porque si la
    -- condicion persiste, el siguiente tick lo vuelve a intentar.
    raise warning 'db_health_watchdog: excepcion: %', sqlerrm;
    if not exists (
      select 1 from public.db_health_alert_log
      where kind = 'db-health-watchdog-error' and sent_at >= now() - interval '30 minutes'
    ) then
      perform public._queue_system_alert(
        'db-health-watchdog-error',
        'db_health_watchdog FALLO',
        'El vigia de salud de BBDD lanzo una excepcion: ' || sqlerrm,
        'db-health-watchdog-error'
      );
    end if;
    raise;
  end;
end;
$function$;
