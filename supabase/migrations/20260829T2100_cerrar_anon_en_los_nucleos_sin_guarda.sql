-- 20260829T2100_cerrar_anon_en_los_nucleos_sin_guarda.sql
-- ============================================================================
-- DOS NUCLEOS SIN GUARDA ABIERTOS A anon. LOS DEJE YO ASI HOY.
--
-- El patron de la casa es: los `_*_core` NO llevan guarda de permisos -- se
-- extrajeron precisamente para poder llamarlos sin sesion (pg_cron) -- y por
-- eso el permiso es lo UNICO que los protege. Los seis nucleos anteriores lo
-- tienen bien: anon revocado.
--
--   _availability_panel_core          anon NO   ok
--   _generate_daily_count_core        anon NO   ok
--   _resolve_unmapped_link_core       anon NO   ok
--   _scope_preview_core               anon NO   ok
--   _set_product_availability_core    anon NO   ok
--   _create_dish_from_unmapped_core   anon NO   ok (ademas lleva guarda)
--   _autoinventory_queue_core         anon SI   <-- creado hoy 29/08 por la manana
--   _set_brand_closure_core           anon SI   <-- creado hoy 29/08 por la tarde
--
-- Los dos que fallan son los dos que escribi hoy. Al crear una funcion nueva en
-- `public`, pg_default_acl le concede EXECUTE a anon, authenticated y
-- service_role, y PostgreSQL ademas se lo concede a PUBLIC. Si nadie revoca, se
-- queda abierta. No lo hice.
--
-- QUE PERMITIA
--   _set_brand_closure_core: cerrar o reabrir CUALQUIER marca en CUALQUIER
--   local, saltandose las dos RPC que si comprueban permiso, con solo la clave
--   anonima. Recibe p_account_id como parametro y se fia de el.
--   _autoinventory_queue_core: encolar conteos de inventario igual.
--
-- QUE NO SE ROMPE AL CERRARLO
--   Los llamadores legitimos son SECURITY DEFINER propiedad de postgres
--   (set_brand_status, set_brand_status_by_token) o el propio pg_cron, y se
--   ejecutan con los privilegios del propietario: el permiso de anon no
--   interviene. Verificado que ningun front llama a un `_core` directamente.
--
-- Aplicable por separado del encargo de la ficha, a proposito: esto es deuda
-- mia de hoy y no debe esperar a que se despliegue un front.
-- ============================================================================

begin;

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

  -- Y que los legitimos siguen pudiendo: las dos RPC de marca son SECURITY
  -- DEFINER de postgres, asi que esto solo comprueba que no se han roto.
  if to_regprocedure('public.set_brand_status(uuid, text, uuid, timestamptz, text, text)') is null then
    raise exception 'set_brand_status ha desaparecido';
  end if;

  raise notice 'VERIFICACION OK: los 8 nucleos sin guarda estan cerrados a anon';
end
$ver$;

commit;

-- ── Comprobacion DESPUES de aplicar ─────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede
--   from pg_proc p
--  where p.pronamespace='public'::regnamespace and p.proname like '\_%\_core'
--  order by 1;
--    -- esperado: los 8 con anon_puede = false.
