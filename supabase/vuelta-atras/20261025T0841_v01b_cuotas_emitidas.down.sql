-- supabase/vuelta-atras/20261025T0841_v01b_cuotas_emitidas.down.sql
--
-- Vuelta atrás de 20261025T0841_v01b_cuotas_emitidas: cada línea con la
-- cuota que tenía antes (de la copia, _copia_v01b_cuotas: nula), y sin la
-- copia. Solo las líneas de la copia: las de facturas emitidas después
-- conservan la suya. Una línea de una emitida no se cambia
-- (customer_invoice_line_inalterable): aquí se apaga ese freno el tiempo
-- justo, dentro de esta transacción.

do $$ begin
  if to_regclass('public._copia_v01b_cuotas') is null then return; end if;
  alter table public.customer_invoice_line disable trigger trg_customer_invoice_line_inalterable;
  update public.customer_invoice_line l set tax_amount = c.cuota_antes
    from public._copia_v01b_cuotas c where c.line_id = l.id;
  alter table public.customer_invoice_line enable trigger trg_customer_invoice_line_inalterable;
end $$;

drop table if exists public._copia_v01b_cuotas;
