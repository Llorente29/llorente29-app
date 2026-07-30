-- 20260730T1760_brands_for_closure.sql
-- ============================================================================
-- CAP. B — filtra el selector "Cerrar marca" a marcas con presencia REAL en
-- HubRise. Antes listaba TODAS las marcas de la cuenta, incluidas las
-- CEDIDAS (operan solo en Last, sin catálogo HubRise) — cerrar una cedida
-- era una promesa falsa: Folvy no escribe en Last (Fase 0), y el push a
-- availability-dispatch no tiene catálogo HubRise que tocar para esa marca.
--
-- "Presencia en HubRise" = tiene AL MENOS una conexión utilizable, mismo
-- criterio de resolución que ya usa hubrise-catalog-publish (para no
-- inventar un segundo criterio):
--   · PRIMARIO: brand_hubrise_catalog (Fase 2, self-service) con catálogo+local.
--   · FALLBACK: external_brand_map (source=hubrise, no ignorado) casado con
--     external_integration (source=hubrise, activa, con token+catálogo,
--     push_status_enabled != false) por (external_location_id, connection_name).
--
-- Las cedidas (sin ninguna de las dos) quedan FUERA del selector — mismo
-- espíritu que "Last en lectura" de Fase 0: no ofrecer un botón que no puede
-- cumplir. Reemplaza brands_by_token (tablet) Y la query directa del lado
-- web de BrandCloseControl — doble puerta, una sola fuente del criterio.
--
-- DDL sin BEGIN/COMMIT (una sola función). GUARD final: no dar por hecho el
-- CREATE (mismo aviso del runner que 1730/1740).
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.brands_for_closure(
  p_account_id uuid default null,
  p_token      text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_account uuid;
  v_result  jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'brands_for_closure: token de dispositivo no válido';
    end if;
    v_account := v_device.account_id;
  else
    if p_account_id is null then
      raise exception 'brands_for_closure: falta account_id';
    end if;
    v_account := p_account_id;
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'brands_for_closure: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name), '[]'::jsonb)
    into v_result
  from brand b
  where b.account_id = v_account
    and b.is_active
    and b.archived_at is null
    and (
      exists (
        select 1 from brand_hubrise_catalog bhc
        where bhc.brand_id = b.id and bhc.account_id = v_account
          and bhc.external_catalog_id is not null and bhc.external_location_id is not null
      )
      or exists (
        select 1 from external_brand_map ebm
        join external_integration ei
          on ei.account_id = ebm.account_id and ei.source = 'hubrise'
         and ei.external_location_id = ebm.external_location_id
         and ei.connection_name = ebm.external_brand_id
        where ebm.brand_id = b.id and ebm.account_id = v_account and ebm.source = 'hubrise'
          and coalesce(ebm.is_ignored, false) = false
          and ei.is_active
          and ei.access_token is not null
          and ei.external_catalog_id is not null
          and coalesce(ei.push_status_enabled, true) <> false
      )
    );

  return v_result;
end;
$function$;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.brands_for_closure(uuid, text)') is null then
    raise exception 'brands_for_closure no quedó creada con la firma esperada (uuid, text)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select b.name, b.is_active,
--   exists (select 1 from brand_hubrise_catalog bhc where bhc.brand_id=b.id) as tiene_catalogo_fase2,
--   exists (select 1 from external_brand_map ebm where ebm.brand_id=b.id and ebm.source='hubrise') as tiene_mapeo_bridge
-- from brand b
-- where b.account_id = '<<ACCOUNT_ID>>'
-- order by b.name;
-- Comparar contra select brands_for_closure('<<ACCOUNT_ID>>', null) — las
-- cedidas (sin catálogo Fase 2 NI mapeo bridge) NO deben aparecer en el jsonb.
