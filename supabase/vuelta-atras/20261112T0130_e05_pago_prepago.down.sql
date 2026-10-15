-- supabase/vuelta-atras/20261112T0130_e05_pago_prepago.down.sql
-- Deshace la 0130 (E05, el pago contra el saldo prepago). Va antes que la 0120 y la 0100.
-- Freno: con algún pago de lote propuesto o validado, o saldos del portal ya
-- comparados, no se borra nada. Para y lo dice.
do $$
declare n int; m int;
begin
  if to_regclass('public.supplier_balance_check') is null then return; end if;
  execute 'select count(*) from public.supplier_batch where payment_entry_id is not null' into n;
  execute 'select count(*) from public.supplier_balance_check' into m;
  if n > 0 or m > 0 then
    raise exception 'VUELTA ATRÁS 0130 PARADA: hay % lote(s) con su pago propuesto y % comparación(es) con el portal. Deshacerla las perdería: no se toca nada.', n, m
      using errcode = 'P0001';
  end if;
end $$;

drop function if exists public.conta_catcher_saldo_comprobar(uuid, numeric, text);
drop function if exists public.conta_catcher_saldo(uuid);
drop table if exists public.supplier_balance_check;
drop function if exists public.conta_lote_pago_proponer(uuid, text);
alter table public.supplier_batch drop column if exists payment_entry_id;
