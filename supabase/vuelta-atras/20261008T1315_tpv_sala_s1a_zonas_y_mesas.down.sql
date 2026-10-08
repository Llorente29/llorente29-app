-- VUELTA ATRÁS de 20261008T1315_tpv_sala_s1a_zonas_y_mesas.sql (parte A).
--
-- Si la parte B está aplicada, primero su vuelta atrás: sale.table_id apunta a
-- dining_table. Borra las zonas, las mesas, el umbral y los motivos de todas
-- las cuentas (se cuentan antes).

do $$
declare n_z int; n_t int;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale' and column_name = 'table_id') then
    raise exception 'vuelta atrás s1a: la parte B sigue aplicada (sale.table_id existe). Primero su vuelta atrás.';
  end if;
  select count(*) into n_z from public.dining_zone;
  select count(*) into n_t from public.dining_table;
  raise notice 'se borran % zonas y % mesas', n_z, n_t;
end $$;

drop table if exists public.dining_table;
drop table if exists public.dining_zone;
drop table if exists public.dining_config;
drop table if exists public.void_reason;
drop function if exists public.tg_dining_table_same_location();

notify pgrst, 'reload schema';
