-- supabase/migrations/20260620T1730_converge_a2_migrate_brands_and_map.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Bloque A.2: migrate_brands_and_map canónica.
-- ============================================================================
-- Herramienta de MIGRACIÓN entre cuentas (molde CTB replicable): copia marcas +
-- external_brand_map del origen al destino para las tiendas YA mapeadas en el
-- destino. Útil ahora que entran Llorente29 y el cliente 2 con marcas compartidas.
--
-- ÚNICO cambio vs la versión viva: el EXISTS del _src_map lee external_location_map
-- (antes lastapp_location_map); ambos external_location_id son text → comparación
-- directa, sin ::text. El resto NO se toca (ya era agnóstico: external_brand_map,
-- brand, temp tables). Firma y tipo de retorno IDÉNTICOS.
--
-- ⚠️ ORDEN: aplicar DESPUÉS de E.1 (20260620T1720), que mete las tiendas Last en
-- external_location_map. Si no, el EXISTS sobre external_location_map saldría
-- vacío para esas tiendas y _src_map no migraría nada.
--
-- SECURITY DEFINER. Idempotente (CREATE OR REPLACE, misma firma). Temp tables
-- ON COMMIT DROP (la función se ejecuta en transacción). Sin BEGIN/COMMIT aquí.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_brands_and_map(p_source uuid, p_dest uuid, p_run boolean DEFAULT false)
 RETURNS TABLE(paso text, n bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_brandmap_existing int;
begin
  -- Mapa marca_vieja -> marca_destino (nueva o reutilizada por slug)
  create temp table _map_brand (old_id uuid primary key, new_id uuid, reused boolean) on commit drop;
  insert into _map_brand(old_id, new_id, reused)
  select b.id,
         coalesce(d.id, gen_random_uuid()),
         (d.id is not null)
  from brand b
  left join brand d on d.account_id = p_dest and d.slug = b.slug
  where b.account_id = p_source;
  -- external_brand_map del origen que apunta a tiendas YA mapeadas en el destino
  -- CONVERGIDO: lee external_location_map (antes lastapp_location_map). Ambos
  -- external_location_id son text -> comparacion directa, sin ::text.
  create temp table _src_map on commit drop as
  select m.*
  from external_brand_map m
  where m.account_id = p_source
    and exists (
      select 1 from external_location_map lm
      where lm.account_id = p_dest
        and lm.external_location_id = m.external_location_id
    );
  if not p_run then
    return query
      select 'marcas_total',      count(*)::bigint from _map_brand union all
      select 'marcas_nuevas',     count(*)::bigint from _map_brand where not reused union all
      select 'marcas_reutilizadas',count(*)::bigint from _map_brand where reused union all
      select 'brand_map_a_migrar',count(*)::bigint from _src_map;
    return;
  end if;
  -- 1) Crear las marcas NUEVAS (las reutilizadas ya existen, no se tocan)
  insert into brand (id, account_id, name, slug, ownership_type, color, logo_url,
                     notes, is_active, created_at, updated_at)
  select mb.new_id, p_dest, b.name, b.slug, b.ownership_type, b.color, b.logo_url,
         b.notes, b.is_active, now(), now()
  from brand b
  join _map_brand mb on mb.old_id = b.id
  where mb.reused = false;
  -- 2) Copiar external_brand_map (brand_id re-apuntado; guarda anti-duplicado)
  select count(*) into v_brandmap_existing from external_brand_map where account_id = p_dest;
  insert into external_brand_map (account_id, source, external_location_id, external_brand_id,
                                  brand_id, is_ignored, created_at, updated_at)
  select p_dest, s.source, s.external_location_id, s.external_brand_id,
         (select mb.new_id from _map_brand mb where mb.old_id = s.brand_id),
         s.is_ignored, now(), now()
  from _src_map s
  where not exists (
    select 1 from external_brand_map e
    where e.account_id = p_dest
      and e.source = s.source
      and e.external_location_id = s.external_location_id
      and e.external_brand_id = s.external_brand_id
  );
  return query
    select 'marcas_en_destino',   count(*)::bigint from brand where account_id = p_dest union all
    select 'brand_map_en_destino',count(*)::bigint from external_brand_map where account_id = p_dest;
end;
$function$;
