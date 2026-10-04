-- scripts/conta/produccion/recuento-serie.sql
--
-- Recuento de filas de serie, con la MISMA vara que el agente «Datos maestros
-- e impuestos» (scripts/conta/lib/datosMaestros.mjs, TABLAS_FILA_A_FILA y
-- CATALOGOS; consulta de scripts/conta/agente-datos-maestros.sql): filas de
-- serie (is_system) de las tablas generales, los catálogos globales enteros,
-- y la tabla de códigos postales. SOLO LEE. Catálogos globales y filas de
-- serie: no se cuenta nada de ninguna cuenta (regla 9).
--
-- «FILAS_DE_SERIE» es el número del agente: las filas de las diez tablas más
-- los cuatro catálogos (3.135 en staging-conta el 04/10/2026: 88 + 275 + 280 +
-- 1.432 + 1.060). Los códigos postales y las fuentes van aparte.

select tabla, filas from (
  select 1 o, 'tax_rate'         tabla, (select count(*) from public.tax_rate where is_system)         filas union all
  select 2, 'withholding_rate',          (select count(*) from public.withholding_rate where is_system) union all
  select 3, 'payment_method',            (select count(*) from public.payment_method where is_system)   union all
  select 4, 'payment_term',              (select count(*) from public.payment_term where is_system)     union all
  select 5, 'entry_text',                (select count(*) from public.entry_text where is_system)       union all
  select 6, 'expense_category',          (select count(*) from public.expense_category where is_system) union all
  select 7, 'vat_scheme',                (select count(*) from public.vat_scheme)                       union all
  select 8, 'tax_form',                  (select count(*) from public.tax_form)                         union all
  select 9, 'legal_form',                (select count(*) from public.legal_form)                       union all
  select 10, 'vat_category_tax',         (select count(*) from public.vat_category_tax)                 union all
  select 11, 'FILAS_DE_SERIE (las del agente)', (
      (select count(*) from public.tax_rate where is_system) + (select count(*) from public.withholding_rate where is_system)
    + (select count(*) from public.payment_method where is_system) + (select count(*) from public.payment_term where is_system)
    + (select count(*) from public.entry_text where is_system) + (select count(*) from public.expense_category where is_system)
    + (select count(*) from public.vat_scheme) + (select count(*) from public.tax_form) + (select count(*) from public.legal_form)
    + (select count(*) from public.vat_category_tax)
    + (select count(*) from public.country) + (select count(*) from public.currency)
    + (select count(*) from public.iae_heading) + (select count(*) from public.cnae_code)) union all
  select 12, 'country',                  (select count(*) from public.country)                          union all
  select 13, 'currency',                 (select count(*) from public.currency)                         union all
  select 14, 'iae_heading',              (select count(*) from public.iae_heading)                      union all
  select 15, 'cnae_code',                (select count(*) from public.cnae_code)                        union all
  select 16, 'postal_code_place',        (select count(*) from public.postal_code_place)                union all
  select 17, 'official_source',          (select count(*) from public.official_source)
) x order by o;
