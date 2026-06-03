-- supabase/migrations/20260603T2000_purchase_order.sql
--
-- C1 del sistema de compras: PEDIDO (purchase order) + sus líneas.
-- Capa 1 del ciclo PO→recepción→factura. USABLE POR SÍ SOLA (el usuario crea
-- pedidos a mano / por plantilla / por stock mínimo) y con los GANCHOS del MRP II
-- puestos desde el día 1 (origin, source_need_ref) aunque no se usen todavía.
--
-- Recon (03/06): dominio de compra-proceso limpio (cero funciones de ciclo; solo
-- kitchen_recompute_* tocan 'purchase' de pasada por last_purchase). purchase/
-- purchase_line existen como "factura suelta" (se reusan en C3, no aquí).
-- Nombres reales: accounts, locations (plural), supplier (singular), recipe_item,
-- recipe_item_purchase_format, kitchen_unit.
--
-- Sin BEGIN/COMMIT (regla 03/06). Verificar con information_schema después.
-- RLS por cuenta, patrón idéntico al resto de tablas del proyecto.

-- ── Cabecera del pedido ──
CREATE TABLE IF NOT EXISTS public.purchase_order (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  location_id     uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  supplier_id     uuid REFERENCES public.supplier(id) ON DELETE SET NULL,

  -- Identificación / fechas
  code            text,                       -- nº de pedido legible (se autogenera en C1.x si se quiere)
  order_date      date NOT NULL DEFAULT current_date,
  expected_date   date,                       -- fecha de entrega esperada (lead time)

  -- Estado del ciclo
  status          text NOT NULL DEFAULT 'borrador',

  -- GANCHO MRP II: de dónde nace el pedido. Hoy: manual|template|par.
  -- Mañana el MRP añade 'mrp' sin tocar la tabla.
  origin          text NOT NULL DEFAULT 'manual',
  -- GANCHO MRP II: a qué necesidad/balance responde (vacío hoy; lo rellena el MRP).
  source_need_ref uuid,

  -- Totales estimados (al pedir aún no hay factura; son estimación)
  est_subtotal    numeric,
  est_total       numeric,
  currency        text NOT NULL DEFAULT 'EUR',

  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  created_by_name text,

  CONSTRAINT purchase_order_status_valid
    CHECK (status IN ('borrador','enviado','recibido_parcial','recibido','cerrado','cancelado')),
  CONSTRAINT purchase_order_origin_valid
    CHECK (origin IN ('manual','template','par','mrp'))
);

-- ── Líneas del pedido ──
CREATE TABLE IF NOT EXISTS public.purchase_order_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  purchase_order_id  uuid NOT NULL REFERENCES public.purchase_order(id) ON DELETE CASCADE,

  -- Qué se pide. recipe_item_id puede ser NULL si el artículo aún no existe
  -- como ingrediente (se resuelve en revisión, igual que en la factura).
  recipe_item_id     uuid REFERENCES public.recipe_item(id) ON DELETE SET NULL,
  product_name       text NOT NULL,           -- nombre tal como se pide (libre)

  -- Cantidad pedida en una unidad/formato de compra
  qty_ordered        numeric NOT NULL,
  purchase_unit_id   uuid REFERENCES public.kitchen_unit(id) ON DELETE SET NULL,
  purchase_format_id uuid REFERENCES public.recipe_item_purchase_format(id) ON DELETE SET NULL,

  -- Precio estimado al pedir (la realidad llega con la factura, C3)
  est_unit_price     numeric,
  est_line_total     numeric,

  position           integer NOT NULL DEFAULT 0,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_account   ON public.purchase_order(account_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_supplier  ON public.purchase_order(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_status    ON public.purchase_order(status);
CREATE INDEX IF NOT EXISTS idx_pol_order                ON public.purchase_order_line(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_pol_item                 ON public.purchase_order_line(recipe_item_id);

-- ── RLS (patrón del proyecto: acceso por cuenta del usuario) ──
ALTER TABLE public.purchase_order      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_line ENABLE ROW LEVEL SECURITY;

-- Política: el usuario ve/gestiona pedidos de cuentas sobre las que es admin o manager.
-- Usa los helpers existentes del proyecto (current_user_is_admin / _admin_or_manager_of).
CREATE POLICY purchase_order_rw ON public.purchase_order
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));

CREATE POLICY purchase_order_line_rw ON public.purchase_order_line
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));
