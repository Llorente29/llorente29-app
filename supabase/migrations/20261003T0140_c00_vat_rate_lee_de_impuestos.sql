-- ============================================================================
-- C00 · D1 · vat_rate_for lee de la tabla de impuestos (una sola fuente)
-- ----------------------------------------------------------------------------
-- Respuesta 1 de Julio, D1: «vat_rate no se amplía ni se borra en este
-- encargo: déjala leyendo de la tabla nueva por una vista o puente».
--
-- vat_rate_for(uuid, date) conserva su FIRMA y su forma de devolver (rate,
-- equivalence_surcharge): CREATE OR REPLACE sin parámetros nuevos (regla 2 de
-- CLAUDE.md: no crea sobrecarga). Solo cambia de dónde lee: de la vista
-- vat_category_rate (tax_rate a través del puente vat_category_tax) en vez de
-- la tabla vat_rate.
--
-- Antes/después medido con la misma vara (regla 31): ver el ensayo
-- supabase/staging/sql/20261003_ensayo_c00_d1.sql y la prueba
-- tests/conta/cumplimiento/d1.test.ts.
--
-- Sus llamadores (run_invoice_match, la ficha de artículo de Cocina y el PDF
-- del pedido) no están en el camino del pedido. vat_rate se queda como está,
-- sin que nada la lea; cómo se retira, en el PR.
-- ============================================================================

create or replace function public.vat_rate_for(p_category_id uuid, p_date date)
returns table(rate numeric, equivalence_surcharge numeric)
language sql stable set search_path = public as $$
  select r.rate, r.equivalence_surcharge
    from public.vat_category_rate r
   where r.category_id = p_category_id
     and r.valid_from <= p_date
     and (r.valid_to is null or r.valid_to >= p_date)
   order by r.valid_from desc
   limit 1;
$$;
comment on function public.vat_rate_for(uuid, date) is
  'C00 (D1): el tipo de IVA de una categoría en una fecha. Lee de tax_rate por el puente vat_category_tax (vista vat_category_rate). Antes leía vat_rate.';
comment on table public.vat_rate is
  'RETIRADA (C00, D1): ya no la lee nadie; la fuente es tax_rate. Se borra en un encargo posterior, cuando la comprobación nocturna lleve un tiempo diciendo que coincide con vat_category_rate.';
