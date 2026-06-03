-- ════════════════════════════════════════════════════════════════════════
-- Trigger: al asignar/cambiar la familia de un artículo, PROPONER su IVA.
-- ════════════════════════════════════════════════════════════════════════
-- Engancha la propuesta automática de IVA a CUALQUIER vía que escriba family_id
-- (UI de aprobación, IA, importación masiva, semilla, SQL). Una sola verdad,
-- a prueba de olvidos. Reutiliza la función propose_vat_category ya creada.
--
-- Anti-recursión: propose_vat_category hace UPDATE sobre recipe_item, lo que
-- volvería a disparar el trigger. Lo evitamos escribiendo directamente aquí
-- (sin llamar a la función que re-actualiza) y condicionando a que la familia
-- haya cambiado de verdad y el IVA no esté confirmado.
--
-- NO SECURITY DEFINER. DDL sin BEGIN/COMMIT. Verificación aparte.

CREATE OR REPLACE FUNCTION public.trg_propose_vat_on_family()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_family_name text;
  v_cat         uuid;
BEGIN
  -- Solo actuar si hay familia y el IVA no está confirmado por un humano.
  IF NEW.family_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.vat_category_source = 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- En UPDATE: solo si la familia cambió (evita trabajo y recursión).
  IF TG_OP = 'UPDATE' AND NEW.family_id IS NOT DISTINCT FROM OLD.family_id THEN
    RETURN NEW;
  END IF;

  SELECT rf.name INTO v_family_name
  FROM public.recipe_family rf WHERE rf.id = NEW.family_id;

  IF v_family_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT fvd.vat_category_id INTO v_cat
  FROM public.family_vat_default fvd
  WHERE fvd.family_name = v_family_name;

  IF v_cat IS NULL THEN
    RETURN NEW;  -- familia sin mapeo fiscal → no inventa, deja como está
  END IF;

  -- Escribir directamente en NEW (BEFORE trigger) → sin re-disparo ni recursión.
  NEW.vat_category_id := v_cat;
  NEW.vat_category_source := 'proposed';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recipe_item_propose_vat ON public.recipe_item;
CREATE TRIGGER trg_recipe_item_propose_vat
  BEFORE INSERT OR UPDATE OF family_id ON public.recipe_item
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_propose_vat_on_family();
