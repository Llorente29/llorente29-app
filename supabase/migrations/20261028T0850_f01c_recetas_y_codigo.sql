-- supabase/migrations/20261028T0850_f01c_recetas_y_codigo.sql
--
-- F01 · PR 3 · Las recetas que faltan (tablero 3) y una marca que ya tienes
-- llega con otro código (tablero 4), de la maqueta «Alta de marca nueva».
-- SOLO AÑADE (y se puede pasar dos veces). Solo Last: nada se publica en Last
-- ni en HubRise; solo se lee lo que el espejo ya trae.
--
-- Medido en producción (28/10, solo lectura), en Foodint:
--   · Platos de Last sin receta (sin artículo o con un plato vacío), sin
--     combos: 74 en 14 marcas. Ventas suyas después del último recuento
--     (27/10 11:20 UTC): 0; en 30 días: 15.
--   · Marcas de Last sin dar de alta: ninguna nueva (9 vinculadas y 1 oculta).
--   · Ventas de Last sin marca: 1 en toda la historia (14/06), de un código que
--     el espejo no conoce.
--
--   1. f01_receta_puesta: la cola de los platos que acaban de recibir su
--      primera receta. La llena un disparador sobre recipe_line (la 0851, que
--      cambia), y la vacía _f01c_colocar_recetas: lo vendido de ese plato
--      desde el último recuento cerrado (regla 6) se reprocesa y descuenta
--      almacén. Sin botón «Recasar». Lo de antes del recuento se queda como
--      está y se dice.
--   2. f01_marca_reconocida: lo que Folvy ha hecho o ha preguntado con una
--      marca de Last que llega con otro código: vinculada sola (carta
--      idéntica), confirmada («Sí, es…»), «No, es otra marca», o un local con
--      un código nuevo de una marca ya dada de alta. Cada una se avisa hasta que
--      alguien dice «Entendido».
--   3. Las pantallas: f01_carta_marca (la pestaña Carta de la ficha de la
--      marca), f01_preparar_receta («Hacer receta» y el destino de «Subir mis
--      recetas»), f01_destino_lectura (a qué plato va una receta leída),
--      f01_colocar_recetas, f01_marcas_por_revisar (Marcas ›
--      Revisar), f01_decidir_marca y f01_aviso_visto. Cada una confirma con lo
--      que ha hecho o falla (regla 8).

-- ── 1. La cola de las recetas puestas ───────────────────────────────────────
create table if not exists public.f01_receta_puesta (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  recipe_item_id  uuid not null references public.recipe_item(id) on delete cascade,
  puesta_at       timestamptz not null default now(),
  -- Hasta dónde se ha colocado ya (las ventas se reprocesan por tandas).
  avance_hasta    timestamptz,
  colocada_at     timestamptz,
  resultado       jsonb not null default '{}'::jsonb
);
comment on table public.f01_receta_puesta is
  'F01 · PR 3: los platos de Last que acaban de recibir su primera receta. Lo vendido desde el último recuento cerrado se coloca solo (reprocess_sale) y queda dicho en resultado.';
create unique index if not exists f01_receta_puesta_pendiente on public.f01_receta_puesta (account_id, recipe_item_id) where colocada_at is null;
create index if not exists f01_receta_puesta_cuenta on public.f01_receta_puesta (account_id, colocada_at);
alter table public.f01_receta_puesta enable row level security;
drop policy if exists f01_receta_puesta_select on public.f01_receta_puesta;
create policy f01_receta_puesta_select on public.f01_receta_puesta for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
revoke insert, update, delete on public.f01_receta_puesta from anon, authenticated;

-- ── 2. Lo hecho o decidido con una marca que llega con otro código ──────────
create table if not exists public.f01_marca_reconocida (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  source               text not null default 'lastapp',
  external_org_id      uuid not null,
  external_brand_name  text not null,
  brand_id             uuid not null references public.brand(id) on delete cascade,
  -- sola: carta idéntica, vinculada por Folvy · confirmada: «Sí, es…» ·
  -- otra: «No, es otra marca» · codigo_nuevo: un local con otro código de una marca ya dada de alta.
  como                 text not null check (como in ('sola', 'confirmada', 'otra', 'codigo_nuevo')),
  comparacion          jsonb not null default '{}'::jsonb,
  ventas               jsonb not null default '{}'::jsonb,
  locales              jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  created_by_name      text,
  visto_at             timestamptz,
  visto_por            text
);
comment on table public.f01_marca_reconocida is
  'F01 · PR 3: una marca de Last con otro código. Lo que Folvy hizo solo (carta idéntica, local con código nuevo) o lo que decidió el cliente, con las ventas colocadas. Se avisa hasta visto_at.';
create index if not exists f01_marca_reconocida_cuenta on public.f01_marca_reconocida (account_id, external_org_id, external_brand_name);
alter table public.f01_marca_reconocida enable row level security;
drop policy if exists f01_marca_reconocida_select on public.f01_marca_reconocida;
create policy f01_marca_reconocida_select on public.f01_marca_reconocida for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
revoke insert, update, delete on public.f01_marca_reconocida from anon, authenticated;

-- ── 3. El disparador de la cola (lo engancha la 0851) ───────────────────────
-- Un plato entra en la cola cuando pasa de no tener ninguna línea a tener
-- alguna, y solo si es el artículo de un plato de Last. Nada más: colocar lo
-- vendido es cosa de _f01c_colocar_recetas, fuera de quien guarda la receta.
create or replace function public._f01c_receta_puesta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.f01_receta_puesta (account_id, recipe_item_id)
  select ri.account_id, ri.id
    from (select distinct n.parent_item_id from nuevas n) p
    join public.recipe_item ri on ri.id = p.parent_item_id
   where not exists (select 1 from public.recipe_line rl
                      where rl.parent_item_id = p.parent_item_id and rl.account_id = ri.account_id
                        and not exists (select 1 from nuevas n2 where n2.id = rl.id))
     and exists (select 1 from public.menu_item mi
                  where mi.account_id = ri.account_id and mi.recipe_item_id = ri.id and mi.external_source = 'lastapp')
  on conflict do nothing;
  return null;
end $$;
revoke all on function public._f01c_receta_puesta() from public, anon, authenticated;

-- ── 4. Colocar lo vendido de los platos que ya tienen receta ────────────────
-- Por tandas de p_max ventas (la pantalla pide pocas y repite; la pasada de
-- cada hora, muchas). Nunca por debajo del último recuento cerrado (regla 6):
-- esas se cuentan y se dicen. Cada venta, en su propio intento: si una falla,
-- se cuenta como fallida y las demás siguen.
create or replace function public._f01c_colocar_recetas(p_account uuid, p_max integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corte    timestamptz;
  v_q        record;
  v_s        record;
  v_n        integer;
  v_resto    integer := greatest(coalesce(p_max, 200), 1);
  v_hechas   integer := 0;
  v_fallos   integer := 0;
  v_debajo   integer := 0;
  v_platos   jsonb := '[]'::jsonb;
  v_ult      timestamptz;
  v_h        integer;
  v_f        integer;
  v_d        integer;
begin
  select max(ic.closed_at) into v_corte from public.inventory_count ic
   where ic.account_id = p_account and ic.status in ('aprobado', 'en_revision');

  for v_q in
    select q.*, btrim(ri.name) as plato from public.f01_receta_puesta q
      join public.recipe_item ri on ri.id = q.recipe_item_id and ri.account_id = p_account
     where q.account_id = p_account and q.colocada_at is null
     order by q.puesta_at
  loop
    exit when v_resto <= 0;
    v_h := 0; v_f := 0; v_n := 0; v_ult := v_q.avance_hasta;
    for v_s in
      select s.id, s.sold_at from public.sale s
       where s.account_id = p_account and s.source = 'lastapp' and s.raw_products is not null
         and s.sold_at <= v_q.puesta_at
         and (v_corte is null or s.sold_at > v_corte)
         and (v_q.avance_hasta is null or s.sold_at >= v_q.avance_hasta)
         and exists (select 1 from public.sale_line sl
                       join public.menu_item mi on mi.id = sl.menu_item_id and mi.account_id = p_account
                      where sl.sale_id = s.id and sl.account_id = p_account and mi.recipe_item_id = v_q.recipe_item_id)
       order by s.sold_at, s.id
       limit v_resto
    loop
      v_n := v_n + 1;
      v_ult := v_s.sold_at;
      begin
        perform public.reprocess_sale(v_s.id);
        v_h := v_h + 1;
      exception when others then
        v_f := v_f + 1;
        raise warning 'F01c: no se ha podido colocar la venta % (receta de %): %', v_s.id, v_q.plato, sqlerrm;
      end;
    end loop;
    v_resto := v_resto - v_n;
    v_hechas := v_hechas + v_h;
    v_fallos := v_fallos + v_f;

    -- Las que se quedan debajo del recuento, una vez por plato.
    v_d := 0;
    if v_corte is not null and v_q.avance_hasta is null then
      select count(distinct s.id) into v_d from public.sale s
        join public.sale_line sl on sl.sale_id = s.id and sl.account_id = p_account
        join public.menu_item mi on mi.id = sl.menu_item_id and mi.account_id = p_account
       where s.account_id = p_account and s.source = 'lastapp' and s.sold_at <= v_corte
         and s.sold_at <= v_q.puesta_at and mi.recipe_item_id = v_q.recipe_item_id;
    end if;
    v_debajo := v_debajo + v_d;

    update public.f01_receta_puesta q
       set avance_hasta = v_ult,
           -- Hecha cuando la tanda no se ha llenado (no queda nada más) o no avanza.
           colocada_at = case when v_resto > 0 or v_ult is not distinct from v_q.avance_hasta then now() end,
           resultado = jsonb_build_object(
             'plato', v_q.plato,
             'colocadas', coalesce((q.resultado->>'colocadas')::int, 0) + v_h,
             'fallidas', coalesce((q.resultado->>'fallidas')::int, 0) + v_f,
             'antes_del_recuento', coalesce((q.resultado->>'antes_del_recuento')::int, 0) + v_d,
             'corte', v_corte)
     where q.id = v_q.id;
    v_platos := v_platos || jsonb_build_object('plato', v_q.plato, 'colocadas', v_h, 'fallidas', v_f, 'antes_del_recuento', v_d);
  end loop;

  return jsonb_build_object(
    'platos', v_platos,
    'colocadas', v_hechas,
    'fallidas', v_fallos,
    'antes_del_recuento', v_debajo,
    'corte', v_corte,
    'quedan', (select count(*) from public.f01_receta_puesta q where q.account_id = p_account and q.colocada_at is null));
end $$;
revoke all on function public._f01c_colocar_recetas(uuid, integer) from public, anon, authenticated;

create or replace function public.f01_colocar_recetas(p_account uuid, p_receta uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Colocar lo vendido es cosa de quien administra la cuenta.' using errcode = '42501';
  end if;
  -- La receta recién guardada desde «Subir mis recetas»: entra en la cola aquí
  -- mismo, sin esperar al disparador (si ya está, no se repite).
  if p_receta is not null then
    insert into public.f01_receta_puesta (account_id, recipe_item_id)
    select ri.account_id, ri.id from public.recipe_item ri
     where ri.id = p_receta and ri.account_id = p_account
       and exists (select 1 from public.recipe_line rl where rl.parent_item_id = ri.id and rl.account_id = p_account)
       and exists (select 1 from public.menu_item mi where mi.account_id = p_account and mi.recipe_item_id = ri.id and mi.external_source = 'lastapp')
    on conflict do nothing;
  end if;
  -- Pocas por llamada: la pantalla repite mientras «quedan».
  return public._f01c_colocar_recetas(p_account, 150);
end $$;
revoke all on function public.f01_colocar_recetas(uuid, uuid) from public, anon;
grant execute on function public.f01_colocar_recetas(uuid, uuid) to authenticated;

-- ── 5. La carta de una marca (tablero 3) ────────────────────────────────────
create or replace function public.f01_carta_marca(p_account uuid, p_brand uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_corte  timestamptz;
  v        jsonb;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'La carta de una marca la ve quien administra la cuenta.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.brand b where b.id = p_brand and b.account_id = p_account) then
    raise exception 'Esa marca no es de esta cuenta.' using errcode = 'P0002';
  end if;
  select max(ic.closed_at) into v_corte from public.inventory_count ic
   where ic.account_id = p_account and ic.status in ('aprobado', 'en_revision');

  with canales as (
    select sc.id, sc.slug, sc.name from public.brand_channel bc
      join public.sales_channel sc on sc.id = bc.channel_id and sc.account_id = p_account and sc.is_active
     where bc.account_id = p_account and bc.brand_id = p_brand and bc.is_active and bc.archived_at is null
       and sc.slug in ('uber', 'glovo', 'justeat', 'deliveroo', 'shop')
  ),
  articulos as (
    select mi.id, btrim(mi.name) as nombre, mi.price, mi.recipe_item_id, mi.external_source, mi.created_at as creado,
           case when ri.type = 'raw' then 'almacen'
                when ri.id is not null and exists (select 1 from public.recipe_line rl
                                                    where rl.parent_item_id = ri.id and rl.account_id = p_account) then 'receta'
                else 'sin_receta' end as estado
      from public.menu_item mi
      left join public.recipe_item ri on ri.id = mi.recipe_item_id and ri.account_id = p_account
     where mi.account_id = p_account and mi.brand_id = p_brand and mi.archived_at is null
       and coalesce(mi.product_type, 'item') <> 'combo'
  ),
  -- Un plato por artículo: dos matrículas con el mismo artículo (un nombre por
  -- plataforma, o el mismo plato con otro código de marca) son un plato.
  platos as (
    select (array_agg(a.id order by (a.external_source = 'lastapp') desc, a.creado, a.nombre, a.id))[1] as id,
           (array_agg(a.nombre order by (a.external_source = 'lastapp') desc, a.creado, a.nombre, a.id))[1] as nombre,
           (array_agg(a.price order by (a.external_source = 'lastapp') desc, a.creado, a.nombre, a.id))[1] as price,
           (array_agg(a.external_source order by (a.external_source = 'lastapp') desc, a.creado, a.nombre, a.id))[1] as external_source,
           a.recipe_item_id, min(a.estado) as estado, array_agg(a.id) as ids
      from articulos a
     group by a.recipe_item_id, case when a.recipe_item_id is null then a.id end
  ),
  -- Lo vendido de cada plato sin receta: lo que se colocará al ponerla y lo
  -- que se queda debajo del último recuento (regla 6). Solo Last.
  ventas as (
    select p.id,
           count(distinct s.id) filter (where v_corte is null or s.sold_at > v_corte) as despues,
           count(distinct s.id) filter (where v_corte is not null and s.sold_at <= v_corte) as antes
      from platos p
      join public.sale_line sl on sl.menu_item_id = any (p.ids) and sl.account_id = p_account
      join public.sale s on s.id = sl.sale_id and s.account_id = p_account and s.source = 'lastapp'
     where p.estado = 'sin_receta'
     group by p.id
  )
  select jsonb_build_object(
    'marca', (select jsonb_build_object(
                'id', b.id, 'nombre', b.name, 'propia', b.ownership_type is distinct from 'licensed',
                'socio', (select a.owner_name from public.brand_licensing_agreement a
                           where a.brand_id = b.id and a.account_id = p_account and a.is_active limit 1),
                'locales', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.name) order by l.name), '[]'::jsonb)
                              from public.brand_location_availability x
                              join public.locations l on l.id = x.location_id and l.account_id = p_account
                             where x.account_id = p_account and x.brand_id = b.id and x.is_active),
                'canales', (select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'nombre', c.name) order by c.slug), '[]'::jsonb) from canales c))
              from public.brand b where b.id = p_brand),
    'platos', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', p.id, 'nombre', p.nombre, 'estado', p.estado, 'recipe_item_id', p.recipe_item_id,
                 'de_last', p.external_source = 'lastapp',
                 'precio', p.price,
                 'precios', (select coalesce(jsonb_object_agg(c.slug, coalesce(
                                (select o.price from public.menu_item_override o
                                  where o.account_id = p_account and o.menu_item_id = p.id and o.channel_id = c.id and o.location_id is null
                                  order by o.updated_at desc nulls last limit 1), p.price)), '{}'::jsonb) from canales c),
                 'ventas_esperando', coalesce(v.despues, 0),
                 'ventas_antes_del_recuento', coalesce(v.antes, 0))
               order by (p.estado = 'sin_receta') desc, (p.estado = 'almacen'), public._f01_normalizar(p.nombre), p.id), '[]'::jsonb)
               from platos p left join ventas v on v.id = p.id),
    'resumen', (select jsonb_build_object(
                  'platos', count(*) filter (where p.estado <> 'almacen'),
                  'con_receta', count(*) filter (where p.estado = 'receta'),
                  'sin_receta', count(*) filter (where p.estado = 'sin_receta'),
                  'almacen', count(*) filter (where p.estado = 'almacen'))
                from platos p),
    'ventas_esperando', (select count(distinct s.id) from public.sale s
                          join public.sale_line sl on sl.sale_id = s.id and sl.account_id = p_account
                          join platos p on sl.menu_item_id = any (p.ids) and p.estado = 'sin_receta'
                         where s.account_id = p_account and s.source = 'lastapp' and (v_corte is null or s.sold_at > v_corte)),
    'ventas_antes_del_recuento', (select count(distinct s.id) from public.sale s
                          join public.sale_line sl on sl.sale_id = s.id and sl.account_id = p_account
                          join platos p on sl.menu_item_id = any (p.ids) and p.estado = 'sin_receta'
                         where s.account_id = p_account and s.source = 'lastapp' and v_corte is not null and s.sold_at <= v_corte),
    'corte', v_corte,
    'por_colocar', (select count(*) from public.f01_receta_puesta q
                     where q.account_id = p_account and q.colocada_at is null
                       and q.recipe_item_id in (select p.recipe_item_id from platos p where p.recipe_item_id is not null)),
    -- Lo colocado en los últimos 7 días al poner una receta de esta marca: se dice.
    'colocadas', (select coalesce(jsonb_agg(q.resultado || jsonb_build_object('colocada_at', q.colocada_at) order by q.colocada_at desc), '[]'::jsonb)
                    from public.f01_receta_puesta q
                   where q.account_id = p_account and q.colocada_at > now() - interval '7 days'
                     and q.recipe_item_id in (select p.recipe_item_id from platos p where p.recipe_item_id is not null)))
  into v;
  return v;
end $$;
revoke all on function public.f01_carta_marca(uuid, uuid) from public, anon;
grant execute on function public.f01_carta_marca(uuid, uuid) to authenticated;

-- ── 6. «Hacer receta»: el plato de Folvy donde se escribe ───────────────────
-- Si el plato de la carta aún no tiene artículo, se le crea uno vacío (como el
-- sembrado) y se enlaza. Devuelve dónde se escribe la receta.
create or replace function public._f01c_preparar(p_account uuid, p_menu_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mi    record;
  v_tipo  text;
  v_ri    uuid;
  v_ud    uuid;
begin
  select mi.id, mi.name, mi.recipe_item_id into v_mi from public.menu_item mi
   where mi.id = p_menu_item and mi.account_id = p_account and mi.archived_at is null;
  if v_mi.id is null then raise exception 'Ese plato no está en la carta de esta cuenta.' using errcode = 'P0002'; end if;

  if v_mi.recipe_item_id is not null then
    select ri.type into v_tipo from public.recipe_item ri where ri.id = v_mi.recipe_item_id and ri.account_id = p_account;
    if v_tipo = 'raw' then
      raise exception '«%» sale del almacén tal cual: no lleva receta.', btrim(v_mi.name) using errcode = '22023';
    end if;
    return jsonb_build_object('recipe_item_id', v_mi.recipe_item_id, 'creado', false, 'plato', btrim(v_mi.name));
  end if;

  select u.id into v_ud from public.kitchen_unit u
   where (u.account_id is null or u.account_id = p_account) and u.dimension = 'unit' and u.is_base and u.is_active
   order by (u.account_id is null) desc, u.is_seed desc, u.created_at limit 1;
  insert into public.recipe_item (account_id, type, name, base_unit_id, is_active, source, needs_review, created_by_name)
  values (p_account, 'dish', btrim(v_mi.name), v_ud, true, 'import', true, public._f01b_quien(p_account))
  returning id into v_ri;
  update public.menu_item set recipe_item_id = v_ri, updated_at = now() where id = v_mi.id and recipe_item_id is null;
  return jsonb_build_object('recipe_item_id', v_ri, 'creado', true, 'plato', btrim(v_mi.name));
end $$;
revoke all on function public._f01c_preparar(uuid, uuid) from public, anon, authenticated;

create or replace function public.f01_preparar_receta(p_account uuid, p_menu_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Hacer la receta de un plato de la carta es cosa de quien administra la cuenta.' using errcode = '42501';
  end if;
  return public._f01c_preparar(p_account, p_menu_item);
end $$;
revoke all on function public.f01_preparar_receta(uuid, uuid) from public, anon;
grant execute on function public.f01_preparar_receta(uuid, uuid) to authenticated;

-- «Subir mis recetas»: Folvy lee un fichero (un plato por fichero, con la
-- lectura de Cocina, extract-recipe) y la persona dice de qué plato es. La
-- lectura se apunta a ese plato antes de confirmarla: al guardar,
-- materialize_recipe_session escribe la receta en él y no crea otro.
create or replace function public.f01_destino_lectura(p_account uuid, p_session uuid, p_menu_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_estado text;
  r        jsonb;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Subir las recetas de la carta es cosa de quien administra la cuenta.' using errcode = '42501';
  end if;
  select s.status into v_estado from public.recipe_item_ai_session s where s.id = p_session and s.account_id = p_account;
  if v_estado is null then raise exception 'Esa lectura no es de esta cuenta.' using errcode = 'P0002'; end if;
  if v_estado = 'accepted' then raise exception 'Esa lectura ya está guardada.' using errcode = '22023'; end if;
  r := public._f01c_preparar(p_account, p_menu_item);
  update public.recipe_item_ai_session set recipe_item_id = (r->>'recipe_item_id')::uuid, updated_at = now()
   where id = p_session and account_id = p_account;
  return r;
end $$;
revoke all on function public.f01_destino_lectura(uuid, uuid, uuid) from public, anon;
grant execute on function public.f01_destino_lectura(uuid, uuid, uuid) to authenticated;

-- ── 7. Comparar la carta de una marca de Last con las marcas de Folvy ───────
-- Por nombre de plato (casi igual cuenta como igual) o por su matrícula de
-- Last. Devuelve la marca de Folvy que más se parece:
--   · idéntica: los mismos platos a los dos lados (3 o más);
--   · parecida: coincide al menos la mitad de los platos de Last (y 3 o más).
create or replace function public._f01c_comparar(p_account uuid, p_org uuid, p_nombre text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_last   jsonb;
  v_nl     integer;
  v_b      record;
  v_platos jsonb;
begin
  with last as (
    select public._f01_normalizar(btrim(f.product_name)) as n, min(btrim(f.product_name)) as nombre,
           array_agg(distinct f.organization_product_id::text) as matr
      from public._f01_filas(p_account, p_org, p_nombre) f
     where f.organization_product_id is not null and nullif(btrim(f.product_name), '') is not null
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('n', l.n, 'nombre', l.nombre, 'matr', to_jsonb(l.matr)) order by l.n), '[]'::jsonb), count(*)
    into v_last, v_nl from last l;
  if v_nl = 0 then return jsonb_build_object('platos_last', 0, 'identica', false, 'parecida', false); end if;

  with last as (
    select x->>'n' as n, x->>'nombre' as nombre, array(select jsonb_array_elements_text(x->'matr')) as matr from jsonb_array_elements(v_last) x
  ),
  folvy as (
    select mi.brand_id, public._f01_normalizar(btrim(mi.name)) as n, min(btrim(mi.name)) as nombre,
           coalesce(array_agg(distinct mi.external_id) filter (where mi.external_id is not null), '{}') as matr,
           bool_or(ri.type = 'raw' or exists (select 1 from public.recipe_line rl where rl.parent_item_id = ri.id and rl.account_id = p_account)) as con_receta
      from public.menu_item mi
      join public.brand b on b.id = mi.brand_id and b.account_id = p_account and b.is_active and b.archived_at is null
      left join public.recipe_item ri on ri.id = mi.recipe_item_id and ri.account_id = p_account
     where mi.account_id = p_account and mi.archived_at is null and nullif(btrim(mi.name), '') is not null
     group by 1, 2
  ),
  cruce as (
    select f.brand_id,
           count(*) as platos_folvy,
           count(*) filter (where f.con_receta) as con_receta,
           count(*) filter (where exists (select 1 from last l where l.n = f.n or l.matr && f.matr)) as coinciden_folvy,
           (select count(*) from last l where exists (select 1 from folvy f2 where f2.brand_id = f.brand_id and (f2.n = l.n or f2.matr && l.matr))) as coinciden_last
      from folvy f group by f.brand_id
  )
  select c.*, b.name as marca into v_b from cruce c join public.brand b on b.id = c.brand_id
   order by c.coinciden_last desc, c.coinciden_folvy desc, c.platos_folvy, b.name, c.brand_id limit 1;

  if v_b.brand_id is null or v_b.coinciden_last = 0 then
    return jsonb_build_object('platos_last', v_nl, 'identica', false, 'parecida', false);
  end if;

  -- Las dos cartas, una al lado de la otra.
  select jsonb_build_object(
           'last', (select coalesce(jsonb_agg(jsonb_build_object('nombre', l->>'nombre',
                       'coincide', exists (select 1 from public.menu_item mi
                                            where mi.account_id = p_account and mi.brand_id = v_b.brand_id and mi.archived_at is null
                                              and (public._f01_normalizar(btrim(mi.name)) = l->>'n'
                                                   or mi.external_id in (select jsonb_array_elements_text(l->'matr')))))
                       order by l->>'n'), '[]'::jsonb) from jsonb_array_elements(v_last) l),
           'folvy', (select coalesce(jsonb_agg(jsonb_build_object('nombre', x.nombre, 'coincide', x.coincide) order by x.n), '[]'::jsonb)
                       from (select public._f01_normalizar(btrim(mi.name)) as n, min(btrim(mi.name)) as nombre,
                                    bool_or(exists (select 1 from jsonb_array_elements(v_last) l
                                                     where l->>'n' = public._f01_normalizar(btrim(mi.name))
                                                        or mi.external_id in (select jsonb_array_elements_text(l->'matr')))) as coincide
                               from public.menu_item mi
                              where mi.account_id = p_account and mi.brand_id = v_b.brand_id and mi.archived_at is null
                                and nullif(btrim(mi.name), '') is not null
                              group by 1) x))
    into v_platos;

  return jsonb_build_object(
    'brand_id', v_b.brand_id,
    'marca', v_b.marca,
    'platos_last', v_nl,
    'platos_folvy', v_b.platos_folvy,
    'con_receta', v_b.con_receta,
    'coinciden', v_b.coinciden_folvy,
    'coinciden_last', v_b.coinciden_last,
    'identica', v_nl >= 3 and v_b.coinciden_last = v_nl and v_b.coinciden_folvy = v_b.platos_folvy and v_b.platos_folvy = v_nl,
    'parecida', v_b.coinciden_last >= 3 and v_b.coinciden_last * 2 >= v_nl,
    'locales_folvy', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.name) order by l.name), '[]'::jsonb)
                        from public.brand_location_availability x
                        join public.locations l on l.id = x.location_id and l.account_id = p_account
                       where x.account_id = p_account and x.brand_id = v_b.brand_id and x.is_active),
    'cartas', v_platos);
end $$;
revoke all on function public._f01c_comparar(uuid, uuid, text) from public, anon, authenticated;

-- Las ventas de una marca de Last que esperan a que se sepa de quién son: las
-- mismas que colocaría _f01_recolocar, a los dos lados del último recuento.
create or replace function public._f01c_ventas_esperando(p_account uuid, p_org uuid, p_nombre text)
returns jsonb language sql stable security definer set search_path = public as $$
  with corte as (
    select max(ic.closed_at) as c from public.inventory_count ic
     where ic.account_id = p_account and ic.status in ('aprobado', 'en_revision')
  ),
  matriculas as (
    select distinct f.organization_product_id::text as m from public._f01_filas(p_account, p_org, p_nombre) f
     where f.organization_product_id is not null),
  ids as (
    select distinct f.external_brand_id as e from public._f01_filas(p_account, p_org, p_nombre) f where f.external_brand_id is not null),
  ventas as (
    select s.id, s.sold_at from public.sale s
     where s.account_id = p_account and s.source = 'lastapp' and s.raw_products is not null
       and (exists (select 1 from public.sale_line sl
                     where sl.sale_id = s.id and sl.account_id = p_account and sl.menu_item_id is null
                       and coalesce(sl.unmapped_reason, '') in ('no_brand', 'no_menu_item', 'no_recipe')
                       and sl.external_product_id in (select m from matriculas))
            or (s.brand_id is null and s.external_brand_text in (select e from ids))))
  select jsonb_build_object(
    'despues', count(*) filter (where c.c is null or v.sold_at > c.c),
    'antes', count(*) filter (where c.c is not null and v.sold_at <= c.c),
    'corte', max(c.c))
    from ventas v cross join corte c
$$;
revoke all on function public._f01c_ventas_esperando(uuid, uuid, text) from public, anon, authenticated;

-- Las marcas de Last sin dar de alta que se parecen a una marca de Folvy (y no
-- se ha dicho ya «No, es otra marca»).
create or replace function public._f01c_candidatas(p_account uuid)
returns table (org uuid, nombre text, cuenta_last text, estado text, locales jsonb, canales jsonb, comparacion jsonb)
language sql stable security definer set search_path = public as $$
  select x.org, x.nombre, x.cuenta_last, x.estado, x.locales, x.canales, public._f01c_comparar(p_account, x.org, x.nombre)
    from (select (m->>'org')::uuid as org, m->>'nombre' as nombre, m->>'cuenta_last' as cuenta_last, m->>'estado' as estado,
                 coalesce(m->'locales', '[]'::jsonb) as locales, coalesce(m->'canales', '[]'::jsonb) as canales
            from jsonb_array_elements(public._f01_marcas_last(p_account)) m) x
   where x.estado in ('nueva', 'sin_vincular')
     and not exists (select 1 from public.f01_marca_reconocida r
                      where r.account_id = p_account and r.source = 'lastapp' and r.external_org_id = x.org
                        and r.external_brand_name = x.nombre and r.como = 'otra')
$$;
revoke all on function public._f01c_candidatas(uuid) from public, anon, authenticated;

-- Unir una marca de Last a una de Folvy: su alta, el vínculo de cada local y lo
-- vendido colocado (regla 6, en _f01_recolocar). Lo hecho queda apuntado.
create or replace function public._f01c_unir(p_account uuid, p_org uuid, p_nombre text, p_brand uuid, p_como text,
                                             p_comparacion jsonb, p_quien uuid, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ya      uuid;
  v_vinc    jsonb;
  v_carta   jsonb;
  v_ventas  jsonb;
  v_id      uuid;
begin
  select a.brand_id into v_ya from public.external_brand_alta a
   where a.account_id = p_account and a.source = 'lastapp' and a.external_org_id = p_org and a.external_brand_name = btrim(p_nombre);
  if v_ya is not null and v_ya <> p_brand then
    raise exception '«%» de Last ya está unida a otra marca de Folvy.', btrim(p_nombre) using errcode = '23505';
  end if;
  insert into public.external_brand_alta (account_id, source, external_org_id, external_brand_name, brand_id, created_by, created_by_name)
  values (p_account, 'lastapp', p_org, btrim(p_nombre), p_brand, p_quien, coalesce(p_quien_nombre, 'Folvy (carta idéntica)'))
  on conflict (account_id, source, external_org_id, external_brand_name) do nothing;

  -- Como el alta con una marca que ya existe: el vínculo de cada local, la carta
  -- (las matrículas nuevas se juntan por nombre con el artículo y la receta que
  -- ya tiene la marca) y lo vendido, colocado.
  v_vinc := public._f01_vincular(p_account, p_brand, p_org, p_nombre, false, coalesce(p_quien_nombre, 'Folvy (carta idéntica)'));
  v_carta := public._f01_sembrar_marca(p_account, p_brand, p_org, p_nombre, false, coalesce(p_quien_nombre, 'Folvy (carta idéntica)'));
  v_ventas := public._f01_recolocar(p_account, p_brand, p_org, p_nombre);

  insert into public.f01_marca_reconocida (account_id, source, external_org_id, external_brand_name, brand_id, como,
                                           comparacion, ventas, locales, created_by, created_by_name, visto_at, visto_por)
  values (p_account, 'lastapp', p_org, btrim(p_nombre), p_brand, p_como,
          coalesce(p_comparacion, '{}'::jsonb) - 'cartas', v_ventas, coalesce(v_vinc->'locales', '[]'::jsonb), p_quien, p_quien_nombre,
          -- Lo que decide una persona ya lo ha visto; lo que hace Folvy solo, se avisa.
          case when p_como = 'confirmada' then now() end, case when p_como = 'confirmada' then p_quien_nombre end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'como', p_como, 'nombre_last', btrim(p_nombre), 'brand_id', p_brand,
                            'marca', (select b.name from public.brand b where b.id = p_brand),
                            'locales', coalesce(v_vinc->'locales', '[]'::jsonb), 'carta', v_carta, 'ventas', v_ventas,
                            -- Los platos de esa carta que se quedan sin receta: se dicen.
                            'sin_receta', (select coalesce(jsonb_agg(distinct btrim(mi.name)), '[]'::jsonb) from public.menu_item mi
                                            left join public.recipe_item ri on ri.id = mi.recipe_item_id and ri.account_id = p_account
                                           where mi.account_id = p_account and mi.brand_id = p_brand and mi.archived_at is null
                                             and mi.external_source = 'lastapp'
                                             and mi.external_id in (select f.organization_product_id::text from public._f01_filas(p_account, p_org, p_nombre) f)
                                             and coalesce(ri.type, 'dish') <> 'raw'
                                             and not exists (select 1 from public.recipe_line rl where rl.parent_item_id = ri.id and rl.account_id = p_account)));
end $$;
revoke all on function public._f01c_unir(uuid, uuid, text, uuid, text, jsonb, uuid, text) from public, anon, authenticated;

-- La pasada: las de carta idéntica se unen solas y se avisa.
create or replace function public._f01c_reconocer_solas(p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c       record;
  v_salida  jsonb := '[]'::jsonb;
begin
  for v_c in select * from public._f01c_candidatas(p_account) c where (c.comparacion->>'identica')::boolean loop
    begin
      v_salida := v_salida || public._f01c_unir(p_account, v_c.org, v_c.nombre, (v_c.comparacion->>'brand_id')::uuid, 'sola',
                                                v_c.comparacion, null, null);
    exception when others then
      v_salida := v_salida || jsonb_build_object('nombre_last', v_c.nombre, 'error', sqlerrm);
    end;
  end loop;
  return v_salida;
end $$;
revoke all on function public._f01c_reconocer_solas(uuid) from public, anon, authenticated;

-- ── 8. Marcas › Revisar (tablero 4) ─────────────────────────────────────────
create or replace function public.f01_marcas_por_revisar(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    return jsonb_build_object('preguntas', '[]'::jsonb, 'reconocidas', '[]'::jsonb, 'sin_marca', '[]'::jsonb);
  end if;
  select jsonb_build_object(
    'preguntas', (select coalesce(jsonb_agg(jsonb_build_object(
                    'org', c.org, 'nombre', c.nombre, 'cuenta_last', c.cuenta_last, 'estado', c.estado,
                    'locales', c.locales, 'canales', c.canales, 'comparacion', c.comparacion,
                    'ventas', public._f01c_ventas_esperando(p_account, c.org, c.nombre))
                  order by c.nombre), '[]'::jsonb)
                    from public._f01c_candidatas(p_account) c
                   where (c.comparacion->>'parecida')::boolean or (c.comparacion->>'identica')::boolean),
    'reconocidas', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', r.id, 'como', r.como, 'nombre_last', r.external_brand_name, 'brand_id', r.brand_id,
                      'marca', b.name, 'locales', r.locales, 'ventas', r.ventas, 'comparacion', r.comparacion,
                      'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                      from public.f01_marca_reconocida r join public.brand b on b.id = r.brand_id
                     where r.account_id = p_account and r.visto_at is null and r.como in ('sola', 'codigo_nuevo')),
    -- Ninguna venta sin marca en silencio: todas las de Last sin marca, por su
    -- código, salvo los códigos que alguien ha decidido ignorar.
    'sin_marca', (select coalesce(jsonb_agg(jsonb_build_object(
                    'codigo', g.codigo, 'local', g.local, 'marca_last', g.marca_last, 'ventas', g.n,
                    'primera', g.primera, 'ultima', g.ultima) order by g.ultima desc), '[]'::jsonb)
                    from (select s.external_brand_text as codigo,
                                 (select l.name from public.external_location_map lm join public.locations l on l.id = lm.location_id
                                   where lm.account_id = p_account and lm.source = 'lastapp' and lm.external_location_id = s.external_location_text
                                   limit 1) as local,
                                 (select btrim(e.external_brand_name) from public.external_catalog_product e
                                   where e.account_id = p_account and e.source = 'lastapp' and e.external_brand_id = s.external_brand_text
                                   order by e.seen_in_catalog_at desc limit 1) as marca_last,
                                 count(*) as n, min(s.sold_at) as primera, max(s.sold_at) as ultima
                            from public.sale s
                           where s.account_id = p_account and s.source = 'lastapp' and s.brand_id is null
                             and not exists (select 1 from public.external_brand_map m
                                              where m.account_id = p_account and m.source = 'lastapp' and m.is_ignored
                                                and m.external_brand_id = s.external_brand_text
                                                and m.external_location_id = s.external_location_text)
                           group by s.external_brand_text, s.external_location_text) g),
    'corte', (select max(ic.closed_at) from public.inventory_count ic
               where ic.account_id = p_account and ic.status in ('aprobado', 'en_revision')))
  into v;
  return v;
end $$;
revoke all on function public.f01_marcas_por_revisar(uuid) from public, anon;
grant execute on function public.f01_marcas_por_revisar(uuid) to authenticated;

-- «Sí, es <marca>» o «No, es otra marca».
create or replace function public.f01_decidir_marca(p_account uuid, p_org uuid, p_nombre text, p_brand uuid, p_es boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c     record;
  v_quien text;
  r       jsonb;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Decidir de quién es una marca de Last es cosa de quien administra la cuenta.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.brand b where b.id = p_brand and b.account_id = p_account and b.archived_at is null) then
    raise exception 'Esa marca no es de esta cuenta.' using errcode = 'P0002';
  end if;
  select * into v_c from public._f01c_candidatas(p_account) c where c.org = p_org and c.nombre = btrim(p_nombre);
  if v_c.org is null then
    raise exception '«%» ya no está pendiente en Last.', btrim(p_nombre) using errcode = 'P0002';
  end if;
  v_quien := public._f01b_quien(p_account);
  if p_es then
    r := public._f01c_unir(p_account, p_org, p_nombre, p_brand, 'confirmada', v_c.comparacion, auth.uid(), v_quien);
  else
    insert into public.f01_marca_reconocida (account_id, source, external_org_id, external_brand_name, brand_id, como,
                                             comparacion, locales, created_by, created_by_name, visto_at, visto_por)
    values (p_account, 'lastapp', p_org, btrim(p_nombre), p_brand, 'otra', coalesce(v_c.comparacion, '{}'::jsonb) - 'cartas',
            v_c.locales, auth.uid(), v_quien, now(), v_quien);
    r := jsonb_build_object('como', 'otra', 'nombre_last', btrim(p_nombre), 'brand_id', p_brand,
                            'marca', (select b.name from public.brand b where b.id = p_brand), 'locales', v_c.locales,
                            'org', p_org);
  end if;
  return r;
end $$;
revoke all on function public.f01_decidir_marca(uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.f01_decidir_marca(uuid, uuid, text, uuid, boolean) to authenticated;

-- «Entendido» en el aviso de lo que Folvy hizo solo.
create or replace function public.f01_aviso_visto(p_account uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_account is null or not (public.current_user_is_admin() or public.current_user_is_admin_of(p_account)) then
    raise exception 'Este aviso es de quien administra la cuenta.' using errcode = '42501';
  end if;
  update public.f01_marca_reconocida set visto_at = now(), visto_por = public._f01b_quien(p_account)
   where id = p_id and account_id = p_account and visto_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('vistos', v_n);
end $$;
revoke all on function public.f01_aviso_visto(uuid, uuid) from public, anon;
grant execute on function public.f01_aviso_visto(uuid, uuid) to authenticated;
