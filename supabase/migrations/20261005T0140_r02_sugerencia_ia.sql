-- ============================================================================
-- R02 · 5/5 · LA SUGERENCIA DE FOLVY: «parece que esta tienda la reparte la
-- plataforma»
-- ----------------------------------------------------------------------------
-- Encargo §5 y respuesta 1 (punto 3: vale para las tres plataformas):
-- si una marca lleva 3 pedidos SEGUIDOS de una plataforma en «propio» sin
-- dirección, Folvy propone en la pantalla cambiar esa celda a «Plataforma»,
-- con su porqué y dos respuestas. NO CAMBIA NADA SOLO.
--
-- SOLO AÑADE: una tabla nueva (lo respondido, que es «Lo que ha hecho Folvy»
-- en reparto) y dos funciones nuevas. No lo llama ningún disparador ni cron:
-- la detección se hace al abrir la pantalla.
--
-- POR QUÉ SE DETECTA AL LEER Y NO SE GUARDA AL ENTRAR CADA PEDIDO
-- La racha cambia con cada pedido y se deshace sola en cuanto llega uno con
-- dirección. Guardarla obligaría a un disparador más en el camino del pedido
-- (banda de servicio) para algo que solo se mira en una pantalla. Lo que sí se
-- guarda es la RESPUESTA de la persona, con la racha que la provocó: así una
-- racha rechazada no se vuelve a proponer, y una nueva sí.
-- ============================================================================

create table if not exists public.delivery_policy_suggestion (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  brand_id         uuid not null references public.brand(id) on delete cascade,
  channel_slug     text not null,
  proposed         text not null default 'platform' check (proposed in ('platform', 'own')),
  reason           text not null check (length(btrim(reason)) > 0),
  -- La racha: los pedidos que la forman (id y código de la plataforma).
  evidence         jsonb not null default '[]'::jsonb,
  last_sale_id     uuid not null,
  status           text not null check (status in ('accepted', 'rejected')),
  answered_at      timestamptz not null default now(),
  answered_by      uuid,
  answered_by_name text,
  constraint delivery_policy_suggestion_racha_uk unique (account_id, brand_id, channel_slug, last_sale_id)
);
comment on table public.delivery_policy_suggestion is
  'R02 · Las sugerencias de Folvy sobre quién reparte que una persona ha respondido (aceptada o no), con la racha de pedidos que la provocó. Es «Lo que ha hecho Folvy» de reparto.';

create index if not exists delivery_policy_suggestion_cuenta_idx
  on public.delivery_policy_suggestion (account_id, answered_at desc);

alter table public.delivery_policy_suggestion enable row level security;
drop policy if exists dps_select on public.delivery_policy_suggestion;
create policy dps_select on public.delivery_policy_suggestion
  for select to authenticated using (belongs_to_account(account_id));
-- Se escribe solo con reparto_responder_sugerencia.
revoke all on table public.delivery_policy_suggestion from anon;
revoke insert, update, delete on table public.delivery_policy_suggestion from authenticated;
grant select on table public.delivery_policy_suggestion to authenticated;
grant select, insert, update, delete on table public.delivery_policy_suggestion to service_role;

-- Las rachas vivas de una cuenta: marca × plataforma que HOY se resuelve como
-- «Nosotros» y cuyos 3 últimos pedidos «propios» de esa plataforma llegaron
-- sin dirección. Excluye la racha que alguien ya respondió.
create or replace function public.reparto_sugerencias(p_account_id uuid, p_seguidos integer default 3)
returns table (brand_id uuid, brand_name text, channel_slug text, pedidos integer,
               codigos text[], ventas uuid[], last_sale_id uuid, ultimo_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'reparto_sugerencias: sin acceso a la cuenta' using errcode = '42501';
  end if;

  return query
  with ultimos as (
    select s.id, s.brand_id, sc.slug, s.platform_order_code, s.sold_at,
           coalesce(btrim(s.delivery_address), '') = '' as sin_dir,
           row_number() over (partition by s.brand_id, sc.slug order by s.sold_at desc, s.id desc) as n
      from public.sale s
      join public.sales_channel sc on sc.id = s.channel_id and sc.account_id = s.account_id
     where s.account_id = p_account_id
       and s.service_type = 'own_delivery'
       and s.source in ('hubrise', 'lastapp')
       and s.brand_id is not null
       and s.sold_at > now() - interval '30 days'
  ),
  rachas as (
    select u.brand_id, u.slug,
           count(*)::integer as pedidos,
           array_agg(coalesce(u.platform_order_code, left(u.id::text, 8)) order by u.sold_at) as codigos,
           array_agg(u.id order by u.sold_at) as ventas,
           (array_agg(u.id order by u.sold_at desc))[1] as last_sale_id,
           max(u.sold_at) as ultimo_at
      from ultimos u
     where u.n <= greatest(p_seguidos, 1)
     group by u.brand_id, u.slug
    having count(*) = greatest(p_seguidos, 1) and bool_and(u.sin_dir)
  )
  select r.brand_id, b.name, r.slug, r.pedidos, r.codigos, r.ventas, r.last_sale_id, r.ultimo_at
    from rachas r
    join public.brand b on b.id = r.brand_id and b.account_id = p_account_id
   cross join lateral public.resolve_delivery_by(p_account_id, r.brand_id, r.slug, null) q
   where q.delivery_by = 'own'
     and not exists (
       select 1 from public.delivery_policy_suggestion d
        where d.account_id = p_account_id and d.brand_id = r.brand_id
          and d.channel_slug = r.slug and d.last_sale_id = r.last_sale_id)
   order by r.ultimo_at desc;
end;
$$;

-- Responder: «Sí, la reparte la plataforma» (escribe la celda, source
-- ai_accepted) o «No, lo arreglo en la plataforma» (no cambia nada). Las dos
-- quedan escritas, con la racha y quién respondió.
create or replace function public.reparto_responder_sugerencia(
  p_account_id   uuid,
  p_brand_id     uuid,
  p_channel_slug text,
  p_last_sale_id uuid,
  p_aceptar      boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_plataforma text;
begin
  if not public.current_user_is_admin_or_manager_of(p_account_id) then
    raise exception 'Solo un administrador o encargado de la cuenta puede responder a Folvy'
      using errcode = '42501';
  end if;
  select * into v_r from public.reparto_sugerencias(p_account_id) s
   where s.brand_id = p_brand_id and s.channel_slug = p_channel_slug and s.last_sale_id = p_last_sale_id;
  if v_r.brand_id is null then
    raise exception 'Esa sugerencia ya no está viva (llegó un pedido con dirección o ya se respondió)'
      using errcode = 'P0002';
  end if;
  v_plataforma := case p_channel_slug when 'uber' then 'Uber Eats' when 'justeat' then 'Just Eat'
                                      when 'glovo' then 'Glovo' else initcap(p_channel_slug) end;

  insert into public.delivery_policy_suggestion
    (account_id, brand_id, channel_slug, proposed, reason, evidence, last_sale_id, status,
     answered_by, answered_by_name)
  values
    (p_account_id, p_brand_id, p_channel_slug, 'platform',
     'En ' || v_plataforma || ', ' || v_r.brand_name || ' llevaba ' || v_r.pedidos
       || ' pedidos seguidos sin dirección. Parece que en ' || v_plataforma
       || ' la tienda está como «reparto de la plataforma».',
     (select jsonb_agg(jsonb_build_object('sale_id', v, 'codigo', c))
        from unnest(v_r.ventas, v_r.codigos) as x(v, c)),
     p_last_sale_id,
     case when p_aceptar then 'accepted' else 'rejected' end,
     auth.uid(), public.conta_nombre_actor());

  if p_aceptar then
    perform public.reparto_guardar_celda(p_account_id, p_brand_id, p_channel_slug, null, 'platform', 'ai_accepted');
    return 'Hecho: ' || v_r.brand_name || ' en ' || v_plataforma
      || ' la reparte la plataforma. Se aplica a los pedidos siguientes.';
  end if;
  return 'Anotado: ' || v_r.brand_name || ' en ' || v_plataforma
    || ' sigue en «Nosotros». No se vuelve a proponer por estos pedidos.';
end;
$$;

revoke all on function public.reparto_sugerencias(uuid, integer) from public, anon;
revoke all on function public.reparto_responder_sugerencia(uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.reparto_sugerencias(uuid, integer) to authenticated;
grant execute on function public.reparto_responder_sugerencia(uuid, uuid, text, uuid, boolean) to authenticated;
