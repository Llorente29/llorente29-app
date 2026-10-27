-- 20261027T2030_s01_redsys_y_abono.sql
--
-- S01 · PR 1 · Lo que faltó de la entrega 4 del PC01: REDSYS como segundo
-- proveedor del enlace de pago, y CASAR EN BANCOS EL ABONO del proveedor con su
-- comisión.
--
--   1. conta_cobro_redsys: los datos del TPV virtual de cada empresa (número de
--      comercio, terminal, si el banco tiene Bizum). La CLAVE va a la caja
--      fuerte (Vault): en la tabla solo queda el id de su secreto. «cobra» lo
--      pone conta-redsys al guardar: sí si Julio ha pasado la empresa a real
--      (REDSYS_COBRO_REAL) o si el entorno es de pruebas (REDSYS_PRUEBAS). Sin
--      eso, ni enlace ni cobro: unos datos de prueba en producción no apuntan
--      cobros de mentira en los libros de verdad.
--   2. conta_enlace_pago, cuatro columnas que admiten vacío: con qué proveedor
--      se cobró, la comisión y el neto que dice Stripe, y el casado del banco
--      que trajo el abono.
--   3. conta_enlace_pago_intento: cada vez que el cliente pulsa «Pagar» con
--      Redsys, un número de pedido nuevo (Redsys no deja repetirlo).
--   4. conta_redsys_aviso: cada aviso del banco, también los mal firmados (se
--      apuntan y no cobran nada).
--   5. Las funciones:
--        · conta_cobro_redsys_leer: lo que ve «Cómo te pagan» (nunca la clave);
--        · conta_cobro_redsys_guardar (solo el servidor, conta-redsys): guarda
--          los datos y la clave en Vault;
--        · conta_cobro_redsys_datos / conta_redsys_aviso_datos (solo el
--          servidor): los datos con la clave, para firmar y para comprobar;
--        · conta_enlace_pago_pedido (solo el servidor): el número de pedido;
--        · _s01_enlace_cobrar: el cobro de un enlace por el motor de la E1, una
--          vez y sin pasarse de lo pendiente (lo usan Stripe y Redsys);
--        · conta_enlace_pago_cobrado_redsys y conta_redsys_aviso_apuntar (solo
--          el servidor): el aviso del banco;
--        · conta_enlace_pago_comision (solo el servidor): la comisión de Stripe;
--        · conta_abonos_pasarela_pendientes: los cobros que esperan su abono
--          (los lee el motor de conciliación);
--        · conta_abono_pasarela_casar: casa el abono con sus cobros: un asiento,
--          572 del banco por el neto y 626 por la comisión, contra la cuenta de
--          la pasarela, que vuelve a cero por esos cobros;
--        · conta_cobros_abonos: «Cobrado · pendiente del abono» o «abonado el».
--   6. (Respuesta 1 al S01 · PR 1) LA CUENTA DE LA PASARELA: el día que el
--      cliente paga, ya no debe. El cobro por el enlace hace su asiento ese día
--      (_s01_asiento_cobro): la cuenta de la pasarela al debe, contra la 430 del
--      cliente. La cuenta es una subcuenta de tesorería por proveedor y empresa,
--      colgada de la 572 («Stripe · por abonar», «TPV del banco · por abonar»),
--      que se crea sola la primera vez (_s01_cuenta_pasarela) con su cuenta de
--      tesorería (tipo «pasarela», la 2031 amplía el CHECK) para que Bancos la
--      enseñe con su saldo. conta_pasarela_cuenta dice cuál es la de cada una.
--      El asiento es de origen «customer_payment» (la 2031 amplía el CHECK) y
--      entra en el traspaso del mes como cualquier otro (C12).
--
-- SOLO AÑADE: cuatro tablas, columnas que admiten vacío y funciones nuevas. No
-- toca filas al aplicarse, ni nada del camino del pedido, ni coste ni stock.
-- La clave de Redsys la escribe en Vault la función al guardar, no el fichero.
-- Va con la 2031 (los dos CHECK que amplía): sus funciones usan «pasarela» y
-- «customer_payment» solo cuando cobran, nunca al aplicarse.

-- 1. Los datos del TPV virtual de cada empresa ----------------------------------------
create table if not exists public.conta_cobro_redsys (
  company_id       uuid primary key references public.company(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  comercio         text check (comercio is null or comercio ~ '^[0-9]{9}$'),
  terminal         text not null default '1' check (terminal ~ '^[0-9]{1,3}$'),
  clave_ref        uuid,
  bizum            boolean not null default false,
  en_enlace        boolean not null default true,
  modo             text not null default 'prueba' check (modo in ('prueba', 'real')),
  cobra            boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
comment on table public.conta_cobro_redsys is
  'S01 · El TPV virtual (Redsys) de cada empresa para el enlace de pago: comercio, terminal y si el banco tiene Bizum. La clave, en Vault (clave_ref). cobra: puede cobrar en este entorno (real, o pruebas abiertas).';
alter table public.conta_cobro_redsys enable row level security;
revoke all on table public.conta_cobro_redsys from public, anon, authenticated;

-- 2. El enlace: con quién se cobró, la comisión y el abono -----------------------------
alter table public.conta_enlace_pago add column if not exists proveedor text check (proveedor is null or proveedor in ('stripe', 'redsys'));
alter table public.conta_enlace_pago add column if not exists comision numeric(14,2);
alter table public.conta_enlace_pago add column if not exists neto numeric(14,2);
alter table public.conta_enlace_pago add column if not exists abono_match_id uuid references public.bank_match(id) on delete set null;
comment on column public.conta_enlace_pago.proveedor is 'S01 · Con quién se cobró: stripe o redsys.';
comment on column public.conta_enlace_pago.comision is 'S01 · La comisión que dice el proveedor (Stripe la da con el cobro; Redsys no: sale al casar el abono).';
comment on column public.conta_enlace_pago.neto is 'S01 · Lo que el proveedor abona de este cobro (Stripe).';
comment on column public.conta_enlace_pago.abono_match_id is 'S01 · El casado del banco que trajo el abono. Abonado solo si ese casado sigue vivo.';
create index if not exists conta_enlace_pago_abono_idx on public.conta_enlace_pago (company_id) where status = 'pagado' and payment_id is not null;

-- 3. Los intentos de pago con Redsys --------------------------------------------------
create table if not exists public.conta_enlace_pago_intento (
  pedido      text primary key check (pedido ~ '^[0-9]{12}$'),
  enlace_id   uuid not null references public.conta_enlace_pago(id) on delete cascade,
  proveedor   text not null check (proveedor in ('redsys')),
  importe     numeric(14,2) not null,
  created_at  timestamptz not null default now()
);
comment on table public.conta_enlace_pago_intento is 'S01 · Cada «Pagar» con Redsys: su número de pedido (no se puede repetir) y lo que se pidió.';
alter table public.conta_enlace_pago_intento enable row level security;
revoke all on table public.conta_enlace_pago_intento from public, anon, authenticated;

-- 4. Los avisos del banco -------------------------------------------------------------
create table if not exists public.conta_redsys_aviso (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  pedido      text,
  company_id  uuid references public.company(id) on delete set null,
  firma_ok    boolean not null,
  respuesta   text,
  importe     numeric(14,2),
  resultado   text not null,
  detalle     jsonb
);
comment on table public.conta_redsys_aviso is 'S01 · Cada aviso de Redsys, también los mal firmados (no cobran nada) y los denegados.';
create index if not exists conta_redsys_aviso_pedido_idx on public.conta_redsys_aviso (pedido);
alter table public.conta_redsys_aviso enable row level security;
revoke all on table public.conta_redsys_aviso from public, anon, authenticated;

-- 4b. La cuenta de la pasarela de cada empresa ---------------------------------------
create table if not exists public.conta_pasarela_cuenta (
  company_id          uuid not null references public.company(id) on delete cascade,
  proveedor           text not null check (proveedor in ('stripe', 'redsys')),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  treasury_account_id uuid not null references public.treasury_account(id) on delete cascade,
  company_account_id  uuid not null references public.company_account(id) on delete cascade,
  code                text not null,
  created_at          timestamptz not null default now(),
  primary key (company_id, proveedor)
);
comment on table public.conta_pasarela_cuenta is
  'S01 · La subcuenta de tesorería (572) de cada pasarela de cobro de una empresa: lo cobrado con tarjeta o Bizum que Stripe o el banco aún no han abonado.';
alter table public.conta_pasarela_cuenta enable row level security;
revoke all on table public.conta_pasarela_cuenta from public, anon, authenticated;
grant select on table public.conta_pasarela_cuenta to authenticated;
drop policy if exists conta_pasarela_cuenta_leer on public.conta_pasarela_cuenta;
create policy conta_pasarela_cuenta_leer on public.conta_pasarela_cuenta for select to authenticated
  using (public.belongs_to_account(account_id));

-- 5. Las funciones --------------------------------------------------------------------

-- El estado del TPV en palabras: falta_comercio, falta_clave, pruebas, activo.
create or replace function public._s01_redsys_estado(r public.conta_cobro_redsys)
returns text language sql immutable set search_path = public as $$
  select case when r.company_id is null then null when r.comercio is null then 'falta_comercio' when r.clave_ref is null then 'falta_clave'
              when r.modo = 'real' then 'activo' else 'pruebas' end
$$;
revoke all on function public._s01_redsys_estado(public.conta_cobro_redsys) from public, anon, authenticated;

-- Con quién cobra el enlace de una empresa: Redsys si está listo y elegido; si
-- no, Stripe con la tarjeta activa; si no, nadie.
create or replace function public._s01_proveedor_enlace(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.conta_cobro_redsys r where r.company_id = p_company and r.comercio is not null and r.clave_ref is not null and r.cobra and r.en_enlace) then 'redsys'
    when exists (select 1 from public.conta_cobro_stripe s where s.company_id = p_company and s.tarjeta = 'activo') then 'stripe'
  end
$$;
revoke all on function public._s01_proveedor_enlace(uuid) from public, anon, authenticated;

-- Con qué puede pagar el cliente: tarjeta y, si el proveedor lo tiene, Bizum.
create or replace function public._s01_metodos_enlace(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case public._s01_proveedor_enlace(p_company)
    when 'redsys' then '["tarjeta"]'::jsonb || case when (select bizum from public.conta_cobro_redsys where company_id = p_company) then '["bizum"]'::jsonb else '[]'::jsonb end
    when 'stripe' then '["tarjeta"]'::jsonb || case when (select bizum from public.conta_cobro_stripe where company_id = p_company) = 'activo' then '["bizum"]'::jsonb else '[]'::jsonb end
    else '[]'::jsonb end
$$;
revoke all on function public._s01_metodos_enlace(uuid) from public, anon, authenticated;

-- «Cómo te pagan»: el TPV de la empresa en palabras (null si no hay). Nunca la clave.
create or replace function public.conta_cobro_redsys_leer(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; r public.conta_cobro_redsys;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  select * into r from public.conta_cobro_redsys where company_id = p_company;
  if r.company_id is null then return null; end if;
  return jsonb_build_object('estado', public._s01_redsys_estado(r), 'comercio', r.comercio, 'terminal', r.terminal, 'con_clave', r.clave_ref is not null,
                            'bizum', r.bizum, 'en_enlace', r.en_enlace, 'modo', r.modo, 'cobra', r.cobra,
                            'proveedor_enlace', public._s01_proveedor_enlace(p_company),
                            'cambiado', jsonb_build_object('at', r.updated_at, 'por', r.updated_by_name));
end $$;
revoke all on function public.conta_cobro_redsys_leer(uuid) from public, anon;
grant execute on function public.conta_cobro_redsys_leer(uuid) to authenticated;

-- Guardar el TPV (solo el servidor: conta-redsys, que comprueba quién pulsa y
-- decide modo y cobra). La clave, a Vault: se crea o se cambia el secreto; sin
-- clave nueva, se queda la de antes. Devuelve la frase de lo guardado (regla 8).
create or replace function public.conta_cobro_redsys_guardar(p_company uuid, p_comercio text, p_terminal text, p_clave text, p_bizum boolean,
                                                            p_en_enlace boolean, p_modo text, p_cobra boolean, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; r public.conta_cobro_redsys; v_comercio text := nullif(regexp_replace(coalesce(p_comercio, ''), '\s', '', 'g'), '');
        v_terminal text := coalesce(nullif(ltrim(trim(coalesce(p_terminal, '')), '0'), ''), '1'); v_clave text := nullif(trim(coalesce(p_clave, '')), '');
        v_ref uuid; v_estado text; v_frase text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if v_comercio is not null and v_comercio !~ '^[0-9]{9}$' then raise exception 'El número de comercio son 9 cifras (te lo da tu banco con el TPV virtual).' using errcode = '22023'; end if;
  if v_terminal !~ '^[0-9]{1,3}$' then raise exception 'El terminal es un número de 1 a 3 cifras (casi siempre, 1).' using errcode = '22023'; end if;
  if v_clave is not null and (v_clave !~ '^[A-Za-z0-9+/]{32}$') then
    raise exception 'La clave del comercio son 32 letras y números (la «clave SHA-256» del TPV virtual, en el panel de tu banco).' using errcode = '22023';
  end if;
  if p_modo not in ('prueba', 'real') then raise exception 'Modo: prueba o real.' using errcode = '22023'; end if;
  select * into r from public.conta_cobro_redsys where company_id = p_company for update;
  v_ref := r.clave_ref;
  if v_clave is not null then
    if v_ref is null or not exists (select 1 from vault.secrets where id = v_ref) then
      select id into v_ref from vault.secrets where name = 'conta_redsys:' || p_company::text;
    end if;
    if v_ref is not null then
      perform vault.update_secret(v_ref, v_clave, 'conta_redsys:' || p_company::text, 'Clave del TPV virtual (Redsys) de una empresa de Sumied');
    else
      v_ref := vault.create_secret(v_clave, 'conta_redsys:' || p_company::text, 'Clave del TPV virtual (Redsys) de una empresa de Sumied');
    end if;
  end if;
  insert into public.conta_cobro_redsys (company_id, account_id, comercio, terminal, clave_ref, bizum, en_enlace, modo, cobra, updated_at, updated_by_name)
  values (p_company, v_cuenta, v_comercio, v_terminal, v_ref, coalesce(p_bizum, false), coalesce(p_en_enlace, true), p_modo, coalesce(p_cobra, false), now(), p_quien)
  on conflict (company_id) do update set comercio = excluded.comercio, terminal = excluded.terminal, clave_ref = excluded.clave_ref, bizum = excluded.bizum,
    en_enlace = excluded.en_enlace, modo = excluded.modo, cobra = excluded.cobra, updated_at = now(), updated_by_name = excluded.updated_by_name
  returning * into r;
  v_estado := public._s01_redsys_estado(r);
  v_frase := case v_estado
    when 'falta_comercio' then 'Guardado. A Redsys le falta el número de comercio.'
    when 'falta_clave' then format('Guardado. Redsys, comercio %s: falta la clave del comercio.', r.comercio)
    when 'pruebas' then format('Guardado. Redsys en pruebas, comercio %s%s.', r.comercio,
                               case when r.cobra then '' else ': tus clientes aún no pagan por aquí; lo abre Julio, empresa a empresa' end)
    else format('Guardado. Redsys activo, comercio %s: tus clientes ya pagan con tarjeta%s.', r.comercio, case when r.bizum then ' y Bizum' else '' end) end;
  return jsonb_build_object('frase', v_frase, 'estado', v_estado, 'proveedor_enlace', public._s01_proveedor_enlace(p_company));
end $$;
revoke all on function public.conta_cobro_redsys_guardar(uuid, text, text, text, boolean, boolean, text, boolean, text) from public, anon, authenticated;
grant execute on function public.conta_cobro_redsys_guardar(uuid, text, text, text, boolean, boolean, text, boolean, text) to service_role;

-- Los datos del TPV CON la clave (solo el servidor: conta-pago firma el pago).
create or replace function public.conta_cobro_redsys_datos(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('empresa', r.company_id, 'comercio', r.comercio, 'terminal', r.terminal, 'bizum', r.bizum, 'modo', r.modo, 'cobra', r.cobra,
                            'clave', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = r.clave_ref))
    from public.conta_cobro_redsys r where r.company_id = p_company
$$;
revoke all on function public.conta_cobro_redsys_datos(uuid) from public, anon, authenticated;
grant execute on function public.conta_cobro_redsys_datos(uuid) to service_role;

-- Un número de pedido para un «Pagar» con Redsys (solo el servidor: conta-pago).
-- 12 cifras: el día y la hora de Madrid y cuatro al azar; si ya existe, otro.
create or replace function public.conta_enlace_pago_pedido(p_token text, p_importe numeric)
returns text language plpgsql security definer set search_path = public as $$
declare e public.conta_enlace_pago; v_pedido text; i int := 0;
begin
  select * into e from public.conta_enlace_pago where token = p_token and status = 'abierto';
  if e.id is null then raise exception 'Ese enlace no está abierto.' using errcode = 'P0002'; end if;
  loop
    i := i + 1;
    v_pedido := to_char(now() at time zone 'Europe/Madrid', 'YYMMDDHH24') || lpad(floor(random() * 10000)::int::text, 4, '0');
    begin
      insert into public.conta_enlace_pago_intento (pedido, enlace_id, proveedor, importe) values (v_pedido, e.id, 'redsys', p_importe);
      exit;
    exception when unique_violation then
      if i >= 20 then raise; end if;
    end;
  end loop;
  update public.conta_enlace_pago set sesion = 'redsys:' || v_pedido where id = e.id;
  return v_pedido;
end $$;
revoke all on function public.conta_enlace_pago_pedido(text, numeric) from public, anon, authenticated;
grant execute on function public.conta_enlace_pago_pedido(text, numeric) to service_role;

-- De qué empresa es un pedido, con la clave para comprobar la firma del aviso (solo el servidor).
create or replace function public.conta_redsys_aviso_datos(p_pedido text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('empresa', e.company_id, 'enlace', e.id, 'comercio', r.comercio, 'terminal', r.terminal, 'modo', r.modo, 'cobra', r.cobra,
                            'clave', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = r.clave_ref))
    from public.conta_enlace_pago_intento i
    join public.conta_enlace_pago e on e.id = i.enlace_id
    left join public.conta_cobro_redsys r on r.company_id = e.company_id
   where i.pedido = p_pedido
$$;
revoke all on function public.conta_redsys_aviso_datos(text) from public, anon, authenticated;
grant execute on function public.conta_redsys_aviso_datos(text) to service_role;

-- La cuenta de la pasarela de una empresa (su código), creada la primera vez:
-- la subcuenta 572 siguiente con su nombre en palabras («Stripe · por abonar»,
-- «TPV del banco · por abonar»), su cuenta de tesorería de tipo «pasarela» (la
-- enseña Bancos con su saldo) y su enlace. Null si la empresa aún no tiene el
-- plan activado: entonces el cobro se apunta sin asiento y lo dice.
create or replace function public._s01_cuenta_pasarela(p_company uuid, p_proveedor text)
returns text language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_plan text; v_d int; v_code text; v_ca uuid; v_ta uuid; v_nombre text; v_existe text;
begin
  if p_proveedor not in ('stripe', 'redsys') then raise exception 'Proveedor: stripe o redsys.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_pasarela:' || p_company::text || ':' || p_proveedor, 0));
  select code into v_existe from public.conta_pasarela_cuenta where company_id = p_company and proveedor = p_proveedor;
  if v_existe is not null then return v_existe; end if;
  select account_id into v_cuenta from public.company where id = p_company;
  select a.plan into v_plan from public.company_account a where a.company_id = p_company and a.account_id = v_cuenta limit 1;
  if v_cuenta is null or v_plan is null then return null; end if;
  select p.account_digits into v_d from public.company_tax_profile p where p.company_id = p_company;
  v_code := public.company_account_siguiente(p_company, '572', coalesce(v_d, 8));
  if v_code is null then raise exception 'No queda numeración libre en 572 para la cuenta de la pasarela.' using errcode = '23514'; end if;
  v_nombre := case p_proveedor when 'stripe' then 'Stripe · por abonar' else 'TPV del banco · por abonar' end;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name)
  values (v_cuenta, p_company, v_plan, v_code, '572', v_nombre, v_nombre, 'own', 'manual', 'Sumied')
  returning id into v_ca;
  insert into public.treasury_account (account_id, company_id, kind, name, short_name)
  values (v_cuenta, p_company, 'pasarela', v_nombre, case p_proveedor when 'stripe' then 'Stripe' else 'TPV' end)
  returning id into v_ta;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_cuenta, p_company, v_ca, 'bank_account', v_ta::text, 'principal', 'manual');
  insert into public.conta_pasarela_cuenta (company_id, proveedor, account_id, treasury_account_id, company_account_id, code)
  values (p_company, p_proveedor, v_cuenta, v_ta, v_ca, v_code);
  return v_code;
end $$;
revoke all on function public._s01_cuenta_pasarela(uuid, text) from public, anon, authenticated;

-- El asiento de un cobro por el enlace, el día del cobro: la cuenta de la
-- pasarela al debe, contra la 430 del cliente, por lo cobrado. Origen
-- «customer_payment» (el cobro). Si ya lo tiene, nada. Si no se puede (sin la
-- 430 del cliente, sin plan, sin ejercicio), no lo hace y dice por qué: el
-- cobro queda apuntado igual y el historial de la factura lo cuenta.
create or replace function public._s01_asiento_cobro(p_payment uuid, p_proveedor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.customer_invoice_payment; v public.customer_invoice; v_cli text; v_pas text; v_res jsonb; v_entry uuid; v_nombre text; v_concepto text;
begin
  select * into p from public.customer_invoice_payment where id = p_payment for update;
  if p.id is null then return jsonb_build_object('asiento', null, 'motivo', 'el cobro no existe'); end if;
  if p.entry_id is not null and exists (select 1 from public.journal_entry where id = p.entry_id and status in ('propuesto', 'borrador', 'validado')) then
    return jsonb_build_object('asiento', p.entry_id, 'motivo', null, 'ya', true);
  end if;
  select * into v from public.customer_invoice where id = p.invoice_id;
  select coalesce(pa.name, v.customer->>'nombre') into v_nombre from public.party pa where pa.id = v.party_id;
  v_nombre := coalesce(v_nombre, v.customer->>'nombre', 'el cliente');
  v_cli := public._pc01e3_cuenta_cliente(p.company_id, v.party_id);
  if v_cli is null then return jsonb_build_object('asiento', null, 'motivo', format('%s no tiene su cuenta de cliente (430)', v_nombre)); end if;
  v_pas := public._s01_cuenta_pasarela(p.company_id, p_proveedor);
  if v_pas is null then return jsonb_build_object('asiento', null, 'motivo', 'la empresa aún no tiene el plan contable activado'); end if;
  v_concepto := format('Cobro %s · %s · %s', case p_proveedor when 'redsys' then 'TPV' else 'Stripe' end, v_nombre, coalesce(v.number_text, 'sin número'));
  v_res := public._journal_entry_proponer(p.company_id,
    jsonb_build_object('fecha', p.paid_on, 'series', (public._bank_ajustes(p.company_id)).treasury_series, 'concepto', v_concepto,
                       'source_type', 'customer_payment', 'source_id', p.id, 'confianza', 'seguro',
                       'porque', format('El cliente pagó %s con %s por el enlace de pago, y %s lo confirmó: ya no debe; queda por abonar en el banco.',
                                        public.conta_euros_exactos(p.amount), case when p.method = 'bizum' then 'Bizum' else 'tarjeta' end,
                                        case p_proveedor when 'redsys' then 'el banco' else 'Stripe' end),
                       'razones', '[]'::jsonb, 'party_id', v.party_id, 'documento', v.number_text),
    jsonb_build_array(
      jsonb_build_object('cuenta', v_pas, 'debe', p.amount, 'haber', 0, 'concepto', v_concepto, 'comun', true),
      jsonb_build_object('cuenta', v_cli, 'debe', 0, 'haber', p.amount, 'tercero_id', v.party_id, 'concepto', v_concepto, 'comun', true)),
    '{}'::jsonb, 'Sumied', null);
  v_entry := (v_res->>'id')::uuid;
  update public.customer_invoice_payment set entry_id = v_entry where id = p.id;
  return jsonb_build_object('asiento', v_entry, 'motivo', null, 'cuenta', v_pas);
end $$;
revoke all on function public._s01_asiento_cobro(uuid, text) from public, anon, authenticated;

-- El cobro de un enlace, por el motor de la E1 (customer_invoice_payment), con
-- su asiento el día del cobro (_s01_asiento_cobro: la pasarela contra la 430).
-- Una vez: el segundo aviso no hace nada. Sin pasarse de lo pendiente: lo que
-- sobre lo dice el historial. Si el asiento no se puede hacer, el cobro queda
-- apuntado igual y el historial dice por qué.
create or replace function public._s01_enlace_cobrar(p_enlace uuid, p_importe numeric, p_metodo text, p_ref text, p_proveedor text, p_fecha date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.conta_enlace_pago; v public.customer_invoice; v_queda numeric; v_apunta numeric; v_pago uuid; v_metodo text;
        v_as jsonb; v_texto_asiento text := '';
begin
  select * into e from public.conta_enlace_pago where id = p_enlace for update;
  if e.id is null then return jsonb_build_object('hecho', false, 'motivo', 'no_existe'); end if;
  if e.status = 'pagado' then return jsonb_build_object('hecho', false, 'motivo', 'ya_cobrado'); end if;
  select * into v from public.customer_invoice where id = e.invoice_id for update;
  v_metodo := case when lower(coalesce(p_metodo, '')) = 'bizum' then 'bizum' else 'tarjeta' end;
  v_queda := v.total - coalesce((select sum(amount) from public.customer_invoice_payment where invoice_id = v.id), 0);
  v_apunta := least(coalesce(p_importe, 0), greatest(v_queda, 0));
  if v_apunta > 0 then
    insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by_name)
    values (v.account_id, v.company_id, v.id, coalesce(p_fecha, public.conta_hoy()), v_apunta, v_metodo,
            'Enlace de pago (' || case when v_metodo = 'bizum' then 'Bizum' else 'tarjeta' end || ')', 'Sumied')
    returning id into v_pago;
    -- El asiento del cobro (la pasarela contra la 430). Lo que falle aquí no deshace el cobro: se dice.
    begin
      v_as := public._s01_asiento_cobro(v_pago, p_proveedor);
    exception when others then
      v_as := jsonb_build_object('asiento', null, 'motivo', sqlerrm);
    end;
    v_texto_asiento := case when v_as->>'asiento' is not null
      then format(' Asiento: %s, contra la 430 del cliente.', case p_proveedor when 'redsys' then 'TPV del banco · por abonar' else 'Stripe · por abonar' end)
      else format(' Sin asiento: %s.', v_as->>'motivo') end;
  end if;
  update public.conta_enlace_pago set status = 'pagado', pago_ref = p_ref, metodo = v_metodo, importe = p_importe, pagado_at = now(), payment_id = v_pago,
         proveedor = p_proveedor
   where id = e.id;
  perform public._conta_venta_evento(v.id, 'cobro',
    format('Cobro de %s con %s por el enlace de pago%s', public.conta_euros_exactos(p_importe), case when v_metodo = 'bizum' then 'Bizum' else 'tarjeta' end,
      case when coalesce(p_importe, 0) > v_apunta then format(': se apuntan %s, lo que quedaba; el resto, %s, lo tiene %s y hay que devolverlo.',
                                                       public.conta_euros_exactos(v_apunta), public.conta_euros_exactos(p_importe - v_apunta),
                                                       case when p_proveedor = 'redsys' then 'el banco' else 'Stripe' end)
           when v_queda - v_apunta < 0.005 then ': cobrada entera.' else format('; quedan %s.', public.conta_euros_exactos(v_queda - v_apunta)) end)
      || v_texto_asiento,
    jsonb_build_object('importe', p_importe, 'apuntado', v_apunta, 'metodo', v_metodo, 'enlace', e.id, 'proveedor', p_proveedor, 'asiento', v_as->>'asiento'), 'Sumied');
  return jsonb_build_object('hecho', true, 'factura', v.id, 'apuntado', v_apunta, 'sobra', greatest(coalesce(p_importe, 0) - v_apunta, 0),
                            'asiento', v_as->>'asiento');
end $$;
revoke all on function public._s01_enlace_cobrar(uuid, numeric, text, text, text, date) from public, anon, authenticated;

-- El banco confirma un pago con Redsys (solo el servidor: conta-redsys-aviso,
-- después de comprobar la firma). Solo del comercio de la empresa del pedido.
create or replace function public.conta_enlace_pago_cobrado_redsys(p_pedido text, p_comercio text, p_importe numeric, p_metodo text, p_autorizacion text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.conta_enlace_pago_intento; e public.conta_enlace_pago; r public.conta_cobro_redsys;
begin
  select * into i from public.conta_enlace_pago_intento where pedido = p_pedido;
  if i.pedido is null then return jsonb_build_object('hecho', false, 'motivo', 'no_existe'); end if;
  select * into e from public.conta_enlace_pago where id = i.enlace_id for update;
  select * into r from public.conta_cobro_redsys where company_id = e.company_id;
  if r.company_id is null or r.comercio is distinct from p_comercio then return jsonb_build_object('hecho', false, 'motivo', 'otro_comercio'); end if;
  if not r.cobra then return jsonb_build_object('hecho', false, 'motivo', 'no_cobra'); end if;
  return public._s01_enlace_cobrar(e.id, p_importe, p_metodo, 'redsys:' || p_pedido || coalesce(':' || nullif(trim(p_autorizacion), ''), ''), 'redsys', null);
end $$;
revoke all on function public.conta_enlace_pago_cobrado_redsys(text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.conta_enlace_pago_cobrado_redsys(text, text, numeric, text, text) to service_role;

-- Cada aviso de Redsys queda apuntado, con su firma buena o mala y lo que se hizo (solo el servidor).
create or replace function public.conta_redsys_aviso_apuntar(p_pedido text, p_empresa uuid, p_firma_ok boolean, p_respuesta text, p_importe numeric,
                                                            p_resultado text, p_detalle jsonb)
returns uuid language sql security definer set search_path = public as $$
  insert into public.conta_redsys_aviso (pedido, company_id, firma_ok, respuesta, importe, resultado, detalle)
  values (left(p_pedido, 40), p_empresa, coalesce(p_firma_ok, false), left(p_respuesta, 10), p_importe, left(coalesce(p_resultado, '?'), 400), p_detalle)
  returning id
$$;
revoke all on function public.conta_redsys_aviso_apuntar(text, uuid, boolean, text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.conta_redsys_aviso_apuntar(text, uuid, boolean, text, numeric, text, jsonb) to service_role;

-- La comisión y el neto de un cobro con Stripe, como los da su movimiento de saldo (solo el servidor).
create or replace function public.conta_enlace_pago_comision(p_sesion text, p_comision numeric, p_neto numeric)
returns void language sql security definer set search_path = public as $$
  update public.conta_enlace_pago set comision = round(p_comision, 2), neto = round(p_neto, 2) where sesion = p_sesion and status = 'pagado'
$$;
revoke all on function public.conta_enlace_pago_comision(text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.conta_enlace_pago_comision(text, numeric, numeric) to service_role;

-- Los cobros por el enlace que esperan su abono en el banco (los lee el motor
-- de conciliación). Lo cobrado (bruto) es lo apuntado a la factura; «cuenta»,
-- la de la pasarela; «con_asiento», si el cobro ya tiene su asiento (sin él,
-- no hay nada en la pasarela que saldar).
create or replace function public.conta_abonos_pasarela_pendientes(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'proveedor', coalesce(e.proveedor, 'stripe'), 'fecha', (e.pagado_at at time zone 'Europe/Madrid')::date,
      'bruto', p.amount, 'comision', e.comision, 'neto', e.neto, 'factura', ci.number_text, 'cliente', coalesce(pa.name, ci.customer->>'nombre'),
      'cuenta', pc.code, 'tercero_id', ci.party_id,
      'con_asiento', exists (select 1 from public.journal_entry j where j.id = p.entry_id and j.status in ('propuesto', 'borrador', 'validado'))) order by e.pagado_at)
    from public.conta_enlace_pago e
    join public.customer_invoice_payment p on p.id = e.payment_id
    left join public.conta_pasarela_cuenta pc on pc.company_id = e.company_id and pc.proveedor = coalesce(e.proveedor, 'stripe')
    join public.customer_invoice ci on ci.id = e.invoice_id
    left join public.party pa on pa.id = ci.party_id
   where e.company_id = p_company and e.status = 'pagado'
     and not exists (select 1 from public.bank_match b where b.id = e.abono_match_id and b.status = 'vivo')), '[]'::jsonb);
end $$;
revoke all on function public.conta_abonos_pasarela_pendientes(uuid) from public, anon;
grant execute on function public.conta_abonos_pasarela_pendientes(uuid) to authenticated;

-- Casar el abono del proveedor con sus cobros. Un asiento: la 572 del banco por
-- lo abonado y la 626 por la comisión, contra la cuenta de la pasarela por lo
-- cobrado (que vuelve a cero por esos cobros). Bancos lo enlaza (bank_casar) y,
-- como lo ha creado este casado, deshacerlo lo quita. Cada cobro tiene que
-- tener su asiento: sin él, en la pasarela no hay nada que saldar.
create or replace function public.conta_abono_pasarela_casar(p_movement uuid, p_enlaces uuid[], p_confianza text, p_porque text, p_por text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m public.bank_movement; v_t public.treasury_account; v_aj public.bank_settings; v_cuenta uuid; v_n int; v_prov text; v_nprov int;
  v_bruto numeric; v_fees numeric; v_fees_n int; v_com numeric; v_desde date; v_hasta date; v_gas text; v_572 text; v_local uuid; v_comun boolean;
  v_lineas jsonb; v_l record; v_res jsonb; v_entry uuid; v_match uuid; v_nombre text; v_periodo text; v_concepto text; v_quien text;
  v_pas text; v_sin text;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._pc01e3_empresa(v_m.company_id);
  if p_por not in ('folvy', 'persona') then raise exception 'Quién casa: folvy o persona.' using errcode = '23514'; end if;
  if v_m.amount <= 0 then raise exception 'El abono de Stripe o del TPV entra en el banco, y este movimiento sale.' using errcode = '23514'; end if;
  if coalesce(cardinality(p_enlaces), 0) = 0 then raise exception 'Di qué cobros trae este abono.' using errcode = '22023'; end if;
  perform 1 from public.conta_enlace_pago where id = any(p_enlaces) for update;
  select count(*), count(distinct coalesce(e.proveedor, 'stripe')), min(coalesce(e.proveedor, 'stripe')), sum(p.amount), sum(e.comision), count(e.comision),
         min((e.pagado_at at time zone 'Europe/Madrid')::date), max((e.pagado_at at time zone 'Europe/Madrid')::date)
    into v_n, v_nprov, v_prov, v_bruto, v_fees, v_fees_n, v_desde, v_hasta
    from public.conta_enlace_pago e join public.customer_invoice_payment p on p.id = e.payment_id
   where e.id = any(p_enlaces) and e.company_id = v_m.company_id and e.status = 'pagado'
     and not exists (select 1 from public.bank_match b where b.id = e.abono_match_id and b.status = 'vivo');
  if v_n <> cardinality(p_enlaces) then raise exception 'Alguno de esos cobros no es de la empresa, no está cobrado o ya tiene su abono.' using errcode = '23514'; end if;
  if v_nprov <> 1 then raise exception 'Un abono es de un solo proveedor: no se juntan cobros de Stripe y del TPV.' using errcode = '23514'; end if;
  v_nombre := case v_prov when 'redsys' then 'tu TPV (Redsys)' else 'Stripe' end;
  v_com := round(v_bruto - v_m.amount, 2);
  if v_com < 0 then
    raise exception 'El abono (%) es mayor que esos cobros (%): no son estos.', public.conta_euros_exactos(v_m.amount), public.conta_euros_exactos(v_bruto) using errcode = '23514';
  end if;
  if v_com > round(v_bruto * 0.10, 2) then
    raise exception 'Con esos cobros (%) la comisión saldría de %, más del 10 %%: no parecen estos.', public.conta_euros_exactos(v_bruto), public.conta_euros_exactos(v_com) using errcode = '23514';
  end if;
  if v_fees_n = v_n and abs(v_fees - v_com) >= 0.005 then
    raise exception '% dice que la comisión de esos cobros es de %, y este abono deja %: no cuadra.', v_nombre, public.conta_euros_exactos(v_fees), public.conta_euros_exactos(v_com) using errcode = '23514';
  end if;
  select * into v_t from public.treasury_account where id = v_m.treasury_account_id;
  v_572 := public._bank_cuenta_572(v_t.id);
  if v_572 is null then raise exception 'La cuenta «%» no tiene su cuenta contable (572): dila en Cuentas y extractos.', v_t.name using errcode = '23514'; end if;
  if v_com > 0 then
    v_gas := public._pc01e3_cuenta_gastos(v_m.company_id);
    if v_gas is null then raise exception 'La empresa no tiene una cuenta 626 para la comisión: créala en el plan.' using errcode = '23514'; end if;
  end if;
  -- Cada cobro, con su asiento contra la pasarela.
  select string_agg(coalesce(ci.number_text, 'sin número'), ', ') into v_sin
    from public.conta_enlace_pago e join public.customer_invoice_payment p on p.id = e.payment_id join public.customer_invoice ci on ci.id = e.invoice_id
   where e.id = any(p_enlaces) and not exists (select 1 from public.journal_entry j where j.id = p.entry_id and j.status in ('propuesto', 'borrador', 'validado'));
  if v_sin is not null then
    raise exception 'El cobro de % aún no tiene su asiento (la pasarela contra la 430): sin él no hay nada que saldar. Mira su historial.', v_sin using errcode = '23514';
  end if;
  select code into v_pas from public.conta_pasarela_cuenta where company_id = v_m.company_id and proveedor = v_prov;
  if v_pas is null then raise exception 'La empresa no tiene la cuenta de % por abonar.', v_nombre using errcode = '23514'; end if;
  v_local := v_t.location_id; v_comun := v_local is null;
  v_periodo := case when v_desde = v_hasta then 'del ' || to_char(v_desde, 'DD/MM') else format('del %s al %s', to_char(v_desde, 'DD/MM'), to_char(v_hasta, 'DD/MM')) end;
  v_concepto := format('Abono de %s %s', case v_prov when 'redsys' then 'TPV' else 'Stripe' end, v_periodo);
  v_lineas := jsonb_build_array(jsonb_build_object('cuenta', v_572, 'debe', v_m.amount, 'haber', 0, 'concepto', v_concepto, 'local_id', v_local, 'comun', v_comun));
  if v_com > 0 then
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_gas, 'debe', v_com, 'haber', 0,
      'concepto', format('Comisión %s %s', case v_prov when 'redsys' then 'TPV' else 'Stripe' end, v_periodo), 'local_id', v_local, 'comun', v_comun));
  end if;
  v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_pas, 'debe', 0, 'haber', v_bruto,
    'concepto', format('%s · %s %s', v_concepto, v_n, case when v_n = 1 then 'cobro' else 'cobros' end), 'local_id', v_local, 'comun', v_comun));
  v_aj := public._bank_ajustes(v_m.company_id);
  v_quien := case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end;
  v_res := public._journal_entry_proponer(v_m.company_id,
    jsonb_build_object('fecha', v_m.op_date, 'series', v_aj.treasury_series, 'concepto', v_concepto, 'source_type', 'bank', 'source_id', v_m.id,
                       'confianza', p_confianza, 'porque', p_porque, 'razones', '[]'::jsonb, 'party_id', null, 'documento', coalesce(v_m.document_no, v_m.reference_1)),
    v_lineas, '{}'::jsonb, v_quien, auth.uid());
  if coalesce((v_res->>'descartada')::boolean, false) then raise exception 'Ese movimiento tenía la propuesta descartada.' using errcode = '23514'; end if;
  v_entry := (v_res->>'id')::uuid;
  perform public.bank_casar(p_movement, jsonb_build_object('tipo', 'asiento', 'entry_id', v_entry, 'concepto', v_concepto), p_confianza, p_porque, '[]'::jsonb, p_por, null);
  select id into v_match from public.bank_match where movement_id = p_movement and status = 'vivo';
  -- El asiento lo ha creado este casado: deshacerlo en Bancos lo quita (bank_deshacer).
  update public.bank_match set entry_created = not coalesce((v_res->>'existente')::boolean, false) where id = v_match;
  update public.conta_enlace_pago set abono_match_id = v_match where id = any(p_enlaces);
  for v_l in select e.invoice_id, p.amount from public.conta_enlace_pago e join public.customer_invoice_payment p on p.id = e.payment_id where e.id = any(p_enlaces) loop
    perform public._conta_venta_evento(v_l.invoice_id, 'abono',
      format('Llega al banco el abono de %s con este cobro (%s), el %s.', v_nombre, public.conta_euros_exactos(v_l.amount), to_char(v_m.op_date, 'DD/MM/YYYY')),
      jsonb_build_object('casado', v_match, 'asiento', v_entry), v_quien);
  end loop;
  return jsonb_build_object('casado', v_match, 'asiento', v_entry, 'cobros', v_n, 'comision', v_com,
    'frase', format('Casado el abono de %s %s: %s %s, %s menos %s de comisión. Asiento: %s al banco y %s a comisiones; %s queda saldada por esos cobros.', v_nombre, v_periodo,
      v_n, case when v_n = 1 then 'cobro' else 'cobros' end, public.conta_euros_exactos(v_bruto), public.conta_euros_exactos(v_com),
      public.conta_euros_exactos(v_m.amount), public.conta_euros_exactos(v_com),
      case v_prov when 'redsys' then '«TPV del banco · por abonar»' else '«Stripe · por abonar»' end));
end $$;
revoke all on function public.conta_abono_pasarela_casar(uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.conta_abono_pasarela_casar(uuid, uuid[], text, text, text) to authenticated;
comment on function public.conta_abono_pasarela_casar(uuid, uuid[], text, text, text) is
  'S01 · Casa el abono de Stripe o del TPV (Redsys) con sus cobros por el enlace: 572 por el neto y 626 por la comisión contra la cuenta de la pasarela. Deshacer el casado lo quita.';

-- Ventas › Cobros: de cada factura cobrada por el enlace, si su abono ya ha llegado al banco y cuándo.
create or replace function public.conta_cobros_abonos(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.invoice_id, 'proveedor', coalesce(e.proveedor, 'stripe'),
                                                       'cobrado', (e.pagado_at at time zone 'Europe/Madrid')::date, 'abonado', m.op_date))
                     from public.conta_enlace_pago e
                     left join public.bank_match b on b.id = e.abono_match_id and b.status = 'vivo'
                     left join public.bank_movement m on m.id = b.movement_id
                    where e.company_id = p_company and e.status = 'pagado' and e.payment_id is not null), '[]'::jsonb);
end $$;
revoke all on function public.conta_cobros_abonos(uuid) from public, anon;
grant execute on function public.conta_cobros_abonos(uuid) to authenticated;

-- conta_lectura (los agentes) lee las tablas nuevas, si existe el rol. Nunca la clave: está en Vault.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on public.conta_cobro_redsys, public.conta_enlace_pago_intento, public.conta_redsys_aviso, public.conta_pasarela_cuenta to conta_lectura;
  end if;
end $$;
