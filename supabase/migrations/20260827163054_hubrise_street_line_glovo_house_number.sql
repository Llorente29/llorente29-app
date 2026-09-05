
-- ─────────────────────────────────────────────────────────────────────────────
-- GLOVO METE EL NÚMERO DE PORTAL EN `city` (27/08/2026)
-- ─────────────────────────────────────────────────────────────────────────────
-- Verificado en el primer pedido real de Glovo por HubRise (G659, Meraki Pita,
-- external_ref xnp3b9x):
--
--   address_1   "Calle de Ricardo Ortiz"   <- SIN número
--   city        "37"                       <- el NÚMERO DE PORTAL
--   postal_code null
--   address_2   null
--
-- Just Eat, en cambio, pone la ciudad donde toca:
--   address_1 "Calle de Vinaroz, 38, 2A"   city "Madrid"   address_2 "Madrid"
--
-- La composición existente descarta `city` a propósito (en Just Eat es la
-- ciudad y no debe ir al final de la dirección del rider). Con Glovo ese
-- descarte TIRA EL NÚMERO y el repartidor recibe una calle sin portal.
--
-- SE DISTINGUE POR LA FORMA DEL DATO, NO POR EL CANAL. Una ciudad nunca es
-- solo dígitos; un número de portal siempre lo es (con letra opcional: "12B").
-- Hacerlo por canal exigiría fiarse de `channel`, que es texto libre de la
-- plataforma; hacerlo por la forma funciona aunque mañana otro bridge repita
-- el mismo mapeo.
--
-- IDEMPOTENTE: si address_1 YA termina en ese número (porque Glovo lo arregle,
-- o porque la función se aplique dos veces), no se duplica.
CREATE OR REPLACE FUNCTION public.hubrise_street_line(p_address_1 text, p_city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
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
$$;

COMMENT ON FUNCTION public.hubrise_street_line(text, text) IS
  'Compone "calle, número" desde customer.address_1 + customer.city de HubRise. '
  'Glovo manda el número de portal en `city`; Just Eat manda ahí la ciudad. '
  'Se decide por la forma del dato (solo dígitos = portal). Idempotente.';
