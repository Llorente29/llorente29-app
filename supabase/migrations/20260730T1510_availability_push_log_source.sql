-- 20260730T1510_availability_push_log_source.sql
-- ============================================================================
-- availability_push_log: columna `source` explícita ('lastapp'|'hubrise'|'other').
--
-- Antes el origen de cada fila solo se podía inferir parseando el texto libre
-- de `error` — deuda anotada en el propio código del despachador (logHubrise:
-- "availability_push_log no tiene columnas de texto para HubRise... añadir
-- source/detail si se quiere filtrar por integrador"). Hace falta ahora porque
-- el vigía (próxima migración + edge availability-watchdog) necesita poder
-- preguntar "¿falló algo del tramo HubRise?" sin parsear texto.
--
-- Nullable a propósito: las filas HISTÓRICAS (anteriores a este cambio) se
-- quedan con source=NULL — no se adivinan por texto, para no etiquetar mal
-- filas que vienen de "huecos declarados" de otros integradores (logueadas
-- también por logLast, mismo formato que lastapp real). El despachador (edge
-- function, redeploy en el mismo cambio que esta migración) rellena `source`
-- desde ya en cada fila nueva.
--
-- DDL pura, segura para ejecutar de una vez.
-- Aplicada: —
-- ============================================================================

alter table public.availability_push_log
  add column if not exists source text check (source in ('lastapp', 'hubrise', 'other'));

create index if not exists ix_availability_push_log_source_created
  on public.availability_push_log (source, created_at desc);

comment on column public.availability_push_log.source is
  'lastapp|hubrise|other — qué tramo del despachador escribió esta fila. NULL = fila anterior a este cambio (no se adivina por texto).';
