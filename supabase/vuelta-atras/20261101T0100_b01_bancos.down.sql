-- ============================================================================
-- Vuelta atrás de B01 · 1 · las tablas de bancos.
-- PARA si hay algún casado vivo con asiento: sus asientos están en el libro y
-- se deshacen antes (bank_deshacer: la propuesta se quita, lo validado se
-- anula). Si no, quita las tablas (con sus extractos y movimientos: vuelven a
-- entrar subiendo los mismos ficheros) y la columna de revisión del IBAN.
-- ============================================================================
do $$
begin
  if exists (select 1 from public.bank_match where status = 'vivo' and journal_entry_id is not null) then
    raise exception 'Hay movimientos casados con asiento: deshazlos antes en Bancos (bank_deshacer).';
  end if;
end $$;
drop table if exists public.recurring_contract;
drop table if exists public.bank_activity_log;
drop table if exists public.bank_rule_log;
drop table if exists public.bank_rule;
drop table if exists public.bank_match_item;
drop table if exists public.bank_match;
drop table if exists public.bank_movement;
drop table if exists public.bank_statement;
drop table if exists public.bank_settings;
alter table public.treasury_account drop column if exists iban_review;
