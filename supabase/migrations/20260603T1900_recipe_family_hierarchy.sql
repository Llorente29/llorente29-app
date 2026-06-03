-- supabase/migrations/20260603T1900_recipe_family_hierarchy.sql
--
-- Paso G1 del gestor de familias: jerarquía (familia -> subfamilia) + categoría
-- contable. Alinea con AECOC (secciones->familias->subfamilias) y con el modelo
-- de Apicbase (categoría + subcategoría + categoría contable), el líder europeo.
--
-- Recon (03/06): recipe_family tiene id, account_id, template_id, name, color,
-- icon, position, is_active, created_at, scope. NO tiene updated_at. No hay unique
-- por (account_id, name) -> subfamilias con el mismo nombre bajo distintas madres
-- no chocan. Constraints heredan nombre dish_family_* (inofensivo tras el rename).
--
-- Qué hace:
--   1) parent_family_id (self-FK) -> subfamilias. NULL = familia raíz (nivel 1).
--      Una subfamilia apunta a su madre. ON DELETE SET NULL: si se borra la madre,
--      las hijas quedan como raíz (no se pierden). El archivado lo gestiona el
--      servicio (no se borra de verdad).
--   2) CHECK anti-autorreferencia (una familia no puede ser su propia madre).
--   3) accounting_category (text) -> para informes/contabilidad (deuda futura del
--      módulo contable; la columna queda lista, sin uso obligatorio hoy).
--
-- recipe_item.family_id apunta al nodo MÁS ESPECÍFICO elegido (familia o subfamilia).
-- El motor de coste no usa familia -> sin impacto en costes.
--
-- Sin BEGIN/COMMIT (regla 03/06). Verificar con information_schema después.

-- 1) Jerarquía: columna madre (self-referencial).
ALTER TABLE public.recipe_family
  ADD COLUMN parent_family_id uuid NULL
  REFERENCES public.recipe_family(id) ON DELETE SET NULL;

-- 2) Una familia no puede ser su propia madre (ciclo trivial). Ciclos más largos
--    los evita la UI (solo permitimos 2 niveles: raíz e hija).
ALTER TABLE public.recipe_family
  ADD CONSTRAINT recipe_family_no_self_parent
  CHECK (parent_family_id IS NULL OR parent_family_id <> id);

-- 3) Categoría contable (opcional, para informes).
ALTER TABLE public.recipe_family
  ADD COLUMN accounting_category text NULL;

COMMENT ON COLUMN public.recipe_family.parent_family_id IS 'Familia madre (NULL = raíz nivel 1). Una subfamilia apunta a su familia. Solo 2 niveles.';
COMMENT ON COLUMN public.recipe_family.accounting_category IS 'Categoría contable para informes (opcional). Alineable con plan contable / AECOC.';

-- Índice para listar hijas por madre rápido.
CREATE INDEX IF NOT EXISTS idx_recipe_family_parent
  ON public.recipe_family(parent_family_id)
  WHERE parent_family_id IS NOT NULL;
