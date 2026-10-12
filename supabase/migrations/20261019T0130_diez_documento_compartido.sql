-- C04b · T3 · Un documento puede respaldar varios asientos (Julio, 12/10).
--
-- cambia: public.external_document · prueba: supabase/staging/sql/20261019_diez_documento_compartido_prueba.sql
-- cambia: public.external_document_sha_uq · prueba: supabase/staging/sql/20261019_diez_documento_compartido_prueba.sql
--
-- Fichero NUEVO a propósito: la 0110 ya está aplicada en staging y está en el
-- historial con su huella; reescribirla haría que la huella dejara de cuadrar.
--
-- POR QUÉ (T2 §8.1, medido con 2023-4T): Glovo emite UN documento que Diez
-- registra dos veces, como expedida (la venta) y como recibida (comisión y
-- riders); y dentro de las recibidas, el apunte de la plataforma y el de
-- riders comparten a veces el mismo fichero. La expedida 2023/1/9 y la
-- recibida 2023/2/14 tienen el mismo sha256. Con external_document_sha_uq
-- (único por empresa y sha256) el segundo enlace chocaba.
--
-- LO QUE CAMBIA:
--   1. El fichero se guarda una vez, por su huella (storage_path derivado del
--      sha256; eso lo hace el importador). Cada asiento que lo usa tiene SU
--      fila, apuntando al mismo storage_path.
--   2. La regla pasa a ser «el mismo fichero no se enlaza dos veces al mismo
--      asiento»: único por (empresa, sha256, asiento), con NULLS NOT DISTINCT
--      para que un fichero sin asiento («revisar») tampoco entre dos veces.
--      Los 14 nombres repetidos de septiembre siguen siendo una sola fila.
--   3. Un estado nuevo, «no_requiere»: asientos que por su naturaleza no
--      llevan PDF propio (resúmenes de ventas del día, tiques). Va con su
--      asiento, sin fichero y con su porqué. No es «pendiente»: no se
--      reintenta cada noche ni cuenta como documento que falta.
-- Sigue igual: «un asiento tiene un documento vivo como mucho»
-- (external_document_entry_uq) y los tres CHECK de cada estado.
--
-- Fuera del camino del pedido. La tabla está vacía en staging y no existe en
-- producción (la 0110 va en la misma tanda), así que en producción todo esto
-- es «añadir».

-- 1 y 2. La unicidad por asiento. Primero la nueva, después se quita la vieja.
create unique index if not exists external_document_sha_entry_uq
  on public.external_document (company_id, sha256, entry_id) nulls not distinct
  where sha256 is not null;
drop index if exists public.external_document_sha_uq;

-- 3. «no_requiere»: el CHECK de estados solo se amplía.
alter table public.external_document drop constraint if exists external_document_status_check;
alter table public.external_document add constraint external_document_status_check
  check (status in ('enlazado', 'revisar', 'pendiente_diez', 'no_requiere'));
alter table public.external_document add constraint external_document_no_requiere_check
  check (status <> 'no_requiere' or (entry_id is not null and storage_path is null and reason is not null));

comment on index public.external_document_sha_entry_uq is 'El mismo fichero no se enlaza dos veces al mismo asiento; sí a varios (Glovo: expedida y recibida con el mismo PDF).';
comment on column public.external_document.status is 'enlazado (fichero y asiento) · revisar (fichero que no casa, con porqué) · pendiente_diez (asiento sin fichero, se reintenta) · no_requiere (asiento que no lleva PDF propio, con porqué).';
