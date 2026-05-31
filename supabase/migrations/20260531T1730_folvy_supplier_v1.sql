-- Proveedores v1: registro sanitario (RGSEAA) + deduplicación por CIF.
-- Aditiva y reversible.
-- Aplicada: 2026-05-31

begin;

-- 1) Registro sanitario (RGSEAA). Identidad España-native; futura bisagra con APPCC.
alter table public.supplier
  add column if not exists health_registry_no text;

-- 2) Deduplicación por CIF dentro de la cuenta. Parcial: NULL no colisiona,
--    así se permiten muchos proveedores sin CIF, pero no dos con el mismo CIF.
create unique index if not exists ux_supplier_account_tax_id
  on public.supplier (account_id, tax_id)
  where tax_id is not null;

commit;
