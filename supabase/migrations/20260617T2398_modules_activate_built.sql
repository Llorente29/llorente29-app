-- ============================================================================
-- 20260617T2398_modules_activate_built.sql
-- Activa los módulos CONSTRUIDOS que estaban marcados 'coming_soon' por error:
--   - stock (Operaciones): módulo Almacén/inventario/AvT EN PRODUCCIÓN
--   - delivery: ingesta canónica + HubRise/Last EN PRODUCCIÓN
--   - pos (TPV/POS): adaptador Last vivo
--
-- getCatalog() (accountModulesService) filtra modules.status='active' -> estos
-- 3 no aparecían en la ficha del cliente ni se podían contratar, pese a estar
-- construidos. bookings/loyalty se quedan 'coming_soon' (roadmap real: NO se
-- contrata lo que no existe).
--
-- REGLA: al pasar un módulo de roadmap a construido, poner modules.status='active'.
-- Idempotente. (Ejecutado suelto en producción el 17/06; esta migración lo versiona.)
-- ============================================================================

UPDATE public.modules
SET status = 'active', updated_at = now()
WHERE code IN ('stock', 'delivery', 'pos')
  AND status <> 'active';
