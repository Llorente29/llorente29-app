-- 20260827T1900_edge_drift_commit_sin_desplegar_con_historia.sql
-- APLICADA en produccion el 27-08-2026.
--
-- MATAR EL FALSO POSITIVO DE `commit_sin_desplegar`.
-- ============================================================================
-- EL FALLO. La regla era `repo_commit_at > deploy_at + 24 h`: sin estado, solo
-- fechas. Eso lee "el fichero ENTRO en el repositorio despues del deploy" como
-- "hay un commit sin desplegar", y son cosas distintas.
--
-- Medido: check-account-status, customer-notify y sports-events entraron en
-- main el 14/08 en b3bdd6e, el commit que inventario las edge functions.
-- Comprobado que en el padre de ese commit NO existian. Sus tres ficheros
-- coinciden con lo desplegado (188/82/149 lineas, cabecera y cola identicas,
-- todos los invariantes). No hay nada que desplegar en ninguna de las tres, y
-- sin embargo la regla las marcaba TODOS LOS DIAS.
--
-- Un aviso diario que sabemos falso no es ruido inofensivo: es como se entierra
-- la alarma buena. Paso literalmente con hubrise-order-stuck.
--
-- ── LA REGLA NUEVA, CON HISTORIA (simetrica a la de la huella) ───────────
-- Marca solo cuando el blob de main CAMBIA ENTRE DOS VUELTAS sin que haya
-- habido despliegue detras:
--
--   habia blob anterior  Y  el blob es distinto  Y  la huella del bundle NO ha
--   cambiado  ->  hay un commit que no esta corriendo.
--
-- `habia blob anterior` es la clave: un fichero que APARECE por primera vez en
-- el repositorio no es un cambio entre dos vueltas, es un inventario. Eso es
-- exactamente lo de b3bdd6e, y tambien lo de catcher-probe cuando se rescato.
--
-- ── Y SE QUEDA PEGADO HASTA QUE SE DESPLIEGUE ────────────────────────────
-- Sin esto la regla avisaria UNA sola vuelta: al dia siguiente el blob ya seria
-- igual en las dos observaciones y el aviso se apagaria solo, con el arreglo
-- todavia sin desplegar. Asi que una vez marcado `commit_sin_desplegar`, se
-- MANTIENE mientras la huella del bundle no cambie -- es decir, hasta que
-- alguien lo despliegue de verdad. `drift_desde` dice desde cuando.
--
-- ── LO QUE SE PIERDE, ESCRITO A PROPOSITO ────────────────────────────────
-- Lo que quedo sin desplegar ANTES de que este vigia existiera no se ve: no hay
-- vuelta anterior con la que comparar. Hoy eso es last-catalog-sync (arreglo del
-- 19/08, deliberadamente sin desplegar, con dos puertas propias). Esta
-- inventariado en el encargo del 27/08 y va por su cuenta; el vigia protege de
-- aqui en adelante, no hacia atras.
-- ============================================================================

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
  con_historia as (
    select e.*,
           t.deploy_bundle_sha as sha_anterior,
           t.repo_blob_sha     as blob_anterior,
           t.comprobado_at     as visto_anterior_at,
           t.estado            as estado_anterior,
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
             -- Sin historia no se juzga nada: la primera vuelta solo toma la foto.
             when not h.hay_historia                           then 'ok'
             -- HUELLA: hubo despliegue y ningun commit desde la vuelta anterior.
             when h.deploy_bundle_sha is not null
                  and h.sha_anterior is distinct from h.deploy_bundle_sha
                  and (h.repo_commit_at is null
                       or h.repo_commit_at < h.visto_anterior_at)
                                                               then 'deploy_sin_commit'
             -- BLOB: el fichero de main cambio entre dos vueltas y NO hubo
             -- despliegue detras. `blob_anterior is not null` excluye el
             -- fichero que APARECE por primera vez -- eso es un inventario,
             -- no un cambio (b3bdd6e, catcher-probe).
             when h.blob_anterior is not null
                  and h.repo_blob_sha is distinct from h.blob_anterior
                  and h.sha_anterior is not distinct from h.deploy_bundle_sha
                                                               then 'commit_sin_desplegar'
             -- PEGAJOSO: sigue sin desplegarse mientras la huella no cambie.
             when h.estado_anterior = 'commit_sin_desplegar'
                  and h.sha_anterior is not distinct from h.deploy_bundle_sha
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
