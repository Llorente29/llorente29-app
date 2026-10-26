-- supabase/migrations/20261026T0915_pc01e2_remesas_de_pagos.sql
--
-- PC01 · Entrega 2 · Compras › Pagos (tableros 15 y 16, «pagos_1» y «pagos_2»).
-- AÑADE tablas, funciones y vistas nuevas, y CAMBIA en caliente supplier con un
-- disparador nuevo (declarado abajo, con su prueba). No toca datos. No está en
-- el camino del pedido.
--
--   1. conta_pago_remesa (+ _linea, + _evento): una remesa de transferencias
--      (el fichero SEPA para el banco) o un pago a mano de una factura suelta
--      («Ya la he pagado»), que es una remesa de un pago, sin fichero. Cada
--      línea es lo que se le paga a una factura, con el IBAN de ese momento.
--   2. El estado se CALCULA (vista conta_pago_remesa_linea_estado), no se
--      guarda: una línea está pagada mientras su casado del banco esté vivo.
--      Deshacer el casado en Bancos la devuelve sola a «esperando el cargo».
--   3. Antifraude: un IBAN que no coincide con el de los pagos anteriores del
--      proveedor, o que ha cambiado en los últimos 30 días, para la remesa
--      hasta que alguien lo confirma (quién y cuándo, en la línea y en su
--      historial). Para que «ha cambiado» vea también los cambios hechos en la
--      ficha, un disparador nuevo apunta cuándo cambia supplier.iban
--      (iban_previous, iban_changed_*: columnas del C01b que hasta hoy solo
--      rellenaba «Es el nuevo IBAN» desde una factura).
--   4. Se cierra sola: conta_remesa_casar casa el cargo del banco con la remesa
--      entera (o con un pago, si el banco los carga uno a uno) por bank_casar
--      (tipo «cuenta», una línea por proveedor: 400/410 contra 572), escribe un
--      bank_match_item por factura (el disparador del PC01 · E1 apunta su pago
--      con ese asiento) y deja pagada la que queda cubierta.
--   5. Un pago rechazado por el banco devuelve su factura a «Por pagar» con el
--      motivo. «Sacarla de la remesa», lo mismo antes de mandar el fichero.
--   6. «Ponerles vencimiento»: el plazo del proveedor; a los que no lo tienen
--      se les pregunta y se guarda en su ficha.
--   7. conta_pagos_lista: lo que lee la pantalla (una consulta, con el estado de
--      conta_recibida_pago, su remesa y lo pagado en el mes).
--
-- cambia: public.supplier · prueba: supabase/staging/sql/20261026_pc01e2_remesas_prueba.sql
--   (el disparador nuevo pc01e2_proveedor_iban_cambiado: antes de cambiar el IBAN
--   de la ficha, apunta el de antes y cuándo; no cambia nada más de supplier.)
--
-- Dueño único (N8): todo lo que escribe en supplier_invoice y supplier va por
-- estas funciones conta_*. Folvy no pierde nada: no lee ni escribe estas tablas.
-- Traspaso mensual (C12): el asiento del pago lo hace bank_casar, como cualquier
-- casado del banco; entra en el traspaso del mes como los demás.

-- ── 0 · Apuntar cuándo cambia el IBAN de un proveedor (para el antifraude) ──
-- Lo primero de la tanda: coge supplier antes que ninguna otra tabla (las FK de
-- abajo también la tocan), para no cruzarse en orden distinto con quien la
-- esté escribiendo (ensayo 40298351731: deadlock en staging con una e2e).
create or replace function public._pc01e2_iban(p text)
returns text language sql immutable set search_path = public as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '') $$;
revoke all on function public._pc01e2_iban(text) from public, anon;
grant execute on function public._pc01e2_iban(text) to authenticated;

create or replace function public._pc01e2_proveedor_iban_cambiado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public._pc01e2_iban(old.iban) is not null and public._pc01e2_iban(new.iban) is distinct from public._pc01e2_iban(old.iban)
     and new.iban_changed_at is not distinct from old.iban_changed_at then
    new.iban_previous := old.iban;
    new.iban_changed_at := now();
    new.iban_changed_by := auth.uid();
    new.iban_changed_by_name := coalesce(public.conta_nombre_actor(), 'Sumied');
  end if;
  return new;
end $$;
revoke all on function public._pc01e2_proveedor_iban_cambiado() from public, anon, authenticated;
create or replace trigger pc01e2_proveedor_iban_cambiado before update of iban on public.supplier
  for each row execute function public._pc01e2_proveedor_iban_cambiado();

-- ── 1 · Tablas ─────────────────────────────────────────────────────────────
create table if not exists public.conta_pago_remesa (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  company_id           uuid not null references public.company(id) on delete cascade,
  code                 text not null,
  kind                 text not null check (kind in ('fichero', 'a_mano')),
  treasury_account_id  uuid not null references public.treasury_account(id),
  pay_date             date not null,
  file_sha256          text,
  file_at              timestamptz,
  file_by              uuid,
  file_by_name         text,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  created_by_name      text,
  unique (company_id, code)
);
comment on table public.conta_pago_remesa is
  'PC01 · E2 · Una remesa de transferencias a proveedores (fichero SEPA pain.001) o un pago a mano de una factura suelta (kind a_mano, sin fichero). Su estado se calcula: conta_pago_remesa_estado.';

create table if not exists public.conta_pago_remesa_linea (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references public.accounts(id) on delete cascade,
  company_id              uuid not null references public.company(id) on delete cascade,
  remesa_id               uuid not null references public.conta_pago_remesa(id) on delete cascade,
  invoice_id              uuid not null references public.supplier_invoice(id) on delete cascade,
  supplier_id             uuid references public.supplier(id) on delete set null,
  amount                  numeric(14,2) not null check (amount > 0),
  iban                    text,
  iban_check              text not null check (iban_check in ('comprobado', 'primer_pago', 'cambiado', 'sin_fichero')),
  iban_note               text,
  iban_confirmed_at       timestamptz,
  iban_confirmed_by       uuid,
  iban_confirmed_by_name  text,
  rejected_at             timestamptz,
  reject_reason           text,
  rejected_by_name        text,
  removed_at              timestamptz,
  removed_by_name         text,
  bank_match_id           uuid references public.bank_match(id) on delete set null,
  created_at              timestamptz not null default now()
);
comment on table public.conta_pago_remesa_linea is
  'PC01 · E2 · Lo que una remesa paga de una factura recibida, con el IBAN del proveedor en ese momento y si hay que confirmarlo (antifraude). Pagada mientras su casado del banco (bank_match_id) esté vivo.';
create index if not exists conta_pago_remesa_linea_remesa_idx on public.conta_pago_remesa_linea (remesa_id);
create index if not exists conta_pago_remesa_linea_factura_idx on public.conta_pago_remesa_linea (invoice_id);
create index if not exists conta_pago_remesa_linea_proveedor_idx on public.conta_pago_remesa_linea (supplier_id);

create table if not exists public.conta_pago_remesa_evento (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  remesa_id   uuid not null references public.conta_pago_remesa(id) on delete cascade,
  linea_id    uuid references public.conta_pago_remesa_linea(id) on delete cascade,
  at          timestamptz not null default now(),
  by_name     text,
  texto       text not null
);
comment on table public.conta_pago_remesa_evento is 'PC01 · E2 · El historial de una remesa: lo que pasó, quién y cuándo (el bloque «Historial» de su ficha).';
create index if not exists conta_pago_remesa_evento_remesa_idx on public.conta_pago_remesa_evento (remesa_id, at);

alter table public.conta_pago_remesa enable row level security;
alter table public.conta_pago_remesa_linea enable row level security;
alter table public.conta_pago_remesa_evento enable row level security;
revoke all on public.conta_pago_remesa, public.conta_pago_remesa_linea, public.conta_pago_remesa_evento from public, anon, authenticated;
grant select on public.conta_pago_remesa, public.conta_pago_remesa_linea, public.conta_pago_remesa_evento to authenticated;
drop policy if exists conta_pago_remesa_leer on public.conta_pago_remesa;
create policy conta_pago_remesa_leer on public.conta_pago_remesa for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_pago_remesa_linea_leer on public.conta_pago_remesa_linea;
create policy conta_pago_remesa_linea_leer on public.conta_pago_remesa_linea for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_pago_remesa_evento_leer on public.conta_pago_remesa_evento;
create policy conta_pago_remesa_evento_leer on public.conta_pago_remesa_evento for select to authenticated using (public.belongs_to_account(account_id));

-- ── 2 · El estado, calculado ───────────────────────────────────────────────
-- Una línea: sacada · rechazada · pagada (su casado del banco vivo) ·
-- por_confirmar (IBAN cambiado sin confirmar) · pendiente (esperando el cargo).
create or replace view public.conta_pago_remesa_linea_estado with (security_invoker = true) as
  select l.*,
         case
           when l.removed_at is not null then 'sacada'
           when l.rejected_at is not null then 'rechazada'
           when l.bank_match_id is not null and exists (select 1 from public.bank_match b where b.id = l.bank_match_id and b.status = 'vivo') then 'pagada'
           when l.iban_check = 'cambiado' and l.iban_confirmed_at is null then 'por_confirmar'
           else 'pendiente'
         end as estado
    from public.conta_pago_remesa_linea l;
grant select on public.conta_pago_remesa_linea_estado to authenticated;
comment on view public.conta_pago_remesa_linea_estado is 'PC01 · E2 · El estado de cada línea de remesa, calculado: pagada solo mientras su casado del banco esté vivo.';

-- Una remesa: preparada (con un IBAN por confirmar) · fichero (lista para
-- descargar) · en_banco (fichero descargado, o a mano: esperando el cargo) ·
-- pagada (todas sus líneas vivas casadas) · vacia (todas sacadas o rechazadas).
create or replace view public.conta_pago_remesa_estado with (security_invoker = true) as
  with l as (
    select remesa_id,
           count(*) filter (where estado not in ('sacada', 'rechazada')) as vivas,
           count(*) filter (where estado = 'pagada') as pagadas,
           count(*) filter (where estado = 'por_confirmar') as por_confirmar,
           count(*) filter (where estado = 'rechazada') as rechazadas,
           coalesce(sum(amount) filter (where estado not in ('sacada', 'rechazada')), 0)::numeric(14,2) as total,
           coalesce(sum(amount) filter (where estado in ('pendiente', 'por_confirmar')), 0)::numeric(14,2) as por_cargar
      from public.conta_pago_remesa_linea_estado group by remesa_id
  )
  select r.*, coalesce(l.vivas, 0) as vivas, coalesce(l.pagadas, 0) as pagadas, coalesce(l.por_confirmar, 0) as por_confirmar,
         coalesce(l.rechazadas, 0) as rechazadas, coalesce(l.total, 0) as total, coalesce(l.por_cargar, 0) as por_cargar,
         case
           when coalesce(l.vivas, 0) = 0 then 'vacia'
           when l.pagadas = l.vivas then 'pagada'
           when r.kind = 'a_mano' or r.file_at is not null then 'en_banco'
           when l.por_confirmar > 0 then 'preparada'
           else 'fichero'
         end as estado
    from public.conta_pago_remesa r
    left join l on l.remesa_id = r.id;
grant select on public.conta_pago_remesa_estado to authenticated;
comment on view public.conta_pago_remesa_estado is 'PC01 · E2 · El estado de cada remesa de pagos, calculado de sus líneas: preparada, fichero, en_banco, pagada o vacia.';

-- ── 3 · Piezas ─────────────────────────────────────────────────────────────
-- La cuenta de la empresa, si quien llama es administrador o encargado.
create or replace function public._pc01e2_empresa(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.company where id = p_company;
  if v is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v) then
    raise exception 'Solo un administrador o un encargado de la cuenta paga a proveedores.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public._pc01e2_empresa(uuid) from public, anon, authenticated;


create or replace function public._pc01e2_evento(p_account uuid, p_remesa uuid, p_linea uuid, p_texto text)
returns void language sql security definer set search_path = public as $$
  insert into public.conta_pago_remesa_evento (account_id, remesa_id, linea_id, by_name, texto)
  values (p_account, p_remesa, p_linea, coalesce(public.conta_nombre_actor(), 'Sumied'), p_texto)
$$;
revoke all on function public._pc01e2_evento(uuid, uuid, uuid, text) from public, anon, authenticated;

-- El siguiente código de remesa de la empresa en el año: R-2026/001.
create or replace function public._pc01e2_codigo(p_company uuid, p_dia date)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int; v_pre text := 'R-' || to_char(p_dia, 'YYYY') || '/';
begin
  perform pg_advisory_xact_lock(hashtextextended('conta_pago_remesa:' || p_company::text, 0));
  select coalesce(max(substr(code, length(v_pre) + 1)::int), 0) + 1 into v_n
    from public.conta_pago_remesa where company_id = p_company and code like v_pre || '%' and substr(code, length(v_pre) + 1) ~ '^[0-9]+$';
  return v_pre || lpad(v_n::text, 3, '0');
end $$;
revoke all on function public._pc01e2_codigo(uuid, date) from public, anon, authenticated;

-- La 400/410 del proveedor en la empresa (su enlace principal del plan).
create or replace function public._pc01e2_cuenta_proveedor(p_company uuid, p_supplier uuid)
returns text language sql stable security definer set search_path = public as $$
  select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
   where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = p_supplier::text and l.role = 'principal' limit 1
$$;
revoke all on function public._pc01e2_cuenta_proveedor(uuid, uuid) from public, anon, authenticated;

-- Lo que una factura tiene ya comprometido en remesas vivas sin casar.
create or replace function public._pc01e2_en_remesa(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::numeric(14,2) from public.conta_pago_remesa_linea_estado where invoice_id = p_invoice and estado in ('pendiente', 'por_confirmar')
$$;
revoke all on function public._pc01e2_en_remesa(uuid) from public, anon, authenticated;

-- El antifraude: cómo está el IBAN de un proveedor para pagarle hoy.
--   cambiado     → no coincide con el de sus pagos anteriores, o la ficha lo
--                  cambió hace menos de 30 días: hay que confirmarlo;
--   comprobado   → es el mismo con el que ya se le pagó, o su certificado del
--                  banco es posterior al último cambio;
--   primer_pago  → nunca se le ha pagado por remesa: no hay con qué comparar.
create or replace function public._pc01e2_iban_como_esta(p_supplier uuid, p_iban text)
returns table (estado text, nota text) language plpgsql stable security definer set search_path = public as $$
declare v_s public.supplier; v_antes text[];
begin
  select * into v_s from public.supplier where id = p_supplier;
  select array_agg(distinct l.iban) into v_antes from public.conta_pago_remesa_linea_estado l
   where l.supplier_id = p_supplier and l.estado = 'pagada' and l.iban is not null;
  if v_antes is not null and not (p_iban = any(v_antes)) then
    return query select 'cambiado'::text, format('No coincide con el de sus pagos anteriores (···· %s).', right(v_antes[1], 4)); return;
  end if;
  if v_s.iban_changed_at is not null and v_s.iban_changed_at > now() - interval '30 days' then
    return query select 'cambiado'::text, format('El IBAN de su ficha cambió el %s%s.', to_char(v_s.iban_changed_at at time zone 'Europe/Madrid', 'DD/MM'),
      case when v_s.iban_previous is not null then format(' (antes, ···· %s)', right(public._pc01e2_iban(v_s.iban_previous), 4)) else '' end); return;
  end if;
  if v_antes is not null or (v_s.iban_verified_at is not null and (v_s.iban_changed_at is null or v_s.iban_verified_at > v_s.iban_changed_at)) then
    return query select 'comprobado'::text, null::text; return;
  end if;
  return query select 'primer_pago'::text, 'Primer pago a este IBAN desde Sumied.'::text;
end $$;
revoke all on function public._pc01e2_iban_como_esta(uuid, text) from public, anon, authenticated;

-- ── 5 · Pagar seleccionadas: la remesa de transferencias ──────────────────
-- p_facturas: [{id, importe?}] (sin importe, lo pendiente). Para con la frase
-- de lo que falla, sin crear nada: una factura no aprobada o ya pagada, una
-- domiciliada o de tarjeta (se pagan solas con el cargo), un proveedor sin IBAN
-- o sin su 400/410, o un importe que se pasa de lo pendiente.
create or replace function public.conta_remesa_pagos_crear(p_company uuid, p_treasury uuid, p_fecha date, p_facturas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public._pc01e2_empresa(p_company); v_t public.treasury_account; v_r uuid; v_code text;
  v_f jsonb; v_inv public.supplier_invoice; v_s public.supplier; v_pend numeric; v_imp numeric; v_iban text; v_metodo text;
  v_chk record; v_l uuid; v_n int := 0; v_total numeric := 0; v_conf int := 0; v_vistas uuid[] := '{}';
begin
  select * into v_t from public.treasury_account where id = p_treasury and company_id = p_company and is_active;
  if v_t.id is null then raise exception 'Esa cuenta del banco no es de la empresa.' using errcode = '23514'; end if;
  if public._pc01e2_iban(v_t.iban) is null then raise exception 'La cuenta «%» no tiene IBAN: el banco no sabría de dónde sacar el dinero.', v_t.name using errcode = '23514'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de pago.' using errcode = '22023'; end if;
  if p_fecha < public.conta_hoy() then raise exception 'La fecha de pago no puede ser anterior a hoy.' using errcode = '22023'; end if;
  if jsonb_typeof(p_facturas) <> 'array' or jsonb_array_length(p_facturas) = 0 then raise exception 'Elige al menos una factura.' using errcode = '22023'; end if;
  v_code := public._pc01e2_codigo(p_company, p_fecha);
  insert into public.conta_pago_remesa (account_id, company_id, code, kind, treasury_account_id, pay_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_code, 'fichero', p_treasury, p_fecha, auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  returning id into v_r;
  for v_f in select * from jsonb_array_elements(p_facturas) loop
    select * into v_inv from public.supplier_invoice where id = (v_f->>'id')::uuid and account_id = v_cuenta for update;
    if v_inv.id is null or coalesce(v_inv.company_id, p_company) <> p_company then raise exception 'Esa factura no es de la empresa.' using errcode = '23514'; end if;
    if v_inv.id = any(v_vistas) then raise exception 'La factura % está dos veces.', coalesce(v_inv.invoice_number, '') using errcode = '23514'; end if;
    v_vistas := v_vistas || v_inv.id;
    if v_inv.status <> 'aprobada' then raise exception 'La factura % no está por pagar (está %).', coalesce(v_inv.invoice_number, ''), v_inv.status using errcode = '23514'; end if;
    select * into v_s from public.supplier where id = v_inv.supplier_id;
    v_metodo := coalesce(v_inv.payment_method, v_s.payment_method);
    if v_metodo in ('direct_debit', 'card', 'prepaid', 'cash') then
      raise exception 'La factura % de % no se paga por remesa: %.', coalesce(v_inv.invoice_number, ''), coalesce(v_s.name, 'su proveedor'),
        case v_metodo when 'direct_debit' then 'la paga el banco solo (domiciliada)' when 'card' then 'se paga con tarjeta' when 'prepaid' then 'se paga del saldo prepago' else 'se paga en efectivo' end
        using errcode = '23514';
    end if;
    v_iban := public._pc01e2_iban(v_s.iban);
    if v_iban is null then raise exception '% no tiene IBAN en su ficha: ponlo en Contactos antes de pagarle por remesa.', coalesce(v_s.name, 'Su proveedor') using errcode = '23514'; end if;
    if public._pc01e2_cuenta_proveedor(p_company, v_s.id) is null then
      raise exception '% no tiene su cuenta de proveedor (400) en el plan: sin ella el pago no tendría asiento.', v_s.name using errcode = '23514';
    end if;
    select pendiente into v_pend from public.conta_recibida_pago where invoice_id = v_inv.id;
    v_pend := coalesce(v_pend, 0) - public._pc01e2_en_remesa(v_inv.id);
    v_imp := coalesce(nullif(v_f->>'importe', '')::numeric, v_pend);
    if v_imp <= 0 or v_imp > v_pend + 0.005 then
      raise exception 'La factura % tiene pendientes % sin remesa: no se le pueden pagar %.', coalesce(v_inv.invoice_number, ''),
        public.conta_euros_exactos(greatest(v_pend, 0)), public.conta_euros_exactos(v_imp) using errcode = '23514';
    end if;
    select * into v_chk from public._pc01e2_iban_como_esta(v_s.id, v_iban);
    insert into public.conta_pago_remesa_linea (account_id, company_id, remesa_id, invoice_id, supplier_id, amount, iban, iban_check, iban_note)
    values (v_cuenta, p_company, v_r, v_inv.id, v_s.id, v_imp, v_iban, v_chk.estado, v_chk.nota) returning id into v_l;
    if v_chk.estado = 'cambiado' then
      v_conf := v_conf + 1;
      perform public._pc01e2_evento(v_cuenta, v_r, v_l, format('El IBAN de %s no se ha confirmado: %s Se para hasta confirmarlo.', v_s.name, v_chk.nota));
    end if;
    v_n := v_n + 1; v_total := v_total + v_imp;
  end loop;
  perform public._pc01e2_evento(v_cuenta, v_r, null, format('Prepara la remesa con %s %s por %s, desde %s, para pagar el %s.',
    v_n, case when v_n = 1 then 'factura' else 'facturas' end, public.conta_euros_exactos(v_total), v_t.name, to_char(p_fecha, 'DD/MM/YYYY')));
  return jsonb_build_object('remesa', v_r, 'codigo', v_code, 'pagos', v_n, 'total', v_total, 'por_confirmar', v_conf,
    'frase', format('Remesa %s preparada: %s %s, %s.%s', v_code, v_n, case when v_n = 1 then 'pago' else 'pagos' end, public.conta_euros_exactos(v_total),
      case when v_conf = 0 then ' Ya puedes descargar el fichero para el banco.'
           when v_conf = 1 then ' Antes de descargar el fichero, confirma 1 IBAN que ha cambiado.'
           else format(' Antes de descargar el fichero, confirma %s IBAN que han cambiado.', v_conf) end));
end $$;
revoke all on function public.conta_remesa_pagos_crear(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.conta_remesa_pagos_crear(uuid, uuid, date, jsonb) to authenticated;
comment on function public.conta_remesa_pagos_crear(uuid, uuid, date, jsonb) is
  'PC01 · E2 · «Pagar N facturas»: prepara la remesa de transferencias. Para sin crear nada si una factura no se puede pagar por remesa, y dice por qué.';

-- ── 6 · Pago a mano de una factura suelta («Ya la he pagado») ─────────────
-- Admite parcial. Queda esperando el cargo para casarse en Bancos: sin asiento
-- todavía (PC01 · E1: o hay un pago con asiento, o no está pagada).
create or replace function public.conta_pago_a_mano(p_company uuid, p_invoice uuid, p_treasury uuid, p_fecha date, p_importe numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public._pc01e2_empresa(p_company); v_t public.treasury_account; v_inv public.supplier_invoice; v_s public.supplier;
  v_pend numeric; v_r uuid; v_code text; v_l uuid;
begin
  select * into v_t from public.treasury_account where id = p_treasury and company_id = p_company and is_active;
  if v_t.id is null then raise exception 'Esa cuenta del banco no es de la empresa.' using errcode = '23514'; end if;
  if p_fecha is null then raise exception 'Falta el día que la pagaste.' using errcode = '22023'; end if;
  if p_fecha > public.conta_hoy() then raise exception '«Ya la he pagado» es para un pago hecho: el día no puede ser posterior a hoy.' using errcode = '22023'; end if;
  select * into v_inv from public.supplier_invoice where id = p_invoice and account_id = v_cuenta for update;
  if v_inv.id is null or coalesce(v_inv.company_id, p_company) <> p_company then raise exception 'Esa factura no es de la empresa.' using errcode = '23514'; end if;
  if v_inv.status <> 'aprobada' then raise exception 'La factura % no está por pagar (está %).', coalesce(v_inv.invoice_number, ''), v_inv.status using errcode = '23514'; end if;
  select * into v_s from public.supplier where id = v_inv.supplier_id;
  if public._pc01e2_cuenta_proveedor(p_company, v_s.id) is null then
    raise exception '% no tiene su cuenta de proveedor (400) en el plan: sin ella el pago no tendría asiento.', coalesce(v_s.name, 'Su proveedor') using errcode = '23514';
  end if;
  select pendiente into v_pend from public.conta_recibida_pago where invoice_id = v_inv.id;
  v_pend := coalesce(v_pend, 0) - public._pc01e2_en_remesa(v_inv.id);
  if p_importe is null or p_importe <= 0 or p_importe > v_pend + 0.005 then
    raise exception 'A la factura % le quedan % por pagar: no se le pueden apuntar %.', coalesce(v_inv.invoice_number, ''),
      public.conta_euros_exactos(greatest(v_pend, 0)), public.conta_euros_exactos(coalesce(p_importe, 0)) using errcode = '23514';
  end if;
  v_code := public._pc01e2_codigo(p_company, p_fecha);
  insert into public.conta_pago_remesa (account_id, company_id, code, kind, treasury_account_id, pay_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_code, 'a_mano', p_treasury, p_fecha, auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  returning id into v_r;
  insert into public.conta_pago_remesa_linea (account_id, company_id, remesa_id, invoice_id, supplier_id, amount, iban, iban_check, iban_note)
  values (v_cuenta, p_company, v_r, v_inv.id, v_s.id, p_importe, public._pc01e2_iban(v_s.iban), 'sin_fichero', 'Pagada a mano en el banco.')
  returning id into v_l;
  perform public._pc01e2_evento(v_cuenta, v_r, v_l, format('Apunta que pagó %s de la factura %s de %s el %s desde %s. Espera el cargo en el banco.',
    public.conta_euros_exactos(p_importe), coalesce(v_inv.invoice_number, 'sin número'), coalesce(v_s.name, '—'), to_char(p_fecha, 'DD/MM/YYYY'), v_t.name));
  return jsonb_build_object('remesa', v_r, 'codigo', v_code,
    'frase', format('Apuntado: %s a %s el %s desde %s. Queda esperando el cargo; cuando lo cases en Bancos, %s.',
      public.conta_euros_exactos(p_importe), coalesce(v_s.name, 'su proveedor'), to_char(p_fecha, 'DD/MM'), v_t.name,
      case when p_importe >= v_pend - 0.005 then 'la factura queda pagada con su asiento' else 'el pago queda con su asiento y la factura, pagada en parte' end));
end $$;
revoke all on function public.conta_pago_a_mano(uuid, uuid, uuid, date, numeric) from public, anon;
grant execute on function public.conta_pago_a_mano(uuid, uuid, uuid, date, numeric) to authenticated;
comment on function public.conta_pago_a_mano(uuid, uuid, uuid, date, numeric) is
  'PC01 · E2 · «Ya la he pagado»: apunta el pago de una factura suelta (admite parcial). Espera el cargo para casarse en Bancos y tener su asiento.';

-- ── 7 · Lo que se hace con una remesa ─────────────────────────────────────
create or replace function public._pc01e2_linea(p_linea uuid)
returns public.conta_pago_remesa_linea_estado language plpgsql security definer set search_path = public as $$
declare v public.conta_pago_remesa_linea_estado;
begin
  select * into v from public.conta_pago_remesa_linea_estado where id = p_linea;
  if v.id is null then raise exception 'Ese pago no existe.' using errcode = 'P0002'; end if;
  perform public._pc01e2_empresa(v.company_id);
  perform 1 from public.conta_pago_remesa_linea where id = p_linea for update;
  return v;
end $$;
revoke all on function public._pc01e2_linea(uuid) from public, anon, authenticated;

create or replace function public.conta_remesa_iban_confirmar(p_linea uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.conta_pago_remesa_linea_estado := public._pc01e2_linea(p_linea); v_s text;
begin
  if v.estado <> 'por_confirmar' then raise exception 'Ese IBAN no está esperando confirmación.' using errcode = '23514'; end if;
  update public.conta_pago_remesa_linea set iban_confirmed_at = now(), iban_confirmed_by = auth.uid(),
         iban_confirmed_by_name = coalesce(public.conta_nombre_actor(), 'Sumied') where id = p_linea;
  select name into v_s from public.supplier where id = v.supplier_id;
  perform public._pc01e2_evento(v.account_id, v.remesa_id, p_linea, format('Confirma el IBAN ···· %s de %s.', right(v.iban, 4), coalesce(v_s, '—')));
  return jsonb_build_object('frase', format('IBAN de %s confirmado (···· %s). Queda apuntado quién y cuándo.', coalesce(v_s, 'su proveedor'), right(v.iban, 4)));
end $$;
revoke all on function public.conta_remesa_iban_confirmar(uuid) from public, anon;
grant execute on function public.conta_remesa_iban_confirmar(uuid) to authenticated;

create or replace function public.conta_remesa_linea_sacar(p_linea uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.conta_pago_remesa_linea_estado := public._pc01e2_linea(p_linea); v_r public.conta_pago_remesa; v_s text; v_num text;
begin
  select * into v_r from public.conta_pago_remesa where id = v.remesa_id;
  if v.estado not in ('pendiente', 'por_confirmar') then raise exception 'Ese pago ya no está esperando: no se puede sacar.' using errcode = '23514'; end if;
  if v_r.file_at is not null then raise exception 'El fichero de esta remesa ya se descargó: si el banco no lo paga, di que lo ha rechazado.' using errcode = '23514'; end if;
  update public.conta_pago_remesa_linea set removed_at = now(), removed_by_name = coalesce(public.conta_nombre_actor(), 'Sumied') where id = p_linea;
  select s.name, si.invoice_number into v_s, v_num from public.supplier_invoice si left join public.supplier s on s.id = si.supplier_id where si.id = v.invoice_id;
  perform public._pc01e2_evento(v.account_id, v.remesa_id, p_linea, format('Saca de la remesa la factura %s de %s.', coalesce(v_num, 'sin número'), coalesce(v_s, '—')));
  return jsonb_build_object('frase', format('Factura %s de %s fuera de la remesa: vuelve a «Por pagar».', coalesce(v_num, 'sin número'), coalesce(v_s, 'su proveedor')));
end $$;
revoke all on function public.conta_remesa_linea_sacar(uuid) from public, anon;
grant execute on function public.conta_remesa_linea_sacar(uuid) to authenticated;

create or replace function public.conta_remesa_linea_rechazada(p_linea uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.conta_pago_remesa_linea_estado := public._pc01e2_linea(p_linea); v_s text; v_num text;
begin
  if v.estado not in ('pendiente', 'por_confirmar') then raise exception 'Ese pago no está esperando el cargo.' using errcode = '23514'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Di el motivo que da el banco.' using errcode = '22023'; end if;
  update public.conta_pago_remesa_linea set rejected_at = now(), reject_reason = trim(p_motivo), rejected_by_name = coalesce(public.conta_nombre_actor(), 'Sumied') where id = p_linea;
  select s.name, si.invoice_number into v_s, v_num from public.supplier_invoice si left join public.supplier s on s.id = si.supplier_id where si.id = v.invoice_id;
  perform public._pc01e2_evento(v.account_id, v.remesa_id, p_linea, format('El banco rechaza el pago de %s a %s: %s. La factura %s vuelve a «Por pagar».',
    public.conta_euros_exactos(v.amount), coalesce(v_s, '—'), trim(p_motivo), coalesce(v_num, 'sin número')));
  return jsonb_build_object('frase', format('Rechazado: la factura %s de %s vuelve a «Por pagar» con el motivo «%s». Las demás siguen su curso.',
    coalesce(v_num, 'sin número'), coalesce(v_s, 'su proveedor'), trim(p_motivo)));
end $$;
revoke all on function public.conta_remesa_linea_rechazada(uuid, text) from public, anon;
grant execute on function public.conta_remesa_linea_rechazada(uuid, text) to authenticated;

-- Lo que el fichero SEPA necesita, sin escribir nada. Para si queda un IBAN por
-- confirmar o la remesa ya no tiene nada que pagar. El XML lo hace el front
-- (lib/sepa.ts, validado contra el esquema oficial en una unitaria).
create or replace function public.conta_remesa_fichero_datos(p_remesa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_r public.conta_pago_remesa_estado; v_c public.company; v_t public.treasury_account;
begin
  select * into v_r from public.conta_pago_remesa_estado where id = p_remesa;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  perform public._pc01e2_empresa(v_r.company_id);
  if v_r.kind <> 'fichero' then raise exception 'Un pago a mano no lleva fichero.' using errcode = '23514'; end if;
  if v_r.por_confirmar > 0 then raise exception 'Antes de descargar el fichero, confirma el IBAN que ha cambiado (o saca esa factura de la remesa).' using errcode = '23514'; end if;
  if v_r.vivas = 0 then raise exception 'Esta remesa ya no tiene ningún pago.' using errcode = '23514'; end if;
  select * into v_c from public.company where id = v_r.company_id;
  select * into v_t from public.treasury_account where id = v_r.treasury_account_id;
  return jsonb_build_object(
    'codigo', v_r.code, 'fecha_pago', v_r.pay_date, 'creada', v_r.created_at,
    'ordenante', jsonb_build_object('nombre', coalesce(nullif(v_c.legal_name, ''), v_c.trade_name), 'nif', v_c.tax_id,
                                    'iban', public._pc01e2_iban(v_t.iban), 'bic', nullif(upper(trim(coalesce(v_t.bic, ''))), '')),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'importe', l.amount, 'iban', l.iban, 'bic', nullif(upper(trim(coalesce(s.bic, ''))), ''),
        'nombre', coalesce(nullif(s.legal_name, ''), s.name), 'factura', si.invoice_number, 'fecha_factura', si.invoice_date) order by s.name, si.invoice_date)
      from public.conta_pago_remesa_linea_estado l
      join public.supplier_invoice si on si.id = l.invoice_id
      left join public.supplier s on s.id = l.supplier_id
     where l.remesa_id = p_remesa and l.estado = 'pendiente'), '[]'::jsonb));
end $$;
revoke all on function public.conta_remesa_fichero_datos(uuid) from public, anon;
grant execute on function public.conta_remesa_fichero_datos(uuid) to authenticated;

create or replace function public.conta_remesa_descargada(p_remesa uuid, p_sha256 text, p_pagos integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_pago_remesa_estado; v_t text;
begin
  select * into v_r from public.conta_pago_remesa_estado where id = p_remesa;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  perform public._pc01e2_empresa(v_r.company_id);
  if v_r.por_confirmar > 0 then raise exception 'Queda un IBAN por confirmar.' using errcode = '23514'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'Falta la huella del fichero.' using errcode = '22023'; end if;
  update public.conta_pago_remesa set file_sha256 = p_sha256, file_at = coalesce(file_at, now()), file_by = coalesce(file_by, auth.uid()),
         file_by_name = coalesce(file_by_name, public.conta_nombre_actor(), 'Sumied') where id = p_remesa;
  select name into v_t from public.treasury_account where id = v_r.treasury_account_id;
  perform public._pc01e2_evento(v_r.account_id, p_remesa, null, format('Descarga el fichero para el banco: %s %s, %s (huella %s).',
    p_pagos, case when p_pagos = 1 then 'pago' else 'pagos' end, public.conta_euros_exactos(v_r.por_cargar), left(p_sha256, 8)));
  return jsonb_build_object('frase', format('Fichero de la remesa %s descargado: %s %s. Súbelo a la banca de %s; cuando llegue el cargo, la casas en Bancos y las facturas quedan pagadas.',
    v_r.code, p_pagos, case when p_pagos = 1 then 'pago' else 'pagos' end, coalesce(v_t, 'tu banco')));
end $$;
revoke all on function public.conta_remesa_descargada(uuid, text, integer) from public, anon;
grant execute on function public.conta_remesa_descargada(uuid, text, integer) to authenticated;

-- ── 8 · Se cierra sola: el cargo del banco ─────────────────────────────────
-- p_lineas: null = todas las que esperan el cargo (el banco carga la remesa
-- entera); o las que carga este movimiento (uno a uno). El importe tiene que
-- ser el mismo. Un asiento por bank_casar: cada proveedor a su 400/410 y el
-- banco a su 572.
create or replace function public.conta_remesa_casar(p_movement uuid, p_remesa uuid, p_lineas uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_pago_remesa; v_m public.bank_movement; v_cuenta uuid; v_suma numeric := 0; v_lineas jsonb := '[]'::jsonb;
  v_res jsonb; v_match uuid; v_l record; v_inv public.supplier_invoice; v_n int := 0; v_pagadas int := 0; v_ids uuid[];
begin
  select * into v_r from public.conta_pago_remesa where id = p_remesa for update;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._pc01e2_empresa(v_r.company_id);
  select * into v_m from public.bank_movement where id = p_movement;
  if v_m.id is null or v_m.company_id <> v_r.company_id then raise exception 'Ese movimiento no es de la empresa de la remesa.' using errcode = '23514'; end if;
  if v_m.amount >= 0 then raise exception 'El cargo de una remesa sale del banco, y este movimiento entra.' using errcode = '23514'; end if;
  if v_r.kind = 'fichero' and v_r.file_at is null then raise exception 'El fichero de la remesa % no se ha descargado: el banco aún no la tiene.', v_r.code using errcode = '23514'; end if;
  select array_agg(id order by id) into v_ids from public.conta_pago_remesa_linea_estado
   where remesa_id = p_remesa and estado = 'pendiente' and (p_lineas is null or id = any(p_lineas));
  if v_ids is null then raise exception 'La remesa % no tiene pagos esperando el cargo.', v_r.code using errcode = '23514'; end if;
  if p_lineas is not null and cardinality(v_ids) <> cardinality(p_lineas) then raise exception 'Alguno de esos pagos no está esperando el cargo.' using errcode = '23514'; end if;
  -- Una línea del asiento por proveedor.
  for v_l in select l.supplier_id, s.name, public._pc01e2_cuenta_proveedor(v_r.company_id, l.supplier_id) as cuenta,
                    (select pr.party_id from public.party_role pr where pr.supplier_id = l.supplier_id and pr.role = 'supplier' limit 1) as tercero,
                    sum(l.amount) as importe, string_agg(coalesce(si.invoice_number, 'sin número'), ', ' order by si.invoice_date) as facturas
               from public.conta_pago_remesa_linea l join public.supplier_invoice si on si.id = l.invoice_id left join public.supplier s on s.id = l.supplier_id
              where l.id = any(v_ids) group by l.supplier_id, s.name loop
    if v_l.cuenta is null then raise exception '% no tiene su cuenta de proveedor (400) en el plan.', coalesce(v_l.name, 'Un proveedor') using errcode = '23514'; end if;
    v_suma := v_suma + v_l.importe;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_l.cuenta, 'importe', v_l.importe, 'tercero_id', v_l.tercero,
      'concepto', format('Pago remesa %s · %s · %s', v_r.code, coalesce(v_l.name, ''), v_l.facturas)));
  end loop;
  if abs(v_suma - abs(v_m.amount)) >= 0.005 then
    raise exception 'El cargo es de % y lo que espera la remesa % es %.', public.conta_euros_exactos(abs(v_m.amount)), v_r.code, public.conta_euros_exactos(v_suma) using errcode = '23514';
  end if;
  v_res := public.bank_casar(p_movement, jsonb_build_object('tipo', 'cuenta', 'concepto', format('Pago remesa %s', v_r.code), 'lineas', v_lineas),
    'seguro', format('Es el cargo de la remesa %s: %s.', v_r.code, public.conta_euros_exactos(v_suma)), '[]'::jsonb, 'persona', null);
  select id into v_match from public.bank_match where movement_id = p_movement and status = 'vivo';
  -- Cada factura con lo que paga: el disparador del casado apunta su pago con este asiento.
  for v_l in select l.id, l.invoice_id, l.amount from public.conta_pago_remesa_linea l where l.id = any(v_ids) loop
    select * into v_inv from public.supplier_invoice where id = v_l.invoice_id for update;
    insert into public.bank_match_item (account_id, match_id, supplier_invoice_id, amount, marked_by_bank)
    values (v_cuenta, v_match, v_inv.id, v_l.amount, false);
    update public.conta_pago_remesa_linea set bank_match_id = v_match where id = v_l.id;
    update public.supplier_invoice set payment_entry_id = coalesce(payment_entry_id, (select journal_entry_id from public.bank_match where id = v_match)) where id = v_inv.id;
    if v_inv.status = 'aprobada' and coalesce((select sum(amount) from public.supplier_invoice_payment where invoice_id = v_inv.id and entry_id is not null), 0) >= coalesce(v_inv.grand_total, 0) - 0.005 then
      perform public.mark_supplier_invoice_paid(v_inv.id, v_m.op_date, 'transfer');
      update public.bank_match_item set marked_by_bank = true where match_id = v_match and supplier_invoice_id = v_inv.id;
      v_pagadas := v_pagadas + 1;
    end if;
    v_n := v_n + 1;
  end loop;
  perform public._pc01e2_evento(v_cuenta, p_remesa, null, format('Llega el cargo del %s en el banco: %s %s casados, %s %s.',
    to_char(v_m.op_date, 'DD/MM/YYYY'), v_n, case when v_n = 1 then 'pago' else 'pagos' end, v_pagadas, case when v_pagadas = 1 then 'factura pagada' else 'facturas pagadas' end));
  return jsonb_build_object('casado', v_match, 'pagos', v_n, 'pagadas', v_pagadas,
    'frase', format('Casado con la remesa %s: %s %s, %s. %s %s con su asiento (propuesto, en «Por validar»).', v_r.code, v_n, case when v_n = 1 then 'pago' else 'pagos' end,
      public.conta_euros_exactos(v_suma), v_pagadas, case when v_pagadas = 1 then 'factura queda pagada' else 'facturas quedan pagadas' end));
end $$;
revoke all on function public.conta_remesa_casar(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.conta_remesa_casar(uuid, uuid, uuid[]) to authenticated;
comment on function public.conta_remesa_casar(uuid, uuid, uuid[]) is
  'PC01 · E2 · Casa el cargo del banco con una remesa de pagos (entera o los pagos que carga): un asiento (400/410 contra 572) por bank_casar y las facturas pagadas. Deshacer el casado lo devuelve todo.';

-- Lo que Bancos ofrece para un cargo: las remesas que esperan su cargo, con lo
-- que esperan entero y cada pago.
create or replace function public.conta_remesas_para_casar(p_company uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'codigo', r.code, 'fecha', r.pay_date, 'a_mano', r.kind = 'a_mano', 'por_cargar', r.por_cargar,
           'pagos', (select jsonb_agg(jsonb_build_object('id', l.id, 'importe', l.amount, 'proveedor', s.name, 'factura', si.invoice_number) order by s.name)
                       from public.conta_pago_remesa_linea_estado l join public.supplier_invoice si on si.id = l.invoice_id left join public.supplier s on s.id = l.supplier_id
                      where l.remesa_id = r.id and l.estado = 'pendiente')) order by r.pay_date), '[]'::jsonb)
    from public.conta_pago_remesa_estado r
   where r.company_id = p_company and r.estado = 'en_banco' and r.por_cargar > 0
$$;
grant execute on function public.conta_remesas_para_casar(uuid) to authenticated;

-- ── 9 · «Ponerles vencimiento» ─────────────────────────────────────────────
-- p_plazos: [{proveedor, dias}] para los proveedores que no tenían plazo (se
-- guarda en su ficha). Después, cada factura aprobada sin vencimiento cuyo
-- proveedor tiene plazo vence el día de la factura más ese plazo.
create or replace function public.conta_recibidas_poner_vencimiento(p_company uuid, p_plazos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._pc01e2_empresa(p_company); v_p jsonb; v_prov int := 0; v_n int := 0; v_quedan int;
begin
  for v_p in select * from jsonb_array_elements(coalesce(p_plazos, '[]'::jsonb)) loop
    if (v_p->>'dias')::int is null or (v_p->>'dias')::int < 0 or (v_p->>'dias')::int > 365 then raise exception 'El plazo va de 0 a 365 días.' using errcode = '22023'; end if;
    update public.supplier set payment_terms_days = (v_p->>'dias')::int, updated_at = now()
     where id = (v_p->>'proveedor')::uuid and account_id = v_cuenta and payment_terms_days is null;
    v_prov := v_prov + 1;
  end loop;
  update public.supplier_invoice si set due_date = si.invoice_date + s.payment_terms_days,
         due_date_set_name = format('%s · plazo del proveedor (%s días)', coalesce(public.conta_nombre_actor(), 'Sumied'), s.payment_terms_days), due_date_set_at = now()
    from public.supplier s
   where s.id = si.supplier_id and si.account_id = v_cuenta and coalesce(si.company_id, p_company) = p_company
     and si.status = 'aprobada' and si.due_date is null and si.invoice_date is not null and s.payment_terms_days is not null;
  get diagnostics v_n = row_count;
  select count(*) into v_quedan from public.supplier_invoice si
   where si.account_id = v_cuenta and coalesce(si.company_id, p_company) = p_company and si.status = 'aprobada' and si.due_date is null;
  return jsonb_build_object('facturas', v_n, 'proveedores', v_prov, 'quedan', v_quedan,
    'frase', format('Puesto el vencimiento a %s %s%s.%s', v_n, case when v_n = 1 then 'factura' else 'facturas' end,
      case when v_prov > 0 then format(' (y el plazo en la ficha de %s %s)', v_prov, case when v_prov = 1 then 'proveedor' else 'proveedores' end) else '' end,
      case when v_quedan > 0 then format(' Quedan %s sin vencimiento: no tienen fecha de factura o su proveedor sigue sin plazo.', v_quedan) else '' end));
end $$;
revoke all on function public.conta_recibidas_poner_vencimiento(uuid, jsonb) from public, anon;
grant execute on function public.conta_recibidas_poner_vencimiento(uuid, jsonb) to authenticated;

-- ── 10 · Lo que lee la pantalla ────────────────────────────────────────────
-- Las recibidas por pagar y las pagadas de la empresa, con su estado (el de
-- conta_recibida_pago, o «en remesa» si lo pendiente ya está en una remesa que
-- espera el cargo), cómo se pagan, el IBAN del proveedor (los 4 últimos) y lo
-- pagado en el mes.
create or replace function public.conta_pagos_lista(p_company uuid, p_mes date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with f as (
    select si.id, si.supplier_id, s.name as proveedor, si.invoice_number as numero, si.invoice_date as fecha, rp.vence, rp.total, rp.pagado, rp.pendiente,
           rp.estado, rp.dias_vencida, coalesce(si.payment_method, s.payment_method) as forma, si.location_id, lo.name as local,
           right(public._pc01e2_iban(s.iban), 4) as iban4, (public._pc01e2_iban(s.iban) is not null) as con_iban,
           exists (select 1 from public.company_account_link l where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal') as con_cuenta,
           s.payment_terms_days as plazo,
           (select jsonb_build_object('id', r.id, 'codigo', r.code, 'importe', sum(l.amount))
              from public.conta_pago_remesa_linea_estado l join public.conta_pago_remesa r on r.id = l.remesa_id
             where l.invoice_id = si.id and l.estado in ('pendiente', 'por_confirmar') group by r.id, r.code order by r.code desc limit 1) as remesa
      from public.supplier_invoice si
      join public.conta_recibida_pago rp on rp.invoice_id = si.id
      left join public.supplier s on s.id = si.supplier_id
      left join public.locations lo on lo.id = si.location_id
     where si.account_id = (select account_id from public.company where id = p_company)
       and coalesce(si.company_id, p_company) = p_company
       and si.status in ('aprobada', 'pagada')
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha) from f), '[]'::jsonb),
    'pagado_mes', (select coalesce(sum(p.amount), 0) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                    where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'pagadas_mes', (select count(distinct p.invoice_id) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                     where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'sin_plazo', coalesce((select jsonb_agg(distinct jsonb_build_object('id', f.supplier_id, 'nombre', f.proveedor))
                            from f where f.estado = 'sin_vencimiento' and f.plazo is null and f.supplier_id is not null), '[]'::jsonb))
$$;
grant execute on function public.conta_pagos_lista(uuid, date) to authenticated;
comment on function public.conta_pagos_lista(uuid, date) is 'PC01 · E2 · Compras › Pagos: las recibidas por pagar y pagadas de la empresa, con su estado, su remesa y lo pagado en el mes.';

-- La ficha de una remesa: datos, pagos con su IBAN, el asiento que hará y el historial.
create or replace function public.conta_remesa_ficha(p_remesa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not exists (select 1 from public.conta_pago_remesa where id = p_remesa and public.belongs_to_account(account_id)) then
    raise exception 'Esa remesa no existe o no es de tu cuenta.' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'id', r.id, 'codigo', r.code, 'a_mano', r.kind = 'a_mano', 'fecha_pago', r.pay_date, 'estado', r.estado, 'total', r.total, 'por_cargar', r.por_cargar,
    'vivas', r.vivas, 'pagadas', r.pagadas, 'por_confirmar', r.por_confirmar, 'rechazadas', r.rechazadas,
    'fichero_at', r.file_at, 'fichero_por', r.file_by_name, 'creada', r.created_at, 'creada_por', r.created_by_name,
    'banco', jsonb_build_object('id', t.id, 'nombre', t.name, 'iban4', right(public._pc01e2_iban(t.iban), 4), 'cuenta', public._bank_cuenta_572(t.id)),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'factura_id', l.invoice_id, 'numero', si.invoice_number, 'vence', si.due_date, 'importe', l.amount,
        'proveedor', s.name, 'iban4', right(l.iban, 4), 'iban_pais', left(l.iban, 4), 'iban_estado', l.iban_check, 'iban_nota', l.iban_note,
        'confirmado_por', l.iban_confirmed_by_name, 'confirmado_at', l.iban_confirmed_at, 'estado', l.estado, 'motivo', l.reject_reason,
        'cuenta', public._pc01e2_cuenta_proveedor(r.company_id, l.supplier_id)) order by s.name, si.invoice_date)
      from public.conta_pago_remesa_linea_estado l join public.supplier_invoice si on si.id = l.invoice_id left join public.supplier s on s.id = l.supplier_id
     where l.remesa_id = r.id), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'por', e.by_name, 'texto', e.texto) order by e.at, e.id)
      from public.conta_pago_remesa_evento e where e.remesa_id = r.id), '[]'::jsonb))
  into v
  from public.conta_pago_remesa_estado r
  join public.treasury_account t on t.id = r.treasury_account_id
  where r.id = p_remesa;
  return v;
end $$;
revoke all on function public.conta_remesa_ficha(uuid) from public, anon;
grant execute on function public.conta_remesa_ficha(uuid) to authenticated;

-- Las remesas de la empresa (Compras › Pagos › Remesas).
create or replace function public.conta_remesas_lista(p_company uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'codigo', r.code, 'a_mano', r.kind = 'a_mano', 'fecha_pago', r.pay_date, 'estado', r.estado,
           'total', r.total, 'vivas', r.vivas, 'pagadas', r.pagadas, 'por_confirmar', r.por_confirmar, 'banco', t.name) order by r.created_at desc), '[]'::jsonb)
    from public.conta_pago_remesa_estado r join public.treasury_account t on t.id = r.treasury_account_id
   where r.company_id = p_company
$$;
grant execute on function public.conta_remesas_lista(uuid) to authenticated;
