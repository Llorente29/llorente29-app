-- 20261027T1121_pc01e4_enlace_pago.sql
--
-- PC01 · Entrega 4 · Punto 2 · COBRAR CON TARJETA Y BIZUM, por Stripe
-- (Respuesta 10 al PC01, 27/10, con lo que contestó la sonda).
--
--   1. conta_cobro_stripe: la cuenta de Stripe de cada empresa (la crea
--      conta-stripe con el alta que funcionó en la sonda) y el estado de cada
--      método, en palabras: activo, falta_alta, revisando. Y si se cobra de
--      verdad: «prueba» hasta que Julio la pase a «real», empresa a empresa
--      (en producción, con la clave real, una empresa en «prueba» no cobra).
--   2. conta_enlace_pago: el enlace de pago de una factura (uno abierto por
--      factura), cuántas veces se ha abierto y, cuando Stripe confirma, el cobro.
--   3. Las funciones:
--        · conta_cobro_stripe_leer: lo que ve «Cómo te pagan»;
--        · conta_cobro_stripe_apuntar / _de (solo el servidor): guardar la
--          cuenta y su estado, y de qué empresa es una cuenta de Stripe;
--        · conta_enlace_pago_para (solo el servidor): el enlace de una factura,
--          si la empresa cobra con tarjeta (lo pide el recordatorio);
--        · conta_enlace_pago_ver (sin cuenta, anon): lo que enseña la página de
--          pago, y cuenta la apertura;
--        · conta_enlace_pago_datos / _sesion / _cobrado (solo el servidor): la
--          sesión de pago de Stripe y el cobro. El cobro lo apunta el motor de
--          la E1 (customer_invoice_payment, «tarjeta» o «bizum»), sin asiento:
--          como un cobro por banco, el abono de Stripe se casa en Bancos (la
--          comisión, a la 626);
--        · conta_enlaces_pago_resumen: la columna «Recordatorios» de Cobros
--          («con enlace · abierta 2 veces»).
--
-- SOLO AÑADE: dos tablas y funciones nuevas. No toca filas al aplicarse, ni nada
-- del camino del pedido, ni coste ni stock. La tienda de Folvy (accounts.
-- stripe_account_id, stripe-connect-onboard) no se toca.

-- 1. La cuenta de Stripe de cada empresa ---------------------------------------------
create table if not exists public.conta_cobro_stripe (
  company_id         uuid primary key references public.company(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  stripe_account_id  text not null unique,
  modo               text not null default 'prueba' check (modo in ('prueba', 'real')),
  tarjeta            text not null default 'falta_alta' check (tarjeta in ('activo', 'falta_alta', 'revisando')),
  bizum              text not null default 'falta_alta' check (bizum in ('activo', 'falta_alta', 'revisando')),
  bizum_encendido    boolean not null default false,
  pendiente          integer not null default 0,
  leido_at           timestamptz,
  created_at         timestamptz not null default now(),
  created_by_name    text
);
comment on table public.conta_cobro_stripe is
  'PC01 · E4 · La cuenta de Stripe de cada empresa para cobrar con tarjeta y Bizum (alta v2, panel completo, Stripe cubre las pérdidas) y el estado de cada método. modo: «prueba» hasta que Julio la pase a «real».';
alter table public.conta_cobro_stripe enable row level security;
revoke all on table public.conta_cobro_stripe from public, anon, authenticated;
grant select on table public.conta_cobro_stripe to authenticated;
drop policy if exists conta_cobro_stripe_leer on public.conta_cobro_stripe;
create policy conta_cobro_stripe_leer on public.conta_cobro_stripe for select to authenticated using (public.belongs_to_account(account_id));

-- 2. El enlace de pago de una factura -------------------------------------------------
create table if not exists public.conta_enlace_pago (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  invoice_id   uuid not null references public.customer_invoice(id) on delete cascade,
  token        text not null unique check (token ~ '^[0-9a-f]{64}$'),
  status       text not null default 'abierto' check (status in ('abierto', 'pagado', 'anulado')),
  aperturas    integer not null default 0,
  abierto_at   timestamptz,
  sesion       text,
  pago_ref     text,
  metodo       text check (metodo in ('tarjeta', 'bizum')),
  importe      numeric(14,2),
  pagado_at    timestamptz,
  payment_id   uuid references public.customer_invoice_payment(id) on delete set null,
  created_at   timestamptz not null default now()
);
comment on table public.conta_enlace_pago is
  'PC01 · E4 · El enlace de pago (tarjeta y Bizum) de una factura de venta: su token de un solo uso, cuántas veces se ha abierto y, al cobrarse, con qué y cuánto.';
create unique index if not exists conta_enlace_pago_abierto on public.conta_enlace_pago (invoice_id) where status = 'abierto';
create index if not exists conta_enlace_pago_sesion_idx on public.conta_enlace_pago (sesion);
alter table public.conta_enlace_pago enable row level security;
revoke all on table public.conta_enlace_pago from public, anon, authenticated;
grant select on table public.conta_enlace_pago to authenticated;
drop policy if exists conta_enlace_pago_leer on public.conta_enlace_pago;
create policy conta_enlace_pago_leer on public.conta_enlace_pago for select to authenticated using (public.belongs_to_account(account_id));

-- 3. Las funciones --------------------------------------------------------------------
-- «Cómo te pagan»: la cuenta de Stripe de la empresa y su estado (null si no hay).
create or replace function public.conta_cobro_stripe_leer(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v public.conta_cobro_stripe;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  select * into v from public.conta_cobro_stripe where company_id = p_company;
  if v.company_id is null then return null; end if;
  return jsonb_build_object('tarjeta', v.tarjeta, 'bizum', v.bizum, 'bizum_encendido', v.bizum_encendido, 'pendiente', v.pendiente,
                            'modo', v.modo, 'leido', v.leido_at, 'desde', v.created_at);
end $$;
revoke all on function public.conta_cobro_stripe_leer(uuid) from public, anon;
grant execute on function public.conta_cobro_stripe_leer(uuid) to authenticated;

-- Guardar la cuenta y su estado (solo el servidor: conta-stripe y el aviso de Stripe).
create or replace function public.conta_cobro_stripe_apuntar(p_company uuid, p_stripe text, p_tarjeta text, p_bizum text,
                                                            p_bizum_encendido boolean, p_pendiente integer, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v public.conta_cobro_stripe;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  insert into public.conta_cobro_stripe (company_id, account_id, stripe_account_id, tarjeta, bizum, bizum_encendido, pendiente, leido_at, created_by_name)
  values (p_company, v_cuenta, p_stripe, coalesce(p_tarjeta, 'falta_alta'), coalesce(p_bizum, 'falta_alta'), coalesce(p_bizum_encendido, false),
          coalesce(p_pendiente, 0), now(), p_quien)
  on conflict (company_id) do update set
    tarjeta = coalesce(p_tarjeta, conta_cobro_stripe.tarjeta), bizum = coalesce(p_bizum, conta_cobro_stripe.bizum),
    bizum_encendido = coalesce(p_bizum_encendido, conta_cobro_stripe.bizum_encendido), pendiente = coalesce(p_pendiente, conta_cobro_stripe.pendiente),
    leido_at = now()
  where conta_cobro_stripe.stripe_account_id = excluded.stripe_account_id
  returning * into v;
  if v.company_id is null then raise exception 'Esta empresa ya tiene otra cuenta de Stripe.' using errcode = '23505'; end if;
  return jsonb_build_object('tarjeta', v.tarjeta, 'bizum', v.bizum, 'bizum_encendido', v.bizum_encendido, 'pendiente', v.pendiente, 'modo', v.modo);
end $$;
revoke all on function public.conta_cobro_stripe_apuntar(uuid, text, text, text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.conta_cobro_stripe_apuntar(uuid, text, text, text, boolean, integer, text) to service_role;

-- De qué empresa es una cuenta de Stripe, y su modo (solo el servidor).
create or replace function public.conta_cobro_stripe_de(p_stripe text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('empresa', company_id, 'cuenta', account_id, 'stripe', stripe_account_id, 'modo', modo, 'tarjeta', tarjeta, 'bizum', bizum)
    from public.conta_cobro_stripe where stripe_account_id = p_stripe
$$;
revoke all on function public.conta_cobro_stripe_de(text) from public, anon, authenticated;
grant execute on function public.conta_cobro_stripe_de(text) to service_role;

-- La cuenta de Stripe de una empresa (solo el servidor: conta-stripe la busca antes de crear otra).
create or replace function public.conta_cobro_stripe_de_empresa(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('empresa', company_id, 'cuenta', account_id, 'stripe', stripe_account_id, 'modo', modo, 'tarjeta', tarjeta, 'bizum', bizum, 'bizum_encendido', bizum_encendido)
    from public.conta_cobro_stripe where company_id = p_company
$$;
revoke all on function public.conta_cobro_stripe_de_empresa(uuid) from public, anon, authenticated;
grant execute on function public.conta_cobro_stripe_de_empresa(uuid) to service_role;

-- El enlace de pago de una factura (solo el servidor): el abierto que tenga, o
-- uno nuevo. Null si la empresa no cobra con tarjeta, si es de plataforma, si
-- está cobrada o si no queda nada pendiente.
create or replace function public.conta_enlace_pago_para(p_invoice uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.customer_invoice; c record; s public.conta_cobro_stripe; v_token text;
begin
  select * into v from public.customer_invoice where id = p_invoice;
  if v.id is null or v.status <> 'emitida' then return null; end if;
  select * into c from public.conta_factura_cobro where invoice_id = p_invoice;
  if c.invoice_id is null or c.de_plataforma or c.total <= 0 or c.pendiente < 0.005 then return null; end if;
  select * into s from public.conta_cobro_stripe where company_id = v.company_id;
  if s.company_id is null or s.tarjeta <> 'activo' then return null; end if;
  select token into v_token from public.conta_enlace_pago where invoice_id = p_invoice and status = 'abierto';
  if v_token is not null then return v_token; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.conta_enlace_pago (account_id, company_id, invoice_id, token) values (v.account_id, v.company_id, v.id, v_token);
  perform public._conta_venta_evento(v.id, 'enlace_pago', 'Enlace de pago preparado (tarjeta' || case when s.bizum = 'activo' then ' y Bizum' else '' end || ').', null, 'Sumied');
  return v_token;
end $$;
revoke all on function public.conta_enlace_pago_para(uuid) from public, anon, authenticated;
grant execute on function public.conta_enlace_pago_para(uuid) to service_role;

-- Lo que enseña la página de pago, SIN CUENTA (anon): con el token y nada más.
-- Cuenta la apertura. Nunca enseña identificadores de Stripe.
create or replace function public.conta_enlace_pago_ver(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.conta_enlace_pago; v public.customer_invoice; c record; s public.conta_cobro_stripe; co public.company;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('estado', 'no_existe'); end if;
  select * into e from public.conta_enlace_pago where token = p_token;
  if e.id is null then return jsonb_build_object('estado', 'no_existe'); end if;
  select * into v from public.customer_invoice where id = e.invoice_id;
  select * into c from public.conta_factura_cobro where invoice_id = e.invoice_id;
  select * into s from public.conta_cobro_stripe where company_id = e.company_id;
  select * into co from public.company where id = e.company_id;
  if e.status = 'abierto' then
    update public.conta_enlace_pago set aperturas = aperturas + 1, abierto_at = now() where id = e.id;
  end if;
  return jsonb_build_object(
    'estado', case when e.status = 'pagado' then 'pagado' when e.status = 'anulado' then 'anulado'
                   when c.pendiente < 0.005 then 'cobrada' when s.company_id is null or s.tarjeta <> 'activo' then 'sin_cobro' else 'abierto' end,
    'empresa', coalesce(nullif(trim(co.trade_name), ''), co.legal_name), 'color', co.color,
    'factura', v.number_text, 'fecha', v.issue_date, 'vence', v.due_date, 'total', c.total, 'pendiente', c.pendiente,
    'metodos', case when s.company_id is null then '[]'::jsonb
                    else jsonb_build_array('tarjeta') || case when s.bizum = 'activo' then '["bizum"]'::jsonb else '[]'::jsonb end end,
    'pagado', case when e.status = 'pagado' then jsonb_build_object('el', e.pagado_at, 'con', e.metodo, 'importe', e.importe) end);
end $$;
revoke all on function public.conta_enlace_pago_ver(text) from public;
grant execute on function public.conta_enlace_pago_ver(text) to anon, authenticated;

-- Los datos para la sesión de pago de Stripe (solo el servidor: conta-pago).
create or replace function public.conta_enlace_pago_datos(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enlace', e.id, 'estado', e.status, 'empresa_id', e.company_id, 'factura_id', e.invoice_id, 'factura', v.number_text, 'pendiente', c.pendiente,
                            'empresa', coalesce(nullif(trim(co.trade_name), ''), co.legal_name), 'correo', nullif(lower(trim(v.email_to)), ''),
                            'stripe', s.stripe_account_id, 'modo', s.modo, 'tarjeta', s.tarjeta, 'bizum', s.bizum)
    from public.conta_enlace_pago e
    join public.customer_invoice v on v.id = e.invoice_id
    join public.conta_factura_cobro c on c.invoice_id = e.invoice_id
    join public.company co on co.id = e.company_id
    left join public.conta_cobro_stripe s on s.company_id = e.company_id
   where e.token = p_token
$$;
revoke all on function public.conta_enlace_pago_datos(text) from public, anon, authenticated;
grant execute on function public.conta_enlace_pago_datos(text) to service_role;

create or replace function public.conta_enlace_pago_sesion(p_token text, p_sesion text)
returns void language sql security definer set search_path = public as $$
  update public.conta_enlace_pago set sesion = p_sesion where token = p_token and status = 'abierto'
$$;
revoke all on function public.conta_enlace_pago_sesion(text, text) from public, anon, authenticated;
grant execute on function public.conta_enlace_pago_sesion(text, text) to service_role;

-- Stripe confirma el pago (solo el servidor: el aviso de Stripe). Una vez por
-- sesión: el segundo aviso no hace nada. El cobro, por el motor de la E1, sin
-- pasar de lo pendiente (lo que sobre lo dice el historial).
create or replace function public.conta_enlace_pago_cobrado(p_sesion text, p_stripe text, p_pago_ref text, p_importe numeric, p_metodo text, p_fecha date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.conta_enlace_pago; v public.customer_invoice; v_queda numeric; v_apunta numeric; v_pago uuid; v_metodo text;
begin
  select * into e from public.conta_enlace_pago where sesion = p_sesion for update;
  if e.id is null then return jsonb_build_object('hecho', false, 'motivo', 'no_existe'); end if;
  if e.status = 'pagado' then return jsonb_build_object('hecho', false, 'motivo', 'ya_cobrado'); end if;
  if not exists (select 1 from public.conta_cobro_stripe where company_id = e.company_id and stripe_account_id = p_stripe) then
    return jsonb_build_object('hecho', false, 'motivo', 'otra_cuenta');
  end if;
  select * into v from public.customer_invoice where id = e.invoice_id for update;
  v_metodo := case when lower(coalesce(p_metodo, '')) = 'bizum' then 'bizum' else 'tarjeta' end;
  v_queda := v.total - coalesce((select sum(amount) from public.customer_invoice_payment where invoice_id = v.id), 0);
  v_apunta := least(coalesce(p_importe, 0), greatest(v_queda, 0));
  if v_apunta > 0 then
    insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by_name)
    values (v.account_id, v.company_id, v.id, coalesce(p_fecha, public.conta_hoy()), v_apunta, v_metodo,
            'Enlace de pago (' || case when v_metodo = 'bizum' then 'Bizum' else 'tarjeta' end || ')', 'Sumied')
    returning id into v_pago;
  end if;
  update public.conta_enlace_pago set status = 'pagado', pago_ref = p_pago_ref, metodo = v_metodo, importe = p_importe, pagado_at = now(), payment_id = v_pago
   where id = e.id;
  perform public._conta_venta_evento(v.id, 'cobro',
    format('Cobro de %s con %s por el enlace de pago%s', public.conta_euros_exactos(p_importe), case when v_metodo = 'bizum' then 'Bizum' else 'tarjeta' end,
      case when coalesce(p_importe, 0) > v_apunta then format(': se apuntan %s, lo que quedaba; el resto, %s, lo tiene Stripe y hay que devolverlo.',
                                                       public.conta_euros_exactos(v_apunta), public.conta_euros_exactos(p_importe - v_apunta))
           when v_queda - v_apunta < 0.005 then ': cobrada entera.' else format('; quedan %s.', public.conta_euros_exactos(v_queda - v_apunta)) end),
    jsonb_build_object('importe', p_importe, 'apuntado', v_apunta, 'metodo', v_metodo, 'enlace', e.id), 'Sumied');
  return jsonb_build_object('hecho', true, 'factura', v.id, 'apuntado', v_apunta, 'sobra', greatest(coalesce(p_importe, 0) - v_apunta, 0));
end $$;
revoke all on function public.conta_enlace_pago_cobrado(text, text, text, numeric, text, date) from public, anon, authenticated;
grant execute on function public.conta_enlace_pago_cobrado(text, text, text, numeric, text, date) to service_role;

-- La columna «Recordatorios» de Cobros: los enlaces de las facturas por cobrar.
create or replace function public.conta_enlaces_pago_resumen(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.invoice_id, 'aperturas', e.aperturas, 'abierto', e.abierto_at))
                     from public.conta_enlace_pago e where e.company_id = p_company and e.status = 'abierto'), '[]'::jsonb);
end $$;
revoke all on function public.conta_enlaces_pago_resumen(uuid) from public, anon;
grant execute on function public.conta_enlaces_pago_resumen(uuid) to authenticated;

-- conta_lectura (los agentes) lee las tablas, si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on public.conta_cobro_stripe, public.conta_enlace_pago to conta_lectura;
  end if;
end $$;
