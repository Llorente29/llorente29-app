-- supabase/migrations/20261028T0706_l1a_corregir_con_conformidad.sql
--
-- L1a · PR 2 · segunda de dos (28/10/2026): lo que CAMBIA algo que ya existe.
-- Va después de la 0705, que añade las columnas, las tablas y _puede_corregir.
--
--   1. La conformidad: cuando el encargado o el administrador corrige un
--      fichaje de otra persona (añade, cambia, anula o devuelve una marca), la
--      fila del rastro nace «pendiente» y la persona la ve en su portal. Si la
--      corrección la pidió la propia persona (una petición aprobada), no hay
--      nada que aceptar: el rastro guarda de qué petición viene (peticion_id).
--   2. Corregir: edit_clock_entry, void_clock_entry y resolve_clock_correction
--      también para el encargado, con las personas de sus locales (como
--      add_manual_clock_entry desde la 1905). request_clock_correction: el
--      trabajador pide solo para sí mismo y en su nombre (hasta hoy, quien
--      llamaba decía quién pedía).
--   3. Corregir un fichaje de un mes firmado deja la firma sin valor: hay que
--      volver a firmar. La limpieza de ubicaciones no toca ninguna firma.
--
-- cambia: public.clock_entry_audit · prueba: supabase/staging/sql/20261028_l1a_correcciones_e_informe_prueba.sql
-- cambia: public.clock_entries · prueba: supabase/staging/sql/20261028_l1a_correcciones_e_informe_prueba.sql
-- cambia: public.edit_clock_entry · prueba: supabase/staging/sql/20261028_l1a_correcciones_e_informe_prueba.sql
-- cambia: public.void_clock_entry · prueba: supabase/staging/sql/20261028_l1a_correcciones_e_informe_prueba.sql
-- cambia: public.resolve_clock_correction · prueba: supabase/staging/sql/20261028_l1a_correcciones_e_informe_prueba.sql
-- cambia: public.request_clock_correction · prueba: supabase/staging/sql/20261028_l1a_correcciones_e_informe_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261028T0706_l1a_corregir_con_conformidad.down.sql

-- ── 1 · La conformidad: quién nace «pendiente» ─────────────────────────────
create or replace function public._clock_audit_conformidad()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_peticion text := nullif(current_setting('app.clock_peticion_id', true), '');
begin
  if new.action in ('create_manual', 'edit', 'void', 'restore') then
    if v_peticion is not null then
      new.peticion_id := v_peticion::uuid;
    elsif auth.uid() is not null
      and new.employee_id is not null
      and not public.current_user_is_employee(new.employee_id, new.account_id) then
      new.conformidad := 'pendiente';
    end if;
  end if;
  return new;
end $$;
revoke all on function public._clock_audit_conformidad() from public, anon, authenticated;

drop trigger if exists trg_clock_audit_conformidad on public.clock_entry_audit;
create trigger trg_clock_audit_conformidad before insert on public.clock_entry_audit
  for each row execute function public._clock_audit_conformidad();

-- ── 2 · Corregir: también el encargado, con las personas de sus locales ────
select public._respaldar_funcion('public.edit_clock_entry(uuid,timestamp with time zone,text,text,text)', '20261028T0706_l1a_corregir_con_conformidad');
select public._respaldar_funcion('public.void_clock_entry(uuid,text,text)', '20261028T0706_l1a_corregir_con_conformidad');
select public._respaldar_funcion('public.resolve_clock_correction(uuid,boolean,text,text)', '20261028T0706_l1a_corregir_con_conformidad');
select public._respaldar_funcion('public.request_clock_correction(uuid,uuid,text,text,uuid,text,timestamp with time zone)', '20261028T0706_l1a_corregir_con_conformidad');

create or replace function public.edit_clock_entry(p_entry_id uuid, p_datetime timestamp with time zone, p_reason text, p_type text default null::text, p_actor_label text default null::text)
 returns clock_entries
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_acct uuid; v_emp uuid; v_row public.clock_entries;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  select employee_id into v_emp from public.clock_entries where id = p_entry_id;
  if v_emp is null then raise exception 'FICHAJE_NO_EXISTE'; end if;
  v_acct := public._account_of_employee(v_emp);
  -- L1a (28/10): el administrador, o el encargado de esa persona (nunca a sí mismo).
  if not public._puede_corregir(v_emp, v_acct) then raise exception 'NO_AUTORIZADO'; end if;
  if p_type is not null and p_type not in ('entrada','salida') then raise exception 'TIPO_INVALIDO'; end if;

  perform set_config('app.clock_edit_reason', p_reason, true);
  perform set_config('app.clock_edit_actor', coalesce(p_actor_label,''), true);

  update public.clock_entries
     set datetime = p_datetime,
         real_datetime = p_datetime,
         type = coalesce(p_type, type)
   where id = p_entry_id
   returning * into v_row;
  return v_row;
end $function$;

create or replace function public.void_clock_entry(p_entry_id uuid, p_reason text, p_actor_label text default null::text)
 returns clock_entries
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_acct uuid; v_emp uuid; v_row public.clock_entries;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  select employee_id into v_emp from public.clock_entries where id = p_entry_id;
  if v_emp is null then raise exception 'FICHAJE_NO_EXISTE'; end if;
  v_acct := public._account_of_employee(v_emp);
  if not public._puede_corregir(v_emp, v_acct) then raise exception 'NO_AUTORIZADO'; end if;

  perform set_config('app.clock_edit_reason', p_reason, true);
  perform set_config('app.clock_edit_actor', coalesce(p_actor_label,''), true);

  update public.clock_entries set voided = true where id = p_entry_id returning * into v_row;
  return v_row;
end $function$;

create or replace function public.resolve_clock_correction(p_request_id uuid, p_approve boolean, p_note text default null::text, p_actor_label text default null::text)
 returns clock_correction_request
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r public.clock_correction_request; v_new public.clock_entries; v_loc uuid;
begin
  select * into r from public.clock_correction_request where id = p_request_id for update;
  if r.id is null then raise exception 'SOLICITUD_NO_EXISTE'; end if;
  if not public._puede_corregir(r.employee_id, r.account_id) then raise exception 'NO_AUTORIZADO'; end if;
  if r.status <> 'pending' then raise exception 'YA_RESUELTA'; end if;

  if p_approve then
    perform set_config('app.clock_edit_reason', 'Solicitud del trabajador: '||r.reason, true);
    perform set_config('app.clock_edit_actor', coalesce(p_actor_label,''), true);
    -- L1a (28/10): el rastro sabe de qué petición viene (y no pide conformidad:
    -- la pidió la propia persona).
    perform set_config('app.clock_peticion_id', r.id::text, true);

    if r.kind = 'add' then
      select location_id into v_loc from public.employees where id = r.employee_id;
      insert into public.clock_entries(employee_id, type, datetime, real_datetime, source, address, location_id_at_clock)
      values (r.employee_id, r.proposed_type, r.proposed_datetime, r.proposed_datetime, 'manual', 'Aprobado · '||r.reason, v_loc)
      returning * into v_new;
      insert into public.clock_entry_audit(
        clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, after)
      values (v_new.id, r.employee_id, r.account_id, 'create_manual', auth.uid(), p_actor_label, r.reason,
              public._clock_snapshot(v_new));
    elsif r.kind = 'edit' and r.clock_entry_id is not null then
      update public.clock_entries set datetime = r.proposed_datetime, real_datetime = r.proposed_datetime, type = coalesce(r.proposed_type, type)
       where id = r.clock_entry_id;
    elsif r.kind = 'void' and r.clock_entry_id is not null then
      update public.clock_entries set voided = true where id = r.clock_entry_id;
    end if;
    perform set_config('app.clock_peticion_id', '', true);
  end if;

  update public.clock_correction_request
     set status = case when p_approve then 'approved' else 'rejected' end,
         resolved_by_user_id = auth.uid(), resolved_at = now(), resolution_note = p_note
   where id = p_request_id
   returning * into r;

  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, peticion_id)
  values (coalesce(v_new.id, r.clock_entry_id), r.employee_id, r.account_id,
          case when p_approve then 'approve' else 'reject' end, auth.uid(), p_actor_label,
          coalesce(p_note, r.reason), r.id);

  insert into public.employee_notifications(employee_id, type, title, body, data)
  values (r.requested_by_employee_id, 'clock_correction_resolved',
          case when p_approve then 'Corrección aprobada' else 'Corrección rechazada' end,
          coalesce(p_note, r.reason),
          jsonb_build_object('request_id', r.id, 'status', r.status));
  return r;
end $function$;

create or replace function public.request_clock_correction(p_employee_id uuid, p_requested_by_employee_id uuid, p_kind text, p_reason text, p_clock_entry_id uuid default null::uuid, p_proposed_type text default null::text, p_proposed_datetime timestamp with time zone default null::timestamp with time zone)
 returns clock_correction_request
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_acct uuid; v_row public.clock_correction_request;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  if p_kind not in ('add','edit','void') then raise exception 'TIPO_INVALIDO'; end if;
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not (v_acct = any (public.current_user_account_ids())) then raise exception 'NO_AUTORIZADO'; end if;
  -- L1a (28/10): la pide la propia persona, en su nombre; o quien puede
  -- corregirla. Hasta hoy quien llamaba decía quién pedía, y para quién.
  if not (
       (p_requested_by_employee_id = p_employee_id and public.current_user_is_employee(p_employee_id, v_acct))
    or public._puede_corregir(p_employee_id, v_acct)
  ) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'Solo puedes pedir correcciones de tus propios fichajes.';
  end if;
  if p_clock_entry_id is not null and not exists (
    select 1 from public.clock_entries where id = p_clock_entry_id and employee_id = p_employee_id) then
    raise exception 'FICHAJE_NO_EXISTE' using errcode = '22023', hint = 'Ese fichaje no es de esa persona.';
  end if;

  insert into public.clock_correction_request(
    account_id, employee_id, requested_by_employee_id, clock_entry_id, kind, proposed_type, proposed_datetime, reason)
  values (v_acct, p_employee_id, p_requested_by_employee_id, p_clock_entry_id, p_kind, p_proposed_type, p_proposed_datetime, p_reason)
  returning * into v_row;

  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_employee_id, reason, after, peticion_id)
  values (p_clock_entry_id, p_employee_id, v_acct, 'request', p_requested_by_employee_id, p_reason, to_jsonb(v_row), v_row.id);
  return v_row;
end $function$;

-- ── 3 · Corregir un mes firmado pide volver a firmar ────────────────────────
-- Corregir un fichaje de un mes firmado deja la firma sin valor: hay que volver
-- a firmar. Solo lo que cambia el registro (el tipo, la hora o si está
-- anulada): la limpieza de ubicaciones no toca ninguna firma.
create or replace function public._registro_firma_invalidar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_meses date[];
begin
  if tg_op = 'UPDATE' then
    if new.type is not distinct from old.type
       and new.datetime is not distinct from old.datetime
       and new.real_datetime is not distinct from old.real_datetime
       and new.voided is not distinct from old.voided then
      return null;
    end if;
    v_meses := array[public._mes_madrid(coalesce(new.real_datetime, new.datetime)),
                     public._mes_madrid(coalesce(old.real_datetime, old.datetime))];
  else
    v_meses := array[public._mes_madrid(coalesce(new.real_datetime, new.datetime))];
  end if;
  update public.registro_jornada_firma
     set invalidada_at = now(),
         invalidada_motivo = 'Se corrigió un fichaje del mes después de firmarlo'
   where employee_id = new.employee_id and mes = any (v_meses) and invalidada_at is null;
  return null;
end $$;
revoke all on function public._registro_firma_invalidar() from public, anon, authenticated;

drop trigger if exists trg_registro_firma_invalidar on public.clock_entries;
create trigger trg_registro_firma_invalidar after insert or update on public.clock_entries
  for each row execute function public._registro_firma_invalidar();

