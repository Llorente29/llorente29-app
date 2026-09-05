-- ENCARGO fix/kds-latido-raiz · Tarea A parte 1/2 — crea el latido de raiz.
-- 100% ADITIVA: no toca ninguna funcion existente ni quita ninguna escritura.
-- La parte 2/2 (retirar escrituras de las 13 lecturas) va DESPUES del bundle OTA
-- confirmado latiendo, y con servicio cerrado.
--
-- CORRECCION al fichero de Code (Julio/Claude, 11/08): el guard original comparaba
-- pg_get_function_identity_arguments() contra un texto CON defaults. Verificado en
-- vivo que identity_arguments NO incluye los DEFAULT (kds_board devuelve
-- 'p_location_id uuid, p_device_token text'), por lo que ese guard abortaba SIEMPRE
-- la migracion aunque la funcion se creara bien. Se compara contra
-- pg_get_function_arguments(), que si los incluye.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'kds_resolve_device'
  ) then
    raise exception 'kds_heartbeat_create: falta kds_resolve_device — RECON desactualizado, parar';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.kds_heartbeat(
  p_token text,
  p_app_version text DEFAULT NULL::text,
  p_platform text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_token);
  if v_device.id is null then
    return false;
  end if;
  update kds_device
  set last_seen_at   = now(),
      app_version    = coalesce(nullif(btrim(coalesce(p_app_version, '')), ''), app_version),
      platform       = coalesce(nullif(btrim(coalesce(p_platform, '')), ''), platform),
      app_version_at = case when nullif(btrim(coalesce(p_app_version, '')), '') is not null then now() else app_version_at end,
      updated_at     = now()
  where id = v_device.id
    and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  return true;
end;
$function$;

comment on function public.kds_heartbeat(text, text, text) is
  'Unico RPC pensado para escribir kds_device.last_seen_at (fix/kds-latido-raiz, '
  '11/08). Llamado por un solo setInterval de cliente. Hasta aplicar 20260816T0901 '
  'conviven con el las 13 funciones de lectura que aun escriben por su cuenta '
  '(mitigacion de emergencia del 11/08, freno de 30s).';

grant execute on function public.kds_heartbeat(text, text, text) to public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'kds_heartbeat'
      and pg_get_function_arguments(oid) = 'p_token text, p_app_version text DEFAULT NULL::text, p_platform text DEFAULT NULL::text'
  ) then
    raise exception 'kds_heartbeat_create: kds_heartbeat no quedo creada con la firma esperada';
  end if;
end $$;

notify pgrst, 'reload schema';