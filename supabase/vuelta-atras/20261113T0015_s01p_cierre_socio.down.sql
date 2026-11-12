-- supabase/vuelta-atras/20261113T0015_s01p_cierre_socio.down.sql
--
-- S01p·18 · 4 · la vuelta atrás de la 0015: fuera la función y la columna
-- (lo que apuntó se pierde: solo dice con qué liquidación quedaron los PDF).

drop function if exists public.compras_cierre_socio_usado(uuid, text);
alter table public.document_inbox drop column if exists licensed_settlement_id;
