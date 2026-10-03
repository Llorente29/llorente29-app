-- ============================================================================
-- C00 · Respuesta 2 de Julio · El 2 % del último trimestre de 2024, a TODOS los
-- alimentos básicos, y el 7,5 % de la pasta y los aceites de semillas.
-- ----------------------------------------------------------------------------
-- RD-ley 4/2024, art. 1.Dos (texto oficial descargado en
-- docs/conta/fuentes/textos/rdl-4-2024.txt, literales comprobados por
-- scripts/conta/serie.mjs):
--   · 1.Dos.2: 2 % (recargo 0,26) a pan común, harinas panificables, leche,
--     quesos, huevos, frutas, verduras, hortalizas, legumbres, tubérculos,
--     cereales y aceites de oliva, del 01/10/2024 al 31/12/2024.
--   · 1.Dos.1: 7,5 % (recargo 1) a aceites de semillas y pastas alimenticias,
--     en el mismo tramo.
--
-- La 0130 ya lo lleva (regenerada desde la serie). Esta es SOLO EL DELTA, para
-- la base donde la 0130 ya estaba aplicada (staging-conta). En una base nueva
-- no hace nada: todo es idempotente.
--
-- Lo que NO hace: el 7,5 % no tiene categoría de vat_category a la que colgarse
-- (no existe «pasta y aceites de semillas»; está en alimento_general, que es
-- el 10 % de muchos más productos). Queda cargado en Impuestos, sin puente.
-- Crear la categoría es decisión aparte: vat_category la comparte Cocina.
--
-- Banda: vat_rate_for está en el camino del pedido y lee este puente. Esta
-- migración solo cambia el resultado para fechas del 4.º trimestre de 2024.
-- Aun así va FUERA de la banda 12:15–00:30 en producción (ver PR #138).
-- ============================================================================

update public.tax_rate set example = 'Tipo temporal: pan, harinas, leche, quesos, huevos, frutas, verduras, hortalizas, legumbres, tubérculos, cereales y aceite de oliva'
 where is_system and code = 'iva_basicos_4t2024' and valid_from = '2024-10-01';

insert into public.tax_rate (is_system, code, name, example, tax_system, territory, treatment, rate, surcharge_rate, valid_from, valid_to, pgc_input_hint, pgc_output_hint, declared_in, legal_ref, verified_at, source_key, sort_order)
select true, 'iva_pasta_semillas_4t2024', 'IVA pasta y aceites de semillas (oct.–dic. 2024)', 'Tipo temporal: pastas alimenticias y aceites de semillas', 'iva', 'peninsula_baleares', 'taxed', 7.5, 1, '2024-10-01', '2024-12-31', '472', '477', array['303']::text[], 'Real Decreto-ley 4/2024, art. 1.Dos.1', '2026-10-02', 'rdl-4-2024', 36
where not exists (select 1 from public.tax_rate where is_system and code = 'iva_pasta_semillas_4t2024' and valid_from = '2024-10-01');

insert into public.vat_category_tax (vat_category_id, tax_code, valid_from, valid_to, note)
select c.id, 'iva_basicos_4t2024', '2024-10-01', '2024-12-31', '2 % en el último trimestre de 2024 a todos los básicos (RD-ley 4/2024, art. 1.Dos.2). Decisión de Julio, respuesta 2 del C00: vat_rate de producción solo lo tenía para el aceite.' from public.vat_category c where c.code = 'alimento_basico'
on conflict (vat_category_id, valid_from) do nothing;
