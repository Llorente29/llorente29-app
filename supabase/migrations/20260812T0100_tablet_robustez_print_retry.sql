-- Aplicada: PENDIENTE (Julio, por MCP).
--
-- ⚠️ El encargo dice "ninguna migración en este encargo, todo lo que hace
-- falta en la base ya existe" — y RECON contradice esa premisa en un punto
-- concreto, se dice en vez de callarlo: la Tarea E (reintento de impresión)
-- NO SE PUEDE hacer solo en el cliente. Verificado en vivo (pg_get_
-- functiondef, no en el repo): `claim_print_jobs` solo reclama status=
-- 'pending', y `report_print_job` pone status='error' de forma PERMANENTE
-- en cualquier fallo — un job en 'error' nunca vuelve a `claim_print_jobs`,
-- pase el tiempo que pase. Por eso "max(attempts)=1 en todas las
-- impresoras": no es que el cliente no reintente, es que el SERVIDOR nunca
-- vuelve a ofrecer el trabajo. Un reintento de cliente sin esto llamaría a
-- claim_print_jobs una y otra vez y siempre recibiría [] para ese job.
--
-- Esto NO es una migración de ESQUEMA — cero columnas nuevas, cero tablas
-- nuevas, usa exactamente lo que ya existe (attempts, sent_at, created_at,
-- last_error, status — confirmado por información_schema antes de escribir
-- esto). Son sustituciones de CUERPO de función, mismo patrón "quirúrgico"
-- que el resto de esta sesión, con CREATE OR REPLACE (firma idéntica en las
-- dos, sin DROP — no cambia ni un tipo ni un parámetro).
--
-- ── report_print_job ─────────────────────────────────────────────────────
-- Antes: fallo → status='error' siempre, permanente.
-- Ahora: fallo → 'pending' otra vez SI attempts < 3 Y la venta no tiene ya
-- más de 2 horas (Tarea E.3: "una comanda vieja que aparece de golpe en
-- cocina es peor que ninguna"). Si no, 'error' de verdad — ahí sí es
-- terminal y ahí sí toca avisar en pantalla (lo decide el cliente mirando
-- job.attempts que ahora devuelve claim_print_jobs, ver abajo).
--
-- ── claim_print_jobs ─────────────────────────────────────────────────────
-- Tres cambios:
--   1) Devuelve 'attempts' en cada job — el cliente lo necesita para saber
--      si ESTE intento es el 3º y, si falla, avisar en pantalla (Tarea E.2).
--   2) Un job 'pending' con attempts>=1 no se reclama inmediatamente: espera
--      desde su último sent_at — 2s antes del intento 2, 10s antes del
--      intento 3 (Tarea E.1). Sin esto, un fallo de socket a los 5s
--      dispararía el reintento sin la espera pedida.
--   3) Añadido no pedido literalmente, mismo principio de "que no se muera"
--      de todo este encargo: un job atascado en 'sent' (la tablet lo
--      reclamó y murió/perdió red ANTES de poder llamar a report_print_job
--      — nunca llega a 'done' ni a 'error') hoy se queda ahí PARA SIEMPRE,
--      ni imprime ni libera la cola. Se trata igual que un fallo: elegible
--      de nuevo tras 30s en 'sent' sin resolver, con las mismas reglas de
--      intentos/antigüedad.
--   Cero cambio para el camino feliz (job nuevo, attempts=0): se reclama
--   igual que siempre, sin esperar nada.
--
-- Validado por MCP antes de escribir esto (solo lectura): firmas idénticas
-- confirmadas contra pg_proc en vivo, columnas usadas confirmadas contra
-- information_schema.columns en vivo.

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_print_jobs'
      and pg_get_function_identity_arguments(p.oid) = 'p_device_token text, p_limit integer'
  ) then
    raise exception 'tablet_robustez_print_retry: claim_print_jobs no tiene la firma esperada — RECON desactualizado, parar';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='report_print_job'
      and pg_get_function_identity_arguments(p.oid) = 'p_device_token text, p_job_id uuid, p_ok boolean, p_error text'
  ) then
    raise exception 'tablet_robustez_print_retry: report_print_job no tiene la firma esperada — RECON desactualizado, parar';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.claim_print_jobs(p_device_token text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device  kds_device;
  v_jobs    jsonb;
  v_config  jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'claim_print_jobs: token no válido';
  end if;

  if v_device.device_mode is distinct from 'estacion' then
    return '[]'::jsonb;
  end if;

  select jsonb_build_object('bag_qr', coalesce(k.bag_qr, false))
    into v_config
    from kitchen_time_config k
   where k.location_id = v_device.location_id;
  v_config := coalesce(v_config, jsonb_build_object('bag_qr', false));

  with pend as (
    select j.id
    from print_job j
    join printer p on p.id = j.printer_id
    where j.account_id  = v_device.account_id
      and j.location_id = v_device.location_id
      and p.is_active
      and p.transport = 'escpos_network'
      -- Tarea E.3: nada de más de 2h — una comanda vieja de golpe es peor que ninguna.
      and j.created_at >= now() - interval '2 hours'
      and (
        -- Camino feliz: job nuevo, se reclama igual que siempre.
        j.status = 'pending' and j.attempts = 0
        -- Reintento (Tarea E.1): 'pending' otra vez tras un fallo, con espera desde el último intento.
        or (
          j.status = 'pending' and j.attempts between 1 and 2
          and (j.sent_at is null or now() - j.sent_at >= (case j.attempts when 1 then interval '2 seconds' else interval '10 seconds' end))
        )
        -- Recuperación de job atascado en 'sent' (tablet murió/perdió red entre
        -- reclamar e informar — nunca llega a done/error, se queda mudo para
        -- siempre sin esto). Mismas reglas de intentos, más 30s de margen.
        or (
          j.status = 'sent' and j.attempts between 1 and 2
          and now() - j.sent_at >= interval '30 seconds'
        )
      )
    order by j.created_at
    limit p_limit
    for update skip locked
  ),
  upd as (
    update print_job j
    set status = 'sent', sent_at = now(), attempts = attempts + 1
    from pend
    where j.id = pend.id
    returning j.id, j.printer_id, j.doc_type, j.payload, j.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id',   u.id,
           'doc_type', u.doc_type,
           'payload',  u.payload,
           'attempts', u.attempts,
           'config',   v_config,
           'printer',  jsonb_build_object(
                         'id',   p.id,
                         'name', p.name,
                         'ip',   p.config->>'ip',
                         'port', coalesce((p.config->>'port')::int, 9100)
                       )
         )), '[]'::jsonb)
  into v_jobs
  from upd u
  join printer p on p.id = u.printer_id;

  return v_jobs;
end;
$function$;

comment on function public.claim_print_jobs(text, integer) is
  'Reclama trabajos de impresión pendientes de la estación (por token). Tarea
   E (fix/tablet-robustez, 12/08): reintenta jobs fallidos con espera 2s/10s
   desde su último intento (máx. 3 intentos, controlado en report_print_job),
   recupera jobs atascados en sent (tablet murió a media impresión), y nunca
   toca nada con más de 2h de antigüedad. Devuelve attempts por job para que
   el cliente sepa si ESTE intento es el último.';

CREATE OR REPLACE FUNCTION public.report_print_job(p_device_token text, p_job_id uuid, p_ok boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'report_print_job: token no válido';
  end if;

  update print_job j
  set status = case
        when p_ok then 'done'
        -- Tarea E.1/E.3: reintenta si aún le quedan intentos Y no es viejo;
        -- si no, 'error' de verdad — terminal, no se vuelve a ofrecer.
        when j.attempts < 3 and j.created_at >= now() - interval '2 hours' then 'pending'
        else 'error'
      end,
      done_at    = case when p_ok then now() else done_at end,
      last_error = case when p_ok then null else p_error end
  where j.id = p_job_id
    and j.account_id = v_device.account_id;
end;
$function$;

comment on function public.report_print_job(text, uuid, boolean, text) is
  'Informa el resultado de un trabajo de impresión. Tarea E (fix/tablet-
   robustez, 12/08): un fallo con menos de 3 intentos y menos de 2h de
   antigüedad vuelve a pending (claim_print_jobs lo reintentará con espera);
   agotados los intentos o superadas las 2h, error de verdad — terminal.';

notify pgrst, 'reload schema';

-- ── Verificación (§8 del encargo) ────────────────────────────────────────
--
-- 3) Apaga la impresora, comanda: select id, status, attempts, last_error,
--    sent_at from print_job order by created_at desc limit 1;
--    -- debe pasar pending(0)->sent(1)->pending(1)->sent(2)->pending(2)->
--    -- sent(3)->error(3), con ~2s y ~10s de separación entre reintentos.
-- select id, status, attempts from print_job where status='sent' and sent_at < now() - interval '30 seconds';
--    -- debe volver a aparecer como candidato en la siguiente llamada a claim_print_jobs.
