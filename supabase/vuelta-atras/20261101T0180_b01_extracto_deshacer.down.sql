-- Vuelta atrás de B01 · deshacer un extracto (0180): quita la función.
-- Lo que ya se deshizo con ella no vuelve (los extractos se vuelven a subir);
-- su rastro se queda en «Lo que ha hecho Folvy».
drop function if exists public.bank_extracto_deshacer(uuid, text);
