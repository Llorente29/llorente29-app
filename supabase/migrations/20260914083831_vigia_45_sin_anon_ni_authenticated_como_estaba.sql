-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 CORRECCIÓN INMEDIATA DE UN FALLO MÍO · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Al tirar y recrear `last_catalog_watchdog` (migración 20260914083803) los
-- permisos volvieron a los de por defecto del esquema `public`, y esa función
-- --que es SECURITY DEFINER-- quedó ejecutable por `anon` y `authenticated`.
-- Antes eran sólo `postgres` y `service_role`. Medido a los dos lados, con la
-- misma consulta:
--
--   antes:    postgres, service_role
--   después:  anon, authenticated, postgres, service_role
--
-- Mi `REVOKE ALL ... FROM PUBLIC` de la migración anterior no quitaba esos dos,
-- porque son concesiones EXPLÍCITAS a esos roles y no al pseudo-rol PUBLIC. Se
-- quitan por su nombre.
--
-- La lección, que es la regla 31 salvándome de mí mismo: el «no he roto nada»
-- de un DROP+CREATE hay que medirlo con la misma vara a los dos lados, y los
-- permisos son una de las dos cosas que el DROP se lleva por delante. La otra
-- es el COMMENT, que sí se repuso en la misma migración.
--
-- Y por qué no se arregla editando la anterior: porque la anterior YA ESTÁ
-- APLICADA. Corregirla en el fichero dejaría el repositorio diciendo una cosa
-- y la base otra durante el rato en que nadie lo aplica, que es exactamente lo
-- que la regla de «una cosa está aplicada cuando está en producción» prohíbe.
-- El fallo se cuenta y se arregla con otra pieza, con su fecha.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.last_catalog_watchdog() FROM anon, authenticated;

DO $comprueba$
DECLARE v_quien text;
BEGIN
  SELECT string_agg(grantee, ', ' ORDER BY grantee) INTO v_quien
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public' AND routine_name = 'last_catalog_watchdog'
     AND privilege_type = 'EXECUTE';
  IF v_quien <> 'postgres, service_role' THEN
    RAISE EXCEPTION 'Los permisos tenian que quedar como estaban (postgres, service_role) y han quedado: %', v_quien;
  END IF;
  RAISE NOTICE 'Permisos restituidos: %', v_quien;
END;
$comprueba$;
