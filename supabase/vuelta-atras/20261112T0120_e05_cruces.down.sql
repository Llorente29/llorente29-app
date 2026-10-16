-- supabase/vuelta-atras/20261112T0120_e05_cruces.down.sql
-- Deshace la 0120 (E05, los cruces), en orden inverso. Va antes que la de la 0100.
-- Freno: si hay algo por aclarar que ya decidió una persona, o tarifas guardadas,
-- no se borra (se perdería lo decidido). Para y lo dice.
do $$
declare n int; t int;
begin
  if to_regclass('public.supplier_batch_issue') is null then return; end if;
  execute 'select count(*) from public.supplier_batch_issue where status <> ''abierta''' into n;
  execute 'select count(*) from public.supplier_rate' into t;
  if n > 0 or t > 0 then
    raise exception 'VUELTA ATRÁS 0120 PARADA: hay % cosa(s) por aclarar ya decididas y % tarifa(s) guardadas. Deshacerla las borraría: no se toca nada.', n, t
      using errcode = 'P0001';
  end if;
end $$;

drop function if exists public.conta_tarifa_guardar(uuid, text, date, jsonb, text);
drop function if exists public.conta_lote_aclarar(uuid, text, text, text);
drop function if exists public.conta_lote_cruce_guardar(uuid, jsonb, text);
drop function if exists public.conta_lote_pedidos_app(uuid);
alter table public.supplier_batch drop column if exists cross_summary;
alter table public.supplier_batch drop column if exists crossed_at;
alter table public.supplier_batch_order drop column if exists sale_id;
drop table if exists public.supplier_batch_issue;
drop table if exists public.supplier_rate;
