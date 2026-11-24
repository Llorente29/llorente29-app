-- supabase/migrations/20261119T1405_r07_cuenta_factura_del_dia.sql
--
-- R07 · 1 · A qué cuenta va la factura del día, por empresa. SOLO AÑADE.
--
-- El día del TPV pasa a contabilizarse en dos asientos (encargo R07, Julio, 19/11):
--   1. la factura del día: «Clientes de contado» al debe, contra las ventas y el IVA;
--   2. el cobro del día: cada forma de pago a su cuenta, contra «Clientes de contado».
-- «Clientes de contado» es una cuenta de la empresa que elige quien lleva la
-- contabilidad (Sumied propone una 430 que ya se llame así). Se guarda aquí, una
-- por empresa, como las formas de pago (conta_tpv_forma_cuenta, R03).
--
-- Prueba: supabase/staging/sql/20261119_r07_cuenta_factura_del_dia_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261119T1405_r07_cuenta_factura_del_dia.down.sql
--
-- Tabla nueva: no cambia ninguna que exista ni la lee nadie todavía. Se puede
-- pasar dos veces (if not exists, drop … if exists).

create table if not exists public.conta_tpv_factura_cuenta (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  company_account_id uuid not null references public.company_account(id) on delete restrict,
  created_at         timestamptz not null default now(),
  created_by_name    text,
  constraint conta_tpv_factura_cuenta_una unique (company_id)
);
comment on table public.conta_tpv_factura_cuenta is
  'R07: la cuenta de «La factura del día va a» («Clientes de contado»), una por empresa. La factura del día la lleva al debe y el cobro del día la deja a cero.';

drop trigger if exists trg_conta_tpv_factura_cuenta_misma_cuenta on public.conta_tpv_factura_cuenta;
create trigger trg_conta_tpv_factura_cuenta_misma_cuenta before insert or update on public.conta_tpv_factura_cuenta
  for each row execute function public.conta_misma_cuenta();

alter table public.conta_tpv_factura_cuenta enable row level security;
revoke all on public.conta_tpv_factura_cuenta from public, anon, authenticated;
grant all on public.conta_tpv_factura_cuenta to service_role;
grant select, insert, update, delete on public.conta_tpv_factura_cuenta to authenticated;
drop policy if exists conta_tpv_factura_cuenta_select on public.conta_tpv_factura_cuenta;
create policy conta_tpv_factura_cuenta_select on public.conta_tpv_factura_cuenta for select
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_tpv_factura_cuenta_insert on public.conta_tpv_factura_cuenta;
create policy conta_tpv_factura_cuenta_insert on public.conta_tpv_factura_cuenta for insert
  with check (public.current_user_is_admin_or_manager_of(account_id));
drop policy if exists conta_tpv_factura_cuenta_update on public.conta_tpv_factura_cuenta;
create policy conta_tpv_factura_cuenta_update on public.conta_tpv_factura_cuenta for update
  using (public.current_user_is_admin_or_manager_of(account_id));
drop policy if exists conta_tpv_factura_cuenta_delete on public.conta_tpv_factura_cuenta;
create policy conta_tpv_factura_cuenta_delete on public.conta_tpv_factura_cuenta for delete
  using (public.current_user_is_admin_or_manager_of(account_id));
