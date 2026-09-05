
-- RANGOS DE PORTAL (27/08/2026, mismo día, 3 horas después)
-- El primer patrón solo aceptaba dígitos seguidos con letra opcional ("37", "12B").
-- El pedido G092 de Glovo llegó con city = "40-46": un RANGO de portales, muy
-- común en Madrid (fincas que ocupan varios números). No casaba, así que el
-- número se volvió a perder y el repartidor salió sin portal — el mismo fallo
-- que este arreglo venía a cerrar, por un caso que no se contempló.
--
-- Se amplía a: dígitos, opcionalmente un rango con guion, y letra opcional.
--   37 · 12B · 40-46 · 40 - 46 · 128 · 5ª
-- Sigue SIN casar una ciudad ("Madrid", "MADRID"), que es lo único que importa
-- para no romper Just Eat.
CREATE OR REPLACE FUNCTION public.hubrise_street_line(p_address_1 text, p_city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- `city` NO es un número de portal (Just Eat: "Madrid") -> address_1 intacto.
    WHEN btrim(coalesce(p_city, '')) !~ '^[0-9]{1,4}( *- *[0-9]{1,4})? *[A-Za-zºª]?$'
      THEN nullif(btrim(coalesce(p_address_1, '')), '')
    -- Sin calle no hay nada que componer.
    WHEN nullif(btrim(coalesce(p_address_1, '')), '') IS NULL
      THEN NULL
    -- La calle ya lleva ese número al final -> no duplicar.
    WHEN btrim(p_address_1) ~ ('(^|[ ,])' || regexp_replace(btrim(p_city), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '$')
      THEN btrim(p_address_1)
    -- Glovo: pegar el portal a la calle.
    ELSE btrim(p_address_1) || ', ' || btrim(p_city)
  END;
$$;

COMMENT ON FUNCTION public.hubrise_street_line(text, text) IS
  'Compone "calle, número" desde customer.address_1 + customer.city de HubRise. '
  'Glovo manda el número de portal en `city` (incluidos rangos "40-46"); Just Eat '
  'manda ahí la ciudad. Se decide por la forma del dato. Idempotente.';
