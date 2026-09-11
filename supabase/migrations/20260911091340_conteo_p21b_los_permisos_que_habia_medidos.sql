-- ═══════════════════════════════════════════════════════════════════════════
-- CONTEO · p21b — los permisos que había, medidos
--
-- Va detrás de p21 (20260911091247) y existe porque p21 los dejó MAL.
--
-- Lo que pasó, dicho entero: se midieron los permisos de `save_count_line`
-- ANTES del DROP —`postgres`, `service_role` y `authenticated`, sin PUBLIC y
-- sin `anon`— y después del CREATE se dio el GRANT «equivalente». No lo era.
-- `CREATE FUNCTION` concede EXECUTE a PUBLIC por su cuenta, así que la puerta
-- de escritura del conteo quedó llamable SIN SESIÓN desde PostgREST. Se vio al
-- volver a mirar `proacl` después de aplicar, que es tarde: la comprobación
-- tenía que haber ido dentro de la misma migración.
--
-- Y el ayudante nuevo era peor. `_recompute_count_line_variance` es SECURITY
-- DEFINER y NO lleva `belongs_to_account` dentro —no le hace falta, porque sólo
-- la llama `save_count_line`, que ya ha comprobado la cuenta—. Abierta, era un
-- botón para reescribir las diferencias de CUALQUIER línea de recuento de
-- CUALQUIER cuenta, sabiendo sólo su id.
--
-- Aquí se cierra PUBLIC en las dos. `anon` y `authenticated` siguen entrando
-- por las DEFAULT PRIVILEGES del proyecto; eso lo remata p21c.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public._recompute_count_line_variance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._recompute_count_line_variance(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_count_line(uuid, jsonb, numeric, uuid, text)
  TO authenticated, service_role;

COMMIT;
