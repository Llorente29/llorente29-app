-- supabase/vuelta-atras/20261123T0907_e10_lineas_por_partes.down.sql
-- Vuelta atrás del E10: quita la función que guarda las líneas leídas por páginas. Las
-- líneas ya guardadas en las sesiones y en las facturas se quedan (son lo leído).
drop function if exists public.conta_lectura_lineas_guardar(uuid, jsonb, jsonb);
