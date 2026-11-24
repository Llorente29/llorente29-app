-- supabase/vuelta-atras/20261107T0055_b01s_cargo_anulado.down.sql
--
-- Vuelta atrás de la 0055 (B01·20): quita las cinco funciones y las dos
-- columnas de «No, es bueno». Lo que se haya apartado con «Quitarlo» se queda
-- apartado (es un «Apartar» como cualquier otro, con su motivo y su línea en el
-- historial); lo que se haya devuelto con «Deshacer» se queda como esté.

drop function if exists public.bank_desapartar(uuid);
drop function if exists public.bank_anulado_es_bueno(uuid, uuid);
drop function if exists public.bank_anulado_quitar(uuid, uuid);
drop function if exists public.bank_cargos_anulados(uuid);
drop function if exists public._bank_cargos_anulados(uuid);
alter table public.bank_movement drop column if exists not_cancelled_by;
alter table public.bank_movement drop column if exists not_cancelled_at;
