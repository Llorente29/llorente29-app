-- ============================================================================
-- Folvy Supply C3.5 — Enrutado de aprobación de facturas por reglas
-- ============================================================================
-- invoice_approval_rule: reglas por cuenta (importe/proveedor/local → rol requerido).
-- Default de fábrica: SIN reglas, cualquier manager/admin aprueba (no rompe lo actual).
-- Las reglas solo RESTRINGEN cuando existen.
--
-- Dos funciones de lectura (respetan RLS; NO security definer):
--   invoice_required_role(invoice) → 'admin' | 'manager'  (rol mínimo para aprobar)
--   current_user_can_approve_invoice(invoice) → boolean    (¿el usuario actual puede?)
--
-- DDL sin BEGIN/COMMIT. RLS clonada (belongs_to_account).
-- ============================================================================

create table if not exists public.invoice_approval_rule (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  min_amount    numeric,                 -- null = sin límite inferior
  max_amount    numeric,                 -- null = sin límite superior
  supplier_id   uuid references public.supplier(id),   -- null = cualquier proveedor
  location_id   uuid references public.locations(id),  -- null = cualquier local
  required_role text not null default 'manager'
                  check (required_role in ('admin','manager')),
  priority      integer not null default 100,          -- menor = se evalúa antes
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  created_by_name text
);

create index if not exists idx_invoice_approval_rule_account on public.invoice_approval_rule(account_id, priority);

alter table public.invoice_approval_rule enable row level security;

drop policy if exists invoice_approval_rule_all on public.invoice_approval_rule;
create policy invoice_approval_rule_all on public.invoice_approval_rule
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

-- ── Rol requerido para aprobar una factura ──────────────────────────────────
-- Evalúa las reglas activas de la cuenta por prioridad; la primera que casa
-- (importe + proveedor + local) manda. Sin coincidencia → 'manager' (default).
create or replace function public.invoice_required_role(p_invoice_id uuid)
returns text
language plpgsql
stable
as $$
DECLARE
  v_account_id uuid;
  v_amount numeric;
  v_supplier uuid;
  v_location uuid;
  v_role text;
BEGIN
  SELECT account_id, grand_total, supplier_id, location_id
    INTO v_account_id, v_amount, v_supplier, v_location
    FROM public.supplier_invoice WHERE id = p_invoice_id;
  IF v_account_id IS NULL THEN RETURN 'manager'; END IF;

  SELECT required_role INTO v_role
  FROM public.invoice_approval_rule r
  WHERE r.account_id = v_account_id
    AND r.active
    AND (r.min_amount IS NULL OR COALESCE(v_amount,0) >= r.min_amount)
    AND (r.max_amount IS NULL OR COALESCE(v_amount,0) <= r.max_amount)
    AND (r.supplier_id IS NULL OR r.supplier_id = v_supplier)
    AND (r.location_id IS NULL OR r.location_id = v_location)
  ORDER BY r.priority ASC
  LIMIT 1;

  RETURN COALESCE(v_role, 'manager');
END;
$$;

-- ── ¿El usuario actual puede aprobar esta factura? ──────────────────────────
create or replace function public.current_user_can_approve_invoice(p_invoice_id uuid)
returns boolean
language plpgsql
stable
as $$
DECLARE
  v_account_id uuid;
  v_required text;
BEGIN
  SELECT account_id INTO v_account_id FROM public.supplier_invoice WHERE id = p_invoice_id;
  IF v_account_id IS NULL THEN RETURN false; END IF;
  v_required := public.invoice_required_role(p_invoice_id);
  IF v_required = 'admin' THEN
    RETURN public.current_user_is_admin_of(v_account_id);
  ELSE
    RETURN public.current_user_is_admin_or_manager_of(v_account_id);
  END IF;
END;
$$;
