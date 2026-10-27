-- supabase/migrations/20261026T2142_pc01e3_cobros_mandatos_recibos.sql
--
-- PC01 · Entrega 3 · Ventas › Cobros (tableros cobros-1 y cobros-2): mandatos,
-- remesa de recibos domiciliados y devueltos. SOLO AÑADE: tablas, vistas y
-- funciones nuevas. No toca datos ni nada que exista (ni una función de antes),
-- y se puede pasar dos veces seguidas. No está en el camino del pedido.
--
--   1. conta_mandato: el mandato de domiciliación de un cliente. Se prepara con
--      un enlace de un solo uso (/mandato.html?t=…) que el cliente abre sin
--      cuenta, y firma con su nombre y su IBAN. Al firmar, su ficha de Contactos
--      (customer_fiscal) queda con el IBAN, la referencia y la fecha del
--      mandato, y «paga por domiciliación». Queda quién firmó, cuándo, desde qué
--      dirección y con qué navegador. La ficha ya admitía un mandato en papel
--      (referencia y fecha a mano): vale igual.
--   2. conta_cobro_remesa (+ _linea, + _evento): una remesa de recibos, cada
--      línea lo que cobra a una factura con el IBAN y el mandato de ese momento
--      y si es el primer cobro con ese mandato (FRST) o uno más (RCUR).
--   3. El estado se CALCULA (dos vistas): una línea está cobrada mientras el
--      casado del abono esté vivo, y devuelta mientras el de su devolución lo
--      esté. La remesa: preparada · en el banco · plazo de devoluciones (las 8
--      semanas de los recibos CORE desde el abono) · cerrada.
--   4. Preparar la remesa (conta_remesa_cobros_crear) para con la frase de lo
--      que falla: una factura que no es domiciliada, un cliente sin mandato
--      firmado o sin IBAN, sin su 430, un importe que se pasa.
--   5. El abono del banco (conta_remesa_cobros_casar): un asiento por bank_casar
--      (572 contra la 430 de cada cliente) y cada factura cobrada por su recibo
--      (el disparador del casado del PC01 · E1 apunta el cobro con ese asiento).
--   6. Un recibo devuelto (conta_recibo_devuelto): el cargo de la devolución en
--      el banco se casa con su recibo (430 del cliente y 626 de los gastos
--      contra 572), y su factura vuelve a «Por cobrar» con un cobro en negativo
--      atado a ese casado. Deshacer el casado en Bancos lo devuelve todo.
--   7. Lo que leen las pantallas: conta_cobros_lista, conta_remesas_cobros_lista,
--      conta_remesa_cobros_ficha, conta_remesa_cobros_fichero_datos, y lo que
--      ofrece Bancos (conta_cobros_para_casar).
--
-- Dueño único (N8): todo se escribe por estas funciones conta_*. Folvy no lee ni
-- escribe estas tablas. Traspaso mensual (C12): los asientos los hace bank_casar,
-- como cualquier casado del banco.

-- ── 1 · Tablas ─────────────────────────────────────────────────────────────
create table if not exists public.conta_mandato (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  party_id         uuid not null references public.party(id) on delete cascade,
  ref              text not null,
  status           text not null default 'por_firmar' check (status in ('por_firmar', 'firmado', 'anulado')),
  -- El enlace: un token que solo leen estas funciones (la tabla no se da a nadie).
  token            text not null unique,
  expires_at       timestamptz not null,
  sent_to          text,
  sent_at          timestamptz,
  iban             text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  signed_at        timestamptz,
  signed_name      text,
  signed_tax_id    text,
  signed_ip        text,
  signed_agent     text,
  text_version     text,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text,
  unique (company_id, ref)
);
comment on table public.conta_mandato is
  'PC01 · E3 · El mandato de domiciliación SEPA (CORE, recurrente) de un cliente: el enlace para firmarlo y la firma (quién, cuándo, desde dónde). Al firmarse, la ficha del cliente (customer_fiscal) queda con su IBAN, la referencia y la fecha.';
create index if not exists conta_mandato_tercero_idx on public.conta_mandato (party_id, created_at desc);

create table if not exists public.conta_cobro_remesa (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  company_id           uuid not null references public.company(id) on delete cascade,
  code                 text not null,
  treasury_account_id  uuid not null references public.treasury_account(id),
  charge_date          date not null,
  file_sha256          text,
  file_at              timestamptz,
  file_by              uuid,
  file_by_name         text,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  created_by_name      text,
  unique (company_id, code)
);
comment on table public.conta_cobro_remesa is
  'PC01 · E3 · Una remesa de recibos domiciliados a clientes (fichero SEPA pain.008, CORE). Su estado se calcula: conta_cobro_remesa_estado.';

create table if not exists public.conta_cobro_remesa_linea (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  remesa_id         uuid not null references public.conta_cobro_remesa(id) on delete cascade,
  invoice_id        uuid not null references public.customer_invoice(id) on delete cascade,
  party_id          uuid references public.party(id) on delete set null,
  amount            numeric(14,2) not null check (amount > 0),
  iban              text not null,
  mandate_ref       text not null,
  mandate_date      date not null,
  seq               text not null check (seq in ('FRST', 'RCUR')),
  removed_at        timestamptz,
  removed_by_name   text,
  bank_match_id     uuid references public.bank_match(id) on delete set null,
  returned_at       timestamptz,
  return_reason     text,
  return_fee        numeric(14,2),
  return_match_id   uuid references public.bank_match(id) on delete set null,
  returned_by_name  text,
  created_at        timestamptz not null default now()
);
comment on table public.conta_cobro_remesa_linea is
  'PC01 · E3 · Lo que una remesa de recibos cobra a una factura emitida, con el IBAN y el mandato del cliente en ese momento. Cobrado mientras el casado de su abono (bank_match_id) esté vivo; devuelto mientras lo esté el de su devolución (return_match_id).';
create index if not exists conta_cobro_remesa_linea_remesa_idx on public.conta_cobro_remesa_linea (remesa_id);
create index if not exists conta_cobro_remesa_linea_factura_idx on public.conta_cobro_remesa_linea (invoice_id);
create index if not exists conta_cobro_remesa_linea_tercero_idx on public.conta_cobro_remesa_linea (party_id);

create table if not exists public.conta_cobro_remesa_evento (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  remesa_id   uuid not null references public.conta_cobro_remesa(id) on delete cascade,
  linea_id    uuid references public.conta_cobro_remesa_linea(id) on delete cascade,
  at          timestamptz not null default now(),
  by_name     text,
  texto       text not null
);
comment on table public.conta_cobro_remesa_evento is 'PC01 · E3 · El historial de una remesa de recibos: lo que pasó, quién y cuándo.';
create index if not exists conta_cobro_remesa_evento_remesa_idx on public.conta_cobro_remesa_evento (remesa_id, at);

-- El mandato no se da a nadie (lleva el token): se lee por las funciones.
alter table public.conta_mandato enable row level security;
revoke all on public.conta_mandato from public, anon, authenticated;
alter table public.conta_cobro_remesa enable row level security;
alter table public.conta_cobro_remesa_linea enable row level security;
alter table public.conta_cobro_remesa_evento enable row level security;
revoke all on public.conta_cobro_remesa, public.conta_cobro_remesa_linea, public.conta_cobro_remesa_evento from public, anon, authenticated;
grant select on public.conta_cobro_remesa, public.conta_cobro_remesa_linea, public.conta_cobro_remesa_evento to authenticated;
drop policy if exists conta_cobro_remesa_leer on public.conta_cobro_remesa;
create policy conta_cobro_remesa_leer on public.conta_cobro_remesa for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_cobro_remesa_linea_leer on public.conta_cobro_remesa_linea;
create policy conta_cobro_remesa_linea_leer on public.conta_cobro_remesa_linea for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_cobro_remesa_evento_leer on public.conta_cobro_remesa_evento;
create policy conta_cobro_remesa_evento_leer on public.conta_cobro_remesa_evento for select to authenticated using (public.belongs_to_account(account_id));

-- ── 2 · El estado, calculado ───────────────────────────────────────────────
-- Una línea: sacada · devuelto (casado de la devolución vivo) · cobrado
-- (casado del abono vivo) · pendiente (esperando el abono del banco).
create or replace view public.conta_cobro_remesa_linea_estado with (security_invoker = true) as
  select l.*,
         case
           when l.removed_at is not null then 'sacada'
           when l.return_match_id is not null and exists (select 1 from public.bank_match b where b.id = l.return_match_id and b.status = 'vivo') then 'devuelto'
           when l.bank_match_id is not null and exists (select 1 from public.bank_match b where b.id = l.bank_match_id and b.status = 'vivo') then 'cobrado'
           else 'pendiente'
         end as estado,
         (select m.op_date from public.bank_match b join public.bank_movement m on m.id = b.movement_id where b.id = l.bank_match_id and b.status = 'vivo') as abonado_el,
         (select m.op_date from public.bank_match b join public.bank_movement m on m.id = b.movement_id where b.id = l.return_match_id and b.status = 'vivo') as devuelto_el
    from public.conta_cobro_remesa_linea l;
grant select on public.conta_cobro_remesa_linea_estado to authenticated;
comment on view public.conta_cobro_remesa_linea_estado is 'PC01 · E3 · El estado de cada recibo de una remesa, calculado de sus casados del banco: pendiente, cobrado, devuelto o sacada.';

-- Una remesa: vacia · preparada (sin fichero) · en_banco (esperando el abono) ·
-- plazo (abonada, dentro de las 8 semanas en que el cliente puede devolver un
-- recibo CORE) · cerrada (pasado el plazo).
create or replace view public.conta_cobro_remesa_estado with (security_invoker = true) as
  with l as (
    select remesa_id,
           count(*) filter (where estado <> 'sacada') as vivas,
           count(*) filter (where estado = 'cobrado') as cobrados,
           count(*) filter (where estado = 'devuelto') as devueltos,
           count(*) filter (where estado = 'pendiente') as pendientes,
           coalesce(sum(amount) filter (where estado <> 'sacada'), 0)::numeric(14,2) as total,
           coalesce(sum(amount) filter (where estado = 'pendiente'), 0)::numeric(14,2) as por_abonar,
           coalesce(sum(amount) filter (where estado = 'cobrado'), 0)::numeric(14,2) as cobrado,
           max(abonado_el) as abonada_el
      from public.conta_cobro_remesa_linea_estado group by remesa_id
  )
  select r.*, coalesce(l.vivas, 0) as vivas, coalesce(l.cobrados, 0) as cobrados, coalesce(l.devueltos, 0) as devueltos,
         coalesce(l.pendientes, 0) as pendientes, coalesce(l.total, 0) as total, coalesce(l.por_abonar, 0) as por_abonar,
         coalesce(l.cobrado, 0) as cobrado, l.abonada_el, (l.abonada_el + 56) as plazo_hasta,
         case
           when coalesce(l.vivas, 0) = 0 then 'vacia'
           when r.file_at is null then 'preparada'
           when l.pendientes > 0 then 'en_banco'
           when l.abonada_el is not null and public.conta_hoy() <= l.abonada_el + 56 then 'plazo'
           else 'cerrada'
         end as estado
    from public.conta_cobro_remesa r
    left join l on l.remesa_id = r.id;
grant select on public.conta_cobro_remesa_estado to authenticated;
comment on view public.conta_cobro_remesa_estado is 'PC01 · E3 · El estado de cada remesa de recibos: preparada, en_banco, plazo (de devoluciones, 8 semanas desde el abono), cerrada o vacia.';

-- ── 3 · Piezas ─────────────────────────────────────────────────────────────
-- La cuenta de la empresa, si quien llama es administrador o encargado.
create or replace function public._pc01e3_empresa(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select account_id into v from public.company where id = p_company;
  if v is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v) then
    raise exception 'Solo un administrador o un encargado de la cuenta cobra a clientes.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public._pc01e3_empresa(uuid) from public, anon, authenticated;

create or replace function public._pc01e3_evento(p_account uuid, p_remesa uuid, p_linea uuid, p_texto text)
returns void language sql security definer set search_path = public as $$
  insert into public.conta_cobro_remesa_evento (account_id, remesa_id, linea_id, by_name, texto)
  values (p_account, p_remesa, p_linea, coalesce(public.conta_nombre_actor(), 'Sumied'), p_texto)
$$;
revoke all on function public._pc01e3_evento(uuid, uuid, uuid, text) from public, anon, authenticated;

-- El siguiente código de remesa de recibos de la empresa en el año: C-2026/001.
create or replace function public._pc01e3_codigo(p_company uuid, p_dia date)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int; v_pre text := 'C-' || to_char(p_dia, 'YYYY') || '/';
begin
  perform pg_advisory_xact_lock(hashtextextended('conta_cobro_remesa:' || p_company::text, 0));
  select coalesce(max(substr(code, length(v_pre) + 1)::int), 0) + 1 into v_n
    from public.conta_cobro_remesa where company_id = p_company and code like v_pre || '%' and substr(code, length(v_pre) + 1) ~ '^[0-9]+$';
  return v_pre || lpad(v_n::text, 3, '0');
end $$;
revoke all on function public._pc01e3_codigo(uuid, date) from public, anon, authenticated;

-- La siguiente referencia de mandato de la empresa: SUM-000001.
create or replace function public._pc01e3_ref_mandato(p_company uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform pg_advisory_xact_lock(hashtextextended('conta_mandato:' || p_company::text, 0));
  select coalesce(max(substr(ref, 5)::int), 0) + 1 into v_n from public.conta_mandato where company_id = p_company and ref ~ '^SUM-[0-9]{6}$';
  return 'SUM-' || lpad(v_n::text, 6, '0');
end $$;
revoke all on function public._pc01e3_ref_mandato(uuid) from public, anon, authenticated;

-- La 430 del cliente en la empresa (su enlace principal del plan).
create or replace function public._pc01e3_cuenta_cliente(p_company uuid, p_party uuid)
returns text language sql stable security definer set search_path = public as $$
  select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
   where l.company_id = p_company and l.entity = 'customer' and l.entity_id = p_party::text and l.role = 'principal' limit 1
$$;
revoke all on function public._pc01e3_cuenta_cliente(uuid, uuid) from public, anon, authenticated;

-- La cuenta de los gastos de devolución: la primera 626 de la empresa.
create or replace function public._pc01e3_cuenta_gastos(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select code from public.company_account where company_id = p_company and code like '626%' order by code limit 1
$$;
revoke all on function public._pc01e3_cuenta_gastos(uuid) from public, anon, authenticated;

-- Cómo se cobra una factura: la forma de la factura o, si no la dice, la de la
-- ficha del cliente (transfer, direct_debit, card, cash, prepaid) o null.
create or replace function public._pc01e3_forma(p_invoice uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(case pm.code when 'domiciliacion' then 'direct_debit' when 'transferencia' then 'transfer'
                               when 'tarjeta' then 'card' when 'efectivo' then 'cash' end, cf.payment_method)
    from public.customer_invoice ci
    left join public.payment_method pm on pm.id = ci.payment_method_id
    left join public.customer_fiscal cf on cf.party_id = ci.party_id
   where ci.id = p_invoice
$$;
revoke all on function public._pc01e3_forma(uuid) from public, anon, authenticated;

-- Lo que una factura tiene ya en remesas de recibos esperando el abono.
create or replace function public._pc01e3_en_remesa(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::numeric(14,2) from public.conta_cobro_remesa_linea_estado where invoice_id = p_invoice and estado = 'pendiente'
$$;
revoke all on function public._pc01e3_en_remesa(uuid) from public, anon, authenticated;

-- El identificador de acreedor SEPA (AT-02) de una empresa española: ES, dos
-- dígitos de control (ISO 7064, del NIF y «ES00»), el sufijo del banco (000 si
-- no se dice) y el NIF. La misma regla que src/modules/conta/lib/sepa.ts
-- (identificadorAcreedor), que lo comprueba contra el de pruebas del Bundesbank.
create or replace function public._pc01e3_identificador_acreedor(p_nif text, p_sufijo text)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text := regexp_replace(regexp_replace(upper(coalesce(p_nif, '')), '[^A-Z0-9]', '', 'g'), '^ES([A-Z0-9]{9})$', '\1');
  s text := upper(coalesce(nullif(trim(p_sufijo), ''), '000')); r text; d text := ''; c text; i int;
begin
  if n !~ '^[A-Z0-9]{9}$' or s !~ '^[A-Z0-9]{3}$' then return null; end if;
  r := n || 'ES00';
  for i in 1..length(r) loop
    c := substr(r, i, 1);
    d := d || case when c ~ '[A-Z]' then (ascii(c) - 55)::text else c end;
  end loop;
  return 'ES' || lpad((98 - (d::numeric % 97))::text, 2, '0') || s || n;
end $$;
grant execute on function public._pc01e3_identificador_acreedor(text, text) to authenticated;

-- El mandato vigente de un cliente: el de su ficha (firmado por enlace o en papel).
create or replace function public._pc01e3_mandato(p_party uuid)
returns table (ref text, firmado date, iban text, ok boolean) language sql stable security definer set search_path = public as $$
  select nullif(trim(cf.sepa_mandate_ref), ''), cf.sepa_mandate_date, public._pc01e2_iban(cf.iban),
         (nullif(trim(cf.sepa_mandate_ref), '') is not null and cf.sepa_mandate_date is not null and public._pc01e2b_iban_valido(cf.iban))
    from public.customer_fiscal cf where cf.party_id = p_party
$$;
revoke all on function public._pc01e3_mandato(uuid) from public, anon, authenticated;

-- ── 4 · Lo que lee Ventas › Cobros ─────────────────────────────────────────
-- Las emitidas de la empresa (sin borradores, anuladas ni abonos), con su
-- estado de cobro (conta_factura_cobro, PC01 · E1), cómo se cobran, el mandato
-- del cliente, su remesa viva y su último recibo devuelto. Más lo cobrado en el
-- mes y los clientes domiciliados sin mandato firmado (el aviso de arriba).
-- SECURITY DEFINER porque lee los mandatos (que no se dan a nadie); por eso
-- filtra a mano: solo la cuenta de quien llama (belongs_to_account).
create or replace function public.conta_cobros_lista(p_company uuid, p_mes date)
returns jsonb language sql stable security definer set search_path = public as $$
  with f as (
    select ci.id, ci.party_id, coalesce(p.name, 'Sin cliente') as cliente, ci.number_text as numero, ci.issue_date as fecha, c.vence,
           c.total, c.cobrado, c.pendiente, c.estado, c.dias_vencida, ci.location_id, lo.name as local,
           case when c.de_plataforma then 'plataforma'
                else coalesce(case pm.code when 'domiciliacion' then 'direct_debit' when 'transferencia' then 'transfer'
                                           when 'tarjeta' then 'card' when 'efectivo' then 'cash' end, cf.payment_method) end as forma,
           nullif(trim(cf.sepa_mandate_ref), '') as mandato, cf.sepa_mandate_date as mandato_firmado,
           (nullif(trim(cf.sepa_mandate_ref), '') is not null and cf.sepa_mandate_date is not null and cf.iban is not null) as con_mandato,
           right(cf.iban, 4) as iban4,
           exists (select 1 from public.company_account_link l where l.company_id = p_company and l.entity = 'customer' and l.entity_id = ci.party_id::text and l.role = 'principal') as con_cuenta,
           (select jsonb_build_object('id', r.id, 'codigo', r.code, 'importe', sum(l.amount), 'cargo', r.charge_date)
              from public.conta_cobro_remesa_linea_estado l join public.conta_cobro_remesa r on r.id = l.remesa_id
             where l.invoice_id = ci.id and l.estado = 'pendiente' group by r.id, r.code, r.charge_date order by r.code desc limit 1) as remesa,
           (select jsonb_build_object('linea', l.id, 'remesa', r.id, 'codigo', r.code, 'fecha', l.devuelto_el, 'motivo', l.return_reason, 'gastos', l.return_fee)
              from public.conta_cobro_remesa_linea_estado l join public.conta_cobro_remesa r on r.id = l.remesa_id
             where l.invoice_id = ci.id and l.estado = 'devuelto' order by l.returned_at desc limit 1) as devuelto
      from public.customer_invoice ci
      join public.conta_factura_cobro c on c.invoice_id = ci.id
      left join public.party p on p.id = ci.party_id
      left join public.customer_fiscal cf on cf.party_id = ci.party_id
      left join public.payment_method pm on pm.id = ci.payment_method_id
      left join public.locations lo on lo.id = ci.location_id
     where ci.account_id = (select account_id from public.company where id = p_company)
       and ci.company_id = p_company and ci.status = 'emitida' and ci.total > 0
       and public.belongs_to_account(ci.account_id)
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha) from f), '[]'::jsonb),
    'cobrado_mes', (select coalesce(sum(cp.amount), 0) from public.customer_invoice_payment cp join f on f.id = cp.invoice_id
                     where cp.paid_on >= date_trunc('month', p_mes)::date and cp.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'cobradas_mes', (select count(distinct cp.invoice_id) from public.customer_invoice_payment cp join f on f.id = cp.invoice_id
                      where f.estado = 'cobrada' and cp.paid_on >= date_trunc('month', p_mes)::date and cp.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'remesas', (select count(*) from public.conta_cobro_remesa r where r.company_id = p_company),
    'sin_mandato', coalesce((select jsonb_agg(x order by x->>'nombre') from (
        select jsonb_build_object('id', f.party_id, 'nombre', f.cliente, 'facturas', count(*), 'pendiente', sum(f.pendiente),
                 'correo', (select ci2.email_to from public.customer_invoice ci2 where ci2.party_id = f.party_id and ci2.email_to is not null order by ci2.issue_date desc limit 1),
                 'enviado', (select jsonb_build_object('at', m.sent_at, 'a', m.sent_to, 'ref', m.ref) from public.conta_mandato m
                              where m.party_id = f.party_id and m.company_id = p_company and m.status = 'por_firmar' and m.expires_at > now() order by m.created_at desc limit 1)) as x
          from f where f.forma = 'direct_debit' and f.pendiente >= 0.005 and not f.con_mandato and f.party_id is not null
         group by f.party_id, f.cliente) s), '[]'::jsonb))
$$;
revoke all on function public.conta_cobros_lista(uuid, date) from public, anon;
grant execute on function public.conta_cobros_lista(uuid, date) to authenticated;
comment on function public.conta_cobros_lista(uuid, date) is 'PC01 · E3 · Ventas › Cobros: las emitidas de la empresa con su estado de cobro, cómo se cobran, su mandato, su remesa y su devuelto.';

-- ── 5 · Cobrar por remesa: la remesa de recibos ────────────────────────────
-- p_facturas: [{id, importe?}] (sin importe, lo pendiente). Para sin crear nada
-- si una factura no se puede cobrar por remesa, y dice por qué.
create or replace function public.conta_remesa_cobros_crear(p_company uuid, p_treasury uuid, p_fecha date, p_facturas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public._pc01e3_empresa(p_company); v_t public.treasury_account; v_r uuid; v_code text;
  v_f jsonb; v_ci public.customer_invoice; v_nombre text; v_pend numeric; v_imp numeric; v_forma text; v_m record; v_seq text;
  v_n int := 0; v_total numeric := 0; v_vistas uuid[] := '{}'; v_primeros int := 0;
begin
  select * into v_t from public.treasury_account where id = p_treasury and company_id = p_company and is_active;
  if v_t.id is null then raise exception 'Esa cuenta del banco no es de la empresa.' using errcode = '23514'; end if;
  if public._pc01e2_iban(v_t.iban) is null then raise exception 'La cuenta «%» no tiene IBAN: el banco no sabría dónde abonar los recibos.', v_t.name using errcode = '23514'; end if;
  if public._pc01e3_identificador_acreedor((select tax_id from public.company where id = p_company), v_t.sepa_suffix) is null then
    raise exception 'La empresa no tiene un NIF que valga: sin él no hay identificador de acreedor para los recibos.' using errcode = '23514';
  end if;
  if p_fecha is null then raise exception 'Falta el día del cargo.' using errcode = '22023'; end if;
  if p_fecha <= public.conta_hoy() then raise exception 'El cargo tiene que ser como pronto mañana: el banco necesita el fichero el día antes.' using errcode = '22023'; end if;
  if jsonb_typeof(p_facturas) <> 'array' or jsonb_array_length(p_facturas) = 0 then raise exception 'Elige al menos una factura.' using errcode = '22023'; end if;
  v_code := public._pc01e3_codigo(p_company, p_fecha);
  insert into public.conta_cobro_remesa (account_id, company_id, code, treasury_account_id, charge_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_code, p_treasury, p_fecha, auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  returning id into v_r;
  for v_f in select * from jsonb_array_elements(p_facturas) loop
    select * into v_ci from public.customer_invoice where id = (v_f->>'id')::uuid and account_id = v_cuenta and company_id = p_company for update;
    if v_ci.id is null then raise exception 'Esa factura no es de la empresa.' using errcode = '23514'; end if;
    if v_ci.id = any(v_vistas) then raise exception 'La factura % está dos veces.', coalesce(v_ci.number_text, '') using errcode = '23514'; end if;
    v_vistas := v_vistas || v_ci.id;
    select name into v_nombre from public.party where id = v_ci.party_id;
    if v_ci.status <> 'emitida' then raise exception 'La factura % no está emitida (está %).', coalesce(v_ci.number_text, ''), v_ci.status using errcode = '23514'; end if;
    if public.conta_factura_es_de_plataforma(v_ci.id) then raise exception 'La factura % la paga una plataforma: se cobra en Liquidaciones.', coalesce(v_ci.number_text, '') using errcode = '23514'; end if;
    v_forma := public._pc01e3_forma(v_ci.id);
    if v_forma is distinct from 'direct_debit' then
      raise exception 'La factura % de % no se cobra por domiciliación (%): no va en una remesa de recibos.', coalesce(v_ci.number_text, ''), coalesce(v_nombre, 'su cliente'),
        case v_forma when 'transfer' then 'paga por transferencia' when 'card' then 'paga con tarjeta' when 'cash' then 'paga en efectivo' when 'prepaid' then 'paga del saldo prepago' else 'no dice cómo paga' end
        using errcode = '23514';
    end if;
    select * into v_m from public._pc01e3_mandato(v_ci.party_id);
    if v_m.ok is not true then
      raise exception '% paga por domiciliación y no tiene mandato firmado: envíaselo para firmar antes de pasarle el recibo.', coalesce(v_nombre, 'Su cliente') using errcode = '23514';
    end if;
    if public._pc01e3_cuenta_cliente(p_company, v_ci.party_id) is null then
      raise exception '% no tiene su cuenta de cliente (430) en el plan: sin ella el cobro no tendría asiento.', coalesce(v_nombre, 'Su cliente') using errcode = '23514';
    end if;
    select pendiente into v_pend from public.conta_factura_cobro where invoice_id = v_ci.id;
    v_pend := coalesce(v_pend, 0) - public._pc01e3_en_remesa(v_ci.id);
    v_imp := coalesce(nullif(v_f->>'importe', '')::numeric, v_pend);
    if v_imp <= 0 or v_imp > v_pend + 0.005 then
      raise exception 'La factura % tiene pendientes % sin remesa: no se le pueden cobrar %.', coalesce(v_ci.number_text, ''),
        public.conta_euros_exactos(greatest(v_pend, 0)), public.conta_euros_exactos(v_imp) using errcode = '23514';
    end if;
    -- Primer cobro con este mandato (FRST) si ningún recibo suyo ha ido ya al banco; si no, RCUR.
    v_seq := case when exists (select 1 from public.conta_cobro_remesa_linea_estado l join public.conta_cobro_remesa r on r.id = l.remesa_id
                                where l.party_id = v_ci.party_id and l.mandate_ref = v_m.ref and l.estado <> 'sacada' and r.file_at is not null)
                  then 'RCUR' else 'FRST' end;
    if v_seq = 'FRST' then v_primeros := v_primeros + 1; end if;
    insert into public.conta_cobro_remesa_linea (account_id, company_id, remesa_id, invoice_id, party_id, amount, iban, mandate_ref, mandate_date, seq)
    values (v_cuenta, p_company, v_r, v_ci.id, v_ci.party_id, v_imp, v_m.iban, v_m.ref, v_m.firmado, v_seq);
    v_n := v_n + 1; v_total := v_total + v_imp;
  end loop;
  perform public._pc01e3_evento(v_cuenta, v_r, null, format('Prepara la remesa con %s %s por %s, a %s, con cargo el %s.',
    v_n, case when v_n = 1 then 'recibo' else 'recibos' end, public.conta_euros_exactos(v_total), v_t.name, to_char(p_fecha, 'DD/MM/YYYY')));
  return jsonb_build_object('remesa', v_r, 'codigo', v_code, 'recibos', v_n, 'total', v_total, 'primeros', v_primeros,
    'frase', format('Remesa %s preparada: %s %s, %s, con cargo el %s. Descarga el fichero y súbelo a la banca de %s.', v_code, v_n,
      case when v_n = 1 then 'recibo' else 'recibos' end, public.conta_euros_exactos(v_total), to_char(p_fecha, 'DD/MM'), v_t.name));
end $$;
revoke all on function public.conta_remesa_cobros_crear(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.conta_remesa_cobros_crear(uuid, uuid, date, jsonb) to authenticated;
comment on function public.conta_remesa_cobros_crear(uuid, uuid, date, jsonb) is
  'PC01 · E3 · «Cobrar por remesa»: prepara la remesa de recibos domiciliados. Para sin crear nada si una factura no se puede cobrar por remesa, y dice por qué.';

-- Sacar un recibo de la remesa antes de mandar el fichero.
create or replace function public.conta_remesa_cobros_linea_sacar(p_linea uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.conta_cobro_remesa_linea_estado; v_r public.conta_cobro_remesa; v_cuenta uuid; v_num text;
begin
  select * into v from public.conta_cobro_remesa_linea_estado where id = p_linea;
  if v.id is null then raise exception 'Ese recibo no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._pc01e3_empresa(v.company_id);
  select * into v_r from public.conta_cobro_remesa where id = v.remesa_id for update;
  if v.estado <> 'pendiente' then raise exception 'Ese recibo ya no está esperando (está %).', v.estado using errcode = '23514'; end if;
  if v_r.file_at is not null then raise exception 'El fichero de la remesa % ya se descargó: el banco lo tiene. Si no se cobra, llegará devuelto.', v_r.code using errcode = '23514'; end if;
  update public.conta_cobro_remesa_linea set removed_at = now(), removed_by_name = coalesce(public.conta_nombre_actor(), 'Sumied') where id = p_linea;
  select number_text into v_num from public.customer_invoice where id = v.invoice_id;
  perform public._pc01e3_evento(v_cuenta, v.remesa_id, p_linea, format('Saca de la remesa el recibo de la %s.', coalesce(v_num, 'factura')));
  return jsonb_build_object('frase', format('Recibo de la %s sacado de la remesa %s: vuelve a «Por cobrar».', coalesce(v_num, 'factura'), v_r.code));
end $$;
revoke all on function public.conta_remesa_cobros_linea_sacar(uuid) from public, anon;
grant execute on function public.conta_remesa_cobros_linea_sacar(uuid) to authenticated;

-- Los datos del fichero (lib/sepa.ts, ficheroRecibos).
create or replace function public.conta_remesa_cobros_fichero_datos(p_remesa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_r public.conta_cobro_remesa_estado; v_c public.company; v_t public.treasury_account;
begin
  select * into v_r from public.conta_cobro_remesa_estado where id = p_remesa;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  perform public._pc01e3_empresa(v_r.company_id);
  if v_r.pendientes = 0 then raise exception 'Esta remesa no tiene recibos esperando el abono.' using errcode = '23514'; end if;
  select * into v_c from public.company where id = v_r.company_id;
  select * into v_t from public.treasury_account where id = v_r.treasury_account_id;
  return jsonb_build_object(
    'codigo', v_r.code, 'fecha_cargo', v_r.charge_date, 'creada', v_r.created_at,
    'acreedor', jsonb_build_object('nombre', coalesce(nullif(v_c.legal_name, ''), v_c.trade_name), 'nif', v_c.tax_id,
                                   'iban', public._pc01e2_iban(v_t.iban), 'bic', nullif(upper(trim(coalesce(v_t.bic, ''))), ''),
                                   'sufijo', coalesce(v_t.sepa_suffix, '000')),
    'recibos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'importe', l.amount, 'iban', l.iban, 'bic', null, 'nombre', coalesce(nullif(cf.legal_name, ''), p.name),
        'mandato', l.mandate_ref, 'firmado', l.mandate_date, 'primero', l.seq = 'FRST',
        'factura', ci.number_text, 'fecha_factura', ci.issue_date) order by p.name, ci.issue_date)
      from public.conta_cobro_remesa_linea_estado l
      join public.customer_invoice ci on ci.id = l.invoice_id
      left join public.party p on p.id = l.party_id
      left join public.customer_fiscal cf on cf.party_id = l.party_id
     where l.remesa_id = p_remesa and l.estado = 'pendiente'), '[]'::jsonb));
end $$;
revoke all on function public.conta_remesa_cobros_fichero_datos(uuid) from public, anon;
grant execute on function public.conta_remesa_cobros_fichero_datos(uuid) to authenticated;

create or replace function public.conta_remesa_cobros_descargada(p_remesa uuid, p_sha256 text, p_recibos integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_cobro_remesa_estado; v_t text;
begin
  select * into v_r from public.conta_cobro_remesa_estado where id = p_remesa;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  perform public._pc01e3_empresa(v_r.company_id);
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'Falta la huella del fichero.' using errcode = '22023'; end if;
  update public.conta_cobro_remesa set file_sha256 = p_sha256, file_at = coalesce(file_at, now()), file_by = coalesce(file_by, auth.uid()),
         file_by_name = coalesce(file_by_name, public.conta_nombre_actor(), 'Sumied') where id = p_remesa;
  select name into v_t from public.treasury_account where id = v_r.treasury_account_id;
  perform public._pc01e3_evento(v_r.account_id, p_remesa, null, format('Descarga el fichero para el banco: %s %s, %s (huella %s).',
    p_recibos, case when p_recibos = 1 then 'recibo' else 'recibos' end, public.conta_euros_exactos(v_r.por_abonar), left(p_sha256, 8)));
  return jsonb_build_object('frase', format('Fichero de la remesa %s descargado: %s %s. Súbelo a la banca de %s antes del %s; cuando llegue el abono, lo casas en Bancos y las facturas quedan cobradas.',
    v_r.code, p_recibos, case when p_recibos = 1 then 'recibo' else 'recibos' end, coalesce(v_t, 'tu banco'), to_char(v_r.charge_date, 'DD/MM')));
end $$;
revoke all on function public.conta_remesa_cobros_descargada(uuid, text, integer) from public, anon;
grant execute on function public.conta_remesa_cobros_descargada(uuid, text, integer) to authenticated;

-- ── 6 · El abono del banco ─────────────────────────────────────────────────
-- p_lineas: null = todos los recibos que esperan el abono (el banco abona la
-- remesa entera); o los que abona este movimiento. El importe tiene que ser el
-- mismo. Un asiento por bank_casar: el banco a su 572 contra la 430 de cada
-- cliente; cada factura, cobrada por su recibo (disparador del casado, E1).
create or replace function public.conta_remesa_cobros_casar(p_movement uuid, p_remesa uuid, p_lineas uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_cobro_remesa; v_m public.bank_movement; v_cuenta uuid; v_suma numeric := 0; v_lineas jsonb := '[]'::jsonb;
  v_match uuid; v_l record; v_n int := 0; v_cobradas int := 0; v_ids uuid[];
begin
  select * into v_r from public.conta_cobro_remesa where id = p_remesa for update;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._pc01e3_empresa(v_r.company_id);
  select * into v_m from public.bank_movement where id = p_movement;
  if v_m.id is null or v_m.company_id <> v_r.company_id then raise exception 'Ese movimiento no es de la empresa de la remesa.' using errcode = '23514'; end if;
  if v_m.amount <= 0 then raise exception 'El abono de una remesa de recibos entra en el banco, y este movimiento sale.' using errcode = '23514'; end if;
  if v_r.file_at is null then raise exception 'El fichero de la remesa % no se ha descargado: el banco aún no la tiene.', v_r.code using errcode = '23514'; end if;
  select array_agg(id order by id) into v_ids from public.conta_cobro_remesa_linea_estado
   where remesa_id = p_remesa and estado = 'pendiente' and (p_lineas is null or id = any(p_lineas));
  if v_ids is null then raise exception 'La remesa % no tiene recibos esperando el abono.', v_r.code using errcode = '23514'; end if;
  if p_lineas is not null and cardinality(v_ids) <> cardinality(p_lineas) then raise exception 'Alguno de esos recibos no está esperando el abono.' using errcode = '23514'; end if;
  for v_l in select l.party_id, p.name, public._pc01e3_cuenta_cliente(v_r.company_id, l.party_id) as cuenta,
                    sum(l.amount) as importe, string_agg(coalesce(ci.number_text, 'sin número'), ', ' order by ci.issue_date) as facturas
               from public.conta_cobro_remesa_linea l join public.customer_invoice ci on ci.id = l.invoice_id left join public.party p on p.id = l.party_id
              where l.id = any(v_ids) group by l.party_id, p.name loop
    if v_l.cuenta is null then raise exception '% no tiene su cuenta de cliente (430) en el plan.', coalesce(v_l.name, 'Un cliente') using errcode = '23514'; end if;
    v_suma := v_suma + v_l.importe;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_l.cuenta, 'importe', v_l.importe, 'tercero_id', v_l.party_id,
      'concepto', format('Cobro remesa %s · %s · %s', v_r.code, coalesce(v_l.name, ''), v_l.facturas)));
  end loop;
  if abs(v_suma - v_m.amount) >= 0.005 then
    raise exception 'El abono es de % y lo que espera la remesa % es %.', public.conta_euros_exactos(v_m.amount), v_r.code, public.conta_euros_exactos(v_suma) using errcode = '23514';
  end if;
  perform public.bank_casar(p_movement, jsonb_build_object('tipo', 'cuenta', 'concepto', format('Cobro remesa %s', v_r.code), 'lineas', v_lineas),
    'seguro', format('Es el abono de la remesa de recibos %s: %s.', v_r.code, public.conta_euros_exactos(v_suma)), '[]'::jsonb, 'persona', null);
  select id into v_match from public.bank_match where movement_id = p_movement and status = 'vivo';
  for v_l in select l.id, l.invoice_id, l.amount from public.conta_cobro_remesa_linea l where l.id = any(v_ids) loop
    insert into public.bank_match_item (account_id, match_id, customer_invoice_id, amount, marked_by_bank)
    values (v_cuenta, v_match, v_l.invoice_id, v_l.amount, true);
    update public.conta_cobro_remesa_linea set bank_match_id = v_match where id = v_l.id;
    if (select pendiente from public.conta_factura_cobro where invoice_id = v_l.invoice_id) < 0.005 then v_cobradas := v_cobradas + 1; end if;
    v_n := v_n + 1;
  end loop;
  -- El disparador del casado los apunta como transferencia salvo que el concepto diga «recibo»: son recibos.
  update public.customer_invoice_payment set method = 'direct_debit' where bank_match_id = v_match;
  perform public._pc01e3_evento(v_cuenta, p_remesa, null, format('Llega el abono del %s en el banco: %s %s, %s %s.',
    to_char(v_m.op_date, 'DD/MM/YYYY'), v_n, case when v_n = 1 then 'recibo cobrado' else 'recibos cobrados' end,
    v_cobradas, case when v_cobradas = 1 then 'factura cobrada' else 'facturas cobradas' end));
  return jsonb_build_object('casado', v_match, 'recibos', v_n, 'cobradas', v_cobradas,
    'frase', format('Casado con la remesa %s: %s %s, %s. %s %s. Un recibo se puede devolver durante 8 semanas: si llega alguno, se casa con su recibo.',
      v_r.code, v_n, case when v_n = 1 then 'recibo' else 'recibos' end, public.conta_euros_exactos(v_suma),
      v_cobradas, case when v_cobradas = 1 then 'factura queda cobrada' else 'facturas quedan cobradas' end));
end $$;
revoke all on function public.conta_remesa_cobros_casar(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.conta_remesa_cobros_casar(uuid, uuid, uuid[]) to authenticated;
comment on function public.conta_remesa_cobros_casar(uuid, uuid, uuid[]) is
  'PC01 · E3 · Casa el abono del banco con una remesa de recibos (entera o los recibos que abona): un asiento (572 contra las 430) y las facturas cobradas. Deshacer el casado lo devuelve todo.';

-- ── 7 · Un recibo devuelto ─────────────────────────────────────────────────
-- El cargo de la devolución (el recibo más los gastos del banco) se casa con
-- su recibo: la 430 del cliente por el recibo y la 626 por los gastos, contra
-- la 572. La factura vuelve a «Por cobrar» con un cobro en negativo atado a ese
-- casado (deshacerlo en Bancos lo quita: disparador del E1).
create or replace function public.conta_recibo_devuelto(p_linea uuid, p_movement uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.conta_cobro_remesa_linea_estado; v_r public.conta_cobro_remesa; v_m public.bank_movement; v_cuenta uuid;
  v_cli text; v_gas text; v_fee numeric; v_lineas jsonb; v_match uuid; v_entry uuid; v_ci public.customer_invoice; v_nombre text;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  select * into v from public.conta_cobro_remesa_linea_estado where id = p_linea;
  if v.id is null then raise exception 'Ese recibo no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._pc01e3_empresa(v.company_id);
  perform 1 from public.conta_cobro_remesa_linea where id = p_linea for update;
  select * into v_r from public.conta_cobro_remesa where id = v.remesa_id;
  if v.estado <> 'cobrado' then raise exception 'Solo se devuelve un recibo cobrado (este está %).', v.estado using errcode = '23514'; end if;
  if v_motivo is null then raise exception 'Di el motivo de la devolución (el que da el banco).' using errcode = '22023'; end if;
  select * into v_m from public.bank_movement where id = p_movement;
  if v_m.id is null or v_m.company_id <> v.company_id then raise exception 'Ese movimiento no es de la empresa del recibo.' using errcode = '23514'; end if;
  if v_m.amount >= 0 then raise exception 'Una devolución sale del banco, y este movimiento entra.' using errcode = '23514'; end if;
  v_fee := round(abs(v_m.amount) - v.amount, 2);
  if v_fee < 0 then raise exception 'El cargo (%) es menor que el recibo (%): no es su devolución.', public.conta_euros_exactos(abs(v_m.amount)), public.conta_euros_exactos(v.amount) using errcode = '23514'; end if;
  if v_fee > 30 then raise exception 'El cargo (%) pasa del recibo (%) en más de 30 €: no parecen gastos de devolución.', public.conta_euros_exactos(abs(v_m.amount)), public.conta_euros_exactos(v.amount) using errcode = '23514'; end if;
  select * into v_ci from public.customer_invoice where id = v.invoice_id for update;
  select name into v_nombre from public.party where id = v.party_id;
  v_cli := public._pc01e3_cuenta_cliente(v.company_id, v.party_id);
  if v_cli is null then raise exception '% no tiene su cuenta de cliente (430) en el plan.', coalesce(v_nombre, 'El cliente') using errcode = '23514'; end if;
  v_lineas := jsonb_build_array(jsonb_build_object('cuenta', v_cli, 'importe', v.amount, 'tercero_id', v.party_id,
    'concepto', format('Devolución recibo %s · %s · %s', coalesce(v_ci.number_text, ''), coalesce(v_nombre, ''), v_motivo)));
  if v_fee > 0 then
    v_gas := public._pc01e3_cuenta_gastos(v.company_id);
    if v_gas is null then raise exception 'La empresa no tiene una cuenta 626 para los gastos de devolución: créala en el plan.' using errcode = '23514'; end if;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_gas, 'importe', v_fee, 'concepto', format('Gastos devolución recibo %s', coalesce(v_ci.number_text, ''))));
  end if;
  perform public.bank_casar(p_movement, jsonb_build_object('tipo', 'cuenta', 'concepto', format('Devolución recibo %s', coalesce(v_ci.number_text, '')), 'lineas', v_lineas),
    'seguro', format('Es la devolución del recibo de la %s (remesa %s): %s más %s de gastos.', coalesce(v_ci.number_text, 'factura'), v_r.code,
      public.conta_euros_exactos(v.amount), public.conta_euros_exactos(v_fee)), '[]'::jsonb, 'persona', null);
  select id, journal_entry_id into v_match, v_entry from public.bank_match where movement_id = p_movement and status = 'vivo';
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, bank_match_id, created_by, created_by_name)
  values (v_cuenta, v.company_id, v.invoice_id, v_m.op_date, -v.amount, 'direct_debit', format('Recibo devuelto (%s): %s.', v_r.code, v_motivo),
          v_entry, v_match, auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'));
  update public.conta_cobro_remesa_linea set returned_at = now(), return_reason = v_motivo, return_fee = v_fee, return_match_id = v_match,
         returned_by_name = coalesce(public.conta_nombre_actor(), 'Sumied') where id = p_linea;
  perform public._conta_venta_evento(v.invoice_id, 'cobro_devuelto',
    format('%s devolvió el recibo de %s el %s (%s). La factura vuelve a «Por cobrar».', coalesce(v_nombre, 'El cliente'), public.conta_euros_exactos(v.amount),
      to_char(v_m.op_date, 'DD/MM/YYYY'), v_motivo), jsonb_build_object('remesa', v_r.id, 'casado', v_match, 'gastos', v_fee), null);
  perform public._pc01e3_evento(v_cuenta, v.remesa_id, p_linea, format('%s devuelve el recibo de la %s el %s (%s), con %s de gastos.',
    coalesce(v_nombre, 'El cliente'), coalesce(v_ci.number_text, 'factura'), to_char(v_m.op_date, 'DD/MM/YYYY'), v_motivo, public.conta_euros_exactos(v_fee)));
  return jsonb_build_object('casado', v_match, 'gastos', v_fee,
    'frase', format('%s devolvió el recibo de la %s (%s): su factura vuelve a «Por cobrar», y los %s de gastos van a la %s.',
      coalesce(v_nombre, 'El cliente'), coalesce(v_ci.number_text, 'factura'), v_motivo, public.conta_euros_exactos(v_fee), coalesce(v_gas, '626')));
end $$;
revoke all on function public.conta_recibo_devuelto(uuid, uuid, text) from public, anon;
grant execute on function public.conta_recibo_devuelto(uuid, uuid, text) to authenticated;
comment on function public.conta_recibo_devuelto(uuid, uuid, text) is
  'PC01 · E3 · Casa la devolución de un recibo (430 del cliente y 626 de los gastos contra 572); la factura vuelve a «Por cobrar». Deshacer el casado lo devuelve todo.';

-- Lo que Bancos ofrece: para un abono, las remesas que lo esperan (con lo que
-- esperan entero y cada recibo); para un cargo, los recibos cobrados que aún
-- pueden volver devueltos (dentro de las 8 semanas).
create or replace function public.conta_cobros_para_casar(p_company uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'abonos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'codigo', r.code, 'cargo', r.charge_date, 'por_abonar', r.por_abonar,
        'recibos', (select jsonb_agg(jsonb_build_object('id', l.id, 'importe', l.amount, 'cliente', p.name, 'factura', ci.number_text) order by p.name)
                      from public.conta_cobro_remesa_linea_estado l join public.customer_invoice ci on ci.id = l.invoice_id left join public.party p on p.id = l.party_id
                     where l.remesa_id = r.id and l.estado = 'pendiente')) order by r.charge_date)
      from public.conta_cobro_remesa_estado r where r.company_id = p_company and r.estado = 'en_banco' and r.por_abonar > 0), '[]'::jsonb),
    'devoluciones', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'remesa', r.code, 'importe', l.amount, 'cliente', p.name, 'factura', ci.number_text, 'abonado', l.abonado_el) order by l.abonado_el desc)
      from public.conta_cobro_remesa_linea_estado l join public.conta_cobro_remesa r on r.id = l.remesa_id
      join public.customer_invoice ci on ci.id = l.invoice_id left join public.party p on p.id = l.party_id
     where r.company_id = p_company and l.estado = 'cobrado' and l.abonado_el >= public.conta_hoy() - 56), '[]'::jsonb))
$$;
grant execute on function public.conta_cobros_para_casar(uuid) to authenticated;

-- ── 8 · Las remesas y la ficha de una ──────────────────────────────────────
create or replace function public.conta_remesas_cobros_lista(p_company uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'codigo', r.code, 'cargo', r.charge_date, 'estado', r.estado, 'total', r.total, 'cobrado', r.cobrado,
           'recibos', r.vivas, 'cobrados', r.cobrados, 'devueltos', r.devueltos, 'plazo_hasta', r.plazo_hasta,
           'banco', (select t.name from public.treasury_account t where t.id = r.treasury_account_id)) order by r.charge_date desc, r.code desc), '[]'::jsonb)
    from public.conta_cobro_remesa_estado r where r.company_id = p_company
$$;
grant execute on function public.conta_remesas_cobros_lista(uuid) to authenticated;

-- La ficha: datos, recibos (con su mandato y su devuelto), las cuentas del
-- asiento, el identificador de acreedor y el historial.
create or replace function public.conta_remesa_cobros_ficha(p_remesa uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_r public.conta_cobro_remesa_estado; v_t public.treasury_account; v_c public.company;
begin
  select * into v_r from public.conta_cobro_remesa_estado where id = p_remesa;
  if v_r.id is null then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  if not public.belongs_to_account(v_r.account_id) then raise exception 'Esa remesa no existe.' using errcode = 'P0002'; end if;
  select * into v_t from public.treasury_account where id = v_r.treasury_account_id;
  select * into v_c from public.company where id = v_r.company_id;
  return jsonb_build_object(
    'id', v_r.id, 'codigo', v_r.code, 'cargo', v_r.charge_date, 'estado', v_r.estado, 'total', v_r.total, 'cobrado', v_r.cobrado,
    'por_abonar', v_r.por_abonar, 'recibos_vivos', v_r.vivas, 'cobrados', v_r.cobrados, 'devueltos', v_r.devueltos,
    'abonada_el', v_r.abonada_el, 'plazo_hasta', v_r.plazo_hasta,
    'fichero_at', v_r.file_at, 'fichero_por', v_r.file_by_name, 'creada', v_r.created_at, 'creada_por', v_r.created_by_name,
    'empresa', coalesce(nullif(v_c.trade_name, ''), v_c.legal_name),
    'acreedor', public._pc01e3_identificador_acreedor(v_c.tax_id, v_t.sepa_suffix),
    'banco', jsonb_build_object('id', v_t.id, 'nombre', v_t.name, 'iban4', right(public._pc01e2_iban(v_t.iban), 4), 'cuenta', public._bank_cuenta_572(v_t.id)),
    'cuenta_gastos', public._pc01e3_cuenta_gastos(v_r.company_id),
    'recibos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'factura_id', l.invoice_id, 'numero', ci.number_text, 'fecha', ci.issue_date, 'importe', l.amount, 'estado', l.estado,
        'cliente', p.name, 'cliente_id', l.party_id, 'cuenta', public._pc01e3_cuenta_cliente(v_r.company_id, l.party_id),
        'iban4', right(l.iban, 4), 'iban_pais', left(l.iban, 2), 'mandato', l.mandate_ref, 'firmado', l.mandate_date, 'primero', l.seq = 'FRST',
        'abonado', l.abonado_el, 'devuelto', l.devuelto_el, 'motivo', l.return_reason, 'gastos', l.return_fee,
        -- La factura aún por cobrar (para «Pasar el devuelto en la próxima remesa»).
        'pendiente', (select pendiente from public.conta_factura_cobro where invoice_id = l.invoice_id),
        'mandato_ficha', (select jsonb_build_object('ref', m.ref, 'firmado', m.signed_at, 'como', 'enlace', 'firmante', m.signed_name, 'token', m.token)
                            from public.conta_mandato m where m.party_id = l.party_id and m.company_id = v_r.company_id and m.ref = l.mandate_ref and m.status = 'firmado' limit 1),
        'ultimo_cobro', (select jsonb_build_object('fecha', x.abonado_el, 'estado', x.estado) from public.conta_cobro_remesa_linea_estado x
                          where x.party_id = l.party_id and x.mandate_ref = l.mandate_ref and x.estado in ('cobrado', 'devuelto') and x.id <> l.id
                          order by x.abonado_el desc nulls last limit 1))
        order by p.name, ci.issue_date)
      from public.conta_cobro_remesa_linea_estado l
      join public.customer_invoice ci on ci.id = l.invoice_id
      left join public.party p on p.id = l.party_id
     where l.remesa_id = p_remesa and l.estado <> 'sacada'), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'por', e.by_name, 'texto', e.texto) order by e.at)
                            from public.conta_cobro_remesa_evento e where e.remesa_id = p_remesa), '[]'::jsonb));
end $$;
revoke all on function public.conta_remesa_cobros_ficha(uuid) from public, anon;
grant execute on function public.conta_remesa_cobros_ficha(uuid) to authenticated;

-- ── 9 · Los mandatos ───────────────────────────────────────────────────────
-- Preparar el mandato de un cliente: su referencia (SUM-000001) y un enlace de
-- un solo uso que vale 30 días. Anula el que estuviera por firmar. El correo lo
-- manda la función conta-mandato-enviar (con el freno de los correos); aquí
-- solo se prepara, y el enlace se puede copiar y mandar a mano.
create or replace function public.conta_mandato_preparar(p_company uuid, p_party uuid, p_correo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._pc01e3_empresa(p_company); v_p public.party; v_ref text; v_token text; v_id uuid;
        v_correo text := nullif(lower(trim(coalesce(p_correo, ''))), '');
begin
  select * into v_p from public.party where id = p_party and account_id = v_cuenta;
  if v_p.id is null then raise exception 'Ese cliente no es de la cuenta.' using errcode = 'P0002'; end if;
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Ese correo no vale.' using errcode = '22023'; end if;
  update public.conta_mandato set status = 'anulado', cancelled_at = now() where party_id = p_party and company_id = p_company and status = 'por_firmar';
  v_ref := public._pc01e3_ref_mandato(p_company);
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.conta_mandato (account_id, company_id, party_id, ref, token, expires_at, sent_to, created_by, created_by_name)
  values (v_cuenta, p_company, p_party, v_ref, v_token, now() + interval '30 days', v_correo, auth.uid(), coalesce(public.conta_nombre_actor(), 'Sumied'))
  returning id into v_id;
  return jsonb_build_object('mandato', v_id, 'ref', v_ref, 'token', v_token, 'enlace', '/mandato.html?t=' || v_token, 'correo', v_correo,
    'caduca', (now() + interval '30 days')::date,
    'frase', format('Mandato %s de %s preparado: el enlace para firmarlo vale 30 días.', v_ref, v_p.name));
end $$;
revoke all on function public.conta_mandato_preparar(uuid, uuid, text) from public, anon;
grant execute on function public.conta_mandato_preparar(uuid, uuid, text) to authenticated;

-- Apuntar que el correo con el enlace salió (lo llama conta-mandato-enviar).
create or replace function public.conta_mandato_enviado(p_mandato uuid, p_correo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conta_mandato set sent_to = coalesce(nullif(lower(trim(p_correo)), ''), sent_to), sent_at = now()
   where id = p_mandato and public.current_user_is_admin_or_manager_of(account_id);
end $$;
revoke all on function public.conta_mandato_enviado(uuid, text) from public, anon;
grant execute on function public.conta_mandato_enviado(uuid, text) to authenticated;

-- Lo que enseña la página del enlace, SIN CUENTA (anon): el acreedor, el
-- cliente, la referencia y si ya está firmado. Con el token y nada más.
create or replace function public.conta_mandato_para_firmar(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.conta_mandato; v_c public.company; v_p public.party; v_t public.treasury_account; v_cf public.customer_fiscal;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('estado', 'no_existe'); end if;
  select * into v from public.conta_mandato where token = p_token;
  if v.id is null then return jsonb_build_object('estado', 'no_existe'); end if;
  select * into v_c from public.company where id = v.company_id;
  select * into v_p from public.party where id = v.party_id;
  select * into v_cf from public.customer_fiscal where party_id = v.party_id;
  select * into v_t from public.treasury_account where company_id = v.company_id and is_active and kind = 'bank' order by created_at limit 1;
  return jsonb_build_object(
    'estado', case when v.status = 'firmado' then 'firmado' when v.status = 'anulado' then 'anulado' when v.expires_at < now() then 'caducado' else 'por_firmar' end,
    'ref', v.ref,
    'acreedor', jsonb_build_object('nombre', coalesce(nullif(v_c.legal_name, ''), v_c.trade_name),
      'identificador', public._pc01e3_identificador_acreedor(v_c.tax_id, v_t.sepa_suffix),
      'direccion', concat_ws(', ', nullif(v_c.fiscal_street, ''), nullif(concat_ws(' ', v_c.fiscal_postal_code, v_c.fiscal_city), ''))),
    'deudor', jsonb_build_object('nombre', coalesce(nullif(v_cf.legal_name, ''), v_p.name), 'nif', v_p.tax_id),
    'firmado', case when v.status = 'firmado' then jsonb_build_object('at', v.signed_at, 'nombre', v.signed_name, 'nif', v.signed_tax_id,
                    'iban', left(v.iban, 4) || ' •••• •••• ' || right(v.iban, 4)) end);
end $$;
revoke all on function public.conta_mandato_para_firmar(text) from public;
grant execute on function public.conta_mandato_para_firmar(text) to anon, authenticated;

-- Firmar, SIN CUENTA (anon): nombre de quien firma, su IBAN (módulo 97) y el
-- «sí» al texto del mandato. Queda quién, cuándo, desde qué dirección y con qué
-- navegador; y la ficha del cliente, con el IBAN, la referencia, la fecha y
-- «paga por domiciliación».
create or replace function public.conta_mandato_firmar(p_token text, p_nombre text, p_nif text, p_iban text, p_acepto boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.conta_mandato; v_iban text := public._pc01e2_iban(regexp_replace(coalesce(p_iban, ''), '[-.]', '', 'g'));
        v_nombre text := nullif(trim(coalesce(p_nombre, '')), ''); v_h json; v_p public.party; v_hoy date := public.conta_hoy();
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then raise exception 'Ese enlace no vale.' using errcode = 'P0002'; end if;
  select * into v from public.conta_mandato where token = p_token for update;
  if v.id is null then raise exception 'Ese enlace no vale.' using errcode = 'P0002'; end if;
  if v.status = 'firmado' then raise exception 'Este mandato ya está firmado.' using errcode = '23514'; end if;
  if v.status = 'anulado' then raise exception 'Este enlace ya no vale: te han mandado otro más nuevo.' using errcode = '23514'; end if;
  if v.expires_at < now() then raise exception 'Este enlace ha caducado: pide otro a quien te lo mandó.' using errcode = '23514'; end if;
  if v_nombre is null or length(v_nombre) < 3 then raise exception 'Escribe el nombre de quien firma.' using errcode = '22023'; end if;
  if v_iban is null or not public._pc01e2b_iban_valido(v_iban) then raise exception 'Ese IBAN no es correcto: revisa los dígitos.' using errcode = '22023'; end if;
  if p_acepto is not true then raise exception 'Para firmar, marca que aceptas el mandato.' using errcode = '22023'; end if;
  begin v_h := nullif(current_setting('request.headers', true), '')::json; exception when others then v_h := null; end;
  update public.conta_mandato set status = 'firmado', iban = v_iban, signed_at = now(), signed_name = left(v_nombre, 140),
         signed_tax_id = nullif(upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')), ''),
         signed_ip = left(split_part(coalesce(v_h->>'x-forwarded-for', v_h->>'x-real-ip', ''), ',', 1), 64),
         signed_agent = left(v_h->>'user-agent', 300), text_version = 'core-recurrente-es-1'
   where id = v.id;
  select * into v_p from public.party where id = v.party_id;
  insert into public.customer_fiscal (party_id, account_id, legal_name, iban, sepa_mandate_ref, sepa_mandate_date, payment_method)
  values (v.party_id, v.account_id, v_p.name, v_iban, v.ref, v_hoy, 'direct_debit')
  on conflict (party_id) do update set iban = excluded.iban, sepa_mandate_ref = excluded.sepa_mandate_ref, sepa_mandate_date = excluded.sepa_mandate_date,
                                       payment_method = 'direct_debit', updated_at = now();
  return jsonb_build_object('frase', format('Mandato %s firmado. Gracias: los próximos recibos se cargarán en la cuenta que termina en %s.', v.ref, right(v_iban, 4)));
end $$;
revoke all on function public.conta_mandato_firmar(text, text, text, text, boolean) from public;
grant execute on function public.conta_mandato_firmar(text, text, text, text, boolean) to anon, authenticated;
