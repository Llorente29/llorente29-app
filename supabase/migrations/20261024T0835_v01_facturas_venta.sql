-- supabase/migrations/20261024T0835_v01_facturas_venta.sql
--
-- V01 · Entrega 1 · Ventas › Facturas (Julio, 24/10): la factura de venta es
-- un documento propio. Hasta hoy una venta solo era un asiento con su anotación
-- en el libro de expedidas; ahora tiene su borrador, que se cambia entero, y al
-- emitirla su número, su asiento, su PDF y su envío a Diez.
--
-- Solo añade. No cambia ninguna función ni ninguna tabla que ya exista, y se
-- puede pasar dos veces seguidas:
--
--   1. customer_invoice, customer_invoice_line: la factura y sus líneas. Un borrador
--      se cambia y se borra; una emitida no se borra NUNCA (ni el disparador
--      deja: solo se anula con su rectificativa).
--   2. customer_invoice_counter: el contador de cada serie y año. El número se da
--      al emitir, en la MISMA transacción que el asiento: si algo falla (un mes
--      cerrado, una cuenta que falta) no se gasta número. Correlativa y sin
--      huecos por serie y año.
--   3. customer_invoice_payment, customer_invoice_event: los cobros y el historial.
--   4. Las funciones del front (guardar, borrar, emitir, corregir, cobrar) y
--      las del servidor (el PDF y el correo, desde conta-venta-documento).
--
-- El asiento se hace con lo que ya hay: _journal_entry_proponer (serie 1,
-- Ventas, source_type 'customer_invoice') y journal_entry_validar, con todas sus
-- reglas. El libro de expedidas lo rellena su disparador al validar
-- (conta_vat_book_desde_asiento); esta función le pone después lo que el
-- disparador no sabe de una factura de venta (rectificativa, recargo y
-- retención). Diez lo recoge solo, como cualquier asiento validado
-- (conta_diez_por_enviar): va como asiento, igual que hoy la emitida a mano.
--
-- Verifactu: cada emitida guarda su huella encadenada con la anterior de la
-- empresa (prev_hash, hash). Preparado; no es aún el registro de Verifactu.
--
-- Lo único que cambia de lo que hay, el CHECK de los orígenes de un asiento
-- ('customer_invoice'), va aparte, en la 0836: así esta, que solo añade y se
-- puede pasar dos veces, entra de verdad en staging desde la rama (W05) y las
-- e2e ven las pantallas; la 0836 solo se ensaya hasta que esté en producción.

-- Vuelta atrás: supabase/vuelta-atras/20261024T0835_v01_facturas_venta.down.sql

-- 1 · La factura y sus líneas ---------------------------------------------------------
create table if not exists public.customer_invoice (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  status             text not null default 'borrador' check (status in ('borrador', 'emitida', 'anulada')),
  doc_type           text not null default 'factura' check (doc_type in ('factura', 'rectificativa')),
  origin             text not null default 'a_mano' check (origin in ('a_mano', 'recurrente', 'presupuesto', 'cierre_dia', 'tienda', 'automatica')),
  series_code        text not null default 'F' check (series_code ~ '^[A-Z0-9][A-Z0-9-]{0,9}$'),
  fiscal_year        integer,
  number             integer,
  number_text        text,
  issue_date         date not null default (now() at time zone 'Europe/Madrid')::date,
  due_date           date,
  party_id           uuid references public.party(id),
  -- Lo que el PDF dice del cliente, tal como era al emitir (nombre, NIF, dirección, correo).
  customer           jsonb not null default '{}'::jsonb,
  location_id        uuid,
  payment_method_id  uuid references public.payment_method(id),
  notes              text,
  email_to           text,
  withholding_rate_id uuid references public.withholding_rate(id),
  surcharge          boolean not null default false,
  corrects_id        uuid references public.customer_invoice(id),
  correction_kind    text check (correction_kind in ('importes', 'anular', 'datos')),
  correction_reason  text,
  -- Las cifras, rehechas al guardar (borrador) y fijadas al emitir. En una
  -- rectificativa, la diferencia con la que corrige.
  base               numeric(14,2) not null default 0,
  tax                numeric(14,2) not null default 0,
  surcharge_amount   numeric(14,2) not null default 0,
  withholding_amount numeric(14,2) not null default 0,
  total              numeric(14,2) not null default 0,
  entry_id           uuid references public.journal_entry(id),
  pdf_path           text,
  pdf_sha256         text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_bytes          integer,
  sent_at            timestamptz,
  prev_hash          text,
  hash               text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text,
  updated_at         timestamptz not null default now(),
  issued_at          timestamptz,
  issued_by_name     text,
  constraint customer_invoice_numero_al_emitir check (status = 'borrador' or (number is not null and number_text is not null and fiscal_year is not null)),
  constraint customer_invoice_rectificativa check ((doc_type = 'rectificativa') = (corrects_id is not null and correction_kind is not null)),
  unique (company_id, series_code, fiscal_year, number)
);
comment on table public.customer_invoice is
  'V01 · La factura de venta: borrador (se cambia y se borra) o emitida (número, asiento, PDF y envío a Diez; no se borra nunca: se corrige con su rectificativa).';
create index if not exists customer_invoice_empresa_idx on public.customer_invoice (company_id, issue_date desc);
create index if not exists customer_invoice_corrige_idx on public.customer_invoice (corrects_id) where corrects_id is not null;

create table if not exists public.customer_invoice_line (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  invoice_id         uuid not null references public.customer_invoice(id) on delete cascade,
  position           smallint not null,
  concept            text not null check (btrim(concept) <> ''),
  quantity           numeric(14,3) not null default 1,
  unit_price         numeric(14,4) not null default 0,
  discount_pct       numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  tax_rate_id        uuid not null references public.tax_rate(id),
  tax_pct            numeric(5,2) not null,
  surcharge_pct      numeric(5,2),
  revenue_account_id uuid not null references public.company_account(id),
  amount             numeric(14,2) not null,
  unique (invoice_id, position)
);
comment on table public.customer_invoice_line is 'V01 · Las líneas de una factura de venta. amount = cantidad × precio − descuento (la base de la línea).';

-- 2 · El contador de cada serie y año ----------------------------------------------
create table if not exists public.customer_invoice_counter (
  company_id   uuid not null references public.company(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  series_code  text not null,
  fiscal_year  integer not null,
  last_number  integer not null check (last_number >= 0),
  primary key (company_id, series_code, fiscal_year)
);
comment on table public.customer_invoice_counter is 'V01 · El último número dado de cada serie y año. Solo lo mueve conta_venta_emitir, en la transacción del asiento: sin huecos.';

-- 3 · Los cobros y el historial ---------------------------------------------------------
create table if not exists public.customer_invoice_payment (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  invoice_id       uuid not null references public.customer_invoice(id) on delete cascade,
  paid_on          date not null,
  amount           numeric(14,2) not null check (amount > 0),
  method           text,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text
);
comment on table public.customer_invoice_payment is 'V01 · Lo cobrado de una factura (puede ser en partes). No hace asiento: el del cobro lo hace Bancos al casar el movimiento.';
create index if not exists customer_invoice_payment_factura_idx on public.customer_invoice_payment (invoice_id);

create table if not exists public.customer_invoice_event (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  invoice_id  uuid not null references public.customer_invoice(id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null,
  text        text not null,
  detail      jsonb,
  by_name     text
);
comment on table public.customer_invoice_event is 'V01 · El historial de una factura de venta, en frases: creada, emitida, enviada, cobrada, corregida.';
create index if not exists customer_invoice_event_factura_idx on public.customer_invoice_event (invoice_id, at);

-- Leer: quien es de la cuenta. Escribir: solo por las funciones de abajo.
alter table public.customer_invoice enable row level security;
alter table public.customer_invoice_line enable row level security;
alter table public.customer_invoice_counter enable row level security;
alter table public.customer_invoice_payment enable row level security;
alter table public.customer_invoice_event enable row level security;
revoke all on public.customer_invoice, public.customer_invoice_line, public.customer_invoice_counter, public.customer_invoice_payment, public.customer_invoice_event from public, anon, authenticated;
grant select on public.customer_invoice, public.customer_invoice_line, public.customer_invoice_payment, public.customer_invoice_event to authenticated;
drop policy if exists customer_invoice_leer on public.customer_invoice;
create policy customer_invoice_leer on public.customer_invoice for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists customer_invoice_line_leer on public.customer_invoice_line;
create policy customer_invoice_line_leer on public.customer_invoice_line for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists customer_invoice_payment_leer on public.customer_invoice_payment;
create policy customer_invoice_payment_leer on public.customer_invoice_payment for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists customer_invoice_event_leer on public.customer_invoice_event;
create policy customer_invoice_event_leer on public.customer_invoice_event for select to authenticated using (public.belongs_to_account(account_id));

-- Una emitida no se borra nunca, y lo que la hace factura no se cambia.
create or replace function public.customer_invoice_inalterable()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'borrador' then
      raise exception 'Una factura emitida no se borra nunca: se corrige con su rectificativa.' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status <> 'borrador' and (
       new.number is distinct from old.number or new.number_text is distinct from old.number_text or new.series_code is distinct from old.series_code
       or new.fiscal_year is distinct from old.fiscal_year or new.issue_date is distinct from old.issue_date or new.customer is distinct from old.customer
       or new.base is distinct from old.base or new.tax is distinct from old.tax or new.total is distinct from old.total
       or new.surcharge_amount is distinct from old.surcharge_amount or new.withholding_amount is distinct from old.withholding_amount
       or new.hash is distinct from old.hash or new.doc_type is distinct from old.doc_type or new.corrects_id is distinct from old.corrects_id
       or (old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256)) then
    raise exception 'La factura % ya está emitida: no se cambia. Se corrige con «Corregir».', old.number_text using errcode = '23514';
  end if;
  if old.status = 'anulada' and new.status <> 'anulada' then
    raise exception 'Una factura anulada no vuelve atrás.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_customer_invoice_inalterable on public.customer_invoice;
create trigger trg_customer_invoice_inalterable before update or delete on public.customer_invoice
  for each row execute function public.customer_invoice_inalterable();

create or replace function public.customer_invoice_line_inalterable()
returns trigger language plpgsql set search_path = public as $$
declare v_estado text;
begin
  select status into v_estado from public.customer_invoice where id = coalesce(new.invoice_id, old.invoice_id);
  -- Al borrar un borrador entero (cascada) la factura ya no está: se deja.
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'Las líneas de una factura emitida no se cambian.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_customer_invoice_line_inalterable on public.customer_invoice_line;
create trigger trg_customer_invoice_line_inalterable before insert or update or delete on public.customer_invoice_line
  for each row execute function public.customer_invoice_line_inalterable();

-- 4 · Las cuentas: cada línea, su tipo y su cifra -----------------------------------------
-- Las cifras de una factura con sus líneas: base, IVA y recargo por tipo,
-- retención y total. Redondeo por tipo (la suma de las bases de un tipo × su
-- porcentaje), como el PDF y el asiento.
create or replace function public._conta_venta_cifras(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_ret numeric := 0; v_base numeric; v_iva numeric; v_rec numeric; v_retencion numeric;
  v_tipos jsonb; v_cuentas jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id;
  if v_f.withholding_rate_id is not null then select rate into v_ret from public.withholding_rate where id = v_f.withholding_rate_id; end if;
  with l as (
    select tax_rate_id, tax_pct, coalesce(surcharge_pct, 0) as rec_pct, revenue_account_id, amount from public.customer_invoice_line where invoice_id = p_id
  ), t as (
    select tax_rate_id, tax_pct, rec_pct, sum(amount) as base,
           round(sum(amount) * tax_pct / 100, 2) as iva,
           case when v_f.surcharge then round(sum(amount) * rec_pct / 100, 2) else 0 end as rec
      from l group by tax_rate_id, tax_pct, rec_pct
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo_id', tax_rate_id, 'pct', tax_pct, 'rec_pct', rec_pct, 'base', base, 'iva', iva, 'rec', rec) order by tax_pct desc), '[]'),
         coalesce(sum(base), 0), coalesce(sum(iva), 0), coalesce(sum(rec), 0)
    into v_tipos, v_base, v_iva, v_rec from t;
  select coalesce(jsonb_agg(jsonb_build_object('cuenta_id', revenue_account_id, 'base', s) order by revenue_account_id), '[]') into v_cuentas
    from (select revenue_account_id, sum(amount) s from public.customer_invoice_line where invoice_id = p_id group by revenue_account_id) x;
  v_retencion := round(v_base * coalesce(v_ret, 0) / 100, 2);
  return jsonb_build_object('base', v_base, 'iva', v_iva, 'recargo', v_rec, 'retencion', v_retencion, 'retencion_pct', coalesce(v_ret, 0),
                            'total', v_base + v_iva + v_rec - v_retencion, 'tipos', v_tipos, 'cuentas', v_cuentas);
end $$;
revoke all on function public._conta_venta_cifras(uuid) from public, anon, authenticated;

-- La diferencia de una rectificativa: sus líneas (lo que debía ser) menos las
-- de la factura que corrige, por tipo y por cuenta. «Anular» la deja en
-- negativo entera; «datos del cliente», a cero.
create or replace function public._conta_venta_diferencia(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_f public.customer_invoice; v_nueva jsonb; v_vieja jsonb; v_tipos jsonb; v_cuentas jsonb; v_r jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id;
  v_vieja := public._conta_venta_cifras(v_f.corrects_id);
  if v_f.correction_kind = 'datos' then
    return jsonb_build_object('base', 0, 'iva', 0, 'recargo', 0, 'retencion', 0, 'retencion_pct', v_vieja->'retencion_pct', 'total', 0, 'tipos', '[]'::jsonb, 'cuentas', '[]'::jsonb);
  end if;
  if v_f.correction_kind = 'anular' then
    v_nueva := jsonb_build_object('base', 0, 'iva', 0, 'recargo', 0, 'retencion', 0, 'total', 0, 'tipos', '[]'::jsonb, 'cuentas', '[]'::jsonb);
  else
    v_nueva := public._conta_venta_cifras(p_id);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('tipo_id', k, 'pct', pct, 'rec_pct', rec_pct, 'base', b, 'iva', i, 'rec', r) order by pct desc), '[]')
    into v_tipos
    from (select k, max(pct) pct, max(rec_pct) rec_pct, sum(b) b, sum(i) i, sum(r) r from (
            select x->>'tipo_id' k, (x->>'pct')::numeric pct, (x->>'rec_pct')::numeric rec_pct, (x->>'base')::numeric b, (x->>'iva')::numeric i, (x->>'rec')::numeric r
              from jsonb_array_elements(v_nueva->'tipos') x
            union all
            select x->>'tipo_id', (x->>'pct')::numeric, (x->>'rec_pct')::numeric, -(x->>'base')::numeric, -(x->>'iva')::numeric, -(x->>'rec')::numeric
              from jsonb_array_elements(v_vieja->'tipos') x) u group by k) d
   where b <> 0 or i <> 0 or r <> 0;
  select coalesce(jsonb_agg(jsonb_build_object('cuenta_id', k, 'base', b) order by k), '[]') into v_cuentas
    from (select k, sum(b) b from (
            select x->>'cuenta_id' k, (x->>'base')::numeric b from jsonb_array_elements(v_nueva->'cuentas') x
            union all
            select x->>'cuenta_id', -(x->>'base')::numeric from jsonb_array_elements(v_vieja->'cuentas') x) u group by k) d
   where b <> 0;
  v_r := jsonb_build_object(
    'base', (v_nueva->>'base')::numeric - (v_vieja->>'base')::numeric,
    'iva', (v_nueva->>'iva')::numeric - (v_vieja->>'iva')::numeric,
    'recargo', (v_nueva->>'recargo')::numeric - (v_vieja->>'recargo')::numeric,
    'retencion', (v_nueva->>'retencion')::numeric - (v_vieja->>'retencion')::numeric,
    'retencion_pct', v_vieja->'retencion_pct',
    'tipos', v_tipos, 'cuentas', v_cuentas);
  return v_r || jsonb_build_object('total', (v_r->>'base')::numeric + (v_r->>'iva')::numeric + (v_r->>'recargo')::numeric - (v_r->>'retencion')::numeric);
end $$;
revoke all on function public._conta_venta_diferencia(uuid) from public, anon, authenticated;

create or replace function public._conta_venta_evento(p_id uuid, p_tipo text, p_texto text, p_detalle jsonb, p_quien text)
returns void language sql security definer set search_path = public as $$
  insert into public.customer_invoice_event (account_id, company_id, invoice_id, kind, text, detail, by_name)
  select account_id, company_id, id, p_tipo, p_texto, p_detalle, coalesce(p_quien, public.conta_nombre_actor()) from public.customer_invoice where id = p_id
$$;
revoke all on function public._conta_venta_evento(uuid, text, text, jsonb, text) from public, anon, authenticated;

-- 5 · Guardar un borrador (nuevo o el mismo) -------------------------------------------
-- p_datos: cliente_id, fecha, vence, serie, forma_cobro_id, local_id, notas,
-- correo, retencion_id, recargo. p_lineas: [{concepto, cantidad, precio,
-- descuento, tipo_id, cuenta_id}]. Todo se reescribe: es un borrador.
create or replace function public.conta_venta_guardar(p_company uuid, p_id uuid, p_datos jsonb, p_lineas jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_f public.customer_invoice; v_id uuid := p_id; v_l jsonb; v_pos int := 0; v_t public.tax_rate; v_cta uuid;
  v_cli jsonb := '{}'::jsonb; v_party uuid := nullif(p_datos->>'cliente_id', '')::uuid; v_cifras jsonb; v_nuevo boolean := p_id is null;
  v_cant numeric; v_precio numeric; v_dto numeric;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta hace facturas.' using errcode = '42501';
  end if;
  if v_party is not null then
    select jsonb_strip_nulls(jsonb_build_object('nombre', coalesce(f.legal_name, p.name), 'nif', p.tax_id, 'tipo_nif', f.tax_id_type, 'pais', coalesce(f.country_code, 'ES'),
             'calle', f.fiscal_street, 'cp', f.fiscal_postal_code, 'ciudad', f.fiscal_city, 'provincia', f.fiscal_province,
             'nif_comprobado', f.tax_id_check_status = 'valid'))
      into v_cli from public.party p left join public.customer_fiscal f on f.party_id = p.id
     where p.id = v_party and p.account_id = v_cuenta;
    if v_cli is null then raise exception 'Ese cliente no es de esta cuenta.' using errcode = '22023'; end if;
  end if;

  if v_id is null then
    insert into public.customer_invoice (account_id, company_id, created_by, created_by_name)
    values (v_cuenta, p_company, auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
    returning id into v_id;
  end if;
  select * into v_f from public.customer_invoice where id = v_id for update;
  if v_f.company_id is distinct from p_company then raise exception 'Esa factura no es de esta empresa.' using errcode = '22023'; end if;
  if v_f.status <> 'borrador' then raise exception 'La factura % ya está emitida: no se cambia. Se corrige con «Corregir».', v_f.number_text using errcode = '23514'; end if;

  -- El recargo de equivalencia aún no: hoy ninguna 477 se valida sin su tipo
  -- y su cuota, y el 303 no sabe dónde va el recargo («recargo» en
  -- conta_impuesto_303_cajas). La columna queda preparada; se abre con su
  -- propio encargo.
  if coalesce((p_datos->>'recargo')::boolean, false) then
    raise exception 'El recargo de equivalencia todavía no se puede facturar desde Sumied: el libro y el 303 aún no saben llevarlo.' using errcode = '0A000';
  end if;

  update public.customer_invoice set
    party_id = v_party, customer = coalesce(v_cli, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('correo', nullif(btrim(p_datos->>'correo'), ''))),
    issue_date = coalesce(nullif(p_datos->>'fecha', '')::date, issue_date),
    due_date = nullif(p_datos->>'vence', '')::date,
    series_code = case when v_f.doc_type = 'rectificativa' then 'R' else coalesce(nullif(upper(btrim(p_datos->>'serie')), ''), 'F') end,
    payment_method_id = nullif(p_datos->>'forma_cobro_id', '')::uuid,
    location_id = nullif(p_datos->>'local_id', '')::uuid,
    notes = nullif(btrim(p_datos->>'notas'), ''),
    email_to = nullif(btrim(p_datos->>'correo'), ''),
    withholding_rate_id = nullif(p_datos->>'retencion_id', '')::uuid,
    surcharge = coalesce((p_datos->>'recargo')::boolean, false),
    correction_reason = case when v_f.doc_type = 'rectificativa' then coalesce(nullif(btrim(p_datos->>'motivo'), ''), correction_reason) else null end
  where id = v_id;

  -- Las líneas, de nuevo enteras (una rectificativa para anular no tiene líneas que cambiar).
  if v_f.correction_kind is distinct from 'anular' then
    delete from public.customer_invoice_line where invoice_id = v_id;
    for v_l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
      v_pos := v_pos + 1;
      select * into v_t from public.tax_rate where id = (v_l->>'tipo_id')::uuid;
      if v_t.id is null or (v_t.company_id is not null and v_t.company_id <> p_company) then
        raise exception 'La línea %: ese tipo de IVA no existe.', v_pos using errcode = '22023';
      end if;
      if v_t.treatment <> 'taxed' then
        raise exception 'La línea %: «%» aún no se puede facturar aquí (solo IVA general, reducido o superreducido).', v_pos, v_t.name using errcode = '22023';
      end if;
      select id into v_cta from public.company_account where id = (v_l->>'cuenta_id')::uuid and company_id = p_company and code like '7%';
      if v_cta is null then raise exception 'La línea %: la cuenta de ventas no es de esta empresa.', v_pos using errcode = '22023'; end if;
      v_cant := coalesce((v_l->>'cantidad')::numeric, 1);
      v_precio := coalesce((v_l->>'precio')::numeric, 0);
      v_dto := coalesce((v_l->>'descuento')::numeric, 0);
      insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, discount_pct,
                                             tax_rate_id, tax_pct, surcharge_pct, revenue_account_id, amount)
      values (v_cuenta, p_company, v_id, v_pos, btrim(v_l->>'concepto'), v_cant, v_precio, v_dto,
              v_t.id, v_t.rate, v_t.surcharge_rate, v_cta, round(v_cant * v_precio * (1 - v_dto / 100), 2));
    end loop;
  end if;

  v_cifras := case when v_f.doc_type = 'rectificativa' then public._conta_venta_diferencia(v_id) else public._conta_venta_cifras(v_id) end;
  update public.customer_invoice set base = (v_cifras->>'base')::numeric, tax = (v_cifras->>'iva')::numeric, surcharge_amount = (v_cifras->>'recargo')::numeric,
         withholding_amount = (v_cifras->>'retencion')::numeric, total = (v_cifras->>'total')::numeric
   where id = v_id;
  if v_nuevo then
    perform public._conta_venta_evento(v_id, 'creada', 'Borrador creado a mano.', null, p_quien_nombre);
  end if;
  return jsonb_build_object('id', v_id, 'nuevo', v_nuevo, 'total', (v_cifras->>'total')::numeric, 'lineas', v_pos);
end $$;
revoke all on function public.conta_venta_guardar(uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.conta_venta_guardar(uuid, uuid, jsonb, jsonb, text) to authenticated;

-- 6 · Borrar un borrador -----------------------------------------------------------------
create or replace function public.conta_venta_borrar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.customer_invoice;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta borra borradores.' using errcode = '42501';
  end if;
  if v_f.status <> 'borrador' then
    raise exception 'La factura % ya está emitida: no se borra nunca. Se corrige con «Corregir».', v_f.number_text using errcode = '23514';
  end if;
  delete from public.customer_invoice where id = p_id;
  return jsonb_build_object('id', p_id, 'borrado', true, 'total', v_f.total);
end $$;
revoke all on function public.conta_venta_borrar(uuid) from public, anon;
grant execute on function public.conta_venta_borrar(uuid) to authenticated;

-- 7 · Emitir: número, asiento validado y libro, en una sola transacción ------------------
create or replace function public.conta_venta_emitir(p_id uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_orig public.customer_invoice; v_c jsonb; v_anio int; v_num int; v_texto text; v_serie text; v_digitos int := 4;
  v_empieza int; v_por_anio boolean; v_cta430 text; v_r jsonb; v_lineas jsonb := '[]'::jsonb; v_x jsonb; v_cta text; v_cta477 text; v_cta473 text; v_entry uuid; v_val jsonb;
  v_nombre text; v_signo numeric; v_prev text; v_hash text; v_emisor text; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_tipo_libro text; v_nif text; v_esta jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta emite facturas.' using errcode = '42501';
  end if;
  if v_f.status <> 'borrador' then raise exception 'La factura % ya está emitida.', v_f.number_text using errcode = '23514'; end if;
  if v_f.party_id is null then raise exception 'Falta el cliente: elige uno de Contactos o dalo de alta.' using errcode = '23514'; end if;
  v_nombre := v_f.customer->>'nombre';
  v_nif := v_f.customer->>'nif';
  if coalesce(btrim(v_nif), '') = '' then
    raise exception 'Falta el NIF de %: una factura lo lleva. Ponlo en su ficha de Contactos.', coalesce(v_nombre, 'el cliente') using errcode = '23514';
  end if;

  if v_f.doc_type = 'rectificativa' then
    select * into v_orig from public.customer_invoice where id = v_f.corrects_id;
    if v_orig.status <> 'emitida' then raise exception 'La factura que se corrige (%) no está emitida o ya está anulada.', v_orig.number_text using errcode = '23514'; end if;
    if coalesce(btrim(v_f.correction_reason), '') = '' then raise exception 'Falta el motivo de la corrección: va en la factura.' using errcode = '23514'; end if;
    v_c := public._conta_venta_diferencia(p_id);
    if v_f.correction_kind = 'importes' and (v_c->>'total')::numeric = 0 and (v_c->>'base')::numeric = 0 then
      raise exception 'Las líneas son iguales que las de %: no hay nada que corregir.', v_orig.number_text using errcode = '23514';
    end if;
  else
    if not exists (select 1 from public.customer_invoice_line where invoice_id = p_id) then raise exception 'La factura no tiene líneas.' using errcode = '23514'; end if;
    v_c := public._conta_venta_cifras(p_id);
    if (v_c->>'total')::numeric <= 0 then raise exception 'El total de la factura es %: una factura va en positivo (para restar, «Corregir» la que toca).', v_c->>'total' using errcode = '23514'; end if;
  end if;

  -- El número: su serie (la de la empresa en Numeración, si la tiene: sus
  -- cifras, por dónde empieza y si vuelve a 1 cada año; si no, 4 cifras, desde
  -- el 1 y por año) y el año de la fecha.
  v_serie := v_f.series_code;
  select digits, starts_at, reset_yearly into v_digitos, v_empieza, v_por_anio
    from public.invoice_series where company_id = v_f.company_id and code = v_serie and is_active;
  v_digitos := coalesce(v_digitos, 4); v_empieza := coalesce(v_empieza, 1); v_por_anio := coalesce(v_por_anio, true);
  v_anio := extract(year from v_f.issue_date)::int;
  insert into public.customer_invoice_counter (company_id, account_id, series_code, fiscal_year, last_number)
  values (v_f.company_id, v_f.account_id, v_serie, case when v_por_anio then v_anio else 0 end, v_empieza)
  on conflict (company_id, series_code, fiscal_year) do update set last_number = public.customer_invoice_counter.last_number + 1
  returning last_number into v_num;
  v_texto := v_serie || '-' || case when v_por_anio then v_anio || '/' else '' end || lpad(v_num::text, v_digitos, '0');

  -- La 430 del cliente: la suya, o una nueva de la 4300 con su nombre.
  select a.code into v_cta430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_f.company_id and k.entity = 'customer' and k.entity_id = v_f.party_id::text and k.role = 'principal' limit 1;
  if v_cta430 is null then
    v_r := public.company_account_add(v_f.company_id, '4300', 'Clientes · ' || coalesce(v_nombre, 'cliente'), null, 'customer', v_f.party_id::text, v_quien, 'manual');
    v_cta430 := v_r->>'code';
  end if;

  -- El asiento: 430 por el total; 70x por cuenta; 477 por tipo (con su libro);
  -- el recargo a la misma 477, sin libro; la retención a la 473. Una
  -- rectificativa en negativo pone cada importe en el otro lado.
  v_signo := case when (v_c->>'total')::numeric < 0 then -1 else 1 end;
  if (v_c->>'total')::numeric <> 0 then
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta430, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Factura ' || v_texto,
      'debe', case when v_signo > 0 then (v_c->>'total')::numeric else 0 end, 'haber', case when v_signo < 0 then -(v_c->>'total')::numeric else 0 end));
  end if;
  for v_x in select * from jsonb_array_elements(v_c->'cuentas') loop
    select code into v_cta from public.company_account where id = (v_x->>'cuenta_id')::uuid;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Factura ' || v_texto,
      'haber', greatest((v_x->>'base')::numeric, 0), 'debe', greatest(-(v_x->>'base')::numeric, 0)));
  end loop;
  for v_x in select * from jsonb_array_elements(v_c->'tipos') loop
    select a.code into v_cta477 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
     where k.company_id = v_f.company_id and k.entity = 'tax_rate' and k.entity_id = v_x->>'tipo_id' and k.role = 'repercutido' limit 1;
    if v_cta477 is null then
      select code into v_cta477 from public.company_account where company_id = v_f.company_id and code like '477%' and code <> '47700000'
         and (name ilike '%' || to_char((v_x->>'pct')::numeric, 'FM990') || ' %%' or name ilike '%' || to_char((v_x->>'pct')::numeric, 'FM990') || '%') order by code limit 1;
    end if;
    if v_cta477 is null then raise exception 'Falta en tu plan la 477 del IVA repercutido al % %%.', to_char((v_x->>'pct')::numeric, 'FM990D##') using errcode = '23514'; end if;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta477, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'IVA factura ' || v_texto,
      'haber', greatest((v_x->>'iva')::numeric, 0), 'debe', greatest(-(v_x->>'iva')::numeric, 0),
      'iva', jsonb_build_object('tipo_id', v_x->>'tipo_id', 'base', abs((v_x->>'base')::numeric), 'libro', 'issued', 'facturas', 1)));
    if (v_x->>'rec')::numeric <> 0 then
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta477, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Recargo de equivalencia factura ' || v_texto,
        'haber', greatest((v_x->>'rec')::numeric, 0), 'debe', greatest(-(v_x->>'rec')::numeric, 0)));
    end if;
  end loop;
  if (v_c->>'retencion')::numeric <> 0 then
    -- La retención que te hace el cliente es un pago a cuenta TUYO: 473. El
    -- enlace «retención → cuenta» de la empresa es el de las compras (4751, la
    -- que tú ingresas por otros), y aquí no vale.
    select code into v_cta473 from public.company_account where company_id = v_f.company_id and coalesce(template_code, code) like '473%' order by code limit 1;
    if v_cta473 is null then
      v_r := public.company_account_add(v_f.company_id, '4730', 'Retenciones que te hacen tus clientes', null, null, null, v_quien, 'manual');
      v_cta473 := v_r->>'code';
    end if;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta473, 'tercero_id', v_f.party_id, 'documento', v_texto, 'concepto', 'Retención factura ' || v_texto,
      'debe', greatest((v_c->>'retencion')::numeric, 0), 'haber', greatest(-(v_c->>'retencion')::numeric, 0)));
  end if;

  -- Cada apunte, con el local de la factura o «común» (la analítica por local lo pide al validar).
  select coalesce(jsonb_agg(x || case when v_f.location_id is not null then jsonb_build_object('local_id', v_f.location_id) else jsonb_build_object('comun', true) end order by i), '[]'::jsonb)
    into v_lineas from jsonb_array_elements(v_lineas) with ordinality as t(x, i);
  if jsonb_array_length(v_lineas) > 0 then
    v_r := public._journal_entry_proponer(v_f.company_id,
      jsonb_build_object('series', 1, 'fecha', v_f.issue_date, 'source_type', 'customer_invoice', 'source_id', p_id,
        'concepto', 'Factura ' || v_texto || ' · ' || coalesce(v_nombre, ''), 'party_id', v_f.party_id, 'documento', v_texto, 'fecha_documento', v_f.issue_date,
        'confianza', 'seguro', 'porque', 'Factura de venta emitida en Sumied.'),
      v_lineas, null, v_quien, auth.uid());
    v_entry := (v_r->>'id')::uuid;
    v_val := public.journal_entry_validar(v_entry, v_quien);
    -- Lo que el libro no sabe de una factura de venta: el tipo, la que corrige,
    -- el recargo y la retención (la primera anotación lleva la retención entera).
    v_tipo_libro := case when v_f.doc_type = 'rectificativa' then 'R4' else 'F1' end;
    update public.vat_book_entry v set invoice_type = v_tipo_libro,
           corrects_ref = case when v_f.doc_type = 'rectificativa' then v_orig.number_text end,
           counterpart_name = coalesce(v_nombre, v.counterpart_name),
           surcharge_amount = (select nullif((t->>'rec')::numeric, 0) from jsonb_array_elements(v_c->'tipos') t
                                where t->>'tipo_id' = (select jl.tax_rate_id::text from public.journal_line jl where jl.id = v.line_id)),
           updated_at = now()
     where v.entry_id = v_entry;
    if (v_c->>'retencion')::numeric <> 0 then
      update public.vat_book_entry set withholding_rate = (v_c->>'retencion_pct')::numeric, withholding_amount = (v_c->>'retencion')::numeric
       where id = (select id from public.vat_book_entry where entry_id = v_entry order by created_at, id limit 1);
    end if;
  end if;

  -- La huella encadenada con la emitida anterior de la empresa (para Verifactu).
  select hash into v_prev from public.customer_invoice where company_id = v_f.company_id and status <> 'borrador' and hash is not null order by issued_at desc, id desc limit 1;
  select tax_id into v_emisor from public.company where id = v_f.company_id;
  v_hash := encode(sha256(convert_to(concat_ws('|', v_emisor, v_texto, v_f.issue_date::text, (v_c->>'total')::numeric::text, coalesce(v_prev, '')), 'UTF8')), 'hex');

  update public.customer_invoice set status = 'emitida', fiscal_year = v_anio, number = v_num, number_text = v_texto,
         base = (v_c->>'base')::numeric, tax = (v_c->>'iva')::numeric, surcharge_amount = (v_c->>'recargo')::numeric,
         withholding_amount = (v_c->>'retencion')::numeric, total = (v_c->>'total')::numeric,
         due_date = coalesce(v_f.due_date, v_f.issue_date), entry_id = v_entry, prev_hash = v_prev, hash = v_hash,
         issued_at = now(), issued_by_name = v_quien
   where id = p_id;

  perform public._conta_venta_evento(p_id, 'emitida',
    'Emitida con el nº ' || v_texto || coalesce(' y su asiento nº ' || (v_val->>'numero'), ' (sin asiento: no cambia importes)') || '.',
    jsonb_build_object('asiento', v_entry, 'numero_asiento', v_val->'numero'), v_quien);
  if v_f.doc_type = 'rectificativa' then
    perform public._conta_venta_evento(v_f.corrects_id, 'corregida',
      'Corregida con la ' || v_texto || ' (' || case v_f.correction_kind when 'anular' then 'anulada entera' when 'datos' then 'datos del cliente' else 'importes o líneas' end || '): ' || v_f.correction_reason || '.',
      jsonb_build_object('rectificativa', p_id), v_quien);
    if v_f.correction_kind = 'anular' then
      update public.customer_invoice set status = 'anulada' where id = v_f.corrects_id;
    end if;
  end if;

  select jsonb_build_object('id', p_id, 'numero', v_texto, 'total', (v_c->>'total')::numeric, 'asiento', v_entry, 'numero_asiento', v_val->'numero') into v_esta;
  return v_esta;
end $$;
revoke all on function public.conta_venta_emitir(uuid, text) from public, anon;
grant execute on function public.conta_venta_emitir(uuid, text) to authenticated;

-- 8 · Corregir: una rectificativa en borrador, con los datos de la original ---------------
create or replace function public.conta_venta_corregir(p_id uuid, p_tipo text, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.customer_invoice; v_id uuid; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_c jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta corrige facturas.' using errcode = '42501';
  end if;
  if v_f.status <> 'emitida' then raise exception 'Solo se corrige una factura emitida y viva (esta está %).', v_f.status using errcode = '23514'; end if;
  if v_f.doc_type = 'rectificativa' then raise exception 'Una rectificativa no se corrige con otra: corrige la factura de origen.' using errcode = '23514'; end if;
  if p_tipo not in ('importes', 'anular', 'datos') then raise exception 'Qué se corrige: importes, anular o datos.' using errcode = '22023'; end if;
  if exists (select 1 from public.customer_invoice where corrects_id = p_id and status = 'borrador') then
    select id into v_id from public.customer_invoice where corrects_id = p_id and status = 'borrador' limit 1;
    return jsonb_build_object('id', v_id, 'ya_estaba', true);
  end if;
  insert into public.customer_invoice (account_id, company_id, doc_type, origin, series_code, issue_date, due_date, party_id, customer, location_id,
                                    payment_method_id, notes, email_to, withholding_rate_id, surcharge, corrects_id, correction_kind, correction_reason,
                                    created_by, created_by_name)
  values (v_f.account_id, v_f.company_id, 'rectificativa', v_f.origin, 'R', (now() at time zone 'Europe/Madrid')::date, null, v_f.party_id, v_f.customer, v_f.location_id,
          v_f.payment_method_id, null, v_f.email_to, v_f.withholding_rate_id, v_f.surcharge, p_id, p_tipo, nullif(btrim(p_motivo), ''), auth.uid(), v_quien)
  returning id into v_id;
  -- Las líneas de la original: lo que se cambia en «importes»; en «anular» y
  -- «datos», solo se enseñan (la diferencia no las usa).
  insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, discount_pct, tax_rate_id, tax_pct, surcharge_pct, revenue_account_id, amount)
  select account_id, company_id, v_id, position, concept, quantity, unit_price, discount_pct, tax_rate_id, tax_pct, surcharge_pct, revenue_account_id, amount
    from public.customer_invoice_line where invoice_id = p_id;
  v_c := public._conta_venta_diferencia(v_id);
  update public.customer_invoice set base = (v_c->>'base')::numeric, tax = (v_c->>'iva')::numeric, surcharge_amount = (v_c->>'recargo')::numeric,
         withholding_amount = (v_c->>'retencion')::numeric, total = (v_c->>'total')::numeric where id = v_id;
  perform public._conta_venta_evento(v_id, 'creada', 'Rectificativa de la ' || v_f.number_text || ' preparada (' ||
    case p_tipo when 'anular' then 'anularla entera' when 'datos' then 'datos del cliente' else 'importes o líneas' end || ').', jsonb_build_object('corrige', p_id), v_quien);
  return jsonb_build_object('id', v_id, 'ya_estaba', false, 'total', (v_c->>'total')::numeric);
end $$;
revoke all on function public.conta_venta_corregir(uuid, text, text, text) from public, anon;
grant execute on function public.conta_venta_corregir(uuid, text, text, text) to authenticated;

-- 9 · Cobros -------------------------------------------------------------------------------
create or replace function public.conta_venta_cobrar(p_id uuid, p_fecha date, p_importe numeric, p_forma text, p_nota text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.customer_invoice; v_cobrado numeric; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_queda numeric;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta apunta cobros.' using errcode = '42501';
  end if;
  if v_f.status <> 'emitida' or v_f.total <= 0 then raise exception 'Solo se cobra una factura emitida con importe a cobrar.' using errcode = '23514'; end if;
  if p_importe is null or p_importe <= 0 then raise exception 'El cobro tiene que ser mayor que cero.' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_cobrado from public.customer_invoice_payment where invoice_id = p_id;
  v_queda := v_f.total - v_cobrado;
  if p_importe > v_queda then
    raise exception 'Quedan % € por cobrar de la %: no se puede apuntar %.', to_char(v_queda, 'FM999G999G990D00'), v_f.number_text, to_char(p_importe, 'FM999G999G990D00') using errcode = '22023';
  end if;
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by, created_by_name)
  values (v_f.account_id, v_f.company_id, p_id, coalesce(p_fecha, (now() at time zone 'Europe/Madrid')::date), p_importe, nullif(btrim(p_forma), ''), nullif(btrim(p_nota), ''), auth.uid(), v_quien);
  v_queda := v_queda - p_importe;
  perform public._conta_venta_evento(p_id, 'cobro',
    'Cobro de ' || to_char(p_importe, 'FM999G999G990D00') || ' €' || case when v_queda = 0 then ': cobrada entera.' else '; quedan ' || to_char(v_queda, 'FM999G999G990D00') || ' €.' end,
    jsonb_build_object('importe', p_importe, 'fecha', p_fecha), v_quien);
  return jsonb_build_object('id', p_id, 'cobrado', v_cobrado + p_importe, 'queda', v_queda);
end $$;
revoke all on function public.conta_venta_cobrar(uuid, date, numeric, text, text, text) from public, anon;
grant execute on function public.conta_venta_cobrar(uuid, date, numeric, text, text, text) to authenticated;

-- 10 · Lo del servidor: el PDF y el correo (conta-venta-documento) ----------------------------
create or replace function public.conta_venta_pdf_guardar(p_id uuid, p_ruta text, p_sha256 text, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare v_f public.customer_invoice; v_obj record;
begin
  select * into v_f from public.customer_invoice where id = p_id for update;
  -- Lo llama el navegador de quien emite (el PDF se hace allí, como el resumen
  -- de ventas): sus permisos, y la ruta tiene que ser la de ESTA factura.
  if v_f.id is null or not (public.belongs_to_account(v_f.account_id) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa factura no está.' using errcode = 'P0002';
  end if;
  if not (public.current_user_is_admin_or_manager_of(v_f.account_id) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Solo un administrador o un encargado de la cuenta guarda el PDF de una factura.' using errcode = '42501';
  end if;
  if v_f.status = 'borrador' then raise exception 'Un borrador no lleva PDF: se hace al emitir.' using errcode = '23514'; end if;
  if v_f.pdf_sha256 is not null then
    if v_f.pdf_sha256 = p_sha256 then return jsonb_build_object('id', p_id, 'ruta', v_f.pdf_path, 'ya_estaba', true); end if;
    raise exception 'La % ya tiene su PDF: no se cambia.', v_f.number_text using errcode = '23505';
  end if;
  if p_ruta is null or left(p_ruta, length(v_f.account_id::text || '/ventas/' || p_id::text || '/')) <> v_f.account_id::text || '/ventas/' || p_id::text || '/' then
    raise exception 'La ruta del PDF no es la de esta factura.' using errcode = '22023';
  end if;
  select o.name into v_obj from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then raise exception 'El PDF no está subido (%).', p_ruta using errcode = 'P0002'; end if;
  update public.customer_invoice set pdf_path = p_ruta, pdf_sha256 = p_sha256, pdf_bytes = p_bytes where id = p_id;
  return jsonb_build_object('id', p_id, 'ruta', p_ruta, 'ya_estaba', false);
end $$;
revoke all on function public.conta_venta_pdf_guardar(uuid, text, text, integer) from public, anon;
grant execute on function public.conta_venta_pdf_guardar(uuid, text, text, integer) to authenticated, service_role;

create or replace function public.conta_venta_enviada(p_id uuid, p_para text, p_texto text, p_detalle jsonb, p_quien_nombre text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_para is not null then update public.customer_invoice set sent_at = now() where id = p_id and status <> 'borrador'; end if;
  perform public._conta_venta_evento(p_id, case when p_para is null then 'correo_no' else 'enviada' end, p_texto, p_detalle, p_quien_nombre);
end $$;
revoke all on function public.conta_venta_enviada(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.conta_venta_enviada(uuid, text, text, jsonb, text) to service_role;
