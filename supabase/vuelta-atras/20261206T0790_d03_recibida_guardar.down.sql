-- supabase/vuelta-atras/20261206T0790_d03_recibida_guardar.down.sql
--
-- Vuelta atrás de 20261206T0790_d03_recibida_guardar: sin las tres funciones,
-- sin supplier_invoice_expense ni supplier_invoice_change, y sin las columnas
-- nuevas de supplier_invoice (payment_method, no_document_*, entry_overrides,
-- withholding_base). No cambió ninguna función que existiera.
--
-- PARA, sin quitar nada, si ya se ha guardado algo con ella: filas en las dos
-- tablas o algún valor en las columnas nuevas. Quitarlas entonces perdería lo
-- que alguien guardó en una ficha (y su historial). Lo que se guardó en las
-- columnas de antes (proveedor, IVA, totales, vencimiento…) se queda: es de
-- la factura. La ejecuta la prueba de staging.
do $$
declare v_n bigint;
begin
  if to_regclass('public.supplier_invoice_change') is not null then
    execute 'select (select count(*) from public.supplier_invoice_change) + (select count(*) from public.supplier_invoice_expense)' into v_n;
    if v_n > 0 then
      raise exception 'D03 0790 (vuelta atrás): ya hay % fila(s) guardadas en el reparto del gasto o en el historial de las fichas: no se quitan.', v_n;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name = 'entry_overrides') then
    execute 'select count(*) from public.supplier_invoice where payment_method is not null or no_document_at is not null or no_document_reason is not null
               or no_document_by_name is not null or entry_overrides is not null or withholding_base is not null' into v_n;
    if v_n > 0 then
      raise exception 'D03 0790 (vuelta atrás): % factura(s) ya tienen guardada la forma de pago, «Sin PDF», el asiento a mano o la base de la retención: no se quitan.', v_n;
    end if;
  end if;
end $$;

drop function if exists public.conta_recibida_sin_papel(uuid, boolean, text, text);
drop function if exists public.conta_recibida_papel_poner(uuid, text, text, text);
drop function if exists public.conta_recibida_guardar(uuid, jsonb, text);
drop table if exists public.supplier_invoice_change;
drop table if exists public.supplier_invoice_expense;
alter table public.supplier_invoice drop column if exists withholding_base;
alter table public.supplier_invoice drop column if exists entry_overrides;
alter table public.supplier_invoice drop column if exists no_document_by_name;
alter table public.supplier_invoice drop column if exists no_document_reason;
alter table public.supplier_invoice drop column if exists no_document_at;
alter table public.supplier_invoice drop column if exists payment_method;
