-- ============================================================================
-- 27/08/2026 — el portal de Glovo puede ser un RANGO ("40-46")
-- ============================================================================
-- Tres horas despues del arreglo de las 16:30 entro G092 con city = "40-46":
-- un rango de portales, comun en Madrid en fincas que ocupan varios numeros.
-- El patron original solo aceptaba digitos seguidos, no caso, y el numero se
-- volvio a perder. Mismo fallo, por un caso no contemplado, y otra vez con el
-- pedido ya despachado y en reparto.
--
-- Patron definitivo:  ^[0-9]{1,4}( *- *[0-9]{1,4})? *[A-Za-zºª]?$
--   casa:     37 · 12B · 40-46 · 40 - 46 · 128 · 5ª
--   no casa:  Madrid · MADRID   <- lo unico que importa para no romper Just Eat
--
-- OJO CON EL GUION. Al admitir rangos, p_city puede traer un guion, y en la
-- tercera rama p_city se INTERPOLA dentro de un patron. Un guion es
-- metacaracter dentro de una clase, asi que se escapa con regexp_replace antes
-- de interpolarlo. Sin ese escapado, un city con guion construye un patron
-- invalido y la comprobacion de "ya lo lleva al final" revienta en vez de
-- devolver false.
--
-- Superada la version de 20260827163054, que va al repo igualmente: es lo que
-- se aplico y el historial tiene que poder reproducirse paso a paso.
--
-- Probado contra los 13 pedidos de HubRise con direccion de 30 dias: los 4 de
-- Glovo salen con portal, los 9 de Just Eat identicos a como estaban.
--
-- Definicion literal de pg_get_functiondef, verificada byte a byte contra
-- produccion: md5 da4a487a8a137055cb9555d3690f0bed (824 caracteres).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hubrise_street_line(p_address_1 text, p_city text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$
;

COMMENT ON FUNCTION public.hubrise_street_line(text, text) IS
  'Compone "calle, número" desde customer.address_1 + customer.city de HubRise. '
  'Glovo manda el número de portal en `city` (incluidos rangos "40-46"); Just Eat '
  'manda ahí la ciudad. Se decide por la forma del dato. Idempotente.';
