-- Vuelta atrás de 20261030T0935_s01d_contratos.sql. Solo se puede si no hay
-- contratos de los tipos nuevos (aplazamiento, póliza) ni pólizas sin
-- importe: si los hay, para y lo dice (no se borra lo que alguien dio de alta).
do $$ begin
  if exists (select 1 from public.recurring_contract where kind in ('aplazamiento', 'poliza') or amount is null) then
    raise exception 'Hay contratos de aplazamiento o póliza dados de alta: no se deshace sin decidir qué hacer con ellos.';
  end if;
end $$;
drop function if exists public.bank_contrato_guardar(uuid, jsonb);
drop function if exists public.conta_cuadro_con_pendiente(jsonb, numeric);
alter table public.recurring_contract drop constraint if exists recurring_contract_cuentas;
alter table public.recurring_contract add constraint recurring_contract_cuentas check (
  (kind = 'prestamo' and capital_account is not null and interest_account is not null)
  or (kind <> 'prestamo' and expense_account is not null));
alter table public.recurring_contract drop constraint if exists recurring_contract_importe;
alter table public.recurring_contract alter column amount set not null;
alter table public.recurring_contract drop constraint if exists recurring_contract_kind_check;
alter table public.recurring_contract add constraint recurring_contract_kind_check check (kind in ('prestamo', 'alquiler', 'otro'));
alter table public.recurring_contract
  drop column if exists long_capital_account, drop column if exists short_capital_account, drop column if exists treasury_account_id,
  drop column if exists principal, drop column if exists installments, drop column if exists document_name, drop column if exists document_kind;
