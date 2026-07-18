-- 20260718T1600_glovo_suelo_35d.sql
-- FRENTE OFERTAS · A — SUELO DE 35 DÍAS DE GLOVO (regla del 5%)
--
-- PROBLEMA (RECON con fuente primaria): Glovo rechaza en silencio un descuento si el
-- precio con oferta NO es al menos un 5% inferior al PRECIO MÁS BAJO de los últimos 35
-- días de ese artículo. Ese mínimo NO lo fija el precio de carta (intacto) sino NUESTRAS
-- promos anteriores → efecto trinquete: cada promo hunde el suelo y la siguiente ya no cabe.
-- El agente publicaba contra el margen y el robot publicaba contra la fe ("has lanzado una
-- promoción") → Folvy marcaba "Publicada" pero Glovo no aplicaba el descuento.
--
-- ESTA MIGRACIÓN es el HOOK de la Capa 1 (verdad): una tabla donde el robot deposita el
-- SUELO REAL que Glovo enseña en su tooltip por artículo, y una RPC (auth por secreto del
-- push-agent, patrón report_promo_push_job) para escribirlo sin sesión. El cerebro
-- (offers-agent) lo lee y, combinado con la reconstrucción desde nuestro histórico de
-- coupon, deja de proponer descuentos que Glovo va a rechazar.
--
-- floor_pct = cuánto por DEBAJO del precio de Glovo está el mínimo de 35 días, en %:
--   floor_pct = (1 - precio_min_35d / precio_glovo_actual) * 100
-- Con eso el agente calcula el descuento mínimo que Glovo aceptará:  P >= 5 + 0.95 * floor_pct.

begin;

-- ── Tabla de observaciones de suelo por artículo × canal ──────────────────────────────
create table if not exists public.platform_promo_floor (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  channel_id    uuid not null references public.sales_channel(id) on delete cascade,
  menu_item_id  uuid not null references public.menu_item(id) on delete cascade,
  floor_pct     numeric check (floor_pct is null or (floor_pct >= 0 and floor_pct <= 95)),
                                    -- cuánto por debajo del precio de Glovo está el mínimo de
                                    -- 35d, en %. NULL = solo tenemos el € (aún sin precio ref
                                    -- para convertir) → se guarda para auditoría, no restringe.
  floor_price   numeric,            -- € del mínimo de 35 días leído del tooltip (fuente primaria)
  ref_price     numeric,            -- € del precio de Glovo contra el que se comparó (si se leyó)
  source        text not null default 'glovo_portal'
                  check (source in ('glovo_portal','reconstructed','manual')),
  window_days   int  not null default 35,
  observed_at   timestamptz not null default now(),
  note          text,
  unique (account_id, channel_id, menu_item_id)
);

comment on table public.platform_promo_floor is
  'Suelo de precio de 35 días por artículo×canal (regla del 5% de Glovo). Lo alimenta el robot (Capa 1) leyendo el tooltip real de Glovo; el offers-agent (Capa 2) lo lee para no proponer descuentos que la plataforma rechaza.';

create index if not exists idx_ppf_account_channel
  on public.platform_promo_floor (account_id, channel_id);

-- ── RLS: lectura por cuenta (patrón belongs_to_account); escritura solo service_role/RPC ─
alter table public.platform_promo_floor enable row level security;

drop policy if exists ppf_read on public.platform_promo_floor;
create policy ppf_read on public.platform_promo_floor
  for select using (public.belongs_to_account(account_id));

-- (Sin policy de INSERT/UPDATE para usuarios: se escribe vía la RPC SECURITY DEFINER de abajo
--  o con service_role, igual que promo_push_job.)

-- ── RPC para el robot: reportar el suelo leído en Glovo (auth por secreto, sin sesión) ──
-- Espejo de report_promo_push_job: el robot NO tiene sesión, se autentica con el
-- push_agent_secret de offers_agent_config. Deriva la cuenta del secreto (nunca del cliente).
create or replace function public.report_platform_floor(
  p_secret       text,
  p_channel      text,           -- nombre del canal, p.ej. 'Glovo' (case-insensitive)
  p_menu_item_id uuid,
  p_floor_pct    numeric default null,   -- % hundido; si null y hay precios, se calcula
  p_floor_price  numeric default null,   -- € del mínimo de 35 días (el tooltip lo da directo)
  p_ref_price    numeric default null,   -- € del precio de Glovo del artículo (si se leyó)
  p_note         text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_channel uuid;
  v_pct     numeric;
begin
  -- 1) Autenticar por secreto → cuenta
  select account_id into v_account
  from public.offers_agent_config
  where push_agent_secret = p_secret
  limit 1;
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'secreto inválido');
  end if;

  -- 2) El artículo debe ser de esa cuenta (defensa: el secreto no puede escribir en otra)
  if not exists (
    select 1 from public.menu_item mi
    where mi.id = p_menu_item_id and mi.account_id = v_account
  ) then
    return jsonb_build_object('ok', false, 'error', 'menu_item fuera de la cuenta');
  end if;

  -- 3) Resolver canal por nombre dentro de la cuenta
  select id into v_channel
  from public.sales_channel
  where account_id = v_account and lower(name) = lower(p_channel)
  limit 1;
  if v_channel is null then
    return jsonb_build_object('ok', false, 'error', 'canal no encontrado: ' || coalesce(p_channel,'∅'));
  end if;

  -- 4) Resolver el % hundido: el que venga, o calcularlo desde los € si están ambos.
  v_pct := coalesce(
    p_floor_pct,
    case when p_floor_price is not null and p_ref_price is not null and p_ref_price > 0
         then (1 - p_floor_price / p_ref_price) * 100 end
  );
  if v_pct is not null then
    v_pct := greatest(0, least(95, round(v_pct::numeric, 2)));
  end if;

  -- 5) Upsert de la observación (la más reciente manda)
  insert into public.platform_promo_floor
    (account_id, channel_id, menu_item_id, floor_pct, floor_price, ref_price, source, observed_at, note)
  values
    (v_account, v_channel, p_menu_item_id, v_pct,
     p_floor_price, p_ref_price, 'glovo_portal', now(), p_note)
  on conflict (account_id, channel_id, menu_item_id) do update
    set floor_pct   = excluded.floor_pct,
        floor_price = excluded.floor_price,
        ref_price   = excluded.ref_price,
        source      = excluded.source,
        observed_at = now(),
        note        = excluded.note;

  return jsonb_build_object('ok', true, 'account_id', v_account, 'channel_id', v_channel);
end;
$$;

revoke all on function public.report_platform_floor(text,text,uuid,numeric,numeric,numeric,text) from public;
grant execute on function public.report_platform_floor(text,text,uuid,numeric,numeric,numeric,text) to anon, authenticated, service_role;

commit;
