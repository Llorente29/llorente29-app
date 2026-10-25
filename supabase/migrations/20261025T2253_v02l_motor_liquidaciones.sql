-- supabase/migrations/20261025T2253_v02l_motor_liquidaciones.sql
--
-- V02 · Entrega 2 · EL MOTOR DE LIQUIDACIONES, CON CUATRO PIEZAS (Julio, 25/10).
-- Para cualquier intermediario que cobra por ti y te descuenta una comisión:
-- Uber, Glovo y Just Eat en hostelería; el datáfono, Amazon, Stripe o PayPal en
-- cualquier empresa. Esta migración SOLO AÑADE (tablas, columnas que admiten
-- vacío, funciones nuevas) y se puede pasar dos veces seguidas. Lo que cambia
-- en caliente va en la 2254.
--
-- Se construye encima de lo que hay, sin duplicarlo:
--   · channel_settlement y sus tiendas (platform_store, D01; el local por su
--     dirección, la 2031 del V01);
--   · el cobro de la liquidación y las facturas que cobra (channel_settlement_
--     collect, bank_casar y _conta_liquidacion_cobros, PC01): el motor solo LEE
--     lo que hacen;
--   · cuándo paga cada plataforma (party_role.settlement_every,
--     payout_days_after y payout_margin_days, PC01);
--   · cómo se resuelve una diferencia (conta_liquidacion_resolucion, V01).
--
-- Lo nuevo:
--   1. Las tiendas se reconocen por su ID de la plataforma, nunca por su nombre
--      ni por su dirección (Julio, notas de tiendas). platform_store.external_id
--      ya existía (vacío en las 9 de Foodint: el correo de Uber no lo trae);
--      platform_store_alias guarda cada nombre con el que ha llegado una tienda,
--      para reconocer por el nombre lo que no trae ID (el correo de Uber y el de
--      Just Eat) una vez que se sabe de qué tienda es.
--   2. La marca y el local de una tienda, con fecha (platform_store_tramo). Una
--      tienda que cambia de marca o de local abre un tramo nuevo desde ese día:
--      lo vendido antes se queda con la marca y el local que tenía.
--   3. Si una tienda cambia de nombre o de dirección, Sumied no la reasigna:
--      apunta el cambio (platform_store_cambio) con la marca y el local que
--      propone, y una persona lo confirma con un clic.
--   4. Lo reclamado se recuerda hasta que llega
--      (conta_liquidacion_resolucion.arrived_on y compañía), y una diferencia de
--      un intermediario sin canal de venta (Stripe…) se resuelve igual (party_id).
--   5. Qué intermediario cobra las facturas que se emiten con un método de
--      cobro (payment_method.party_id): «lo vendido» de quien no tiene cierres
--      del día son sus facturas.
--   6. Las funciones:
--        · conta_tienda_en: la marca y el local de una tienda un día;
--        · conta_tienda_reconocer: la tienda de un documento, por su ID (y si no
--          lo trae, por un nombre ya visto); aprende el ID; apunta los cambios;
--        · conta_tienda_cambio_decidir: confirmar (o descartar) un cambio de
--          tienda, desde el día que se diga;
--        · conta_intermediario_asegurar: quien te paga se da de alta solo con su
--          primera liquidación, con su calendario (el de su plataforma, si se
--          conoce) y el margen de 5 días;
--        · conta_liquidacion_apuntar: «Apuntar a mano» (periodo, lo vendido, la
--          comisión y lo cobrado), que se cuadra igual que lo que llega solo;
--        · conta_liquidacion_resolver: resolver una diferencia en una frase
--          («Es un gasto» o «Lo reclamo») para cualquier intermediario;
--        · conta_reclamacion_llegada: lo reclamado ha llegado;
--        · _conta_liquidacion_factura_enganchar: la factura de comisión que dice
--          su número en la liquidación se engancha sola (la 2254 pone el
--          disparador de supplier_invoice que la llama al llegar la factura);
--        · conta_liquidaciones: EL MOTOR. Una fila por intermediario, local y
--          periodo con sus cuatro piezas (lo vendido, la liquidación, la factura
--          de comisión y el cobro), su estado y la frase que lo explica:
--            Cuadra (y cerrada) · Esperando liquidación · Falta su liquidación ·
--            Falta su factura · Esperando el cobro · Diferencia de N €.
--          También las filas de los periodos en que hubo ventas y no ha llegado
--          la liquidación (regla 7: un umbral ordena, no esconde).
--
-- No toca ninguna fila que exista: siembra las tablas nuevas (un nombre y un
-- tramo por tienda, desde siempre, con la marca y el local de hoy). No está en
-- el camino del pedido: nada de esto escribe en sale ni lo lee al cerrar una
-- venta. Folvy no pierde nada: platform_store sigue diciendo la marca y el local
-- de hoy, como lee channel_economics_dashboard.
--
-- Vuelta atrás: supabase/vuelta-atras/20261025T2253_v02l_motor_liquidaciones.down.sql

-- 1 · Los nombres con los que ha llegado cada tienda ---------------------------------------------
create table if not exists public.platform_store_alias (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  company_id     uuid not null references public.company(id) on delete cascade,
  store_id       uuid not null references public.platform_store(id) on delete cascade,
  provider       text not null,
  texto          text not null check (btrim(texto) <> ''),
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
comment on table public.platform_store_alias is
  'V02 · E2. Cada nombre con el que una plataforma ha llamado a una tienda («Marca (dirección)»). Sirve para reconocer lo que no trae el ID de la tienda (el correo de Uber o el de Just Eat). La identidad de la tienda es su ID (platform_store.external_id), nunca su nombre.';
create unique index if not exists platform_store_alias_uq on public.platform_store_alias (account_id, company_id, provider, lower(btrim(texto)));
create index if not exists platform_store_alias_tienda_idx on public.platform_store_alias (store_id);
alter table public.platform_store_alias enable row level security;
revoke all on public.platform_store_alias from public, anon, authenticated;
grant select on public.platform_store_alias to authenticated;
drop policy if exists platform_store_alias_leer on public.platform_store_alias;
create policy platform_store_alias_leer on public.platform_store_alias for select to authenticated using (public.belongs_to_account(account_id));

-- 2 · La marca y el local de cada tienda, con fecha ------------------------------------------
create table if not exists public.platform_store_tramo (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  store_id         uuid not null references public.platform_store(id) on delete cascade,
  brand_id         uuid references public.brand(id) on delete set null,
  location_id      uuid references public.locations(id) on delete set null,
  -- Vacío: desde siempre. valid_to vacío: hasta hoy (el tramo vigente).
  valid_from       date,
  valid_to         date,
  motivo           text,
  created_at       timestamptz not null default now(),
  created_by_name  text,
  check (valid_from is null or valid_to is null or valid_to >= valid_from)
);
comment on table public.platform_store_tramo is
  'V02 · E2. La marca y el local de una tienda de plataforma, por tramos de fechas (vacío: desde siempre / hasta hoy). Lo vendido un día es de la marca y el local del tramo de ese día; un cambio abre un tramo nuevo y lo de antes no se mueve. platform_store guarda el de hoy.';
create index if not exists platform_store_tramo_tienda_idx on public.platform_store_tramo (store_id, valid_from);
create unique index if not exists platform_store_tramo_vigente_uq on public.platform_store_tramo (store_id) where valid_to is null;
alter table public.platform_store_tramo enable row level security;
revoke all on public.platform_store_tramo from public, anon, authenticated;
grant select on public.platform_store_tramo to authenticated;
drop policy if exists platform_store_tramo_leer on public.platform_store_tramo;
create policy platform_store_tramo_leer on public.platform_store_tramo for select to authenticated using (public.belongs_to_account(account_id));

-- 3 · Los cambios de una tienda, por confirmar --------------------------------------------------
create table if not exists public.platform_store_cambio (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  store_id         uuid not null references public.platform_store(id) on delete cascade,
  kind             text not null check (kind in ('nombre', 'direccion')),
  antes            text,
  ahora            text not null,
  -- Lo que propone Sumied: {"marca": uuid|null, "local": uuid|null, "desde": date}.
  propuesta        jsonb not null default '{}'::jsonb,
  settlement_id    uuid references public.channel_settlement(id) on delete set null,
  detected_at      timestamptz not null default now(),
  decided_at       timestamptz,
  decision         text check (decision is null or decision in ('confirmado', 'descartado')),
  decided_by       uuid,
  decided_by_name  text,
  check ((decided_at is null) = (decision is null))
);
comment on table public.platform_store_cambio is
  'V02 · E2. Una tienda (la misma por su ID) que llega con otro nombre o en otra dirección. Sumied no la reasigna sola: propone la marca y el local y una persona lo confirma (conta_tienda_cambio_decidir). Lo de antes no se mueve.';
create unique index if not exists platform_store_cambio_abierto_uq on public.platform_store_cambio (store_id, kind, lower(btrim(ahora))) where decided_at is null;
alter table public.platform_store_cambio enable row level security;
revoke all on public.platform_store_cambio from public, anon, authenticated;
grant select on public.platform_store_cambio to authenticated;
drop policy if exists platform_store_cambio_leer on public.platform_store_cambio;
create policy platform_store_cambio_leer on public.platform_store_cambio for select to authenticated using (public.belongs_to_account(account_id));

-- La siembra: un nombre y un tramo por tienda (desde siempre, con la marca y el local de hoy).
insert into public.platform_store_alias (account_id, company_id, store_id, provider, texto, first_seen_at, last_seen_at)
select s.account_id, s.company_id, s.id, s.provider, btrim(s.external_text), s.first_seen_at, s.last_seen_at
  from public.platform_store s
 where btrim(coalesce(s.external_text, '')) <> ''
on conflict do nothing;
insert into public.platform_store_tramo (account_id, store_id, brand_id, location_id, valid_from, valid_to, motivo, created_by_name)
select s.account_id, s.id, s.brand_id, s.location_id, null, null, 'La de antes del V02: desde siempre.', 'Sumied · V02'
  from public.platform_store s
 where not exists (select 1 from public.platform_store_tramo t where t.store_id = s.id);

-- 4 · Lo reclamado, hasta que llega; y la diferencia de cualquier intermediario --------------
alter table public.conta_liquidacion_resolucion add column if not exists party_id uuid references public.party(id) on delete set null;
alter table public.conta_liquidacion_resolucion add column if not exists arrived_on date;
alter table public.conta_liquidacion_resolucion add column if not exists arrived_amount numeric(12, 2);
alter table public.conta_liquidacion_resolucion add column if not exists arrived_note text;
alter table public.conta_liquidacion_resolucion add column if not exists arrived_by_name text;
comment on column public.conta_liquidacion_resolucion.party_id is 'V02 · E2. El intermediario (Contactos) de la diferencia: el que no tiene canal de venta (Stripe, Amazon…) se resuelve por aquí.';
comment on column public.conta_liquidacion_resolucion.arrived_on is 'V02 · E2. Lo reclamado llegó este día (vacío: se sigue recordando).';

-- 5 · El intermediario que cobra las facturas de un método de cobro ------------------------------
alter table public.payment_method add column if not exists party_id uuid references public.party(id) on delete set null;
comment on column public.payment_method.party_id is 'V02 · E2. El intermediario que cobra las facturas emitidas con este método (Stripe, PayPal, Amazon, el datáfono…). Sus facturas son «lo vendido» de sus liquidaciones.';

-- 6 · Las funciones -------------------------------------------------------------------------------

-- La marca y el local de una tienda un día (el tramo que lo cubre; si no hay
-- tramos, los de la tienda). p_dia vacío: los de hoy.
create or replace function public.conta_tienda_en(p_store uuid, p_dia date)
returns table (brand_id uuid, location_id uuid)
language sql stable security definer set search_path = public as $$
  select coalesce(t.brand_id, case when t.id is null then s.brand_id end), coalesce(t.location_id, case when t.id is null then s.location_id end)
    from public.platform_store s
    left join lateral (
      select x.* from public.platform_store_tramo x
       where x.store_id = s.id
         and (p_dia is null and x.valid_to is null
              or p_dia is not null and (x.valid_from is null or x.valid_from <= p_dia) and (x.valid_to is null or x.valid_to >= p_dia))
       order by x.valid_from desc nulls last limit 1) t on true
   where s.id = p_store
$$;
revoke all on function public.conta_tienda_en(uuid, date) from public, anon;
grant execute on function public.conta_tienda_en(uuid, date) to authenticated, service_role;
comment on function public.conta_tienda_en(uuid, date) is 'V02 · E2. La marca y el local de una tienda de plataforma un día, por sus tramos con fecha.';

-- La dirección de «Marca (dirección)»: lo de los últimos paréntesis, hasta la primera coma.
create or replace function public._conta_tienda_direccion(p_texto text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(split_part(coalesce(substring(p_texto from '\(([^()]*)\)\s*$'), ''), ',', 1)), '')
$$;
-- La marca de «Marca (dirección)»: lo de antes de los últimos paréntesis.
create or replace function public._conta_tienda_nombre(p_texto text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(coalesce(p_texto, ''), '\s*\([^()]*\)\s*$', '')), '')
$$;

-- La tienda de un documento. Por su ID, si lo trae (y si no, por un nombre ya
-- visto). Si es nueva, se crea sin marca (el local sale de su dirección: la
-- 2031). Si la del ID llega con otro nombre o en otra dirección, se apunta el
-- cambio para confirmarlo y la tienda sigue como estaba. Si la del nombre no
-- tenía ID y ahora llega con él, se aprende.
--   p_canal: el canal de venta de la plataforma, si se sabe.
-- Devuelve {tienda_id, nueva, aprendido_id, cambio}.
create or replace function public.conta_tienda_reconocer(p_company uuid, p_provider text, p_id text, p_texto text, p_canal uuid default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_prov text := lower(btrim(coalesce(p_provider, ''))); v_id text := nullif(btrim(coalesce(p_id, '')), '');
  v_texto text := nullif(btrim(coalesce(p_texto, '')), ''); v_s public.platform_store; v_por_nombre public.platform_store;
  v_nueva boolean := false; v_aprendido boolean := false; v_cambio uuid; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Sumied · liquidaciones');
  v_kind text; v_antes text; v_loc uuid; v_t record;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta registra liquidaciones.' using errcode = '42501';
  end if;
  if v_prov = '' then raise exception 'Falta de qué plataforma es la tienda.' using errcode = '22023'; end if;
  if v_id is null and v_texto is null then raise exception 'El documento no dice de qué tienda es.' using errcode = '22023'; end if;

  if v_id is not null then
    select * into v_s from public.platform_store where account_id = v_acc and company_id = p_company and provider = v_prov and external_id = v_id;
  end if;
  if v_texto is not null then
    select s.* into v_por_nombre from public.platform_store_alias a join public.platform_store s on s.id = a.store_id
     where a.account_id = v_acc and a.company_id = p_company and a.provider = v_prov and lower(btrim(a.texto)) = lower(v_texto) limit 1;
    if v_por_nombre.id is null then
      select * into v_por_nombre from public.platform_store
       where account_id = v_acc and company_id = p_company and provider = v_prov and lower(btrim(external_text)) = lower(v_texto);
    end if;
  end if;

  if v_s.id is null and v_por_nombre.id is not null and (v_id is null or v_por_nombre.external_id is null) then
    -- La del nombre: si llega con un ID que no tenía, se aprende.
    v_s := v_por_nombre;
    if v_id is not null then
      update public.platform_store set external_id = v_id, last_seen_at = now() where id = v_s.id returning * into v_s;
      v_aprendido := true;
    else
      update public.platform_store set last_seen_at = now() where id = v_s.id returning * into v_s;
    end if;
  elsif v_s.id is null then
    -- Nueva: sin marca; el local, por su dirección (el disparador de la 2031).
    -- Si su nombre ya es el de otra tienda con otro ID, el nombre se guarda con el ID detrás.
    insert into public.platform_store (account_id, company_id, provider, external_text, external_id, channel_id, created_by_name)
    values (v_acc, p_company, v_prov,
            case when v_texto is null then v_prov || ' · ' || v_id
                 when exists (select 1 from public.platform_store where account_id = v_acc and company_id = p_company and provider = v_prov and lower(btrim(external_text)) = lower(v_texto))
                   then v_texto || ' · ' || v_id
                 else v_texto end,
            v_id, p_canal, v_quien)
    returning * into v_s;
    insert into public.platform_store_tramo (account_id, store_id, brand_id, location_id, valid_from, motivo, created_by_name)
    values (v_acc, v_s.id, v_s.brand_id, v_s.location_id, null, 'Tienda nueva: desde siempre.', v_quien);
    v_nueva := true;
  else
    update public.platform_store set last_seen_at = now() where id = v_s.id returning * into v_s;
    -- La misma tienda (por su ID) con otro nombre o en otra dirección: se apunta, no se reasigna.
    if v_texto is not null and not exists (select 1 from public.platform_store_alias a where a.store_id = v_s.id and lower(btrim(a.texto)) = lower(v_texto))
       and lower(btrim(v_s.external_text)) <> lower(v_texto) then
      v_antes := v_s.external_text;
      v_kind := case when public.conta_clave_direccion(public._conta_tienda_direccion(v_texto)) is distinct from public.conta_clave_direccion(public._conta_tienda_direccion(v_antes))
                     then 'direccion' else 'nombre' end;
      v_loc := case when v_kind = 'direccion' then public.conta_local_de_tienda(v_acc, v_texto) else v_s.location_id end;
      insert into public.platform_store_cambio (account_id, company_id, store_id, kind, antes, ahora, propuesta)
      values (v_acc, p_company, v_s.id, v_kind, v_antes, v_texto,
              jsonb_build_object('marca', case when v_kind = 'nombre' then null else v_s.brand_id end, 'local', v_loc, 'desde', public.conta_hoy()))
      on conflict do nothing
      returning id into v_cambio;
      if v_cambio is null then
        select id into v_cambio from public.platform_store_cambio where store_id = v_s.id and kind = v_kind and lower(btrim(ahora)) = lower(v_texto) and decided_at is null;
      end if;
    end if;
  end if;

  if v_texto is not null then
    insert into public.platform_store_alias (account_id, company_id, store_id, provider, texto)
    values (v_acc, p_company, v_s.id, v_prov, v_texto)
    on conflict (account_id, company_id, provider, lower(btrim(texto))) do nothing;
    update public.platform_store_alias set last_seen_at = now() where store_id = v_s.id and lower(btrim(texto)) = lower(v_texto);
  end if;
  if v_s.channel_id is null and p_canal is not null then
    update public.platform_store set channel_id = p_canal where id = v_s.id returning * into v_s;
  end if;
  return jsonb_build_object('tienda_id', v_s.id, 'nueva', v_nueva, 'aprendido_id', v_aprendido, 'cambio', v_cambio);
end $$;
revoke all on function public.conta_tienda_reconocer(uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.conta_tienda_reconocer(uuid, text, text, text, uuid, text) to authenticated, service_role;
comment on function public.conta_tienda_reconocer(uuid, text, text, text, uuid, text) is 'V02 · E2. La tienda de un documento: por su ID de la plataforma (o, si no lo trae, por un nombre ya visto). Aprende el ID; si la tienda llega con otro nombre o en otra dirección, apunta el cambio para confirmarlo.';

-- Confirmar (o descartar) un cambio de tienda. Confirmar abre un tramo nuevo
-- desde p_desde con la marca y el local que se digan (los propuestos si no se
-- dicen); lo vendido antes se queda con los de antes: sus liquidaciones sin
-- marca o sin local la toman de su tramo. El nombre nuevo pasa a ser el de la tienda.
create or replace function public.conta_tienda_cambio_decidir(p_cambio uuid, p_confirmar boolean, p_marca uuid default null, p_local uuid default null,
                                                             p_desde date default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.platform_store_cambio; v_s public.platform_store; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor());
  v_desde date; v_marca uuid; v_local uuid; v_n int := 0; v_t record; v_texto text;
begin
  select * into v_c from public.platform_store_cambio where id = p_cambio for update;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then raise exception 'Ese cambio no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_c.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta confirma los cambios de las tiendas.' using errcode = '42501';
  end if;
  if v_c.decided_at is not null then raise exception 'Ese cambio ya está decidido.' using errcode = '23505'; end if;
  select * into v_s from public.platform_store where id = v_c.store_id for update;
  if not coalesce(p_confirmar, false) then
    update public.platform_store_cambio set decided_at = now(), decision = 'descartado', decided_by = auth.uid(), decided_by_name = v_quien where id = v_c.id;
    return jsonb_build_object('cambio', v_c.id, 'decision', 'descartado',
      'texto', 'Descartado: «' || coalesce(v_s.external_text, '') || '» sigue con su marca y su local.');
  end if;
  v_desde := coalesce(p_desde, (v_c.propuesta->>'desde')::date, public.conta_hoy());
  v_marca := coalesce(p_marca, nullif(v_c.propuesta->>'marca', '')::uuid);
  v_local := coalesce(p_local, nullif(v_c.propuesta->>'local', '')::uuid);
  if v_marca is not null and not exists (select 1 from public.brand where id = v_marca and account_id = v_c.account_id) then raise exception 'Esa marca no es de esta cuenta.' using errcode = '22023'; end if;
  if v_local is not null and not exists (select 1 from public.locations where id = v_local and account_id = v_c.account_id) then raise exception 'Ese local no es de esta cuenta.' using errcode = '22023'; end if;
  -- Lo de antes no se mueve: las liquidaciones de la tienda que empiezan antes y aún
  -- no dicen marca o local se quedan con las de su tramo.
  for v_t in select cs.id, (public.conta_tienda_en(v_s.id, cs.period_from)).* from public.channel_settlement cs
              where cs.store_id = v_s.id and cs.account_id = v_s.account_id and coalesce(cs.period_from, cs.settlement_date) < v_desde
                and (cs.brand_id is null or cs.location_id is null) loop
    update public.channel_settlement set brand_id = coalesce(brand_id, v_t.brand_id), location_id = coalesce(location_id, v_t.location_id), updated_at = now()
     where id = v_t.id;
    v_n := v_n + 1;
  end loop;
  -- El tramo vigente se cierra la víspera y se abre el nuevo.
  update public.platform_store_tramo set valid_to = v_desde - 1
   where store_id = v_s.id and valid_to is null and (valid_from is null or valid_from < v_desde);
  delete from public.platform_store_tramo where store_id = v_s.id and valid_from >= v_desde;
  insert into public.platform_store_tramo (account_id, store_id, brand_id, location_id, valid_from, motivo, created_by_name)
  values (v_s.account_id, v_s.id, v_marca, v_local, v_desde,
          case v_c.kind when 'direccion' then 'Cambió de dirección: ' else 'Cambió de nombre: ' end || coalesce(v_c.antes, '') || ' → ' || v_c.ahora, v_quien);
  v_texto := v_c.ahora;
  if exists (select 1 from public.platform_store where account_id = v_s.account_id and company_id = v_s.company_id and provider = v_s.provider
                and id <> v_s.id and lower(btrim(external_text)) = lower(btrim(v_texto))) then
    v_texto := v_texto || ' · ' || coalesce(v_s.external_id, left(v_s.id::text, 8));
  end if;
  update public.platform_store set external_text = v_texto, brand_id = v_marca, location_id = v_local,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_quien
   where id = v_s.id;
  update public.platform_store_cambio set decided_at = now(), decision = 'confirmado', decided_by = auth.uid(), decided_by_name = v_quien,
         propuesta = propuesta || jsonb_build_object('marca', v_marca, 'local', v_local, 'desde', v_desde)
   where id = v_c.id;
  return jsonb_build_object('cambio', v_c.id, 'decision', 'confirmado', 'desde', v_desde, 'liquidaciones_de_antes', v_n,
    'texto', 'Confirmado desde el ' || to_char(v_desde, 'DD/MM/YYYY') || ': «' || v_c.ahora || '»' ||
             coalesce(' es de ' || (select name from public.brand where id = v_marca), '') ||
             coalesce(' en ' || (select name from public.locations where id = v_local), '') || '. ' ||
             case when v_n = 0 then 'Lo de antes no se mueve.'
                  else 'Lo de antes no se mueve: ' || v_n || ' liquidaci' || case when v_n = 1 then 'ón se queda' else 'ones se quedan' end || ' con su marca y su local de entonces.' end);
end $$;
revoke all on function public.conta_tienda_cambio_decidir(uuid, boolean, uuid, uuid, date, text) from public, anon;
grant execute on function public.conta_tienda_cambio_decidir(uuid, boolean, uuid, uuid, date, text) to authenticated;
comment on function public.conta_tienda_cambio_decidir(uuid, boolean, uuid, uuid, date, text) is 'V02 · E2. Confirmar con un clic (o descartar) un cambio de nombre o de dirección de una tienda: tramo nuevo desde ese día; lo de antes no se mueve.';

-- El papel de intermediario de una plataforma (Contactos), y si no lo hay, se
-- da de alta con su primera liquidación: el contacto (por su NIF, si ya está;
-- si no, nuevo) y su papel, con el calendario que se conoce de su plataforma
-- (Uber: cada semana, 1 día; Glovo: cada quincena, 20 días; Just Eat: cada
-- quincena, 4 días; los dio Julio el 25/10, PC01) o sin calendario, y el
-- margen de 5 días (vacío). Devuelve el id del papel (party_role).
create or replace function public.conta_intermediario_asegurar(p_company uuid, p_provider text, p_canal uuid default null, p_nombre text default null,
                                                              p_nif text default null, p_quien_nombre text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_prov text := lower(btrim(coalesce(p_provider, ''))); v_r public.party_role; v_party uuid; v_nombre text; v_cada text; v_dias int;
  v_nif text := nullif(upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')), '');
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta da de alta a quien le paga.' using errcode = '42501';
  end if;
  if p_canal is not null then
    select * into v_r from public.party_role where account_id = v_acc and role = 'platform' and channel_id = p_canal order by created_at limit 1;
    if v_r.id is not null then return v_r.id; end if;
  end if;
  if v_nif is not null then
    select pr.* into v_r from public.party_role pr join public.party p on p.id = pr.party_id
     where pr.account_id = v_acc and pr.role = 'platform' and upper(regexp_replace(coalesce(p.tax_id, ''), '[^A-Za-z0-9]', '', 'g')) = v_nif
     order by pr.created_at limit 1;
    if v_r.id is not null then
      if v_r.channel_id is null and p_canal is not null then update public.party_role set channel_id = p_canal where id = v_r.id; end if;
      return v_r.id;
    end if;
  end if;
  v_nombre := coalesce(nullif(btrim(p_nombre), ''), case v_prov when 'uber' then 'Uber Eats' when 'glovo' then 'Glovo' when 'justeat' then 'Just Eat' else initcap(v_prov) end);
  if p_canal is null and v_nif is null then
    select pr.* into v_r from public.party_role pr join public.party p on p.id = pr.party_id
     where pr.account_id = v_acc and pr.role = 'platform' and lower(btrim(p.name)) = lower(v_nombre) order by pr.created_at limit 1;
    if v_r.id is not null then return v_r.id; end if;
  end if;
  if v_nif is not null then
    select id into v_party from public.party where account_id = v_acc and archived_at is null
       and upper(regexp_replace(coalesce(tax_id, ''), '[^A-Za-z0-9]', '', 'g')) = v_nif order by created_at limit 1;
  end if;
  if v_party is null then
    insert into public.party (account_id, name, tax_id, source, created_by, created_by_name)
    -- source: los valores de party_source_check (manual, supplier, migrated, ticket); quién lo dio de alta va en created_by_name.
    values (v_acc, v_nombre, v_nif, 'manual', auth.uid(), 'Sumied · su primera liquidación' || coalesce(' (' || nullif(btrim(p_quien_nombre), '') || ')', ''))
    returning id into v_party;
  end if;
  select cada, dias into v_cada, v_dias from (values ('uber', 'weekly', 1), ('glovo', 'fortnightly', 20), ('justeat', 'fortnightly', 4)) k(prov, cada, dias) where k.prov = v_prov;
  insert into public.party_role (account_id, party_id, role, channel_id, settlement_every, payout_days_after, created_by)
  values (v_acc, v_party, 'platform', p_canal, v_cada, v_dias, auth.uid())
  returning * into v_r;
  return v_r.id;
end $$;
revoke all on function public.conta_intermediario_asegurar(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.conta_intermediario_asegurar(uuid, text, uuid, text, text, text) to authenticated, service_role;
comment on function public.conta_intermediario_asegurar(uuid, text, uuid, text, text, text) is 'V02 · E2. El papel de intermediario (party_role platform) de quien te paga; si no lo hay, lo da de alta con su primera liquidación, con el calendario de su plataforma si se conoce.';

-- El intermediario de una liquidación: el suyo (party_id) o el de su canal.
create or replace function public._conta_intermediario_de(p_account uuid, p_party uuid, p_canal uuid)
returns uuid language sql stable set search_path = public as $$
  select coalesce(
    (select r.id from public.party_role r where r.account_id = p_account and r.role = 'platform' and r.party_id = p_party order by (r.channel_id is not distinct from p_canal) desc, r.created_at limit 1),
    (select r.id from public.party_role r where r.account_id = p_account and r.role = 'platform' and r.channel_id = p_canal order by r.created_at limit 1))
$$;

-- La factura de comisión que la liquidación dice por su número se engancha sola:
-- una factura recibida del mismo intermediario (su proveedor en Contactos, o su
-- NIF), con ese número, no anulada ni descartada. Devuelve la factura o vacío.
create or replace function public._conta_liquidacion_factura_enganchar(p_settlement uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cs public.channel_settlement; v_num text; v_rol uuid; v_party uuid; v_nif text; v_inv uuid;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement for update;
  if v_cs.id is null or v_cs.commission_invoice_id is not null then return v_cs.commission_invoice_id; end if;
  v_num := nullif(btrim(coalesce(v_cs.raw->'factura'->>'numero', '')), '');
  if v_num is null then return null; end if;
  v_rol := public._conta_intermediario_de(v_cs.account_id, v_cs.party_id, v_cs.channel_id);
  select party_id into v_party from public.party_role where id = v_rol;
  select upper(regexp_replace(coalesce(tax_id, ''), '[^A-Za-z0-9]', '', 'g')) into v_nif from public.party where id = v_party;
  select si.id into v_inv from public.supplier_invoice si
   where si.account_id = v_cs.account_id and upper(regexp_replace(coalesce(si.invoice_number, ''), '\s', '', 'g')) = upper(regexp_replace(v_num, '\s', '', 'g'))
     and si.status not in ('anulada', 'descartada')
     and (si.supplier_id in (select r.supplier_id from public.party_role r where r.account_id = v_cs.account_id and r.party_id = v_party and r.role = 'supplier' and r.supplier_id is not null)
          or (nullif(v_nif, '') is not null and (upper(regexp_replace(coalesce(si.issuer_tax_id, ''), '[^A-Za-z0-9]', '', 'g')) = v_nif
               or exists (select 1 from public.supplier s where s.id = si.supplier_id and upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')) = v_nif))))
     and not exists (select 1 from public.channel_settlement o where o.commission_invoice_id = si.id and o.id <> v_cs.id)
   order by si.created_at limit 1;
  if v_inv is not null then
    update public.channel_settlement set commission_invoice_id = v_inv, updated_at = now() where id = v_cs.id;
  end if;
  return v_inv;
end $$;
revoke all on function public._conta_liquidacion_factura_enganchar(uuid) from public, anon, authenticated;
comment on function public._conta_liquidacion_factura_enganchar(uuid) is 'V02 · E2. Engancha a la liquidación su factura de comisión (una recibida del mismo intermediario con el número que dice la liquidación). Vacío si aún no ha llegado.';

-- «Apuntar a mano»: periodo, lo vendido, la comisión y lo cobrado (lo que dice
-- que te paga). Para cualquier intermediario; el local, si se dice. Se cuadra
-- igual que lo que llega solo: es una liquidación más (source 'a_mano'), su
-- factura de comisión se espera si hay comisión, y su cobro se casa en Bancos.
--   p: {intermediario (party_role), local, desde, hasta, vendido, comision, cobrado,
--       pedidos, referencia (de la liquidación), factura (su número, si se sabe), nota}
create or replace function public.conta_liquidacion_apuntar(p_company uuid, p jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_r public.party_role; v_nombre text; v_local uuid := nullif(p->>'local', '')::uuid;
  v_desde date := nullif(p->>'desde', '')::date; v_hasta date := nullif(p->>'hasta', '')::date;
  v_vendido numeric := nullif(p->>'vendido', '')::numeric; v_com numeric := coalesce(nullif(p->>'comision', '')::numeric, 0);
  v_cobrado numeric := nullif(p->>'cobrado', '')::numeric; v_id uuid; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor());
  v_clave text; v_inv uuid; v_corte date;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta apunta liquidaciones.' using errcode = '42501';
  end if;
  select * into v_r from public.party_role where id = nullif(p->>'intermediario', '')::uuid and account_id = v_acc and role = 'platform';
  if v_r.id is null then raise exception 'Di quién te paga (un intermediario de Contactos).' using errcode = '22023'; end if;
  select name into v_nombre from public.party where id = v_r.party_id;
  if v_desde is null or v_hasta is null or v_hasta < v_desde then raise exception 'Di el periodo: desde y hasta.' using errcode = '22023'; end if;
  if v_vendido is null then raise exception 'Di lo vendido en el periodo.' using errcode = '22023'; end if;
  if v_com < 0 then raise exception 'La comisión va en positivo: lo que se queda.' using errcode = '22023'; end if;
  if v_cobrado is null then raise exception 'Di lo cobrado: lo que te paga.' using errcode = '22023'; end if;
  if v_local is not null and not exists (select 1 from public.locations where id = v_local and account_id = v_acc) then raise exception 'Ese local no es de esta cuenta.' using errcode = '22023'; end if;
  v_clave := 'a_mano:' || v_r.id::text || ':' || coalesce(v_local::text, 'sin') || ':' || v_desde::text || ':' || v_hasta::text;
  if exists (select 1 from public.channel_settlement where account_id = v_acc and import_key = v_clave) then
    raise exception 'Ya hay una liquidación de % apuntada del % al %: ábrela y corrígela.', coalesce(v_nombre, 'ese intermediario'),
      to_char(v_desde, 'DD/MM'), to_char(v_hasta, 'DD/MM/YYYY') using errcode = '23505';
  end if;
  v_corte := public._conta_corte(p_company);
  insert into public.channel_settlement (account_id, channel_id, party_id, location_id, settlement_ref, period_from, period_to, settlement_date, period_grain,
    orders_count, gross_sales, commission, other_cost, net_payout, source, import_key, raw, needs_review, is_reference, created_by, created_by_name)
  values (v_acc, v_r.channel_id, v_r.party_id, v_local, nullif(btrim(coalesce(p->>'referencia', '')), ''), v_desde, v_hasta, v_hasta,
    case when v_hasta - v_desde = 6 then 'week' when v_hasta - v_desde between 13 and 15 then 'quincena' when v_hasta - v_desde between 27 and 30 then 'mes' else 'periodo' end,
    nullif(p->>'pedidos', '')::int, round(v_vendido, 2), -round(v_com, 2), round(v_vendido - v_com - v_cobrado, 2), round(v_cobrado, 2), 'a_mano', v_clave,
    jsonb_build_object('a_mano', true, 'nota', nullif(btrim(coalesce(p->>'nota', '')), ''),
      'factura', case when v_com > 0 then jsonb_build_object('total', round(v_com, 2), 'numero', nullif(btrim(coalesce(p->>'factura', '')), '')) end),
    false, v_corte is not null and v_hasta < v_corte, auth.uid(), v_quien)
  returning id into v_id;
  v_inv := public._conta_liquidacion_factura_enganchar(v_id);
  return jsonb_build_object('liquidacion_id', v_id, 'factura_id', v_inv,
    'texto', 'Apuntada la liquidación de ' || coalesce(v_nombre, 'tu intermediario') || ' del ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY') ||
             ': vendido ' || public.conta_euros_exactos(v_vendido) || ', comisión ' || public.conta_euros_exactos(v_com) || ', te paga ' || public.conta_euros_exactos(v_cobrado) || '. ' ||
             case when v_corte is not null and v_hasta < v_corte then 'Es de antes del cierre: de referencia, sin factura ni asiento.'
                  when v_com > 0 and v_inv is null then 'Falta su factura de comisión: súbela en Compras y se engancha.'
                  when v_inv is not null then 'Su factura de comisión ya estaba: enganchada.'
                  else 'Sin comisión, no lleva factura.' end);
end $$;
revoke all on function public.conta_liquidacion_apuntar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_liquidacion_apuntar(uuid, jsonb, text) to authenticated;
comment on function public.conta_liquidacion_apuntar(uuid, jsonb, text) is 'V02 · E2. «Apuntar a mano» una liquidación de cualquier intermediario: periodo, lo vendido, la comisión y lo cobrado. Se cuadra igual que lo que llega solo.';

-- Resolver una diferencia en una frase: «Es un gasto» (con su asiento: lo
-- prepara el navegador, la cuenta de gasto contra la 430 del intermediario) o
-- «Lo reclamo» (sin asiento; se recuerda hasta que llegue). Para cualquier
-- intermediario: por su canal, si lo tiene (el mismo sitio que el V01), y su contacto.
create or replace function public.conta_liquidacion_resolver(p_company uuid, p_intermediario uuid, p_local uuid, p_desde date, p_hasta date,
  p_tipo text, p_importe numeric, p_frase text, p_fecha date default null, p_lineas jsonb default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_r public.party_role; v_res jsonb; v_id uuid; v_nombre text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into v_r from public.party_role where id = p_intermediario and account_id = v_acc and role = 'platform';
  if v_r.id is null then raise exception 'Ese intermediario no es de la cuenta.' using errcode = '23514'; end if;
  select name into v_nombre from public.party where id = v_r.party_id;
  if v_r.channel_id is not null then
    -- Con canal: el camino del V01, que valida, hace el asiento y lo guarda.
    v_res := public.conta_plataforma_resolver(p_company, v_r.channel_id, p_local, p_desde, p_hasta, null, p_tipo, p_importe, p_frase, p_fecha, p_lineas, p_quien_nombre);
    update public.conta_liquidacion_resolucion set party_id = v_r.party_id where id = (v_res->>'id')::uuid;
  else
    -- Sin canal (Stripe, Amazon…): lo mismo, por su contacto. channel_id admite
    -- vacío desde la 2254.
    if p_tipo not in ('gasto', 'reclamacion') then raise exception 'Una diferencia se resuelve como gasto o como reclamación.' using errcode = '22023'; end if;
    if btrim(coalesce(p_frase, '')) = '' then raise exception 'Escribe en una frase por qué.' using errcode = '22023'; end if;
    if p_importe is null or p_importe = 0 then raise exception 'La diferencia tiene que tener importe.' using errcode = '22023'; end if;
    if not public.current_user_is_admin_or_manager_of(v_acc) then
      raise exception 'Solo un administrador o un encargado de la cuenta resuelve diferencias.' using errcode = '42501';
    end if;
    if exists (select 1 from public.conta_liquidacion_resolucion x where x.company_id = p_company and x.channel_id is null and x.party_id = v_r.party_id
                  and x.location_id is not distinct from p_local and x.period_from = p_desde and x.period_to = p_hasta and x.sale_id is null) then
      raise exception 'Esa diferencia ya está resuelta.' using errcode = '23505';
    end if;
    if p_tipo = 'gasto' then
      if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then raise exception 'Un gasto lleva su asiento.' using errcode = '22023'; end if;
      v_res := public._journal_entry_proponer(p_company,
        jsonb_build_object('series', 1, 'fecha', coalesce(p_fecha, p_hasta), 'source_type', 'manual',
          'concepto', 'Diferencia de la liquidación de ' || coalesce(v_nombre, 'tu intermediario') || ' (' || to_char(p_desde, 'DD/MM') || '–' || to_char(p_hasta, 'DD/MM/YYYY') || '): ' || btrim(p_frase),
          'confianza', 'seguro', 'porque', 'Diferencia resuelta como gasto en Ventas › Liquidaciones.'),
        p_lineas, null, coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor()), auth.uid());
      v_res := jsonb_build_object('asiento', (v_res->>'id')::uuid, 'numero_asiento',
        public.journal_entry_validar((v_res->>'id')::uuid, coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor()))->'numero');
    else
      v_res := '{}'::jsonb;
    end if;
    insert into public.conta_liquidacion_resolucion (account_id, company_id, channel_id, party_id, location_id, period_from, period_to, kind, importe, frase,
                                                     entry_id, created_by, created_by_name)
    values (v_acc, p_company, null, v_r.party_id, p_local, p_desde, p_hasta, p_tipo, round(p_importe, 2), btrim(p_frase),
            (v_res->>'asiento')::uuid, auth.uid(), coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor()))
    returning id into v_id;
    v_res := v_res || jsonb_build_object('id', v_id);
  end if;
  return v_res || jsonb_build_object('texto',
    case when p_tipo = 'reclamacion' then 'Apuntado: reclamas ' || public.conta_euros_exactos(abs(p_importe)) || ' a ' || coalesce(v_nombre, 'tu intermediario') || '. Te lo recuerdo hasta que llegue.'
         else 'Apuntado como gasto: ' || public.conta_euros_exactos(abs(p_importe)) || coalesce(', asiento ' || (v_res->>'numero_asiento'), '') || '.' end);
end $$;
revoke all on function public.conta_liquidacion_resolver(uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text) from public, anon;
grant execute on function public.conta_liquidacion_resolver(uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text) to authenticated;
comment on function public.conta_liquidacion_resolver(uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text) is 'V02 · E2. Resolver una diferencia de una liquidación en una frase: «Es un gasto» o «Lo reclamo» (se recuerda hasta que llegue).';

-- Lo reclamado ha llegado (o no llegará: se cierra con su nota).
create or replace function public.conta_reclamacion_llegada(p_resolucion uuid, p_fecha date, p_importe numeric default null, p_nota text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_x public.conta_liquidacion_resolucion; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor());
begin
  select * into v_x from public.conta_liquidacion_resolucion where id = p_resolucion for update;
  if v_x.id is null or not public.belongs_to_account(v_x.account_id) then raise exception 'Esa reclamación no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_x.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta cierra una reclamación.' using errcode = '42501';
  end if;
  if v_x.kind <> 'reclamacion' then raise exception 'Eso no es una reclamación.' using errcode = '22023'; end if;
  if v_x.arrived_on is not null then raise exception 'Esa reclamación ya estaba cerrada (el %).', to_char(v_x.arrived_on, 'DD/MM/YYYY') using errcode = '23505'; end if;
  if p_fecha is null then raise exception 'Di el día en que llegó.' using errcode = '22023'; end if;
  update public.conta_liquidacion_resolucion set arrived_on = p_fecha, arrived_amount = coalesce(p_importe, abs(importe)),
         arrived_note = nullif(btrim(coalesce(p_nota, '')), ''), arrived_by_name = v_quien
   where id = v_x.id;
  return jsonb_build_object('id', v_x.id, 'texto', 'Llegó el ' || to_char(p_fecha, 'DD/MM/YYYY') || ': ' ||
    public.conta_euros_exactos(coalesce(p_importe, abs(v_x.importe))) || ' de los ' || public.conta_euros_exactos(abs(v_x.importe)) || ' reclamados. Ya no te lo recuerdo.');
end $$;
revoke all on function public.conta_reclamacion_llegada(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.conta_reclamacion_llegada(uuid, date, numeric, text, text) to authenticated;

-- El periodo de un día para un intermediario: semana de lunes a domingo,
-- quincena del 1 al 15 y del 16 a fin de mes, o el mes (como conta_vence_por_plataforma, PC01).
create or replace function public._conta_periodo_de(p_cada text, p_dia date)
returns daterange language sql immutable set search_path = public as $$
  select case p_cada
    when 'weekly' then daterange(date_trunc('week', p_dia)::date, date_trunc('week', p_dia)::date + 6, '[]')
    when 'fortnightly' then case when extract(day from p_dia) <= 15 then daterange(date_trunc('month', p_dia)::date, date_trunc('month', p_dia)::date + 14, '[]')
                                 else daterange(date_trunc('month', p_dia)::date + 15, (date_trunc('month', p_dia) + interval '1 month')::date - 1, '[]') end
    else daterange(date_trunc('month', p_dia)::date, (date_trunc('month', p_dia) + interval '1 month')::date - 1, '[]')
  end
$$;

-- EL MOTOR ----------------------------------------------------------------------------------
-- Las liquidaciones de la empresa entre p_desde y p_hasta (los periodos que las
-- tocan), una fila por intermediario, local y periodo, con sus cuatro piezas:
--   vendido     · lo que la empresa vendió por él: sus cierres del día (marcas
--                 propias de su canal, ese local y esos días) y las ventas de las
--                 marcas cedidas, que la plataforma también liquida; o, si no
--                 tiene canal, sus facturas emitidas (payment_method.party_id);
--   liquidacion · lo que dice que vendiste, su comisión, lo demás y lo que te paga;
--   factura     · las de comisión que hacen falta y las que faltan;
--   cobro       · lo que llegó al banco (el cobro de channel_settlement_collect y
--                 el casado de bank_casar, del PC01).
-- Y su estado, en este orden:
--   esperando_liquidacion / falta_liquidacion (no ha llegado: aún a tiempo o
--     pasado su día de pago y su margen) · diferencia (algo que no cuadra sin
--     resolver; importe: lo que falta) · falta_factura · esperando_cobro · cuadra
--     (las cuatro piezas: cerrada, salvo que quede algo reclamado por llegar).
-- Tolerancia: 1 céntimo por liquidación (los redondeos de cada una, como el V01).
-- Las de marcas cedidas (flow_type licensed) no son de la empresa: no salen.
-- Las de antes del corte, de referencia: sirven para contrastar y casar el
-- cobro, no llevan factura; los periodos sin liquidación de antes del corte no
-- se piden (eso lo lleva Diez).
create or replace function public.conta_liquidaciones(p_company uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid; v_desde date; v_hasta date; v_hoy date := public.conta_hoy(); v_corte date; v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  v_corte := public._conta_corte(p_company);
  v_hasta := coalesce(p_hasta, v_hoy);
  v_desde := coalesce(p_desde, v_hasta - 92);

  with roles as (
    select r.id as rol, r.party_id, r.channel_id, r.settlement_every as cada, coalesce(r.payout_days_after, 0) as dias,
           coalesce(r.payout_margin_days, 5) as margen, p.name as nombre
      from public.party_role r join public.party p on p.id = r.party_id
     where r.account_id = v_acc and r.role = 'platform'
  ),
  -- Las liquidaciones de la empresa (las de sus tiendas y las que no dicen tienda).
  liq as (
    select cs.*, ps.external_text as tienda,
           coalesce(cs.location_id, (select t.location_id from public.conta_tienda_en(cs.store_id, coalesce(cs.period_from, cs.settlement_date)) t)) as local_id,
           coalesce(cs.period_from, cs.proposed_period_from, cs.settlement_date) as d1,
           coalesce(cs.period_to, cs.proposed_period_to, cs.settlement_date) as d2,
           public._conta_intermediario_de(v_acc, cs.party_id, cs.channel_id) as rol
      from public.channel_settlement cs
      left join public.platform_store ps on ps.id = cs.store_id and ps.account_id = v_acc
     where cs.account_id = v_acc and coalesce(cs.flow_type, 'own') <> 'licensed'
       and (ps.id is null or ps.company_id = p_company)
  ), liq_sel as (
    select * from liq where d1 is not null and d1 <= v_hasta and d2 >= v_desde
  ),
  -- Los periodos con ventas y sin liquidación: de los intermediarios con canal y
  -- calendario, por sus cierres; de los que cobran facturas, por sus facturas.
  dias_venta as (
    select r.rol, d.location_id as local_id, public._conta_periodo_de(r.cada, d.sales_day) as per, d.total
      from roles r join public.sales_day_summary d on d.company_id = p_company and d.channel_id = r.channel_id
      left join public.journal_entry e on e.id = d.entry_id
     where r.channel_id is not null and r.cada is not null and d.sales_day between v_desde and v_hasta
       and coalesce(e.status, 'propuesto') <> 'anulado'
    union all
    select r.rol, ci.location_id, public._conta_periodo_de(coalesce(r.cada, 'monthly'), ci.issue_date), ci.total
      from roles r join public.payment_method pm on pm.party_id = r.party_id and pm.account_id = v_acc
      join public.customer_invoice ci on ci.payment_method_id = pm.id and ci.company_id = p_company and ci.status = 'emitida'
     where ci.issue_date between v_desde and v_hasta
  ), esperados as (
    select rol, local_id, lower(per) as d1, upper(per) - 1 as d2 from dias_venta
     group by rol, local_id, per having sum(total) <> 0
  ),
  grupos as (
    select rol, local_id, d1, d2 from liq_sel group by 1, 2, 3, 4
    union
    select e.rol, e.local_id, e.d1, e.d2 from esperados e
     where (v_corte is null or e.d2 >= v_corte)
       and not exists (select 1 from liq_sel l where l.rol is not distinct from e.rol and l.local_id is not distinct from e.local_id
                         and l.d1 <= e.d2 and l.d2 >= e.d1)
  ),
  filas as (
    select g.*, r.party_id, r.channel_id, r.nombre, r.dias, r.margen, r.cada,
           coalesce(ch.name, r.nombre, 'Intermediario') as canal, l.name as local, l.active as local_abierto,
           -- Lo vendido: cierres de su canal (o sus facturas, sin canal).
           (select jsonb_build_object('total', coalesce(sum(d.total), 0), 'dias', count(distinct d.sales_day),
                                      'por_validar', count(*) filter (where e.status in ('propuesto', 'borrador')))
              from public.sales_day_summary d left join public.journal_entry e on e.id = d.entry_id
             where r.channel_id is not null and g.local_id is not null and d.company_id = p_company and d.channel_id = r.channel_id
               and d.location_id = g.local_id and d.sales_day between g.d1 and g.d2 and coalesce(e.status, 'propuesto') <> 'anulado') as cierres,
           (select jsonb_build_object('total', coalesce(sum(s.total), 0), 'pedidos', count(*))
              from public.sale s join public.brand b on b.id = s.brand_id and b.account_id = v_acc and b.ownership_type = 'licensed'
             where r.channel_id is not null and g.local_id is not null and s.account_id = v_acc and s.channel_id = r.channel_id
               and s.location_id = g.local_id and s.status = 'closed' and coalesce(s.is_active, true)
               and (s.sold_at at time zone 'Europe/Madrid')::date between g.d1 and g.d2) as cedidas,
           (select jsonb_build_object('total', coalesce(sum(ci.total), 0), 'n', count(*))
              from public.payment_method pm join public.customer_invoice ci on ci.payment_method_id = pm.id
             where r.channel_id is null and pm.party_id = r.party_id and pm.account_id = v_acc and ci.company_id = p_company
               and ci.status = 'emitida' and ci.location_id is not distinct from g.local_id and ci.issue_date between g.d1 and g.d2) as facturas_vendidas,
           (select jsonb_agg(jsonb_build_object(
                     'id', s.id, 'tienda', s.tienda, 'ref', s.settlement_ref, 'fecha', s.settlement_date, 'origen', s.source, 'pedidos', s.orders_count,
                     'ventas', coalesce(s.gross_sales, 0), 'comision', abs(coalesce(s.commission, 0)), 'neto', s.net_payout,
                     'cobrado', s.collected_amount, 'cobrado_el', s.collected_on, 'referencia', coalesce(s.is_reference, false),
                     'por_aclarar', case when s.needs_review and not coalesce(s.is_reference, false) then s.review_note end,
                     'a_facturar', nullif((s.raw->'factura'->>'total')::numeric, 0),
                     'factura', case when si.id is not null then jsonb_build_object('id', si.id, 'numero', si.invoice_number, 'total', si.grand_total, 'estado', si.status) end,
                     'casada_en_banco', exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                                                  where i.channel_settlement_id = s.id and b.status = 'vivo'),
                     'facturas_cobradas', s.invoice_match_status, 'facturas_nota', s.invoice_match_note)
                   order by s.d1, s.tienda)
              from liq_sel s left join public.supplier_invoice si on si.id = s.commission_invoice_id and si.account_id = v_acc
             where s.rol is not distinct from g.rol and s.local_id is not distinct from g.local_id and s.d1 = g.d1 and s.d2 = g.d2) as liquidaciones,
           coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.kind, 'importe', x.importe, 'frase', x.frase, 'pedido', x.sale_id,
                                                         'quien', x.created_by_name, 'cuando', x.created_at, 'llego_el', x.arrived_on, 'llego', x.arrived_amount)
                                      order by x.created_at)
                       from public.conta_liquidacion_resolucion x
                      where x.company_id = p_company and x.location_id is not distinct from g.local_id and x.period_from = g.d1 and x.period_to = g.d2
                        and (x.channel_id = r.channel_id or (r.channel_id is null and x.party_id = r.party_id))), '[]'::jsonb) as resoluciones,
           (select jsonb_agg(jsonb_build_object('id', c.id, 'tienda', ps.external_text, 'tipo', c.kind, 'antes', c.antes, 'ahora', c.ahora) order by c.detected_at)
              from public.platform_store_cambio c join public.platform_store ps on ps.id = c.store_id
             where c.company_id = p_company and c.decided_at is null
               and c.store_id in (select s.store_id from liq_sel s where s.rol is not distinct from g.rol and s.local_id is not distinct from g.local_id
                                    and s.d1 = g.d1 and s.d2 = g.d2)) as cambios
      from grupos g
      left join roles r on r.rol = g.rol
      left join public.sales_channel ch on ch.id = r.channel_id and ch.account_id = v_acc
      left join public.locations l on l.id = g.local_id and l.account_id = v_acc
  ),
  cifras as (
    select f.*,
      coalesce(jsonb_array_length(f.liquidaciones), 0) as n_liq,
      (select coalesce(sum((x->>'ventas')::numeric), 0) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_ventas,
      (select coalesce(sum((x->>'comision')::numeric), 0) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_comision,
      (select case when bool_and(x->>'neto' is not null) then sum((x->>'neto')::numeric) end from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_pagan,
      (select case when count(*) filter (where x->>'cobrado' is not null) > 0 then sum((x->>'cobrado')::numeric) end from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_banco,
      (select count(*) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x
        where not (x->>'referencia')::boolean and x->>'cobrado' is null and coalesce((x->>'neto')::numeric, 0) > 0) as por_cobrar,
      (select count(*) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x
        where not (x->>'referencia')::boolean and coalesce((x->>'a_facturar')::numeric, 0) > 0 and x->>'factura' is null) as faltan_facturas,
      (select coalesce(bool_and((x->>'referencia')::boolean), false) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as todo_referencia,
      case when f.channel_id is not null then coalesce((f.cierres->>'total')::numeric, 0) + coalesce((f.cedidas->>'total')::numeric, 0)
           else coalesce((f.facturas_vendidas->>'total')::numeric, 0) end as vendido,
      (f.channel_id is null and coalesce((f.facturas_vendidas->>'n')::int, 0) = 0) as sin_vendido,
      greatest(1, coalesce(jsonb_array_length(f.liquidaciones), 0)) as tol,
      f.d2 + f.dias + f.margen as plazo,
      (select x from jsonb_array_elements(f.resoluciones) x where x->>'pedido' is null limit 1) as resuelta,
      (select coalesce(sum(abs((x->>'importe')::numeric)), 0) from jsonb_array_elements(f.resoluciones) x
        where x->>'tipo' = 'reclamacion' and x->>'llego_el' is null) as reclamado_sin_llegar
      from filas f
  ),
  dif as (
    select c.*,
      case when c.n_liq > 0 and (c.local_id is not null or c.channel_id is null) and not c.sin_vendido and abs(round((c.vendido - c.l_ventas) * 100)) > c.tol
           then round(c.vendido - c.l_ventas, 2) end as dif_ventas,
      case when c.n_liq > 0 and c.l_banco is not null and c.l_pagan is not null and c.por_cobrar = 0 and abs(round((c.l_pagan - c.l_banco) * 100)) > c.tol
           then round(c.l_pagan - c.l_banco, 2) end as dif_cobro
      from cifras c
  ),
  estado as (
    select d.*,
      case
        when d.n_liq = 0 then case when v_hoy > d.plazo then 'falta_liquidacion' else 'esperando_liquidacion' end
        when d.local_id is null and d.channel_id is not null and not d.todo_referencia then 'diferencia'
        when (d.dif_ventas is not null or d.dif_cobro is not null) and d.resuelta is null then 'diferencia'
        when d.faltan_facturas > 0 then 'falta_factura'
        when d.por_cobrar > 0 then 'esperando_cobro'
        else 'cuadra'
      end as estado
      from dif d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'clave', coalesce(e.rol::text, 'sin') || ':' || coalesce(e.local_id::text, 'sin') || ':' || e.d1 || ':' || e.d2,
      'intermediario_id', e.rol, 'intermediario', coalesce(e.nombre, e.canal), 'canal_id', e.channel_id, 'canal', e.canal,
      'local_id', e.local_id, 'local', e.local, 'desde', e.d1, 'hasta', e.d2,
      'estado', e.estado, 'cerrada', e.estado = 'cuadra' and e.reclamado_sin_llegar = 0,
      'diferencia', case when e.estado = 'diferencia' then coalesce(e.dif_ventas, e.dif_cobro, 0) end,
      'frase', case e.estado
        when 'esperando_liquidacion' then 'Aún a tiempo: ' || coalesce(e.nombre, e.canal) || ' suele pagar hacia el ' || to_char(e.d2 + e.dias, 'DD/MM') || '.'
        when 'falta_liquidacion' then 'Falta su liquidación: tenía que haber llegado hacia el ' || to_char(e.d2 + e.dias, 'DD/MM') ||
                                      ' y vendiste ' || public.conta_euros_exactos(e.vendido) || ' por ' || e.canal || '.'
        when 'diferencia' then case
          when e.local_id is null and e.channel_id is not null then 'No sé de qué local es: dale su local a la tienda y se compara con tus ventas.'
          when e.dif_ventas is not null then case when e.dif_ventas > 0
              then 'Vendiste ' || public.conta_euros_exactos(e.vendido) || ' y la liquidación dice ' || public.conta_euros_exactos(e.l_ventas) || ': liquida ' || public.conta_euros_exactos(e.dif_ventas) || ' de menos.'
              else 'La liquidación dice ' || public.conta_euros_exactos(e.l_ventas) || ' y vendiste ' || public.conta_euros_exactos(e.vendido) || ': liquida ' || public.conta_euros_exactos(-e.dif_ventas) || ' de más.' end
          else case when e.dif_cobro > 0
              then 'Dice que paga ' || public.conta_euros_exactos(e.l_pagan) || ' y al banco llegaron ' || public.conta_euros_exactos(e.l_banco) || ': faltan ' || public.conta_euros_exactos(e.dif_cobro) || '.'
              else 'Dice que paga ' || public.conta_euros_exactos(e.l_pagan) || ' y al banco llegaron ' || public.conta_euros_exactos(e.l_banco) || ': ' || public.conta_euros_exactos(-e.dif_cobro) || ' de más.' end end
        when 'falta_factura' then case when e.faltan_facturas = 1 then 'Falta su factura de comisión: cuando llegue a Compras, se engancha.'
                                       else 'Faltan ' || e.faltan_facturas || ' facturas de comisión: cuando lleguen a Compras, se enganchan.' end
        when 'esperando_cobro' then 'Esperando el cobro: ' || public.conta_euros_exactos(coalesce(e.l_pagan, 0)) ||
                                    case when v_hoy > e.plazo then ', y ya debería haber llegado al banco.' else '.' end
        else case when e.todo_referencia then 'De antes del cierre: de referencia (la lleva Diez).'
                  when e.reclamado_sin_llegar > 0 then 'Cuadra, con ' || public.conta_euros_exactos(e.reclamado_sin_llegar) || ' reclamados que aún no han llegado.'
                  when jsonb_array_length(e.resoluciones) > 0 then 'Cuadra, con ' || case when jsonb_array_length(e.resoluciones) = 1 then 'una diferencia resuelta' else jsonb_array_length(e.resoluciones) || ' diferencias resueltas' end || '.'
                  else 'Cuadra: lo vendido, la liquidación, su factura y el cobro.' end
      end,
      'piezas', jsonb_build_object(
        'vendido', jsonb_build_object('via', case when e.channel_id is not null then 'cierres' when e.sin_vendido then 'liquidacion' else 'facturas' end,
                                      'total', case when e.sin_vendido then null else e.vendido end, 'cierres', e.cierres, 'cedidas', e.cedidas, 'facturas', e.facturas_vendidas),
        'liquidacion', jsonb_build_object('n', e.n_liq, 'ventas', e.l_ventas, 'comision', e.l_comision, 'pagan', e.l_pagan,
                                          'otros', case when e.l_pagan is not null then round(e.l_ventas - e.l_comision - e.l_pagan, 2) end,
                                          'referencia', e.todo_referencia and e.n_liq > 0),
        'factura', jsonb_build_object('faltan', e.faltan_facturas),
        'cobro', jsonb_build_object('esperado', e.l_pagan, 'llegado', e.l_banco, 'por_cobrar', e.por_cobrar)),
      'liquidaciones', coalesce(e.liquidaciones, '[]'::jsonb),
      'resoluciones', e.resoluciones,
      'reclamado_sin_llegar', e.reclamado_sin_llegar,
      'avisos', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (
                  select jsonb_build_object('tipo', 'local_cerrado', 'texto', 'Llegan ventas de ' || e.local || ', que está cerrado: revisa de qué local son.') a
                   where e.local_id is not null and e.local_abierto is false and e.n_liq > 0 and not e.todo_referencia
                  union all
                  select jsonb_build_object('tipo', 'tienda_cambiada', 'cambio_id', c->>'id',
                                            'texto', 'La tienda «' || (c->>'antes') || '» llega como «' || (c->>'ahora') || '»: confírmalo con un clic.')
                    from jsonb_array_elements(coalesce(e.cambios, '[]'::jsonb)) c) z),
      'plazo', e.plazo)
    order by e.d2 desc, e.canal, e.local nulls last), '[]'::jsonb)
    into v_r
    from estado e;
  return v_r;
end $$;
revoke all on function public.conta_liquidaciones(uuid, date, date) from public, anon;
grant execute on function public.conta_liquidaciones(uuid, date, date) to authenticated;
comment on function public.conta_liquidaciones(uuid, date, date) is 'V02 · E2. EL MOTOR: una fila por intermediario, local y periodo con sus cuatro piezas (lo vendido, la liquidación, su factura de comisión y el cobro), su estado y la frase. También los periodos con ventas y sin liquidación. Solo lee.';

-- La lectura de los agentes.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.platform_store_alias, public.platform_store_tramo, public.platform_store_cambio to conta_lectura;
  end if;
end $$;
