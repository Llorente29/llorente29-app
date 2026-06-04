-- ============================================================================
-- Folvy Inventario — Capa 1.1b: jerarquía opcional en storage_area
-- ============================================================================
-- parent_id auto-referente (mismo patrón que recipe_family.parent_family_id).
-- Permite jerarquía configurable por cliente: plano (bar) o anidado (almacén
-- con zonas). El stock NO se valora por área (eso es por location); el área
-- solo organiza el conteo. Ya ejecutado en BBDD; se versiona aquí.
-- DDL sin BEGIN/COMMIT.
-- ============================================================================

alter table public.storage_area
  add column if not exists parent_id uuid references public.storage_area(id) on delete set null;

create index if not exists idx_storage_area_parent on public.storage_area(parent_id);
