-- supabase/migrations/20260603T1600_ingestion_monitor.sql
--
-- Monitorización de ingesta de ventas (vigilante activo, 3 capas).
-- Responde al incidente del 03/06: el webhook cayó en silencio y nadie se enteró
-- durante días porque NADIE vigilaba la AUSENCIA de ventas (solo se logueaba lo
-- que llegaba). Patrón dead-man's-switch / heartbeat + defensa por capas.
--
-- Solo MODELO DE DATOS + semilla + cron (Capa 2). Las Edge Functions (system-alert,
-- ingestion-synthetic-ping) viven en supabase/functions/.
--
-- NOTA: ejecutado SIN BEGIN/COMMIT a proposito. El SQL Editor de Supabase descarta
-- la transaccion cuando se pega un bloque BEGIN...COMMIT entero (ver CONTEXTO §6.1),
-- lo que la primera vez dejo las tablas sin crear pese a un "Success" enganoso.
-- Para puro CREATE TABLE/POLICY el editor ya es atomico por sentencia; sin envoltorio.
--
-- Las funciones del cron usan service_role: saltan RLS. La RLS de aqui solo protege
-- la config de ser manipulada por usuarios no-admin via la API.
--
-- Aplicada y verificada (2 tablas, 8 y 7 columnas + seed + cron jobid 5): 2026-06-03.

-- == Config: que vigilar y con que umbral, por cuenta ==
CREATE TABLE IF NOT EXISTS public.ingestion_monitor_config (
  account_id                   uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled                      boolean   NOT NULL DEFAULT true,
  timezone                     text      NOT NULL DEFAULT 'Europe/Madrid',
  service_windows              jsonb     NOT NULL DEFAULT '[]'::jsonb,
  freshness_threshold_minutes  integer   NOT NULL DEFAULT 90,
  alert_cooldown_minutes       integer   NOT NULL DEFAULT 180,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.ingestion_monitor_config IS 'Config de monitorizacion de ingesta por cuenta (ventanas de servicio, umbrales).';
COMMENT ON COLUMN public.ingestion_monitor_config.service_windows IS 'Lista jsonb de bloques {label,start,end,min_expected}. end<start = cruza medianoche. Vacio hasta modulo de Horarios (Capa 1).';

-- == State: salud actual + antifuego de spam ==
CREATE TABLE IF NOT EXISTS public.ingestion_monitor_state (
  account_id              uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  last_sale_seen_at       timestamptz,
  last_synthetic_ping_at  timestamptz,
  last_synthetic_ping_ok  boolean,
  last_alert_sent_at      timestamptz,
  last_alert_kind         text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ingestion_monitor_state IS 'Estado de salud de ingesta por cuenta + control de cooldown de alarmas.';

-- == RLS ==
ALTER TABLE public.ingestion_monitor_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_monitor_state  ENABLE ROW LEVEL SECURITY;

CREATE POLICY imc_select ON public.ingestion_monitor_config
  FOR SELECT USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));
CREATE POLICY ims_select ON public.ingestion_monitor_state
  FOR SELECT USING (current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id));

CREATE POLICY imc_admin_write ON public.ingestion_monitor_config
  FOR ALL USING (current_user_is_admin()) WITH CHECK (current_user_is_admin());
CREATE POLICY ims_admin_write ON public.ingestion_monitor_state
  FOR ALL USING (current_user_is_admin()) WITH CHECK (current_user_is_admin());

-- == Semilla de config (Llorente29) ==
-- service_windows vacio a proposito (Capa 1 pendiente). Capas 2/3 solo necesitan
-- la fila con enabled=true.
INSERT INTO public.ingestion_monitor_config
  (account_id, enabled, timezone, service_windows, freshness_threshold_minutes, alert_cooldown_minutes)
VALUES
  ('51ad1792-6629-4ef7-833a-b57b09a86710', true, 'Europe/Madrid', '[]'::jsonb, 90, 180)
ON CONFLICT (account_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      timezone = EXCLUDED.timezone,
      freshness_threshold_minutes = EXCLUDED.freshness_threshold_minutes,
      alert_cooldown_minutes = EXCLUDED.alert_cooldown_minutes,
      updated_at = now();

-- == Cron (Capa 2): ping sintetico cada 10 min ==
-- Requiere pg_cron + pg_net (activos). CRON_SECRET inline a proposito (baja
-- sensibilidad; evitar lectura de Vault que podria enmudecer el vigilante en
-- silencio). Idempotente por nombre de job.
SELECT cron.schedule(
  'ingestion-synthetic-ping',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/ingestion-synthetic-ping',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', 'fv_cron_a7K9mQ2xR8nP4wL6vT3yB5sH1jD0gZ7c'
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
