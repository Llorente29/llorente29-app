-- 20260831T1835_inicio_p1_datos_y_rls.sql
-- ============================================================================
-- INICIO P1 · SUB-LOTE 1: datos + RLS.
--
-- APLICADA el 31/08/2026 a las 18:35 de Madrid (16:35 UTC), por orden expresa
-- de Julio. Registrada en supabase_migrations.schema_migrations como version
-- 20260831163522, nombre `inicio_p1_datos_y_rls`. El fichero se llamaba
-- 20260830T1810 y se renumero a la hora real: el nombre tiene que decir cuando
-- paso, no cuando se escribio (misma leccion que brand_closure_por_local).
--
-- VERIFICADO EN PRODUCCION JUSTO DESPUES DE APLICARLA, por consulta y no por
-- afirmacion (regla 5):
--   · las CUATRO tablas existen: home_card_catalog, home_card_account,
--     home_layout, home_role_default.
--   · relrowsecurity = true en las cuatro.
--   · anon: SELECT e INSERT en false en las cuatro.
--   · authenticated: INSERT = true en home_layout (la mitad que se olvida
--     comprobar, y sin la cual el Inicio naceria roto).
--   · 6 politicas, todas `to authenticated`; home_layout_own compara
--     auth.uid() = user_id directamente, sin joins.
--
-- HALLAZGO ANOTADO, NO CORREGIDO AQUI: `authenticated` conserva INSERT/UPDATE/
-- DELETE de tabla sobre home_card_catalog, aunque abajo solo se le concede
-- SELECT. Viene de pg_default_acl, que reparte arwdDxtm a anon, authenticated y
-- service_role en cada tabla nueva de `public`; el revoke de abajo quita a
-- `public` y a `anon`, no a `authenticated`. NO es un agujero abierto: RLS esta
-- activa y home_card_catalog no tiene ninguna politica de escritura, asi que la
-- escritura queda denegada igual. Es la misma postura que ya tiene
-- brand_closure. Queda escrito para que se decida a proposito, no por olvido.
--
-- La ventana de despliegue del 30/08 (antes de las 12:15) ya estaba cerrada
-- cuando llego el encargo, y el propio encargo decia que el Inicio no toca
-- produccion hasta que este sub-lote estuviera construido y REVISADO. Lo
-- estuvo, y Julio la mando aplicar el 31/08 por la tarde.
--
-- DECISIONES DE JULIO (30/08) QUE ESTA MIGRACION MATERIALIZA
--
-- 1) El CODIGO es la verdad. Cada modulo declara sus tarjetas en
--    ModuleDefinition.homeCards, junto al componente y la consulta que las
--    hacen posibles. `home_card_catalog` es SOLO espejo: se regenera desde el
--    codigo en cada deploy. Una fila huerfana -- existe en BBDD, ya no en
--    codigo -- NO se pinta. Nunca al reves: la BBDD no puede inventar una
--    tarjeta que el codigo no sabe renderizar.
--
-- 2) Solo ADMIN en P1. No existen dueño ni encargado en user_profiles.role
--    (hoy: admin=3, worker=9) y no se crean roles para personas que no
--    existen. `worker` sigue en su portal, sin Inicio.
--
-- 3) RLS con el precedente BUENO: `auth.uid() = user_id`, directo y sin joins,
--    como user_item_unit_pref. NO como user_saved_view, que resuelve el
--    usuario con un EXISTS contra user_profiles -- ahi `user_id` ni siquiera
--    es auth.uid(), es user_profiles.id, y esa confusion es justo la que hace
--    que una politica parezca que aisla y no aisle.
--
-- POR QUE EL ESPEJO NO LLEVA account_id
-- `home_card_catalog` se REGENERA desde el codigo. Si llevara account_id, la
-- regeneracion tendria que conocer todas las cuentas y multiplicaria filas en
-- cada deploy. El interruptor por cuenta va en una tabla aparte,
-- `home_card_account`, con el patron que la casa ya usa y entiende: FILA
-- AUSENTE = lo que diga el catalogo. Igual que product_availability y que
-- brand_closure.
--
-- NADA DE ESTO ES ALCANZABLE POR anon. Leccion del 29/08: al crear una funcion
-- o tabla nueva en `public`, pg_default_acl concede a anon por defecto y
-- PostgreSQL a PUBLIC. Si nadie revoca, nace abierta.
-- ============================================================================

begin;

-- ── 1. El espejo del catalogo (lo escribe el deploy, no el usuario) ─────────
create table if not exists public.home_card_catalog (
  card_key     text primary key,
  module       text        not null,
  title        text        not null,
  description  text,
  source       text,
  drill_route  text,
  size         text        not null default 'sm',
  active       boolean     not null default true,
  synced_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint home_card_catalog_size_valida check (size in ('sm','md','lg'))
);

comment on table public.home_card_catalog is
  'ESPEJO del catalogo de tarjetas de Inicio. La verdad esta en el codigo '
  '(ModuleDefinition.homeCards); esta tabla se regenera desde el en cada deploy '
  'y sirve para el interruptor por cuenta y para saber que habia. Una fila que '
  'ya no exista en codigo NO se pinta: la BBDD no puede inventar una tarjeta que '
  'nadie sabe renderizar. Sin account_id a proposito -- ver cabecera.';

comment on column public.home_card_catalog.source is
  'De donde sale el dato (RPC o tabla). INFORMATIVO: quien consulta de verdad es '
  'el componente del modulo. Sirve para el sello de frescura y para auditar.';

-- ── 2. El interruptor por cuenta. Fila ausente = lo que diga el catalogo ────
create table if not exists public.home_card_account (
  account_id uuid        not null references public.accounts(id) on delete cascade,
  card_key   text        not null references public.home_card_catalog(card_key) on delete cascade,
  active     boolean     not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, card_key)
);

comment on table public.home_card_account is
  'Interruptor de una tarjeta PARA UNA CUENTA. Fila ausente = vale lo que diga '
  'home_card_catalog.active. Mismo patron que product_availability y brand_closure.';

-- ── 3. El layout del usuario. Restaurar = borrar la fila ───────────────────
create table if not exists public.home_layout (
  account_id uuid        not null references public.accounts(id) on delete cascade,
  user_id    uuid        not null,
  cards      jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id),
  constraint home_layout_cards_es_lista check (jsonb_typeof(cards) = 'array')
);

comment on table public.home_layout is
  'Mosaico de Inicio de UN usuario en UNA cuenta. `cards` es una lista ORDENADA '
  'de card_key: el orden de la lista es el orden en pantalla. Restaurar = BORRAR '
  'la fila y caer al defecto del rol. Sin estado intermedio: no hay un "layout '
  'por defecto guardado" que pueda quedar a medias.';

comment on column public.home_layout.user_id is
  'auth.uid(), NO user_profiles.id. La confusion entre los dos es lo que hace '
  'que la politica de user_saved_view necesite un join para algo que aqui es '
  'una comparacion directa.';

-- ── 4. El defecto por rol. En P1, solo admin ───────────────────────────────
create table if not exists public.home_role_default (
  account_id uuid        not null references public.accounts(id) on delete cascade,
  role       text        not null,
  cards      jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, role),
  constraint home_role_default_cards_es_lista check (jsonb_typeof(cards) = 'array')
);

comment on table public.home_role_default is
  'Plantilla de Inicio por ROL de user_profiles.role. P1: solo `admin` -- no se '
  'crean roles para personas que no existen. Es el destino de "Restaurar".';

create index if not exists home_layout_user_idx on public.home_layout (user_id);

-- ── 5. RLS ─────────────────────────────────────────────────────────────────
alter table public.home_card_catalog  enable row level security;
alter table public.home_card_account  enable row level security;
alter table public.home_layout        enable row level security;
alter table public.home_role_default  enable row level security;

-- El catalogo es global y no lleva dato de nadie: se lee, no se escribe desde
-- el cliente. Lo siembra el deploy con service_role.
drop policy if exists home_card_catalog_read on public.home_card_catalog;
create policy home_card_catalog_read on public.home_card_catalog
  for select to authenticated using (true);

drop policy if exists home_card_account_read on public.home_card_account;
create policy home_card_account_read on public.home_card_account
  for select to authenticated
  using (account_id = any(public.current_user_account_ids()));

drop policy if exists home_card_account_write on public.home_card_account;
create policy home_card_account_write on public.home_card_account
  for all to authenticated
  using (public.current_user_is_admin_of(account_id))
  with check (public.current_user_is_admin_of(account_id));

-- EL LAYOUT: comparacion directa, sin joins. Un usuario jamas ve ni edita el
-- de otro, ni siquiera dentro de su misma cuenta.
drop policy if exists home_layout_own on public.home_layout;
create policy home_layout_own on public.home_layout
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id
              and account_id = any(public.current_user_account_ids()));

drop policy if exists home_role_default_read on public.home_role_default;
create policy home_role_default_read on public.home_role_default
  for select to authenticated
  using (account_id = any(public.current_user_account_ids()));

drop policy if exists home_role_default_write on public.home_role_default;
create policy home_role_default_write on public.home_role_default
  for all to authenticated
  using (public.current_user_is_admin_of(account_id))
  with check (public.current_user_is_admin_of(account_id));

-- ── 6. Permisos EXPLICITOS. anon fuera de las cuatro ───────────────────────
revoke all on public.home_card_catalog from public, anon;
revoke all on public.home_card_account from public, anon;
revoke all on public.home_layout       from public, anon;
revoke all on public.home_role_default from public, anon;

grant select                         on public.home_card_catalog to authenticated;
grant select, insert, update, delete on public.home_card_account to authenticated;
grant select, insert, update, delete on public.home_layout       to authenticated;
grant select, insert, update, delete on public.home_role_default to authenticated;
grant all on public.home_card_catalog, public.home_card_account,
             public.home_layout, public.home_role_default to service_role;

-- ── 7. GUARDA ──────────────────────────────────────────────────────────────
do $ver$
declare v_t text; v_abiertas text;
begin
  foreach v_t in array array['home_card_catalog','home_card_account','home_layout','home_role_default'] loop
    if to_regclass('public.'||v_t) is null then
      raise exception '% no quedo creada', v_t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.'||v_t)::regclass) then
      raise exception '% se quedo SIN row level security', v_t;
    end if;
  end loop;

  select string_agg(t, ', ') into v_abiertas
  from unnest(array['home_card_catalog','home_card_account','home_layout','home_role_default']) t
  where has_table_privilege('anon', 'public.'||t, 'SELECT')
     or has_table_privilege('anon', 'public.'||t, 'INSERT');
  if v_abiertas is not null then
    raise exception 'anon todavia alcanza: %', v_abiertas;
  end if;

  -- Y que authenticated SI puede, que es la mitad que se olvida comprobar.
  if not has_table_privilege('authenticated', 'public.home_layout', 'INSERT') then
    raise exception 'authenticated no puede escribir su propio layout: Inicio naceria roto';
  end if;

  raise notice 'VERIFICACION OK: 4 tablas, RLS activa, anon fuera, authenticated dentro';
end
$ver$;

commit;

-- ── Comprobaciones DESPUES de aplicar ───────────────────────────────────────
-- 1) Aislamiento (verificacion 3 del encargo). Con la sesion de A:
--    insert into home_layout(account_id, user_id, cards)
--      values ('<cuenta>', '<uid de B>', '[]'::jsonb);   -- debe FALLAR (with check)
--    select * from home_layout where user_id = '<uid de B>';  -- debe dar CERO filas
--
-- 2) Restaurar (verificacion 2):
--    delete from home_layout where account_id='<cuenta>' and user_id=auth.uid();
--    -- y el Inicio pasa a leer home_role_default de su rol. Sin fila intermedia.
--
-- 3) anon no llega:
--    select t, has_table_privilege('anon','public.'||t,'SELECT')
--      from unnest(array['home_card_catalog','home_card_account',
--                        'home_layout','home_role_default']) t;
--    -- esperado: los cuatro false.
