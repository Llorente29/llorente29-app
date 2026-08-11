-- Aplicada: PENDIENTE (Julio, por MCP). Puede aplicarse en cualquier momento,
-- con servicio abierto o cerrado: es 100% ADITIVA, no toca ninguna función
-- existente ni quita ninguna escritura todavía. Ver 20260816T0901 (la que sí
-- quita las escrituras) para la parte que exige servicio cerrado y secuencia.
--
-- ENCARGO fix/kds-latido-raiz · Tarea A, parte 1/2 — crea el latido de raíz.
-- Partida en dos migraciones a propósito (11/08) para que la secuencia
-- obligatoria del encargo §2.4 sea real, no solo un comentario:
--   1) ESTA migración (0900): crea kds_heartbeat. Aplícala ya — no rompe nada,
--      nadie la llama todavía.
--   2) Despliega el bundle OTA con la llamada a kds_heartbeat (cliente ya
--      escrito en src/native/print/printWorker.ts, un setInterval a 60s) y
--      CONFIRMA que las 3 tablets vivas laten por aquí (kds_device.last_seen_at
--      avanzando a ritmo de 60s, no al ritmo de las lecturas de pantalla).
--   3) Solo entonces aplica 20260816T0901_kds_heartbeat_remove_writes.sql
--      (esa sí exige servicio cerrado: quita la escritura de las 13 funciones
--      de lectura). Aplicar 0901 antes de confirmar el paso 2 dejaría a las
--      tablets sin latido alguno.
--
-- kds_heartbeat: el encargo pedía firma (p_device_id, p_token) calcando
-- kds_authorize. RECON del cliente: las tablets (TabletStationRoute.tsx,
-- KdsKioskRoute.tsx, printWorker.ts) solo persisten el TOKEN en localStorage
-- (`kds_device_token`) — nunca un device_id propio, y no hay hoy ningún flujo
-- que se lo entregue al vincular. Exigir p_device_id habría obligado a
-- inventar ese flujo solo para repetir un chequeo que el token ya hace por sí
-- solo (kds_resolve_device ya exige token exacto + is_active=true → resuelve
-- como máximo UNA fila; conocer esa fila ya implica poseer el token). Es la
-- misma foto que las otras 13 funciones _by_token, ninguna pide un id
-- adicional. Se simplifica a (p_token, p_app_version, p_platform) —
-- desviación del encargo explicada aquí, no silenciosa.
--
-- Guarda mínimo de 10s (no 30s: el latido ya lo dispara un único setInterval
-- de cliente a un ritmo mucho menor que una lectura de pantalla) como red de
-- seguridad barata ante un futuro bug de cliente que lo llame en bucle — la
-- razón de ser de todo este encargo es exactamente ese escenario.
--
-- p_app_version/p_platform opcionales: mismo patrón que report_device_app_version
-- (que se queda intacto para clientes viejos que aún lo llamen por separado;
-- el cliente nuevo NO los manda desde el heartbeat — sigue usando
-- reportAppVersion() en su propio ciclo, ver native/appUpdate.ts — para no
-- duplicar la composición del string de versión en dos sitios).
--
-- Validado por MCP con nombre temporal _tmp_check_kds_heartbeat antes de
-- escribir este fichero (compiló, corrió con token inexistente → false).

do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'kds_resolve_device'
  ) then
    raise exception 'kds_heartbeat_create: falta kds_resolve_device — RECON desactualizado, parar';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.kds_heartbeat(
  p_token text,
  p_app_version text DEFAULT NULL::text,
  p_platform text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_token);
  if v_device.id is null then
    return false;
  end if;

  update kds_device
  set last_seen_at   = now(),
      app_version    = coalesce(nullif(btrim(coalesce(p_app_version, '')), ''), app_version),
      platform       = coalesce(nullif(btrim(coalesce(p_platform, '')), ''), platform),
      app_version_at = case when nullif(btrim(coalesce(p_app_version, '')), '') is not null then now() else app_version_at end,
      updated_at     = now()
  where id = v_device.id
    and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');

  return true;
end;
$function$;

comment on function public.kds_heartbeat(text, text, text) is
  'Único RPC pensado para escribir kds_device.last_seen_at (fix/kds-latido-raiz, '
  '11/08). Llamado por un solo setInterval de cliente. Hasta aplicar '
  '20260816T0901 conviven con él las 13 funciones de lectura que aún escriben '
  'por su cuenta (mitigación de emergencia del 11/08, freno de 30s).';

grant execute on function public.kds_heartbeat(text, text, text) to public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'kds_heartbeat'
      and pg_get_function_identity_arguments(oid) = 'p_token text, p_app_version text DEFAULT NULL::text, p_platform text DEFAULT NULL::text'
  ) then
    raise exception 'kds_heartbeat_create: kds_heartbeat no quedó creada con la firma esperada';
  end if;
end $$;

notify pgrst, 'reload schema';
