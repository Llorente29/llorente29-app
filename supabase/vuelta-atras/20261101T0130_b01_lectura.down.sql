-- Vuelta atrás de B01 · 4: las lecturas del motor (solo funciones).
drop function if exists public.bank_ventas_plataforma(uuid, date, date);
drop function if exists public.bank_historial(uuid, date);
drop function if exists public.bank_asientos_sin_movimiento(uuid, date, date);
drop function if exists public.bank_saldos_cuentas(uuid, date, text[]);
drop function if exists public.bank_facturas_recibidas_pendientes(uuid);
