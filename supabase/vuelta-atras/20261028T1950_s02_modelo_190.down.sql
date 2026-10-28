-- supabase/vuelta-atras/20261028T1950_s02_modelo_190.down.sql
--
-- Vuelta atrás de 20261028T1950_s02_modelo_190: quita las cuatro funciones
-- del 190 y de los anuales y devuelve el CHECK de lo comprobado a sus catorce
-- claves. Antes, borra lo comprobado con las tres claves nuevas (si no, el
-- CHECK de antes no entra); los borradores del 190 y sus casillas se quedan
-- (son datos, y el CHECK de tax_return no cambia).

delete from public.tax_return_check where check_key in ('payees_190_nif', 'payees_190_province', 'payroll_190');
drop function if exists public.conta_impuesto_190_fichero(uuid, uuid);
drop function if exists public.conta_impuesto_informativa_fuera(uuid, text, int, text, date, text);
drop function if exists public.conta_impuesto_anual(uuid, int);
drop function if exists public.conta_impuesto_190_calcular(uuid, int);
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset',
                       'ledger_4751', 'payees_111', 'withholding_unclassified', 'base_200'));
