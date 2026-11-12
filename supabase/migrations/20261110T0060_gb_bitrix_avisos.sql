-- supabase/migrations/20261110T0060_gb_bitrix_avisos.sql
--
-- GB · nº 13, punto 4 · Tareas en Bitrix24 a partir de lo que pasa en Sumied,
-- por la API (actividades «por hacer» del CRM en la ficha), sin robots que
-- configurar a mano:
--   · recibo devuelto → tarea al responsable de la ficha; se cierra sola
--     cuando un cobro posterior del mismo mandato se cobra;
--   · mandato sin firmar a los 7 días → tarea al responsable (el comercial);
--     se cierra sola cuando lo firma;
--   · alta o baja pedida en el portal → tarea al Dpto. Laboral; se cierra sola
--     al hacerla (o rechazarla).
--
-- SOLO las conexiones de PRUEBAS (conta_crm.entorno = 'pruebas'): el
-- Bitrix24 real de QBO no se toca. Abrirlo al real lo decide Julio (otra tanda).
--
-- Añade, sin cambiar nada de lo que ya existe:
--   1. conta_bitrix_pestana_aviso: cada tarea puesta en Bitrix24 (una por
--      cosa: tipo + referencia), su estado y su id en Bitrix24. Lectura con RLS.
--   2. conta_bitrix_pestana_avisos_por_hacer(límite): solo el servidor. Lo que
--      hay que abrir (con la ficha de Bitrix24 del cliente) y lo que hay que cerrar.
--   3. conta_bitrix_pestana_aviso_apuntar(aviso): solo el servidor. Apunta lo
--      que ha pasado en Bitrix24.
--   4. conta_bitrix_pestana_avisos_despertar(): cada 15 minutos (cron
--      conta-bitrix-avisos-despertar, si hay pg_cron y cron_secret): si hay
--      algo que abrir o cerrar, llama a conta-bitrix-pestana-avisos.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0060_gb_bitrix_avisos.down.sql

create table if not exists public.conta_bitrix_pestana_aviso (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  party_id     uuid not null references public.party(id) on delete cascade,
  tipo         text not null check (tipo in ('devuelto', 'mandato_sin_firmar', 'peticion_portal')),
  ref          text not null,
  tipo_ficha   text not null check (tipo_ficha in ('empresa', 'contacto')),
  id_externo   text not null,
  titulo       text not null,
  estado       text not null default 'abierta' check (estado in ('abierta', 'cerrada', 'no_se_pudo')),
  bitrix_id    text,
  porque       text,
  creada_at    timestamptz not null default now(),
  cerrada_at   timestamptz,
  unique (account_id, tipo, ref)
);
comment on table public.conta_bitrix_pestana_aviso is
  'GB (nº 13) · Las tareas puestas en Bitrix24 por lo que pasa en Sumied (recibo devuelto, mandato sin firmar a los 7 días, alta o baja pedida en el portal): una por cosa, con su estado y su id en Bitrix24. Solo conexiones de pruebas.';
alter table public.conta_bitrix_pestana_aviso enable row level security;
revoke all on table public.conta_bitrix_pestana_aviso from public, anon, authenticated;
grant select on table public.conta_bitrix_pestana_aviso to authenticated;
grant all on table public.conta_bitrix_pestana_aviso to service_role;
drop policy if exists conta_bitrix_pestana_aviso_leer on public.conta_bitrix_pestana_aviso;
create policy conta_bitrix_pestana_aviso_leer on public.conta_bitrix_pestana_aviso for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_bitrix_pestana_aviso to conta_lectura; end if;
end $$;

create or replace function public.conta_bitrix_pestana_avisos_por_hacer(p_limite int default 50)
returns jsonb
language sql stable security definer set search_path = public as $$
  with cuentas as (
    select c.account_id from public.conta_crm c where c.crm = 'bitrix24' and c.entorno = 'pruebas' and c.url_ref is not null
  ), ficha as (
    select distinct on (f.account_id, f.party_id) f.account_id, f.party_id, f.tipo_ficha, f.id_externo
      from public.conta_gestoria_ficha f join cuentas k on k.account_id = f.account_id
     where f.crm = 'bitrix24' and f.party_id is not null and f.tipo_ficha in ('empresa', 'contacto')
     order by f.account_id, f.party_id, (f.tipo_ficha = 'empresa') desc, (f.de_empresa = '') desc, f.id_externo
  ), cosas as (
    select b.account_id, g.party_id, 'devuelto'::text tipo, b.company_id::text || ':' || b.gc_id ref,
      format('Recibo devuelto · %s · %s €', to_char(b.fecha, 'DD/MM/YYYY'), replace(to_char(b.importe, 'FM999999990.00'), '.', ',')) titulo,
      'GoCardless lo ha devuelto. Se resuelve desde la pestaña Sumied, en «Cuotas y cobros». Esta tarea se cierra sola cuando se cobre.' texto,
      false laboral
      from public.conta_gc_cobro b join cuentas k on k.account_id = b.account_id
      join public.conta_gc_mandato m on m.company_id = b.company_id and m.gc_id = b.mandato_gc_id
      join public.conta_gc_cliente g on g.company_id = m.company_id and g.gc_id = m.gc_cliente_id
     where b.estado in ('failed', 'charged_back') and b.fecha >= current_date - 30 and g.party_id is not null
       and not exists (select 1 from public.conta_gc_cobro p where p.company_id = b.company_id and p.mandato_gc_id = b.mandato_gc_id
                         and p.fecha > b.fecha and p.estado in ('paid_out', 'confirmed'))
    union all
    select m.account_id, g.party_id, 'mandato_sin_firmar', m.company_id::text || ':' || m.gc_id,
      format('Mandato sin firmar desde hace %s días', current_date - (m.creado at time zone 'Europe/Madrid')::date),
      'El cliente no ha firmado la domiciliación de GoCardless. Llámale o reenvíale el enlace. Esta tarea se cierra sola cuando la firme.',
      false
      from public.conta_gc_mandato m join cuentas k on k.account_id = m.account_id
      join public.conta_gc_cliente g on g.company_id = m.company_id and g.gc_id = m.gc_cliente_id
     where m.estado = 'pending_customer_approval' and m.creado <= now() - interval '7 days' and g.party_id is not null
    union all
    select s.account_id, s.party_id, 'peticion_portal', s.id::text,
      format('%s pedida en el portal: %s, %s %s', case s.tipo when 'baja' then 'Baja' else 'Alta' end, s.empleado_nombre,
        case s.tipo when 'baja' then 'el' else 'desde el' end, to_char(coalesce(s.fecha_efecto, s.mes), 'DD/MM')),
      'La pidió el cliente desde su portal. Se hace en la pestaña Sumied, en «Portal» → «Hacerla»: esta tarea se cierra sola.',
      true
      from public.conta_solicitud s join cuentas k on k.account_id = s.account_id
     where s.estado = 'pedida' and s.tipo in ('alta', 'baja')
  ), abrir as (
    select c.*, f.tipo_ficha, f.id_externo from cosas c join ficha f on f.account_id = c.account_id and f.party_id = c.party_id
     where not exists (select 1 from public.conta_bitrix_pestana_aviso a where a.account_id = c.account_id and a.tipo = c.tipo and a.ref = c.ref)
     order by c.account_id, c.tipo, c.ref limit greatest(coalesce(p_limite, 50), 1)
  ), cerrar as (
    select a.id, a.account_id, a.bitrix_id from public.conta_bitrix_pestana_aviso a join cuentas k on k.account_id = a.account_id
     where a.estado = 'abierta' and a.bitrix_id is not null and case a.tipo
       when 'devuelto' then not exists (
         select 1 from public.conta_gc_cobro b where b.company_id::text || ':' || b.gc_id = a.ref and b.estado in ('failed', 'charged_back')
            and not exists (select 1 from public.conta_gc_cobro p where p.company_id = b.company_id and p.mandato_gc_id = b.mandato_gc_id
                              and p.fecha > b.fecha and p.estado in ('paid_out', 'confirmed')))
       when 'mandato_sin_firmar' then not exists (
         select 1 from public.conta_gc_mandato m where m.company_id::text || ':' || m.gc_id = a.ref and m.estado = 'pending_customer_approval')
       else not exists (select 1 from public.conta_solicitud s where s.id::text = a.ref and s.estado = 'pedida')
     end
     order by a.creada_at limit greatest(coalesce(p_limite, 50), 1)
  )
  select jsonb_build_object(
    'abrir', coalesce((select jsonb_agg(jsonb_build_object('cuenta', account_id, 'cliente', party_id, 'tipo', tipo, 'ref', ref, 'titulo', titulo, 'texto', texto,
               'laboral', laboral, 'tipo_ficha', tipo_ficha, 'id_externo', id_externo)) from abrir), '[]'::jsonb),
    'cerrar', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'cuenta', account_id, 'bitrix_id', bitrix_id)) from cerrar), '[]'::jsonb))
$$;

create or replace function public.conta_bitrix_pestana_aviso_apuntar(p jsonb)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if p ? 'id' then
    update public.conta_bitrix_pestana_aviso set estado = coalesce(p->>'estado', estado), porque = p->>'porque',
      cerrada_at = case when p->>'estado' = 'cerrada' then now() else cerrada_at end
     where id = (p->>'id')::uuid;
    return;
  end if;
  insert into public.conta_bitrix_pestana_aviso (account_id, party_id, tipo, ref, tipo_ficha, id_externo, titulo, estado, bitrix_id, porque)
  values ((p->>'cuenta')::uuid, (p->>'cliente')::uuid, p->>'tipo', p->>'ref', p->>'tipo_ficha', p->>'id_externo', p->>'titulo',
          coalesce(p->>'estado', 'abierta'), nullif(p->>'bitrix_id', ''), p->>'porque')
  on conflict (account_id, tipo, ref) do update set estado = excluded.estado, bitrix_id = coalesce(excluded.bitrix_id, public.conta_bitrix_pestana_aviso.bitrix_id),
    porque = excluded.porque;
end $$;

create or replace function public.conta_bitrix_pestana_avisos_despertar()
returns void
language plpgsql security definer set search_path = public as $$
declare v_secreto text; v_hay jsonb;
begin
  v_hay := public.conta_bitrix_pestana_avisos_por_hacer(1);
  if jsonb_array_length(v_hay->'abrir') = 0 and jsonb_array_length(v_hay->'cerrar') = 0 then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-bitrix-pestana-avisos.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-bitrix-pestana-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;

revoke all on function public.conta_bitrix_pestana_avisos_por_hacer(int) from public, anon, authenticated;
revoke all on function public.conta_bitrix_pestana_aviso_apuntar(jsonb) from public, anon, authenticated;
revoke all on function public.conta_bitrix_pestana_avisos_despertar() from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_avisos_por_hacer(int) to service_role;
grant execute on function public.conta_bitrix_pestana_aviso_apuntar(jsonb) to service_role;

comment on function public.conta_bitrix_pestana_avisos_por_hacer(int) is
  'GB (nº 13) · Lo que hay que abrir en Bitrix24 (recibo devuelto, mandato sin firmar a los 7 días, alta o baja pedida en el portal; con la ficha del cliente) y lo que hay que cerrar porque ya está resuelto. Solo conexiones de pruebas. Solo el servidor.';
comment on function public.conta_bitrix_pestana_aviso_apuntar(jsonb) is
  'GB (nº 13) · Apunta lo que ha pasado en Bitrix24 con una tarea (abierta, cerrada o no se pudo). Solo el servidor (conta-bitrix-pestana-avisos).';
comment on function public.conta_bitrix_pestana_avisos_despertar() is
  'GB (nº 13) · Cada 15 minutos (cron conta-bitrix-avisos-despertar): si hay tareas que abrir o cerrar en Bitrix24, llama a conta-bitrix-pestana-avisos. Si falta el secreto, falla (cron lo apunta), no calla.';

do $$
begin
  -- Sin pg_cron o sin Vault (una base local), no se programa nada.
  if to_regclass('cron.job') is not null and to_regclass('vault.secrets') is not null then
    if exists (select 1 from vault.secrets where name = 'cron_secret') then
      if exists (select 1 from cron.job where jobname = 'conta-bitrix-avisos-despertar') then
        perform cron.unschedule('conta-bitrix-avisos-despertar');
      end if;
      perform cron.schedule('conta-bitrix-avisos-despertar', '*/15 * * * *', $cron$select public.conta_bitrix_pestana_avisos_despertar()$cron$);
    end if;
  end if;
end $$;
