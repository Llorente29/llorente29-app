-- supabase/vuelta-atras/20261126T0710_x14i_repetida_en_erp10.down.sql
-- X14i · Devuelve conta_traer_dar_por_bueno de su respaldo y la regla de un solo número de antes, y quita la marca y su
-- guarda. Si ya hay emitidas marcadas «repetida en ERP10» (lo traído las necesita), para: la regla de antes no cabe.
do $$ begin
  if exists (select 1 from public.customer_invoice where import_repeated) then
    raise exception 'X14i: hay emitidas marcadas «repetida en ERP10»: con ellas no cabe la regla de un solo número de antes. No se deshace.';
  end if;
end $$;
select public._restaurar_funcion('public.conta_traer_dar_por_bueno(uuid,text)', '20261126T0710_x14i_repetida_en_erp10');
alter table public.customer_invoice add constraint customer_invoice_company_id_series_code_fiscal_year_number_key
  unique (company_id, series_code, fiscal_year, number);
drop index if exists public.customer_invoice_numero_unico;
drop trigger if exists tg_customer_invoice_repetida on public.customer_invoice;
drop function if exists public._customer_invoice_repetida_guarda();
alter table public.customer_invoice drop constraint if exists customer_invoice_repetida_solo_traida;
alter table public.customer_invoice drop column if exists import_repeated;
