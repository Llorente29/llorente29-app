-- scripts/conta/produccion/d1.sql
--
-- LA FOTO DE D1: lo que devuelve vat_rate_for para cada categoría de IVA de
-- Cocina y cada día de 2024-01-01 a 2026-12-31 (5 × 1.096 = 5.480 pares en
-- producción). SOLO LEE. Se saca antes y después de la 0140 y se comparan con
-- scripts/conta/produccion/d1-comparar.mjs: misma vara a los dos lados
-- (regla 31). Una categoría por su code, no por su id: es un catálogo global.

select c.code, d::date as dia, f.rate, f.equivalence_surcharge
  from public.vat_category c
 cross join generate_series(date '2024-01-01', date '2026-12-31', interval '1 day') d
  left join lateral public.vat_rate_for(c.id, d::date) f on true
 order by c.code, d;
