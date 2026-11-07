-- supabase/vuelta-atras/20261107T1945_g03_sector.down.sql
--
-- G03 · Vuelta atrás de la 1945: fuera el disparador, su función, el CHECK y
-- la columna company.sector. is_hospitality se queda como esté (es la de
-- antes). El front lee el sector con «*»: sin la columna, vuelve solo a lo de
-- hoy (is_hospitality y la cuenta de asesoría).

drop trigger if exists company_sector_al_dia on public.company;
drop function if exists public._company_sector_al_dia();
alter table public.company drop constraint if exists company_sector_valido;
alter table public.company drop column if exists sector;
