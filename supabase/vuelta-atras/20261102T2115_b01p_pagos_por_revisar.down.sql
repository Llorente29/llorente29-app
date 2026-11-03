-- Vuelta atrás de supabase/migrations/20261102T2115_b01p_pagos_por_revisar.sql
-- Pagos sigue sin ella: el front la lee aparte y, si no está, enseña lo de antes.
drop function if exists public.conta_pagos_por_revisar(uuid);
