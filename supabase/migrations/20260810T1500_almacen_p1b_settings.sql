-- supabase/migrations/20260810T1500_almacen_p1b_settings.sql
--
-- ENCARGO P1.b — Repaso de recepción para el MUELLE (móvil, escanear-primero,
-- parciales, cierre corto). Solo config, DDL puro — ningún RPC nuevo: el
-- cierre corto usa el mismo update de purchase_order que ya usan los botones
-- Cancelar/Cerrar existentes (SupplyOrderDetailPage.tsx), y el estado
-- recibido_parcial ya lo escribe recompute_purchase_order_status (verificado,
-- sin cambios).
--
-- 3 columnas nuevas en supply_settings, mismo patrón ya usado 3 veces en esta
-- tabla (ADD COLUMN con default, sin romper las existentes):
--   dock_pending_window_before_days : ventana hacia atrás (días) de la lista
--     "Pedidos pendientes" del MUELLE (OrderReceiveFlow) — solo lo vivo, nada
--     de cadáveres. Default 7.
--   dock_pending_window_after_days  : ventana hacia adelante (días). Default 3.
--   hung_order_days_threshold       : a partir de cuántos días vencido un
--     pedido 'enviado' entra en el vigía de gestión (Saneado) con propuesta
--     de cierre corto. Default 14.
--
-- Los 'recibido_parcial' NO se filtran por ventana (siempre aparecen en el
-- muelle mientras estén abiertos) — eso vive en el código cliente, no aquí.
--
-- Sin BEGIN/COMMIT. DDL puro, idempotente (ADD COLUMN IF NOT EXISTS).

alter table public.supply_settings
  add column if not exists dock_pending_window_before_days integer not null default 7,
  add column if not exists dock_pending_window_after_days  integer not null default 3,
  add column if not exists hung_order_days_threshold        integer not null default 14;

comment on column public.supply_settings.dock_pending_window_before_days is
  'Muelle (OrderReceiveFlow): pedidos "enviado" con expected_date hasta N días en el pasado siguen en la lista de pendientes. Default 7.';
comment on column public.supply_settings.dock_pending_window_after_days is
  'Muelle (OrderReceiveFlow): pedidos "enviado" con expected_date hasta N días en el futuro ya aparecen en la lista de pendientes. Default 3.';
comment on column public.supply_settings.hung_order_days_threshold is
  'Vigía de gestión (Saneado): pedido "enviado" vencido más de N días entra en la lista con propuesta de cierre corto. Default 14.';
