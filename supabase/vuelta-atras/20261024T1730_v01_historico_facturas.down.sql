-- supabase/vuelta-atras/20261024T1730_v01_historico_facturas.down.sql
--
-- Vuelta atrás de 20261024T1730_v01_historico_facturas: deja el libro y las
-- facturas como estaban antes de la tanda.
--   1. El número de cada anotación del libro de los cierres, el de antes (de
--      la copia, _copia_v01_historico_libro).
--   2. Las facturas que creó (y solo esas: _v01_historico_facturas), con sus
--      líneas y su historial; y el PDF que «Hacer los PDF que faltan» dejó
--      junto al asiento de un traído (journal_entry_document «factura_expedida»
--      de esos asientos). El fichero en el almacén se queda: sin su fila no es
--      el documento de nadie.
--      Una factura emitida no se borra nunca (customer_invoice_inalterable):
--      aquí se apaga ese freno el tiempo justo, dentro de esta transacción.
--   3. Los contadores de las series que la tanda estrenó.
--   4. Las funciones y las tablas de la tanda.
-- PARA si alguna de esas facturas tiene ya una rectificativa o un cobro: eso
-- ya es trabajo de alguien, y no se deshace a ciegas.

do $$ begin
  if to_regclass('public._v01_historico_facturas') is null then return; end if;
  if exists (select 1 from public.customer_invoice ci join public._v01_historico_facturas h on h.invoice_id = ci.corrects_id)
     or exists (select 1 from public.customer_invoice_payment p join public._v01_historico_facturas h on h.invoice_id = p.invoice_id) then
    raise exception 'VUELTA ATRÁS DEL HISTÓRICO: alguna de sus facturas ya tiene una rectificativa o un cobro. No se deshace a ciegas.';
  end if;
end $$;

do $$ begin
  if to_regclass('public._copia_v01_historico_libro') is not null then
    update public.vat_book_entry v set number = c.numero_antes, updated_at = now(), updated_by_name = 'Vuelta atrás del histórico (V01)'
      from public._copia_v01_historico_libro c where c.vat_book_entry_id = v.id;
  end if;
  if to_regclass('public._v01_historico_facturas') is not null then
    delete from public.journal_entry_document d using public._v01_historico_facturas h
     where d.entry_id = h.entry_id and h.grupo = 'traida' and d.kind = 'factura_expedida';
    alter table public.customer_invoice disable trigger trg_customer_invoice_inalterable;
    alter table public.customer_invoice_line disable trigger trg_customer_invoice_line_inalterable;
    delete from public.customer_invoice ci using public._v01_historico_facturas h where ci.id = h.invoice_id;
    alter table public.customer_invoice_line enable trigger trg_customer_invoice_line_inalterable;
    alter table public.customer_invoice enable trigger trg_customer_invoice_inalterable;
  end if;
  if to_regclass('public._v01_historico_contadores') is not null then
    delete from public.customer_invoice_counter k using public._v01_historico_contadores c
     where k.company_id = c.company_id and k.series_code = c.series_code and k.fiscal_year = c.fiscal_year;
  end if;
end $$;

drop function if exists public._conta_v01_historico_factura(uuid, text, text, integer, text);
drop function if exists public.conta_v01_historico_traidos();
drop function if exists public.conta_v01_historico_cierres();
drop table if exists public._v01_historico_contadores;
drop table if exists public._v01_historico_facturas;
drop table if exists public._copia_v01_historico_libro;
