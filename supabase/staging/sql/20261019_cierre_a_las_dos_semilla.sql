-- supabase/staging/sql/20261019_cierre_a_las_dos_semilla.sql
--
-- SOLO STAGING. Las empresas de prueba de staging guardan la hora de cierre
-- de serie de ANTES (6:00), igual que Foodint en producción. Con la 0170 la
-- de serie es las 2:00, y la 0175 pasa a Foodint; esto hace lo mismo con las
-- de prueba, para que staging se parezca a producción y el e2e del cierre
-- vea «2:00 (la de serie)». Solo las que siguen en 6:00: otra hora es una
-- decisión de alguien y no se pisa.

do $$
declare v_n int;
begin
  if exists (select 1 from public.company where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception 'semilla del cierre a las 2:00: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  update public.company_tax_profile set sales_day_close_time = time '02:00' where sales_day_close_time = time '06:00';
  get diagnostics v_n = row_count;
  raise notice 'semilla del cierre a las 2:00: % empresa(s) de prueba de 6:00 a 2:00.', v_n;
end $$;
