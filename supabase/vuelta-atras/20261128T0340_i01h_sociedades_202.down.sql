-- supabase/vuelta-atras/20261128T0340_i01h_sociedades_202.down.sql
--
-- Vuelta atrás de 20261128T0340_i01h_sociedades_202: quita las tres funciones
-- del 202 y del 200, la tabla de los 200 (corporate_tax_filing) y la clave
-- 'base_200' del CHECK de lo comprobado, y deja los permisos de las tres
-- funciones de la 0330 como estaban (también la clave anónima: la vuelta atrás
-- devuelve lo de antes, no lo arregla).
-- Antes, borra lo comprobado con la clave nueva (si no, el CHECK de antes no
-- entra). Los 202 calculados y sus casillas se quedan (son datos, y el CHECK
-- de tax_return no cambia).
-- OJO: la tabla lleva los 200 escritos a mano. Recién aplicada está vacía;
-- después, quitarla es perder lo que se escribió.

delete from public.tax_return_check where check_key = 'base_200';
drop function if exists public.conta_impuesto_sociedades(uuid);
drop function if exists public.conta_impuesto_200_poner(uuid, int, jsonb, text);
drop function if exists public.conta_impuesto_202_calcular(uuid, int, text);
drop table if exists public.corporate_tax_filing;
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset',
                       'ledger_4751', 'payees_111', 'withholding_unclassified'));
grant execute on function public.conta_impuesto_retenciones_calcular(uuid, int, text, text) to public, anon;
grant execute on function public.conta_impuesto_retenciones_diario(uuid, int, text) to public, anon;
grant execute on function public.conta_impuesto_perceptores_poner(uuid, int, text) to public, anon;
