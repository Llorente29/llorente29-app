-- supabase/migrations/20261108T1620_g01d_avisos.sql
--
-- cambia: public.conta_crm · prueba: supabase/staging/sql/20261108_g01d_avisos_prueba.sql
-- cambia: public.conta_cobro_gocardless · prueba: supabase/staging/sql/20261108_g01d_avisos_prueba.sql
-- cambia: public.conta_gestoria_lectura · prueba: supabase/staging/sql/20261108_g01d_avisos_prueba.sql
--
-- G01d · Avisos al instante de Bitrix24 y GoCardless (Julio, 08/11). Cuando
-- cambia algo en el CRM o en GoCardless, Sumied lo sabe en segundos. El aviso
-- solo dice qué ha cambiado: Sumied lo lee con su acceso de solo lectura de
-- siempre y aplica las mismas reglas que la lectura entera. No se escribe nada
-- en Bitrix24 ni en GoCardless. La lectura de cada noche se queda.
--
--   1. En cada conexión (conta_crm y conta_cobro_gocardless): el código o el
--      secreto del aviso, en Vault (como sus claves de hoy), y el encendido,
--      APAGADO de serie. Con la conexión apagada, los avisos se rechazan.
--   2. conta_aviso: la cola y el registro de los avisos. Cuándo llegó, de qué
--      conexión, qué cambió (solo ids y palabras del CRM o de GoCardless: sin
--      datos personales) y si se aplicó o por qué no. Una clave por aviso:
--      cada uno se trata una vez. Lo leen las personas de la cuenta (RLS);
--      solo escribe el servidor.
--   3. conta_aviso_configurar: una persona administradora o encargada pega el
--      código o el secreto (va a Vault y no se vuelve a enseñar) y enciende o
--      apaga «Al instante». conta_aviso_secreto: solo el servidor lo lee.
--   4. El CRM ficha a ficha, sin cambiar la lectura entera:
--      conta_crm_guardar_personas_de_contacto (las filas de persona de UN
--      contacto; las de los demás no se tocan) y conta_crm_renovar_pendientes
--      («Pendiente de revisar» de unas fichas, no de todas).
--   5. conta_gestoria_lectura.por admite «aviso» (el CHECK solo amplía).
--   6. El repaso: cada 2 minutos, si hay avisos que esperan o que fallaron y
--      les toca, se despierta a la función de cada origen (Bitrix24 no
--      reintenta: lo que falla se repite desde aquí).
--
-- No lee ni escribe nada en Bitrix24 ni en GoCardless. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261108T1620_g01d_avisos.down.sql

-- 1 · El código del aviso y el encendido, en cada conexión.
alter table public.conta_crm add column if not exists aviso_ref uuid;
alter table public.conta_crm add column if not exists aviso_encendido boolean default false;
alter table public.conta_crm add column if not exists aviso_encendido_at timestamptz;
alter table public.conta_crm add column if not exists aviso_encendido_por_name text;
alter table public.conta_crm add column if not exists aviso_ultimo_at timestamptz;
comment on column public.conta_crm.aviso_ref is 'G01d · El código de seguridad de los avisos del CRM (en Bitrix24, el application_token del webhook saliente), en Vault («conta_crm_aviso:<crm>:<cuenta>»).';
comment on column public.conta_crm.aviso_encendido is 'G01d · «Al instante» encendido para esta conexión. Apagado de serie: con él apagado, los avisos se rechazan.';
comment on column public.conta_crm.aviso_ultimo_at is 'G01d · Cuándo llegó el último aviso auténtico.';

alter table public.conta_cobro_gocardless add column if not exists aviso_ref uuid;
alter table public.conta_cobro_gocardless add column if not exists aviso_encendido boolean default false;
alter table public.conta_cobro_gocardless add column if not exists aviso_encendido_at timestamptz;
alter table public.conta_cobro_gocardless add column if not exists aviso_encendido_por_name text;
alter table public.conta_cobro_gocardless add column if not exists aviso_ultimo_at timestamptz;
comment on column public.conta_cobro_gocardless.aviso_ref is 'G01d · El secreto del endpoint de avisos de GoCardless de esta empresa, en Vault («conta_gocardless_aviso:<empresa>»).';
comment on column public.conta_cobro_gocardless.aviso_encendido is 'G01d · «Al instante» encendido para esta cuenta de GoCardless. Apagado de serie: con él apagado, los avisos se rechazan.';
comment on column public.conta_cobro_gocardless.aviso_ultimo_at is 'G01d · Cuándo llegó el último aviso auténtico.';

-- 2 · La cola y el registro.
create table if not exists public.conta_aviso (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid references public.company(id) on delete cascade,
  origen              text not null check (origen in ('crm', 'gocardless')),
  crm                 text check (crm is null or crm ~ '^[a-z0-9_]+$'),
  clave               text,
  estado              text not null check (estado in ('pendiente', 'trabajando', 'hecho', 'fallo', 'rechazado', 'ignorado', 'prueba')),
  tipo_ficha          text check (tipo_ficha is null or tipo_ficha in ('empresa', 'contacto')),
  id_externo          text,
  accion              text,
  recurso             text,
  enlaces             jsonb,
  causa               text,
  recibido_at         timestamptz not null default now(),
  intentos            integer not null default 0,
  proximo_intento_at  timestamptz,
  hecho_at            timestamptz,
  porque              text,
  frase               text
);
create unique index if not exists conta_aviso_clave_idx on public.conta_aviso (account_id, clave) where clave is not null;
create index if not exists conta_aviso_cola_idx on public.conta_aviso (origen, estado, proximo_intento_at) where estado in ('pendiente', 'fallo', 'trabajando');
create index if not exists conta_aviso_cuenta_idx on public.conta_aviso (account_id, recibido_at desc);
comment on table public.conta_aviso is 'G01d · La cola y el registro de los avisos al instante del CRM y de GoCardless: cuándo llegó, de qué conexión, qué cambió (solo ids y palabras del CRM o de GoCardless, sin datos personales) y si se aplicó o por qué no. Cada aviso, una vez (clave). Solo escribe el servidor.';
alter table public.conta_aviso enable row level security;
drop policy if exists conta_aviso_leer on public.conta_aviso;
create policy conta_aviso_leer on public.conta_aviso for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_aviso from anon, authenticated;
grant select on table public.conta_aviso to authenticated;
grant all on table public.conta_aviso to service_role;

-- 3 · Pegar el código o el secreto, y encender o apagar.
create or replace function public.conta_aviso_configurar(p_account uuid, p_origen text, p_crm text, p_company uuid, p_codigo text, p_encender boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_nombre text; v_quien text := public.conta_nombre_actor(); v_frase text; v_de text; v_codigo text := nullif(trim(coalesce(p_codigo, '')), '');
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia «Al instante».' using errcode = '42501';
  end if;
  if p_origen = 'crm' then
    if not exists (select 1 from public.conta_crm where account_id = p_account and crm = p_crm) then raise exception 'Esta cuenta no tiene conectado su CRM.' using errcode = 'P0002'; end if;
    select aviso_ref into v_ref from public.conta_crm where account_id = p_account and crm = p_crm for update;
    v_nombre := 'conta_crm_aviso:' || p_crm || ':' || p_account::text;
    v_de := public._conta_crm_nombre(p_crm);
  elsif p_origen = 'gocardless' then
    if not exists (select 1 from public.conta_cobro_gocardless where company_id = p_company and account_id = p_account) then
      raise exception 'Esa empresa no tiene conectado GoCardless.' using errcode = 'P0002';
    end if;
    select aviso_ref into v_ref from public.conta_cobro_gocardless where company_id = p_company for update;
    v_nombre := 'conta_gocardless_aviso:' || p_company::text;
    v_de := 'GoCardless';
  else
    raise exception 'Los avisos son del CRM o de GoCardless.' using errcode = '22023';
  end if;

  if v_codigo is not null then
    if length(v_codigo) < 16 or v_codigo ~ '\s' then
      raise exception 'Ese código no parece el de %: cópialo entero, sin espacios.', v_de using errcode = '22023';
    end if;
    if v_ref is null or not exists (select 1 from vault.secrets where id = v_ref) then select id into v_ref from vault.secrets where name = v_nombre; end if;
    if v_ref is not null then perform vault.update_secret(v_ref, v_codigo, v_nombre, 'Código de los avisos al instante de una conexión de Sumied');
    else v_ref := vault.create_secret(v_codigo, v_nombre, 'Código de los avisos al instante de una conexión de Sumied'); end if;
  end if;
  if p_encender is true and v_ref is null then
    raise exception 'Para encender «Al instante» falta pegar el código de %.', v_de using errcode = '22023';
  end if;

  if p_origen = 'crm' then
    update public.conta_crm set aviso_ref = v_ref,
           aviso_encendido = coalesce(p_encender, aviso_encendido),
           aviso_encendido_at = case when p_encender is not null then now() else aviso_encendido_at end,
           aviso_encendido_por_name = case when p_encender is not null then v_quien else aviso_encendido_por_name end,
           updated_at = now()
     where account_id = p_account and crm = p_crm;
  else
    update public.conta_cobro_gocardless set aviso_ref = v_ref,
           aviso_encendido = coalesce(p_encender, aviso_encendido),
           aviso_encendido_at = case when p_encender is not null then now() else aviso_encendido_at end,
           aviso_encendido_por_name = case when p_encender is not null then v_quien else aviso_encendido_por_name end,
           updated_at = now()
     where company_id = p_company;
  end if;
  v_frase := concat_ws(' ',
    case when v_codigo is not null then format('Guardado el código de %s: no se vuelve a enseñar.', v_de) end,
    case when p_encender is true then format('«Al instante» encendido para %s: los avisos se aplican en segundos.', v_de)
         when p_encender is false then format('«Al instante» apagado para %s: los avisos que lleguen se rechazan. La lectura de cada noche sigue.', v_de) end);
  return jsonb_build_object('frase', coalesce(nullif(v_frase, ''), 'No había nada que cambiar.'));
end $$;
comment on function public.conta_aviso_configurar(uuid, text, text, uuid, text, boolean) is
  'G01d · Pega el código de los avisos de una conexión (a Vault; no se vuelve a enseñar) y enciende o apaga «Al instante». Solo administradores o encargados de la cuenta.';
revoke all on function public.conta_aviso_configurar(uuid, text, text, uuid, text, boolean) from public, anon;
grant execute on function public.conta_aviso_configurar(uuid, text, text, uuid, text, boolean) to authenticated, service_role;

create or replace function public.conta_aviso_secreto(p_origen text, p_account uuid, p_crm text, p_company uuid)
returns table (encendido boolean, codigo text, entorno text) language sql security definer set search_path = public as $$
  select coalesce(c.aviso_encendido, false), s.decrypted_secret, c.entorno
    from public.conta_crm c left join vault.decrypted_secrets s on s.id = c.aviso_ref
   where p_origen = 'crm' and c.account_id = p_account and c.crm = p_crm
  union all
  select coalesce(g.aviso_encendido, false), s.decrypted_secret, g.entorno
    from public.conta_cobro_gocardless g left join vault.decrypted_secrets s on s.id = g.aviso_ref
   where p_origen = 'gocardless' and g.company_id = p_company and g.account_id = p_account
$$;
comment on function public.conta_aviso_secreto(text, uuid, text, uuid) is 'G01d · El encendido y el código de los avisos de una conexión, para comprobar que un aviso es auténtico. Solo el servidor.';
revoke all on function public.conta_aviso_secreto(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.conta_aviso_secreto(text, uuid, text, uuid) to service_role;

-- 4a · Las filas de persona de contacto de UN contacto (las de los demás no se tocan).
create or replace function public.conta_crm_guardar_personas_de_contacto(p_account uuid, p_crm text, p_contacto text, p_empresas jsonb, p_ficha jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_empresa text; v_party uuid; v_guardadas int := 0; v_sin_cliente int := 0; v_quitadas int := 0; v_vale text[] := '{}';
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  if coalesce(p_crm, '') !~ '^[a-z0-9_]+$' then raise exception 'Falta el CRM.' using errcode = '22023'; end if;
  if coalesce(p_contacto, '') = '' then raise exception 'Falta el contacto.' using errcode = '22023'; end if;
  for v_empresa in select jsonb_array_elements_text(coalesce(p_empresas, '[]'::jsonb)) loop
    v_party := null;
    select party_id into v_party from public.conta_gestoria_ficha
     where account_id = p_account and crm = p_crm and tipo_ficha = 'empresa' and id_externo = v_empresa and de_empresa = '';
    if v_party is null then v_sin_cliente := v_sin_cliente + 1; continue; end if;
    insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha, huella, leido_at)
    values (p_account, p_crm, 'contacto', p_contacto, v_empresa, v_party, null, p_ficha, md5(p_ficha::text), now())
    on conflict (account_id, crm, tipo_ficha, id_externo, de_empresa) do update set party_id = excluded.party_id, ficha = excluded.ficha, huella = excluded.huella, leido_at = now();
    v_vale := v_vale || v_empresa;
    v_guardadas := v_guardadas + 1;
  end loop;
  -- Las empresas de las que ya no es persona de contacto (solo de este contacto).
  delete from public.conta_gestoria_ficha
   where account_id = p_account and crm = p_crm and tipo_ficha = 'contacto' and id_externo = p_contacto and de_empresa <> '' and de_empresa <> all(v_vale);
  get diagnostics v_quitadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'sinCliente', v_sin_cliente, 'quitadas', v_quitadas);
end $$;
comment on function public.conta_crm_guardar_personas_de_contacto(uuid, text, text, jsonb, jsonb) is
  'G01d · Las filas de persona de contacto de UN contacto del CRM (una por empresa): las de las empresas que ya no son suyas se quitan; las de los demás contactos no se tocan. Para los avisos al instante. Solo el servidor.';
revoke all on function public.conta_crm_guardar_personas_de_contacto(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.conta_crm_guardar_personas_de_contacto(uuid, text, text, jsonb, jsonb) to service_role;

-- 4b · «Pendiente de revisar» de unas fichas (no de todas): las suyas dejan de ser las vigentes y entran las nuevas.
create or replace function public.conta_crm_renovar_pendientes(p_account uuid, p_crm text, p_lectura uuid, p_fichas jsonb, p_difs jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_claves text[]; d jsonb; v_party uuid; v_n int := 0;
        v_tipos constant text[] := array['fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos', 'ya_no_es_cliente_en_crm'];
begin
  if not exists (select 1 from public.conta_gestoria_lectura where id = p_lectura and account_id = p_account) then
    raise exception 'La lectura no es de esta cuenta.' using errcode = 'P0002';
  end if;
  v_claves := array(select (x->>'tipoFicha') || ':' || (x->>'idExterno') from jsonb_array_elements(coalesce(p_fichas, '[]'::jsonb)) x);
  update public.conta_gestoria_diferencia set vigente = false
   where account_id = p_account and vigente and crm = p_crm and tipo = any(v_tipos) and (tipo_ficha || ':' || id_externo) = any(v_claves);
  for d in select * from jsonb_array_elements(coalesce(p_difs, '[]'::jsonb)) loop
    -- El cliente de cada una, como en la lectura entera (leer.ts · partyDeDif).
    v_party := case
      when d->>'tipo' = 'ficha_no_guardada' then null
      when d->>'tipo' = 'ya_no_es_cliente_en_crm' then (select g.party_id from public.conta_gestoria_cliente g
             where g.account_id = p_account and g.crm = p_crm and g.tipo_ficha = d->>'tipo_ficha' and g.id_externo = d->>'id_externo' limit 1)
      when d->>'tipo' = 'contacto_empresa_con_datos' then (select f.party_id from public.conta_gestoria_ficha f
             where f.account_id = p_account and f.crm = p_crm and f.tipo_ficha = 'empresa' and f.de_empresa = '' and f.id_externo = d->'datos'->'empresas'->>0)
      else (select f.party_id from public.conta_gestoria_ficha f
             where f.account_id = p_account and f.crm = p_crm and f.de_empresa = '' and f.tipo_ficha = d->>'tipo_ficha' and f.id_externo = d->>'id_externo') end;
    insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, crm, tipo_ficha, id_externo, party_id, datos)
    values (p_account, p_lectura, d->>'tipo', d->>'porque_codigo', d->>'porque', p_crm, nullif(d->>'tipo_ficha', ''), nullif(d->>'id_externo', ''), v_party, coalesce(d->'datos', '{}'::jsonb));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
comment on function public.conta_crm_renovar_pendientes(uuid, text, uuid, jsonb, jsonb) is
  'G01d · «Pendiente de revisar» de unas fichas del CRM (las que toca un aviso): las suyas dejan de ser vigentes y entran las nuevas, con el cliente de cada una como en la lectura entera. Solo el servidor.';
revoke all on function public.conta_crm_renovar_pendientes(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.conta_crm_renovar_pendientes(uuid, text, uuid, jsonb, jsonb) to service_role;

-- 5 · Las lecturas que lanza un aviso (el CHECK solo amplía).
alter table public.conta_gestoria_lectura drop constraint if exists conta_gestoria_lectura_por_check;
alter table public.conta_gestoria_lectura add constraint conta_gestoria_lectura_por_check check (por = any (array['persona', 'cada_noche', 'conexion', 'aviso']));

-- 6 · El repaso de la cola: cada 2 minutos, solo si hay algo que toca.
create or replace function public.conta_avisos_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text; v_origen text;
begin
  for v_origen in
    select distinct origen from public.conta_aviso
     where (estado = 'pendiente' and recibido_at < now() - interval '30 seconds')
        or (estado = 'fallo' and proximo_intento_at <= now())
        or (estado = 'trabajando' and coalesce(proximo_intento_at, recibido_at) < now() - interval '10 minutes')
  loop
    if v_secreto is null then
      select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
      if v_secreto is null then raise exception 'Falta cron_secret en el Vault: no se puede repasar la cola de avisos.' using errcode = '55000'; end if;
    end if;
    perform net.http_post(url := public._project_url() || '/functions/v1/' || case v_origen when 'crm' then 'conta-crm-aviso' else 'conta-gocardless-aviso' end,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
      body := jsonb_build_object('accion', 'repasar'), timeout_milliseconds := 150000);
  end loop;
end $$;
comment on function public.conta_avisos_despertar() is 'G01d · Cada 2 minutos: si hay avisos que esperan, que fallaron y les toca repetir o que se quedaron a medias, despierta a la función de su origen.';
revoke all on function public.conta_avisos_despertar() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'conta-avisos-repaso';
    perform cron.schedule('conta-avisos-repaso', '*/2 * * * *', $cron$select public.conta_avisos_despertar()$cron$);
  end if;
end $$;
