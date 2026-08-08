-- Aplicada: 2026-08-08 por MCP.
-- SERIE HISTORICA ANCLADA. Antes de esto, el sistema solo tenia 56 dias de historia
-- (sale, desde 12-jun-2026). Esta tabla guarda el historico previo para que no haya
-- que volver a subir los CSV nunca mas.
--
-- ORIGEN: export de tabs de LastApp, 60.000 pedidos unicos, feb-2023 -> ago-2026,
-- marcas CEDIDAS de las 3 cocinas de Foodint en Madrid.
-- Bebidas y postres EXCLUIDOS de 'platos' (no generan trabajo de cocina: abrir nevera
-- y meter en bolsa). Se guardan aparte por si hacen falta para otros calculos.
--
-- NIVEL: 'platos' y 'pedidos' son CEDIDAS. Para estimar el total del local hay que
-- dividir por el peso de cedidas de ese local (medido jun-ago 2026):
--   Alcala 63,9% cedidas · Plaza Castilla 69,9% · Carabanchel 79,6%
-- Ese escalado es ESTIMACION y va marcado como tal, nunca como venta registrada.

CREATE TABLE IF NOT EXISTS public.sales_history_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id),
  location_id   uuid NOT NULL REFERENCES public.locations(id),
  day           date NOT NULL,
  scope         text NOT NULL DEFAULT 'licensed',
  orders        integer NOT NULL DEFAULT 0,
  dishes        numeric NOT NULL DEFAULT 0,
  drinks        numeric NOT NULL DEFAULT 0,
  desserts      numeric NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'lastapp_tabs_export',
  imported_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_history_daily_uq UNIQUE (account_id, location_id, day, scope, source),
  CONSTRAINT sales_history_daily_scope_chk CHECK (scope IN ('licensed','own','all'))
);

CREATE INDEX IF NOT EXISTS idx_shd_loc_day ON public.sales_history_daily(location_id, day);
CREATE INDEX IF NOT EXISTS idx_shd_account ON public.sales_history_daily(account_id, day);

ALTER TABLE public.sales_history_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shd_read ON public.sales_history_daily;
CREATE POLICY shd_read ON public.sales_history_daily
  FOR SELECT USING (public.belongs_to_account(account_id));

COMMENT ON TABLE public.sales_history_daily IS
  'Historico diario anterior a la ingesta viva. Origen: export LastApp de marcas cedidas (feb-2023 -> ago-2026). Bebidas/postres separados de platos. El nivel es de CEDIDAS: escalar por el peso de cedidas del local para estimar total.';

DO $g$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='sales_history_daily') THEN
    RAISE EXCEPTION 'sales_history_daily no quedo';
  END IF;
END $g$;

NOTIFY pgrst, 'reload schema';
