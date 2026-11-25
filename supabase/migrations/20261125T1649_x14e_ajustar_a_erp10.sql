-- supabase/migrations/20261125T1649_x14e_ajustar_a_erp10.sql
--
-- X14 · 2 (Julio, 25/11): «la carga de ERP10 es una foto fiel y exacta: gana ERP10 y Sumied se ajusta a ERP10, nunca al
-- revés». El 2024 de QBO Integrity, ya dado por bueno, se trajo con la regla de antes y dejó 776 avisos de «ya tenía otra
-- cuenta principal en Sumied; la de ERP10 es la 430000xx. Se queda la de Sumied». Este fichero lo ajusta a ERP10 con
-- _conta_traer_ajustar_a_erp10 (de la 1415): la cuenta principal de cada proveedor y cliente, el código de cada cliente (su
-- 430) y el nombre de cada cuenta (el del sumas y saldos de ERP10 que se soltó). TOCA DATOS, aunque el analizador lo dé por
-- «sigue» (el cambio va dentro de la función: desde fuera solo ve un select). Lo que cambia lo cuenta la tanda
-- (cuentas/x14e-codigos.sql, medidas 2 a 4), antes y después, y la vuelta atrás lo devuelve.
-- Solo la carga del 2024 de QBO (cuenta f4e8032d…, la única dada por buena de ERP10 antes de esta regla); en otra base
-- (staging) no hay ninguna y no hace nada. Una vez: si ya está ajustada, no repite.
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: lo que dejó apuntado en la carga (detail.ajuste_erp10).
select public._conta_traer_ajustar_a_erp10(r.id, 'X14 · 2 · como en ERP10')
  from public.import_run r
 where r.id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9' and r.kind = 'carga' and r.status = 'dada_por_buena';
