-- Vuelta atrás de 20261019T0175_cierre_a_las_dos_foodint.sql.
--
-- Foodint vuelve a cerrar el día a las 6:00, solo si sigue a las 2:00 (si
-- alguien la ha cambiado después desde Ajustes, no se pisa). Sin Foodint, nada.

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
begin
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise notice 'vuelta atrás del cierre a las 2:00: esta base no tiene Foodint. Nada que deshacer.';
    return;
  end if;
  update public.company_tax_profile set sales_day_close_time = time '06:00'
   where company_id = v_empresa and sales_day_close_time = time '02:00';
end $$;
