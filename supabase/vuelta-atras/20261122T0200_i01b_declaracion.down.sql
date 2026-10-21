-- supabase/vuelta-atras/20261122T0200_i01b_declaracion.down.sql
--
-- Vuelta atrás de 20261122T0200_i01b_declaracion. ANTES, el front tiene que
-- volver al de antes del I01b (el IVA de un periodo llama a las dos). Lo que
-- se decidió con conta_impuesto_pago_poner se queda en las declaraciones: es
-- un dato de la persona, con su apunte en el registro.

drop function if exists public.conta_impuesto_pago_poner(uuid, text, uuid);
drop function if exists public.conta_impuesto_declaracion_ver(uuid, int, text);
