-- Los flujos de alta/edición manual grababan real_datetime=now() (o no lo tocaban).
-- Un fichaje manual/corregido: la hora tecleada ES la hora real -> real_datetime = esa hora.

create or replace function public.add_manual_clock_entry(p_employee_id uuid, p_type text, p_datetime timestamptz, p_reason text, p_actor_label text default null)
 returns clock_entries language plpgsql security definer set search_path to 'public'
as $function$
declare v_acct uuid; v_row public.clock_entries; v_loc uuid;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  if p_type not in ('entrada','salida') then raise exception 'TIPO_INVALIDO'; end if;
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not public.current_user_is_admin_of(v_acct) then raise exception 'NO_AUTORIZADO'; end if;
  select location_id into v_loc from public.employees where id = p_employee_id;

  insert into public.clock_entries(employee_id, type, datetime, real_datetime, source, address, location_id_at_clock)
  values (p_employee_id, p_type, p_datetime, p_datetime, 'manual',
          'Manual · '||p_reason||coalesce(' · por '||p_actor_label,''), v_loc)
  returning * into v_row;

  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, before, after)
  values (v_row.id, p_employee_id, v_acct, 'create_manual', auth.uid(), p_actor_label, p_reason,
          null, public._clock_snapshot(v_row));
  return v_row;
end $function$;

create or replace function public.edit_clock_entry(p_entry_id uuid, p_datetime timestamptz, p_reason text, p_type text default null, p_actor_label text default null)
 returns clock_entries language plpgsql security definer set search_path to 'public'
as $function$
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
         real_datetime = p_datetime,
         type = coalesce(p_type, type)
   where id = p_entry_id
   returning * into v_row;
  return v_row;
end $function$;

create or replace function public.resolve_clock_correction(p_request_id uuid, p_approve boolean, p_note text default null, p_actor_label text default null)
 returns clock_correction_request language plpgsql security definer set search_path to 'public'
as $function$
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
end $function$;