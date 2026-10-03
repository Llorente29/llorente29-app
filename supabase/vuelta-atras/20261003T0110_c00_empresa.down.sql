-- ============================================================================
-- VUELTA ATRÁS de 20261003T0110_c00_empresa.sql — SOLO lo que toca de Cocina
-- ----------------------------------------------------------------------------
-- Respuesta 7 del C00. De la 0110, lo único que altera algo existente es una
-- columna nueva de supplier (related_party_kind) con su restricción. Esto la
-- quita (la restricción se va con la columna). Las tablas de empresa que crea
-- la 0110 son nuevas y no las usa Cocina: se quedan.
--
-- Si la columna tiene algún valor, no se quita en silencio: para y lo dice.
-- ============================================================================

\ir 20261003T0110_c00_empresa.down.guarda.sql

alter table public.supplier drop column if exists related_party_kind;
