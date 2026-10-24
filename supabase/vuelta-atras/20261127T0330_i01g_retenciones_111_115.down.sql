-- supabase/vuelta-atras/20261127T0330_i01g_retenciones_111_115.down.sql
--
-- Vuelta atrás de 20261127T0330_i01g_retenciones_111_115: quita las tres
-- funciones del 111 y el 115 y devuelve el CHECK de lo comprobado a sus diez
-- claves. Antes, borra lo comprobado con las tres claves nuevas (si no, el
-- CHECK de antes no entra); los borradores del 111 y el 115 y sus casillas se
-- quedan (son datos, y el CHECK de tax_return no cambia).

delete from public.tax_return_check where check_key in ('ledger_4751', 'payees_111', 'withholding_unclassified');
drop function if exists public.conta_impuesto_perceptores_poner(uuid, int, text);
drop function if exists public.conta_impuesto_retenciones_calcular(uuid, int, text, text);
drop function if exists public.conta_impuesto_retenciones_diario(uuid, int, text);
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset'));
