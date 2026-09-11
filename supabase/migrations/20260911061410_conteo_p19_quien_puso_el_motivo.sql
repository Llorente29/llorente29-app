-- 20260911061410_conteo_p19_quien_puso_el_motivo.sql
--
-- QUIÉN PUSO EL MOTIVO
--
-- La pantalla de un recuento aprobado tiene que enseñar el motivo de cada línea
-- revisada Y quién lo puso (§2 del encargo del 11/09). Medido antes de tocar:
-- `inventory_count_line` guarda `reason_code` y `reason_note`, y NADA sobre la
-- persona. Se añade.
--
-- POR TRIGGER, NO POR EL CLIENTE. `saveReason` es un UPDATE directo a la tabla
-- desde el navegador: si el nombre lo mandara el cliente, sería un nombre que
-- se puede escribir a mano. Sellarlo en la base es la misma familia que la
-- puerta cerrada de `counted_qty` (p11).
--
-- HACIA ATRÁS NO SE INVENTA. Las líneas de antes del 11/09 se quedan con el
-- hueco, incluidas las doce de INV-00218 que Julio revisó esta mañana. La
-- pantalla, cuando no lo sabe, no escribe nada — ni un «—» ni un nombre
-- supuesto (regla 30: el literal de reserva es para lo que no existe, no para
-- lo que no se ha guardado).
--
-- ENSAYO, revertido:
--   A · poner motivo ......... por=673fca49… nombre=Julio
--   B · quitarlo ............. por=NULL nombre=NULL
--   C · la puerta cerrada del `counted_qty` no se dispara ... OK
--
-- md5 de `prosrc`: cad1d3869e1d8fb98dcf6af062ca803c (753 caracteres).

BEGIN;

ALTER TABLE public.inventory_count_line
  ADD COLUMN IF NOT EXISTS reason_by uuid,
  ADD COLUMN IF NOT EXISTS reason_by_name text;

COMMENT ON COLUMN public.inventory_count_line.reason_by_name IS
  'Quien puso el motivo, sellado por trigger. NULL en las lineas anteriores al '
  '11/09/2026: antes no se guardaba, y no se inventa hacia atras.';

CREATE OR REPLACE FUNCTION public.tg_count_line_sella_el_motivo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid; v_nom text;
BEGIN
  IF NEW.reason_code IS NOT DISTINCT FROM OLD.reason_code THEN RETURN NEW; END IF;
  IF NEW.reason_code IS NULL OR NEW.reason_code = '' THEN
    NEW.reason_by := NULL; NEW.reason_by_name := NULL; RETURN NEW;
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    -- Sin persona identificada no se inventa un nombre: se deja el hueco.
    NEW.reason_by := NULL; NEW.reason_by_name := NULL; RETURN NEW;
  END IF;
  -- REGLA 9: `user_profiles` es multi-cuenta; se filtra por la cuenta de la linea.
  SELECT up.display_name INTO v_nom FROM public.user_profiles up
   WHERE up.user_id = v_uid AND up.account_id = NEW.account_id LIMIT 1;
  NEW.reason_by := v_uid;
  NEW.reason_by_name := v_nom;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_count_line_sella_el_motivo ON public.inventory_count_line;
CREATE TRIGGER trg_count_line_sella_el_motivo
  BEFORE UPDATE OF reason_code ON public.inventory_count_line
  FOR EACH ROW EXECUTE FUNCTION public.tg_count_line_sella_el_motivo();

COMMIT;
