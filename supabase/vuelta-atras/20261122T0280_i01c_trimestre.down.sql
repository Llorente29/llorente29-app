-- supabase/vuelta-atras/20261122T0280_i01c_trimestre.down.sql
--
-- Deshace la 0280: quita la función de lectura del trimestre. No había nada
-- antes y no escribe nada, así que no se pierde ningún dato.

drop function if exists public.conta_impuesto_trimestre(uuid, int, int);
