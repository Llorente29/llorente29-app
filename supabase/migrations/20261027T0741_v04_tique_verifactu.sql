-- supabase/migrations/20261027T0741_v04_tique_verifactu.sql
--
-- cambia: public.fiscal_for_print · prueba: supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql
-- cambia: public.fiscal_for_preview · prueba: supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql
-- cambia: public._ticket_invoice_number · prueba: supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql
-- cambia: public.ticket_invoice_ajustes · prueba: supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql
-- cambia: public.verifactu_modo · prueba: supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql
-- cambia: public.sale · prueba: supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql
--
-- V04 · PR 2 · El tique de la bolsa con Verifactu (encargo V04, puntos 4 y 5;
-- Respuesta 2, 27/10). Cada tique de una marca propia es un registro F2 del
-- motor de Sumied (V03): uno por tique, nunca un resumen del día.
--
--   1. El fabricante de Sumied (verifactu_sistema): el nombre y el NIF de la
--      declaración responsable. Nace VACÍO (lo pone Julio). Mientras falte,
--      verifactu_modo no deja pasar a «real» (el candado) y Ajustes lo avisa.
--   2. La serie al pasar a «real» no repite números. Si en el año del paso a
--      real el local ya dio números (en pruebas o apagado), lo de real va en un
--      tramo nuevo con una letra: CA27B-000001 (propuesta, la aprueba Julio).
--      Si el paso cae el 1 de enero, la serie del año ya es nueva: CA27-.
--   3. El tique, al numerarse por primera vez, apunta su importe y el entorno
--      de Verifactu de su empresa en ese momento (pruebas o real). Con Verifactu
--      encendido, su alta F2 se registra en la misma impresión: huella
--      encadenada y a la cola. El envío a Hacienda sale después, con la cola de
--      siempre (conta-verifactu): la impresora no espera a Hacienda.
--   4. El QR solo con Verifactu en «real». Se calcula con los datos del tique
--      (NIF, número, fecha e importe), no con el registro: sale aunque el
--      registro haya quedado pendiente. En «pruebas» se registra y se envía, y
--      el papel del cliente va sin QR.
--   5. Si el motor falla, el tique sale igual: el registro queda «pendiente»,
--      se avisa, y ticket_verifactu_pendientes lo reintenta cada 5 minutos.
--   6. Cancelar después de imprimir no borra nada: se anula con el registro de
--      anulación de la E3 (encadenado; «sin registro previo» si Hacienda había
--      rechazado el alta). Un cambio de importe o una devolución después de
--      entregar va en una rectificativa R5 de la serie «R» (por diferencias).
--      Lo hace un disparador de sale que nunca tira la venta.
--   7. Las cedidas no entran: no numeran, no tienen registro, no van a Hacienda
--      ni al libro (las sigue llevando la liquidación del socio).
--
-- Cada función que ya existe se guarda antes con _respaldar_funcion (de la
-- 2309) y su vuelta atrás la restaura byte a byte.

-- ── 1 · El fabricante de Sumied ─────────────────────────────────────────────
create table if not exists public.verifactu_sistema (
  id              boolean primary key default true check (id),
  nombre_razon    text,
  nif             text check (nif is null or nif ~ '^[0-9A-Z]{9}$'),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table public.verifactu_sistema is
  'V04 · PR 2. Quién fabrica Sumied (NombreRazon y NIF del SistemaInformatico, la declaración responsable). Una sola fila. Nace vacía: sin esto, verifactu_modo no deja pasar a real y Ajustes lo avisa. Lo pone el servicio (verifactu_sistema_poner).';
insert into public.verifactu_sistema (id) values (true) on conflict (id) do nothing;
alter table public.verifactu_sistema enable row level security;
revoke all on public.verifactu_sistema from anon, authenticated;

create or replace function public.verifactu_sistema_completo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(nombre_razon), '') is not null and nif is not null from public.verifactu_sistema where id), false)
$$;
revoke all on function public.verifactu_sistema_completo() from public, anon;
grant execute on function public.verifactu_sistema_completo() to authenticated;
comment on function public.verifactu_sistema_completo() is
  'V04 · PR 2. ¿Está puesto quién fabrica Sumied (nombre y NIF)? Sin eso no se pasa a real (verifactu_modo) y Ajustes lo avisa.';

create or replace function public.verifactu_sistema_ver()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre_razon', nullif(btrim(nombre_razon), ''), 'nif', nif) from public.verifactu_sistema where id
$$;
revoke all on function public.verifactu_sistema_ver() from public, anon, authenticated;

create or replace function public.verifactu_sistema_poner(p_nombre text, p_nif text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nif text := regexp_replace(upper(btrim(coalesce(p_nif, ''))), '^ES', '');
begin
  if nullif(btrim(coalesce(p_nombre, '')), '') is null then raise exception 'Falta el nombre de quien fabrica Sumied.' using errcode = '23514'; end if;
  if not public._verifactu_nif_es_valido(v_nif) then raise exception 'El NIF de quien fabrica Sumied (%) no es válido.', v_nif using errcode = '23514'; end if;
  update public.verifactu_sistema set nombre_razon = btrim(p_nombre), nif = v_nif, updated_at = now(), updated_by_name = p_quien_nombre where id;
  return public.verifactu_sistema_ver();
end $$;
revoke all on function public.verifactu_sistema_poner(text, text, text) from public, anon, authenticated;
comment on function public.verifactu_sistema_poner(text, text, text) is
  'V04 · PR 2. Solo el servicio: pone quién fabrica Sumied (nombre y NIF de la declaración responsable).';

-- Lo que ya existe y cambia aquí, guardado tal cual antes de cambiarlo.
select public._respaldar_funcion('public.verifactu_modo(uuid,text,text,text,text)', '20261027T0741_v04_tique_verifactu');
select public._respaldar_funcion('public._ticket_invoice_number(uuid,uuid,uuid,text,text,text,timestamptz)', '20261027T0741_v04_tique_verifactu');
select public._respaldar_funcion('public.fiscal_for_print(text,uuid)', '20261027T0741_v04_tique_verifactu');
select public._respaldar_funcion('public.fiscal_for_preview(uuid)', '20261027T0741_v04_tique_verifactu');
select public._respaldar_funcion('public.ticket_invoice_ajustes(uuid)', '20261027T0741_v04_tique_verifactu');

-- El candado de siempre (2351) y, delante de «real», el fabricante.
create or replace function public.verifactu_modo(p_company uuid, p_modo text, p_serie text default null, p_confirmacion text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_co public.company; v_e public.verifactu_empresa; v_serie text := upper(btrim(coalesce(p_serie, ''))); v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_co.account_id) then raise exception 'Solo un administrador o un encargado de la cuenta cambia Verifactu.' using errcode = '42501'; end if;
  if p_modo not in ('apagado', 'pruebas', 'real') then raise exception 'Verifactu va apagado, en pruebas o en real.' using errcode = '22023'; end if;
  insert into public.verifactu_empresa (company_id, account_id) values (v_co.id, v_co.account_id) on conflict (company_id) do nothing;
  select * into v_e from public.verifactu_empresa where company_id = p_company for update;
  if v_e.modo = p_modo then return jsonb_build_object('modo', v_e.modo, 'cambiado', false); end if;
  -- EL CANDADO (respuesta 3 de Julio): a pruebas o a real, solo con una prueba
  -- de conexión correcta con la AEAT apuntada. En pruebas, la del entorno de
  -- pruebas; en real, la de real con el NIF de esta empresa.
  if p_modo in ('pruebas', 'real') and not public.verifactu_conexion_probada(p_modo, v_co.tax_id) then
    raise exception '%', case p_modo
      when 'pruebas' then 'Todavía no se ha probado la conexión con el entorno de pruebas de Hacienda: hasta que salga bien, Verifactu no se puede poner en pruebas.'
      else 'Todavía no se ha probado la conexión con Hacienda con el certificado de esta empresa: hasta que salga bien, Verifactu no se puede pasar a real.' end
      using errcode = '23514';
  end if;
  -- V04 · PR 2: a real, solo con el fabricante de Sumied puesto (la declaración responsable).
  if p_modo = 'real' and not public.verifactu_sistema_completo() then
    raise exception 'Falta quién fabrica Sumied (el nombre y el NIF de la declaración responsable): hasta que esté puesto, Verifactu no se puede pasar a real.'
      using errcode = '23514';
  end if;
  if v_e.modo = 'real' and v_hoy <= v_e.real_obliga_hasta then
    raise exception 'Estás en real desde el %: la ley obliga a seguir así hasta el % (Orden HAC/1177/2024, art. 17.2).',
      to_char(v_e.real_desde at time zone 'Europe/Madrid', 'DD/MM/YYYY'), to_char(v_e.real_obliga_hasta, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if p_modo = 'real' then
    if p_confirmacion is distinct from 'EMPEZAR' then raise exception 'Para pasar a real, escribe EMPEZAR: desde ese momento no se puede volver a pruebas este año.' using errcode = '23514'; end if;
    if not public._verifactu_nif_es_valido(v_co.tax_id) then raise exception 'El NIF de tu empresa no es válido: corrígelo antes de pasar a real.' using errcode = '23514'; end if;
    if v_serie !~ '^[A-Z0-9][A-Z0-9-]{0,9}$' then raise exception 'La serie nueva va en mayúsculas y cifras (por ejemplo F%).', extract(year from v_hoy)::int using errcode = '23514'; end if;
    if exists (select 1 from public.customer_invoice where company_id = p_company and series_code = v_serie and status <> 'borrador') then
      raise exception 'La serie % ya tiene facturas: la de real empieza nueva.', v_serie using errcode = '23514';
    end if;
    if not exists (select 1 from public.invoice_series where company_id = p_company and code = v_serie) then
      insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, reset_yearly, starts_at, is_default, is_active)
      values (v_co.account_id, v_co.id, v_serie, 'Facturas (Verifactu)', 'invoice', 4, true, 1, false, true);
    end if;
    update public.verifactu_empresa set modo = 'real', real_desde = now(), real_serie = v_serie,
           real_obliga_hasta = make_date(extract(year from v_hoy)::int, 12, 31), updated_at = now(), updated_by_name = v_quien
     where company_id = p_company;
  else
    update public.verifactu_empresa set modo = p_modo, real_desde = null, real_serie = null, real_obliga_hasta = null,
           pruebas_desde = case when p_modo = 'pruebas' then now() else pruebas_desde end, updated_at = now(), updated_by_name = v_quien
     where company_id = p_company;
  end if;
  select * into v_e from public.verifactu_empresa where company_id = p_company;
  return jsonb_build_object('modo', v_e.modo, 'cambiado', true, 'real_desde', v_e.real_desde, 'real_serie', v_e.real_serie, 'real_obliga_hasta', v_e.real_obliga_hasta);
end $$;
revoke all on function public.verifactu_modo(uuid, text, text, text, text) from public, anon;
grant execute on function public.verifactu_modo(uuid, text, text, text, text) to authenticated;
comment on function public.verifactu_modo(uuid, text, text, text, text) is
  'V03 · V04. El interruptor de Verifactu de una empresa: apagado, pruebas o real. A pruebas o a real, solo con una prueba de conexión correcta con la AEAT apuntada (el candado); a real, además con el fabricante de Sumied puesto (verifactu_sistema), escribiendo EMPEZAR y con una serie nueva; obliga hasta el 31/12.';

-- ── 2 y 3 · El tique: su importe, su Verifactu y su tramo ───────────────────
-- Todo nuevo y admite nulos: los tiques de antes se quedan como estaban.
alter table public.ticket_invoice add column if not exists company_id uuid references public.company(id) on delete restrict;
alter table public.ticket_invoice add column if not exists importe_total numeric(14,2);
alter table public.ticket_invoice add column if not exists rectifica_id uuid references public.ticket_invoice(id) on delete restrict;
alter table public.ticket_invoice add column if not exists verifactu_entorno text check (verifactu_entorno is null or verifactu_entorno in ('pruebas', 'real'));
alter table public.ticket_invoice add column if not exists verifactu_registro_id uuid references public.verifactu_registro(id) on delete restrict;
alter table public.ticket_invoice add column if not exists verifactu_anulacion_id uuid references public.verifactu_registro(id) on delete restrict;
alter table public.ticket_invoice add column if not exists verifactu_estado text
  check (verifactu_estado is null or verifactu_estado in ('registrado', 'pendiente', 'anulado', 'anulacion_pendiente'));
alter table public.ticket_invoice add column if not exists verifactu_error text;
alter table public.ticket_invoice add column if not exists verifactu_intentos integer;
create index if not exists ticket_invoice_verifactu_pendiente on public.ticket_invoice (issued_at)
  where verifactu_estado in ('pendiente', 'anulacion_pendiente');
create index if not exists ticket_invoice_de_la_venta on public.ticket_invoice (account_id, sale_id);
comment on column public.ticket_invoice.verifactu_entorno is
  'V04 · PR 2. El entorno de Verifactu de su empresa cuando se numeró (pruebas o real); null: Verifactu apagado, no va a Hacienda. No cambia después.';
comment on column public.ticket_invoice.importe_total is
  'V04 · PR 2. El importe del tique cuando se numeró (el del papel y el del QR). En una rectificativa, la diferencia.';

-- ── tramo: inicio ───────────────────────────────────────────────────────────
-- (Autocontenido sobre el bloque «serie» de la 2309: lo carga tal cual
-- tests/unit/modules/orders/v04/tramoTique.test.ts.)
--
-- El tramo de una serie: null (CA27-000001) o una letra (CA27B-000001). La
-- letra sale cuando la empresa del local pasó a «real» en ese año y el local
-- ya había dado números antes en esa serie: así lo de real no repite ningún
-- número del papel de antes. Propuesta para Julio: la B (y C, D… si alguna vez
-- hiciera falta otra).
alter table public.ticket_invoice_series add column if not exists tramo text check (tramo is null or tramo ~ '^[B-Z]$');
create unique index if not exists ticket_invoice_series_unica_tramo
  on public.ticket_invoice_series (account_id, location_id, year, kind, (coalesce(tramo, '')));
alter table public.ticket_invoice_series drop constraint if exists ticket_invoice_series_unica;

create or replace function public._ticket_numero_texto(p_code text, p_year integer, p_tramo text, p_kind text, p_number integer)
returns text language sql immutable set search_path = public as $$
  select p_code || lpad((p_year % 100)::text, 2, '0') || coalesce(p_tramo, '') || '-' || case when p_kind = 'R' then 'R-' else '' end || lpad(p_number::text, 6, '0')
$$;
revoke all on function public._ticket_numero_texto(text, integer, text, text, integer) from public, anon, authenticated;

-- El tramo que toca a un número nuevo de la serie (local, año, tipo).
create or replace function public._ticket_tramo(p_account uuid, p_location uuid, p_year integer, p_kind text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_desde timestamptz;
begin
  select e.real_desde into v_desde
    from public.location_company lc join public.verifactu_empresa e on e.company_id = lc.company_id
   where lc.location_id = p_location and lc.account_id = p_account and e.modo = 'real';
  if v_desde is null or extract(year from (v_desde at time zone 'Europe/Madrid'))::integer <> p_year then return null; end if;
  -- ¿Dio el local números de esta serie, sin tramo, antes de pasar a real?
  if exists (select 1 from public.ticket_invoice t join public.ticket_invoice_series s on s.id = t.series_id
              where s.account_id = p_account and s.location_id = p_location and s.year = p_year and s.kind = p_kind
                and s.tramo is null and t.issued_at < v_desde) then
    return 'B';
  end if;
  return null;
end $$;
revoke all on function public._ticket_tramo(uuid, uuid, integer, text) from public, anon, authenticated;

-- El siguiente número de la serie del local para ESTE pedido (como en la 2309)
-- y ahora, además, en su tramo y con la empresa que factura.
create or replace function public._ticket_invoice_number(p_account uuid, p_location uuid, p_sale uuid, p_code text,
                                                         p_issuer_name text, p_issuer_tax_id text, p_at timestamptz default now())
returns public.ticket_invoice language plpgsql security definer set search_path = public as $$
declare v_t public.ticket_invoice; v_s public.ticket_invoice_series; v_year integer; v_tramo text; v_company uuid;
begin
  if p_account is null or p_location is null or p_sale is null or p_code is null then
    raise exception 'Faltan datos para numerar el tique.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ticket_invoice:' || p_account::text || ':' || p_sale::text, 0));
  select * into v_t from public.ticket_invoice where account_id = p_account and sale_id = p_sale and kind = 'F';
  if v_t.id is not null then return v_t; end if;
  v_year := extract(year from (p_at at time zone 'Europe/Madrid'))::integer;
  v_tramo := public._ticket_tramo(p_account, p_location, v_year, 'F');
  select lc.company_id into v_company from public.location_company lc where lc.location_id = p_location and lc.account_id = p_account;
  insert into public.ticket_invoice_series as s (account_id, location_id, code, year, kind, tramo, last_number)
  values (p_account, p_location, p_code, v_year, 'F', v_tramo, 1)
  on conflict (account_id, location_id, year, kind, (coalesce(tramo, ''))) do update set last_number = s.last_number + 1, updated_at = now()
  returning * into v_s;
  insert into public.ticket_invoice (account_id, sale_id, location_id, series_id, kind, number, number_text, issued_at, issuer_name, issuer_tax_id, company_id)
  values (p_account, p_sale, p_location, v_s.id, 'F', v_s.last_number,
          public._ticket_numero_texto(v_s.code, v_s.year, v_s.tramo, 'F', v_s.last_number), p_at, p_issuer_name, p_issuer_tax_id, v_company)
  returning * into v_t;
  return v_t;
end $$;
revoke all on function public._ticket_invoice_number(uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
-- ── tramo: fin ──────────────────────────────────────────────────────────────

-- La guarda de la vuelta atrás (la llama primero el .down.sql): con números en
-- un tramo, rectificativas o registros de Verifactu, para. Esos números están
-- en papeles que tienen los clientes, y esos registros, en Hacienda.
create or replace function public._ticket_verifactu_se_puede_deshacer()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.ticket_invoice_series where tramo is not null)
     or exists (select 1 from public.ticket_invoice where kind = 'R' or verifactu_registro_id is not null or verifactu_anulacion_id is not null) then
    raise exception 'La 0741 ya ha dado números en un tramo, rectificativas o registros de Verifactu: no se deshace sin decidirlo antes.'
      using errcode = '55000';
  end if;
end $$;
revoke all on function public._ticket_verifactu_se_puede_deshacer() from public, anon, authenticated;

-- ── 3 · El registro F2 (y la R5) de un tique ────────────────────────────────
-- El IVA, como el papel: todo al 10 % (hostelería), base = total / 1,10.
create or replace function public._ticket_verifactu_alta(p_ticket uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_t public.ticket_invoice; v_f public.ticket_invoice; v_co public.company; v_reg public.verifactu_registro;
        v_nif text; v_base numeric; v_cuota numeric;
begin
  select * into v_t from public.ticket_invoice where id = p_ticket for update;
  if v_t.id is null or v_t.verifactu_entorno is null then return 'no_va'; end if;
  if v_t.verifactu_registro_id is not null then return 'registrado'; end if;
  select * into v_co from public.company where id = v_t.company_id and account_id = v_t.account_id;
  if v_co.id is null then raise exception 'El tique % no tiene empresa que lo facture.', v_t.number_text using errcode = '23514'; end if;
  if v_t.importe_total is null then raise exception 'El tique % no tiene importe.', v_t.number_text using errcode = '23514'; end if;
  v_nif := regexp_replace(upper(coalesce(v_co.tax_id, '')), '^ES', '');
  v_base := round(v_t.importe_total / 1.10, 2);
  v_cuota := v_t.importe_total - v_base;
  if v_t.kind = 'R' then select * into v_f from public.ticket_invoice where id = v_t.rectifica_id; end if;
  v_reg := public._verifactu_registrar(jsonb_build_object(
    'account_id', v_t.account_id, 'company_id', v_co.id, 'entorno', v_t.verifactu_entorno, 'tipo', 'alta', 'origen', 'simplificada',
    'origen_programa', 'folvy', 'origen_ref', v_t.sale_id::text,
    'nif_emisor', v_nif, 'nombre_emisor', coalesce(v_co.legal_name, v_co.trade_name),
    'num_serie', v_t.number_text, 'fecha_expedicion', (v_t.issued_at at time zone 'Europe/Madrid')::date,
    'tipo_factura', case when v_t.kind = 'R' then 'R5' else 'F2' end,
    'tipo_rectificativa', case when v_t.kind = 'R' then 'I' end,
    'rectificadas', case when v_t.kind = 'R' then jsonb_build_array(jsonb_build_object('nif', v_nif, 'num_serie', v_f.number_text,
                      'fecha', (v_f.issued_at at time zone 'Europe/Madrid')::date)) end,
    'descripcion', case when v_t.kind = 'R' then 'Rectificativa del tique ' || v_f.number_text else 'Venta de comida para llevar' end,
    'desglose', jsonb_build_array(jsonb_build_object('impuesto', '01', 'clave_regimen', '01', 'calificacion', 'S1', 'tipo', 10, 'base', v_base, 'cuota', v_cuota)),
    'cuota_total', v_cuota, 'importe_total', v_t.importe_total, 'quien', 'Folvy (tique de la bolsa)'));
  update public.ticket_invoice set verifactu_registro_id = v_reg.id, verifactu_estado = 'registrado', verifactu_error = null where id = v_t.id;
  return 'registrado';
end $$;
revoke all on function public._ticket_verifactu_alta(uuid) from public, anon, authenticated;

-- La anulación de un tique (con la de la E3: encadenada, y «sin registro
-- previo» si Hacienda rechazó el alta y no se subsanó). Si el alta aún no
-- estaba registrada, primero el alta: el tique existió y el cliente lo tiene.
create or replace function public._ticket_verifactu_anular(p_ticket uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_t public.ticket_invoice; v_a public.verifactu_registro; v_reg public.verifactu_registro; v_sin boolean;
begin
  select * into v_t from public.ticket_invoice where id = p_ticket for update;
  if v_t.id is null or v_t.verifactu_entorno is null then return 'no_va'; end if;
  if v_t.verifactu_anulacion_id is not null then return 'anulado'; end if;
  if v_t.verifactu_registro_id is null then
    perform public._ticket_verifactu_alta(p_ticket);
    select * into v_t from public.ticket_invoice where id = p_ticket;
  end if;
  select * into v_a from public.verifactu_registro where id = v_t.verifactu_registro_id;
  v_sin := v_a.estado = 'incorrecto' and not exists (select 1 from public.verifactu_registro r
             where r.tipo = 'alta' and r.entorno = v_a.entorno and r.nif_emisor = v_a.nif_emisor and r.num_serie = v_a.num_serie
               and r.fecha_expedicion = v_a.fecha_expedicion and r.estado in ('correcto', 'aceptado_con_errores'));
  v_reg := public._verifactu_registrar(jsonb_build_object(
    'account_id', v_a.account_id, 'company_id', v_a.company_id, 'entorno', v_a.entorno, 'tipo', 'anulacion', 'origen', v_a.origen,
    'origen_programa', v_a.origen_programa, 'origen_ref', v_a.origen_ref, 'alta_id', v_a.id, 'sin_registro_previo', v_sin,
    'nif_emisor', v_a.nif_emisor, 'nombre_emisor', v_a.nombre_emisor, 'num_serie', v_a.num_serie, 'fecha_expedicion', v_a.fecha_expedicion,
    'quien', 'Folvy (pedido cancelado)'));
  update public.ticket_invoice set verifactu_anulacion_id = v_reg.id, verifactu_estado = 'anulado', verifactu_error = null where id = v_t.id;
  return 'anulado';
end $$;
revoke all on function public._ticket_verifactu_anular(uuid) from public, anon, authenticated;

-- La rectificativa por diferencias de un pedido ya entregado: lo que cobra
-- ahora (total menos devuelto) contra lo que ya dicen su tique y sus
-- rectificativas. Número de la serie R del local, en su tramo, y al mismo
-- entorno de Verifactu que su tique (si la empresa sigue con Verifactu).
create or replace function public._ticket_rectificar(p_account uuid, p_sale uuid)
returns public.ticket_invoice language plpgsql security definer set search_path = public as $$
declare v_f public.ticket_invoice; v_s public.ticket_invoice_series; v_r public.ticket_invoice; v_ahora numeric; v_dicho numeric; v_dif numeric;
        v_year integer := extract(year from (now() at time zone 'Europe/Madrid'))::integer; v_tramo text; v_modo text; v_code text;
begin
  perform pg_advisory_xact_lock(hashtextextended('ticket_invoice:' || p_account::text || ':' || p_sale::text, 0));
  select * into v_f from public.ticket_invoice where account_id = p_account and sale_id = p_sale and kind = 'F';
  if v_f.id is null or v_f.importe_total is null or v_f.verifactu_estado in ('anulado', 'anulacion_pendiente') then return null; end if;
  select round(coalesce(total, 0) - coalesce(refund_amount, 0), 2) into v_ahora from public.sale where id = p_sale and account_id = p_account;
  select v_f.importe_total + coalesce(sum(importe_total), 0) into v_dicho
    from public.ticket_invoice where account_id = p_account and sale_id = p_sale and kind = 'R';
  v_dif := v_ahora - v_dicho;
  if v_ahora is null or abs(v_dif) < 0.005 then return null; end if;
  select code into v_code from public.ticket_invoice_series where id = v_f.series_id;
  v_tramo := public._ticket_tramo(p_account, v_f.location_id, v_year, 'R');
  insert into public.ticket_invoice_series as s (account_id, location_id, code, year, kind, tramo, last_number)
  values (p_account, v_f.location_id, v_code, v_year, 'R', v_tramo, 1)
  on conflict (account_id, location_id, year, kind, (coalesce(tramo, ''))) do update set last_number = s.last_number + 1, updated_at = now()
  returning * into v_s;
  select e.modo into v_modo from public.verifactu_empresa e where e.company_id = v_f.company_id;
  insert into public.ticket_invoice (account_id, sale_id, location_id, series_id, kind, number, number_text, issuer_name, issuer_tax_id,
                                     company_id, importe_total, rectifica_id, verifactu_entorno)
  values (p_account, p_sale, v_f.location_id, v_s.id, 'R', v_s.last_number,
          public._ticket_numero_texto(v_s.code, v_s.year, v_s.tramo, 'R', v_s.last_number), v_f.issuer_name, v_f.issuer_tax_id,
          v_f.company_id, v_dif, v_f.id, case when v_modo in ('pruebas', 'real') then v_f.verifactu_entorno end)
  returning * into v_r;
  if v_r.verifactu_entorno is not null then
    begin
      perform public._ticket_verifactu_alta(v_r.id);
    exception when others then
      update public.ticket_invoice set verifactu_estado = 'pendiente', verifactu_error = left(sqlerrm, 500), verifactu_intentos = 1 where id = v_r.id;
    end;
    select * into v_r from public.ticket_invoice where id = v_r.id;
  end if;
  return v_r;
end $$;
revoke all on function public._ticket_rectificar(uuid, uuid) from public, anon, authenticated;

-- ── 6 · Después de imprimir: cancelar anula, cambiar el importe rectifica ───
-- El disparador nunca tira la venta: cualquier fallo queda pendiente y avisado.
create or replace function public._ticket_tras_venta()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cancela boolean; v_cambia boolean;
begin
  v_cancela := (new.status = 'cancelled' or new.order_status in ('cancelled', 'rejected', 'delivery_failed'))
               and not (old.status = 'cancelled' or old.order_status in ('cancelled', 'rejected', 'delivery_failed'));
  v_cambia := not v_cancela and old.status = 'closed' and new.status = 'closed'
              and (old.total is distinct from new.total or old.refund_amount is distinct from new.refund_amount);
  if not (v_cancela or v_cambia) then return null; end if;
  if not exists (select 1 from public.ticket_invoice where account_id = new.account_id and sale_id = new.id) then return null; end if;
  if v_cancela then
    for v_id in select id from public.ticket_invoice where account_id = new.account_id and sale_id = new.id
                  and verifactu_entorno is not null and verifactu_anulacion_id is null order by kind, number loop
      begin
        perform public._ticket_verifactu_anular(v_id);
      exception when others then
        update public.ticket_invoice set verifactu_estado = 'anulacion_pendiente', verifactu_error = left(sqlerrm, 500),
               verifactu_intentos = coalesce(verifactu_intentos, 0) + 1 where id = v_id;
        perform public._ticket_aviso('tique_verifactu_pendiente', 'La anulación de un tique cancelado ha quedado pendiente',
          'Un pedido cancelado después de imprimir su tique no ha podido anularse en Verifactu (' || left(sqlerrm, 300) || '). Se reintenta cada 5 minutos.',
          'tique_verifactu_pendiente:' || new.account_id::text, interval '1 hour', new.account_id, new.location_id, new.brand_id, 'alto');
      end;
    end loop;
  else
    begin
      perform public._ticket_rectificar(new.account_id, new.id);
    exception when others then
      perform public._ticket_aviso('tique_sin_rectificativa', 'Un pedido entregado ha cambiado de importe y no tiene su rectificativa',
        'El importe de un pedido entregado ha cambiado (o se ha devuelto algo), y no se ha podido hacer su rectificativa (' || left(sqlerrm, 300) || ').',
        'tique_sin_rectificativa:' || new.id::text, interval '7 days', new.account_id, new.location_id, new.brand_id, 'alto');
    end;
  end if;
  return null;
exception when others then
  raise log 'tique: el disparador de la venta % ha fallado (%): la venta sigue', new.id, sqlerrm;
  return null;
end $$;
revoke all on function public._ticket_tras_venta() from public, anon, authenticated;

create trigger ticket_tras_venta after update of status, order_status, total, refund_amount on public.sale
  for each row
  when (old.status is distinct from new.status or old.order_status is distinct from new.order_status
        or old.total is distinct from new.total or old.refund_amount is distinct from new.refund_amount)
  execute function public._ticket_tras_venta();

-- ── 5 · Lo pendiente, otra vez cada 5 minutos ──────────────────────────────
create or replace function public.ticket_verifactu_pendientes(p_max integer default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_bien int := 0; v_mal int := 0;
begin
  for v in select id, account_id, location_id, verifactu_estado, number_text from public.ticket_invoice
            where verifactu_estado in ('pendiente', 'anulacion_pendiente')
            order by issued_at limit greatest(coalesce(p_max, 200), 1) loop
    begin
      if v.verifactu_estado = 'pendiente' then perform public._ticket_verifactu_alta(v.id);
      else perform public._ticket_verifactu_anular(v.id); end if;
      v_bien := v_bien + 1;
    exception when others then
      v_mal := v_mal + 1;
      update public.ticket_invoice set verifactu_error = left(sqlerrm, 500), verifactu_intentos = coalesce(verifactu_intentos, 0) + 1 where id = v.id;
      perform public._ticket_aviso('tique_verifactu_pendiente', 'Hay tiques sin su registro de Verifactu',
        'El tique ' || v.number_text || ' sigue sin su registro de Verifactu (' || left(sqlerrm, 300) || '). Se reintenta cada 5 minutos.',
        'tique_verifactu_pendiente:' || v.account_id::text, interval '6 hours', v.account_id, v.location_id, null, 'alto');
    end;
  end loop;
  return jsonb_build_object('registrados', v_bien, 'siguen', v_mal);
end $$;
revoke all on function public.ticket_verifactu_pendientes(integer) from public, anon, authenticated;
comment on function public.ticket_verifactu_pendientes(integer) is
  'V04 · PR 2. Cada 5 minutos (cron ticket-verifactu-pendientes): los tiques cuyo registro de Verifactu (alta o anulación) quedó pendiente al imprimir o al cancelar, otra vez. Si siguen, aviso alto (cada 6 h por cuenta).';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ticket-verifactu-pendientes') then perform cron.unschedule('ticket-verifactu-pendientes'); end if;
    perform cron.schedule('ticket-verifactu-pendientes', '*/5 * * * *', $cron$select public.ticket_verifactu_pendientes()$cron$);
  end if;
end $$;

-- ── 3 y 4 · Al imprimir ─────────────────────────────────────────────────────
create or replace function public.fiscal_for_print(p_device_token text, p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_device kds_device; v_acc uuid; v_q jsonb; v_loc uuid; v_brand uuid; v_raw jsonb; v_code text; v_t public.ticket_invoice; v_num text;
  v_modo text; v_qr text; v_nif text;
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

  -- Las cedidas no entran en nada de lo nuestro (ni serie, ni Verifactu): la factura es del socio.
  if v_q->>'tipo' = 'cedida' then
    if (v_q->>'sinFactura')::boolean then
      -- Nunca se inventa un número: el tique va sin la línea, y se avisa.
      perform public._ticket_aviso('tique_cedida_sin_factura',
        'Un pedido de una marca cedida llegó sin la factura de Last',
        'El tique de la bolsa ha salido sin «Factura Simplificada»: el pedido de una marca cedida no trae la factura del socio (raw_tab.bills). Míralo en Last.',
        'tique_cedida_sin_factura:' || p_sale_id::text, interval '7 days', v_acc, v_loc, v_brand, 'aviso');
    end if;
    return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', v_q->>'address',
      'ticketNumber', v_q->>'number', 'issuerKind', 'cedida', 'sinFactura', (v_q->>'sinFactura')::boolean, 'serie', false,
      'verifactu', null, 'verifactuQr', null);
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

  -- Verifactu (V04 · PR 2). Nada de esto para la impresión: ni espera a
  -- Hacienda (el envío lo hace la cola después) ni falla si el motor falla.
  if v_t.id is not null then
    begin
      -- Recién numerado en esta impresión (el número se da con now(), la hora
      -- de esta transacción): se apuntan su importe y el entorno de su empresa.
      if v_t.issued_at = now() and v_t.importe_total is null then
        select e.modo into v_modo from public.verifactu_empresa e where e.company_id = v_t.company_id;
        update public.ticket_invoice
           set importe_total = (select round(total, 2) from public.sale where id = p_sale_id and account_id = v_acc),
               verifactu_entorno = case when v_modo in ('pruebas', 'real') then v_modo end
         where id = v_t.id returning * into v_t;
        if v_t.verifactu_entorno is not null then
          begin
            perform public._ticket_verifactu_alta(v_t.id);
          exception when others then
            update public.ticket_invoice set verifactu_estado = 'pendiente', verifactu_error = left(sqlerrm, 500), verifactu_intentos = 1 where id = v_t.id;
            perform public._ticket_aviso('tique_verifactu_pendiente', 'Un tique ha salido sin su registro de Verifactu',
              'El tique ' || v_t.number_text || ' se ha impreso, pero su registro de Verifactu ha quedado pendiente (' || left(sqlerrm, 300) || '). Se reintenta cada 5 minutos.',
              'tique_verifactu_pendiente:' || v_acc::text, interval '1 hour', v_acc, v_loc, v_brand, 'alto');
          end;
        end if;
        select * into v_t from public.ticket_invoice where id = v_t.id;
      end if;
      -- El QR, solo en real, con los datos del propio tique.
      if v_t.verifactu_entorno = 'real' and v_t.importe_total is not null then
        select regexp_replace(upper(coalesce(c.tax_id, '')), '^ES', '') into v_nif from public.company c where c.id = v_t.company_id;
        v_qr := public.verifactu_url_qr('real', v_nif, v_t.number_text, (v_t.issued_at at time zone 'Europe/Madrid')::date, v_t.importe_total);
      end if;
    exception when others then
      v_qr := null;
      perform public._ticket_aviso('tique_verifactu_pendiente', 'Un tique ha salido sin su registro de Verifactu',
        'Al imprimir el tique ' || coalesce(v_t.number_text, '') || ' ha fallado lo de Verifactu (' || left(sqlerrm, 300) || '). El tique ha salido.',
        'tique_verifactu_pendiente:' || v_acc::text, interval '1 hour', v_acc, v_loc, v_brand, 'alto');
    end;
  end if;

  if v_num is null then
    -- Como antes: el número de la plataforma o del TPV, si lo trae (si no, la tablet pone el del pedido).
    v_num := coalesce(v_raw->'bills'->0->>'number', v_raw->>'number');
  end if;
  return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', null,
    'ticketNumber', v_num, 'issuerKind', 'propia', 'sinFactura', false, 'serie', v_t.id is not null,
    'verifactu', v_t.verifactu_entorno, 'verifactuQr', v_qr);
end;
$function$;
grant execute on function public.fiscal_for_print(text, uuid) to anon;

-- La vista previa: lo mismo, solo leyendo (y el QR si el tique ya lo lleva).
create or replace function public.fiscal_for_preview(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid; v_q jsonb; v_t public.ticket_invoice; v_code text; v_loc uuid; v_raw jsonb; v_qr text;
begin
  select account_id, location_id, public.safe_jsonb(raw_tab) into v_acc, v_loc, v_raw from public.sale where id = p_sale_id;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Ese pedido no está.' using errcode = 'P0002'; end if;
  v_q := public._ticket_quien_factura(v_acc, p_sale_id);
  if v_q->>'tipo' = 'cedida' then
    return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', v_q->>'address',
      'ticketNumber', v_q->>'number', 'issuerKind', 'cedida', 'sinFactura', (v_q->>'sinFactura')::boolean, 'serie', false, 'pendiente', false,
      'verifactu', null, 'verifactuQr', null);
  end if;
  select * into v_t from public.ticket_invoice where account_id = v_acc and sale_id = p_sale_id and kind = 'F';
  select code into v_code from public.location_invoice_code where location_id = v_loc and account_id = v_acc;
  if v_t.verifactu_entorno = 'real' and v_t.importe_total is not null then
    v_qr := public.verifactu_url_qr('real', (select regexp_replace(upper(coalesce(c.tax_id, '')), '^ES', '') from public.company c where c.id = v_t.company_id),
                                    v_t.number_text, (v_t.issued_at at time zone 'Europe/Madrid')::date, v_t.importe_total);
  end if;
  return jsonb_build_object('legalName', v_q->>'legalName', 'taxId', v_q->>'taxId', 'address', null,
    'ticketNumber', coalesce(v_t.number_text, case when v_code is null then coalesce(v_raw->'bills'->0->>'number', v_raw->>'number') end),
    'issuerKind', 'propia', 'sinFactura', false, 'serie', v_t.id is not null,
    -- El local numera, pero este pedido aún no se ha impreso: el número llega al imprimir.
    'pendiente', v_t.id is null and v_code is not null,
    'verifactu', v_t.verifactu_entorno, 'verifactuEstado', v_t.verifactu_estado, 'verifactuQr', v_qr);
end $$;
revoke all on function public.fiscal_for_preview(uuid) from public, anon;
grant execute on function public.fiscal_for_preview(uuid) to authenticated;

-- ── Ajustes › Facturas de los pedidos: el tramo, Verifactu y el fabricante ──
create or replace function public.ticket_invoice_ajustes(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_a public.accounts; v_year integer := extract(year from (now() at time zone 'Europe/Madrid'))::integer;
begin
  if p_account is null or not public.belongs_to_account(p_account) then raise exception 'No eres de esta cuenta.' using errcode = '42501'; end if;
  select * into v_a from public.accounts where id = p_account;
  return jsonb_build_object(
    'año', v_year,
    -- Sin el fabricante de Sumied no se pasa a real (verifactu_modo): se avisa aquí.
    'fabricante_falta', not public.verifactu_sistema_completo(),
    'empresas', (select coalesce(jsonb_agg(jsonb_build_object('company_id', c.id, 'nombre', coalesce(c.legal_name, c.trade_name),
                    'nif', c.tax_id, 'verifactu', coalesce(e.modo, 'apagado'), 'real_desde', e.real_desde,
                    'conexion_probada', coalesce(public.verifactu_conexion_probada(case when e.modo = 'real' then 'real' else 'pruebas' end,
                                                   regexp_replace(upper(coalesce(c.tax_id, '')), '^ES', '')), false))
                    order by coalesce(c.legal_name, c.trade_name)), '[]'::jsonb)
                   from public.company c left join public.verifactu_empresa e on e.company_id = c.id
                  where c.account_id = p_account and coalesce(c.is_active, true)),
    'locales', (select coalesce(jsonb_agg(jsonb_build_object('location_id', l.id, 'nombre', l.name, 'activo', l.active,
                    'codigo', lic.code, 'propuesto', public._ticket_codigo_propuesto(l.name, v_a.name),
                    'empresa', (select coalesce(c.legal_name, c.trade_name) from public.location_company lc join public.company c on c.id = lc.company_id
                                 where lc.location_id = l.id and lc.account_id = p_account),
                    'tramo', x.tramo,
                    'serie', case when lic.code is not null then public._ticket_numero_texto(lic.code, v_year, x.tramo, 'F', 1) end,
                    'ultimo', (select last_number from public.ticket_invoice_series s where s.account_id = p_account and s.location_id = l.id
                                 and s.year = v_year and s.kind = 'F' and s.tramo is not distinct from x.tramo),
                    'ultimo_at', (select max(t.issued_at) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id and t.kind = 'F'),
                    'rectificativas', case when lic.code is not null then public._ticket_numero_texto(lic.code, v_year, x.tramo_r, 'R', 1) end,
                    'ultimo_r', (select last_number from public.ticket_invoice_series s where s.account_id = p_account and s.location_id = l.id
                                   and s.year = v_year and s.kind = 'R' and s.tramo is not distinct from x.tramo_r),
                    'numeros', (select count(*) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id),
                    'verifactu_pendientes', (select count(*) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id
                                               and t.verifactu_estado in ('pendiente', 'anulacion_pendiente')))
                    order by l.active desc, l.name), '[]'::jsonb)
                  from public.locations l left join public.location_invoice_code lic on lic.location_id = l.id and lic.account_id = p_account
                  cross join lateral (select public._ticket_tramo(p_account, l.id, v_year, 'F') as tramo,
                                             public._ticket_tramo(p_account, l.id, v_year, 'R') as tramo_r) x
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
