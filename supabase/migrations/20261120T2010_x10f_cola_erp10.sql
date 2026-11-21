-- supabase/migrations/20261120T2010_x10f_cola_erp10.sql
--
-- X10f · Lo validado sale solo a ERP10 (encargo del 20/11). SOLO AÑADE: una columna que admite
-- nulos, tres funciones nuevas y, donde está el secreto de los vigías (producción), un cron.
--
--   como                           En conta_erp10_envio: cómo salió. «sola» (la cola), «a_mano» (el
--                                  botón de «Salida a ERP10» o «Volver a intentarlo»), o «excel» (no
--                                  sale por la conexión: retención, inversión del sujeto pasivo,
--                                  intracomunitaria, más de tres tipos de I.V.A. o un día del TPV
--                                  que no se puede armar; sale con el Excel, y la cola no lo coge más).
--   conta_erp10_cola(limite)       Lo que le toca salir solo ahora, en el orden en que se validó.
--                                  Solo el servidor (conta-erp10-cola).
--   conta_erp10_despertar()        Cada minuto (cron conta-erp10-despertar): si hay algo en la cola,
--                                  llama a conta-erp10-cola. Sin el secreto, falla (no calla).
--   conta_erp10_atascados(empresa) Cuántos llevan más de una hora validados sin salir (la barra de
--                                  abajo). Para los de la cuenta.
--
-- La cola, por empresa:
--   · la salida encendida y la empresa conectada con su código de empresa de ERP10. Apagada, nada
--     (sin perder nada: al encenderla, sigue por donde iba);
--   · la PRIMERA salida de la empresa no sale sola: la manda una persona desde «Salida a ERP10» y
--     la da por igualada en el paso 3. Sin ese igualado posterior a la primera, nada sale solo;
--   · lo validado desde «desde», que no ha salido (ni por el Excel ni por la conexión), con las
--     mismas exclusiones que conta_erp10_por_salir (lo traído, la apertura, el cierre…);
--   · nada dos veces: lo que está en ERP10 (y apuntado), lo que se está sacando (10 minutos), lo
--     que falló hace menos de 5 minutos, lo que ya falló tres veces (se queda parado con su motivo)
--     y lo que sale con el Excel, fuera. El envío es uno por asiento (conta_erp10_envio_asiento_uq).
--
-- Nada en el camino del pedido. El real lo lanza Julio.

alter table public.conta_erp10_envio add column if not exists como text;
comment on column public.conta_erp10_envio.como is
  'X10f · Cómo salió: «sola» (la cola, conta-erp10-cola), «a_mano» (el botón o «Volver a intentarlo») o «excel» (no sale por la conexión: sale con el Excel; la cola no lo vuelve a coger). Null: lo de antes del X10f.';

-- 1 · La cola ------------------------------------------------------------------------------------------
create or replace function public.conta_erp10_cola(p_limite integer default 10)
returns table (entry_id uuid, account_id uuid, company_id uuid, entry_date date, validado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.account_id, e.company_id, e.entry_date, e.validated_at
    from public.journal_entry e
    join public.conta_erp10_salida_empresa z on z.company_id = e.company_id and z.account_id = e.account_id and z.encendida
   where e.status = 'validado'
     and e.entry_date >= z.desde
     and e.source_type not in ('migrated', 'opening', 'closing', 'template', 'reversal')
     and e.external_program is null and e.import_run_id is null
     and not exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = e.id and p.estado = 'salida')
     and not exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.import_run_id is not null)
     and not exists (select 1 from public.supplier_invoice si where si.journal_entry_id = e.id and si.account_id = e.account_id and si.source = 'traida')
     and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id and ci.company_id = e.company_id
                       and (ci.origin = 'traida' or ci.import_run_id is not null))
     -- Conectada, con su código de empresa de ERP10.
     and exists (select 1 from public.account_connector ac join public.connector k on k.id = ac.connector_id
                  where k.code = 'erp10' and ac.account_id = e.account_id and ac.scope = 'company' and ac.company_id = e.company_id
                    and ac.status = 'connected' and coalesce(btrim(ac.external_account_id), '') <> '')
     -- La prueba: la primera salida de la empresa, igualada después en el paso 3.
     and exists (select 1 from public.conta_erp10_igualado g
                  where g.company_id = e.company_id and g.account_id = e.account_id
                    and g.igualado_en > (select min(q.creado_en) from public.conta_erp10_envio q
                                          where q.company_id = e.company_id and q.account_id = e.account_id and q.estado = 'en_erp10'))
     -- Nada dos veces, y lo parado se queda parado.
     and not exists (select 1 from public.conta_erp10_envio v where v.entry_id = e.id and (
            (v.estado = 'en_erp10' and (v.lote_id is not null or v.cambiado_en > now() - interval '2 minutes'))
         or (v.estado = 'enviando' and v.cambiado_en > now() - interval '10 minutes')
         or (v.estado = 'no_pudo' and (v.intentos >= 3 or v.como = 'excel' or v.cambiado_en > now() - interval '5 minutes'))))
   order by e.validated_at nulls last, e.id
   limit greatest(1, least(coalesce(p_limite, 10), 50))
$$;
comment on function public.conta_erp10_cola(integer) is
  'X10f · Lo validado que le toca salir solo a ERP10 ahora, en el orden en que se validó (ver la migración 2010). Solo el servidor.';
revoke all on function public.conta_erp10_cola(integer) from public, anon, authenticated;
grant execute on function public.conta_erp10_cola(integer) to service_role;

-- 2 · Despertar al servidor cuando hay algo en la cola -----------------------------------------------
create or replace function public.conta_erp10_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_secreto text;
begin
  if not exists (select 1 from public.conta_erp10_cola(1)) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-erp10-cola.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-erp10-cola',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.conta_erp10_despertar() is
  'X10f · Cada minuto (cron conta-erp10-despertar, solo donde está el secreto de los vigías): si hay algo en la cola de ERP10, llama a conta-erp10-cola. Si falta el secreto, falla (cron lo apunta como failed), no calla.';
revoke all on function public.conta_erp10_despertar() from public, anon, authenticated;

-- 3 · Lo atascado: validado hace más de una hora y sin salir ------------------------------------------
create or replace function public.conta_erp10_atascados(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_c public.company;
  v_z public.conta_erp10_salida_empresa;
  v_n integer;
  v_parados integer;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or (auth.uid() is not null and not public.belongs_to_account(v_c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  select * into v_z from public.conta_erp10_salida_empresa where company_id = v_c.id;
  if v_z.company_id is null or not v_z.encendida then
    return jsonb_build_object('encendida', false, 'sin_salir', 0, 'parados', 0);
  end if;
  select count(*), count(*) filter (where v.estado = 'no_pudo')
    into v_n, v_parados
    from public.journal_entry e
    left join public.conta_erp10_envio v on v.entry_id = e.id
   where e.company_id = v_c.id and e.account_id = v_c.account_id
     and e.status = 'validado' and e.entry_date >= v_z.desde
     and e.validated_at < now() - interval '1 hour'
     and e.source_type not in ('migrated', 'opening', 'closing', 'template', 'reversal')
     and e.external_program is null and e.import_run_id is null
     and not exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = e.id and p.estado = 'salida')
     and not exists (select 1 from public.vat_book_entry b where b.entry_id = e.id and b.account_id = e.account_id and b.import_run_id is not null)
     and not exists (select 1 from public.supplier_invoice si where si.journal_entry_id = e.id and si.account_id = e.account_id and si.source = 'traida')
     and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id and ci.company_id = e.company_id
                       and (ci.origin = 'traida' or ci.import_run_id is not null))
     and (v.id is null or v.estado <> 'en_erp10');
  return jsonb_build_object('encendida', true, 'sin_salir', v_n, 'parados', v_parados);
end $$;
comment on function public.conta_erp10_atascados(uuid) is
  'X10f · Lo validado hace más de una hora que no ha salido a ERP10 (ni por el Excel ni por la conexión) en una empresa con la salida encendida, y cuántos de ellos se han quedado parados. Para el aviso de la barra de abajo. Solo lee.';
revoke all on function public.conta_erp10_atascados(uuid) from public, anon;
grant execute on function public.conta_erp10_atascados(uuid) to authenticated, service_role;

-- 4 · El cron, solo donde está el secreto de los vigías (producción); en staging no se despierta nada ---
do $$
begin
  -- Anidado: sin el esquema vault (una base local), ni se mira el secreto.
  if exists (select 1 from pg_extension where extname = 'pg_cron') and to_regclass('vault.secrets') is not null then
    if exists (select 1 from vault.secrets where name = 'cron_secret') then
      if exists (select 1 from cron.job where jobname = 'conta-erp10-despertar') then
        perform cron.unschedule('conta-erp10-despertar');
      end if;
      perform cron.schedule('conta-erp10-despertar', '* * * * *', $cron$select public.conta_erp10_despertar()$cron$);
    end if;
  end if;
end $$;
