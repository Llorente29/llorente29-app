-- supabase/migrations/20261101T1234_b01p_pagos_base.sql
--
-- B01 Revolut · PR 2a · LA BASE DEL «PAGAR» COMÚN. Solo añade: tablas y
-- funciones nuevas. No cambia nada de lo que ya existe y no manda ningún pago:
-- mandarlo es del PR 2b (la función conta-pagar y la salida de Revolut), y las
-- pantallas, del 2c.
--
-- Lo que decidió Julio y que vive aquí:
--   · El permiso de pagar es EXPLÍCITO (01/11): puede pagar quien un
--     administrador autoriza (también él mismo, al «Activar pagos»). Sin él, no
--     sale el botón.
--   · Topes de 3.000 € por pago y 10.000 € al día, cambiables por empresa (P6).
--     El del día suma lo aprobado ese día, en hora de Madrid.
--   · Segunda aprobación con un IBAN nuevo, cambiado o leído de la factura (P1),
--     por encima de un tope, o al «pagar igual» con un titular que no coincide.
--   · Quién la da lo decide Sumied, no se configura: con una sola persona que
--     puede pagar, ella misma; con dos o más, otra. Siempre con su LLAVE de
--     acceso (huella, cara o Windows Hello) o, si su dispositivo no la tiene
--     o lo prefiere, con su PIN DE PAGO de 6 cifras (maqueta v4, aprobada el
--     01/11). Un «Aprobar» solo no vale. El PIN se bloquea con 5 fallos.
--   · El correo, solo para tres cosas: crear el PIN, recuperarlo y activar la
--     llave en un dispositivo nuevo. Ningún pago se confirma con el correo.
--   · Una confirmación vale para todos los pagos que salen JUNTOS (un lote), y
--     es de esa lista exacta: lo que se confirma es su huella. Si cambia algo
--     después, ya no vale.
--
-- La llave (WebAuthn) y el PIN se comprueban en una función con la clave de
-- servicio (PR 2b). La base guarda solo la parte pública de cada llave, el PIN
-- CIFRADO (HMAC-SHA256 con una clave que solo tiene esa función, y su sal: un
-- PIN de 6 cifras con solo un resumen se sacaría probando el millón de
-- combinaciones; con la clave del servidor no se puede ni leer ni probar fuera
-- de Sumied), los retos de un solo uso (su huella, nunca el reto ni el código)
-- y quién confirmó qué.
--
-- Cuando el 2b mande un pago, lo apuntará como una remesa de PC01 de tipo
-- «banco» con su línea: así la factura solo queda pagada cuando su cargo se
-- casa en Bancos y tiene asiento (PC01 · E1), como cualquier otra remesa.
--
-- No está en el camino del pedido. Dueño único: lo escriben funciones conta_*.

-- ── 1 · Quién puede pagar ──────────────────────────────────────────────────
create table if not exists public.conta_pago_permiso (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  user_id          uuid not null,
  user_name        text,
  granted_at       timestamptz not null default now(),
  granted_by       uuid,
  granted_by_name  text,
  revoked_at       timestamptz,
  revoked_by_name  text
);
create unique index if not exists conta_pago_permiso_vivo on public.conta_pago_permiso (company_id, user_id) where revoked_at is null;
comment on table public.conta_pago_permiso is
  'B01 Revolut · PR 2a · Quién puede pagar desde Sumied en cada empresa. Lo da un administrador (también a sí mismo, al «Activar pagos»). Quitarlo no borra la fila: le pone revoked_at.';

-- ── 2 · Los topes de cada empresa ──────────────────────────────────────────
create table if not exists public.conta_pago_ajustes (
  company_id       uuid primary key references public.company(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  tope_pago        numeric(14,2) not null default 3000 check (tope_pago > 0),
  tope_dia         numeric(14,2) not null default 10000 check (tope_dia > 0),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text
);
comment on table public.conta_pago_ajustes is
  'B01 Revolut · PR 2a · Los topes de pago de la empresa (P6). Sin fila, los de partida: 3.000 € por pago y 10.000 € al día. Por encima, segunda aprobación.';

-- ── 3 · Los pagos que salen juntos (un lote) y cada pago ───────────────────
create table if not exists public.conta_pago_lote (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts(id) on delete cascade,
  company_id            uuid not null references public.company(id) on delete cascade,
  -- Sin clave ajena a las tablas de mucho uso (treasury_account, supplier_invoice,
  -- supplier, las remesas): crearla o quitarla las bloquearía en exclusiva y se
  -- cruzaría con quien escribe en ellas (staging, run 41309002393: 40P01 al
  -- deshacer). Que sean de la empresa lo comprueban las funciones.
  treasury_account_id   uuid not null,
  proveedor             text not null check (proveedor in ('revolut')),
  estado                text not null check (estado in ('esperando_segunda', 'listo', 'enviando', 'enviado', 'cancelado')),
  huella                text not null check (huella ~ '^[0-9a-f]{64}$'),
  segunda_motivos       text[] not null default '{}',
  segunda_por           uuid,
  segunda_por_nombre    text,
  segunda_at            timestamptz,
  segunda_via           text check (segunda_via in ('llave', 'pin')),
  segunda_dispositivo   text,
  created_at            timestamptz not null default now(),
  created_by            uuid not null,
  created_by_name       text,
  cancelado_at          timestamptz,
  cancelado_por_nombre  text,
  cancelado_porque      text
);
create index if not exists conta_pago_lote_empresa_idx on public.conta_pago_lote (company_id, created_at);
comment on table public.conta_pago_lote is
  'B01 Revolut · PR 2a · Los pagos que salen juntos con una sola aprobación (una factura, o las de una remesa). huella = sha256 de la lista exacta; la segunda aprobación es de esa huella.';

create table if not exists public.conta_pago_salida (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  company_id           uuid not null references public.company(id) on delete cascade,
  lote_id              uuid not null references public.conta_pago_lote(id) on delete cascade,
  invoice_id           uuid not null,
  supplier_id          uuid,
  amount               numeric(14,2) not null check (amount > 0),
  beneficiario         text not null,
  iban                 text not null,
  iban_check           text not null check (iban_check in ('comprobado', 'primer_pago', 'cambiado')),
  iban_nota            text,
  concepto             text not null,
  motivos              text[] not null default '{}',
  pagar_igual_porque   text,
  request_id           uuid not null default gen_random_uuid() unique,
  estado               text not null check (estado in ('esperando_segunda', 'lista', 'enviando', 'enviada', 'esperando_banco', 'pagada', 'rechazada', 'devuelta', 'cancelada')),
  estado_porque        text,
  estado_at            timestamptz not null default now(),
  remesa_id            uuid,
  remesa_linea_id      uuid,
  banco_id             text,
  created_at           timestamptz not null default now()
);
create index if not exists conta_pago_salida_lote_idx on public.conta_pago_salida (lote_id);
create index if not exists conta_pago_salida_empresa_idx on public.conta_pago_salida (company_id, created_at);
-- Un pago vivo por factura: no se puede pagar dos veces a la vez.
create unique index if not exists conta_pago_salida_viva on public.conta_pago_salida (invoice_id)
  where estado in ('esperando_segunda', 'lista', 'enviando', 'enviada', 'esperando_banco');
comment on table public.conta_pago_salida is
  'B01 Revolut · PR 2a · Un pago saliente de una factura por un banco con el que Sumied paga (hoy Revolut): importe, beneficiario e IBAN tal como se aprobaron, su request_id (para que el banco no lo haga dos veces y su cargo se case solo) y su estado.';

create table if not exists public.conta_pago_evento (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  lote_id     uuid not null references public.conta_pago_lote(id) on delete cascade,
  salida_id   uuid references public.conta_pago_salida(id) on delete cascade,
  at          timestamptz not null default now(),
  by_name     text,
  texto       text not null
);
create index if not exists conta_pago_evento_lote_idx on public.conta_pago_evento (lote_id, at);
comment on table public.conta_pago_evento is 'B01 Revolut · PR 2a · El registro de cada pago: quién, cuándo y qué. Solo se añade.';

-- ── 4 · Las llaves de acceso y los retos ───────────────────────────────────
create table if not exists public.conta_llave (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  credential_id    text not null unique check (credential_id ~ '^[A-Za-z0-9_-]+$' and length(credential_id) between 16 and 1400),
  public_key       text not null check (public_key ~ '^[A-Za-z0-9_-]+$'),
  algoritmo        integer not null check (algoritmo in (-7, -257, -8)),
  sign_count       bigint not null default 0 check (sign_count >= 0),
  rp_id            text not null check (rp_id ~ '^[a-z0-9.-]+$'),
  dispositivo      text,
  transports       text[] not null default '{}',
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  revoked_by_name  text
);
create index if not exists conta_llave_usuario_idx on public.conta_llave (user_id) where revoked_at is null;
comment on table public.conta_llave is
  'B01 Revolut · PR 2a · Las llaves de acceso (WebAuthn) de cada persona: solo la parte PÚBLICA. La privada no sale nunca del dispositivo. Una llave vale solo en su dirección (rp_id).';

create table if not exists public.conta_pago_reto (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  account_id       uuid references public.accounts(id) on delete cascade,
  lote_id          uuid references public.conta_pago_lote(id) on delete cascade,
  proposito        text not null check (proposito in ('confirmar', 'activar_llave', 'registrar', 'crear_pin')),
  via              text not null check (via in ('llave', 'codigo')),
  reto_huella      text not null check (reto_huella ~ '^[0-9a-f]{64}$'),
  huella_lote      text check (huella_lote ~ '^[0-9a-f]{64}$'),
  correo_mascara   text,
  intentos         integer not null default 0 check (intentos between 0 and 3),
  expires_at       timestamptz not null,
  used_at          timestamptz,
  descartado_at    timestamptz,
  llave_id         uuid references public.conta_llave(id) on delete set null,
  created_at       timestamptz not null default now(),
  check ((proposito = 'confirmar') = (lote_id is not null)),
  -- Un pago se confirma con la llave (o con el PIN, que no usa retos); el correo, solo para activar la llave y crear el PIN.
  check ((proposito in ('confirmar', 'registrar')) = (via = 'llave'))
);
create index if not exists conta_pago_reto_usuario_idx on public.conta_pago_reto (user_id, proposito, created_at);
comment on table public.conta_pago_reto is
  'B01 Revolut · PR 2a · Un reto de un solo uso (10 minutos): confirmar un lote con la llave, el código del correo para activar una llave nueva o crear el PIN, y el reto para registrar la llave. Solo su huella (sha256), nunca el reto ni el código.';

create table if not exists public.conta_pago_pin (
  user_id          uuid primary key,
  pin_cifrado      text not null check (pin_cifrado ~ '^[0-9a-f]{64}$'),
  sal              text not null check (sal ~ '^[0-9a-f]{32,64}$'),
  intentos         integer not null default 0 check (intentos between 0 and 5),
  bloqueado_at     timestamptz,
  created_at       timestamptz not null default now(),
  cambiado_at      timestamptz not null default now()
);
comment on table public.conta_pago_pin is
  'B01 Revolut · PR 2a · El PIN de pago de cada persona (plan B de la segunda aprobación): cifrado con HMAC-SHA256 y una clave que solo tiene la función que lo comprueba, con su sal. Se bloquea con 5 fallos; crearlo o recuperarlo pide el código del correo.';

-- ── 5 · Quién ve qué ───────────────────────────────────────────────────────
alter table public.conta_pago_permiso enable row level security;
alter table public.conta_pago_ajustes enable row level security;
alter table public.conta_pago_lote enable row level security;
alter table public.conta_pago_salida enable row level security;
alter table public.conta_pago_evento enable row level security;
alter table public.conta_llave enable row level security;
alter table public.conta_pago_reto enable row level security;
alter table public.conta_pago_pin enable row level security;

-- ¿Es quien llama de esta cuenta (en la abierta, DM1)?
create or replace function public._conta_pago_de_la_cuenta(p_account uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles u
                  where u.user_id = auth.uid() and u.account_id = p_account and u.active
                    and u.account_id = public._cuenta_activa())
      or public.current_user_is_admin()
$$;
revoke all on function public._conta_pago_de_la_cuenta(uuid) from public, anon;
grant execute on function public._conta_pago_de_la_cuenta(uuid) to authenticated;

drop policy if exists conta_pago_permiso_leer on public.conta_pago_permiso;
create policy conta_pago_permiso_leer on public.conta_pago_permiso for select to authenticated using (public._conta_pago_de_la_cuenta(account_id));
revoke all on public.conta_pago_permiso from anon, authenticated;
grant select on public.conta_pago_permiso to authenticated;
drop policy if exists conta_pago_ajustes_leer on public.conta_pago_ajustes;
create policy conta_pago_ajustes_leer on public.conta_pago_ajustes for select to authenticated using (public._conta_pago_de_la_cuenta(account_id));
revoke all on public.conta_pago_ajustes from anon, authenticated;
grant select on public.conta_pago_ajustes to authenticated;
drop policy if exists conta_pago_lote_leer on public.conta_pago_lote;
create policy conta_pago_lote_leer on public.conta_pago_lote for select to authenticated using (public._conta_pago_de_la_cuenta(account_id));
revoke all on public.conta_pago_lote from anon, authenticated;
grant select on public.conta_pago_lote to authenticated;
drop policy if exists conta_pago_salida_leer on public.conta_pago_salida;
create policy conta_pago_salida_leer on public.conta_pago_salida for select to authenticated using (public._conta_pago_de_la_cuenta(account_id));
revoke all on public.conta_pago_salida from anon, authenticated;
grant select on public.conta_pago_salida to authenticated;
drop policy if exists conta_pago_evento_leer on public.conta_pago_evento;
create policy conta_pago_evento_leer on public.conta_pago_evento for select to authenticated using (public._conta_pago_de_la_cuenta(account_id));
revoke all on public.conta_pago_evento from anon, authenticated;
grant select on public.conta_pago_evento to authenticated;
-- Las llaves: cada uno las suyas, y sin la clave pública. Los retos: nadie.
drop policy if exists conta_llave_leer on public.conta_llave;
create policy conta_llave_leer on public.conta_llave for select to authenticated using (user_id = auth.uid());
revoke all on public.conta_llave from anon, authenticated;
grant select (id, rp_id, dispositivo, created_at, last_used_at, revoked_at) on public.conta_llave to authenticated;
revoke all on public.conta_pago_reto from anon, authenticated;
revoke all on public.conta_pago_pin from anon, authenticated;
-- La clave de servicio (la función que comprueba la llave y el PIN, 2b), explícito.
grant select, insert, update, delete on public.conta_pago_permiso, public.conta_pago_ajustes, public.conta_pago_lote, public.conta_pago_salida,
  public.conta_pago_evento, public.conta_llave, public.conta_pago_reto, public.conta_pago_pin to service_role;

-- ── 6 · Piezas ─────────────────────────────────────────────────────────────
-- La cuenta de la empresa, si quien llama es de ella.
create or replace function public._conta_pago_empresa(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.company where id = p_company;
  if v is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public._conta_pago_de_la_cuenta(v) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public._conta_pago_empresa(uuid) from public, anon, authenticated;

-- El nombre de una persona de la cuenta (para el registro, también desde la clave de servicio).
create or replace function public._conta_pago_nombre(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select display_name from public.user_profiles where user_id = p_user and active and display_name is not null order by created_at limit 1),
    (select email from auth.users where id = p_user), 'Una persona')
$$;
revoke all on function public._conta_pago_nombre(uuid) from public, anon, authenticated;

-- ¿Puede pagar esta persona en esta empresa? Permiso vivo y sigue activa en la cuenta.
create or replace function public._conta_pago_puede(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from public.conta_pago_permiso p
      join public.company c on c.id = p.company_id
      join public.user_profiles u on u.user_id = p.user_id and u.account_id = c.account_id and u.active
     where p.company_id = p_company and p.user_id = p_user and p.revoked_at is null)
$$;
revoke all on function public._conta_pago_puede(uuid, uuid) from public, anon, authenticated;

-- Las personas que pueden pagar en la empresa, en orden de alta.
create or replace function public._conta_pago_pagadores(p_company uuid)
returns table (user_id uuid, nombre text) language sql stable security definer set search_path = public as $$
  select p.user_id, public._conta_pago_nombre(p.user_id)
    from public.conta_pago_permiso p
   where p.company_id = p_company and p.revoked_at is null and public._conta_pago_puede(p_company, p.user_id)
   order by p.granted_at
$$;
revoke all on function public._conta_pago_pagadores(uuid) from public, anon, authenticated;

-- ¿Puede esta persona dar la segunda aprobación de este lote? Con una sola que
-- paga, ella misma; con dos o más, otra que no sea quien lo aprobó.
create or replace function public._conta_pago_puede_dar(p_lote uuid, p_user uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_l public.conta_pago_lote; v_n int;
begin
  select * into v_l from public.conta_pago_lote where id = p_lote;
  if v_l.id is null then return 'Ese pago no existe.'; end if;
  if v_l.estado <> 'esperando_segunda' then return 'Ese pago ya no espera la segunda aprobación.'; end if;
  if not public._conta_pago_puede(v_l.company_id, p_user) then return 'No tienes permiso para pagar en esta empresa.'; end if;
  select count(*) into v_n from public._conta_pago_pagadores(v_l.company_id);
  if v_n >= 2 and p_user = v_l.created_by then return 'Lo aprobaste tú: la segunda aprobación la tiene que dar otra persona que pueda pagar.'; end if;
  if v_n < 2 and p_user <> v_l.created_by then return 'La segunda aprobación la da quien lo aprobó.'; end if;
  return null;
end $$;
revoke all on function public._conta_pago_puede_dar(uuid, uuid) from public, anon, authenticated;

-- La huella de la lista exacta de un lote: cada pago (id, importe, IBAN,
-- beneficiario) en orden, la cuenta de origen y el banco.
create or replace function public._conta_pago_huella(p_lote uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(
    l.id::text || '|' || l.treasury_account_id::text || '|' || l.proveedor || '|' ||
    coalesce((select string_agg(s.id::text || ':' || to_char(s.amount, 'FM999999999990.00') || ':' || s.iban || ':' || s.beneficiario, ';' order by s.id)
                from public.conta_pago_salida s where s.lote_id = l.id and s.estado <> 'cancelada'), ''), 'UTF8')), 'hex')
    from public.conta_pago_lote l where l.id = p_lote
$$;
revoke all on function public._conta_pago_huella(uuid) from public, anon, authenticated;

create or replace function public._conta_pago_evento(p_account uuid, p_lote uuid, p_salida uuid, p_por text, p_texto text)
returns void language sql security definer set search_path = public as $$
  insert into public.conta_pago_evento (account_id, lote_id, salida_id, by_name, texto)
  values (p_account, p_lote, p_salida, coalesce(p_por, 'Sumied'), p_texto)
$$;
revoke all on function public._conta_pago_evento(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- Los topes de la empresa (los de partida si no tiene fila).
create or replace function public._conta_pago_topes(p_company uuid)
returns table (tope_pago numeric, tope_dia numeric) language sql stable security definer set search_path = public as $$
  select coalesce((select a.tope_pago from public.conta_pago_ajustes a where a.company_id = p_company), 3000)::numeric,
         coalesce((select a.tope_dia from public.conta_pago_ajustes a where a.company_id = p_company), 10000)::numeric
$$;
revoke all on function public._conta_pago_topes(uuid) from public, anon, authenticated;

-- Lo aprobado hoy (hora de Madrid) en la empresa, sin lo cancelado ni lo rechazado.
create or replace function public._conta_pago_aprobado_hoy(p_company uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(s.amount), 0)::numeric(14,2) from public.conta_pago_salida s
   where s.company_id = p_company and s.estado not in ('cancelada', 'rechazada')
     and (s.created_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
$$;
revoke all on function public._conta_pago_aprobado_hoy(uuid) from public, anon, authenticated;

-- Con qué banco se paga desde una cuenta de la empresa, y si ya puede.
create or replace function public._conta_pago_salida_de(p_company uuid, p_treasury uuid)
returns table (proveedor text, banco text, puede boolean, porque text) language plpgsql stable security definer set search_path = public as $$
declare v_t public.treasury_account; v_c public.revolut_conexion;
begin
  select * into v_t from public.treasury_account where id = p_treasury and company_id = p_company and is_active;
  if v_t.id is null then return query select null::text, null::text, false, 'Esa cuenta del banco no es de la empresa.'; return; end if;
  if not exists (select 1 from public.bank_aggregator_link b where b.treasury_account_id = p_treasury and b.company_id = p_company and b.provider = 'revolut' and b.status = 'activo') then
    return query select null::text, null::text, false, format('Desde «%s» no se puede pagar con Sumied: paga con la remesa o desde el banco.', v_t.name); return;
  end if;
  select * into v_c from public.revolut_conexion where company_id = p_company;
  if v_c.id is null or v_c.estado <> 'conectada' then
    return query select 'revolut'::text, 'Revolut'::text, false, 'Revolut no está conectado en esta empresa: conéctalo en Bancos › Cuentas y extractos.'; return;
  end if;
  if not ('PAY' = any (string_to_array(replace(coalesce(v_c.permisos, ''), ' ', ','), ','))) then
    return query select 'revolut'::text, 'Revolut'::text, false, 'Revolut está conectado solo para leer: pulsa «Activar pagos» en Bancos › Cuentas y extractos.'; return;
  end if;
  return query select 'revolut'::text, 'Revolut'::text, true, null::text;
end $$;
revoke all on function public._conta_pago_salida_de(uuid, uuid) from public, anon, authenticated;

-- Lo que queda por pagar de una factura, sin lo que ya va en una remesa viva ni en un pago vivo.
create or replace function public._conta_pago_pendiente(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select (coalesce((select r.pendiente from public.conta_recibida_pago r where r.invoice_id = p_invoice), 0)
          - public._pc01e2_en_remesa(p_invoice)
          - coalesce((select sum(s.amount) from public.conta_pago_salida s
                       where s.invoice_id = p_invoice and s.remesa_linea_id is null
                         and s.estado in ('esperando_segunda', 'lista', 'enviando', 'enviada', 'esperando_banco')), 0))::numeric(14,2)
$$;
revoke all on function public._conta_pago_pendiente(uuid) from public, anon, authenticated;

-- Una factura, lista para pagar por el banco: lo que saldría y por qué haría
-- falta la segunda aprobación. Si no se puede, el porqué (y no sale nada).
create or replace function public._conta_pago_factura(p_company uuid, p_invoice uuid, p_importe numeric, p_pagar_igual_porque text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid; v_inv public.supplier_invoice; v_s public.supplier; v_metodo text; v_iban text; v_pend numeric; v_imp numeric;
  v_chk record; v_motivos text[] := '{}'; v_topes record;
begin
  select account_id into v_acc from public.company where id = p_company;
  select * into v_inv from public.supplier_invoice where id = p_invoice and account_id = v_acc;
  if v_inv.id is null or coalesce(v_inv.company_id, p_company) <> p_company then return jsonb_build_object('porque', 'Esa factura no es de la empresa.'); end if;
  if v_inv.status <> 'aprobada' or v_inv.paid_at is not null then
    return jsonb_build_object('porque', format('La factura %s no está por pagar (está %s).', coalesce(v_inv.invoice_number, ''), case when v_inv.paid_at is not null then 'pagada' else v_inv.status end));
  end if;
  select * into v_s from public.supplier where id = v_inv.supplier_id and account_id = v_acc;
  if v_s.id is null then return jsonb_build_object('porque', format('La factura %s no tiene proveedor.', coalesce(v_inv.invoice_number, ''))); end if;
  v_metodo := coalesce(v_inv.payment_method, v_s.payment_method);
  if v_metodo in ('direct_debit', 'card', 'prepaid', 'cash', 'compensation') then
    return jsonb_build_object('porque', format('La factura %s no se paga por transferencia: %s.', coalesce(v_inv.invoice_number, ''),
      case v_metodo when 'direct_debit' then 'la paga el banco solo (domiciliada)' when 'card' then 'se paga con tarjeta'
        when 'prepaid' then 'se paga del saldo prepago' when 'compensation' then 'se compensa con su liquidación' else 'se paga en efectivo' end));
  end if;
  v_iban := public._pc01e2_iban(v_s.iban);
  if v_iban is null or not public._pc01e2b_iban_valido(v_iban) then
    return jsonb_build_object('porque', format('%s no tiene un IBAN válido en su ficha: pónselo antes de pagar.', coalesce(v_s.name, 'Su proveedor')));
  end if;
  if public._pc01e2_iban(v_inv.read_iban) is not null and v_inv.iban_decision is null and public._pc01e2_iban(v_inv.read_iban) <> v_iban then
    return jsonb_build_object('porque', format('La factura %s trae otro IBAN (···· %s) que el de la ficha de %s (···· %s): decide en su ficha si es el nuevo antes de pagarla.',
      coalesce(v_inv.invoice_number, ''), right(public._pc01e2_iban(v_inv.read_iban), 4), v_s.name, right(v_iban, 4)));
  end if;
  if public._pc01e2_cuenta_proveedor(p_company, v_s.id) is null then
    return jsonb_build_object('porque', format('%s no tiene su cuenta de proveedor (400) en el plan: sin ella el pago no tendría asiento.', v_s.name));
  end if;
  v_pend := public._conta_pago_pendiente(v_inv.id);
  v_imp := coalesce(p_importe, v_pend);
  if v_pend <= 0 then return jsonb_build_object('porque', format('A la factura %s no le queda nada por pagar fuera de remesas y pagos en marcha.', coalesce(v_inv.invoice_number, ''))); end if;
  if v_imp <= 0 or v_imp > v_pend + 0.005 then
    return jsonb_build_object('porque', format('A la factura %s le quedan %s por pagar: no se le pueden pagar %s.', coalesce(v_inv.invoice_number, ''),
      public.conta_euros_exactos(v_pend), public.conta_euros_exactos(v_imp)));
  end if;
  select * into v_chk from public._pc01e2_iban_como_esta(v_s.id, v_iban);
  if v_s.iban_unconfirmed_invoice_id is not null then v_motivos := v_motivos || 'iban_de_la_factura'::text;
  elsif v_chk.estado = 'cambiado' then v_motivos := v_motivos || 'iban_cambiado'::text;
  elsif v_chk.estado = 'primer_pago' then v_motivos := v_motivos || 'iban_nuevo'::text; end if;
  select * into v_topes from public._conta_pago_topes(p_company);
  if v_imp > v_topes.tope_pago then v_motivos := v_motivos || 'tope_pago'::text; end if;
  if nullif(trim(coalesce(p_pagar_igual_porque, '')), '') is not null then v_motivos := v_motivos || 'pagar_igual'::text; end if;
  return jsonb_build_object('porque', null, 'factura', v_inv.id, 'numero', v_inv.invoice_number, 'proveedor', v_s.id,
    'beneficiario', coalesce(nullif(trim(v_s.legal_name), ''), v_s.name), 'iban', v_iban, 'iban4', right(v_iban, 4),
    'iban_check', v_chk.estado, 'iban_nota', v_chk.nota, 'importe', v_imp, 'pendiente', v_pend,
    'concepto', left(coalesce(nullif(v_inv.invoice_number, ''), 'Factura ' || to_char(v_inv.invoice_date, 'DD/MM/YYYY')), 140),
    'motivos', to_jsonb(v_motivos));
end $$;
revoke all on function public._conta_pago_factura(uuid, uuid, numeric, text) from public, anon, authenticated;

-- El texto de un motivo de segunda aprobación.
create or replace function public._conta_pago_motivo(p text)
returns text language sql immutable as $$
  select case p when 'iban_nuevo' then 'IBAN nuevo' when 'iban_cambiado' then 'IBAN cambiado' when 'iban_de_la_factura' then 'IBAN leído de la factura'
    when 'tope_pago' then 'por encima del tope por pago' when 'tope_dia' then 'por encima del tope del día'
    when 'pagar_igual' then 'pagar igual con un titular que no coincide' else p end
$$;
revoke all on function public._conta_pago_motivo(text) from public, anon;
grant execute on function public._conta_pago_motivo(text) to authenticated;

-- ── 7 · Lo que usa la pantalla (como la persona) ───────────────────────────
-- Quién puede pagar, y si puedo yo («Pídeselo a X, que puede pagar»).
create or replace function public.conta_pago_quien(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_pago_empresa(p_company); v_p jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('nombre', p.nombre, 'yo', p.user_id = auth.uid())), '[]'::jsonb) into v_p from public._conta_pago_pagadores(p_company) p;
  return jsonb_build_object('yo_puedo', public._conta_pago_puede(p_company, auth.uid()), 'soy_admin', public.current_user_is_admin_of(v_acc),
    'personas', v_p, 'n', jsonb_array_length(v_p),
    'segunda', case when jsonb_array_length(v_p) >= 2 then 'otra' else 'la_misma' end);
end $$;
revoke all on function public.conta_pago_quien(uuid) from public, anon;
grant execute on function public.conta_pago_quien(uuid) to authenticated;

-- Dar el permiso de pagar (solo un administrador; también a sí mismo).
create or replace function public.conta_pago_permiso_dar(p_company uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid := public._conta_pago_empresa(p_company); v_n int; v_nombre text;
begin
  if not public.current_user_is_admin_of(v_acc) then raise exception 'Solo un administrador da el permiso de pagar.' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_profiles where user_id = p_user and account_id = v_acc and active) then
    raise exception 'Esa persona no está activa en la cuenta.' using errcode = '23514';
  end if;
  v_nombre := public._conta_pago_nombre(p_user);
  if public._conta_pago_puede(p_company, p_user) then
    select count(*) into v_n from public._conta_pago_pagadores(p_company);
    return jsonb_build_object('n', v_n, 'frase', format('%s ya podía pagar.', v_nombre));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_pago_permiso:' || p_company::text, 0));
  update public.conta_pago_permiso set revoked_at = now(), revoked_by_name = 'Sumied (ya no estaba activa)'
   where company_id = p_company and user_id = p_user and revoked_at is null;
  insert into public.conta_pago_permiso (account_id, company_id, user_id, user_name, granted_by, granted_by_name)
  values (v_acc, p_company, p_user, v_nombre, auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'));
  select count(*) into v_n from public._conta_pago_pagadores(p_company);
  return jsonb_build_object('n', v_n, 'frase', format('%s ya puede pagar. %s', v_nombre,
    case when v_n = 1 then 'Es la única persona que paga: confirma la segunda aprobación con su llave (o con su PIN de pago).'
         else format('Pueden pagar %s personas: la segunda aprobación la da otra de ellas, con su llave o su PIN.', v_n) end));
end $$;
revoke all on function public.conta_pago_permiso_dar(uuid, uuid) from public, anon;
grant execute on function public.conta_pago_permiso_dar(uuid, uuid) to authenticated;

-- Quitar el permiso de pagar (solo un administrador).
create or replace function public.conta_pago_permiso_quitar(p_company uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid := public._conta_pago_empresa(p_company); v_n int; v_k int;
begin
  if not public.current_user_is_admin_of(v_acc) then raise exception 'Solo un administrador quita el permiso de pagar.' using errcode = '42501'; end if;
  update public.conta_pago_permiso set revoked_at = now(), revoked_by_name = coalesce(public.conta_nombre_actor(), 'Sumied')
   where company_id = p_company and user_id = p_user and revoked_at is null;
  get diagnostics v_k = row_count;
  select count(*) into v_n from public._conta_pago_pagadores(p_company);
  return jsonb_build_object('n', v_n, 'frase', case when v_k = 0 then format('%s no podía pagar.', public._conta_pago_nombre(p_user))
    else format('%s ya no puede pagar. %s', public._conta_pago_nombre(p_user),
      case when v_n = 0 then 'Ahora no puede pagar nadie desde Sumied.' when v_n = 1 then 'Queda 1 persona que puede pagar.' else format('Quedan %s personas que pueden pagar.', v_n) end) end);
end $$;
revoke all on function public.conta_pago_permiso_quitar(uuid, uuid) from public, anon;
grant execute on function public.conta_pago_permiso_quitar(uuid, uuid) to authenticated;

-- Los topes de la empresa, y cambiarlos (solo un administrador).
create or replace function public.conta_pago_topes(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_t record;
begin
  perform public._conta_pago_empresa(p_company);
  select * into v_t from public._conta_pago_topes(p_company);
  return jsonb_build_object('tope_pago', v_t.tope_pago, 'tope_dia', v_t.tope_dia, 'aprobado_hoy', public._conta_pago_aprobado_hoy(p_company));
end $$;
revoke all on function public.conta_pago_topes(uuid) from public, anon;
grant execute on function public.conta_pago_topes(uuid) to authenticated;

create or replace function public.conta_pago_topes_poner(p_company uuid, p_tope_pago numeric, p_tope_dia numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid := public._conta_pago_empresa(p_company);
begin
  if not public.current_user_is_admin_of(v_acc) then raise exception 'Solo un administrador cambia los topes de pago.' using errcode = '42501'; end if;
  if p_tope_pago is null or p_tope_dia is null or p_tope_pago <= 0 or p_tope_dia <= 0 then raise exception 'Los dos topes tienen que ser mayores que cero.' using errcode = '22023'; end if;
  if p_tope_pago > p_tope_dia then raise exception 'El tope por pago no puede ser mayor que el del día.' using errcode = '22023'; end if;
  insert into public.conta_pago_ajustes (company_id, account_id, tope_pago, tope_dia, updated_by, updated_by_name)
  values (p_company, v_acc, round(p_tope_pago, 2), round(p_tope_dia, 2), auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  on conflict (company_id) do update set tope_pago = excluded.tope_pago, tope_dia = excluded.tope_dia,
    updated_at = now(), updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('frase', format('Topes guardados: %s por pago y %s al día. Por encima, hace falta una segunda aprobación.',
    public.conta_euros_exactos(round(p_tope_pago, 2)), public.conta_euros_exactos(round(p_tope_dia, 2))));
end $$;
revoke all on function public.conta_pago_topes_poner(uuid, numeric, numeric) from public, anon;
grant execute on function public.conta_pago_topes_poner(uuid, numeric, numeric) to authenticated;

-- El panel «Pagar»: lo que saldría, desde dónde, si hace falta la segunda y
-- quién la da. No escribe nada.
create or replace function public.conta_pago_preparar(p_company uuid, p_invoice uuid, p_treasury uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_pago_empresa(p_company); v_f jsonb; v_sal record; v_t record; v_hoy numeric; v_motivos jsonb; v_quien jsonb;
begin
  v_f := public._conta_pago_factura(p_company, p_invoice, null, null);
  select * into v_sal from public._conta_pago_salida_de(p_company, p_treasury);
  v_quien := public.conta_pago_quien(p_company);
  if v_f->>'porque' is null then
    select * into v_t from public._conta_pago_topes(p_company);
    v_hoy := public._conta_pago_aprobado_hoy(p_company);
    v_motivos := v_f->'motivos';
    if v_hoy + (v_f->>'importe')::numeric > v_t.tope_dia then v_motivos := v_motivos || '"tope_dia"'::jsonb; end if;
    v_f := v_f || jsonb_build_object('motivos', v_motivos,
      'motivos_texto', (select coalesce(jsonb_agg(public._conta_pago_motivo(m)), '[]'::jsonb) from jsonb_array_elements_text(v_motivos) m),
      'tope_pago', v_t.tope_pago, 'tope_dia', v_t.tope_dia, 'aprobado_hoy', v_hoy);
  end if;
  return v_f || jsonb_build_object('se_puede', v_f->>'porque' is null and v_sal.puede and (v_quien->>'yo_puedo')::boolean,
    'salida', jsonb_build_object('proveedor', v_sal.proveedor, 'banco', v_sal.banco, 'puede', v_sal.puede, 'porque', v_sal.porque),
    'quien', v_quien,
    'porque', coalesce(v_f->>'porque', v_sal.porque,
      case when not (v_quien->>'yo_puedo')::boolean then
        case when (v_quien->>'n')::int = 0 then 'Nadie tiene todavía el permiso de pagar en esta empresa: lo da un administrador al «Activar pagos».'
             else format('No tienes permiso para pagar. Pídeselo a %s, que puede pagar.', (select string_agg(x->>'nombre', ' o ') from jsonb_array_elements(v_quien->'personas') x)) end end));
end $$;
revoke all on function public.conta_pago_preparar(uuid, uuid, uuid) from public, anon;
grant execute on function public.conta_pago_preparar(uuid, uuid, uuid) to authenticated;

-- «Aprobar y pagar»: la primera aprobación de uno o varios pagos que salen
-- juntos desde una cuenta. p_facturas: [{id, importe?, pagar_igual_porque?}].
-- Para sin crear nada si alguno no se puede pagar, y dice por qué. Si ninguno
-- pide segunda aprobación, el lote queda «listo» para mandarlo (2b).
create or replace function public.conta_pago_aprobar(p_company uuid, p_treasury uuid, p_facturas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid := public._conta_pago_empresa(p_company); v_sal record; v_t record; v_lote uuid; v_f jsonb; v_p jsonb; v_s uuid;
  v_vistas uuid[] := '{}'; v_total numeric := 0; v_n int := 0; v_motivos text[] := '{}'; v_m text; v_quien jsonb; v_huella text; v_yo text;
begin
  if not public._conta_pago_puede(p_company, auth.uid()) then
    raise exception 'No tienes permiso para pagar en esta empresa.' using errcode = '42501';
  end if;
  select * into v_sal from public._conta_pago_salida_de(p_company, p_treasury);
  if not v_sal.puede then raise exception '%', v_sal.porque using errcode = '23514'; end if;
  if jsonb_typeof(p_facturas) <> 'array' or jsonb_array_length(p_facturas) = 0 then raise exception 'Elige al menos una factura.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_pago_aprobar:' || p_company::text, 0));
  v_yo := coalesce(public.conta_nombre_actor(), 'Sumied');
  insert into public.conta_pago_lote (account_id, company_id, treasury_account_id, proveedor, estado, huella, created_by, created_by_name)
  values (v_acc, p_company, p_treasury, v_sal.proveedor, 'esperando_segunda', repeat('0', 64), auth.uid(), v_yo)
  returning id into v_lote;
  for v_f in select * from jsonb_array_elements(p_facturas) loop
    if (v_f->>'id')::uuid = any(v_vistas) then raise exception 'Una factura está dos veces.' using errcode = '23514'; end if;
    v_vistas := v_vistas || (v_f->>'id')::uuid;
    perform 1 from public.supplier_invoice where id = (v_f->>'id')::uuid and account_id = v_acc for update;
    v_p := public._conta_pago_factura(p_company, (v_f->>'id')::uuid, nullif(v_f->>'importe', '')::numeric, v_f->>'pagar_igual_porque');
    if v_p->>'porque' is not null then raise exception '%', v_p->>'porque' using errcode = '23514'; end if;
    insert into public.conta_pago_salida (account_id, company_id, lote_id, invoice_id, supplier_id, amount, beneficiario, iban, iban_check, iban_nota,
                                          concepto, motivos, pagar_igual_porque, estado)
    values (v_acc, p_company, v_lote, (v_p->>'factura')::uuid, (v_p->>'proveedor')::uuid, (v_p->>'importe')::numeric, v_p->>'beneficiario', v_p->>'iban',
            v_p->>'iban_check', v_p->>'iban_nota', v_p->>'concepto', array(select jsonb_array_elements_text(v_p->'motivos')),
            nullif(trim(coalesce(v_f->>'pagar_igual_porque', '')), ''), 'esperando_segunda')
    returning id into v_s;
    v_motivos := v_motivos || array(select jsonb_array_elements_text(v_p->'motivos'));
    v_total := v_total + (v_p->>'importe')::numeric; v_n := v_n + 1;
    perform public._conta_pago_evento(v_acc, v_lote, v_s, v_yo, format('Aprueba pagar %s a %s (factura %s, IBAN ···· %s) desde %s.',
      public.conta_euros_exactos((v_p->>'importe')::numeric), v_p->>'beneficiario', coalesce(v_p->>'numero', 'sin número'), v_p->>'iban4', v_sal.banco));
  end loop;
  select * into v_t from public._conta_pago_topes(p_company);
  -- Lo aprobado hoy ya incluye este lote.
  if public._conta_pago_aprobado_hoy(p_company) > v_t.tope_dia then v_motivos := v_motivos || 'tope_dia'::text; end if;
  v_motivos := array(select distinct m from unnest(v_motivos) m order by m);
  v_huella := public._conta_pago_huella(v_lote);
  update public.conta_pago_lote set huella = v_huella, segunda_motivos = v_motivos,
    estado = case when cardinality(v_motivos) = 0 then 'listo' else 'esperando_segunda' end where id = v_lote;
  update public.conta_pago_salida set estado = case when cardinality(v_motivos) = 0 then 'lista' else 'esperando_segunda' end where lote_id = v_lote;
  v_quien := public.conta_pago_quien(p_company);
  if cardinality(v_motivos) > 0 then
    perform public._conta_pago_evento(v_acc, v_lote, null, v_yo, format('Pide la segunda aprobación (%s): %s.',
      (select string_agg(public._conta_pago_motivo(m), ', ') from unnest(v_motivos) m),
      case when v_quien->>'segunda' = 'otra' then 'la tiene que dar otra persona que pueda pagar, con su llave'
           else 'la da quien lo aprobó, con su llave o con su PIN de pago' end));
  end if;
  return jsonb_build_object('lote', v_lote, 'huella', v_huella, 'pagos', v_n, 'total', v_total,
    'estado', case when cardinality(v_motivos) = 0 then 'listo' else 'esperando_segunda' end,
    'segunda', case when cardinality(v_motivos) = 0 then null else jsonb_build_object('quien', v_quien->>'segunda', 'motivos', to_jsonb(v_motivos),
      'motivos_texto', (select jsonb_agg(public._conta_pago_motivo(m)) from unnest(v_motivos) m),
      'personas', (select coalesce(jsonb_agg(x->>'nombre'), '[]'::jsonb) from jsonb_array_elements(v_quien->'personas') x where not (x->>'yo')::boolean)) end,
    'frase', case when cardinality(v_motivos) = 0 then format('Aprobado: %s %s, %s, desde %s. Listo para mandarlo.', v_n, case when v_n = 1 then 'pago' else 'pagos' end,
                    public.conta_euros_exactos(v_total), v_sal.banco)
                  when v_quien->>'segunda' = 'otra' then format('Aprobado por ti. Falta la segunda aprobación de otra persona que pueda pagar (%s). Hasta entonces no sale nada.',
                    (select string_agg(public._conta_pago_motivo(m), ', ') from unnest(v_motivos) m))
                  else format('Aprobado por ti. Confírmalo con tu llave (%s). Hasta entonces no sale nada.',
                    (select string_agg(public._conta_pago_motivo(m), ', ') from unnest(v_motivos) m)) end);
end $$;
revoke all on function public.conta_pago_aprobar(uuid, uuid, jsonb) from public, anon;
grant execute on function public.conta_pago_aprobar(uuid, uuid, jsonb) to authenticated;

-- «No pagar»: cancela un lote que aún no ha salido. Quien lo aprobó o quien puede pagar.
create or replace function public.conta_pago_cancelar(p_lote uuid, p_porque text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l public.conta_pago_lote; v_yo text := coalesce(public.conta_nombre_actor(), 'Sumied'); v_n int;
begin
  select * into v_l from public.conta_pago_lote where id = p_lote for update;
  if v_l.id is null then raise exception 'Ese pago no existe.' using errcode = 'P0002'; end if;
  perform public._conta_pago_empresa(v_l.company_id);
  if not (auth.uid() = v_l.created_by or public._conta_pago_puede(v_l.company_id, auth.uid())) then
    raise exception 'No tienes permiso para pagar en esta empresa.' using errcode = '42501';
  end if;
  if v_l.estado not in ('esperando_segunda', 'listo') then raise exception 'Este pago ya se ha mandado al banco: no se puede cancelar desde aquí.' using errcode = '23514'; end if;
  update public.conta_pago_lote set estado = 'cancelado', cancelado_at = now(), cancelado_por_nombre = v_yo,
    cancelado_porque = coalesce(nullif(trim(coalesce(p_porque, '')), ''), 'No pagar') where id = p_lote;
  update public.conta_pago_salida set estado = 'cancelada', estado_porque = coalesce(nullif(trim(coalesce(p_porque, '')), ''), 'No pagar'), estado_at = now()
   where lote_id = p_lote and estado in ('esperando_segunda', 'lista');
  get diagnostics v_n = row_count;
  update public.conta_pago_reto set descartado_at = now() where lote_id = p_lote and used_at is null and descartado_at is null;
  perform public._conta_pago_evento(v_l.account_id, p_lote, null, v_yo, format('No pagar: %s.', coalesce(nullif(trim(coalesce(p_porque, '')), ''), 'cancelado')));
  return jsonb_build_object('frase', format('No ha salido nada: %s %s cancelado%s. Las facturas siguen por pagar.', v_n, case when v_n = 1 then 'pago' else 'pagos' end, case when v_n = 1 then '' else 's' end));
end $$;
revoke all on function public.conta_pago_cancelar(uuid, text) from public, anon;
grant execute on function public.conta_pago_cancelar(uuid, text) to authenticated;

-- La pantalla de la segunda aprobación: la lista exacta, por qué y quién.
create or replace function public.conta_pago_lote_ver(p_lote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_l public.conta_pago_lote; v_t public.treasury_account;
begin
  select * into v_l from public.conta_pago_lote where id = p_lote;
  if v_l.id is null then raise exception 'Ese pago no existe.' using errcode = 'P0002'; end if;
  perform public._conta_pago_empresa(v_l.company_id);
  select * into v_t from public.treasury_account where id = v_l.treasury_account_id;
  return jsonb_build_object('lote', v_l.id, 'estado', v_l.estado, 'huella', v_l.huella, 'creado', v_l.created_at, 'aprobado_por', v_l.created_by_name,
    'desde', jsonb_build_object('nombre', v_t.name, 'iban4', right(public._pc01e2_iban(v_t.iban), 4), 'banco', 'Revolut'),
    'motivos', to_jsonb(v_l.segunda_motivos), 'motivos_texto', (select coalesce(jsonb_agg(public._conta_pago_motivo(m)), '[]'::jsonb) from unnest(v_l.segunda_motivos) m),
    'puedo_dar', public._conta_pago_puede_dar(p_lote, auth.uid()) is null, 'no_puedo_porque', public._conta_pago_puede_dar(p_lote, auth.uid()),
    'segunda', case when v_l.segunda_at is not null then jsonb_build_object('por', v_l.segunda_por_nombre, 'at', v_l.segunda_at, 'via', v_l.segunda_via, 'dispositivo', v_l.segunda_dispositivo) end,
    'total', (select coalesce(sum(amount), 0) from public.conta_pago_salida where lote_id = p_lote and estado <> 'cancelada'),
    'pagos', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'factura', s.invoice_id, 'concepto', s.concepto, 'beneficiario', s.beneficiario,
                'iban4', right(s.iban, 4), 'iban_check', s.iban_check, 'importe', s.amount, 'estado', s.estado,
                'motivos_texto', (select coalesce(jsonb_agg(public._conta_pago_motivo(m)), '[]'::jsonb) from unnest(s.motivos) m)) order by s.created_at), '[]'::jsonb)
                from public.conta_pago_salida s where s.lote_id = p_lote),
    'historial', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'por', e.by_name, 'texto', e.texto) order by e.at), '[]'::jsonb)
                    from public.conta_pago_evento e where e.lote_id = p_lote));
end $$;
revoke all on function public.conta_pago_lote_ver(uuid) from public, anon;
grant execute on function public.conta_pago_lote_ver(uuid) to authenticated;

-- Lo que espera MI segunda aprobación (con dos o más personas que pagan).
create or replace function public.conta_pago_para_mi(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._conta_pago_empresa(p_company);
  return (select coalesce(jsonb_agg(jsonb_build_object('lote', l.id, 'aprobado_por', l.created_by_name, 'creado', l.created_at,
            'total', (select sum(amount) from public.conta_pago_salida s where s.lote_id = l.id and s.estado <> 'cancelada'),
            'pagos', (select count(*) from public.conta_pago_salida s where s.lote_id = l.id and s.estado <> 'cancelada')) order by l.created_at), '[]'::jsonb)
            from public.conta_pago_lote l
           where l.company_id = p_company and l.estado = 'esperando_segunda' and public._conta_pago_puede_dar(l.id, auth.uid()) is null
             and l.created_by <> auth.uid());
end $$;
revoke all on function public.conta_pago_para_mi(uuid) from public, anon;
grant execute on function public.conta_pago_para_mi(uuid) to authenticated;

-- Mis llaves, y quitar una (también desde otro dispositivo, si pierdo el mío).
create or replace function public.conta_llaves_mias()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'direccion', rp_id, 'dispositivo', dispositivo, 'creada', created_at, 'usada', last_used_at) order by created_at), '[]'::jsonb)
    from public.conta_llave where user_id = auth.uid() and revoked_at is null
$$;
revoke all on function public.conta_llaves_mias() from public, anon;
grant execute on function public.conta_llaves_mias() to authenticated;

create or replace function public.conta_llave_quitar(p_llave uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_k public.conta_llave;
begin
  select * into v_k from public.conta_llave where id = p_llave and user_id = auth.uid() and revoked_at is null for update;
  if v_k.id is null then raise exception 'Esa llave no es tuya o ya está quitada.' using errcode = 'P0002'; end if;
  update public.conta_llave set revoked_at = now(), revoked_by_name = coalesce(public.conta_nombre_actor(), 'Sumied') where id = p_llave;
  return jsonb_build_object('frase', format('Llave quitada%s. Desde ese dispositivo, Sumied te pedirá tu PIN de pago.',
    case when v_k.dispositivo is not null then ' (' || v_k.dispositivo || ')' else '' end));
end $$;
revoke all on function public.conta_llave_quitar(uuid) from public, anon;
grant execute on function public.conta_llave_quitar(uuid) to authenticated;

-- ── 8 · Lo que usa la función que comprueba la llave (clave de servicio, 2b) ──
-- Un reto nuevo de un solo uso (10 minutos). Descarta los anteriores sin usar
-- de la misma persona y el mismo propósito (y lote).
create or replace function public.conta_pago_reto_crear(p_user uuid, p_proposito text, p_via text, p_reto_huella text, p_lote uuid, p_correo_mascara text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l public.conta_pago_lote; v_no text; v_id uuid; v_acc uuid;
begin
  if p_proposito = 'confirmar' then
    select * into v_l from public.conta_pago_lote where id = p_lote for update;
    v_no := public._conta_pago_puede_dar(p_lote, p_user);
    if v_no is not null then raise exception '%', v_no using errcode = '42501'; end if;
    v_acc := v_l.account_id;
  elsif p_proposito = 'registrar' then
    -- Registrar una llave nueva pide antes el código del correo, usado hace menos de 10 minutos y sin llave todavía.
    if not exists (select 1 from public.conta_pago_reto r where r.user_id = p_user and r.proposito = 'activar_llave' and r.used_at > now() - interval '10 minutes' and r.llave_id is null) then
      raise exception 'Para activar una llave nueva, confirma antes que eres tú con el código del correo.' using errcode = '42501';
    end if;
  elsif p_proposito not in ('activar_llave', 'crear_pin') then
    raise exception 'Propósito de reto desconocido.' using errcode = '22023';
  end if;
  update public.conta_pago_reto set descartado_at = now()
   where user_id = p_user and proposito = p_proposito and lote_id is not distinct from p_lote and used_at is null and descartado_at is null;
  insert into public.conta_pago_reto (user_id, account_id, lote_id, proposito, via, reto_huella, huella_lote, correo_mascara, expires_at)
  values (p_user, v_acc, case when p_proposito = 'confirmar' then p_lote end, p_proposito, p_via, lower(p_reto_huella), v_l.huella, p_correo_mascara, now() + interval '10 minutes')
  returning id into v_id;
  return jsonb_build_object('reto', v_id, 'caduca', now() + interval '10 minutes');
end $$;
revoke all on function public.conta_pago_reto_crear(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.conta_pago_reto_crear(uuid, text, text, text, uuid, text) to service_role;

-- Usar un reto. Con el código del correo (activar la llave o crear el PIN):
-- si no coincide, un intento menos; al tercero, el reto deja de valer. Con la
-- llave: la función ya comprobó la firma; aquí, que el reto es ese, de esa
-- persona, vivo y de un solo uso. Si confirma un lote, da la segunda
-- aprobación (la lista tiene que seguir siendo la misma).
create or replace function public.conta_pago_reto_usar(p_reto uuid, p_user uuid, p_reto_huella text, p_dispositivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_pago_reto; v_n int;
begin
  select * into v_r from public.conta_pago_reto where id = p_reto for update;
  if v_r.id is null or v_r.user_id <> p_user then return jsonb_build_object('ok', false, 'porque', 'Ese código no es tuyo. Pide otro.'); end if;
  if v_r.used_at is not null then return jsonb_build_object('ok', false, 'porque', 'Ese código ya se usó: vale una sola vez. Pide otro.'); end if;
  if v_r.descartado_at is not null then return jsonb_build_object('ok', false, 'porque', 'Ese código ya no vale: se pidió otro después, o el pago se canceló.'); end if;
  if v_r.expires_at < now() then
    return jsonb_build_object('ok', false, 'caducado', true, 'porque', format('Ha caducado. Valía 10 minutos y se pidió a las %s. Pide otro%s.',
      to_char(v_r.created_at at time zone 'Europe/Madrid', 'HH24:MI'), case when v_r.proposito = 'confirmar' then ': los pagos siguen aprobados y esperando' else '' end));
  end if;
  if lower(p_reto_huella) <> v_r.reto_huella then
    if v_r.via = 'llave' then
      update public.conta_pago_reto set descartado_at = now() where id = p_reto;
      return jsonb_build_object('ok', false, 'porque', 'La llave no ha firmado esto. Vuelve a pulsar el botón.');
    end if;
    update public.conta_pago_reto set intentos = intentos + 1 where id = p_reto returning intentos into v_n;
    if v_n >= 3 then
      update public.conta_pago_reto set descartado_at = now() where id = p_reto;
      return jsonb_build_object('ok', false, 'porque', 'Tres códigos equivocados: este ya no vale. Pide otro.');
    end if;
    return jsonb_build_object('ok', false, 'quedan', 3 - v_n, 'porque', format('Ese código no es el que te hemos mandado. Te %s %s %s.',
      case when 3 - v_n = 1 then 'queda' else 'quedan' end, 3 - v_n, case when 3 - v_n = 1 then 'intento' else 'intentos' end));
  end if;
  if v_r.proposito = 'confirmar' then
    return public._conta_pago_segunda_dar(v_r.lote_id, p_user, v_r.huella_lote, 'llave', p_dispositivo, p_reto);
  end if;
  update public.conta_pago_reto set used_at = now() where id = p_reto;
  return jsonb_build_object('ok', true, 'proposito', v_r.proposito);
end $$;
revoke all on function public.conta_pago_reto_usar(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_pago_reto_usar(uuid, uuid, text, text) to service_role;

-- La segunda aprobación de un lote, con la llave (su reto) o con el PIN. Es de
-- la lista que la persona vio: si la lista ha cambiado desde entonces, no vale.
create or replace function public._conta_pago_segunda_dar(p_lote uuid, p_user uuid, p_huella_vista text, p_via text, p_dispositivo text, p_reto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l public.conta_pago_lote; v_no text; v_n int; v_nombre text := public._conta_pago_nombre(p_user);
begin
  select * into v_l from public.conta_pago_lote where id = p_lote for update;
  v_no := public._conta_pago_puede_dar(p_lote, p_user);
  if v_no is not null then return jsonb_build_object('ok', false, 'porque', v_no); end if;
  if public._conta_pago_huella(v_l.id) <> v_l.huella or v_l.huella <> lower(coalesce(p_huella_vista, '')) then
    if p_reto is not null then update public.conta_pago_reto set descartado_at = now() where id = p_reto; end if;
    return jsonb_build_object('ok', false, 'porque', 'La lista de pagos ha cambiado desde que la viste: esta confirmación ya no vale. Vuelve a abrirla.');
  end if;
  if p_reto is not null then update public.conta_pago_reto set used_at = now() where id = p_reto; end if;
  update public.conta_pago_lote set estado = 'listo', segunda_por = p_user, segunda_por_nombre = v_nombre, segunda_at = now(),
    segunda_via = p_via, segunda_dispositivo = nullif(left(trim(coalesce(p_dispositivo, '')), 80), '') where id = v_l.id;
  update public.conta_pago_salida set estado = 'lista', estado_at = now() where lote_id = v_l.id and estado = 'esperando_segunda';
  get diagnostics v_n = row_count;
  perform public._conta_pago_evento(v_l.account_id, v_l.id, null, v_nombre, format('Segunda aprobación: %s, con %s%s · %s.', v_nombre,
    case when p_via = 'llave' then 'su llave' else 'su PIN de pago' end,
    case when nullif(trim(coalesce(p_dispositivo, '')), '') is not null then ' (' || left(trim(p_dispositivo), 80) || ')' else '' end,
    (select string_agg(public._conta_pago_motivo(m), ', ') from unnest(v_l.segunda_motivos) m)));
  return jsonb_build_object('ok', true, 'lote', v_l.id, 'pagos', v_n, 'frase', format('Confirmado con %s a las %s: %s %s para mandar.',
    case when p_via = 'llave' then 'tu llave' else 'tu PIN de pago' end, to_char(now() at time zone 'Europe/Madrid', 'HH24:MI'), v_n, case when v_n = 1 then 'pago listo' else 'pagos listos' end));
end $$;
revoke all on function public._conta_pago_segunda_dar(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;

-- ── El PIN de pago (clave de servicio: lo cifra y lo compara la función del 2b) ──
-- La sal del PIN de una persona (para cifrar el que teclea), o null si no tiene.
create or replace function public.conta_pago_pin_sal(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('sal', sal, 'bloqueado', bloqueado_at is not null, 'quedan', 5 - intentos)
    from public.conta_pago_pin where user_id = p_user
$$;
revoke all on function public.conta_pago_pin_sal(uuid) from public, anon, authenticated;
grant execute on function public.conta_pago_pin_sal(uuid) to service_role;

-- Crear el PIN, o cambiarlo tras olvidarlo o bloquearlo: pide el código del
-- correo usado hace menos de 10 minutos para «crear_pin» (y lo consume).
create or replace function public.conta_pago_pin_guardar(p_user uuid, p_pin_cifrado text, p_sal text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_codigo uuid; v_habia boolean;
begin
  select id into v_codigo from public.conta_pago_reto
   where user_id = p_user and proposito = 'crear_pin' and used_at > now() - interval '10 minutes' and llave_id is null and descartado_at is null
   order by used_at desc limit 1 for update;
  if v_codigo is null then raise exception 'Para crear tu PIN de pago, confirma antes que eres tú con el código del correo.' using errcode = '42501'; end if;
  update public.conta_pago_reto set descartado_at = now() where id = v_codigo;
  select exists (select 1 from public.conta_pago_pin where user_id = p_user) into v_habia;
  insert into public.conta_pago_pin (user_id, pin_cifrado, sal) values (p_user, lower(p_pin_cifrado), lower(p_sal))
  on conflict (user_id) do update set pin_cifrado = excluded.pin_cifrado, sal = excluded.sal, intentos = 0, bloqueado_at = null, cambiado_at = now();
  return jsonb_build_object('nuevo', not v_habia, 'frase', case when v_habia then 'PIN de pago cambiado. Te hemos avisado al correo.'
    else 'PIN de pago guardado. Lo usarás cuando no tengas tu llave a mano.' end);
end $$;
revoke all on function public.conta_pago_pin_guardar(uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_pago_pin_guardar(uuid, text, text) to service_role;

-- Confirmar un lote con el PIN: la función manda el PIN tecleado ya cifrado
-- con la sal de la persona y la huella de la lista que vio. Si no coincide, un
-- intento menos; con 5 fallos se bloquea (los pagos siguen esperando).
create or replace function public.conta_pago_pin_confirmar(p_user uuid, p_lote uuid, p_pin_cifrado text, p_huella_vista text, p_dispositivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p public.conta_pago_pin; v_no text; v_n int;
begin
  v_no := public._conta_pago_puede_dar(p_lote, p_user);
  if v_no is not null then return jsonb_build_object('ok', false, 'porque', v_no); end if;
  select * into v_p from public.conta_pago_pin where user_id = p_user for update;
  if v_p.user_id is null then return jsonb_build_object('ok', false, 'sin_pin', true, 'porque', 'Todavía no tienes PIN de pago: créalo con el código del correo, o confirma con tu llave.'); end if;
  if v_p.bloqueado_at is not null then
    return jsonb_build_object('ok', false, 'bloqueado', true, 'porque', 'Tu PIN de pago está bloqueado. No ha salido ningún pago: siguen aprobados y esperando. Confírmalos con tu llave, o crea un PIN nuevo con el código del correo.');
  end if;
  if lower(coalesce(p_pin_cifrado, '')) <> v_p.pin_cifrado then
    update public.conta_pago_pin set intentos = intentos + 1, bloqueado_at = case when intentos + 1 >= 5 then now() end where user_id = p_user returning intentos into v_n;
    if v_n >= 5 then
      perform public._conta_pago_evento((select account_id from public.conta_pago_lote where id = p_lote), p_lote, null, 'Sumied',
        format('PIN de pago de %s bloqueado tras 5 fallos. No ha salido nada.', public._conta_pago_nombre(p_user)));
      return jsonb_build_object('ok', false, 'bloqueado', true, 'aviso_correo', true, 'porque', 'Tu PIN de pago está bloqueado: 5 fallos. No ha salido ningún pago: siguen aprobados y esperando. Confírmalos con tu llave, o crea un PIN nuevo con el código del correo.');
    end if;
    return jsonb_build_object('ok', false, 'quedan', 5 - v_n, 'porque', format('Ese no es tu PIN de pago. Te %s %s %s. Con 5 fallos se bloquea y tendrás que recuperarlo con el código del correo. Los pagos siguen aprobados y esperando.',
      case when 5 - v_n = 1 then 'queda' else 'quedan' end, 5 - v_n, case when 5 - v_n = 1 then 'intento' else 'intentos' end));
  end if;
  update public.conta_pago_pin set intentos = 0 where user_id = p_user;
  return public._conta_pago_segunda_dar(p_lote, p_user, p_huella_vista, 'pin', p_dispositivo, null);
end $$;
revoke all on function public.conta_pago_pin_confirmar(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_pago_pin_confirmar(uuid, uuid, text, text, text) to service_role;

-- ¿Tengo PIN de pago? (la pantalla: crearlo, o «bloqueado»).
create or replace function public.conta_pago_pin_mio()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tiene', exists (select 1 from public.conta_pago_pin where user_id = auth.uid()),
    'bloqueado', exists (select 1 from public.conta_pago_pin where user_id = auth.uid() and bloqueado_at is not null),
    'quedan', (select 5 - intentos from public.conta_pago_pin where user_id = auth.uid()))
$$;
revoke all on function public.conta_pago_pin_mio() from public, anon;
grant execute on function public.conta_pago_pin_mio() to authenticated;

-- Guardar una llave nueva, ya comprobada por la función: consume el reto de
-- registrar y el código del correo que lo permitió.
create or replace function public.conta_llave_guardar(p_user uuid, p_reto uuid, p_reto_huella text, p_credential_id text, p_public_key text,
                                                      p_algoritmo integer, p_sign_count bigint, p_rp_id text, p_dispositivo text, p_transports text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_pago_reto; v_id uuid; v_codigo uuid;
begin
  select * into v_r from public.conta_pago_reto where id = p_reto and user_id = p_user and proposito = 'registrar' for update;
  if v_r.id is null or v_r.used_at is not null or v_r.descartado_at is not null or v_r.expires_at < now() or lower(p_reto_huella) <> v_r.reto_huella then
    raise exception 'Este intento de activar la llave ya no vale. Vuelve a empezar.' using errcode = '42501';
  end if;
  select id into v_codigo from public.conta_pago_reto where user_id = p_user and proposito = 'activar_llave' and used_at > now() - interval '10 minutes' and llave_id is null
   order by used_at desc limit 1 for update;
  if v_codigo is null then raise exception 'Para activar una llave nueva, confirma antes que eres tú con el código del correo.' using errcode = '42501'; end if;
  insert into public.conta_llave (user_id, credential_id, public_key, algoritmo, sign_count, rp_id, dispositivo, transports)
  values (p_user, p_credential_id, p_public_key, p_algoritmo, coalesce(p_sign_count, 0), lower(p_rp_id), nullif(left(trim(coalesce(p_dispositivo, '')), 80), ''), coalesce(p_transports, '{}'))
  returning id into v_id;
  update public.conta_pago_reto set used_at = now(), llave_id = v_id where id = p_reto;
  update public.conta_pago_reto set llave_id = v_id where id = v_codigo;
  return jsonb_build_object('llave', v_id, 'frase', format('Llave activada%s. Desde ahora confirmas los pagos con ella.',
    case when nullif(trim(coalesce(p_dispositivo, '')), '') is not null then ' en ' || left(trim(p_dispositivo), 80) else '' end));
end $$;
revoke all on function public.conta_llave_guardar(uuid, uuid, text, text, text, integer, bigint, text, text, text[]) from public, anon, authenticated;
grant execute on function public.conta_llave_guardar(uuid, uuid, text, text, text, integer, bigint, text, text, text[]) to service_role;

-- La llave con la que firma una persona (para comprobar la firma), y apuntar
-- que se usó. El contador tiene que subir: si no, la llave puede estar copiada.
create or replace function public.conta_llave_de(p_user uuid, p_credential_id text, p_rp_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'public_key', public_key, 'algoritmo', algoritmo, 'sign_count', sign_count, 'dispositivo', dispositivo)
    from public.conta_llave where user_id = p_user and credential_id = p_credential_id and rp_id = lower(p_rp_id) and revoked_at is null
$$;
revoke all on function public.conta_llave_de(uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_llave_de(uuid, text, text) to service_role;

create or replace function public.conta_llaves_de(p_user uuid, p_rp_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('credential_id', credential_id, 'transports', transports)), '[]'::jsonb)
    from public.conta_llave where user_id = p_user and rp_id = lower(p_rp_id) and revoked_at is null
$$;
revoke all on function public.conta_llaves_de(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_llaves_de(uuid, text) to service_role;

create or replace function public.conta_llave_usada(p_llave uuid, p_sign_count bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_k public.conta_llave;
begin
  select * into v_k from public.conta_llave where id = p_llave and revoked_at is null for update;
  if v_k.id is null then return jsonb_build_object('ok', false, 'porque', 'Esa llave ya no está activa.'); end if;
  if coalesce(p_sign_count, 0) > 0 and coalesce(p_sign_count, 0) <= v_k.sign_count then
    update public.conta_llave set revoked_at = now(), revoked_by_name = 'Sumied (el contador de la llave no subió: puede estar copiada)' where id = p_llave;
    return jsonb_build_object('ok', false, 'porque', 'Esta llave parece copiada (su contador no ha subido) y la hemos quitado. Confirma con tu PIN de pago y vuelve a activar tu llave con el código del correo.');
  end if;
  update public.conta_llave set sign_count = greatest(sign_count, coalesce(p_sign_count, 0)), last_used_at = now() where id = p_llave;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.conta_llave_usada(uuid, bigint) from public, anon, authenticated;
grant execute on function public.conta_llave_usada(uuid, bigint) to service_role;

-- conta_lectura (los agentes) lee los pagos y su registro (nunca las llaves ni los retos), si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on public.conta_pago_permiso, public.conta_pago_ajustes, public.conta_pago_lote, public.conta_pago_salida, public.conta_pago_evento to conta_lectura;
  end if;
end $$;
