-- supabase/vuelta-atras/20261122T0220_i01b_certificados.down.sql
--
-- Vuelta atrás de 20261122T0220_i01b_certificados. ANTES, el front tiene que
-- volver al de antes del I01b (Certificados y accesos las llama). Quién
-- presenta cada empresa se queda como esté: es una decisión de la empresa.

drop function if exists public.conta_impuesto_certificado_presenta(uuid, uuid);
drop function if exists public.conta_impuesto_certificados_ver(uuid);
