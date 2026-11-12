-- supabase/migrations/20261109T1021_g05_verifactu_demos.sql
--
-- G05 · Tarea 3 (09/11/2026) · QUIÉN DESPIERTA EL ENVÍO DE PRUEBAS DE LAS DEMOS.
-- AÑADE: una función y un cron, solo donde está el cron_secret (producción).
-- No toca datos ni nada de lo que existe.
--
-- Respuesta de Julio (nº 23): la Gestoría Demo vive en producción, así que
-- conta-verifactu tiene que poder mandar a Hacienda DE PRUEBAS desde
-- producción, solo para las cuentas de demostración: «jamás al entorno real
-- desde una demo, y jamás al de pruebas desde una cuenta real».
--
--   · verifactu_despertar_demos(): cada minuto. Si hay registros de PRUEBAS de
--     una cuenta de demostración que el control de flujo deja enviar, llama a
--     conta-verifactu con {"entorno":"pruebas"}; si no, nada. Hoy no hay
--     ninguno: no llama nunca. La función, además, solo abre esa puerta con
--     CONTA_VERIFACTU_DEMOS = pruebas (lo pone Julio) y solo deja salir los
--     lotes de demo (_shared/verifactu/puerta.ts y _shared/puertaDePruebas.ts).
--   · verifactu_despertar() (la de real) no cambia.

create or replace function public.verifactu_despertar_demos()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_secreto text;
begin
  if not exists (
    select 1 from public.verifactu_registro r
      join public.company c on c.id = r.company_id
      join public.accounts a on a.id = c.account_id and a.is_demo
      left join public.verifactu_flujo f on f.nif_emisor = r.nif_emisor and f.entorno = r.entorno
     where r.entorno = 'pruebas' and r.estado = 'pendiente' and r.proximo_intento_at <= now()
       and (f.ultimo_envio_at is null or f.ultimo_envio_at + make_interval(secs => coalesce(f.tiempo_espera_s, 60)) <= now())
  ) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-verifactu.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-verifactu',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"entorno":"pruebas"}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.verifactu_despertar_demos() is
  'G05 · Cada minuto (cron verifactu-despertar-demos, solo en producción): si hay registros de PRUEBAS de una cuenta de demostración que el control de flujo deja enviar, llama a conta-verifactu con entorno pruebas (solo salen los lotes de demo). Si falta el secreto, falla (cron lo apunta), no calla.';
revoke all on function public.verifactu_despertar_demos() from public, anon, authenticated;

-- Solo donde está el secreto de los vigías (producción); en staging se llama a mano.
-- (Sin pg_cron o sin el Vault, como en una base local, no hace nada.)
do $$
declare v_hay boolean := false;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and to_regclass('vault.secrets') is not null then
    execute 'select exists (select 1 from vault.secrets where name = ''cron_secret'')' into v_hay;
  end if;
  if v_hay then
    execute $q$select cron.unschedule('verifactu-despertar-demos') from cron.job where jobname = 'verifactu-despertar-demos'$q$;
    execute $q$select cron.schedule('verifactu-despertar-demos', '* * * * *', 'select public.verifactu_despertar_demos()')$q$;
  end if;
end $$;
