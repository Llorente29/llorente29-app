-- supabase/migrations/20261111T0730_c06b_diez_autorizo_desde.sql
--
-- cambia: public.conta_diez_autorizo · prueba: supabase/staging/sql/20261111_c06b_diez_autorizo_desde_prueba.sql
--
-- C06b · Respuesta 8, tarea 1 (Julio, 14/10): autorizar los envíos a Diez de
-- toda la empresa, pero solo de los asientos con fecha desde el 01/10/2026.
-- Hoy conta_diez_autorizo no tiene fecha: «empresa» sería cualquier fecha.
--
-- Esto es SOLO la estructura (primer paso de tres, el orden que pidió Julio):
--   1. esta tanda: la columna «desde» (fecha, admite vacío) y su CHECK;
--   2. PR de conta-diez-enviar: compara la fecha del asiento con «desde» (el
--      contraasiento, con la fecha de lo que anula), desplegada desde main;
--   3. otra tanda, solo después del despliegue: la fila de empresa C0008
--      desde 2026-10-01 (vale para ventas y para recibidas).
--
-- «desde» solo tiene sentido en una autorización de empresa: en la de un
-- asiento, el asiento ya dice cuál. Vacío = sin límite de fecha (lo de hoy:
-- la fila del 1801, alcance asiento, no cambia). No escribe ningún dato.

alter table public.conta_diez_autorizo add column if not exists desde date;

alter table public.conta_diez_autorizo drop constraint if exists conta_diez_autorizo_desde_check;
alter table public.conta_diez_autorizo add constraint conta_diez_autorizo_desde_check
  check (desde is null or alcance = 'empresa');

comment on column public.conta_diez_autorizo.desde is
  'Solo en alcance empresa: la autorización vale para los asientos con fecha desde este día (inclusive). Vacío = sin límite de fecha.';
