-- supabase/vuelta-atras/20261121T0100_s01_esqueleto.down.sql
--
-- Vuelta atrás de 20261121T0100_s01_esqueleto, en orden inverso:
--   2. fuera company.is_hospitality (la 0110 se deshace antes);
--   1. fuera conta_user_pref, su disparador y su función.
-- Se pierden las preferencias guardadas (nivel, favoritos…): el front de
-- antes no las lee (las suyas estaban en el navegador, y siguen allí).
-- ANTES de esto, el front tiene que volver al de antes del S01: el del S01 lee
-- las dos cosas.

alter table public.company drop column if exists is_hospitality;

drop trigger if exists trg_conta_user_pref_al_dia on public.conta_user_pref;
drop table if exists public.conta_user_pref;
drop function if exists public.conta_user_pref_al_dia();
