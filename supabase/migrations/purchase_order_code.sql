-- ════════════════════════════════════════════════════════════════════════
-- NÚMERO DE PEDIDO (purchase_order.code) — imita el patrón folvy_code
-- ════════════════════════════════════════════════════════════════════════
-- El sistema folvy_code existente es específico de recipe_item (consulta esa
-- tabla y su columna folvy_code). Para el pedido replicamos el MISMO patrón
-- (prefijo + correlativo por cuenta + LPAD 5, rellenado por trigger al
-- insertar) pero sobre purchase_order.code.
--
-- Formato: PED-00001, PED-00002, … correlativo POR CUENTA (igual que RAW/REC/…).
--
-- NO es SECURITY DEFINER. DDL: ejecutar tal cual en el SQL Editor (sin
-- BEGIN/COMMIT). Verificación en una consulta APARTE (más abajo, NO ejecutar
-- en la misma tanda).

-- 1) Generador del siguiente código de pedido para una cuenta.
CREATE OR REPLACE FUNCTION public.next_purchase_order_code(p_account_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_prefix text := 'PED';
  v_next   int;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(code FROM '[0-9]+$')::int), 0) + 1
    INTO v_next
    FROM public.purchase_order
    WHERE account_id = p_account_id
      AND code LIKE v_prefix || '-%';
  RETURN v_prefix || '-' || LPAD(v_next::text, 5, '0');
END;
$function$;

-- 2) Trigger que rellena code al insertar si viene NULL (igual que set_folvy_code).
CREATE OR REPLACE FUNCTION public.set_purchase_order_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.code IS NULL THEN
    NEW.code := public.next_purchase_order_code(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Enganchar el trigger BEFORE INSERT en purchase_order.
DROP TRIGGER IF EXISTS trg_set_purchase_order_code ON public.purchase_order;
CREATE TRIGGER trg_set_purchase_order_code
  BEFORE INSERT ON public.purchase_order
  FOR EACH ROW
  EXECUTE FUNCTION public.set_purchase_order_code();

-- 4) Rellenar los 2 pedidos ya existentes que no tienen código.
--    Se numeran por orden de creación, por cuenta.
WITH numbered AS (
  SELECT id,
         'PED-' || LPAD(
           ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY created_at)::text,
           5, '0'
         ) AS new_code
  FROM public.purchase_order
  WHERE code IS NULL
)
UPDATE public.purchase_order po
SET code = n.new_code
FROM numbered n
WHERE po.id = n.id;
