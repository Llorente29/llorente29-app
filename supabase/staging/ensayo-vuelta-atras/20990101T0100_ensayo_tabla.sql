-- ============================================================================
-- ENSAYO DE VUELTA ATRÁS (solo staging-conta). Tanda de ejemplo del modo
-- «ensayo-de-vuelta-atras» de aplicar-staging-conta.yml: una tabla nueva con
-- una fila. No es de nadie y no la lee nada; la vuelta atrás la quita.
-- Vuelta atrás: supabase/staging/ensayo-vuelta-atras/20990101T0100_ensayo_tabla.down.sql
-- ============================================================================
create table public.ensayo_vuelta_atras (id int primary key, nota text not null);
insert into public.ensayo_vuelta_atras values (1, 'puesta por el ensayo de vuelta atrás');
