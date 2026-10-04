-- ============================================================================
-- VUELTA ATRÁS de 20261003T0140_c00_vat_rate_lee_de_impuestos.sql
-- ----------------------------------------------------------------------------
-- Respuesta 7 del C00: cada fichero que altera algo de Cocina lleva su vuelta
-- atrás, probada en staging. Esta deja vat_rate_for EXACTAMENTE como estaba en
-- producción (definición leída de producción el 04/10/2026 con
-- pg_get_functiondef, en solo lectura): misma firma, lee de vat_rate.
--
-- Orden si hay que volver atrás de la tanda: esta, luego la de la 0110 del
-- C00 y por último la de la T0100 del C01 (al revés de como se aplicaron).
-- No toca datos. CREATE OR REPLACE con la misma firma: no crea sobrecarga
-- (regla 2) y conserva los permisos de la función.
-- ============================================================================

create or replace function public.vat_rate_for(p_category_id uuid, p_date date)
 returns table(rate numeric, equivalence_surcharge numeric)
 language sql
 stable
as $function$
  SELECT r.rate, r.equivalence_surcharge
  FROM public.vat_rate r
  WHERE r.category_id = p_category_id
    AND r.valid_from <= p_date
    AND (r.valid_to IS NULL OR r.valid_to >= p_date)
  ORDER BY r.valid_from DESC
  LIMIT 1;
$function$;

-- La 0140 le puso search_path; la original no lo tenía.
alter function public.vat_rate_for(uuid, date) reset search_path;
-- Ni la función ni vat_rate tenían comentario en producción.
comment on function public.vat_rate_for(uuid, date) is null;
comment on table public.vat_rate is null;

do $$
begin
  if pg_get_functiondef('public.vat_rate_for(uuid,date)'::regprocedure) not like '%FROM public.vat_rate r%' then
    raise exception 'VUELTA ATRÁS 0140: vat_rate_for no ha quedado leyendo de vat_rate.';
  end if;
  raise notice 'VUELTA ATRÁS 0140: vat_rate_for vuelve a leer de vat_rate.';
end $$;
