-- K11f1 · vuelta atrás de 20261122T0921 (después de la de la 0922): fuera _conta_fecha_fiscal, y la fecha contable solo
-- si nadie la ha usado (con algo escrito, se queda: es de quien lo escribió). deduct_from no se toca: era del K10b.
drop function if exists public._conta_fecha_fiscal(text, uuid, date);
drop function if exists public._conta_primer_dia_contable(uuid, date);
do $$ begin
  if not exists (select 1 from public.supplier_invoice where accounting_date is not null) then
    alter table public.supplier_invoice drop column if exists accounting_date;
  else
    raise notice 'K11f1 · vuelta atrás: hay recibidas con la fecha contable escrita; su columna se queda.';
  end if;
end $$;
comment on column public.supplier_invoice.deduct_from is
  'K10b · El primer día del trimestre en que se deduce, si se eligió uno distinto del suyo. Nulo = su fecha, o el primer día abierto (conta_recibida_fecha). Nunca uno presentado.';
