-- supabase/migrations/20261111T0740_c06b_diez_autorizo_recibidas.sql
--
-- C06b · Respuesta 8, tarea 1 (Julio, 14/10): la autorización de empresa en
-- Diez real vale para las VENTAS; las facturas RECIBIDAS, no, hasta que A
-- arregle la búsqueda antes de escribir. Hoy duplicaría (lo midió A): busca
-- en el mes de la factura y Diez filtra por la fecha del asiento; el número
-- sin normalizar; el proveedor solo por su cuenta.
--
-- Solo añade una columna, con su valor por defecto: todas las autorizaciones
-- que hay (la del 1801, alcance asiento, de ventas) quedan con
-- incluye_recibidas = false, que es lo que ya hacen. La lee conta-diez-enviar
-- (autorizacionCubre): sin ella a true, una recibida no se escribe en Diez real.
-- La fila de empresa C0008 (desde 2026-10-01) irá con false, en otra tanda,
-- después de desplegar la función.

alter table public.conta_diez_autorizo
  add column if not exists incluye_recibidas boolean not null default false;

comment on column public.conta_diez_autorizo.incluye_recibidas is
  'Si la autorización abre también las facturas recibidas (serie 2). Por defecto, no: solo ventas.';
