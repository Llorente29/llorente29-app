-- 20260827T1500_edge_drift_estado_y_vigia.sql
-- PROPUESTA. Revisar antes de ejecutar.
--
-- VIGIA DE DIVERGENCIA ENTRE LO DESPLEGADO Y `main`.
-- ============================================================================
-- POR QUE EXISTE. El 13/08 un despliegue de hubrise-webhook piso dos arreglos
-- que solo vivian en la version desplegada (la captura de collection_code y
-- resolveHubriseToken por conexion). Nadie se entero en 14 dias porque NADA
-- compara lo que corre en produccion con lo que hay en el repositorio.
--
-- REPARTO: la Edge Function `edge-drift-watchdog` recoge los HECHOS (que hay
-- desplegado, que hay en main, si el contenido coincide) y los deja aqui. El
-- JUICIO -- que es normal, que es divergencia y como de grave -- vive en SQL,
-- que es donde se puede leer, consultar y corregir sin desplegar nada.
--
-- ── LOS CINCO ESTADOS ────────────────────────────────────────────────────
--   ok                      lo desplegado y main coinciden.
--   ok_sin_desplegar        esta en el repo y nunca se desplego (p.ej.
--                           otter-webhook). No es divergencia: no corre nada.
--   sin_fuente_en_repo      corre en produccion y NO existe en main.
--                           Lo mas grave: codigo vivo que nadie puede leer.
--   deploy_sin_commit       el contenido difiere y el deploy es posterior al
--                           ultimo commit. ESTE es el caso del 13/08.
--   commit_sin_desplegar    el contenido difiere y main es mas nuevo: hay un
--                           arreglo commiteado que no esta corriendo.
--                           (Hoy mismo: hubrise-webhook, PR #114 sin desplegar.)
--
-- ── CUANDO NO SE PUEDE COMPARAR EL CONTENIDO ─────────────────────────────
-- El vigia intenta leer el fuente desplegado por la Management API. Si esa
-- respuesta no viene en un formato que se pueda leer, `contenido` queda en
-- 'no_comprobable' y el juicio cae a las FECHAS, con margen de 24 h para no
-- confundir "commiteado y desplegado el mismo dia" con divergencia:
--   main mas nuevo que el deploy + 24 h  -> commit_sin_desplegar (fiable:
--       una fecha de commit no depende de leer el contenido)
--   deploy mas nuevo que main + 24 h     -> posible_deploy_sin_commit (AVISO,
--       no CRITICO: sin el contenido no se puede probar que difieran; un
--       redespliegue del mismo codigo da esta misma forma)
--
-- ── LIMITACION, ESCRITA A PROPOSITO ──────────────────────────────────────
-- Si alguien despliega codigo sin commitear Y ademas commitea otra cosa en esa
-- misma funcion el mismo dia, la comparacion por fechas no lo ve. La
-- comparacion por contenido si. Por eso el contenido es el camino principal y
-- las fechas solo el respaldo.
-- ============================================================================

create table if not exists public.edge_function_deploy_state (
  slug               text primary key,
  repo_path          text,
  repo_blob_sha      text,          -- sha1 del blob en main (arbol de git)
  repo_commit_at     timestamptz,   -- ultimo commit de main que toco la funcion
  desplegada         boolean not null default false,
  deploy_version     integer,
  deploy_bundle_sha  text,          -- ezbr_sha256 de la version desplegada
  deploy_at          timestamptz,   -- cuando se desplego
  contenido          text not null default 'no_comprobable'
                     check (contenido in ('igual','distinto','no_comprobable')),
  contenido_detalle  text,          -- que ficheros difieren, si se sabe
  estado             text not null
                     check (estado in ('ok','ok_sin_desplegar','sin_fuente_en_repo',
                                       'deploy_sin_commit','commit_sin_desplegar',
                                       'posible_deploy_sin_commit')),
  drift_desde        timestamptz,   -- primera vez que se vio divergente
  comprobado_at      timestamptz not null default now()
);

comment on table public.edge_function_deploy_state is
  'Foto diaria de cada Edge Function: que corre en produccion vs que hay en main. '
  'La escribe edge-drift-watchdog via edge_drift_registrar().';

alter table public.edge_function_deploy_state enable row level security;
-- Sin politicas: es tabla de plataforma, no de cuenta. Solo service_role entra.
revoke all on public.edge_function_deploy_state from public, anon, authenticated;
grant select, insert, update, delete on public.edge_function_deploy_state to service_role;


-- ── Registro de hechos + juicio ─────────────────────────────────────────────
-- p_rows: [{slug, repo_path, repo_blob_sha, repo_commit_at, desplegada,
--           deploy_version, deploy_bundle_sha, deploy_at, contenido,
--           contenido_detalle}, ...]
-- Devuelve el recuento por estado. `drift_desde` solo se pone la PRIMERA vez
-- que una funcion pasa a divergente, y se borra al volver a 'ok': asi el aviso
-- puede decir desde cuando, no solo que.
create or replace function public.edge_drift_registrar(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'edge_drift_registrar: p_rows debe ser un array jsonb';
  end if;
  -- Un array vacio borraria la tabla entera por el delete de mas abajo. Una
  -- lectura fallida de la API no puede parecer "no hay ninguna funcion".
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'edge_drift_registrar: p_rows vacio; no se toca el estado';
  end if;

  with entrada as (
    select r.slug,
           r.repo_path,
           r.repo_blob_sha,
           r.repo_commit_at,
           coalesce(r.desplegada, false) as desplegada,
           r.deploy_version,
           r.deploy_bundle_sha,
           r.deploy_at,
           coalesce(nullif(r.contenido,''), 'no_comprobable') as contenido,
           r.contenido_detalle
      from jsonb_to_recordset(p_rows) as r(
             slug text, repo_path text, repo_blob_sha text,
             repo_commit_at timestamptz, desplegada boolean,
             deploy_version integer, deploy_bundle_sha text,
             deploy_at timestamptz, contenido text, contenido_detalle text)
     where nullif(btrim(r.slug), '') is not null
  ),
  juzgada as (
    select e.*,
           case
             when not e.desplegada and e.repo_path is not null then 'ok_sin_desplegar'
             when e.desplegada and e.repo_path is null         then 'sin_fuente_en_repo'
             when e.contenido = 'igual'                        then 'ok'
             when e.contenido = 'distinto'
                  and e.deploy_at > coalesce(e.repo_commit_at, '-infinity'::timestamptz)
                                                               then 'deploy_sin_commit'
             when e.contenido = 'distinto'                     then 'commit_sin_desplegar'
             -- contenido no comprobable: solo fechas, con margen de 24 h
             when e.repo_commit_at > e.deploy_at + interval '24 hours'
                                                               then 'commit_sin_desplegar'
             when e.deploy_at > coalesce(e.repo_commit_at, '-infinity'::timestamptz)
                                 + interval '24 hours'         then 'posible_deploy_sin_commit'
             else 'ok'
           end as estado
      from entrada e
  )
  insert into public.edge_function_deploy_state as t (
    slug, repo_path, repo_blob_sha, repo_commit_at, desplegada, deploy_version,
    deploy_bundle_sha, deploy_at, contenido, contenido_detalle, estado,
    drift_desde, comprobado_at)
  select j.slug, j.repo_path, j.repo_blob_sha, j.repo_commit_at, j.desplegada,
         j.deploy_version, j.deploy_bundle_sha, j.deploy_at, j.contenido,
         j.contenido_detalle, j.estado,
         case when j.estado in ('ok','ok_sin_desplegar') then null else now() end,
         now()
    from juzgada j
  on conflict (slug) do update
    set repo_path         = excluded.repo_path,
        repo_blob_sha     = excluded.repo_blob_sha,
        repo_commit_at    = excluded.repo_commit_at,
        desplegada        = excluded.desplegada,
        deploy_version    = excluded.deploy_version,
        deploy_bundle_sha = excluded.deploy_bundle_sha,
        deploy_at         = excluded.deploy_at,
        contenido         = excluded.contenido,
        contenido_detalle = excluded.contenido_detalle,
        estado            = excluded.estado,
        drift_desde       = case
                              when excluded.estado in ('ok','ok_sin_desplegar') then null
                              when t.estado in ('ok','ok_sin_desplegar')        then now()
                              else coalesce(t.drift_desde, now())
                            end,
        comprobado_at     = now();

  -- Una funcion borrada del proyecto deja de existir: no se arrastra su estado.
  delete from public.edge_function_deploy_state
   where slug not in (select slug from jsonb_to_recordset(p_rows) as r(slug text)
                       where nullif(btrim(r.slug),'') is not null);

  select jsonb_object_agg(estado, n) into v_res
    from (select estado, count(*) as n
            from public.edge_function_deploy_state group by estado) q;

  return coalesce(v_res, '{}'::jsonb);
end;
$function$;

revoke all on function public.edge_drift_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.edge_drift_registrar(jsonb) to service_role;


-- ── El aviso ────────────────────────────────────────────────────────────────
-- Un solo correo por vuelta con TODAS las funciones divergentes, no uno por
-- funcion: en el peor caso (un deploy masivo mal hecho) serian 60 correos.
-- La clave de debounce lleva la severidad y un hash de la lista, asi que el
-- silencio se rompe en cuanto la lista cambia o empeora. Ventana 20 h con cron
-- diario = un aviso al dia mientras siga roto.
create or replace function public.edge_drift_watchdog(
  p_debounce_window interval default interval '20 hours')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; v_sev text; v_lineas text := ''; v_n integer := 0; v_firma text := '';
begin
  for r in
    select s.*,
           case s.estado
             when 'sin_fuente_en_repo'        then 1
             when 'deploy_sin_commit'         then 2
             when 'commit_sin_desplegar'      then 3
             when 'posible_deploy_sin_commit' then 4
           end as orden
      from public.edge_function_deploy_state s
     where s.estado not in ('ok','ok_sin_desplegar')
     order by orden, s.slug
  loop
    v_n := v_n + 1;
    v_firma := v_firma || r.slug || ':' || r.estado || ';';
    v_lineas := v_lineas || '- ' || r.slug || ' [' || r.estado || ']' || chr(10)
      || '    desplegada: '
      || coalesce(to_char(r.deploy_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), 'nunca')
      || case when r.deploy_version is not null then ' (v' || r.deploy_version || ')' else '' end
      || chr(10)
      || '    ultimo commit en main: '
      || coalesce(to_char(r.repo_commit_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), 'sin fichero')
      || chr(10)
      || '    divergente desde: '
      || coalesce(to_char(r.drift_desde at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), '-')
      || case when r.contenido_detalle is not null
              then chr(10) || '    difiere: ' || r.contenido_detalle else '' end
      || chr(10);
  end loop;

  if v_n = 0 then
    return 0;
  end if;

  select case
           when count(*) filter (where estado in ('sin_fuente_en_repo','deploy_sin_commit')) > 0
             then 'CRITICO'
           when count(*) filter (where estado = 'commit_sin_desplegar') > 0 then 'ALTO'
           else 'AVISO'
         end
    into v_sev
    from public.edge_function_deploy_state
   where estado not in ('ok','ok_sin_desplegar');

  perform public._queue_system_alert(
    'edge_drift',
    v_sev || ': ' || v_n::text || ' Edge Function(s) no coinciden con main',
    'Lo que corre en produccion y lo que hay en el repositorio no son lo mismo:'
      || chr(10) || chr(10) || v_lineas || chr(10)
      || 'Que significa cada estado:' || chr(10)
      || '  sin_fuente_en_repo   corre codigo que no esta en main. Nadie puede leerlo '
      || 'ni revisarlo, y el proximo deploy lo borra.' || chr(10)
      || '  deploy_sin_commit    se desplego algo que no se commiteo. Es exactamente '
      || 'lo que paso el 13/08: 14 dias y 148 pedidos sin codigo de plataforma.' || chr(10)
      || '  commit_sin_desplegar hay un arreglo en main que no esta corriendo. '
      || 'Falta desplegarlo.' || chr(10)
      || '  posible_deploy_sin_commit  las fechas cuadran mal pero no se pudo leer el '
      || 'contenido desplegado para probarlo.' || chr(10) || chr(10)
      || 'Regla del proyecto: ninguna correccion vive solo en el desplegado. Si se toca '
      || 'una edge function, se commitea antes o inmediatamente despues.',
    'edge_drift_' || v_sev || '_' || md5(v_firma),
    p_debounce_window
  );

  return v_n;
end;
$function$;

revoke all on function public.edge_drift_watchdog(interval) from public, anon, authenticated;
grant execute on function public.edge_drift_watchdog(interval) to service_role;


-- Diario a las 07:10 de Madrid (05:10 UTC en horario de verano): el correo esta
-- puesto antes de que nadie despliegue nada, no a media noche.
select cron.schedule('edge-drift-watchdog', '10 5 * * *', $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/edge-drift-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret
                          from vault.decrypted_secrets
                         where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);

notify pgrst, 'reload schema';
