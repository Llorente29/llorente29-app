-- supabase/vuelta-atras/20261109T1344_g05_t4_incluye_y_cuenta.down.sql
-- Vuelta atrás de la 1235 (G05 · T4): conta_pantalla_clientes, la de antes (de
-- su respaldo); fuera la función del «Qué incluye» y las columnas nuevas (con lo
-- que tengan: el «Qué incluye» propio de cada servicio y la cuenta de cada mandato).
select public._restaurar_funcion('public.conta_pantalla_clientes(uuid)', '20261109T1344_g05_t4_incluye_y_cuenta');
drop function if exists public.conta_tarifa_servicio_incluye(uuid, uuid, text, boolean);
alter table public.conta_gc_mandato drop column if exists cuenta_final, drop column if exists cuenta_pais, drop column if exists banco;
alter table public.conta_servicio drop column if exists incluye;
