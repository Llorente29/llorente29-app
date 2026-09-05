-- C9 · Lote 2 §5, CORREGIDO en el momento (04/09/2026).
--
-- LA VERSION ANTERIOR DE ESTA PURGA ESTABA ROTA Y NO SE HABRIA VISTO HASTA LA
-- PRIMERA EJECUCION NOCTURNA. Leia `project_url` y `service_role_key` de Vault
-- y NINGUNO DE LOS DOS EXISTE en este proyecto (comprobado: Vault tiene 14
-- secretos y no estan). Habria lanzado excepcion cada noche.
--
-- Y la salida facil era peor que el problema: meter la service_role key en
-- Vault, o en el comando del cron como hace `compliance-doc-notify`, es dejar
-- una llave maestra en un sitio nuevo para poder borrar ficheros.
--
-- ASI QUE LA PURGA CAMBIA DE SITIO. El borrado lo hace una edge function, que
-- YA tiene `SUPABASE_SERVICE_ROLE_KEY` en su entorno por definicion: ninguna
-- llave nueva en ningun sitio nuevo. El cron solo la despierta con el
-- `cron_secret`, que es el patron que ya usan edge-drift-watchdog y compañia.
--
-- SQL se queda con las dos piezas que SI son de la base:
--   `capturas_a_purgar()`        dice QUE toca borrar (solo lectura).
--   `marcar_capturas_purgadas()` sella `purged_at` cuando el objeto ya no esta.

drop function if exists public.purgar_capturas(int);

create or replace function public.marcar_capturas_purgadas(p_ids uuid[])
returns int
language sql
security definer
set search_path to 'public'
as $function$
  with hechas as (
    update public.sale_capture
       set purged_at = now()
     where id = any(p_ids) and purged_at is null
    returning 1
  )
  select count(*)::int from hechas;
$function$;

comment on function public.marcar_capturas_purgadas(uuid[]) is
  'C9 L2 §5: sella purged_at DESPUES de que el objeto se haya borrado del bucket. La fila no se borra: queda de recibo de que la foto existio y de que se purgo.';

revoke all on function public.marcar_capturas_purgadas(uuid[]) from public, anon, authenticated;
grant execute on function public.marcar_capturas_purgadas(uuid[]) to service_role;

create or replace function public.capturas_estado_purga()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'vivas',                     (select count(*) from public.sale_capture where purged_at is null),
    'purgadas',                  (select count(*) from public.sale_capture where purged_at is not null),
    'retenidas_por_reclamacion', (select count(*) from public.sale_capture
                                   where purged_at is null and hold_until is not null and hold_until > now()),
    'sin_plazo_definido',        (select count(*) from public.sale_capture c
                                   where c.purged_at is null
                                     and not exists (select 1 from public.kitchen_settings k
                                                      where k.account_id = c.account_id
                                                        and k.photo_retention_days is not null)),
    'pendientes_de_purgar',      (select count(*) from public.capturas_a_purgar(100000))
  );
$function$;

comment on function public.capturas_estado_purga() is
  'C9 L2 §5: el estado completo, no solo «cuantas borre». Incluye las retenidas por reclamacion abierta y las que estan sin plazo definido, que son las dos formas de que una foto se quede para siempre sin que nadie se entere.';

revoke all on function public.capturas_estado_purga() from public, anon, authenticated;
grant execute on function public.capturas_estado_purga() to service_role;

do $verif$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='purgar_capturas') then
    raise exception 'C9 L2: la purga vieja por SQL sigue viva; se queda la de la edge function.';
  end if;
  if has_function_privilege('anon','public.marcar_capturas_purgadas(uuid[])','EXECUTE')
     or has_function_privilege('authenticated','public.marcar_capturas_purgadas(uuid[])','EXECUTE') then
    raise exception 'C9 L2: marcar_capturas_purgadas esta abierta a anon/authenticated.';
  end if;
  if has_function_privilege('anon','public.capturas_estado_purga()','EXECUTE')
     or has_function_privilege('authenticated','public.capturas_estado_purga()','EXECUTE') then
    raise exception 'C9 L2: capturas_estado_purga esta abierta a anon/authenticated.';
  end if;
end
$verif$;
