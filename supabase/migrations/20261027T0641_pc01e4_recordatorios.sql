-- 20261027T0641_pc01e4_recordatorios.sql
--
-- PC01 · Entrega 4 · Punto 1 · LOS RECORDATORIOS DE COBRO, que se mandan solos.
--
--   1. conta_cobro_ajuste: por empresa, si se mandan y qué días (por defecto 3
--      días antes de vencer, el día que vence y a los 7 y 15 días). Aquí irá
--      también el proveedor del enlace de pago (punto 2), cuando llegue.
--   2. conta_cobro_cliente: los clientes a los que NO se les mandan.
--   3. conta_recordatorio: cada recordatorio, mandado o no, y por qué. Uno por
--      factura y paso: si un paso no sale (el freno de los correos, sin correo,
--      el proveedor), no se repite; lo dice la factura en su historial.
--   4. Las funciones:
--        · conta_recordatorios_por_mandar (solo el servidor): lo que toca hoy;
--        · conta_recordatorio_apuntar (solo el servidor): lo apunta, y en el
--          historial de la factura (regla 8);
--        · conta_recordatorios_resumen: la columna «Recordatorios» de Cobros
--          («3 enviados · próximo 01/11», «no hacen falta»…), los ajustes y
--          los clientes apagados;
--        · conta_cobro_ajustes_guardar y conta_recordatorios_cliente: Ajustes
--          › Cobros y el «apagar por cliente»;
--        · conta_recordatorio_prueba_datos: los datos de UNA factura para
--          mandar una prueba a un correo (el primer envío real, a Julio).
--   5. conta_recordatorios_despertar y su cron (cada hora; actúa a las 9 de
--      Madrid, sea verano o invierno): llama a conta-recordatorios solo si hay
--      algo que mandar. Solo en producción (necesita el cron_secret del Vault,
--      que staging no tiene).
--
-- Se paran solos al cobrar: lo que toca solo mira facturas con algo pendiente.
-- Los correos no salen hasta que Julio abra «recordatorio_cobro» en
-- CORREO_MARCA_ABIERTOS (el freno, como «factura_venta»).
--
-- Foodint (medido el 27/10 en producción, solo lectura): 0 recordatorios. Sus
-- 89 por cobrar son de plataforma y ninguna de sus facturas lleva correo.
--
-- SOLO AÑADE: tablas, funciones y un cron nuevos. No toca filas al aplicarse,
-- ni nada del camino del pedido, ni coste ni stock.

-- 1. Los ajustes de cobro de cada empresa ---------------------------------------------
create table if not exists public.conta_cobro_ajuste (
  company_id        uuid primary key references public.company(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  recordatorios     boolean not null default true,
  recordatorio_dias integer[] not null default '{-3,0,7,15}',
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  constraint conta_cobro_ajuste_dias check (
    cardinality(recordatorio_dias) between 1 and 6
    and -30 <= all (recordatorio_dias) and 90 >= all (recordatorio_dias))
);
comment on table public.conta_cobro_ajuste is
  'PC01 · E4 · Ajustes › Cobros de cada empresa: si se mandan los recordatorios y qué días respecto al vencimiento (negativo, antes). Sin fila: se mandan, a -3, 0, 7 y 15.';
alter table public.conta_cobro_ajuste enable row level security;
revoke all on table public.conta_cobro_ajuste from public, anon, authenticated;
grant select on table public.conta_cobro_ajuste to authenticated;
drop policy if exists conta_cobro_ajuste_leer on public.conta_cobro_ajuste;
create policy conta_cobro_ajuste_leer on public.conta_cobro_ajuste for select to authenticated using (public.belongs_to_account(account_id));

-- 2. Los clientes sin recordatorios ---------------------------------------------------
create table if not exists public.conta_cobro_cliente (
  company_id         uuid not null references public.company(id) on delete cascade,
  party_id           uuid not null references public.party(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  sin_recordatorios  boolean not null default false,
  updated_at         timestamptz not null default now(),
  updated_by_name    text,
  primary key (company_id, party_id)
);
comment on table public.conta_cobro_cliente is
  'PC01 · E4 · Lo que se decide de un cliente al cobrarle: si se le mandan recordatorios.';
alter table public.conta_cobro_cliente enable row level security;
revoke all on table public.conta_cobro_cliente from public, anon, authenticated;
grant select on table public.conta_cobro_cliente to authenticated;
drop policy if exists conta_cobro_cliente_leer on public.conta_cobro_cliente;
create policy conta_cobro_cliente_leer on public.conta_cobro_cliente for select to authenticated using (public.belongs_to_account(account_id));

-- 3. Cada recordatorio ---------------------------------------------------------------
create table if not exists public.conta_recordatorio (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  invoice_id  uuid not null references public.customer_invoice(id) on delete cascade,
  party_id    uuid references public.party(id) on delete set null,
  dia         integer not null,
  toca        date not null,
  enviado     boolean not null,
  motivo      text check (motivo in ('cerrado', 'sin_correo', 'proveedor', 'configuracion')),
  para        text,
  texto       text not null,
  correo_id   text,
  at          timestamptz not null default now(),
  constraint conta_recordatorio_motivo check (enviado = (motivo is null)),
  constraint conta_recordatorio_uno unique (invoice_id, dia)
);
comment on table public.conta_recordatorio is
  'PC01 · E4 · Cada recordatorio de cobro: el paso (días respecto al vencimiento), el día que tocaba, si salió y, si no, por qué. Uno por factura y paso.';
create index if not exists conta_recordatorio_empresa_idx on public.conta_recordatorio (company_id, at desc);
alter table public.conta_recordatorio enable row level security;
revoke all on table public.conta_recordatorio from public, anon, authenticated;
grant select on table public.conta_recordatorio to authenticated;
drop policy if exists conta_recordatorio_leer on public.conta_recordatorio;
create policy conta_recordatorio_leer on public.conta_recordatorio for select to authenticated using (public.belongs_to_account(account_id));

-- 4. Piezas ---------------------------------------------------------------------------
-- Los días de una empresa (sin fila: los de por defecto).
create or replace function public._pc01e4_dias(p_company uuid)
returns integer[] language sql stable security definer set search_path = public as $$
  select coalesce((select recordatorio_dias from public.conta_cobro_ajuste where company_id = p_company), '{-3,0,7,15}'::integer[])
$$;
revoke all on function public._pc01e4_dias(uuid) from public, anon, authenticated;

-- El correo de un cliente para una factura: el de la propia factura, o el
-- último con el que se le mandó una.
create or replace function public._pc01e4_correo(p_invoice uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(lower(trim(ci.email_to)), '') from public.customer_invoice ci where ci.id = p_invoice),
    (select nullif(lower(trim(ci2.email_to)), '')
       from public.customer_invoice ci join public.customer_invoice ci2 on ci2.party_id = ci.party_id and ci2.company_id = ci.company_id
      where ci.id = p_invoice and ci.party_id is not null and nullif(trim(ci2.email_to), '') is not null
      order by ci2.issue_date desc, ci2.created_at desc limit 1))
$$;
revoke all on function public._pc01e4_correo(uuid) from public, anon, authenticated;

-- Por qué una factura NO lleva recordatorios (null: sí los lleva).
--   plataforma · domiciliada (los cobra la remesa) · en_remesa · apagados
--   (la empresa) · cliente (apagados para este cliente) · sin_correo · cobrada
create or replace function public._pc01e4_sin_recordatorio(p_invoice uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when c.invoice_id is null or ci.status <> 'emitida' or c.total <= 0 or c.pendiente < 0.005 then 'cobrada'
    when c.de_plataforma then 'plataforma'
    when public._pc01e3_forma(ci.id) = 'direct_debit' then 'domiciliada'
    when public._pc01e3_en_remesa(ci.id) > 0 then 'en_remesa'
    when coalesce((select a.recordatorios from public.conta_cobro_ajuste a where a.company_id = ci.company_id), true) = false then 'apagados'
    when ci.party_id is not null and coalesce((select k.sin_recordatorios from public.conta_cobro_cliente k
                                               where k.company_id = ci.company_id and k.party_id = ci.party_id), false) then 'cliente'
    when c.vence is null then 'sin_vencimiento'
    when public._pc01e4_correo(ci.id) is null then 'sin_correo'
  end
  from public.customer_invoice ci
  left join public.conta_factura_cobro c on c.invoice_id = ci.id
  where ci.id = p_invoice
$$;
revoke all on function public._pc01e4_sin_recordatorio(uuid) from public, anon, authenticated;

-- Los datos con los que se escribe el correo de una factura.
create or replace function public._pc01e4_datos(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'factura', ci.id, 'cuenta', ci.account_id, 'empresa_id', ci.company_id, 'cliente_id', ci.party_id,
    'empresa', coalesce(nullif(trim(co.trade_name), ''), co.legal_name), 'empresa_correo', nullif(lower(trim(co.email)), ''),
    'numero', ci.number_text, 'fecha', ci.issue_date, 'vence', c.vence, 'total', c.total, 'pendiente', c.pendiente,
    'cliente', coalesce(nullif(trim(ci.customer->>'nombre'), ''), p.name, 'cliente'),
    'para', public._pc01e4_correo(ci.id), 'pdf', ci.pdf_path, 'hoy', public.conta_hoy())
  from public.customer_invoice ci
  join public.company co on co.id = ci.company_id
  join public.conta_factura_cobro c on c.invoice_id = ci.id
  left join public.party p on p.id = ci.party_id
  where ci.id = p_invoice
$$;
revoke all on function public._pc01e4_datos(uuid) from public, anon, authenticated;

-- Lo que toca mandar hoy: por cada factura, el paso más reciente que ha tocado
-- en los dos últimos días y aún no se ha intentado (si el cron falla un día, se
-- manda al siguiente; nunca dos de golpe).
create or replace function public.conta_recordatorios_por_mandar(p_hoy date default null, p_limite integer default 200)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with hoy as (select coalesce(p_hoy, public.conta_hoy()) as d),
  pasos as (
    select c.invoice_id, d.dia, c.vence + d.dia as toca
      from public.conta_factura_cobro c
      join public.customer_invoice ci on ci.id = c.invoice_id
      cross join hoy
      cross join lateral unnest(public._pc01e4_dias(c.company_id)) as d(dia)
     where ci.status = 'emitida' and not c.de_plataforma and c.total > 0 and c.pendiente >= 0.005 and c.vence is not null
       and c.vence + d.dia between hoy.d - 2 and hoy.d
       and not exists (select 1 from public.conta_recordatorio r where r.invoice_id = c.invoice_id and r.dia = d.dia)
  ),
  uno as (
    select distinct on (invoice_id) invoice_id, dia, toca from pasos order by invoice_id, dia desc
  )
  select public._pc01e4_datos(u.invoice_id) || jsonb_build_object('dia', u.dia, 'toca', u.toca, 'sin', public._pc01e4_sin_recordatorio(u.invoice_id))
    from uno u
   where public._pc01e4_sin_recordatorio(u.invoice_id) is null or public._pc01e4_sin_recordatorio(u.invoice_id) = 'sin_correo'
   order by u.toca, u.invoice_id
   limit greatest(1, least(coalesce(p_limite, 200), 1000))
$$;
revoke all on function public.conta_recordatorios_por_mandar(date, integer) from public, anon, authenticated;
grant execute on function public.conta_recordatorios_por_mandar(date, integer) to service_role;
comment on function public.conta_recordatorios_por_mandar(date, integer) is
  'PC01 · E4 · Los recordatorios que toca mandar hoy (solo el servidor, conta-recordatorios). Uno por factura; los «sin_correo» van también, para apuntar que no salieron.';

-- Apuntar un recordatorio (solo el servidor) y dejarlo en el historial de la factura.
create or replace function public.conta_recordatorio_apuntar(p_invoice uuid, p_dia integer, p_toca date, p_enviado boolean,
                                                            p_para text, p_motivo text, p_texto text, p_correo_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.customer_invoice; v_id uuid;
begin
  select * into v from public.customer_invoice where id = p_invoice;
  if v.id is null then return false; end if;
  insert into public.conta_recordatorio (account_id, company_id, invoice_id, party_id, dia, toca, enviado, motivo, para, texto, correo_id)
  values (v.account_id, v.company_id, v.id, v.party_id, p_dia, p_toca, p_enviado, case when p_enviado then null else p_motivo end,
          nullif(lower(trim(coalesce(p_para, ''))), ''), p_texto, p_correo_id)
  on conflict (invoice_id, dia) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  perform public._conta_venta_evento(v.id, case when p_enviado then 'recordatorio' else 'recordatorio_no_enviado' end, p_texto,
    jsonb_build_object('dia', p_dia, 'para', p_para, 'motivo', p_motivo), 'Sumied');
  return true;
end $$;
revoke all on function public.conta_recordatorio_apuntar(uuid, integer, date, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_recordatorio_apuntar(uuid, integer, date, boolean, text, text, text, text) to service_role;

-- Los datos de UNA factura para mandar una prueba (lo llama conta-recordatorios
-- con la sesión de un administrador o encargado).
create or replace function public.conta_recordatorio_prueba_datos(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.customer_invoice where id = p_invoice;
  if v_cuenta is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta manda recordatorios.' using errcode = '42501';
  end if;
  return public._pc01e4_datos(p_invoice) || jsonb_build_object('sin', public._pc01e4_sin_recordatorio(p_invoice));
end $$;
revoke all on function public.conta_recordatorio_prueba_datos(uuid) from public, anon;
grant execute on function public.conta_recordatorio_prueba_datos(uuid) to authenticated;

-- 5. Lo que ve la pantalla ------------------------------------------------------------
-- Ajustes, clientes apagados, los últimos recordatorios y, por factura con
-- algo pendiente, cuántos han salido, el próximo y por qué no lleva.
create or replace function public.conta_recordatorios_resumen(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_hoy date := public.conta_hoy(); v_dias integer[] := public._pc01e4_dias(p_company);
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'activos', coalesce((select recordatorios from public.conta_cobro_ajuste where company_id = p_company), true),
    'dias', to_jsonb(v_dias),
    'cambiado', (select jsonb_build_object('at', updated_at, 'por', updated_by_name) from public.conta_cobro_ajuste where company_id = p_company),
    'clientes_apagados', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.party_id, 'nombre', p.name, 'por', k.updated_by_name, 'at', k.updated_at) order by p.name)
        from public.conta_cobro_cliente k join public.party p on p.id = k.party_id
       where k.company_id = p_company and k.sin_recordatorios), '[]'::jsonb),
    'facturas', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
                 'id', c.invoice_id,
                 'enviados', (select count(*) from public.conta_recordatorio r where r.invoice_id = c.invoice_id and r.enviado),
                 'ultimo', (select max(r.toca) from public.conta_recordatorio r where r.invoice_id = c.invoice_id and r.enviado),
                 'no_salio', (select jsonb_build_object('toca', r.toca, 'motivo', r.motivo) from public.conta_recordatorio r
                               where r.invoice_id = c.invoice_id and not r.enviado order by r.toca desc limit 1),
                 'proximo', case when s.sin is null then (
                    select min(c.vence + d.dia) from unnest(v_dias) d(dia)
                     where c.vence + d.dia >= v_hoy
                       and not exists (select 1 from public.conta_recordatorio r where r.invoice_id = c.invoice_id and r.dia = d.dia)) end,
                 'sin', s.sin) as x
          from public.conta_factura_cobro c
          join public.customer_invoice ci on ci.id = c.invoice_id
          cross join lateral (select public._pc01e4_sin_recordatorio(c.invoice_id) as sin) s
         where c.company_id = p_company and ci.status = 'emitida' and c.total > 0 and c.pendiente >= 0.005) f), '[]'::jsonb),
    'ultimos', coalesce((
      select jsonb_agg(jsonb_build_object('at', r.at, 'factura', ci.number_text, 'factura_id', r.invoice_id, 'cliente', coalesce(p.name, ci.customer->>'nombre'),
                                          'para', r.para, 'enviado', r.enviado, 'motivo', r.motivo, 'dia', r.dia) order by r.at desc)
        from (select * from public.conta_recordatorio where company_id = p_company order by at desc limit 20) r
        join public.customer_invoice ci on ci.id = r.invoice_id
        left join public.party p on p.id = r.party_id), '[]'::jsonb),
    'hoy', v_hoy);
end $$;
revoke all on function public.conta_recordatorios_resumen(uuid) from public, anon;
grant execute on function public.conta_recordatorios_resumen(uuid) to authenticated;
comment on function public.conta_recordatorios_resumen(uuid) is
  'PC01 · E4 · Ventas › Cobros (columna «Recordatorios» y su diálogo) y Ajustes › Cobros: los ajustes, los clientes apagados, los últimos recordatorios y, por factura pendiente, cuántos han salido, el próximo y por qué no lleva.';

-- Ajustes › Cobros: si se mandan y qué días.
create or replace function public.conta_cobro_ajustes_guardar(p_company uuid, p_recordatorios boolean, p_dias integer[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._pc01e3_empresa(p_company);
        v_dias integer[] := (select array_agg(distinct d order by d) from unnest(coalesce(p_dias, '{}'::integer[])) d where d is not null);
        v_txt text;
begin
  if p_recordatorios is null then raise exception 'Di si se mandan o no.' using errcode = '22023'; end if;
  if coalesce(cardinality(v_dias), 0) = 0 then raise exception 'Pon al menos un día.' using errcode = '22023'; end if;
  if cardinality(v_dias) > 6 then raise exception 'Como mucho, seis días.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_dias) d where d < -30 or d > 90) then
    raise exception 'Cada día, entre 30 antes de vencer y 90 después.' using errcode = '22023';
  end if;
  insert into public.conta_cobro_ajuste (company_id, account_id, recordatorios, recordatorio_dias, updated_at, updated_by_name)
  values (p_company, v_cuenta, p_recordatorios, v_dias, now(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  on conflict (company_id) do update set recordatorios = excluded.recordatorios, recordatorio_dias = excluded.recordatorio_dias,
                                         updated_at = now(), updated_by_name = excluded.updated_by_name;
  v_txt := (select string_agg(case when d < 0 then format('%s días antes', -d) when d = 0 then 'el día que vence' else format('a los %s días', d) end, ', ' order by d)
              from unnest(v_dias) d);
  return jsonb_build_object('frase', case when p_recordatorios
    then format('Guardado: los recordatorios se mandan %s.', v_txt)
    else 'Guardado: los recordatorios están apagados. No se manda ninguno.' end);
end $$;
revoke all on function public.conta_cobro_ajustes_guardar(uuid, boolean, integer[]) from public, anon;
grant execute on function public.conta_cobro_ajustes_guardar(uuid, boolean, integer[]) to authenticated;

-- Apagar o volver a encender los recordatorios de un cliente.
create or replace function public.conta_recordatorios_cliente(p_company uuid, p_party uuid, p_apagar boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._pc01e3_empresa(p_company); v_nombre text;
begin
  select name into v_nombre from public.party where id = p_party and account_id = v_cuenta;
  if v_nombre is null then raise exception 'Ese cliente no es de la cuenta.' using errcode = 'P0002'; end if;
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, sin_recordatorios, updated_at, updated_by_name)
  values (p_company, p_party, v_cuenta, coalesce(p_apagar, false), now(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  on conflict (company_id, party_id) do update set sin_recordatorios = excluded.sin_recordatorios, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('frase', case when coalesce(p_apagar, false)
    then format('A %s ya no se le mandan recordatorios.', v_nombre)
    else format('A %s se le vuelven a mandar recordatorios.', v_nombre) end);
end $$;
revoke all on function public.conta_recordatorios_cliente(uuid, uuid, boolean) from public, anon;
grant execute on function public.conta_recordatorios_cliente(uuid, uuid, boolean) to authenticated;

-- 6. El despertador -------------------------------------------------------------------
-- Cada hora; solo hace algo a las 9 de Madrid (guarda del cambio de hora) y si
-- hay algo que mandar.
create or replace function public.conta_recordatorios_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text;
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 9 then return; end if;
  if not exists (select 1 from public.conta_recordatorios_por_mandar(null, 1)) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-recordatorios.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-recordatorios',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.conta_recordatorios_despertar() is
  'PC01 · E4 · Cada hora (cron conta-recordatorios-despertar, solo en producción): a las 9 de Madrid, si hay recordatorios que mandar, llama a conta-recordatorios. Si falta el secreto, falla (cron lo apunta como failed), no calla.';
revoke all on function public.conta_recordatorios_despertar() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from vault.secrets where name = 'cron_secret') then
    if exists (select 1 from cron.job where jobname = 'conta-recordatorios-despertar') then
      perform cron.unschedule('conta-recordatorios-despertar');
    end if;
    perform cron.schedule('conta-recordatorios-despertar', '11 * * * *', $cron$select public.conta_recordatorios_despertar()$cron$);
  end if;
end $$;

-- conta_lectura (los agentes) lee las tablas, si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on public.conta_cobro_ajuste, public.conta_cobro_cliente, public.conta_recordatorio to conta_lectura;
  end if;
end $$;
