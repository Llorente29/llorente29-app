-- ============================================================================
-- Folvy Supply C2.2.b — casado de líneas con memoria
-- ============================================================================
-- 1) article_supplier.supplier_item_name — DENOMINACIÓN del proveedor (cómo
--    llama el proveedor a ese artículo, p.ej. Makro → "METRO Chef queso grana
--    padano DOP cuña 10 meses Italia"). La rellena el aprendizaje al confirmar
--    (b.3) con el raw_text del albarán. Estándar Apicbase/MarketMan; mejora el
--    casado por nombre POR PROVEEDOR.
-- 2) supplier_alias — MEMORIA de intermediario (b.4): cuando el proveedor
--    comercial (Cloudtown) difiere del emisor del albarán (Joan/Bidfood),
--    recuerda emisor→comercial + delivered_by, para autoproponer en el próximo
--    albarán de ese emisor. Casado por texto normalizado del emisor (y NIF si lo hay).
--
-- DDL idempotente, sin BEGIN/COMMIT. No ejecuta funciones SECURITY DEFINER
-- (solo las referencia en políticas). RLS clonada del patrón del repo
-- (belongs_to_account en select/insert/update).
-- ============================================================================

-- ── 1) Denominación del proveedor en la ficha artículo-proveedor ──
alter table public.article_supplier
  add column if not exists supplier_item_name text;

-- ── 2) Memoria de intermediario (emisor del albarán → proveedor comercial) ──
create table if not exists public.supplier_alias (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null,
  -- Texto del EMISOR tal como aparece en el albarán, normalizado (lower/sin acentos).
  emitter_norm    text not null,
  -- NIF del emisor, normalizado (sin guiones/espacios). Opcional, refuerza el casado.
  emitter_nif     text,
  -- Proveedor COMERCIAL al que se resuelve (Cloudtown).
  supplier_id     uuid not null references public.supplier(id) on delete cascade,
  -- Cómo mostrar el "entregado por" (texto original del emisor, p.ej. "Distribuidora Joan").
  delivered_by    text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, emitter_norm)
);

create index if not exists idx_supplier_alias_account on public.supplier_alias(account_id);
create index if not exists idx_supplier_alias_nif on public.supplier_alias(account_id, emitter_nif);

alter table public.supplier_alias enable row level security;

drop policy if exists supplier_alias_select on public.supplier_alias;
create policy supplier_alias_select on public.supplier_alias
  for select using (belongs_to_account(account_id));

drop policy if exists supplier_alias_insert on public.supplier_alias;
create policy supplier_alias_insert on public.supplier_alias
  for insert with check (belongs_to_account(account_id));

drop policy if exists supplier_alias_update on public.supplier_alias;
create policy supplier_alias_update on public.supplier_alias
  for update using (belongs_to_account(account_id));
