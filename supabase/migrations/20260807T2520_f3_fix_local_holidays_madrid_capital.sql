-- Aplicada 2026-08-07. Verificado contra locations.city='Madrid' de los 3 locales.
-- F3 (correccion) · "Foodint Alcala" es la CALLE Alcala de Madrid capital, NO Alcala de Henares.
-- Festivos locales correctos de Madrid capital: San Isidro (15/05) y La Almudena (9/11).
delete from public.holiday_calendar
where account_id is null and scope='local' and region_code='ALCALA';
insert into public.holiday_calendar (account_id, holiday_date, name, scope, region_code) values
  (null, '2026-05-15', 'San Isidro Labrador (Madrid capital)', 'local', 'MADRID'),
  (null, '2026-11-09', 'Nuestra Señora de la Almudena (Madrid capital)', 'local', 'MADRID')
on conflict do nothing;
