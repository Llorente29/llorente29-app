-- supabase/migrations/20261025T2249_v03_verifactu_despertar.sql
--
-- V03 · Verifactu · E1 · QUIÉN DESPIERTA EL ENVÍO Y QUIÉN AVISA DEL CERTIFICADO.
-- AÑADE: dos funciones y dos cron, solo donde está el cron_secret (producción;
-- en staging, el envío de pruebas se lanza a mano desde su workflow). No toca
-- datos ni nada de lo que existe. Va después de la 2140, que crea lo que lee.
--
--   · verifactu_despertar(): cada minuto. Si hay algo de REAL que el control de
--     flujo deja enviar, llama a conta-verifactu; si no, nada. Hoy no hay
--     ninguna empresa en real: no llama nunca. Pruebas no se despierta desde
--     aquí (la puerta de la función tampoco lo dejaría desde producción).
--   · verifactu_aviso_certificado(): cada día. Un aviso por empresa en real cuyo
--     certificado caduca en 30 días o menos (o ya ha caducado), con antirruido de
--     un día: sin certificado no se envía, y Hacienda cuenta desde la factura.

create or replace function public.verifactu_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_secreto text;
begin
  if not exists (
    select 1 from public.verifactu_registro r
      left join public.verifactu_flujo f on f.nif_emisor = r.nif_emisor and f.entorno = r.entorno
     where r.entorno = 'real' and r.estado = 'pendiente' and r.proximo_intento_at <= now()
       and (f.ultimo_envio_at is null or f.ultimo_envio_at + make_interval(secs => coalesce(f.tiempo_espera_s, 60)) <= now())
  ) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-verifactu.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-verifactu',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.verifactu_despertar() is
  'V03 · Cada minuto (cron verifactu-despertar, solo en producción): si hay registros de real que el control de flujo deja enviar, llama a conta-verifactu. Si falta el secreto, falla (cron lo apunta), no calla.';
revoke all on function public.verifactu_despertar() from public, anon, authenticated;

create or replace function public.verifactu_aviso_certificado()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v record; v_n int := 0;
begin
  for v in
    select e.account_id, e.company_id, coalesce(c.legal_name, c.trade_name) as empresa, t.valid_to, e.certificate_id
      from public.verifactu_empresa e
      join public.company c on c.id = e.company_id and c.account_id = e.account_id
      left join public.tax_certificate t on t.id = e.certificate_id and t.removed_at is null
     where e.modo = 'real' and (t.id is null or t.valid_to < now() + interval '30 days')
  loop
    perform public.encolar_alerta(
      p_kind := 'verifactu_certificado',
      p_subject := case when v.valid_to is null then 'Verifactu: ' || v.empresa || ' no tiene certificado para enviar a Hacienda'
                        when v.valid_to < now() then 'Verifactu: el certificado de ' || v.empresa || ' ha caducado'
                        else 'Verifactu: el certificado de ' || v.empresa || ' caduca el ' || to_char(v.valid_to at time zone 'Europe/Madrid', 'DD/MM/YYYY') end,
      p_message := 'Sin un certificado en vigor, las facturas de ' || v.empresa || ' se quedan en la cola y no llegan a Hacienda. Sube el nuevo en Ajustes › Certificado.',
      p_debounce_kind := 'verifactu_certificado:' || v.company_id,
      p_debounce_window := interval '1 day',
      p_account_id := v.account_id,
      p_location_id := null, p_brand_id := null,
      p_severity := case when v.valid_to is null or v.valid_to < now() + interval '7 days' then 'alto' else 'aviso' end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
comment on function public.verifactu_aviso_certificado() is
  'V03 · Cada día (cron verifactu-aviso-certificado): un aviso por empresa con Verifactu en real cuyo certificado caduca en 30 días o menos, ha caducado o no está. Devuelve cuántos avisos ha encolado.';
revoke all on function public.verifactu_aviso_certificado() from public, anon, authenticated;

-- Solo donde está el secreto de los vigías (producción); en staging se llama a la función a mano.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from vault.secrets where name = 'cron_secret') then
    if exists (select 1 from cron.job where jobname = 'verifactu-despertar') then perform cron.unschedule('verifactu-despertar'); end if;
    perform cron.schedule('verifactu-despertar', '* * * * *', $cron$select public.verifactu_despertar()$cron$);
    if exists (select 1 from cron.job where jobname = 'verifactu-aviso-certificado') then perform cron.unschedule('verifactu-aviso-certificado'); end if;
    -- 07:17 UTC: por la mañana en Madrid, fuera de la hora en punto.
    perform cron.schedule('verifactu-aviso-certificado', '17 7 * * *', $cron$select public.verifactu_aviso_certificado()$cron$);
  end if;
end $$;
