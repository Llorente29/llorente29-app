-- supabase/vuelta-atras/20261122T0140_i01_calculo_303.down.sql
--
-- Vuelta atrás de 20261122T0140_i01_calculo_303: quita las funciones del 303 y
-- deja el CHECK de tax_return_check como lo dejó la 0110 (sin
-- «previous_offset»). ANTES, la de la 0150.
-- PARA, sin tocar nada, si hay alguna declaración calculada: lo calculado se
-- quedaría sin la función que lo rehace.

do $$
declare n bigint;
begin
  if to_regclass('public.tax_return') is not null then
    execute 'select count(*) from public.tax_return where calculated_at is not null' into n;
    if n > 0 then
      raise exception 'I01a 0140 vuelta atrás: hay % declaraciones calculadas. No se toca nada.', n;
    end if;
  end if;
end $$;

drop function if exists public.conta_impuesto_303_fichero_comprobado(uuid, boolean, jsonb, text);
drop function if exists public.conta_impuesto_303_fichero(uuid);
drop function if exists public.conta_impuesto_303_calcular(uuid, int, text);
drop function if exists public.conta_impuesto_periodo_fechas(int, text);
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout'));
