-- Vuelta atrás de 20261030T0934_s01d_contratos_columnas.sql: fuera las columnas (lo que guardan se pierde).
alter table public.recurring_contract
  drop column if exists long_capital_account, drop column if exists short_capital_account, drop column if exists treasury_account_id,
  drop column if exists principal, drop column if exists installments, drop column if exists document_name, drop column if exists document_kind;
