revoke all on function public._set_brand_closure_core(
  uuid, uuid[], text, timestamptz, text, text, uuid, uuid, text, text) from public;
revoke all on function public._set_brand_closure_core(
  uuid, uuid[], text, timestamptz, text, text, uuid, uuid, text, text) from anon;
grant execute on function public._set_brand_closure_core(
  uuid, uuid[], text, timestamptz, text, text, uuid, uuid, text, text) to service_role;

revoke all on function public._autoinventory_queue_core(
  uuid, uuid, integer, numeric, numeric, numeric, numeric) from public;
revoke all on function public._autoinventory_queue_core(
  uuid, uuid, integer, numeric, numeric, numeric, numeric) from anon;
grant execute on function public._autoinventory_queue_core(
  uuid, uuid, integer, numeric, numeric, numeric, numeric) to service_role;

-- ── GUARDA: los ocho nucleos, cerrados a anon ───────────────────────────────
do $ver$
declare v_abiertos text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_abiertos
  from pg_proc p
  where p.pronamespace='public'::regnamespace and p.prokind='f'
    and p.proname like '\_%\_core'
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_abiertos is not null then
    raise exception 'Siguen abiertos a anon: %', v_abiertos;
  end if;

  if to_regprocedure('public.set_brand_status(uuid, text, uuid, timestamptz, text, text)') is null then
    raise exception 'set_brand_status ha desaparecido';
  end if;

  raise notice 'VERIFICACION OK: los 8 nucleos sin guarda estan cerrados a anon';
end
$ver$;