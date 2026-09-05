alter table product_availability
  add column if not exists target_kind text not null default 'product';

alter table product_availability drop constraint if exists product_availability_target_kind_chk;
alter table product_availability add constraint product_availability_target_kind_chk
  check (target_kind in ('product', 'modifier_option'));

comment on column product_availability.target_kind is
  'product -> se empuja como sku_ref · modifier_option -> como option_ref. Mismo anclaje external_id + location_id para los dos.';

alter table availability_event drop constraint if exists availability_event_scope_check;
alter table availability_event add constraint availability_event_scope_check
  check (scope in ('product', 'brand', 'location', 'modifier_option'));

create or replace function public._set_modifier_option_availability_core(
  p_option_id       uuid,
  p_is_available    boolean,
  p_location_id     uuid,
  p_reason          text,
  p_available_until timestamptz,
  p_reason_code     text,
  p_account_id      uuid,
  p_actor           uuid,
  p_origin          text,
  p_surface         text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $core$
declare
  v_account_id  uuid;
  v_external_id text;
  v_name        text;
  v_refs        text[];
  v_action      text;
  v_reason_code text;
begin
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception '_set_modifier_option_availability_core: reason no valido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception '_set_modifier_option_availability_core: reason_code no valido %', p_reason_code;
  end if;

  select mo.account_id, mo.external_id, mo.name
    into v_account_id, v_external_id, v_name
  from modifier_option mo where mo.id = p_option_id;

  if v_account_id is null then
    raise exception '_set_modifier_option_availability_core: opcion % no encontrada', p_option_id;
  end if;
  if v_account_id <> p_account_id then
    raise exception '_set_modifier_option_availability_core: opcion % no pertenece a la cuenta %', p_option_id, p_account_id;
  end if;
  -- Sin external_id no hay ref que empujar: HubRise publica optRef(o) =
  -- external_id, y sin el, el PATCH no encontraria nada. Se falla en voz alta
  -- en vez de escribir una fila que no llega a ninguna parte.
  if v_external_id is null then
    raise exception '_set_modifier_option_availability_core: la opcion "%" no tiene external_id, no se puede agotar en el canal', v_name;
  end if;

  -- TODAS las opciones que comparten ese external_id: las gemelas incluidas.
  select array_agg(distinct mo.external_id)
    into v_refs
  from modifier_option mo
  where mo.account_id = v_account_id and mo.external_id = v_external_id;

  if p_is_available then
    delete from product_availability pa
     where pa.account_id = v_account_id
       and pa.target_kind = 'modifier_option'
       and pa.external_id = v_external_id
       and (p_location_id is null or pa.location_id = p_location_id or pa.location_id is null);
  else
    delete from product_availability pa
     where pa.account_id = v_account_id
       and pa.target_kind = 'modifier_option'
       and pa.external_id = v_external_id
       and pa.location_id is not distinct from p_location_id;

    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id, is_available, reason,
       available_until, set_by, target_kind)
    values
      (v_account_id, v_external_id, null, p_location_id, false, p_reason,
       p_available_until, p_actor, 'modifier_option');
  end if;

  v_action := case when p_is_available then 'open' else 'close' end;
  v_reason_code := case when v_action = 'close' then coalesce(p_reason_code,
    case p_reason when 'stock_out' then 'sin_stock' when 'schedule' then 'fin_servicio'
                  when 'manual' then 'otro' else null end) else null end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_ext, target_label, location_id, action,
       origin, reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'modifier_option', p_option_id, v_external_id, v_name,
       p_location_id, v_action, p_origin, v_reason_code, null, p_actor, p_surface,
       case when v_action = 'close' then p_available_until else null end);
  exception when others then
    raise warning '_set_modifier_option_availability_core: fallo insertando availability_event: %', sqlerrm;
  end;

  -- `option_refs` (no `matriculas`) para que el dispatch NO los confunda con
  -- skus de producto: son campos distintos en el PATCH de HubRise.
  return jsonb_build_object(
    'option_refs', coalesce(to_jsonb(v_refs), '[]'::jsonb),
    'label', coalesce(v_name, '(opcion)'),
    'available_until', p_available_until);
end;
$core$;

revoke execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) from public;
revoke execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) from anon;
revoke execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) from authenticated;
grant  execute on function public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text) to service_role;

create or replace function public.set_modifier_option_availability(
  p_option_id       uuid,
  p_is_available    boolean,
  p_location_id     uuid    default null,
  p_reason          text    default 'stock_out',
  p_available_until timestamptz default null,
  p_reason_code     text    default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $wrap$
declare
  v_acct uuid;
begin
  select account_id into v_acct from modifier_option where id = p_option_id;
  if v_acct is null then
    raise exception 'set_modifier_option_availability: opcion % no encontrada', p_option_id;
  end if;
  if not (v_acct = any(public.current_user_account_ids())) then
    raise exception 'set_modifier_option_availability: sin acceso a la cuenta %', v_acct;
  end if;
  if p_location_id is not null and not exists (
      select 1 from locations l where l.id = p_location_id and l.account_id = v_acct) then
    raise exception 'set_modifier_option_availability: el local % no es de esta cuenta', p_location_id;
  end if;

  return public._set_modifier_option_availability_core(
    p_option_id, p_is_available, p_location_id, p_reason, p_available_until,
    p_reason_code, v_acct, auth.uid(), 'oficina', 'web');
end;
$wrap$;

revoke execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) from public;
revoke execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) from anon;
grant  execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) to authenticated, service_role;

do $verif$
declare
  v_n int;
begin
  if to_regprocedure('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)') is null then
    raise exception 'el envoltorio no quedo creado';
  end if;

  if has_function_privilege('anon', 'public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public._set_modifier_option_availability_core(uuid,boolean,uuid,text,timestamptz,text,uuid,uuid,text,text)', 'execute') then
    raise exception 'el nucleo sin guarda nacio alcanzable por anon o authenticated';
  end if;
  if has_function_privilege('anon', 'public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)', 'execute') then
    raise exception 'anon alcanza el envoltorio';
  end if;

  select count(*) into v_n from product_availability where target_kind <> 'product';
  if v_n <> 0 then
    raise exception 'alguna fila existente nacio marcada como opcion: %', v_n;
  end if;

  select count(*) into v_n from modifier_option
   where name ilike '%milanesa%ternera%' and external_id is not null;
  if v_n < 4 then
    raise exception 'esperaba al menos 4 filas de milanesa de ternera con external_id y hay %', v_n;
  end if;

  raise notice 'VERIFICACION OK: target_kind en su sitio, nucleo cerrado, % filas de milanesa alcanzables', v_n;
end;
$verif$;