-- supabase/vuelta-atras/20261110T1138_g05_motivo_devuelto.down.sql
-- G05 · Vuelta atrás de la 1138: «seguir» como estaba (de su respaldo, byte a byte)
-- y fuera las tres columnas del motivo.
select public._restaurar_funcion('public.conta_cobro_seguir(uuid)', '20261110T1138_g05_motivo_devuelto');
alter table public.conta_recibo drop column if exists motivo_devolucion;
alter table public.conta_gc_cobro drop column if exists motivo_es;
alter table public.conta_gc_cobro drop column if exists causa;
