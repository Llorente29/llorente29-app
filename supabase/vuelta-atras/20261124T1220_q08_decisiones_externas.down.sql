-- Vuelta atrás de la 20261124T1220: quita las dos funciones que añade (no tocan nada más).
drop function if exists public.conta_gc_enlace_pendiente_externo(uuid, text, text, text);
drop function if exists public.conta_gc_enlace_decision_externa(uuid, text, uuid, text);
