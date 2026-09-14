-- ═══════════════════════════════════════════════════════════════════════════
-- #30 · LA HORA DEL RENOVADOR · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se registra AHORA y no en el mismo empujón que la función, a propósito:
-- primero se despliega, luego se comprueba que está viva, y sólo entonces se le
-- pone la hora. Un cron apuntando a una función que no existe falla en silencio
-- todas las noches --que es exactamente la forma de avería que estamos
-- persiguiendo desde el 30/08 (`kds_heartbeat` con token huérfano devolviendo
-- 200, el autocierre degradando fallos a `raise warning`).
--
-- LO COMPROBADO ANTES DE PONER LA HORA, llamándola de verdad desde la base,
-- igual que la llamará el cron:
--
--   · con el secreto bueno → 200 y
--     {"ok":true,"cuentas":[{"red":"instagram","cuenta":"51ad1792-…",
--      "nombre":"ig_token_foodint","dias":59,"saltada":"todavia falta"}]}
--   · con un secreto falso → 403 «forbidden»
--   · y DESPUÉS de las dos: la huella md5 de la llave igual, `caduca_el` en
--     2026-11-12, `llave_ok_at` en NULL y 0 avisos encolados. No tocó nada,
--     que es justo lo que tiene que hacer faltando 59 días.
--
-- LA HORA: 05:50. Está libre --05:40 modifier-zero-cost, 06:10
-- edge-drift-salud-- y cae justo ANTES del vigía de salud, que es el que lee
-- `secret_expiry`. Así, el día que el renovador mueva la fecha, el vigía de
-- veinte minutos después ya la ve movida.
--
-- Fuera de la banda de servicio, y de todas formas esto no toca el camino del
-- pedido: llama a una edge function por HTTP y no cierra ninguna tabla.

select cron.schedule(
  'social-token-refresh-daily',
  '50 5 * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/social-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', (select decrypted_secret
                           from vault.decrypted_secrets
                          where name = 'offers_agent_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

do $comprueba$
declare v_id int; v_sched text; v_act boolean; v_cmd text;
begin
  select jobid, schedule, active, command into v_id, v_sched, v_act, v_cmd
    from cron.job where jobname = 'social-token-refresh-daily';

  if v_id is null then
    raise exception 'el cron no ha quedado registrado';
  end if;
  if v_sched <> '50 5 * * *' then
    raise exception 'la hora no es la que se queria: %', v_sched;
  end if;
  if not v_act then
    raise exception 'el cron ha quedado apagado';
  end if;
  if v_cmd !~ 'social-token-refresh' then
    raise exception 'el cron no apunta a la funcion: %', left(v_cmd, 120);
  end if;

  raise notice 'cron % · % · activo · apunta a social-token-refresh', v_id, v_sched;
end;
$comprueba$;
