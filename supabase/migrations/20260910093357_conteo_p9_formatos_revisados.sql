-- 20260910093357_conteo_p9_formatos_revisados.sql
--
-- CONTAR POR FORMATOS · PASO 9 (§2.6) — «Confirmar» deja el artículo revisado
--
-- La pantalla de oficina lista los artículos con formatos que chocan o con
-- nombre engañoso. Cuando alguien decide cuál es el bueno y pulsa Confirmar,
-- el artículo tiene que DEJAR de salir en esa lista aunque sus formatos sigan
-- llamándose igual — porque puede que la respuesta correcta sea justamente
-- «sí, llegan las dos cajas, y la de conteo es ésta».
--
-- Sin esta marca, la lista sería una pantalla que no se puede terminar: cada
-- vez que alguien la abriera vería los mismos artículos ya resueltos, y a la
-- tercera dejaría de abrirla.

BEGIN;

ALTER TABLE public.recipe_item
  ADD COLUMN IF NOT EXISTS count_formats_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS count_formats_reviewed_by uuid;

COMMENT ON COLUMN public.recipe_item.count_formats_reviewed_at IS
  'Cuándo alguien confirmó qué formatos se usan para contar este artículo '
  '(pantalla Almacén › Cómo se cuenta cada producto). Se borra sola si después '
  'se añade o se cambia un formato: la decisión era sobre los que había.';

-- Si después alguien toca los formatos del artículo, la confirmación caduca:
-- lo que se confirmó fue una lista concreta, no el artículo para siempre.
CREATE OR REPLACE FUNCTION public.tg_ripf_invalida_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item uuid := COALESCE(NEW.item_id, OLD.item_id);
BEGIN
  -- Marcar/desmarcar `use_in_count` es la decisión en sí: no la invalida.
  IF TG_OP = 'UPDATE'
     AND NEW.item_id     IS NOT DISTINCT FROM OLD.item_id
     AND NEW.name        IS NOT DISTINCT FROM OLD.name
     AND NEW.qty_in_base IS NOT DISTINCT FROM OLD.qty_in_base
     AND NEW.is_active   IS NOT DISTINCT FROM OLD.is_active
     AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
    RETURN NEW;
  END IF;

  UPDATE public.recipe_item
     SET count_formats_reviewed_at = NULL,
         count_formats_reviewed_by = NULL
   WHERE id = v_item AND count_formats_reviewed_at IS NOT NULL;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_ripf_invalida_revision ON public.recipe_item_purchase_format;
CREATE TRIGGER trg_ripf_invalida_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.recipe_item_purchase_format
  FOR EACH ROW EXECUTE FUNCTION public.tg_ripf_invalida_revision();

COMMIT;
