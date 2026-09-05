alter table public.supply_settings
  add column if not exists dock_pending_window_before_days integer not null default 7,
  add column if not exists dock_pending_window_after_days  integer not null default 3,
  add column if not exists hung_order_days_threshold        integer not null default 14;

comment on column public.supply_settings.dock_pending_window_before_days is
  'Muelle (OrderReceiveFlow): pedidos "enviado" con expected_date hasta N dias en el pasado siguen en la lista de pendientes. Default 7.';
comment on column public.supply_settings.dock_pending_window_after_days is
  'Muelle (OrderReceiveFlow): pedidos "enviado" con expected_date hasta N dias en el futuro ya aparecen en la lista de pendientes. Default 3.';
comment on column public.supply_settings.hung_order_days_threshold is
  'Vigia de gestion (Saneado): pedido "enviado" vencido mas de N dias entra en la lista con propuesta de cierre corto. Default 14.';