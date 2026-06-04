-- ============================================================================
-- Folvy Supply C3.1 — Factura de proveedor (modelo + código + RLS)
-- ============================================================================
-- Cierra el ciclo de compra: pedido (PED) → recepción (ALB) → FACTURA (FAC).
-- La factura es el documento que CONFIRMA el coste y permite el three-way match.
-- Soporta notas de crédito (doc_kind) y que una factura cubra VARIOS albaranes (N:M).
-- NO mueve stock (eso lo hizo la recepción); en C3.4 ajustará coste al aprobar.
--
-- Nombre supplier_invoice (NO 'invoices' — esa es facturación SaaS/Stripe, ajena).
-- DDL idempotente, sin BEGIN/COMMIT. Funciones de código NO son SECURITY DEFINER
-- (no tocan auth.uid()); el trigger BEFORE INSERT solo rellena code.
-- ============================================================================

-- ── Cabecera ────────────────────────────────────────────────────────────────
create table if not exists public.supplier_invoice (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null,
  supplier_id        uuid references public.supplier(id),
  location_id        uuid references public.locations(id),
  code               text,                       -- FAC-00001 correlativo por cuenta
  doc_kind           text not null default 'invoice'
                       check (doc_kind in ('invoice','credit_note')),  -- factura | abono
  invoice_number     text,                       -- nº de factura del proveedor
  invoice_date       date,
  status             text not null default 'borrador'
                       check (status in ('borrador','en_revision','aprobada','con_discrepancias','pagada','anulada')),
  match_status       text not null default 'sin_match'
                       check (match_status in ('sin_match','ok','con_diferencias')),
  source             text not null default 'manual'
                       check (source in ('manual','ocr')),
  ai_session_id      uuid,                        -- sesión OCR (C3.2), reutiliza goods_receipt_ai_session
  raw_document_url   text,
  -- Importes DECLARADOS en la factura (para validar por base imponible):
  tax_base_total     numeric,
  tax_total          numeric,
  grand_total        numeric,
  -- Para notas de crédito: a qué factura corrige (nullable).
  corrects_invoice_id uuid references public.supplier_invoice(id),
  notes              text,
  needs_review       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text,
  approved_at        timestamptz,
  approved_by        uuid,
  approved_by_name   text
);

create index if not exists idx_supplier_invoice_account  on public.supplier_invoice(account_id);
create index if not exists idx_supplier_invoice_supplier on public.supplier_invoice(supplier_id);
create index if not exists idx_supplier_invoice_status   on public.supplier_invoice(account_id, status);

-- ── Líneas ──────────────────────────────────────────────────────────────────
create table if not exists public.supplier_invoice_line (
  id                   uuid primary key default gen_random_uuid(),
  supplier_invoice_id  uuid not null references public.supplier_invoice(id) on delete cascade,
  recipe_item_id       uuid references public.recipe_item(id),   -- casado (nullable hasta casar)
  raw_text             text,                                     -- texto del proveedor (OCR/manual)
  supplier_code        text,
  qty                  numeric,
  unit_price           numeric,                                  -- precio neto facturado
  line_amount          numeric,                                  -- importe neto de la línea
  vat_pct              numeric,                                  -- IVA de la factura (lo que cobran)
  vat_category_id      uuid references public.vat_category(id),  -- categoría fiscal esperada
  goods_receipt_line_id uuid references public.goods_receipt_line(id), -- línea de albarán que casa
  map_source           text,
  map_needs_review     boolean not null default false,
  -- Veredicto del three-way (lo escribe C3.3): ok|diferencia_precio|diferencia_cantidad|no_recibido|iva_no_cuadra
  match_result         text,
  match_detail         jsonb,
  position             integer,
  created_at           timestamptz not null default now()
);

create index if not exists idx_supplier_invoice_line_invoice on public.supplier_invoice_line(supplier_invoice_id);
create index if not exists idx_supplier_invoice_line_item    on public.supplier_invoice_line(recipe_item_id);

-- ── N:M factura ↔ albaranes (una factura cubre varias entregas) ──────────────
create table if not exists public.supplier_invoice_receipt (
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  goods_receipt_id    uuid not null references public.goods_receipt(id),
  primary key (supplier_invoice_id, goods_receipt_id)
);

create index if not exists idx_sir_receipt on public.supplier_invoice_receipt(goods_receipt_id);

-- ── Código correlativo FAC- (clon exacto del patrón goods_receipt) ───────────
create or replace function public.next_supplier_invoice_code(p_account_id uuid)
returns text
language plpgsql
as $$
DECLARE
  v_n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('supplier_invoice_code:' || p_account_id::text));
  SELECT COALESCE(MAX((regexp_replace(code, '\D', '', 'g'))::integer), 0) + 1
    INTO v_n
    FROM public.supplier_invoice
    WHERE account_id = p_account_id
      AND code ~ '^FAC-\d+$';
  RETURN 'FAC-' || lpad(v_n::text, 5, '0');
END;
$$;

create or replace function public.set_supplier_invoice_code()
returns trigger
language plpgsql
as $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := public.next_supplier_invoice_code(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;

drop trigger if exists trg_set_supplier_invoice_code on public.supplier_invoice;
create trigger trg_set_supplier_invoice_code
  before insert on public.supplier_invoice
  for each row execute function public.set_supplier_invoice_code();

-- ── RLS (belongs_to_account, clon del estándar) ──────────────────────────────
alter table public.supplier_invoice         enable row level security;
alter table public.supplier_invoice_line    enable row level security;
alter table public.supplier_invoice_receipt enable row level security;

drop policy if exists supplier_invoice_all on public.supplier_invoice;
create policy supplier_invoice_all on public.supplier_invoice
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

drop policy if exists supplier_invoice_line_all on public.supplier_invoice_line;
create policy supplier_invoice_line_all on public.supplier_invoice_line
  for all using (
    exists (select 1 from public.supplier_invoice si
            where si.id = supplier_invoice_line.supplier_invoice_id
              and belongs_to_account(si.account_id))
  ) with check (
    exists (select 1 from public.supplier_invoice si
            where si.id = supplier_invoice_line.supplier_invoice_id
              and belongs_to_account(si.account_id))
  );

drop policy if exists supplier_invoice_receipt_all on public.supplier_invoice_receipt;
create policy supplier_invoice_receipt_all on public.supplier_invoice_receipt
  for all using (
    exists (select 1 from public.supplier_invoice si
            where si.id = supplier_invoice_receipt.supplier_invoice_id
              and belongs_to_account(si.account_id))
  ) with check (
    exists (select 1 from public.supplier_invoice si
            where si.id = supplier_invoice_receipt.supplier_invoice_id
              and belongs_to_account(si.account_id))
  );
