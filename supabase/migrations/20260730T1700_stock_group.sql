-- 20260730T1700_stock_group.sql
-- ============================================================================
-- FASE B — GRUPO DE STOCK COMPARTIDO (opción B, aprobada por Julio §9-B).
--
-- menu_item.external_id NO se toca (es la clave viva del casado de ventas de
-- Last en adapt_lastapp_order). Este es un mecanismo APARTE, solo para decidir
-- qué ref se publica/empuja a HubRise:
--   · stock_group_id NULL     -> por-marca (namespacing automático, sin fila aquí)
--   · stock_group_id NOT NULL -> compartido explícito ("una nevera para N marcas")
--
-- hubrise_ref: el SKU compartido real que verá HubRise. Único por cuenta.
-- Generado por hash del external_id origen (no por nombre — dos bebidas
-- distintas pueden llamarse igual, ej. "Coca Cola" y "Coca Cola (2)", y NO se
-- fusionan: Julio lo deja así a propósito).
--
-- DDL pura, segura para ejecutar de una vez. Aplicada: —
-- ============================================================================

create table if not exists public.stock_group (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  hubrise_ref text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_stock_group_hubrise_ref
  on public.stock_group (account_id, hubrise_ref);

alter table public.stock_group enable row level security;

drop policy if exists stock_group_read on public.stock_group;
create policy stock_group_read on public.stock_group
  for select using (
    public.current_user_is_admin()
    or public.current_user_is_admin_or_manager_of(account_id)
  );

drop policy if exists stock_group_write on public.stock_group;
create policy stock_group_write on public.stock_group
  for all
  using (public.current_user_is_admin_or_manager_of(account_id))
  with check (public.current_user_is_admin_or_manager_of(account_id));

alter table public.menu_item
  add column if not exists stock_group_id uuid references public.stock_group(id);

create index if not exists ix_menu_item_stock_group on public.menu_item(stock_group_id);

comment on column public.menu_item.stock_group_id is
  'NULL = por-marca (ref namespaced {brandSlug}:{external_id}, aislado). NOT NULL = comparte stock_group.hubrise_ref con los demás miembros del grupo ("una nevera"). NUNCA modifica external_id.';
