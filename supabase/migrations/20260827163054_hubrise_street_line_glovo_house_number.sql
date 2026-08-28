-- ============================================================================
-- 27/08/2026 — Glovo manda el numero de portal en `customer.city`
-- ============================================================================
-- HubRise no normaliza la direccion: cada plataforma la reparte como quiere.
--
--   Glovo      address_1 "Calle de Ricardo Ortiz"    city "37"      postal_code null
--   Just Eat   address_1 "Calle de Vinaroz, 38, 2A"  city "Madrid"  postal_code "28002"
--
-- La composicion de `delivery_address` descartaba `city` a proposito: en Just
-- Eat es la ciudad y no puede acabar pegada a la calle en la direccion que ve
-- el repartidor. Con Glovo ese descarte tiraba el numero de portal.
--
-- El primer pedido real de Glovo con reparto propio (G659, venta xnp3b9x) salio
-- a la calle como "Calle de Ricardo Ortiz", sin portal.
--
-- Esta funcion decide caso por caso en vez de descartar siempre:
--   - `city` no parece un portal ("Madrid")   -> address_1 intacto.
--   - `city` parece un portal ("37", "12B")   -> se pega a address_1.
--   - address_1 ya termina en ese numero      -> no se duplica.
--   - address_1 vacio                         -> NULL, nunca ", 37".
--
-- IMMUTABLE y sin acceso a tablas: es pura decision de texto. Se usa desde
-- adapt_hubrise_order (migracion 20260827163135) y tiene gemelas en TypeScript
-- en hubrise-webhook y catcher-dispatch — las tres reglas deben ir a la vez.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hubrise_street_line(p_address_1 text, p_city text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    -- `city` NO es un número de portal (Just Eat: "Madrid") -> address_1 intacto.
    WHEN btrim(coalesce(p_city, '')) !~ '^[0-9]{1,4} *[A-Za-zºª]?$'
      THEN nullif(btrim(coalesce(p_address_1, '')), '')
    -- Sin calle no hay nada que componer.
    WHEN nullif(btrim(coalesce(p_address_1, '')), '') IS NULL
      THEN NULL
    -- La calle ya lleva ese número al final -> no duplicar.
    WHEN btrim(p_address_1) ~ ('(^|[ ,])' || btrim(p_city) || '$')
      THEN btrim(p_address_1)
    -- Glovo: pegar el portal a la calle.
    ELSE btrim(p_address_1) || ', ' || btrim(p_city)
  END;
$function$
;
