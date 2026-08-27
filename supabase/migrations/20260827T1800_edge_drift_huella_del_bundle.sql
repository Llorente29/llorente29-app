-- 20260827T1800_edge_drift_huella_del_bundle.sql
-- APLICADA en produccion el 27-08-2026.
--
-- HUELLA DEL BUNDLE: DETECTAR EL DESPLIEGUE, NO EL CONTENIDO.
-- ============================================================================
-- POR QUE CAMBIA EL CRITERIO. El plan era comparar el fuente desplegado con
-- main byte a byte. MEDIDO en produccion sobre las 65 funciones: no se puede.
-- El endpoint de la Management API que devuelve el cuerpo de una funcion
-- responde 200 con content-type application/octet-stream -- el bundle eszip en
-- BINARIO, no el fuente en JSON. El token esta bien (es 200, no 403); es que
-- ese endpoint no da lo que yo supuse, y como no esta documentado, lo supuse
-- mal. Queda escrito aqui para que nadie lo vuelva a intentar sin saberlo.
--
-- LO QUE SI SE PUEDE. `ezbr_sha256` es la huella del bundle desplegado y CAMBIA
-- en cada despliegue. No dice QUE cambio, pero dice QUE HUBO UN DESPLIEGUE, y
-- eso basta para el caso que nos interesa:
--
--     hubo un despliegue nuevo Y no hubo ningun commit a esa funcion desde la
--     vuelta anterior  ->  se desplego algo que no esta en el repositorio.
--
-- Eso es, literalmente, el 13/08.
--
-- ── POR QUE ESTO MATA 5 FALSAS ALARMAS ───────────────────────────────────
-- El criterio anterior por fechas marcaba `posible_deploy_sin_commit` a toda
-- funcion cuyo deploy fuera >24 h posterior a su ultimo commit. Medido hoy: 5
-- funciones (availability-watchdog, hubrise-location-dispatch,
-- shop-payment-intent, stripe-connect-onboard, stripe-webhook). Ninguna es una
-- averia: son despliegues viejos que llevan meses quietos y perfectamente
-- pueden estar en sintonia con main. Avisar de ellas cada dia es la fatiga de
-- alertas contra la que existe todo esto, asi que ese estado deja de emitirse.
-- Con la huella, solo salta lo que se MUEVE.
--
-- ── LO QUE ESTE CRITERIO NO PUEDE HACER ──────────────────────────────────
-- Necesita una vuelta previa como referencia. En la PRIMERA vuelta no hay
-- historia y no se juzga ningun despliegue: la proteccion empieza en la
-- segunda. Y nunca podra decir si lo desplegado HOY coincide con main -- solo
-- si algo se ha movido sin commit desde la ultima vez que miramos. Es menos de
-- lo prometido y esta escrito a proposito.
--
-- Los estados por CONTENIDO se mantienen intactos: si algun dia ese endpoint
-- devuelve JSON, o se parsea el eszip, el criterio de contenido manda y este es
-- solo el respaldo.
-- ============================================================================

ALTER TABLE public.edge_function_deploy_state
  ADD COLUMN IF NOT EXISTS bundle_sha_anterior     text,
  ADD COLUMN IF NOT EXISTS comprobado_anterior_at  timestamptz;

COMMENT ON COLUMN public.edge_function_deploy_state.bundle_sha_anterior IS
  'ezbr_sha256 visto en la vuelta ANTERIOR. Si difiere del actual, hubo un despliegue entre ambas.';
COMMENT ON COLUMN public.edge_function_deploy_state.comprobado_anterior_at IS
  'Cuando fue la vuelta anterior. Define la ventana en la que se busca un commit que acompane al despliegue.';

CREATE OR REPLACE FUNCTION public.edge_drift_registrar(p_rows jsonb)
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
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'edge_drift_registrar: p_rows vacio; no se toca el estado';
  end if;

  with entrada as (
    select r.slug, r.repo_path, r.repo_blob_sha, r.repo_commit_at,
           coalesce(r.desplegada, false) as desplegada,
           r.deploy_version, r.deploy_bundle_sha, r.deploy_at,
           coalesce(nullif(r.contenido,''), 'no_comprobable') as contenido,
           r.contenido_detalle
      from jsonb_to_recordset(p_rows) as r(
             slug text, repo_path text, repo_blob_sha text,
             repo_commit_at timestamptz, desplegada boolean,
             deploy_version integer, deploy_bundle_sha text,
             deploy_at timestamptz, contenido text, contenido_detalle text)
     where nullif(btrim(r.slug), '') is not null
  ),
  -- La vuelta anterior de cada funcion: es lo que convierte "esta desplegada
  -- desde hace tiempo" en "se ha desplegado AHORA".
  con_historia as (
    select e.*,
           t.deploy_bundle_sha as sha_anterior,
           t.comprobado_at     as visto_anterior_at,
           (t.slug is not null) as hay_historia
      from entrada e
      left join public.edge_function_deploy_state t on t.slug = e.slug
  ),
  juzgada as (
    select h.*,
           case
             when not h.desplegada and h.repo_path is not null then 'ok_sin_desplegar'
             when h.desplegada and h.repo_path is null         then 'sin_fuente_en_repo'
             -- Contenido, cuando se puede leer: manda siempre.
             when h.contenido = 'igual'                        then 'ok'
             when h.contenido = 'distinto'
                  and h.deploy_at > coalesce(h.repo_commit_at, '-infinity'::timestamptz)
                                                               then 'deploy_sin_commit'
             when h.contenido = 'distinto'                     then 'commit_sin_desplegar'
             -- Respaldo por HUELLA: hubo despliegue nuevo (la huella cambio) y
             -- ningun commit a esa funcion desde la vuelta anterior.
             when h.hay_historia
                  and h.deploy_bundle_sha is not null
                  and h.sha_anterior is distinct from h.deploy_bundle_sha
                  and (h.repo_commit_at is null
                       or h.repo_commit_at < h.visto_anterior_at)
                                                               then 'deploy_sin_commit'
             -- Respaldo por FECHA, solo en el sentido fiable: main mas nuevo
             -- que el deploy no depende de leer contenido ninguno.
             when h.repo_commit_at > h.deploy_at + interval '24 hours'
                                                               then 'commit_sin_desplegar'
             else 'ok'
           end as estado
      from con_historia h
  )
  insert into public.edge_function_deploy_state as t (
    slug, repo_path, repo_blob_sha, repo_commit_at, desplegada, deploy_version,
    deploy_bundle_sha, deploy_at, contenido, contenido_detalle, estado,
    drift_desde, comprobado_at, bundle_sha_anterior, comprobado_anterior_at)
  select j.slug, j.repo_path, j.repo_blob_sha, j.repo_commit_at, j.desplegada,
         j.deploy_version, j.deploy_bundle_sha, j.deploy_at, j.contenido,
         j.contenido_detalle, j.estado,
         case when j.estado in ('ok','ok_sin_desplegar') then null else now() end,
         now(), j.sha_anterior, j.visto_anterior_at
    from juzgada j
  on conflict (slug) do update
    set repo_path         = excluded.repo_path,
        repo_blob_sha     = excluded.repo_blob_sha,
        repo_commit_at    = excluded.repo_commit_at,
        desplegada        = excluded.desplegada,
        deploy_version    = excluded.deploy_version,
        -- OJO AL ORDEN: la huella anterior se guarda ANTES de pisar la actual.
        -- En un UPDATE, `t.` es todavia la fila VIEJA, asi que esto es correcto.
        bundle_sha_anterior    = t.deploy_bundle_sha,
        comprobado_anterior_at = t.comprobado_at,
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

  delete from public.edge_function_deploy_state
   where slug not in (select slug from jsonb_to_recordset(p_rows) as r(slug text)
                       where nullif(btrim(r.slug),'') is not null);

  select jsonb_object_agg(estado, n) into v_res
    from (select estado, count(*) as n
            from public.edge_function_deploy_state group by estado) q;

  return coalesce(v_res, '{}'::jsonb);
end;
$function$;

REVOKE ALL ON FUNCTION public.edge_drift_registrar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_drift_registrar(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
