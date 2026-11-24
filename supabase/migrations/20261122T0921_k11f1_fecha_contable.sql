-- supabase/migrations/20261122T0921_k11f1_fecha_contable.sql
--
-- K11f1 · Las dos fechas de la recibida, como ERP10 (Julio, 22/11): la CONTABLE es la del asiento y la FISCAL decide
-- el periodo del IVA (el libro de IVA, el 303 y el candado del IVA presentado la leen). SOLO AÑADE.
--
-- Una sola verdad por fecha:
--   · la fecha FISCAL es supplier_invoice.deduct_from (del K10b), que ya guardaba el día en que se deduce: desde hoy
--     vale cualquier día, no solo el primero de un trimestre. Vacía = la de siempre (D07): el día que entró o, si es
--     después, el del asiento (Julio, 22/11). No se añade otra columna, para no tener dos verdades ni mover filas.
--   · la fecha CONTABLE es la columna nueva accounting_date: el día del asiento. Vacía = la de siempre: la de la factura
--     (o el primer día abierto).
-- _conta_fecha_fiscal(source_type, source_id, entry_date): la fecha fiscal de un asiento, la que leen el candado del
-- apunte, el del asiento y el periodo (la 0922 los cambia). En una recibida con fecha fiscal, esa; si no, la del
-- asiento, como hasta hoy.
--
-- sin hueco: el fichero no retira nada.
-- Nada en el camino del pedido: ningún pedido escribe recibidas ni asientos.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0921_k11f1_fecha_contable.down.sql (después de la de la 0922).

alter table public.supplier_invoice add column if not exists accounting_date date;
comment on column public.supplier_invoice.accounting_date is
  'K11f1 · La fecha contable: el día del asiento, si se eligió en la factura. Nula = la de la factura (o el primer día abierto).';
comment on column public.supplier_invoice.deduct_from is
  'K10b y K11f1 · La fecha FISCAL: decide el periodo del IVA (el libro de IVA, el 303 y el candado del IVA presentado). Nula = la de siempre: el día que entró o, si es después, el del asiento (D07). Nunca en un periodo presentado.';

create or replace function public._conta_fecha_fiscal(p_source_type text, p_source_id uuid, p_entry_date date)
returns date language sql stable security definer set search_path = public as $$
  select coalesce(case when p_source_type = 'supplier_invoice'
                       then (select si.deduct_from from public.supplier_invoice si where si.id = p_source_id) end,
                  p_entry_date)
$$;
comment on function public._conta_fecha_fiscal(text, uuid, date) is
  'K11f1 · La fecha fiscal de un asiento: la de su recibida (supplier_invoice.deduct_from), si la tiene; si no, la del asiento.';
revoke all on function public._conta_fecha_fiscal(text, uuid, date) from public, anon;

-- El primer día abierto EN EL LIBRO desde una fecha, sin mirar el IVA (conta_primer_dia_abierto salta también los días
-- con el 303 presentado): el ejercicio abierto, ni el corte con otro programa ni un mes cerrado. Es el de la fecha
-- contable de una recibida con fecha fiscal: su IVA lo decide la fiscal.
create or replace function public._conta_primer_dia_contable(p_company uuid, p_fecha date)
returns date language sql stable security definer set search_path = public as $$
  select min(d)::date
    from generate_series(p_fecha, p_fecha + 400, interval '1 day') d
   where not public.conta_mes_cerrado(p_company, d::date)
     and exists (select 1 from public.fiscal_year y
                  where y.company_id = p_company and y.status = 'open' and d::date between y.starts_on and y.ends_on
                    and (y.imported_until is null or d::date > y.imported_until))
$$;
comment on function public._conta_primer_dia_contable(uuid, date) is
  'K11f1 · El primer día abierto en el libro desde una fecha, sin mirar el IVA (para la fecha contable de una recibida con fecha fiscal).';
revoke all on function public._conta_primer_dia_contable(uuid, date) from public, anon;
