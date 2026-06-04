-- supabase/migrations/20260604T1000_supply_c2_recepcion_estructura.sql
--
-- C2 del ciclo de compra: RECEPCIÓN de albarán + LIBRO MAYOR de stock.
-- Esta migración es SOLO ESTRUCTURA (tablas + índices + RLS + correlativo).
-- La FUNCIÓN DE POSTEO al ledger + el cálculo WAC + el refresco del snapshot
-- van en una migración B SEPARADA, porque son SECURITY DEFINER y se prueban
-- DESDE LA APP (auth.uid() es null en el SQL Editor) y nunca en la misma
-- transacción que las crea.
--
-- Diseño aprobado: folvy_supply_c2_recepcion_diseno_v2.md (commit 23091cb).
-- El ledger (stock_movement) es la ÚNICA fuente de verdad del stock; la
-- valoración es WAC perpetuo DERIVADO del ledger (no un número editable).
-- LIFO descartado (ilegal en ES). FIFO/FEFO no se descarta: ganchos lot_code/
-- expiry_date desde el día 1; la capa de lotes se enchufa después sin reescribir.
--
-- Recon (04/06): dominio de stock VIRGEN (cero tablas/funciones/triggers de
-- stock). El motor de coste (kitchen_recompute_raw_cost) es independiente y, de
-- hecho, ESPERA este ledger (su comentario interno declara que average_weighted/
-- average_window caen hoy a last_price "hasta que exista la recepción").
-- Nombres reales: accounts, locations (plural), supplier (singular), recipe_item,
-- recipe_item_purchase_format, kitchen_unit.
--
-- Sin BEGIN/COMMIT (regla del proyecto). Verificar con information_schema en
-- una transacción APARTE (no en este script). RLS por cuenta, patrón _rw idéntico
-- a purchase_order (helpers current_user_is_admin / _admin_or_manager_of).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. goods_receipt — CABECERA del albarán (qué llegó)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.goods_receipt (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES public.accounts(id)  ON DELETE CASCADE,

  -- El stock entra a un LOCAL (arquitectura multi-local rectora). NOT NULL:
  -- una recepción siempre tiene destino físico. RESTRICT: es historia, no se
  -- borra el local llevándose sus movimientos.
  location_id        uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  supplier_id        uuid REFERENCES public.supplier(id) ON DELETE SET NULL,

  -- Enlace al pedido. NULLABLE => recepción CIEGA (entrega sin pedido previo).
  purchase_order_id  uuid REFERENCES public.purchase_order(id) ON DELETE SET NULL,

  -- Identificación / fechas
  code               text,                       -- nuestro nº correlativo (ALB-00001), autogenerado por trigger
  supplier_doc_number text,                      -- nº de albarán DEL PROVEEDOR (para el three-way de C3)
  receipt_date       date NOT NULL DEFAULT current_date,
  received_at        timestamptz,                -- momento físico de la entrega (si se registra)

  -- Estado: borrador -> confirmado (postea al ledger) -> anulado (reversa)
  status             text NOT NULL DEFAULT 'borrador',

  -- Ganchos OCR (la captura por foto llega en C2.2 sobre esta misma estructura)
  source             text NOT NULL DEFAULT 'manual',  -- manual | ocr
  raw_document_url   text,
  ai_confidence      numeric,
  needs_review       boolean NOT NULL DEFAULT false,

  notes              text,
  is_active          boolean NOT NULL DEFAULT true,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  created_by_name    text,

  CONSTRAINT goods_receipt_status_valid
    CHECK (status IN ('borrador','confirmado','anulado')),
  CONSTRAINT goods_receipt_source_valid
    CHECK (source IN ('manual','ocr'))
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. goods_receipt_line — LÍNEA recibida (qué y cuánto, en términos de compra)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.goods_receipt_line (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  goods_receipt_id     uuid NOT NULL REFERENCES public.goods_receipt(id) ON DELETE CASCADE,

  -- Enlace a la línea pedida (comparativa pedido↔recibido). NULLABLE: línea
  -- extra (llegó algo que no se pidió) o recepción ciega.
  purchase_order_line_id uuid REFERENCES public.purchase_order_line(id) ON DELETE SET NULL,

  -- Qué llegó. recipe_item_id NULLABLE hasta resolver el mapeo (línea OCR sin casar).
  recipe_item_id       uuid REFERENCES public.recipe_item(id) ON DELETE SET NULL,
  product_name         text NOT NULL,            -- nombre tal como viene (libre / OCR)
  raw_text             text,                     -- línea cruda del OCR (gancho)

  -- Cantidad recibida EN TÉRMINOS DE COMPRA ("2 Sacos 5 kg")
  qty_received         numeric NOT NULL,
  purchase_unit_id     uuid REFERENCES public.kitchen_unit(id) ON DELETE SET NULL,
  purchase_format_id   uuid REFERENCES public.recipe_item_purchase_format(id) ON DELETE SET NULL,

  -- Derivado: lo que ENTRA a stock en unidad base. NULL + needs_review si no hay
  -- vía de conversión (anti-invención). Lo calcula el posteo (migración B).
  qty_in_base          numeric,

  -- Coste por unidad de COMPRA. NULLABLE: el albarán a menudo no trae precio
  -- (el coste real lo fija la FACTURA en C3). Provisional cuando entra.
  unit_cost            numeric,

  -- Ganchos FEFO (día 1; la capa de lotes los activa después)
  lot_code             text,
  expiry_date          date,

  -- Mapeo asistido (mismo patrón que el webhook de Last y purchase_line)
  map_source           text,                     -- pos | fuzzy | manual | ocr | unmapped
  map_confidence       numeric,
  map_needs_review     boolean NOT NULL DEFAULT false,

  position             integer NOT NULL DEFAULT 0,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. stock_movement — EL LIBRO MAYOR (única fuente de verdad del stock)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_movement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  location_id     uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  recipe_item_id  uuid NOT NULL REFERENCES public.recipe_item(id) ON DELETE RESTRICT,

  -- Tipo de asiento. recepcion existe hoy; el resto son ganchos (el tipo vive
  -- desde el día 1, los postea cada frente posterior).
  movement_type   text NOT NULL,                 -- recepcion|consumo|ajuste|traspaso_entrada|traspaso_salida|recuento

  -- Cantidad CON SIGNO en unidad BASE del artículo (+ entra, − sale).
  qty_base        numeric NOT NULL,

  -- Coste del asiento (para valoración WAC). cost_provisional: entrada de albarán
  -- sin factura; C3 lo revalúa con el coste real.
  unit_cost       numeric,
  cost_provisional boolean NOT NULL DEFAULT false,

  -- Referencia POLIMÓRFICA al origen (sin FK dura: source_id apunta a la tabla
  -- nombrada en source_type). Permite que cualquier capa futura postee sin tocar
  -- el ledger.
  source_type     text NOT NULL,                 -- goods_receipt_line|sale|inventory_count|transfer|adjustment
  source_id       uuid,

  -- Ganchos FEFO (denormalizados; sin tabla de lotes todavía → sin FK)
  lot_code        text,
  expiry_date     date,

  occurred_at     timestamptz NOT NULL DEFAULT now(),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  created_by_name text,

  CONSTRAINT stock_movement_type_valid
    CHECK (movement_type IN
      ('recepcion','consumo','ajuste','traspaso_entrada','traspaso_salida','recuento')),
  CONSTRAINT stock_movement_source_valid
    CHECK (source_type IN
      ('goods_receipt_line','sale','inventory_count','transfer','adjustment'))
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. recipe_item_location_stock — SNAPSHOT por (artículo, local)
--    Caché de lectura mantenida por el ledger (migración B). La VERDAD es la
--    suma de stock_movement; esto solo acelera la lectura y es reconstruible.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.recipe_item_location_stock (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  recipe_item_id  uuid NOT NULL REFERENCES public.recipe_item(id) ON DELETE CASCADE,
  location_id     uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,

  qty_on_hand     numeric NOT NULL DEFAULT 0,     -- en unidad base
  avg_unit_cost   numeric,                        -- WAC = stock_value / qty_on_hand
  stock_value     numeric NOT NULL DEFAULT 0,     -- Σ(qty × unit_cost) neto
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recipe_item_location_stock_uq UNIQUE (recipe_item_id, location_id)
);

-- ── Índices ──
CREATE INDEX IF NOT EXISTS idx_goods_receipt_account   ON public.goods_receipt(account_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_location  ON public.goods_receipt(location_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_supplier  ON public.goods_receipt(supplier_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_po        ON public.goods_receipt(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_status    ON public.goods_receipt(status);

CREATE INDEX IF NOT EXISTS idx_grl_receipt             ON public.goods_receipt_line(goods_receipt_id);
CREATE INDEX IF NOT EXISTS idx_grl_item                ON public.goods_receipt_line(recipe_item_id);
CREATE INDEX IF NOT EXISTS idx_grl_po_line             ON public.goods_receipt_line(purchase_order_line_id);

-- Índice clave del ledger: balance por artículo+local en orden temporal.
CREATE INDEX IF NOT EXISTS idx_sm_item_loc_time
  ON public.stock_movement(recipe_item_id, location_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_sm_account             ON public.stock_movement(account_id);
CREATE INDEX IF NOT EXISTS idx_sm_source              ON public.stock_movement(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_rils_account           ON public.recipe_item_location_stock(account_id);
CREATE INDEX IF NOT EXISTS idx_rils_location          ON public.recipe_item_location_stock(location_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Correlativo ALB-00001 por cuenta (a prueba de concurrencia)
--    Patrón replicado de next_purchase_order_code (prefijo+LPAD+trigger), con
--    advisory lock por cuenta para serializar inserciones simultáneas.
--    NO usa auth.uid() → seguro en SQL Editor; el trigger no dispara en DDL.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.next_goods_receipt_code(p_account_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_n integer;
BEGIN
  -- Serializa por cuenta: dos recepciones simultáneas no comparten correlativo.
  PERFORM pg_advisory_xact_lock(hashtext('goods_receipt_code:' || p_account_id::text));

  SELECT COALESCE(MAX((regexp_replace(code, '\D', '', 'g'))::integer), 0) + 1
    INTO v_n
    FROM public.goods_receipt
    WHERE account_id = p_account_id
      AND code ~ '^ALB-\d+$';

  RETURN 'ALB-' || lpad(v_n::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_goods_receipt_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := public.next_goods_receipt_code(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_goods_receipt_code ON public.goods_receipt;
CREATE TRIGGER trg_set_goods_receipt_code
  BEFORE INSERT ON public.goods_receipt
  FOR EACH ROW EXECUTE FUNCTION public.set_goods_receipt_code();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. RLS (patrón _rw del proyecto: admin de plataforma o admin/manager de la cuenta)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.goods_receipt              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_line         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movement             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_item_location_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goods_receipt_rw ON public.goods_receipt;
CREATE POLICY goods_receipt_rw ON public.goods_receipt
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));

DROP POLICY IF EXISTS goods_receipt_line_rw ON public.goods_receipt_line;
CREATE POLICY goods_receipt_line_rw ON public.goods_receipt_line
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));

DROP POLICY IF EXISTS stock_movement_rw ON public.stock_movement;
CREATE POLICY stock_movement_rw ON public.stock_movement
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));

DROP POLICY IF EXISTS recipe_item_location_stock_rw ON public.recipe_item_location_stock;
CREATE POLICY recipe_item_location_stock_rw ON public.recipe_item_location_stock
  FOR ALL
  USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));
