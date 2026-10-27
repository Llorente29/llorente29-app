-- supabase/migrations/20261026T2309_v04_tique_serie_y_quien_factura.sql
--
-- cambia: public.fiscal_for_print · prueba: supabase/staging/sql/20261026_v04_tique_serie_prueba.sql
--
-- V04 · PR 1 · EL TIQUE DE LA BOLSA: EL NÚMERO Y QUIÉN FACTURA (sin QR).
-- Decisión de Julio (26/10): el tique de la bolsa es la factura simplificada.
-- El tique no cambia ni cómo se genera, ni cómo se imprime, ni cuándo: solo
-- lleva lo mínimo que pide la ley (RD 1619/2012, art. 6.1.a y 7.1).
--
--   1. LA SERIE de las marcas propias: una por local y por año,
--      <código del local><AA>-<6 cifras> (CA26-000123), y las rectificativas
--      aparte (CA26-R-000004). Correlativa y sin huecos: el contador y la
--      factura se escriben en la MISMA transacción, y dos impresiones del mismo
--      pedido no gastan dos números (un cerrojo por pedido). El número se da al
--      imprimir el tique, no al entrar el pedido. Delivery, recogida, Shop y
--      sala comparten la serie de su local.
--      Un local sin código elegido en Ajustes no numera: su tique sigue como
--      hoy. Así nada cambia hasta que Julio elige los códigos.
--   2. QUIÉN FACTURA, en el tique:
--      · propia (brand.ownership_type = 'own', o sin marca): la empresa del
--        local (location_company) o, si no hay, la de la cuenta; nombre y NIF;
--      · cedida ('licensed'): lo que dice la factura que manda Last en el
--        pedido (raw_tab.bills[0].company y .number). Si no la trae, el tique
--        sale sin la línea de «Factura Simplificada» y se avisa: nunca se
--        inventa un número.
--   3. AJUSTES › FACTURAS DE LOS PEDIDOS: el código de cada local
--      (ticket_invoice_code_set, Folvy propone las dos primeras letras), su
--      serie y su último número, el estado de Verifactu de la empresa y qué
--      marcas van por nuestra serie (ticket_invoice_ajustes).
--
-- EL CAMINO DEL PEDIDO: fiscal_for_print la llama la tablet al imprimir la
-- bolsa. Nunca falla por esto: si la serie no puede dar número (por ejemplo,
-- la serie llena), el tique sale como hoy y se encola un aviso. Y la vista
-- previa de Pedidos («Ver tiques») tiene su propia función, que solo lee: mirar
-- un tique no gasta número.
--
-- Todo filtra por account_id (regla 9). Sin tocar datos de nadie: las tablas
-- nacen vacías. Vuelta atrás:
-- supabase/vuelta-atras/20261026T2309_v04_tique_serie_y_quien_factura.down.sql

-- ── serie: inicio ───────────────────────────────────────────────────────────
-- (Autocontenida: solo usa accounts y locations. La unitaria
-- tests/unit/modules/orders/v04/serieTique.test.ts carga este bloque tal cual
-- en un Postgres de usar y tirar y lo prueba con dos impresiones a la vez.)

-- El código corto de cada local: se elige una vez.
create table if not exists public.location_invoice_code (
  location_id  uuid primary key references public.locations(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  code         text not null check (code ~ '^[A-Z]{2,3}$'),
  set_at       timestamptz not null default now(),
  set_by       uuid,
  set_by_name  text,
  constraint location_invoice_code_unico unique (account_id, code)
);
comment on table public.location_invoice_code is
  'V04. El código corto de cada local para la serie de sus facturas simplificadas (CA, AL…): se elige una vez en Ajustes › Facturas de los pedidos. Sin código, el local no numera y su tique sigue como antes.';

-- Una serie por local, año y tipo (F: simplificadas; R: rectificativas).
create table if not exists public.ticket_invoice_series (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  location_id  uuid not null references public.locations(id) on delete cascade,
  code         text not null check (code ~ '^[A-Z]{2,3}$'),
  year         integer not null check (year between 2024 and 2100),
  kind         text not null check (kind in ('F', 'R')),
  last_number  integer not null default 0 check (last_number between 0 and 999999),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ticket_invoice_series_unica unique (account_id, location_id, year, kind)
);
comment on table public.ticket_invoice_series is
  'V04. La serie de las facturas simplificadas de un local en un año (F) y la de sus rectificativas (R), con su contador. La base es la verdad: el número lo da _ticket_invoice_number, en la misma transacción que escribe la factura.';

-- Cada número dado: la factura simplificada de un pedido.
create table if not exists public.ticket_invoice (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  sale_id       uuid not null,
  location_id   uuid not null references public.locations(id) on delete cascade,
  series_id     uuid not null references public.ticket_invoice_series(id),
  kind          text not null check (kind in ('F', 'R')),
  number        integer not null check (number > 0),
  number_text   text not null,
  issued_at     timestamptz not null default now(),
  issuer_name   text,
  issuer_tax_id text,
  constraint ticket_invoice_numero_unico unique (series_id, number)
);
-- Un pedido, una factura simplificada (las rectificativas, aparte).
create unique index if not exists ticket_invoice_un_pedido on public.ticket_invoice (account_id, sale_id) where kind = 'F';
comment on table public.ticket_invoice is
  'V04. La factura simplificada de cada pedido de una marca propia: su número de la serie de su local. Una por pedido (reimprimir no gasta número). Un pedido cancelado después no se borra: se anula (V04, PR 2, con el motor de Verifactu).';

alter table public.location_invoice_code enable row level security;
alter table public.ticket_invoice_series enable row level security;
alter table public.ticket_invoice enable row level security;
revoke all on public.location_invoice_code, public.ticket_invoice_series, public.ticket_invoice from anon, authenticated;

-- El texto del número: CA26-000123, y CA26-R-000004 en las rectificativas.
create or replace function public._ticket_invoice_text(p_code text, p_year integer, p_kind text, p_number integer)
returns text language sql immutable set search_path = public as $$
  select p_code || lpad((p_year % 100)::text, 2, '0') || '-' || case when p_kind = 'R' then 'R-' else '' end || lpad(p_number::text, 6, '0')
$$;

-- El siguiente número de la serie del local para ESTE pedido. Si el pedido ya
-- tiene el suyo, ese (reimprimir no gasta número). El cerrojo por pedido hace
-- que dos impresiones a la vez del mismo pedido esperen la una a la otra; el
-- contador lo bloquea la fila de su serie (dos pedidos a la vez van uno detrás
-- de otro). Contador y factura, en la misma transacción: sin huecos.
create or replace function public._ticket_invoice_number(p_account uuid, p_location uuid, p_sale uuid, p_code text,
                                                         p_issuer_name text, p_issuer_tax_id text, p_at timestamptz default now())
returns public.ticket_invoice language plpgsql security definer set search_path = public as $$
declare v_t public.ticket_invoice; v_s public.ticket_invoice_series; v_year integer;
begin
  if p_account is null or p_location is null or p_sale is null or p_code is null then
    raise exception 'Faltan datos para numerar el tique.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ticket_invoice:' || p_account::text || ':' || p_sale::text, 0));
  select * into v_t from public.ticket_invoice where account_id = p_account and sale_id = p_sale and kind = 'F';
  if v_t.id is not null then return v_t; end if;
  v_year := extract(year from (p_at at time zone 'Europe/Madrid'))::integer;
  insert into public.ticket_invoice_series as s (account_id, location_id, code, year, kind, last_number)
  values (p_account, p_location, p_code, v_year, 'F', 1)
  on conflict (account_id, location_id, year, kind) do update set last_number = s.last_number + 1, updated_at = now()
  returning * into v_s;
  insert into public.ticket_invoice (account_id, sale_id, location_id, series_id, kind, number, number_text, issued_at, issuer_name, issuer_tax_id)
  values (p_account, p_sale, p_location, v_s.id, 'F', v_s.last_number,
          public._ticket_invoice_text(v_s.code, v_s.year, 'F', v_s.last_number), p_at, p_issuer_name, p_issuer_tax_id)
  returning * into v_t;
  return v_t;
end $$;
revoke all on function public._ticket_invoice_number(uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;

-- Lo que Folvy propone como código: las dos primeras letras del nombre del
-- local, sin las palabras del nombre de la cuenta («Foodint Carabanchel» → CA).
create or replace function public._ticket_codigo_propuesto(p_local text, p_cuenta text)
returns text language plpgsql immutable set search_path = public as $$
declare v text; w text; v_todo text;
begin
  v_todo := regexp_replace(upper(translate(coalesce(p_local, ''), 'áéíóúüñàèìòùÁÉÍÓÚÜÑÀÈÌÒÙ', 'aeiouunaeiouAEIOUUNAEIOU')), '[^A-Z ]', '', 'g');
  v := ' ' || v_todo || ' ';
  for w in select x from regexp_split_to_table(regexp_replace(upper(translate(coalesce(p_cuenta, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^A-Z ]', '', 'g'), '\s+') x where length(x) > 0 loop
    v := replace(v, ' ' || w || ' ', ' ');
  end loop;
  v := regexp_replace(v, '[^A-Z]', '', 'g');
  if length(v) < 2 then v := regexp_replace(v_todo, '[^A-Z]', '', 'g'); end if;
  return nullif(left(v, 2), '');
end $$;
-- ── serie: fin ──────────────────────────────────────────────────────────────

-- ── Quién factura un pedido ─────────────────────────────────────────────────
-- {tipo: propia|cedida, legalName, taxId, address, number, sinFactura}.
-- Propia: la empresa del local (o la de la cuenta). Cedida: la factura de Last.
create or replace function public._ticket_quien_factura(p_account uuid, p_sale uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_s record; v_raw jsonb; v_c public.company; v_a public.accounts; v_bill jsonb;
begin
  select s.id, s.location_id, s.raw_tab, s.brand_id, b.ownership_type
    into v_s
    from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
   where s.id = p_sale and s.account_id = p_account;
  if v_s.id is null then return null; end if;
  if v_s.ownership_type = 'licensed' then
    v_raw := public.safe_jsonb(v_s.raw_tab);
    v_bill := v_raw->'bills'->0;
    if nullif(btrim(v_bill->>'number'), '') is null or nullif(btrim(v_bill->'company'->>'taxId'), '') is null then
      return jsonb_build_object('tipo', 'cedida', 'sinFactura', true, 'legalName', null, 'taxId', null, 'address', null, 'number', null);
    end if;
    return jsonb_build_object('tipo', 'cedida', 'sinFactura', false,
      'legalName', nullif(btrim(v_bill->'company'->>'name'), ''), 'taxId', btrim(v_bill->'company'->>'taxId'),
      'address', nullif(btrim(v_bill->'company'->>'address'), ''), 'number', btrim(v_bill->>'number'));
  end if;
  select c.* into v_c from public.location_company lc join public.company c on c.id = lc.company_id and c.account_id = lc.account_id
   where lc.location_id = v_s.location_id and lc.account_id = p_account;
  if v_c.id is null then
    select * into v_a from public.accounts where id = p_account;
    return jsonb_build_object('tipo', 'propia', 'sinFactura', false, 'legalName', coalesce(v_a.legal_name, v_a.name),
      'taxId', v_a.cif, 'address', null, 'number', null, 'company_id', null);
  end if;
  return jsonb_build_object('tipo', 'propia', 'sinFactura', false, 'legalName', coalesce(v_c.legal_name, v_c.trade_name),
    'taxId', regexp_replace(upper(coalesce(v_c.tax_id, '')), '^ES', ''), 'address', null, 'number', null, 'company_id', v_c.id);
end $$;
revoke all on function public._ticket_quien_factura(uuid, uuid) from public, anon, authenticated;

-- ── El respaldo de una función antes de cambiarla (Respuesta 1, 27/10) ─────
-- La vuelta atrás de una función que cambia en caliente tiene que dejarla
-- EXACTAMENTE como estaba, también con sus saltos de línea: fiscal_for_print
-- tiene \r\n en producción y una copia escrita a mano con \n deja otra huella
-- (el ensayo #256 paró por eso). Así que la migración guarda su texto tal cual
-- (pg_get_functiondef) antes de cambiarla, y la vuelta atrás lo ejecuta y
-- comprueba que la huella es la misma. Vale para cualquier base y para
-- cualquier tanda: las dos funciones y la tabla se quedan aunque se deshaga esta.
-- ── respaldo: inicio ────────────────────────────────────────────────────────
-- (Autocontenido: lo carga tal cual tests/unit/modules/orders/v04/respaldoFuncion.test.ts.)
create table if not exists public.funcion_respaldo (
  firma        text not null,
  migracion    text not null,
  definicion   text not null,
  huella       text not null,
  guardado_at  timestamptz not null default now(),
  constraint funcion_respaldo_pk primary key (firma, migracion)
);
comment on table public.funcion_respaldo is
  'El texto exacto (pg_get_functiondef) de una función antes de que una migración la cambie en caliente, para que su vuelta atrás la deje como estaba, byte a byte (_restaurar_funcion). La fila se borra al restaurar.';
alter table public.funcion_respaldo enable row level security;
revoke all on public.funcion_respaldo from anon, authenticated;

create or replace function public._respaldar_funcion(p_firma text, p_migracion text)
returns text language plpgsql security definer set search_path = public as $$
declare v_def text; v_h text;
begin
  if to_regprocedure(p_firma) is null then raise exception 'No existe % para respaldarla.', p_firma using errcode = '42883'; end if;
  v_def := pg_get_functiondef(to_regprocedure(p_firma));
  -- Si ya hay respaldo de esta migración (se pasó dos veces), se queda el primero: el de antes del cambio.
  insert into public.funcion_respaldo (firma, migracion, definicion, huella) values (p_firma, p_migracion, v_def, md5(v_def))
  on conflict (firma, migracion) do nothing;
  select huella into v_h from public.funcion_respaldo where firma = p_firma and migracion = p_migracion;
  return v_h;
end $$;
revoke all on function public._respaldar_funcion(text, text) from public, anon, authenticated;

create or replace function public._restaurar_funcion(p_firma text, p_migracion text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.funcion_respaldo; v_ahora text;
begin
  select * into v from public.funcion_respaldo where firma = p_firma and migracion = p_migracion;
  if v.firma is null then
    raise exception 'No hay respaldo de % de la migración %: no se puede dejar como estaba.', p_firma, p_migracion using errcode = 'P0002';
  end if;
  execute v.definicion;
  v_ahora := md5(pg_get_functiondef(to_regprocedure(p_firma)));
  if v_ahora is distinct from v.huella then
    raise exception 'La vuelta atrás de % no la deja como estaba (huella % y debía ser %).', p_firma, v_ahora, v.huella using errcode = 'P0001';
  end if;
  delete from public.funcion_respaldo where firma = p_firma and migracion = p_migracion;
  return v_ahora;
end $$;
revoke all on function public._restaurar_funcion(text, text) from public, anon, authenticated;
-- ── respaldo: fin ───────────────────────────────────────────────────────────

select public._respaldar_funcion('public.fiscal_for_print(text,uuid)', '20261026T2309_v04_tique_serie_y_quien_factura');

-- ── Lo que pide la tablet al imprimir la bolsa (misma firma) ────────────────
-- Devuelve lo de antes (legalName, taxId, address, ticketNumber) y además:
-- issuerKind (propia|cedida), sinFactura (cedida sin factura de Last: el tique
-- va sin la línea) y serie (el número es de nuestra serie).
-- LA IMPRESIÓN NO FALLA NUNCA POR ESTO (Respuesta 1, 27/10): quién factura, la
-- serie y los avisos van cada uno en su bloque que captura los errores. Si
-- algo falla, el tique sale como antes (_ticket_fiscal_de_antes) y se avisa.

-- Lo de antes, tal cual lo daba la fiscal_for_print de 20260720T1200.
create or replace function public._ticket_fiscal_de_antes(p_account uuid, p_sale uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_a public.accounts; v_raw jsonb; v_addr text;
begin
  select * into v_a from public.accounts where id = p_account;
  select public.safe_jsonb(raw_tab) into v_raw from public.sale where id = p_sale and account_id = p_account;
  v_addr := nullif(btrim(concat_ws(', ',
              nullif(v_a.billing_address->>'street', ''),
              nullif(concat_ws(' ', v_a.billing_address->>'postalCode', v_a.billing_address->>'city'), ''),
              nullif(v_a.billing_address->>'province', ''))), '');
  return jsonb_build_object('legalName', coalesce(v_a.legal_name, v_a.name), 'taxId', v_a.cif, 'address', v_addr,
    'ticketNumber', coalesce(v_raw->'bills'->0->>'number', v_raw->>'number'));
end $$;
revoke all on function public._ticket_fiscal_de_antes(uuid, uuid) from public, anon, authenticated;

-- Un aviso que nunca tira la impresión: si encolarlo falla, se calla (y queda en el registro).
create or replace function public._ticket_aviso(p_kind text, p_subject text, p_message text, p_debounce text, p_window interval,
                                                p_account uuid, p_location uuid, p_brand uuid, p_severity text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.encolar_alerta(p_kind, p_subject, p_message, p_debounce, p_window, p_account, p_location, p_brand, p_severity);
exception when others then
  raise log 'tique: no se ha podido encolar el aviso % (%)', p_kind, sqlerrm;
end $$;
revoke all on function public._ticket_aviso(text, text, text, text, interval, uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.fiscal_for_print(p_device_token text, p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_device kds_device; v_acc uuid; v_q jsonb; v_loc uuid; v_brand uuid; v_raw jsonb; v_code text; v_t public.ticket_invoice; v_num text;
begin
  -- Igual que antes: sin un token bueno no hay tique (y la tablet lo sabe).
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'fiscal_for_print: token no válido'; end if;
  v_acc := v_device.account_id;

  begin
    select location_id, brand_id, public.safe_jsonb(raw_tab) into v_loc, v_brand, v_raw from public.sale where id = p_sale_id and account_id = v_acc;
    v_q := public._ticket_quien_factura(v_acc, p_sale_id);
  exception when others then
    v_q := null;
    perform public._ticket_aviso('tique_sin_quien_factura', 'Un tique ha salido sin saber quién factura',
      'No se ha podido leer quién factura el pedido al imprimir su tique (' || sqlerrm || '). Ha salido como antes. Míralo en Ajustes › Facturas de los pedidos.',
      'tique_sin_quien_factura:' || v_acc::text, interval '1 hour', v_acc, v_loc, v_brand, 'alto');
  end;
  if v_q is null then
    begin return public._ticket_fiscal_de_antes(v_acc, p_sale_id);
    exception when others then return jsonb_build_object('legalName', null, 'taxId', null, 'address', null, 'ticketNumber', null);
    end;
  end if;

  if v_q->>'tipo' = 'cedida' then
    if (v_q->>'sinFactura')::boolean then
      -- Nunca se inventa un número: el tique va sin la línea, y se avisa.
      perform public._ticket_aviso('tique_cedida_sin_factura',
        'Un pedido de una marca cedida llegó sin la factura de Last',
        'El tique de la bolsa ha salido sin «Factura Simplificada»: el pedido de una marca cedida no trae la factura del socio (raw_tab.bills). Míralo en Last.',
        'tique_cedida_sin_factura:' || p_sale_id::text, interval '7 days', v_acc, v_loc, v_brand, 'aviso');
    end if;
    return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', v_q->>'address',
      'ticketNumber', v_q->>'number', 'issuerKind', 'cedida', 'sinFactura', (v_q->>'sinFactura')::boolean, 'serie', false);
  end if;

  -- Propia: el número de la serie del local, si el local tiene código.
  begin
    select code into v_code from public.location_invoice_code where location_id = v_loc and account_id = v_acc;
    if v_code is not null then
      v_t := public._ticket_invoice_number(v_acc, v_loc, p_sale_id, v_code, v_q->>'legalName', v_q->>'taxId');
      v_num := v_t.number_text;
    end if;
  exception when others then
    -- La impresión no se cae por esto: el tique sale como antes y se avisa.
    v_num := null; v_t := null;
    perform public._ticket_aviso('tique_sin_numero',
      'Un tique ha salido sin el número de su serie',
      'No se ha podido dar el número de la serie del local al imprimir el tique (' || sqlerrm || '). El tique ha salido con el número del pedido. Míralo en Ajustes › Facturas de los pedidos.',
      'tique_sin_numero:' || coalesce(v_loc::text, v_acc::text), interval '1 hour', v_acc, v_loc, v_brand, 'alto');
  end;
  if v_num is null then
    -- Como antes: el número de la plataforma o del TPV, si lo trae (si no, la tablet pone el del pedido).
    v_num := coalesce(v_raw->'bills'->0->>'number', v_raw->>'number');
  end if;
  return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', null,
    'ticketNumber', v_num, 'issuerKind', 'propia', 'sinFactura', false, 'serie', v_t.id is not null);
end;
$function$;
grant execute on function public.fiscal_for_print(text, uuid) to anon;

-- ── La vista previa de Pedidos («Ver tiques»): solo lee ─────────────────────
-- Lo mismo que el tique impreso, sin dar número: si aún no se ha impreso, el
-- número no existe todavía y se dice.
create or replace function public.fiscal_for_preview(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid; v_q jsonb; v_t public.ticket_invoice; v_code text; v_loc uuid; v_raw jsonb;
begin
  select account_id, location_id, public.safe_jsonb(raw_tab) into v_acc, v_loc, v_raw from public.sale where id = p_sale_id;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Ese pedido no está.' using errcode = 'P0002'; end if;
  v_q := public._ticket_quien_factura(v_acc, p_sale_id);
  if v_q->>'tipo' = 'cedida' then
    return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', v_q->>'address',
      'ticketNumber', v_q->>'number', 'issuerKind', 'cedida', 'sinFactura', (v_q->>'sinFactura')::boolean, 'serie', false, 'pendiente', false);
  end if;
  select * into v_t from public.ticket_invoice where account_id = v_acc and sale_id = p_sale_id and kind = 'F';
  select code into v_code from public.location_invoice_code where location_id = v_loc and account_id = v_acc;
  return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', null,
    'ticketNumber', coalesce(v_t.number_text, case when v_code is null then coalesce(v_raw->'bills'->0->>'number', v_raw->>'number') end),
    'issuerKind', 'propia', 'sinFactura', false, 'serie', v_t.id is not null,
    -- El local numera, pero este pedido aún no se ha impreso: el número llega al imprimir.
    'pendiente', v_t.id is null and v_code is not null);
end $$;
revoke all on function public.fiscal_for_preview(uuid) from public, anon;
grant execute on function public.fiscal_for_preview(uuid) to authenticated;

-- ── Ajustes › Facturas de los pedidos ───────────────────────────────────────
create or replace function public.ticket_invoice_ajustes(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_a public.accounts; v_year integer := extract(year from (now() at time zone 'Europe/Madrid'))::integer;
begin
  if p_account is null or not public.belongs_to_account(p_account) then raise exception 'No eres de esta cuenta.' using errcode = '42501'; end if;
  select * into v_a from public.accounts where id = p_account;
  return jsonb_build_object(
    'año', v_year,
    'empresas', (select coalesce(jsonb_agg(jsonb_build_object('company_id', c.id, 'nombre', coalesce(c.legal_name, c.trade_name),
                    'nif', c.tax_id, 'verifactu', coalesce(e.modo, 'apagado'),
                    'conexion_probada', coalesce(public.verifactu_conexion_probada(case when e.modo = 'real' then 'real' else 'pruebas' end,
                                                   regexp_replace(upper(coalesce(c.tax_id, '')), '^ES', '')), false))
                    order by coalesce(c.legal_name, c.trade_name)), '[]'::jsonb)
                   from public.company c left join public.verifactu_empresa e on e.company_id = c.id
                  where c.account_id = p_account and coalesce(c.is_active, true)),
    'locales', (select coalesce(jsonb_agg(jsonb_build_object('location_id', l.id, 'nombre', l.name, 'activo', l.active,
                    'codigo', lic.code, 'propuesto', public._ticket_codigo_propuesto(l.name, v_a.name),
                    'empresa', (select coalesce(c.legal_name, c.trade_name) from public.location_company lc join public.company c on c.id = lc.company_id
                                 where lc.location_id = l.id and lc.account_id = p_account),
                    'serie', case when lic.code is not null then public._ticket_invoice_text(lic.code, v_year, 'F', 1) end,
                    'ultimo', (select last_number from public.ticket_invoice_series s where s.account_id = p_account and s.location_id = l.id and s.year = v_year and s.kind = 'F'),
                    'ultimo_at', (select max(t.issued_at) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id and t.kind = 'F'),
                    'rectificativas', case when lic.code is not null then public._ticket_invoice_text(lic.code, v_year, 'R', 1) end,
                    'ultimo_r', (select last_number from public.ticket_invoice_series s where s.account_id = p_account and s.location_id = l.id and s.year = v_year and s.kind = 'R'),
                    'numeros', (select count(*) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id))
                    order by l.active desc, l.name), '[]'::jsonb)
                  from public.locations l left join public.location_invoice_code lic on lic.location_id = l.id and lic.account_id = p_account
                 where l.account_id = p_account),
    'marcas', (select coalesce(jsonb_agg(jsonb_build_object('brand_id', b.id, 'nombre', b.name, 'propia', coalesce(b.ownership_type, 'own') <> 'licensed',
                    -- Quién emite la de una cedida: lo que dice su último pedido de Last (30 días).
                    'emisor', case when b.ownership_type = 'licensed' then (
                       select public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name' from public.sale s
                        where s.account_id = p_account and s.brand_id = b.id and s.sold_at > now() - interval '30 days'
                          and public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name' is not null
                        order by s.sold_at desc limit 1) end)
                    order by (coalesce(b.ownership_type, 'own') = 'licensed'), b.name), '[]'::jsonb)
                 from public.brand b where b.account_id = p_account and b.is_active and b.archived_at is null),
    -- Pedidos de cedidas de los últimos 7 días sin la factura de Last (sus tiques salen sin la línea).
    'cedidas_sin_factura_7d', (select count(*) from public.sale s join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
                                 where s.account_id = p_account and b.ownership_type = 'licensed' and s.sold_at > now() - interval '7 days'
                                   and nullif(btrim(public.safe_jsonb(s.raw_tab)->'bills'->0->>'number'), '') is null));
end $$;
revoke all on function public.ticket_invoice_ajustes(uuid) from public, anon;
grant execute on function public.ticket_invoice_ajustes(uuid) to authenticated;

-- Elegir el código de un local. Se elige una vez: con números dados, no se cambia.
create or replace function public.ticket_invoice_code_set(p_location uuid, p_code text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l public.locations; v_code text := upper(btrim(coalesce(p_code, ''))); v_ya public.location_invoice_code; v_otro text;
        v_year integer := extract(year from (now() at time zone 'Europe/Madrid'))::integer;
begin
  select * into v_l from public.locations where id = p_location;
  if v_l.id is null or not public.belongs_to_account(v_l.account_id) then raise exception 'Ese local no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_l.account_id) then
    raise exception 'Solo un administrador de la cuenta elige el código de un local.' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z]{2,3}$' then raise exception 'El código son 2 o 3 letras, sin acentos ni números (por ejemplo, CA).' using errcode = '23514'; end if;
  select * into v_ya from public.location_invoice_code where location_id = p_location and account_id = v_l.account_id;
  if v_ya.code = v_code then
    return jsonb_build_object('codigo', v_code, 'cambiado', false, 'serie', public._ticket_invoice_text(v_code, v_year, 'F', 1));
  end if;
  if v_ya.code is not null and exists (select 1 from public.ticket_invoice where account_id = v_l.account_id and location_id = p_location) then
    raise exception 'El código de % ya es %, y su serie ya tiene números: no se cambia (cambiarlo partiría la serie).', v_l.name, v_ya.code using errcode = '23514';
  end if;
  select l.name into v_otro from public.location_invoice_code c join public.locations l on l.id = c.location_id
   where c.account_id = v_l.account_id and c.code = v_code and c.location_id <> p_location;
  if v_otro is not null then raise exception 'El código % ya es de %: elige otro.', v_code, v_otro using errcode = '23505'; end if;
  insert into public.location_invoice_code (location_id, account_id, code, set_by, set_by_name)
  values (p_location, v_l.account_id, v_code, auth.uid(), p_quien_nombre)
  on conflict (location_id) do update set code = excluded.code, set_at = now(), set_by = excluded.set_by, set_by_name = excluded.set_by_name;
  return jsonb_build_object('codigo', v_code, 'cambiado', true, 'serie', public._ticket_invoice_text(v_code, v_year, 'F', 1));
end $$;
revoke all on function public.ticket_invoice_code_set(uuid, text, text) from public, anon;
grant execute on function public.ticket_invoice_code_set(uuid, text, text) to authenticated;

-- Las funciones internas, cerradas (las nuevas nacen abiertas por los permisos por defecto).
revoke all on function public._ticket_invoice_text(text, integer, text, integer) from public, anon, authenticated;
revoke all on function public._ticket_codigo_propuesto(text, text) from public, anon, authenticated;
