-- Los tres nucleos creados el 29/08 quedaban ejecutables por `authenticated`,
-- mientras los cinco anteriores no. Un core NO lleva guarda de permisos a
-- proposito, asi que con una sesion de CUALQUIER cuenta se podia llamar a
-- _set_brand_closure_core con un p_account_id arbitrario y cerrar cualquier
-- marca en cualquier local. Es la fuga F0 de multi-inquilino, justo la que
-- bloquea al cliente 2.
-- Ningun front llama a un _core directamente (verificado por grep). Los
-- llamadores legitimos son SECURITY DEFINER de postgres o pg_cron.
revoke all on function public._set_brand_closure_core(
  uuid, uuid[], text, timestamptz, text, text, uuid, uuid, text, text) from authenticated;
revoke all on function public._autoinventory_queue_core(
  uuid, uuid, integer, numeric, numeric, numeric, numeric) from authenticated;
revoke all on function public._generate_daily_count_core(
  uuid, uuid, uuid[], integer, numeric, boolean) from authenticated;

do $ver$
declare v_abiertos text;
begin
  select string_agg(p.proname || ' (' ||
           case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon ' else '' end ||
           case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated' else '' end || ')',
         ', ' order by p.proname)
    into v_abiertos
  from pg_proc p
  where p.pronamespace='public'::regnamespace and p.prokind='f'
    and p.proname like '\_%\_core'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if v_abiertos is not null then
    raise exception 'Nucleos sin guarda todavia alcanzables: %', v_abiertos;
  end if;

  -- Y que service_role sigue pudiendo, que es quien los necesita.
  if not has_function_privilege('service_role',
        'public._set_brand_closure_core(uuid, uuid[], text, timestamptz, text, text, uuid, uuid, text, text)', 'EXECUTE') then
    raise exception 'service_role ha perdido _set_brand_closure_core';
  end if;

  raise notice 'VERIFICACION OK: los 8 nucleos sin guarda solo alcanzables por su propietario y service_role';
end
$ver$;