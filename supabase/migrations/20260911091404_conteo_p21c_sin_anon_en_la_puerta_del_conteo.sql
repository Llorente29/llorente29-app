-- ═══════════════════════════════════════════════════════════════════════════
-- CONTEO · p21c — fuera `anon` de la puerta del conteo
--
-- Detrás de p21b, y por la misma razón: porque se volvió a mirar.
--
-- Tras el REVOKE a PUBLIC de p21b, `proacl` seguía enseñando `anon=X` y
-- `authenticated=X` EXPLÍCITOS en las dos funciones. No los había puesto nadie
-- a mano: este proyecto tiene `ALTER DEFAULT PRIVILEGES` que conceden EXECUTE
-- a `anon` y a `authenticated` en cada función nueva de `public`. Revocar
-- PUBLIC no los quita, porque no vienen de PUBLIC.
--
-- Estado al que se vuelve, que es el que había antes del DROP:
--   save_count_line ................. postgres | authenticated | service_role
--   _recompute_count_line_variance .. postgres | service_role
--
-- El ayudante se queda sin `authenticated` a propósito: no lo llama nadie
-- desde fuera. `save_count_line` lo sigue llamando sin problema porque es
-- SECURITY DEFINER y corre como su dueño, no como quien la invoca. Probado con
-- rol `authenticated` real: la puerta funciona y el ayudante a pelo contesta
-- «permission denied for function _recompute_count_line_variance».
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public._recompute_count_line_variance(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._recompute_count_line_variance(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric, uuid, text) FROM anon;

COMMIT;
