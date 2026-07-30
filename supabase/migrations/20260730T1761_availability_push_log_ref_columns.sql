-- 20260730T1761_availability_push_log_ref_columns.sql
-- ============================================================================
-- FIX — availability_push_log.organization_product_id y external_catalog_id
-- salían SIEMPRE NULL en el tramo HubRise: ambas columnas son `uuid`, pero el
-- ref namespaced de HubRise (Fase B: "{brandSlug}:{external_id}" o el
-- hubrise_ref compartido "shr_<external_id>") y el catalog_id real de HubRise
-- (ej. "j99jm") NO son UUIDs válidos — el INSERT con esos valores habría
-- fallado, así que availability-dispatch nunca los pasaba (deuda ya anotada
-- en el propio código: "no tiene columnas de texto para HubRise"). Esto
-- ciega la verificación del namespacing (§ Fase B) y deja al
-- availability-watchdog sin con qué diagnosticar un fallo.
--
-- FIX: retipar a texto, capaces de guardar los valores reales:
--   · external_catalog_id  uuid -> text   (catalog_id de HubRise; una fila =
--     un catálogo/conexión, sigue siendo un único valor por fila).
--   · organization_product_id  uuid -> text[]  (los refs namespaced
--     EMPUJADOS en ese PATCH — un PATCH cubre varios refs a la vez, de ahí
--     el array; antes era la matrícula única de Last, que ya no se usa aquí
--     porque el tramo Last es de solo lectura desde Fase 0 v4).
--
-- USING con cast a texto: sin pérdida de las pocas filas históricas que sí
-- tuvieran un uuid válido (Last, antes de pasar a solo lectura).
--
-- Sin otros consumidores fuera de availability-dispatch (escribe) y
-- availability-watchdog (lee solo account_id/enable/error/created_at,
-- confirmado por grep) — retipar es seguro.
--
-- DDL sin BEGIN/COMMIT (ALTER COLUMN es una sola operación DDL por columna).
-- GUARD final: no dar por hecho el ALTER.
-- Aplicada: —
-- ============================================================================

begin;

alter table public.availability_push_log
  alter column external_catalog_id type text using external_catalog_id::text;

alter table public.availability_push_log
  alter column organization_product_id type text[]
  using (case when organization_product_id is null then null
              else array[organization_product_id::text] end);

comment on column public.availability_push_log.external_catalog_id is
  'Catálogo destino del push. HubRise: catalog_id real (ej. "j99jm"), texto (no uuid). Last (solo lectura desde Fase 0 v4): NULL.';
comment on column public.availability_push_log.organization_product_id is
  'Refs namespaced (Fase B) EMPUJADOS en este PATCH — array, un PATCH cubre varios refs. HubRise: "{brandSlug}:{external_id}" o el hubrise_ref compartido. Last: NULL (solo lectura).';

-- GUARD: verificar que los tipos quedaron como se pretendía.
do $$
declare
  v_catalog_type text;
  v_org_type     text;
begin
  select data_type into v_catalog_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'availability_push_log' and column_name = 'external_catalog_id';

  select data_type into v_org_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'availability_push_log' and column_name = 'organization_product_id';

  if v_catalog_type is distinct from 'text' then
    raise exception 'availability_push_log.external_catalog_id no quedó como text (es %)', v_catalog_type;
  end if;
  if v_org_type is distinct from 'ARRAY' then
    raise exception 'availability_push_log.organization_product_id no quedó como text[] (es %)', v_org_type;
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select column_name, data_type, udt_name from information_schema.columns
-- where table_schema='public' and table_name='availability_push_log'
--   and column_name in ('external_catalog_id','organization_product_id');
-- external_catalog_id -> text; organization_product_id -> ARRAY / _text.
