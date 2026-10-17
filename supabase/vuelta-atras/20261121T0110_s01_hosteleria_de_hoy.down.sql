-- supabase/vuelta-atras/20261121T0110_s01_hosteleria_de_hoy.down.sql
--
-- Vuelta atrás de 20261121T0110_s01_hosteleria_de_hoy: la marca de
-- hostelería de todas las empresas vuelve a nula (sin decir), como estaba
-- antes de la 0110. El front lo trata como «no». Si ya hubo quien la cambió en
-- Ajustes, también se pierde: la vuelta atrás es de la tanda, no de la
-- persona. Solo si la columna existe (si la 0100 también se deshizo, nada).

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'is_hospitality') then
    update public.company set is_hospitality = null where is_hospitality is not null;
  end if;
end $$;
