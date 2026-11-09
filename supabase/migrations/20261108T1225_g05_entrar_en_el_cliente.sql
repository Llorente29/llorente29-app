-- supabase/migrations/20261108T1225_g05_entrar_en_el_cliente.sql
--
-- G05 · La gestoría entra en su cliente y lo lleva entero (Julio, 08/11).
-- Hasta hoy el despacho (P01) solo abría el trimestre de impuestos del cliente;
-- al pasar a Contabilidad o Laboral se seguía en la cuenta de la gestoría.
-- Con esto, desde «Tus clientes» se entra en la cuenta del cliente (con una
-- fila de acceso que da el despacho) y se vuelve con un clic.
--
--   user_profiles.advisor_account_id          la fila es un acceso del despacho (no del equipo del cliente)
--   conta_despacho_entrada                    el rastro: quién entró, cuándo y en qué sociedad
--   conta_despacho_entrar(sociedad)  [la persona] entra en el cliente: crea o reactiva su acceso y lo abre
--   conta_despacho_volver()          [la persona] vuelve a la cuenta del despacho
--   conta_despacho_mis_clientes()    [la persona] los clientes de sus despachos, para «Cambiar de cliente»
--   conta_despacho_donde()           [la persona] si la cuenta abierta es un acceso de despacho, y sus accesos
--   mi_bienvenida_hecha()            [la persona] si ya hizo la bienvenida en alguna cuenta (ya tiene contraseña)
--
-- Decisiones (encargo G05, 08/11):
--   · El acceso es rol manager. No hay rol nuevo: valid_role no se toca.
--   · Se puede llamar a entrar dos veces seguidas: una sola fila (la única
--     user_id + account_id ya existe: user_profiles_user_account_unique).
--   · Si quien entra ya es del equipo del cliente (fila propia, sin despacho),
--     se abre esa y no se toca.
--   · Retirar el permiso de la ÚLTIMA sociedad de esa gestoría en la cuenta
--     apaga (active = false) los accesos; no se borran, para que quede rastro.
--   · Un acceso de despacho no abre otro: para entrar hay que ser del equipo
--     de la gestoría (fila activa sin advisor_account_id y sin suspender).
--
-- Solo añade. Nada en el camino del pedido. Ningún dato se mueve: las filas de hoy quedan
-- con advisor_account_id nulo, que es lo que son.
--
-- Los dos disparadores (la bienvenida heredada y la retirada sola) van en la
-- 1226: sobre tablas que existen, el analizador los cuenta como «cambia».
--
-- Vuelta atrás: supabase/vuelta-atras/20261108T1225_g05_entrar_en_el_cliente.down.sql
-- Prueba: supabase/staging/sql/20261108_g05_entrar_en_el_cliente_prueba.sql

-- ── El acceso del despacho ──────────────────────────────────────────────────
alter table public.user_profiles add column if not exists advisor_account_id uuid references public.accounts(id) on delete cascade;
comment on column public.user_profiles.advisor_account_id is
  'G05 (08/11/2026). Si no es nulo, esta fila es un acceso que da el despacho (esa cuenta, una asesoría) para llevar la contabilidad del cliente, no una persona de su equipo. Lo crea conta_despacho_entrar; lo apaga _conta_despacho_retirar.';
create index if not exists user_profiles_advisor_idx on public.user_profiles (advisor_account_id, account_id) where advisor_account_id is not null;

-- ── El rastro de cada entrada ───────────────────────────────────────────────
create table if not exists public.conta_despacho_entrada (
  id                 uuid primary key default gen_random_uuid(),
  advisor_account_id uuid not null references public.accounts(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid references public.company(id) on delete set null,
  user_id            uuid not null,
  user_name          text,
  entered_at         timestamptz not null default now()
);
comment on table public.conta_despacho_entrada is
  'G05 (08/11/2026). Cada vez que alguien de un despacho (advisor_account_id) entra en un cliente (account_id, company_id). La escribe conta_despacho_entrar. La ven el despacho y el cliente.';
create index if not exists conta_despacho_entrada_cuenta_idx on public.conta_despacho_entrada (account_id, entered_at desc);
create index if not exists conta_despacho_entrada_despacho_idx on public.conta_despacho_entrada (advisor_account_id, entered_at desc);
alter table public.conta_despacho_entrada enable row level security;
drop policy if exists conta_despacho_entrada_select on public.conta_despacho_entrada;
create policy conta_despacho_entrada_select on public.conta_despacho_entrada for select to authenticated
  using (public.belongs_to_account(account_id) or public.belongs_to_account(advisor_account_id));
revoke all on table public.conta_despacho_entrada from anon, authenticated;
grant select on table public.conta_despacho_entrada to authenticated;

-- ── El despacho de quien llama: sus cuentas de gestoría ────────────────────
-- Solo las filas del equipo (sin advisor_account_id), activas y sin suspender.
create or replace function public._conta_despachos_de_quien_llama()
returns setof uuid language sql stable security definer set search_path = public as $$
  select up.account_id from public.user_profiles up
   where up.user_id = auth.uid() and up.active and up.suspended_at is null
     and up.advisor_account_id is null and up.account_id is not null
$$;
revoke all on function public._conta_despachos_de_quien_llama() from public, anon, authenticated;

-- ── Entrar ──────────────────────────────────────────────────────────────────
create or replace function public.conta_despacho_entrar(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cuenta uuid;
  v_razon text;
  v_despacho uuid;
  v_despacho_nombre text;
  v_mia public.user_profiles;
  v_origen public.user_profiles;
begin
  if v_uid is null then
    raise exception 'SIN_SESION' using errcode = '42501', hint = 'Hay que entrar para abrir un cliente.';
  end if;
  select c.account_id, coalesce(nullif(btrim(c.legal_name), ''), c.trade_name) into v_cuenta, v_razon
    from public.company c where c.id = p_company;
  -- La gestoría de quien llama que tiene a esa sociedad con permiso vivo (la más antigua, si fueran varias).
  select d.id, coalesce(nullif(btrim(d.legal_name), ''), d.name) into v_despacho, v_despacho_nombre
    from public.accounts d
   where d.id in (select public._conta_despachos_de_quien_llama())
     and p_company in (select public.conta_despacho_clientes(d.id))
   order by d.created_at, d.id
   limit 1;
  if v_cuenta is null or v_despacho is null then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'Ese cliente no te ha dado permiso, o no eres de su asesoría.';
  end if;

  select * into v_mia from public.user_profiles where user_id = v_uid and account_id = v_cuenta;
  if v_mia.id is null then
    select * into v_origen from public.user_profiles where user_id = v_uid and account_id = v_despacho;
    insert into public.user_profiles (user_id, account_id, role, active, display_name, advisor_account_id, terms_accepted_at, welcome_completed_at)
    values (v_uid, v_cuenta, 'manager', true, v_origen.display_name, v_despacho, v_origen.terms_accepted_at, v_origen.welcome_completed_at);
  elsif v_mia.advisor_account_id is not null or not v_mia.active then
    -- Su acceso del despacho (o una fila apagada): se enciende como acceso de este despacho.
    -- Una fila del equipo del cliente activa no se toca.
    select * into v_origen from public.user_profiles where user_id = v_uid and account_id = v_despacho;
    update public.user_profiles
       set active = true, role = 'manager', advisor_account_id = v_despacho,
           suspended_at = null, suspended_by = null,
           -- La bienvenida, las dos fechas juntas (user_profiles_welcome_requires_terms).
           terms_accepted_at = case when welcome_completed_at is null and v_origen.welcome_completed_at is not null
                                    then v_origen.terms_accepted_at else terms_accepted_at end,
           welcome_completed_at = coalesce(welcome_completed_at, v_origen.welcome_completed_at),
           display_name = coalesce(display_name, v_origen.display_name)
     where id = v_mia.id
       and (not active or role <> 'manager' or advisor_account_id is distinct from v_despacho or suspended_at is not null
            or (welcome_completed_at is null and v_origen.welcome_completed_at is not null));
  end if;

  perform public.cambiar_empresa(v_cuenta);

  insert into public.conta_despacho_entrada (advisor_account_id, account_id, company_id, user_id, user_name)
  values (v_despacho, v_cuenta, p_company, v_uid, (select display_name from public.user_profiles where user_id = v_uid and account_id = v_despacho));

  return jsonb_build_object('account_id', v_cuenta, 'company_id', p_company, 'razon_social', v_razon,
    'despacho', jsonb_build_object('account_id', v_despacho, 'nombre', v_despacho_nombre));
end $$;
comment on function public.conta_despacho_entrar(uuid) is
  'G05 (08/11/2026). Quien es del equipo de una asesoría entra en la cuenta de un cliente que le ha dado permiso (conta_despacho_clientes): crea o reactiva su acceso (manager, advisor_account_id = la asesoría, la bienvenida copiada), lo abre (cambiar_empresa) y lo apunta en conta_despacho_entrada. Si no, NO_AUTORIZADO.';
revoke all on function public.conta_despacho_entrar(uuid) from public, anon;
grant execute on function public.conta_despacho_entrar(uuid) to authenticated;

-- ── Volver ──────────────────────────────────────────────────────────────────
create or replace function public.conta_despacho_volver()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_despacho uuid; v_nombre text;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501', hint = 'Hay que entrar para volver al despacho.';
  end if;
  select up.advisor_account_id into v_despacho
    from public.user_profiles up
   where up.user_id = auth.uid() and up.account_id = public._cuenta_activa() and up.active;
  if v_despacho is null then
    raise exception 'NO_ES_DE_DESPACHO' using errcode = '22023', hint = 'Ya estás en tu despacho: no has entrado en ningún cliente.';
  end if;
  perform public.cambiar_empresa(v_despacho);
  select coalesce(nullif(btrim(legal_name), ''), name) into v_nombre from public.accounts where id = v_despacho;
  return jsonb_build_object('account_id', v_despacho, 'nombre', v_nombre, 'ruta', 'impuestos/clientes');
end $$;
comment on function public.conta_despacho_volver() is
  'G05 (08/11/2026). Desde un cliente en el que se entró por el despacho, abre otra vez la cuenta del despacho y devuelve su ruta (Impuestos › Tus clientes).';
revoke all on function public.conta_despacho_volver() from public, anon;
grant execute on function public.conta_despacho_volver() to authenticated;

-- ── Los clientes de mis despachos (para «Cambiar de cliente» y el selector) ─
-- Se llama desde dentro de un cliente: por eso no mira la cuenta abierta, sino
-- las gestorías de las que quien llama es del equipo.
create or replace function public.conta_despacho_mis_clientes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'company_id', c.id,
      'account_id', c.account_id,
      'razon_social', coalesce(nullif(btrim(c.legal_name), ''), c.trade_name),
      'nombre', coalesce(nullif(btrim(c.trade_name), ''), c.legal_name),
      'despacho_id', d.id,
      'despacho_nombre', coalesce(nullif(btrim(d.legal_name), ''), d.name))
    order by coalesce(nullif(btrim(d.legal_name), ''), d.name), coalesce(nullif(btrim(c.legal_name), ''), c.trade_name)), '[]'::jsonb)
  from public.accounts d
  cross join lateral public.conta_despacho_clientes(d.id) cl(company_id)
  join public.company c on c.id = cl.company_id
  where d.id in (select public._conta_despachos_de_quien_llama())
$$;
comment on function public.conta_despacho_mis_clientes() is
  'G05 (08/11/2026). Los clientes con permiso vivo de las asesorías de quien llama (de su equipo), con su razón social y su despacho. Para «Cambiar de cliente» y el selector de la cabecera.';
revoke all on function public.conta_despacho_mis_clientes() from public, anon;
grant execute on function public.conta_despacho_mis_clientes() to authenticated;

-- ── Dónde está quien llama: el acceso abierto y los que tiene ──────────────
-- Para el Shell (un acceso de despacho ve solo Sumied), la franja y el
-- selector. Una función nueva en vez de cambiar mis_empresas: así la tanda
-- solo añade.
create or replace function public.conta_despacho_donde()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'abierto', (select jsonb_build_object('account_id', up.account_id, 'despacho_id', d.id,
                                          'despacho_nombre', coalesce(nullif(btrim(d.legal_name), ''), d.name))
                  from public.user_profiles up join public.accounts d on d.id = up.advisor_account_id
                 where up.user_id = auth.uid() and up.active and up.account_id = public._cuenta_activa()),
    'accesos', coalesce((select jsonb_agg(up.account_id order by up.account_id)
                           from public.user_profiles up
                          where up.user_id = auth.uid() and up.active and up.advisor_account_id is not null), '[]'::jsonb))
$$;
comment on function public.conta_despacho_donde() is
  'G05 (08/11/2026). De quien llama: si la cuenta abierta es un acceso de despacho (y de cuál), y las cuentas en las que tiene un acceso de despacho. Para el Shell, la franja y el selector.';
revoke all on function public.conta_despacho_donde() from public, anon;
grant execute on function public.conta_despacho_donde() to authenticated;

-- ── ¿Ya hizo la bienvenida en alguna cuenta? ────────────────────────────────
-- Para «Activa tu cuenta»: a quien ya la hizo (y por tanto ya puso su
-- contraseña) no se le pide otra; solo aceptar los términos de esta cuenta.
create or replace function public.mi_bienvenida_hecha()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles up
                  where up.user_id = auth.uid() and up.welcome_completed_at is not null)
$$;
comment on function public.mi_bienvenida_hecha() is
  'G05 (08/11/2026). Si quien llama ya completó la bienvenida en alguna de sus cuentas: entonces ya tiene contraseña y WelcomePage no le pide otra.';
revoke all on function public.mi_bienvenida_hecha() from public, anon;
grant execute on function public.mi_bienvenida_hecha() to authenticated;
