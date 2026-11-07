-- supabase/vuelta-atras/20261107T1946_g03_sector_de_hoy.down.sql
--
-- G03 · Vuelta atrás de la 1946: Casa Lola vuelve a «sin decir» (es lo único
-- de is_hospitality que cambió) y ninguna empresa tiene sector. Con el
-- disparador de la 1945, quitar el sector no toca is_hospitality.

update public.company set is_hospitality = null
 where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and is_hospitality and sector = 'hosteleria';
update public.company set sector = null where sector is not null;
