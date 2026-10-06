-- supabase/migrations/20261009T0180_c03_modelo_plataforma.sql
--
-- C03 · Respuesta 2: el 347 de una plataforma de reparto depende de cómo
-- vende, y eso lo dice su contrato, no Folvy.
--
--   · comisionista: vende en NOMBRE del restaurante (el contrato de compra es
--     entre el restaurante y el consumidor). RD 1065/2007, art. 34.3, párrafo
--     primero: se declara solo la contraprestación de su servicio (la
--     comisión, con su IVA): entra en el 347 como PROVEEDOR. Las ventas son a
--     consumidores con factura simplificada sin datos del destinatario:
--     excluidas (art. 33.2.a).
--   · revendedor: actúa en nombre PROPIO. Art. 34.3, párrafo segundo: «se
--     entenderá que ha recibido y entregado o prestado por sí mismo» (y Ley
--     37/1992, art. 11.Dos.15.º): el restaurante le vende a ella, y entra en el
--     347 como CLIENTE por esas ventas.
--   · sin decir (null): la ficha lo pregunta; no se asume ninguno.
--
-- Solo añade una columna nula con su CHECK a party_role (tabla del C03). No
-- toca datos. Vuelta atrás: supabase/vuelta-atras/20261009T0180_c03_modelo_plataforma.down.sql

alter table public.party_role add column if not exists platform_model text;
alter table public.party_role drop constraint if exists party_role_modelo_plataforma;
alter table public.party_role add constraint party_role_modelo_plataforma
  check (platform_model is null or (role = 'platform' and platform_model in ('comisionista', 'revendedor')));
comment on column public.party_role.platform_model is
  'C03. Cómo vende la plataforma según su contrato: comisionista (en nombre del restaurante; 347 como proveedor por sus comisiones) o revendedor (en nombre propio; 347 como cliente por las ventas). RD 1065/2007, art. 34.3. Null: sin decir, se pregunta.';
