-- El envoltorio de opciones dispara el despachador, igual que el de productos.
-- Sin esto la fila se escribe en product_availability y NO llega a HubRise: un
-- 86 que solo existe en nuestra base de datos es exactamente el fallo silencioso
-- que se viene arreglando todo el dia.
--
-- El secreto sale del Vault (availability_dispatch_secret), como en
-- set_product_availability. Si falta, se avisa en voz alta y NO se finge exito.
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
  v_acct   uuid;
  v_res    jsonb;
  v_refs   text[];
  v_secret text;
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

  v_res := public._set_modifier_option_availability_core(
    p_option_id, p_is_available, p_location_id, p_reason, p_available_until,
    p_reason_code, v_acct, auth.uid(), 'oficina', 'web');

  select array_agg(x) into v_refs
  from jsonb_array_elements_text(v_res->'option_refs') x;

  if v_refs is not null and array_length(v_refs, 1) > 0 then
    select decrypted_secret into v_secret from vault.decrypted_secrets
     where name = 'availability_dispatch_secret';
    if v_secret is not null then
      -- Se manda SOLO option_refs: sin `matriculas`, para que el despachador no
      -- confunda un ref de opcion con un sku de producto. expires_at lo pone el
      -- despachador desde available_until, igual que en los productos: un 86 que
      -- se olvida se cura solo en la plataforma.
      perform net.http_post(
        url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object('Content-Type','application/json','x-availability-dispatch-secret', v_secret),
        body := jsonb_build_object(
          'account_id', v_acct,
          'option_refs', to_jsonb(v_refs),
          'location_id', p_location_id,
          'available_until', p_available_until,
          'enable', p_is_available,
          'reason', p_reason));
      v_res := v_res || jsonb_build_object('dispatched', true);
    else
      raise warning 'set_modifier_option_availability: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
      v_res := v_res || jsonb_build_object('dispatched', false, 'warning', 'sin secreto en Vault');
    end if;
  end if;

  return v_res;
end;
$wrap$;

revoke execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) from public;
revoke execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) from anon;
grant  execute on function public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text) to authenticated, service_role;

do $verif$
declare v_src text;
begin
  v_src := pg_get_functiondef('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)'::regprocedure);
  if position('net.http_post' in v_src) = 0 then
    raise exception 'el envoltorio no dispara el despachador: el 86 se quedaria solo en nuestra base de datos';
  end if;
  if position('''matriculas''' in v_src) > 0 then
    raise exception 'manda matriculas: un ref de opcion no puede viajar como sku de producto';
  end if;
  if has_function_privilege('anon', 'public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)', 'execute') then
    raise exception 'anon alcanza el envoltorio';
  end if;
  raise notice 'VERIFICACION OK: el envoltorio dispara el despachador solo con option_refs';
end;
$verif$;