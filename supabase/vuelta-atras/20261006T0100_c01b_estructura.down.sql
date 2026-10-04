-- ============================================================================
-- VUELTA ATRÁS de 20261006T0100_c01b_estructura.sql
-- Para si borraría algo con datos: IVA habituales ya puestos, frecuencias de
-- facturación o filas en el registro del movimiento (primero la vuelta atrás
-- de la 0110).
-- ============================================================================
do $$
begin
  if exists (select 1 from public.supplier where cardinality(usual_tax_rate_ids) > 0 or invoicing_frequency is not null) then
    raise exception 'C01b 0100 vuelta atrás: hay proveedores con IVA habituales o frecuencia de facturación puestos. No se borra nada.';
  end if;
  if exists (select 1 from public.c01b_movimiento_registro) then
    raise exception 'C01b 0100 vuelta atrás: el registro del movimiento tiene filas. Primero la vuelta atrás de la 0110.';
  end if;
end $$;

drop trigger if exists trg_supplier_tax_rates_ok on public.supplier;
drop function if exists public.supplier_tax_rates_ok();
alter table public.supplier drop column if exists usual_tax_rate_ids, drop column if exists invoicing_frequency;
drop table if exists public.c01b_movimiento_registro;
