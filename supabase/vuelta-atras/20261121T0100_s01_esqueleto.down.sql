-- supabase/vuelta-atras/20261121T0100_s01_esqueleto.down.sql
--
-- Vuelta atrás de 20261121T0100_s01_esqueleto, en orden inverso:
--   2. fuera company.is_hospitality (la 0110 se deshace antes);
--   1. fuera conta_user_pref, su disparador y su función.
-- PARA, sin tocar nada, si alguien ya ha guardado sus preferencias (nivel,
-- favoritos…): se perderían. Justo después de la tanda no hay ninguna (el front
-- de antes no las escribe); si las hay, la vuelta atrás es una decisión, no un
-- automatismo.
-- ANTES de esto, el front tiene que volver al de antes del S01: el del S01 lee
-- las dos cosas.

do $$
declare n bigint;
begin
  if to_regclass('public.conta_user_pref') is not null then
    execute 'select count(*) from public.conta_user_pref' into n;
    if n > 0 then
      raise exception 'S01 0100 vuelta atrás: hay % preferencias guardadas por personas (conta_user_pref) y se perderían. No se toca nada.', n;
    end if;
  end if;
end $$;

alter table public.company drop column if exists is_hospitality;

drop trigger if exists trg_conta_user_pref_al_dia on public.conta_user_pref;
drop table if exists public.conta_user_pref;
drop function if exists public.conta_user_pref_al_dia();
