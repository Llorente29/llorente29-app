-- 20260709T1200_clock_edit_audit.sql
-- Folvy Team — Editar fichajes con rastro legal (RD registro horario 2026).
--
-- Modelo aprobado por Julio: EDITAR EN SITIO + auditoría INMUTABLE impuesta por
-- TRIGGER. Ningún cambio en un fichaje escapa al log, venga de la app, del SQL
-- Editor o de un cliente rebelde. El original es reconstruible siempre; el borrado
-- es lógico (nunca físico); conservación 4 años; exportable para Inspección.
--
-- DISCIPLINA (regla de Julio): esta migración SOLO CREA objetos. NO ejecuta
-- ninguna función SECURITY DEFINER. Las RPC se prueban DESDE LA APP (hay sesión);
-- en el SQL Editor auth.uid() es null y las guardias de admin lanzarían excepción,
-- abortando la transacción. La verificación va en una consulta SEPARADA.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Borrado lógico en clock_entries (el fichaje anulado se conserva)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.clock_entries
  add column if not exists voided boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Auditoría append-only de cambios en fichajes
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.clock_entry_audit (
  id                 uuid primary key default gen_random_uuid(),
  clock_entry_id     uuid,        -- sin FK: el rastro sobrevive a cualquier cosa
  employee_id        uuid,
  account_id         uuid,
  action             text not null check (action in
                       ('create_manual','edit','void','restore','request','approve','reject')),
  actor_user_id      uuid,        -- auth.uid() del gestor (null si acción del trabajador/directa)
  actor_employee_id  uuid,        -- empleado que actúa (solicitudes del trabajador)
  actor_label        text,        -- nombre legible para el rastro
  reason             text,        -- motivo (obligatorio en edit/void vía RPC)
  before             jsonb,
  after              jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists ix_clock_audit_entry on public.clock_entry_audit(clock_entry_id);
create index if not exists ix_clock_audit_acct  on public.clock_entry_audit(account_id, created_at desc);

alter table public.clock_entry_audit enable row level security;
-- Lectura para miembros de la cuenta; la ESCRITURA solo por las funciones
-- SECURITY DEFINER (dueño = postgres, ignora RLS). Sin política insert/update/delete
-- + revoke = append-only para clientes normales.
drop policy if exists clock_audit_read on public.clock_entry_audit;
create policy clock_audit_read on public.clock_entry_audit
  for select using (account_id = any (current_user_account_ids()));
revoke insert, update, delete on public.clock_entry_audit from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Solicitudes de corrección del TRABAJADOR (procedimiento olvido/tardío)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.clock_correction_request (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null,
  employee_id               uuid not null,   -- de quién es el fichaje
  requested_by_employee_id  uuid not null,   -- quién lo pide
  clock_entry_id            uuid,            -- null = "olvidé fichar" (no existe aún)
  kind                      text not null check (kind in ('add','edit','void')),
  proposed_type             text check (proposed_type in ('entrada','salida')),
  proposed_datetime         timestamptz,
  reason                    text not null,
  status                    text not null default 'pending'
                              check (status in ('pending','approved','rejected','cancelled')),
  resolved_by_user_id       uuid,
  resolved_at               timestamptz,
  resolution_note           text,
  created_at                timestamptz not null default now()
);
create index if not exists ix_clock_req_acct
  on public.clock_correction_request(account_id, status, created_at desc);

alter table public.clock_correction_request enable row level security;
drop policy if exists clock_req_read   on public.clock_correction_request;
drop policy if exists clock_req_insert on public.clock_correction_request;
create policy clock_req_read on public.clock_correction_request
  for select using (account_id = any (current_user_account_ids()));
create policy clock_req_insert on public.clock_correction_request
  for insert with check (account_id = any (current_user_account_ids()));
-- La resolución (update) va SOLO por RPC SECURITY DEFINER; sin política de update.
revoke update, delete on public.clock_correction_request from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Snapshot y TRIGGER de auditoría — el corazón deuda-0
-- ─────────────────────────────────────────────────────────────────────────
-- Snapshot SIN photo_data_url (evita meter base64 en cada fila de auditoría).
create or replace function public._clock_snapshot(r public.clock_entries)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', r.id, 'type', r.type, 'datetime', r.datetime, 'real_datetime', r.real_datetime,
    'source', r.source, 'address', r.address, 'scheduled', r.scheduled,
    'rounding_applied', r.rounding_applied, 'diff_minutes', r.diff_minutes,
    'location_id_at_clock', r.location_id_at_clock, 'voided', r.voided
  )
$$;

create or replace function public.tg_clock_entry_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(current_setting('app.clock_edit_reason', true), '');
  v_actor  text := nullif(current_setting('app.clock_edit_actor',  true), '');
  v_action text;
  v_acct   uuid;
begin
  select l.account_id into v_acct
  from public.employees e join public.locations l on l.id = e.location_id
  where e.id = coalesce(NEW.employee_id, OLD.employee_id);

  if TG_OP = 'UPDATE' then
    if NEW.voided is distinct from OLD.voided then
      v_action := case when NEW.voided then 'void' else 'restore' end;
    else
      v_action := 'edit';
    end if;
    insert into public.clock_entry_audit(
      clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, before, after)
    values (OLD.id, OLD.employee_id, v_acct, v_action, auth.uid(), v_actor,
            coalesce(v_reason, '(sin motivo — edición directa)'),
            public._clock_snapshot(OLD), public._clock_snapshot(NEW));
    return NEW;

  elsif TG_OP = 'DELETE' then
    insert into public.clock_entry_audit(
      clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, before, after)
    values (OLD.id, OLD.employee_id, v_acct, 'void', auth.uid(), v_actor,
            coalesce(v_reason, '(sin motivo — borrado físico directo)'),
            public._clock_snapshot(OLD), null);
    return OLD;
  end if;
  return null;
end $$;

drop trigger if exists clock_entry_audit_aud on public.clock_entries;
create trigger clock_entry_audit_aud
  after update or delete on public.clock_entries
  for each row execute function public.tg_clock_entry_audit();

-- ─────────────────────────────────────────────────────────────────────────
-- 5) RPCs (SECURITY DEFINER, guardia de admin + motivo obligatorio)
-- ─────────────────────────────────────────────────────────────────────────

-- helper: cuenta de un empleado
create or replace function public._account_of_employee(p_employee_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select l.account_id from public.employees e
  join public.locations l on l.id = e.location_id
  where e.id = p_employee_id
$$;

-- 5.1 ALTA MANUAL con HORA elegible (cierra "olvidó fichar a las 9:00")
drop function if exists public.add_manual_clock_entry(uuid, text, timestamptz, text, text);
create function public.add_manual_clock_entry(
  p_employee_id uuid, p_type text, p_datetime timestamptz, p_reason text, p_actor_label text default null)
returns public.clock_entries language plpgsql security definer set search_path = public as $$
declare v_acct uuid; v_row public.clock_entries; v_loc uuid;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  if p_type not in ('entrada','salida') then raise exception 'TIPO_INVALIDO'; end if;
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not public.current_user_is_admin_of(v_acct) then raise exception 'NO_AUTORIZADO'; end if;
  select location_id into v_loc from public.employees where id = p_employee_id;

  insert into public.clock_entries(employee_id, type, datetime, real_datetime, source, address, location_id_at_clock)
  values (p_employee_id, p_type, p_datetime, now(), 'manual',
          'Manual · '||p_reason||coalesce(' · por '||p_actor_label,''), v_loc)
  returning * into v_row;

  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, before, after)
  values (v_row.id, p_employee_id, v_acct, 'create_manual', auth.uid(), p_actor_label, p_reason,
          null, public._clock_snapshot(v_row));
  return v_row;
end $$;

-- 5.2 EDITAR hora/tipo de un fichaje existente (el trigger audita before/after)
drop function if exists public.edit_clock_entry(uuid, timestamptz, text, text, text);
create function public.edit_clock_entry(
  p_entry_id uuid, p_datetime timestamptz, p_reason text,
  p_type text default null, p_actor_label text default null)
returns public.clock_entries language plpgsql security definer set search_path = public as $$
declare v_acct uuid; v_emp uuid; v_row public.clock_entries;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  select employee_id into v_emp from public.clock_entries where id = p_entry_id;
  if v_emp is null then raise exception 'FICHAJE_NO_EXISTE'; end if;
  v_acct := public._account_of_employee(v_emp);
  if not public.current_user_is_admin_of(v_acct) then raise exception 'NO_AUTORIZADO'; end if;
  if p_type is not null and p_type not in ('entrada','salida') then raise exception 'TIPO_INVALIDO'; end if;

  perform set_config('app.clock_edit_reason', p_reason, true);
  perform set_config('app.clock_edit_actor', coalesce(p_actor_label,''), true);

  update public.clock_entries
     set datetime = p_datetime,
         type     = coalesce(p_type, type)
   where id = p_entry_id
   returning * into v_row;
  return v_row;
end $$;

-- 5.3 ANULAR (borrado lógico, nunca físico)
drop function if exists public.void_clock_entry(uuid, text, text);
create function public.void_clock_entry(
  p_entry_id uuid, p_reason text, p_actor_label text default null)
returns public.clock_entries language plpgsql security definer set search_path = public as $$
declare v_acct uuid; v_emp uuid; v_row public.clock_entries;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  select employee_id into v_emp from public.clock_entries where id = p_entry_id;
  if v_emp is null then raise exception 'FICHAJE_NO_EXISTE'; end if;
  v_acct := public._account_of_employee(v_emp);
  if not public.current_user_is_admin_of(v_acct) then raise exception 'NO_AUTORIZADO'; end if;

  perform set_config('app.clock_edit_reason', p_reason, true);
  perform set_config('app.clock_edit_actor', coalesce(p_actor_label,''), true);

  update public.clock_entries set voided = true where id = p_entry_id returning * into v_row;
  return v_row;
end $$;

-- 5.4 el TRABAJADOR SOLICITA corregir (olvido / tardío / error)
drop function if exists public.request_clock_correction(uuid, uuid, text, text, uuid, text, timestamptz);
create function public.request_clock_correction(
  p_employee_id uuid, p_requested_by_employee_id uuid, p_kind text, p_reason text,
  p_clock_entry_id uuid default null, p_proposed_type text default null, p_proposed_datetime timestamptz default null)
returns public.clock_correction_request language plpgsql security definer set search_path = public as $$
declare v_acct uuid; v_row public.clock_correction_request;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  if p_kind not in ('add','edit','void') then raise exception 'TIPO_INVALIDO'; end if;
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not (v_acct = any (public.current_user_account_ids())) then raise exception 'NO_AUTORIZADO'; end if;

  insert into public.clock_correction_request(
    account_id, employee_id, requested_by_employee_id, clock_entry_id, kind, proposed_type, proposed_datetime, reason)
  values (v_acct, p_employee_id, p_requested_by_employee_id, p_clock_entry_id, p_kind, p_proposed_type, p_proposed_datetime, p_reason)
  returning * into v_row;

  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_employee_id, reason, after)
  values (p_clock_entry_id, p_employee_id, v_acct, 'request', p_requested_by_employee_id, p_reason, to_jsonb(v_row));
  return v_row;
end $$;

-- 5.5 el GESTOR RESUELVE (aprobar aplica el cambio auditado; ambos avisan al trabajador)
drop function if exists public.resolve_clock_correction(uuid, boolean, text, text);
create function public.resolve_clock_correction(
  p_request_id uuid, p_approve boolean, p_note text default null, p_actor_label text default null)
returns public.clock_correction_request language plpgsql security definer set search_path = public as $$
declare r public.clock_correction_request; v_new public.clock_entries; v_loc uuid;
begin
  select * into r from public.clock_correction_request where id = p_request_id for update;
  if r.id is null then raise exception 'SOLICITUD_NO_EXISTE'; end if;
  if not public.current_user_is_admin_of(r.account_id) then raise exception 'NO_AUTORIZADO'; end if;
  if r.status <> 'pending' then raise exception 'YA_RESUELTA'; end if;

  if p_approve then
    perform set_config('app.clock_edit_reason', 'Solicitud del trabajador: '||r.reason, true);
    perform set_config('app.clock_edit_actor', coalesce(p_actor_label,''), true);

    if r.kind = 'add' then
      select location_id into v_loc from public.employees where id = r.employee_id;
      insert into public.clock_entries(employee_id, type, datetime, real_datetime, source, address, location_id_at_clock)
      values (r.employee_id, r.proposed_type, r.proposed_datetime, now(), 'manual', 'Aprobado · '||r.reason, v_loc)
      returning * into v_new;
      insert into public.clock_entry_audit(
        clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, after)
      values (v_new.id, r.employee_id, r.account_id, 'create_manual', auth.uid(), p_actor_label, r.reason,
              public._clock_snapshot(v_new));
    elsif r.kind = 'edit' and r.clock_entry_id is not null then
      update public.clock_entries set datetime = r.proposed_datetime, type = coalesce(r.proposed_type, type)
       where id = r.clock_entry_id;                    -- el trigger audita el edit
    elsif r.kind = 'void' and r.clock_entry_id is not null then
      update public.clock_entries set voided = true where id = r.clock_entry_id;  -- el trigger audita el void
    end if;
  end if;

  update public.clock_correction_request
     set status = case when p_approve then 'approved' else 'rejected' end,
         resolved_by_user_id = auth.uid(), resolved_at = now(), resolution_note = p_note
   where id = p_request_id
   returning * into r;

  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason)
  values (r.clock_entry_id, r.employee_id, r.account_id,
          case when p_approve then 'approve' else 'reject' end, auth.uid(), p_actor_label,
          coalesce(p_note, r.reason));

  insert into public.employee_notifications(employee_id, type, title, body, data)
  values (r.requested_by_employee_id, 'clock_correction_resolved',
          case when p_approve then 'Corrección aprobada' else 'Corrección rechazada' end,
          coalesce(p_note, r.reason),
          jsonb_build_object('request_id', r.id, 'status', r.status));
  return r;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) GRANTs
-- ─────────────────────────────────────────────────────────────────────────
grant execute on function public.add_manual_clock_entry(uuid,text,timestamptz,text,text)              to authenticated;
grant execute on function public.edit_clock_entry(uuid,timestamptz,text,text,text)                     to authenticated;
grant execute on function public.void_clock_entry(uuid,text,text)                                      to authenticated;
grant execute on function public.request_clock_correction(uuid,uuid,text,text,uuid,text,timestamptz)   to authenticated;
grant execute on function public.resolve_clock_correction(uuid,boolean,text,text)                      to authenticated;

commit;
