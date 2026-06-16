-- ============================================================================
-- FOLVY MAP — tabla del "Mapa de Folvy vivo dentro de la app"
-- ----------------------------------------------------------------------------
-- Diagrama de flujo del producto COMPLETO (construido + ideas pendientes), con
-- estado por caja. GLOBAL (sin account_id): es el plano del PRODUCTO, igual para
-- todos los clientes — una sola verdad. NO confundir con "módulos contratados
-- por un cliente" (eso sería otra tabla por-cuenta).
--
-- Dos estados por caja, a propósito:
--   · status_declared  = JUICIO de Julio (vivo / a_medias / deuda / idea /
--                        bloqueado / vacio). Editable en 1 clic. Manda.
--   · measure_table    = nombre de una tabla cuya POBLACIÓN mide el estado
--                        objetivo (¿tiene filas?). La página calcula el conteo
--                        en vivo. "tiene datos" ≠ "está bien" → por eso el
--                        juicio declarado existe y prevalece; cuando chocan,
--                        ESE choque es la información útil.
--
-- El flujo y las ramas se modelan con parent_id (árbol) + flow_order (orden
-- dentro del nivel). layer agrupa por banda del flujo operativo
-- (aprovisionamiento / cocina / venta / consumo / margen / plataforma / soporte).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.folvy_map_node (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidad de la caja
  code             text NOT NULL UNIQUE,          -- clave estable, p.ej. 'supply.recepcion'
  name             text NOT NULL,                 -- etiqueta visible
  description      text,                          -- qué hace esta caja (1-2 frases)

  -- Estructura del diagrama
  parent_id        uuid REFERENCES public.folvy_map_node(id) ON DELETE SET NULL,
  layer            text NOT NULL,                 -- banda del flujo (ver CHECK)
  flow_order       integer NOT NULL DEFAULT 0,    -- orden dentro de su nivel

  -- Estado DECLARADO (juicio de Julio) — el que manda
  status_declared  text NOT NULL DEFAULT 'idea',  -- ver CHECK
  status_note      text,                          -- por qué está así / disparador

  -- Estado MEDIDO (automático) — la página cuenta filas de esta tabla
  measure_table    text,                          -- nombre de tabla public.*; null = no medible (idea futura)

  -- Pista de avance (opcional, para pintar barra o conectar al frente real)
  doc_ref          text,                          -- doc/memoria/commit de referencia

  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  created_by_name  text,

  CONSTRAINT folvy_map_node_layer_chk CHECK (layer IN (
    'aprovisionamiento','cocina','venta','consumo','margen',
    'plataforma','soporte','admin'
  )),
  CONSTRAINT folvy_map_node_status_chk CHECK (status_declared IN (
    'vivo','a_medias','deuda','idea','bloqueado','vacio'
  ))
);

CREATE INDEX IF NOT EXISTS folvy_map_node_parent_idx ON public.folvy_map_node(parent_id);
CREATE INDEX IF NOT EXISTS folvy_map_node_layer_idx  ON public.folvy_map_node(layer, flow_order);

-- updated_at automático (mismo patrón que el resto del esquema)
CREATE OR REPLACE FUNCTION public.folvy_map_node_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_folvy_map_node_updated_at ON public.folvy_map_node;
CREATE TRIGGER trg_folvy_map_node_updated_at
  BEFORE UPDATE ON public.folvy_map_node
  FOR EACH ROW EXECUTE FUNCTION public.folvy_map_node_touch_updated_at();

-- RLS: el mapa es global y SOLO lo gestiona la capa plataforma (superadmin).
-- Lectura: cualquier usuario autenticado puede VERLO (es el plano del producto,
-- no datos de cliente). Escritura: solo platform_admins.
ALTER TABLE public.folvy_map_node ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folvy_map_node_read ON public.folvy_map_node;
CREATE POLICY folvy_map_node_read
  ON public.folvy_map_node FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS folvy_map_node_write ON public.folvy_map_node;
CREATE POLICY folvy_map_node_write
  ON public.folvy_map_node FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

COMMIT;
