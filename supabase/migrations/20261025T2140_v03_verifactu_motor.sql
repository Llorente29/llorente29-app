-- supabase/migrations/20261025T2140_v03_verifactu_motor.sql
--
-- V03 · Verifactu · E1 · EL MOTOR. Solo AÑADE: tablas, funciones y vistas
-- nuevas. No toca datos ni nada de lo que existe. El enganche con la factura
-- emitida (un disparador en customer_invoice) va aparte, en la 2141, que cambia
-- en caliente.
--
-- Un solo sitio para todo lo que emite: la factura a mano de Sumied (F1 y su
-- rectificativa) y las simplificadas (F2) de cualquier programa, una a una.
-- Los cierres del día NO entran (respuesta 1 de Julio, 25/10): mientras el
-- asesor no conteste, no se registran.
--
--   1. verifactu_empresa      el interruptor por empresa: apagado (de partida),
--                             pruebas o real. Real dura hasta el 31/12 de ese
--                             año (Orden HAC/1177/2024, art. 17.2) y trae su
--                             serie nueva; las de antes se cierran.
--   2. verifactu_operacion    qué tipo de venta es una factura sin IVA (la elige
--                             quien la hace, en el borrador): N2 un servicio a
--                             una empresa de fuera de la UE, E2 la mercancía
--                             que sale de España (clave 02), E5 una entrega a
--                             otro país de la UE…
--   3. verifactu_cadena       una fila por NIF y entorno: el cerrojo. Quien
--                             genera un registro la bloquea (for update), así
--                             que dos facturas emitidas a la vez no pueden coger
--                             la misma anterior.
--   4. verifactu_registro     los registros de alta y de anulación, con la huella
--                             oficial encadenada. Se escriben una vez y no se
--                             editan nunca: solo cambia su estado con Hacienda.
--   5. verifactu_envio y      los lotes enviados y el control de flujo
--      verifactu_flujo        (TiempoEsperaEnvio, que empieza en 60 s: art. 16.2).
--   6. Funciones: la huella (la misma que src/modules/conta/lib/verifactu/huella.ts,
--      medida con los ejemplos oficiales), la comprobación previa, el alta, la
--      anulación, la simplificada de otro programa, el interruptor y la cola.
--
-- Fuentes, en docs/conta/v03/E1_paso0_informe.md.

-- ── 1 · El interruptor por empresa ─────────────────────────────────────────
create table if not exists public.verifactu_empresa (
  company_id        uuid primary key references public.company(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  modo              text not null default 'apagado' check (modo in ('apagado', 'pruebas', 'real')),
  via               text not null default 'certificado' check (via in ('certificado', 'colaborador')),
  certificate_id    uuid references public.tax_certificate(id) on delete set null,
  pruebas_desde     timestamptz,
  real_desde        timestamptz,
  real_serie        text,
  real_obliga_hasta date,
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  check ((modo = 'real') = (real_desde is not null)),
  check (modo <> 'real' or (real_serie is not null and real_obliga_hasta is not null)),
  check (real_serie is null or real_serie ~ '^[A-Z0-9][A-Z0-9-]{0,9}$')
);
comment on table public.verifactu_empresa is
  'V03. Verifactu por empresa: apagado (de partida), pruebas (al entorno de pruebas de la AEAT; las facturas llevan «PRUEBA») o real. Real obliga hasta el 31/12 de ese año (Orden HAC/1177/2024, art. 17.2): no se vuelve atrás antes. Al pasar a real, una serie nueva (real_serie); las de antes se cierran y no se envían. via: con el certificado de la empresa o como colaborador social (preparada y apagada).';

-- ── 2 · Qué tipo de venta es (una factura sin IVA) ─────────────────────────
create table if not exists public.verifactu_operacion (
  invoice_id      uuid primary key references public.customer_invoice(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  calificacion    text check (calificacion in ('S1', 'S2', 'N1', 'N2')),
  exenta          text check (exenta in ('E1', 'E2', 'E3', 'E4', 'E5', 'E6')),
  clave_regimen   text not null default '01' check (clave_regimen ~ '^[0-9]{2}$'),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  check (calificacion is null or exenta is null),
  check (calificacion is not null or exenta is not null)
);
comment on table public.verifactu_operacion is
  'V03. Por qué una factura va sin IVA, para su registro de Verifactu: calificación (S2 inversión del sujeto pasivo; N1/N2 no sujeta; N2 = por reglas de localización, p. ej. un servicio a una empresa de fuera de la UE) o causa de exención (E1 art. 20; E2 exportación, con la clave 02; E5 entrega a otro país de la UE…). Se elige en el borrador; el registro la copia al emitir.';

-- ── 3 · La cadena: el cerrojo por NIF y entorno ────────────────────────────
create table if not exists public.verifactu_cadena (
  nif_emisor        text not null check (nif_emisor ~ '^[0-9A-Z]{9}$'),
  entorno           text not null check (entorno in ('pruebas', 'real')),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  ultimo_registro_id uuid,
  ultima_huella     text check (ultima_huella is null or ultima_huella ~ '^[0-9A-F]{64}$'),
  ultima_num_serie  text,
  ultima_fecha      date,
  ultimo_generado_at timestamptz,
  registros         integer not null default 0,
  primary key (nif_emisor, entorno)
);
comment on table public.verifactu_cadena is
  'V03. Una cadena por NIF y entorno (la AEAT encadena por obligado y sistema, todas las series juntas). Es el cerrojo: quien genera un registro bloquea esta fila (for update), así que dos facturas a la vez no cogen la misma anterior.';

-- ── 4 · Los registros ───────────────────────────────────────────────────────
create table if not exists public.verifactu_registro (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  entorno            text not null check (entorno in ('pruebas', 'real')),
  tipo               text not null check (tipo in ('alta', 'anulacion')),
  subsanacion        boolean not null default false,
  rechazo_previo     text check (rechazo_previo in ('N', 'S', 'X')),
  sin_registro_previo boolean not null default false,
  origen             text not null check (origen in ('factura', 'simplificada')),
  invoice_id         uuid references public.customer_invoice(id) on delete restrict,
  origen_programa    text,
  origen_ref         text,
  alta_id            uuid references public.verifactu_registro(id) on delete restrict,
  nif_emisor         text not null check (nif_emisor ~ '^[0-9A-Z]{9}$'),
  nombre_emisor      text not null,
  num_serie          text not null check (length(num_serie) between 1 and 60 and num_serie ~ '^[ !#-&(-;?-~]+$'),
  fecha_expedicion   date not null,
  fecha_operacion    date,
  tipo_factura       text check (tipo_factura in ('F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5')),
  tipo_rectificativa text check (tipo_rectificativa in ('S', 'I')),
  rectificadas       jsonb,
  descripcion        text,
  destinatarios      jsonb,
  desglose           jsonb,
  cuota_total        numeric(14,2),
  importe_total      numeric(14,2),
  primer_registro    boolean not null,
  anterior_id        uuid references public.verifactu_registro(id) on delete restrict,
  anterior_num_serie text,
  anterior_fecha     date,
  huella_anterior    text check (huella_anterior is null or huella_anterior ~ '^[0-9A-F]{64}$'),
  fecha_hora_huso    text not null check (fecha_hora_huso ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$'),
  generado_at        timestamptz not null,
  cadena_huella      text not null,
  huella             text not null check (huella ~ '^[0-9A-F]{64}$'),
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'correcto', 'aceptado_con_errores', 'incorrecto')),
  envio_id           uuid,
  intentos           integer not null default 0,
  proximo_intento_at timestamptz not null default now(),
  codigo_error       integer,
  descripcion_error  text,
  csv                text,
  respondido_at      timestamptz,
  created_by_name    text,
  check (primer_registro = (huella_anterior is null)),
  check (primer_registro or (anterior_id is not null and anterior_num_serie is not null and anterior_fecha is not null)),
  check (tipo = 'anulacion' or (tipo_factura is not null and cuota_total is not null and importe_total is not null and desglose is not null)),
  check (tipo = 'alta' or tipo_factura is null),
  check ((tipo_factura in ('R1', 'R2', 'R3', 'R4', 'R5')) = (tipo_rectificativa is not null) or tipo = 'anulacion'),
  check (origen <> 'factura' or invoice_id is not null),
  check (origen <> 'simplificada' or tipo_factura in ('F2', 'R5') or tipo = 'anulacion')
);
comment on table public.verifactu_registro is
  'V03. Los registros de Verifactu (alta y anulación), con la huella oficial encadenada (cadena_huella es exactamente lo que entra en el SHA-256). Se escriben una vez al emitir y NO se editan: solo cambian el estado con Hacienda (pendiente → enviando → correcto / aceptado_con_errores / incorrecto) y sus datos de envío. La subsanación es un registro nuevo con la misma clave y subsanacion = true.';
create index if not exists verifactu_registro_cola on public.verifactu_registro (entorno, nif_emisor, generado_at, id) where estado = 'pendiente';
create index if not exists verifactu_registro_factura on public.verifactu_registro (invoice_id, generado_at desc) where invoice_id is not null;
create index if not exists verifactu_registro_envio on public.verifactu_registro (envio_id) where envio_id is not null;
-- Una sola alta (sin subsanar) por factura y entorno; lo mismo para la anulación.
create unique index if not exists verifactu_registro_unico on public.verifactu_registro (entorno, nif_emisor, num_serie, fecha_expedicion, tipo) where not subsanacion;

-- ── 5 · Los envíos y el control de flujo ───────────────────────────────────
create table if not exists public.verifactu_envio (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete cascade,
  entorno         text not null check (entorno in ('pruebas', 'real')),
  nif_emisor      text not null,
  registros       integer not null,
  empezado_at     timestamptz not null default now(),
  terminado_at    timestamptz,
  http_status     integer,
  estado_envio    text check (estado_envio in ('Correcto', 'ParcialmenteCorrecto', 'Incorrecto', 'fallo')),
  tiempo_espera_s integer,
  csv             text,
  error           text,
  respuesta       text
);
comment on table public.verifactu_envio is
  'V03. Cada envío a la AEAT (un lote de hasta 1.000 registros de un mismo NIF): cuándo, cuántos, lo que contestó (estado del envío, CSV, TiempoEsperaEnvio) o el fallo. La respuesta se guarda recortada.';

create table if not exists public.verifactu_flujo (
  nif_emisor      text not null,
  entorno         text not null check (entorno in ('pruebas', 'real')),
  tiempo_espera_s integer not null default 60 check (tiempo_espera_s >= 0),
  ultimo_envio_at timestamptz,
  primary key (nif_emisor, entorno)
);
comment on table public.verifactu_flujo is
  'V03. El control de flujo de la AEAT por NIF (Orden HAC/1177/2024, art. 16.2): no se vuelve a enviar hasta que pasen tiempo_espera_s desde el último envío, salvo que haya 1.000 registros esperando. Cada respuesta trae el valor nuevo.';

-- ── Permisos: se lee con la cuenta; se escribe solo por funciones ──────────
alter table public.verifactu_empresa enable row level security;
alter table public.verifactu_operacion enable row level security;
alter table public.verifactu_cadena enable row level security;
alter table public.verifactu_registro enable row level security;
alter table public.verifactu_envio enable row level security;
alter table public.verifactu_flujo enable row level security;
drop policy if exists verifactu_empresa_leer on public.verifactu_empresa;
create policy verifactu_empresa_leer on public.verifactu_empresa for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists verifactu_operacion_leer on public.verifactu_operacion;
create policy verifactu_operacion_leer on public.verifactu_operacion for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists verifactu_cadena_leer on public.verifactu_cadena;
create policy verifactu_cadena_leer on public.verifactu_cadena for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists verifactu_registro_leer on public.verifactu_registro;
create policy verifactu_registro_leer on public.verifactu_registro for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists verifactu_envio_leer on public.verifactu_envio;
create policy verifactu_envio_leer on public.verifactu_envio for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.verifactu_flujo from anon, authenticated;

-- El registro no se edita ni se borra: solo su estado con Hacienda.
create or replace function public._verifactu_registro_inalterable()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un registro de Verifactu no se borra: se anula con otro registro.' using errcode = '23514';
  end if;
  if (to_jsonb(new) - array['estado', 'envio_id', 'intentos', 'proximo_intento_at', 'codigo_error', 'descripcion_error', 'csv', 'respondido_at'])
     is distinct from (to_jsonb(old) - array['estado', 'envio_id', 'intentos', 'proximo_intento_at', 'codigo_error', 'descripcion_error', 'csv', 'respondido_at']) then
    raise exception 'Un registro de Verifactu no se edita: si hay que corregir algo, va en un registro nuevo (subsanación, rectificativa o anulación).' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists verifactu_registro_inalterable on public.verifactu_registro;
create trigger verifactu_registro_inalterable before update or delete on public.verifactu_registro
  for each row execute function public._verifactu_registro_inalterable();

-- ── 6 · La huella oficial y sus formatos ───────────────────────────────────
-- Los mismos que huella.ts (v0.1.2 de la AEAT): fecha DD-MM-AAAA, importe con
-- punto y dos decimales, fecha y hora de Madrid con su huso, SHA-256 en
-- MAYÚSCULAS sobre «nombre=valor&…».
create or replace function public._verifactu_fecha(p date)
returns text language sql immutable as $$ select to_char(p, 'DD-MM-YYYY') $$;

create or replace function public._verifactu_importe(p numeric)
returns text language sql immutable as $$
  select case when round(p, 2) = 0 then '0.00' else to_char(round(p, 2), 'FM999999999999990.00') end
$$;

create or replace function public._verifactu_fecha_hora_huso(p timestamptz)
returns text language sql stable as $$
  with t as (select date_trunc('second', p) s),
       l as (select (s at time zone 'Europe/Madrid') loc, s from t),
       o as (select loc, extract(epoch from (loc - (s at time zone 'UTC')))::int segs from l)
  select to_char(loc, 'YYYY-MM-DD"T"HH24:MI:SS')
         || case when segs >= 0 then '+' else '-' end
         || lpad((abs(segs) / 3600)::text, 2, '0') || ':' || lpad(((abs(segs) % 3600) / 60)::text, 2, '0')
    from o
$$;

create or replace function public._verifactu_sha256(p text)
returns text language sql immutable as $$ select upper(encode(sha256(convert_to(p, 'UTF8')), 'hex')) $$;

create or replace function public._verifactu_cadena_alta(p_nif text, p_num_serie text, p_fecha text, p_tipo text, p_cuota text, p_importe text, p_anterior text, p_fecha_hora text)
returns text language sql immutable as $$
  select 'IDEmisorFactura=' || btrim(coalesce(p_nif, '')) || '&NumSerieFactura=' || btrim(coalesce(p_num_serie, ''))
      || '&FechaExpedicionFactura=' || btrim(coalesce(p_fecha, '')) || '&TipoFactura=' || btrim(coalesce(p_tipo, ''))
      || '&CuotaTotal=' || btrim(coalesce(p_cuota, '')) || '&ImporteTotal=' || btrim(coalesce(p_importe, ''))
      || '&Huella=' || btrim(coalesce(p_anterior, '')) || '&FechaHoraHusoGenRegistro=' || btrim(coalesce(p_fecha_hora, ''))
$$;

create or replace function public._verifactu_cadena_anulacion(p_nif text, p_num_serie text, p_fecha text, p_anterior text, p_fecha_hora text)
returns text language sql immutable as $$
  select 'IDEmisorFacturaAnulada=' || btrim(coalesce(p_nif, '')) || '&NumSerieFacturaAnulada=' || btrim(coalesce(p_num_serie, ''))
      || '&FechaExpedicionFacturaAnulada=' || btrim(coalesce(p_fecha, '')) || '&Huella=' || btrim(coalesce(p_anterior, ''))
      || '&FechaHoraHusoGenRegistro=' || btrim(coalesce(p_fecha_hora, ''))
$$;

-- «URL encoding» de la URL del QR (QR v0.5.0 §4): todo lo que no sea letra,
-- dígito, «-», «_», «.» o «~», como %XX (los valores son ASCII imprimible).
create or replace function public._verifactu_url_codificar(p text)
returns text language sql immutable as $$
  select coalesce(string_agg(case when c ~ '^[A-Za-z0-9._~-]$' then c else '%' || upper(lpad(to_hex(ascii(c)), 2, '0')) end, '' order by i), '')
    from regexp_split_to_table(coalesce(p, ''), '') with ordinality as t(c, i)
$$;

create or replace function public.verifactu_url_qr(p_entorno text, p_nif text, p_num_serie text, p_fecha date, p_importe numeric)
returns text language sql immutable as $$
  select case p_entorno when 'real' then 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR'
                        else 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR' end
      || '?nif=' || public._verifactu_url_codificar(upper(btrim(p_nif)))
      || '&numserie=' || public._verifactu_url_codificar(btrim(p_num_serie))
      || '&fecha=' || public._verifactu_fecha(p_fecha)
      || '&importe=' || public._verifactu_importe(p_importe)
$$;
comment on function public.verifactu_url_qr(text, text, text, date, numeric) is
  'V03. La URL del QR de una factura (QR v0.5.0 de la AEAT): solo nif, numserie, fecha e importe, codificados. La misma que src/modules/conta/lib/verifactu/qr.ts.';

-- ── NIF español y NIF-IVA europeo ──────────────────────────────────────────
-- El mismo algoritmo que src/modules/conta/lib/nif.ts (Orden INT/2058/2008,
-- RD 1553/2005, Orden EHA/451/2008).
create or replace function public._verifactu_nif_es_valido(p text)
returns boolean language plpgsql immutable as $$
declare
  s text := upper(regexp_replace(coalesce(p, ''), '[\s.\-_/]', '', 'g'));
  letras text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  a int := 0; b int := 0; d int; x int; c int; i int;
begin
  if left(s, 2) = 'ES' and length(s) = 11 then s := substr(s, 3); end if;
  if length(s) <> 9 then return false; end if;
  if s ~ '^\d{8}[A-Z]$' then return substr(letras, (substr(s, 1, 8)::bigint % 23)::int + 1, 1) = substr(s, 9, 1); end if;
  if s ~ '^[XYZ]\d{7}[A-Z]$' then
    return substr(letras, (((strpos('XYZ', substr(s, 1, 1)) - 1)::text || substr(s, 2, 7))::bigint % 23)::int + 1, 1) = substr(s, 9, 1);
  end if;
  if s ~ '^[KLM]\d{7}[A-Z]$' then return substr(letras, (substr(s, 2, 7)::bigint % 23)::int + 1, 1) = substr(s, 9, 1); end if;
  if s ~ '^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$' then
    for i in 1..7 loop
      d := substr(s, i + 1, 1)::int;
      if i % 2 = 0 then a := a + d; else x := d * 2; b := b + (x / 10) + (x % 10); end if;
    end loop;
    c := (10 - ((a + b) % 10)) % 10;
    if strpos('PQRSNW', substr(s, 1, 1)) > 0 then return substr(s, 9, 1) = substr('JABCDEFGHI', c + 1, 1); end if;
    if strpos('ABEH', substr(s, 1, 1)) > 0 then return substr(s, 9, 1) = c::text; end if;
    return substr(s, 9, 1) = c::text or substr(s, 9, 1) = substr('JABCDEFGHI', c + 1, 1);
  end if;
  return false;
end $$;

-- La estructura del NIF-IVA de cada Estado miembro (Validaciones v1.2.2, nota 1).
create or replace function public._verifactu_nif_iva_ue_valido(p_pais text, p_id text)
returns boolean language sql immutable as $$
  with v as (select upper(coalesce(p_pais, '')) pais,
                    regexp_replace(upper(coalesce(p_id, '')), '^' || upper(coalesce(p_pais, '')), '') n)
  select case pais
    when 'DE' then n ~ '^\d{9}$' when 'AT' then n ~ '^[0-9A-Z]{9}$' when 'BE' then n ~ '^\d{10}$'
    when 'CY' then n ~ '^[0-9A-Z]{9}$' when 'CZ' then n ~ '^\d{8,10}$' when 'HR' then n ~ '^\d{11}$'
    when 'DK' then n ~ '^\d{8}$' when 'SK' then n ~ '^\d{10}$' when 'SI' then n ~ '^\d{8}$'
    when 'EE' then n ~ '^\d{9}$' when 'FI' then n ~ '^\d{8}$' when 'FR' then n ~ '^[0-9A-Z]{11}$'
    when 'EL' then n ~ '^\d{9}$' when 'GR' then n ~ '^\d{9}$' when 'XI' then n ~ '^([0-9A-Z]{5}|[0-9A-Z]{9}|[0-9A-Z]{12})$'
    when 'NL' then n ~ '^[0-9A-Z]{12}$' when 'HU' then n ~ '^\d{8}$' when 'IT' then n ~ '^\d{11}$'
    when 'IE' then n ~ '^[0-9A-Z]{8,9}$' when 'LV' then n ~ '^\d{11}$' when 'LT' then n ~ '^(\d{9}|\d{12})$'
    when 'LU' then n ~ '^\d{8}$' when 'MT' then n ~ '^\d{8}$' when 'PL' then n ~ '^\d{10}$'
    when 'PT' then n ~ '^\d{9}$' when 'SE' then n ~ '^\d{12}$' when 'BG' then n ~ '^\d{9,10}$'
    when 'RO' then n ~ '^[1-9]\d{1,9}$'
    else false end
  from v
$$;

create or replace function public._verifactu_es_ue(p_pais text)
returns boolean language sql immutable as $$
  select upper(coalesce(p_pais, '')) in ('AT','BE','BG','CY','CZ','DE','DK','EE','EL','GR','ES','FI','FR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK','XI')
$$;

-- ── 7 · Lo que la AEAT rechazaría, dicho antes de emitir ───────────────────
-- Las reglas de «Validaciones y errores» v1.2.2 (§3.1.3) que se pueden mirar en
-- local, con el código de la lista oficial (docs/conta/v03/aeat/errores.properties)
-- y la frase en palabras de la calle. Devuelve el desglose ya calculado, o lo
-- que falta, señalando el campo. La comprobación de la pantalla y la del
-- disparador son la misma función.
create or replace function public._verifactu_desglose(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_c jsonb; v_op public.verifactu_operacion; v_t jsonb; v_r public.tax_rate;
  v_pais text; v_ue boolean; v_out jsonb := '[]'::jsonb; v_faltas jsonb := '[]'::jsonb; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_fecha_op date; v_pct numeric; v_linea jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_invoice;
  if v_f.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  v_c := case when v_f.doc_type = 'rectificativa' then public._conta_venta_diferencia(p_invoice) else public._conta_venta_cifras(p_invoice) end;
  select * into v_op from public.verifactu_operacion where invoice_id = p_invoice;
  v_pais := upper(coalesce(nullif(btrim(v_f.customer->>'pais'), ''), 'ES'));
  v_ue := public._verifactu_es_ue(v_pais);
  v_fecha_op := v_f.issue_date;

  for v_t in select * from jsonb_array_elements(coalesce(v_c->'tipos', '[]'::jsonb)) loop
    select * into v_r from public.tax_rate where id = nullif(v_t->>'tipo_id', '')::uuid;
    v_pct := coalesce((v_t->>'pct')::numeric, 0);
    if v_r.tax_system is distinct from 'iva' then
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'lineas', 'codigo_aeat', null,
        'frase', 'Una línea lleva ' || coalesce(v_r.name, 'un impuesto que no es IVA') || ': Verifactu de Sumied solo envía IVA de la península y Baleares por ahora.'));
      continue;
    end if;
    if v_r.treatment = 'taxed' and v_pct > 0 then
      -- Lista de tipos de la AEAT (§3.1.3.15.1), con sus fechas.
      if not (v_pct in (4, 10, 21, 0)
              or (v_pct = 5 and v_fecha_op between date '2022-07-01' and date '2024-09-30')
              or (v_pct in (2, 7.5) and v_fecha_op between date '2024-10-01' and date '2024-12-31')) then
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'lineas', 'codigo_aeat', 1124,
          'frase', 'El ' || to_char(v_pct, 'FM990D##') || ' % no es un tipo de IVA en vigor para el ' || to_char(v_fecha_op, 'DD/MM/YYYY') || '.'));
      end if;
      v_linea := jsonb_build_object('impuesto', '01', 'clave_regimen', coalesce(v_op.clave_regimen, '01'), 'calificacion', 'S1',
        'tipo', v_pct, 'base', (v_t->>'base')::numeric, 'cuota', (v_t->>'iva')::numeric);
      if coalesce((v_t->>'rec')::numeric, 0) <> 0 then
        v_linea := v_linea || jsonb_build_object('tipo_recargo', (v_t->>'rec_pct')::numeric, 'cuota_recargo', (v_t->>'rec')::numeric);
      end if;
      v_out := v_out || jsonb_build_array(v_linea);
    elsif v_r.treatment = 'reverse_charge' then
      v_out := v_out || jsonb_build_array(jsonb_build_object('impuesto', '01', 'clave_regimen', '01', 'calificacion', 'S2',
        'tipo', 0, 'base', (v_t->>'base')::numeric, 'cuota', 0));
    else
      -- Sin IVA (exento o al 0 %): hace falta saber por qué (tablero 27).
      if v_op.invoice_id is null or v_op.calificacion = 'S1' then
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tipo_venta', 'codigo_aeat', 1195,
          'frase', case when not v_ue then 'Es un cliente de ' || v_pais || ', fuera de la UE: dime qué le has vendido (un servicio a una empresa o mercancía que sale de España).'
                        when v_pais <> 'ES' then 'Es un cliente de otro país de la UE: dime si es una entrega de mercancía o un servicio, para saber por qué va sin IVA.'
                        else 'La factura va sin IVA: dime por qué (exenta y su causa, o no sujeta).' end));
        continue;
      end if;
      if v_op.calificacion = 'N2' and v_pais = 'ES' then
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tipo_venta', 'codigo_aeat', null,
          'frase', '«No sujeta por reglas de localización» es para un cliente de fuera de España: este es de España.'));
      end if;
      if v_op.exenta = 'E2' and v_ue then
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tipo_venta', 'codigo_aeat', null,
          'frase', 'Una exportación es una venta a fuera de la UE: este cliente es de ' || case when v_pais = 'ES' then 'España' else v_pais end || '.'));
      end if;
      if v_op.exenta = 'E5' and (not v_ue or v_pais = 'ES') then
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tipo_venta', 'codigo_aeat', null,
          'frase', 'Una entrega intracomunitaria es a otro país de la UE: este cliente es de ' || case when v_pais = 'ES' then 'España' else v_pais end || '.'));
      end if;
      if v_op.exenta in ('E2', 'E3') and coalesce(v_op.clave_regimen, '01') = '01' then
        -- §3.1.3.15.5: con la clave 01 no caben E2 ni E3; la exportación va con la 02.
        v_op.clave_regimen := '02';
      end if;
      v_linea := jsonb_build_object('impuesto', '01', 'clave_regimen', case when v_op.exenta = 'E2' then '02' else coalesce(v_op.clave_regimen, '01') end,
        'base', (v_t->>'base')::numeric);
      v_linea := v_linea || case when v_op.exenta is not null then jsonb_build_object('exenta', v_op.exenta) else jsonb_build_object('calificacion', v_op.calificacion) end;
      if v_op.calificacion = 'S2' then v_linea := v_linea || jsonb_build_object('tipo', 0, 'cuota', 0); end if;
      v_out := v_out || jsonb_build_array(v_linea);
    end if;
  end loop;

  return jsonb_build_object('desglose', v_out, 'faltas', v_faltas,
    'cuota_total', coalesce((v_c->>'iva')::numeric, 0) + coalesce((v_c->>'recargo')::numeric, 0),
    'importe_total', coalesce((v_c->>'base')::numeric, 0) + coalesce((v_c->>'iva')::numeric, 0) + coalesce((v_c->>'recargo')::numeric, 0),
    'hoy', v_hoy);
end $$;
revoke all on function public._verifactu_desglose(uuid) from public, anon, authenticated;

create or replace function public.verifactu_comprobar(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_e public.verifactu_empresa; v_emisor public.company; v_d jsonb; v_faltas jsonb;
  v_pais text; v_nif text; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  select * into v_f from public.customer_invoice where id = p_invoice;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  select * into v_e from public.verifactu_empresa where company_id = v_f.company_id;
  if v_e.company_id is null or v_e.modo = 'apagado' then
    return jsonb_build_object('va', false, 'motivo', 'apagado', 'faltas', '[]'::jsonb);
  end if;
  if v_f.origin = 'cierre_dia' then
    -- Respuesta 1 de Julio (25/10): los cierres del día no se registran mientras el asesor no conteste.
    return jsonb_build_object('va', false, 'motivo', 'cierre_dia', 'faltas', '[]'::jsonb);
  end if;
  select * into v_emisor from public.company where id = v_f.company_id;
  v_d := public._verifactu_desglose(p_invoice);
  v_faltas := v_d->'faltas';
  if not public._verifactu_nif_es_valido(v_emisor.tax_id) then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'empresa_nif', 'codigo_aeat', 4109,
      'frase', 'El NIF de tu empresa (' || coalesce(v_emisor.tax_id, 'vacío') || ') no es un NIF válido: corrígelo en Ajustes › Tu empresa.'));
  end if;
  if v_f.issue_date > v_hoy then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'fecha', 'codigo_aeat', 1112,
      'frase', 'La fecha de la factura es de un día que aún no ha llegado (' || to_char(v_f.issue_date, 'DD/MM/YYYY') || ').'));
  end if;
  if v_e.modo = 'real' and v_f.issue_date < (v_e.real_desde at time zone 'Europe/Madrid')::date then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'fecha', 'codigo_aeat', null,
      'frase', 'Verifactu está en real desde el ' || to_char(v_e.real_desde at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ': una factura nueva no puede llevar una fecha de antes.'));
  end if;
  if v_e.modo = 'real' and v_f.doc_type <> 'rectificativa' and v_f.series_code is distinct from v_e.real_serie then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'serie', 'codigo_aeat', null,
      'frase', 'La serie ' || coalesce(v_f.series_code, '—') || ' se cerró al pasar a real: las facturas nuevas van en la ' || v_e.real_serie || '.'));
  end if;
  -- El destinatario (§3.1.3.13): una completa lo lleva, con NIF español válido o la identificación de su país.
  v_pais := upper(coalesce(nullif(btrim(v_f.customer->>'pais'), ''), 'ES'));
  v_nif := upper(regexp_replace(coalesce(v_f.customer->>'nif', ''), '[\s.\-_/]', '', 'g'));
  if coalesce(btrim(v_f.customer->>'nombre'), '') = '' then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cliente', 'codigo_aeat', 1189, 'frase', 'Falta el nombre del cliente: una factura completa lo lleva.'));
  end if;
  if v_nif = '' then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cliente_nif', 'codigo_aeat', 1189, 'frase', 'Falta el NIF del cliente: una factura completa lo lleva.'));
  elsif v_pais = 'ES' and not public._verifactu_nif_es_valido(v_nif) then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cliente_nif', 'codigo_aeat', 1100,
      'frase', 'El NIF del cliente (' || v_nif || ') no es un NIF español válido: revísalo en su ficha.'));
  elsif v_pais <> 'ES' and public._verifactu_es_ue(v_pais) and not public._verifactu_nif_iva_ue_valido(v_pais, v_nif) then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cliente_nif', 'codigo_aeat', 1222,
      'frase', 'El NIF-IVA del cliente (' || v_nif || ') no tiene la forma de los de ' || v_pais || ': revísalo en su ficha.'));
  end if;
  if not exists (select 1 from jsonb_array_elements(v_d->'desglose')) and jsonb_array_length(v_faltas) = 0 then
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'lineas', 'codigo_aeat', null, 'frase', 'La factura no tiene ninguna línea que enviar.'));
  end if;
  return jsonb_build_object('va', true, 'entorno', v_e.modo, 'faltas', v_faltas, 'desglose', v_d->'desglose',
                            'cuota_total', v_d->'cuota_total', 'importe_total', v_d->'importe_total');
end $$;
revoke all on function public.verifactu_comprobar(uuid) from public, anon;
grant execute on function public.verifactu_comprobar(uuid) to authenticated;
comment on function public.verifactu_comprobar(uuid) is
  'V03. Lo que Hacienda rechazaría de esta factura, antes de emitirla: una lista de {campo, codigo_aeat, frase}. La usan la pantalla (para señalar el campo) y el disparador de la emisión (para no emitirla). va = false: no pasa por Verifactu (apagado, o un cierre del día).';

-- ── 8 · El alta y la anulación, encadenadas con el cerrojo ─────────────────
-- Un registro nuevo: bloquea su cadena (NIF + entorno), toma la anterior,
-- calcula la huella y la deja como la última. Todo en la transacción de quien
-- emite: si algo falla, no queda ni el registro ni el número.
create or replace function public._verifactu_registrar(p jsonb)
returns public.verifactu_registro language plpgsql security definer set search_path = public as $$
declare
  v_cad public.verifactu_cadena; v_reg public.verifactu_registro; v_ahora timestamptz; v_fh text; v_cadena text;
  v_nif text := upper(p->>'nif_emisor'); v_entorno text := p->>'entorno';
begin
  insert into public.verifactu_cadena (nif_emisor, entorno, account_id, company_id)
  values (v_nif, v_entorno, (p->>'account_id')::uuid, (p->>'company_id')::uuid)
  on conflict (nif_emisor, entorno) do nothing;
  select * into v_cad from public.verifactu_cadena where nif_emisor = v_nif and entorno = v_entorno for update;
  -- La hora va después de coger el cerrojo: así es siempre posterior a la del anterior.
  v_ahora := greatest(clock_timestamp(), coalesce(v_cad.ultimo_generado_at + interval '1 second', clock_timestamp()));
  v_fh := public._verifactu_fecha_hora_huso(v_ahora);
  if p->>'tipo' = 'anulacion' then
    v_cadena := public._verifactu_cadena_anulacion(v_nif, p->>'num_serie', public._verifactu_fecha((p->>'fecha_expedicion')::date), v_cad.ultima_huella, v_fh);
  else
    v_cadena := public._verifactu_cadena_alta(v_nif, p->>'num_serie', public._verifactu_fecha((p->>'fecha_expedicion')::date), p->>'tipo_factura',
                  public._verifactu_importe((p->>'cuota_total')::numeric), public._verifactu_importe((p->>'importe_total')::numeric), v_cad.ultima_huella, v_fh);
  end if;
  insert into public.verifactu_registro (account_id, company_id, entorno, tipo, subsanacion, rechazo_previo, sin_registro_previo, origen, invoice_id,
    origen_programa, origen_ref, alta_id, nif_emisor, nombre_emisor, num_serie, fecha_expedicion, fecha_operacion, tipo_factura, tipo_rectificativa,
    rectificadas, descripcion, destinatarios, desglose, cuota_total, importe_total, primer_registro, anterior_id, anterior_num_serie, anterior_fecha,
    huella_anterior, fecha_hora_huso, generado_at, cadena_huella, huella, created_by_name)
  values ((p->>'account_id')::uuid, (p->>'company_id')::uuid, v_entorno, p->>'tipo', coalesce((p->>'subsanacion')::boolean, false), p->>'rechazo_previo',
    coalesce((p->>'sin_registro_previo')::boolean, false), p->>'origen', nullif(p->>'invoice_id', '')::uuid, p->>'origen_programa', p->>'origen_ref',
    nullif(p->>'alta_id', '')::uuid, v_nif, p->>'nombre_emisor', btrim(p->>'num_serie'), (p->>'fecha_expedicion')::date, nullif(p->>'fecha_operacion', '')::date,
    p->>'tipo_factura', p->>'tipo_rectificativa', p->'rectificadas', p->>'descripcion', p->'destinatarios', p->'desglose',
    round((p->>'cuota_total')::numeric, 2), round((p->>'importe_total')::numeric, 2),
    v_cad.ultima_huella is null, v_cad.ultimo_registro_id, v_cad.ultima_num_serie, v_cad.ultima_fecha,
    v_cad.ultima_huella, v_fh, v_ahora, v_cadena, public._verifactu_sha256(v_cadena), p->>'quien')
  returning * into v_reg;
  update public.verifactu_cadena set ultimo_registro_id = v_reg.id, ultima_huella = v_reg.huella, ultima_num_serie = v_reg.num_serie,
         ultima_fecha = v_reg.fecha_expedicion, ultimo_generado_at = v_reg.generado_at, registros = registros + 1
   where nif_emisor = v_nif and entorno = v_entorno;
  return v_reg;
end $$;
revoke all on function public._verifactu_registrar(jsonb) from public, anon, authenticated;

-- El alta de una factura de Sumied (la llama el disparador de la 2141 al emitir).
create or replace function public._verifactu_alta_de_factura(p_invoice uuid, p_quien text default null)
returns public.verifactu_registro language plpgsql security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_orig public.customer_invoice; v_emisor public.company; v_k jsonb; v_pais text; v_nif text; v_dest jsonb;
  v_tipo text; v_rect jsonb; v_desc text; v_e public.verifactu_empresa;
begin
  select * into v_f from public.customer_invoice where id = p_invoice;
  v_k := public.verifactu_comprobar(p_invoice);
  if not coalesce((v_k->>'va')::boolean, false) then return null; end if;
  if jsonb_array_length(v_k->'faltas') > 0 then
    raise exception '%', (v_k->'faltas'->0->>'frase')
      using errcode = '23514', detail = (v_k->'faltas')::text, hint = 'verifactu';
  end if;
  select * into v_e from public.verifactu_empresa where company_id = v_f.company_id;
  select * into v_emisor from public.company where id = v_f.company_id;
  v_pais := upper(coalesce(nullif(btrim(v_f.customer->>'pais'), ''), 'ES'));
  v_nif := upper(regexp_replace(coalesce(v_f.customer->>'nif', ''), '[\s.\-_/]', '', 'g'));
  v_dest := jsonb_build_array(case when v_pais = 'ES'
    then jsonb_build_object('nombre', btrim(v_f.customer->>'nombre'), 'nif', regexp_replace(v_nif, '^ES', ''))
    else jsonb_build_object('nombre', btrim(v_f.customer->>'nombre'), 'codigo_pais', v_pais,
      'id_type', case when public._verifactu_es_ue(v_pais) then '02' else '04' end, 'id', v_nif) end);
  if v_f.doc_type = 'rectificativa' then
    select * into v_orig from public.customer_invoice where id = v_f.corrects_id;
    v_tipo := 'R4';  -- como el libro de la V01: rectificativa por el resto de causas (art. 80 LIVA)
    v_rect := jsonb_build_array(jsonb_build_object('nif', v_emisor.tax_id, 'num_serie', v_orig.number_text, 'fecha', v_orig.issue_date));
  else
    v_tipo := 'F1';
  end if;
  select left(string_agg(concept, ' · ' order by position), 500) into v_desc from public.customer_invoice_line where invoice_id = p_invoice;
  return public._verifactu_registrar(jsonb_build_object(
    'account_id', v_f.account_id, 'company_id', v_f.company_id, 'entorno', v_e.modo, 'tipo', 'alta', 'origen', 'factura', 'invoice_id', v_f.id,
    'nif_emisor', regexp_replace(upper(v_emisor.tax_id), '^ES', ''), 'nombre_emisor', coalesce(v_emisor.legal_name, v_emisor.trade_name),
    'num_serie', v_f.number_text, 'fecha_expedicion', v_f.issue_date, 'tipo_factura', v_tipo,
    'tipo_rectificativa', case when v_tipo like 'R%' then 'I' end, 'rectificadas', v_rect,
    'descripcion', coalesce(nullif(v_f.correction_reason, ''), v_desc, 'Factura ' || v_f.number_text),
    'destinatarios', v_dest, 'desglose', v_k->'desglose', 'cuota_total', v_k->'cuota_total', 'importe_total', v_k->'importe_total',
    'quien', coalesce(p_quien, v_f.issued_by_name)));
end $$;
revoke all on function public._verifactu_alta_de_factura(uuid, text) from public, anon, authenticated;

-- El registro de anulación de un alta (E3 le pondrá su botón: «No tenía que haberla emitido»).
create or replace function public._verifactu_anular(p_alta uuid, p_quien text default null)
returns public.verifactu_registro language plpgsql security definer set search_path = public as $$
declare v_a public.verifactu_registro;
begin
  select * into v_a from public.verifactu_registro where id = p_alta;
  if v_a.id is null or v_a.tipo <> 'alta' then raise exception 'Ese registro de alta no está.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.verifactu_registro where tipo = 'anulacion' and entorno = v_a.entorno and nif_emisor = v_a.nif_emisor
                and num_serie = v_a.num_serie and fecha_expedicion = v_a.fecha_expedicion and not subsanacion) then
    raise exception 'La factura % ya tiene su registro de anulación.', v_a.num_serie using errcode = '23505';
  end if;
  return public._verifactu_registrar(jsonb_build_object(
    'account_id', v_a.account_id, 'company_id', v_a.company_id, 'entorno', v_a.entorno, 'tipo', 'anulacion', 'origen', v_a.origen,
    'invoice_id', v_a.invoice_id, 'origen_programa', v_a.origen_programa, 'origen_ref', v_a.origen_ref, 'alta_id', v_a.id,
    'nif_emisor', v_a.nif_emisor, 'nombre_emisor', v_a.nombre_emisor, 'num_serie', v_a.num_serie, 'fecha_expedicion', v_a.fecha_expedicion,
    'quien', p_quien));
end $$;
revoke all on function public._verifactu_anular(uuid, text) from public, anon, authenticated;

-- ── 9 · Una simplificada (F2) de cualquier programa, una a una ─────────────
-- Para el TPV de Folvy cuando se retome, y para cualquier otro que factura por
-- la empresa. Trae su número (el de su serie); Sumied le da huella y QR.
--   p_datos: {num_serie, fecha (AAAA-MM-DD), descripcion, programa, ref,
--             lineas: [{base, tipo, cuota, tipo_recargo?, cuota_recargo?}]}
create or replace function public.verifactu_simplificada(p_company uuid, p_datos jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_co public.company; v_e public.verifactu_empresa; v_l jsonb; v_desglose jsonb := '[]'::jsonb; v_cuota numeric := 0; v_total numeric := 0;
  v_reg public.verifactu_registro; v_fecha date; v_serie text := btrim(coalesce(p_datos->>'num_serie', '')); v_pct numeric;
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_co.account_id) then raise exception 'Solo un administrador o un encargado de la cuenta registra facturas.' using errcode = '42501'; end if;
  select * into v_e from public.verifactu_empresa where company_id = p_company;
  if v_e.company_id is null or v_e.modo = 'apagado' then raise exception 'Verifactu está apagado en %: actívalo en Ajustes › Facturación › Verifactu.', coalesce(v_co.trade_name, v_co.legal_name) using errcode = '23514'; end if;
  if v_serie = '' then raise exception 'Falta el número del tique.' using errcode = '23514'; end if;
  if v_serie !~ '^[ !#-&(-;?-~]{1,60}$' then raise exception 'El número del tique («%») lleva caracteres que Hacienda no admite o pasa de 60.', v_serie using errcode = '23514'; end if;
  v_fecha := (p_datos->>'fecha')::date;
  if v_fecha > (now() at time zone 'Europe/Madrid')::date then raise exception 'La fecha del tique es de un día que aún no ha llegado.' using errcode = '23514'; end if;
  if jsonb_array_length(coalesce(p_datos->'lineas', '[]'::jsonb)) = 0 then raise exception 'El tique no tiene líneas.' using errcode = '23514'; end if;
  for v_l in select * from jsonb_array_elements(p_datos->'lineas') loop
    v_pct := (v_l->>'tipo')::numeric;
    if not (v_pct in (0, 4, 10, 21) or (v_pct = 5 and v_fecha between date '2022-07-01' and date '2024-09-30')
            or (v_pct in (2, 7.5) and v_fecha between date '2024-10-01' and date '2024-12-31')) then
      raise exception 'El % %% no es un tipo de IVA en vigor para el %.', to_char(v_pct, 'FM990D##'), to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    if abs((v_l->>'cuota')::numeric - round((v_l->>'base')::numeric * v_pct / 100, 2)) > 10 then
      raise exception 'La cuota de una línea no cuadra con su base y su tipo (Hacienda admite ±10 €).' using errcode = '23514';
    end if;
    v_desglose := v_desglose || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('impuesto', '01', 'clave_regimen', '01', 'calificacion', 'S1',
      'tipo', v_pct, 'base', (v_l->>'base')::numeric, 'cuota', (v_l->>'cuota')::numeric,
      'tipo_recargo', (v_l->>'tipo_recargo')::numeric, 'cuota_recargo', (v_l->>'cuota_recargo')::numeric)));
    v_cuota := v_cuota + (v_l->>'cuota')::numeric + coalesce((v_l->>'cuota_recargo')::numeric, 0);
    v_total := v_total + (v_l->>'base')::numeric + (v_l->>'cuota')::numeric + coalesce((v_l->>'cuota_recargo')::numeric, 0);
  end loop;
  -- §3.1.3.15.8 (código 1150): una simplificada no pasa de 3.000 € (±10 €).
  if v_total > 3010 then raise exception 'Un tique no puede pasar de 3.000 €: haz una factura completa.' using errcode = '23514'; end if;
  v_reg := public._verifactu_registrar(jsonb_build_object(
    'account_id', v_co.account_id, 'company_id', v_co.id, 'entorno', v_e.modo, 'tipo', 'alta', 'origen', 'simplificada',
    'origen_programa', coalesce(p_datos->>'programa', 'otro'), 'origen_ref', p_datos->>'ref',
    'nif_emisor', regexp_replace(upper(v_co.tax_id), '^ES', ''), 'nombre_emisor', coalesce(v_co.legal_name, v_co.trade_name),
    'num_serie', v_serie, 'fecha_expedicion', v_fecha, 'tipo_factura', 'F2',
    'descripcion', coalesce(nullif(btrim(p_datos->>'descripcion'), ''), 'Venta'), 'desglose', v_desglose,
    'cuota_total', v_cuota, 'importe_total', v_total, 'quien', coalesce(p_quien_nombre, public.conta_nombre_actor())));
  return jsonb_build_object('id', v_reg.id, 'huella', v_reg.huella, 'entorno', v_reg.entorno,
    'qr', public.verifactu_url_qr(v_reg.entorno, v_reg.nif_emisor, v_reg.num_serie, v_reg.fecha_expedicion, v_reg.importe_total));
end $$;
revoke all on function public.verifactu_simplificada(uuid, jsonb, text) from public, anon;
grant execute on function public.verifactu_simplificada(uuid, jsonb, text) to authenticated;
comment on function public.verifactu_simplificada(uuid, jsonb, text) is
  'V03. Registra una factura simplificada (F2) de cualquier programa de la empresa, una a una, con su número: huella encadenada, a la cola, y devuelve el QR. Para el TPV de Folvy cuando se retome.';

-- ── 10 · El interruptor ─────────────────────────────────────────────────────
-- apagado ↔ pruebas, cuando se quiera. A real, una sola vez y escrito: con la
-- palabra EMPEZAR (tablero 25) y una serie nueva, que no tenga ninguna factura.
-- Desde ese momento: no se vuelve a pruebas ni se apaga hasta el 31/12 de ese
-- año (Orden HAC/1177/2024, art. 17.2), y las series de antes se cierran.
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

-- Qué tipo de venta es una factura sin IVA (en el borrador; la pantalla del tablero 27 la pone).
create or replace function public.verifactu_operacion_poner(p_invoice uuid, p_calificacion text, p_exenta text, p_clave_regimen text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.customer_invoice;
begin
  select * into v_f from public.customer_invoice where id = p_invoice;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then raise exception 'Solo un administrador o un encargado de la cuenta cambia facturas.' using errcode = '42501'; end if;
  if v_f.status <> 'borrador' then raise exception 'La % ya está emitida: lo que cambie va en una subsanación o una rectificativa.', v_f.number_text using errcode = '23514'; end if;
  if p_calificacion is null and p_exenta is null then
    delete from public.verifactu_operacion where invoice_id = p_invoice;
    return jsonb_build_object('id', p_invoice, 'quitado', true);
  end if;
  insert into public.verifactu_operacion (invoice_id, account_id, company_id, calificacion, exenta, clave_regimen, updated_by_name)
  values (p_invoice, v_f.account_id, v_f.company_id, p_calificacion, p_exenta,
          coalesce(p_clave_regimen, case when p_exenta = 'E2' then '02' else '01' end), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  on conflict (invoice_id) do update set calificacion = excluded.calificacion, exenta = excluded.exenta, clave_regimen = excluded.clave_regimen,
         updated_at = now(), updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('id', p_invoice, 'calificacion', p_calificacion, 'exenta', p_exenta);
end $$;
revoke all on function public.verifactu_operacion_poner(uuid, text, text, text, text) from public, anon;
grant execute on function public.verifactu_operacion_poner(uuid, text, text, text, text) to authenticated;

-- ── 11 · La cola (solo la función de envío, con la clave de servicio) ──────
-- Tomar: el primer NIF del entorno con registros pendientes y el flujo abierto
-- (pasó TiempoEsperaEnvio desde su último envío, o ya hay 1.000 esperando). Se
-- marcan «enviando» en el orden de la cadena y se abre su envío.
create or replace function public.verifactu_cola_tomar(p_entorno text, p_max integer default 1000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nif text; v_envio uuid; v_cuenta uuid; v_empresa uuid; v_ids uuid[]; v_n int;
begin
  select r.nif_emisor into v_nif
    from public.verifactu_registro r
    left join public.verifactu_flujo f on f.nif_emisor = r.nif_emisor and f.entorno = r.entorno
   where r.entorno = p_entorno and r.estado = 'pendiente' and r.proximo_intento_at <= now()
   group by r.nif_emisor, f.ultimo_envio_at, f.tiempo_espera_s
  having f.ultimo_envio_at is null or f.ultimo_envio_at + make_interval(secs => coalesce(f.tiempo_espera_s, 60)) <= now() or count(*) >= 1000
   order by min(r.generado_at) limit 1;
  if v_nif is null then return null; end if;
  select array_agg(id order by generado_at, id), (array_agg(account_id))[1], (array_agg(company_id))[1] into v_ids, v_cuenta, v_empresa
    from (select id, account_id, company_id, generado_at from public.verifactu_registro
           where entorno = p_entorno and nif_emisor = v_nif and estado = 'pendiente' and proximo_intento_at <= now()
           order by generado_at, id limit least(greatest(coalesce(p_max, 1000), 1), 1000) for update skip locked) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return null; end if;
  insert into public.verifactu_envio (account_id, company_id, entorno, nif_emisor, registros) values (v_cuenta, v_empresa, p_entorno, v_nif, v_n) returning id into v_envio;
  update public.verifactu_registro set estado = 'enviando', envio_id = v_envio, intentos = intentos + 1 where id = any(v_ids);
  insert into public.verifactu_flujo (nif_emisor, entorno, ultimo_envio_at) values (v_nif, p_entorno, now())
  on conflict (nif_emisor, entorno) do update set ultimo_envio_at = now();
  return jsonb_build_object('envio_id', v_envio, 'entorno', p_entorno, 'nif_emisor', v_nif, 'company_id', v_empresa,
    'registros', (select jsonb_agg(to_jsonb(r) order by r.generado_at, r.id) from public.verifactu_registro r where r.id = any(v_ids)));
end $$;
revoke all on function public.verifactu_cola_tomar(text, integer) from public, anon, authenticated;

-- Lo que contestó Hacienda: cada registro con su estado, su código y su texto;
-- el envío con el suyo, el CSV y el TiempoEsperaEnvio nuevo.
--   p: {http_status, estado_envio, tiempo_espera_s, csv, respuesta,
--       registros: [{id, estado (Correcto|AceptadoConErrores|Incorrecto), codigo, descripcion}]}
create or replace function public.verifactu_cola_respuesta(p_envio uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.verifactu_envio; v_x jsonb; v_n int := 0; v_sin int;
begin
  select * into v_e from public.verifactu_envio where id = p_envio for update;
  if v_e.id is null then raise exception 'Ese envío no está.' using errcode = 'P0002'; end if;
  update public.verifactu_envio set terminado_at = now(), http_status = (p->>'http_status')::int, estado_envio = p->>'estado_envio',
         tiempo_espera_s = (p->>'tiempo_espera_s')::int, csv = p->>'csv', respuesta = left(p->>'respuesta', 20000)
   where id = p_envio;
  for v_x in select * from jsonb_array_elements(coalesce(p->'registros', '[]'::jsonb)) loop
    update public.verifactu_registro set
           estado = case v_x->>'estado' when 'Correcto' then 'correcto' when 'AceptadoConErrores' then 'aceptado_con_errores' else 'incorrecto' end,
           codigo_error = nullif(v_x->>'codigo', '')::int, descripcion_error = nullif(v_x->>'descripcion', ''),
           csv = p->>'csv', respondido_at = now()
     where id = (v_x->>'id')::uuid and envio_id = p_envio;
    v_n := v_n + 1;
  end loop;
  -- Lo que no vino en la respuesta vuelve a la cola (no se da nada por enviado sin su respuesta).
  update public.verifactu_registro set estado = 'pendiente', proximo_intento_at = now() + interval '1 minute'
   where envio_id = p_envio and estado = 'enviando';
  get diagnostics v_sin = row_count;
  if (p->>'tiempo_espera_s') is not null then
    insert into public.verifactu_flujo (nif_emisor, entorno, tiempo_espera_s, ultimo_envio_at) values (v_e.nif_emisor, v_e.entorno, (p->>'tiempo_espera_s')::int, v_e.empezado_at)
    on conflict (nif_emisor, entorno) do update set tiempo_espera_s = excluded.tiempo_espera_s;
  end if;
  return jsonb_build_object('envio_id', p_envio, 'registros', v_n, 'vuelven_a_la_cola', v_sin);
end $$;
revoke all on function public.verifactu_cola_respuesta(uuid, jsonb) from public, anon, authenticated;

-- No se pudo enviar (sin conexión, tiempo agotado…): vuelven a la cola. Se
-- reintenta antes cuanto menos se ha intentado, y nunca más tarde de una hora
-- (Orden HAC/1177/2024, art. 16.4: «al menos una vez cada hora»).
create or replace function public.verifactu_cola_fallo(p_envio uuid, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.verifactu_envio set terminado_at = now(), estado_envio = 'fallo', error = left(p_error, 2000) where id = p_envio;
  update public.verifactu_registro set estado = 'pendiente',
         proximo_intento_at = now() + least(interval '60 minutes', make_interval(mins => power(2, least(intentos, 6))::int))
   where envio_id = p_envio and estado = 'enviando';
  get diagnostics v_n = row_count;
  return jsonb_build_object('envio_id', p_envio, 'vuelven_a_la_cola', v_n);
end $$;
revoke all on function public.verifactu_cola_fallo(uuid, text) from public, anon, authenticated;

-- ── 12 · Lo que se ve: el estado de cada factura con Hacienda ──────────────
-- La columna «Hacienda» del tablero 26 la lee de aquí (E2). Una factura sin
-- registro: «no_se_envia» (anterior a pasar a real, traída de Diez, cierre del
-- día o con Verifactu apagado).
create or replace view public.verifactu_factura_estado with (security_invoker = true) as
select ci.id as invoice_id, ci.account_id, ci.company_id,
       coalesce(r.estado, 'no_se_envia') as estado, r.entorno, r.id as registro_id, r.huella, r.codigo_error, r.descripcion_error,
       r.generado_at, r.respondido_at, r.intentos, r.proximo_intento_at,
       case when r.id is not null then public.verifactu_url_qr(r.entorno, r.nif_emisor, r.num_serie, r.fecha_expedicion, r.importe_total) end as url_qr
  from public.customer_invoice ci
  left join lateral (select * from public.verifactu_registro x where x.invoice_id = ci.id order by x.generado_at desc limit 1) r on true
 where ci.status <> 'borrador';
comment on view public.verifactu_factura_estado is
  'V03. El estado de cada emitida con Hacienda (el último registro de su factura): pendiente, enviando, correcto, aceptado_con_errores, incorrecto o no_se_envia; y la URL de su QR.';

-- Lo que lleva demasiado tiempo sin enviarse (más de una hora en la cola): el aviso.
create or replace view public.verifactu_atascados with (security_invoker = true) as
select r.account_id, r.company_id, r.entorno, r.nif_emisor, count(*) as registros, min(r.generado_at) as desde, max(r.intentos) as intentos
  from public.verifactu_registro r
 where r.estado in ('pendiente', 'enviando') and r.generado_at < now() - interval '1 hour'
 group by r.account_id, r.company_id, r.entorno, r.nif_emisor;
comment on view public.verifactu_atascados is
  'V03. Registros que llevan más de una hora sin llegar a Hacienda, por empresa y entorno. Lo vigila la función de envío y avisa.';
