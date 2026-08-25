-- 20260825T1900_tope_cordura_conteo.sql
-- APLICADA en producción el 25-08-2026.
--
-- Un dedo gordo no puede contaminar el ledger. Dos tecleos históricos lo
-- demostraron: 5×10¹⁵ g de mozzarella (apertura del 15-06) y 7.200.000 g de
-- salsa mayo chipotle (INV-00129, 02-08). El segundo hubo que compensarlo a
-- mano el mismo día; el primero reapareció al reanclar los conteos.
--
-- CALIBRACIÓN (sobre las 1.546 líneas contadas > 0 del histórico):
--   p99 = 66.375 · mayor cantidad creíble = 104.000
--   solo 2 por encima de 1.000.000, y las dos eran tecleos.
-- Con factor 1.000× y tope absoluto 1.000.000 no se habría bloqueado ni una
-- sola línea legítima. Ambos son ajustables por cuenta sin migración.
--
-- La confirmación vale SOLO para el valor confirmado: si el contador vuelve a
-- teclear otra cantidad absurda, se le vuelve a parar. No es un salvoconducto.

alter table public.inventory_count_line
  add column if not exists counted_qty_confirmed    numeric,
  add column if not exists counted_qty_confirmed_at timestamptz;

comment on column public.inventory_count_line.counted_qty_confirmed is
  'Cantidad exacta que el contador confirmo explicitamente tras el aviso de cantidad absurda. Solo vale para ESE valor.';

alter table public.supply_settings
  add column if not exists count_absurd_factor  numeric not null default 1000,
  add column if not exists count_absurd_abs_cap numeric not null default 1000000;

CREATE OR REPLACE FUNCTION public.tg_inventory_count_line_sanity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factor  numeric;
  v_cap     numeric;
  v_teorico numeric;
BEGIN
  IF NEW.counted_qty IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.counted_qty IS NOT DISTINCT FROM OLD.counted_qty THEN
    RETURN NEW;
  END IF;

  IF NEW.counted_qty < 0 THEN
    RAISE EXCEPTION 'No se puede contar una cantidad negativa (%). Si el sistema esta en negativo, cuenta lo que hay de verdad: 0 o mas.',
      NEW.counted_qty USING ERRCODE = 'FV001';
  END IF;

  -- Confirmacion explicita: vale SOLO para el valor confirmado.
  IF NEW.counted_qty_confirmed IS NOT NULL
     AND NEW.counted_qty_confirmed = NEW.counted_qty THEN
    NEW.counted_qty_confirmed_at := now();
    RETURN NEW;
  END IF;

  SELECT COALESCE(count_absurd_factor, 1000), COALESCE(count_absurd_abs_cap, 1000000)
    INTO v_factor, v_cap
    FROM public.supply_settings WHERE account_id = NEW.account_id;
  v_factor := COALESCE(v_factor, 1000);
  v_cap    := COALESCE(v_cap, 1000000);

  v_teorico := NEW.system_qty;

  IF v_teorico IS NOT NULL AND v_teorico > 0 THEN
    IF NEW.counted_qty > v_factor * v_teorico THEN
      RAISE EXCEPTION
        'Cantidad fuera de escala: has puesto % y el sistema tiene %. Son % veces mas. Revisa la unidad y las comas; si de verdad has contado eso, confirmalo.',
        trim(to_char(NEW.counted_qty, 'FM999999999999999990.####')),
        trim(to_char(v_teorico,       'FM999999999999999990.####')),
        trim(to_char(round(NEW.counted_qty / v_teorico), 'FM999999999999999990'))
        USING ERRCODE = 'FV001';
    END IF;
  ELSE
    IF NEW.counted_qty > v_cap THEN
      RAISE EXCEPTION
        'Cantidad fuera de escala: has puesto % en unidades base, por encima del tope de %. Revisa la unidad y las comas; si de verdad has contado eso, confirmalo.',
        trim(to_char(NEW.counted_qty, 'FM999999999999999990.####')),
        trim(to_char(v_cap,           'FM999999999999999990'))
        USING ERRCODE = 'FV001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_inventory_count_line_sanity ON public.inventory_count_line;
CREATE TRIGGER trg_inventory_count_line_sanity
  BEFORE INSERT OR UPDATE OF counted_qty ON public.inventory_count_line
  FOR EACH ROW EXECUTE FUNCTION public.tg_inventory_count_line_sanity();

notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_inventory_count_line_sanity') then
    raise exception 'Falta trg_inventory_count_line_sanity';
  end if;
end $$;

-- PROBADO EN VIVO sobre una línea de un conteo anulado (sin efecto en ledger
-- ni informes), y restaurada después:
--   30.000.000 con teórico 24.816  → FV001 «Son 1209 veces mas»
--   30.000.000 + counted_qty_confirmed = 30.000.000  → pasa, sella la hora
--   40.000.000 con la confirmación anterior puesta   → FV001 otra vez
