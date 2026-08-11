-- supabase/migrations/20260815T1700_tpv_t1_kitchen_note.sql
--
-- ENCARGO TPV T1 (pantalla de venta mostrador/para llevar) — §3.1.
-- Nota de cocina por línea (hueco que Last no tiene): se imprime en la
-- comanda y se muestra en KDS junto a la línea. DDL puro, ADD COLUMN
-- IF NOT EXISTS ya es idempotente por sí solo — sin guard DO, sin tocar
-- filas existentes.

alter table public.sale_line
  add column if not exists kitchen_note text;

comment on column public.sale_line.kitchen_note is
  'TPV T1: nota de cocina por línea (p.ej. "sin cebolla", "poco hecho"). Se imprime en la comanda y se muestra en KDS junto a la línea.';
