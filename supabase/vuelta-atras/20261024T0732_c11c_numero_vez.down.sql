-- Vuelta atrás de 20261024T0732_c11c_numero_vez.sql (C11c).
-- Quita la función. Ojo: el envío de este PR la llama; sin ella, el envío de
-- un asiento de ventas falla con «no se ha podido saber la vez del número»
-- hasta que se despliegue el envío de antes. No toca ningún dato.
drop function if exists public.conta_diez_numero_vez(uuid, text);
