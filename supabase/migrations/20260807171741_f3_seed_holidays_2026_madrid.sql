-- F3 · Siembra festivos 2026: nacionales + Comunidad de Madrid (BOCM Decreto 75/2025) + locales de Alcala.
-- account_id NULL = catalogo oficial compartido (lo ven todas las cuentas).
insert into public.holiday_calendar (account_id, holiday_date, name, scope, region_code) values
  (null, '2026-01-01', 'Año Nuevo', 'nacional', null),
  (null, '2026-01-06', 'Epifania del Señor (Reyes)', 'nacional', null),
  (null, '2026-04-02', 'Jueves Santo', 'autonomico', 'MAD'),
  (null, '2026-04-03', 'Viernes Santo', 'nacional', null),
  (null, '2026-05-01', 'Fiesta del Trabajo', 'nacional', null),
  (null, '2026-05-02', 'Fiesta de la Comunidad de Madrid', 'autonomico', 'MAD'),
  (null, '2026-08-15', 'Asuncion de la Virgen', 'nacional', null),
  (null, '2026-10-12', 'Fiesta Nacional de España', 'nacional', null),
  (null, '2026-11-02', 'Todos los Santos (traslado)', 'nacional', null),
  (null, '2026-12-07', 'Dia de la Constitucion (traslado)', 'nacional', null),
  (null, '2026-12-08', 'Inmaculada Concepcion', 'nacional', null),
  (null, '2026-12-25', 'Navidad', 'nacional', null),
  -- locales de Alcala de Henares (BOCM Res. 02/12/2025)
  (null, '2026-08-06', 'Fiesta local Alcala de Henares', 'local', 'ALCALA'),
  (null, '2026-10-09', 'Fiesta local Alcala de Henares', 'local', 'ALCALA')
on conflict do nothing;