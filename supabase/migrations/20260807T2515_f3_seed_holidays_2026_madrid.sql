-- Aplicada 2026-08-07 (con correccion posterior de festivos locales, ver T2520). Verificado: 14 festivos.
-- F3 · Festivos 2026: nacionales + Comunidad de Madrid (BOCM Decreto 75/2025). account_id NULL = oficial.
-- NOTA: los locales de esta migracion (Alcala de Henares) se CORRIGEN en T2520 -> los 3 locales de
-- Llorente29 estan en Madrid capital (city='Madrid'), no en Alcala de Henares.
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
  (null, '2026-12-25', 'Navidad', 'nacional', null)
on conflict do nothing;
