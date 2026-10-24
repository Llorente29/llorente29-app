-- supabase/migrations/20261122T0100_i01_plazos.sql
--
-- I01a · 1 · LOS PLAZOS DE HACIENDA, CALCULADOS Y NUNCA ESCRITOS A MANO.
-- Solo añade: tres tablas de catálogo (sin account_id, se leen enteras a
-- propósito, como tax_form) y tres funciones nuevas. No toca nada que exista.
--
--   1. tax_holiday_year / tax_holiday: los festivos por año y ámbito, sacados
--      del BOE por scripts/conta/i01/festivos.mjs (el bloque de abajo). Ámbitos:
--        · ES    · fiestas nacionales del art. 45.1 del RD 2001/1983 (las que
--                  la tabla del BOE marca * o ** en alguna comunidad);
--        · ES-MD · la columna de la Comunidad de Madrid.
--      Un año sin cargar NO da fecha: la función para y lo dice. 2027 entra
--      provisional (falta el BOCM) y la fecha lo dice.
--   2. tax_form_deadline: la regla de plazo de cada modelo y periodo, con su
--      norma. Es la única fuente de los plazos: ninguna fecha está escrita.
--   3. conta_impuesto_plazo(modelo, cadencia, ejercicio, periodo, ámbito):
--        · presentación: el día de la regla; si es inhábil para la empresa
--          (sábado, domingo o festivo de su ámbito), el primer hábil siguiente;
--        · domiciliación (solo los modelos con ingreso del anexo II de la Orden
--          EHA/1658/2009): el último día hábil que deja exactamente 3 días
--          hábiles hasta el último día de presentación, incluido (art. 3.2.b,
--          redacción de la Orden HAC/241/2025, decisión de Julio del 17/10).
--          Inhábiles para esto: sábados, domingos, fiestas nacionales y de la
--          Comunidad de Madrid (donde está el Departamento de Informática de la
--          AEAT); se cuenta desde el último día de presentación con ESE
--          calendario, el del plazo genérico. Reproduce las 14 fechas de
--          domiciliación del calendario de la AEAT de 2026 (prueba de staging).
--
-- Lo que no hace (dicho): los festivos locales (la AEAT no cuenta San Isidro:
-- el 15/05/2026 es último día de domiciliación del 111 de abril); el 200 de un
-- ejercicio que no es el año natural; el 349 mensual (la regla de julio y
-- diciembre no está leída en su orden).

-- ── Festivos ────────────────────────────────────────────────────────────────
create table if not exists public.tax_holiday_year (
  year                int not null check (year between 2000 and 2100),
  scope               text not null check (scope ~ '^ES(-[A-Z]{2})?$'),
  source_key          text not null references public.official_source(key),
  provisional_reason  text,
  primary key (year, scope)
);
comment on table public.tax_holiday_year is
  'I01a. Años con festivos cargados, por ámbito (ES nacional, ES-MD Comunidad de Madrid), con su fuente. provisional_reason: lo que falta para darlos por buenos (null = definitivos).';

create table if not exists public.tax_holiday (
  day         date not null,
  scope       text not null check (scope ~ '^ES(-[A-Z]{2})?$'),
  name        text not null,
  source_key  text not null references public.official_source(key),
  primary key (day, scope)
);
comment on table public.tax_holiday is
  'I01a. Festivos que mueven los plazos de Hacienda. ES: fiestas nacionales del art. 45.1 del RD 2001/1983 (aunque una comunidad las sustituya). ES-MD: los que no se trabaja en la Comunidad de Madrid. Del BOE, por scripts/conta/i01/festivos.mjs.';

-- ── Reglas de plazo ─────────────────────────────────────────────────────────
-- period '*' = cualquier periodo de esa cadencia que no tenga fila propia.
-- months_after: meses tras el último mes del periodo; day null = último día del mes.
create table if not exists public.tax_form_deadline (
  form_code     text not null references public.tax_form(code),
  cadence       text not null check (cadence in ('quarterly', 'monthly', 'annual', 'instalments_202')),
  period        text not null check (period ~ '^(\*|[1-4]T|0[1-9]|1[0-2]|0A|[1-3]P)$'),
  months_after  smallint not null check (months_after between 1 and 12),
  day           smallint check (day between 1 and 31),
  direct_debit  boolean not null,
  legal_ref     text not null,
  primary key (form_code, cadence, period)
);
comment on table public.tax_form_deadline is
  'I01a. Plazo de presentación de cada modelo y periodo, con su norma: meses tras el último mes del periodo y día (null = último del mes). direct_debit: tiene ingreso domiciliable (Orden EHA/1658/2009, anexo II).';

do $$
begin
  perform 1 from public.tax_form where code in ('303', '390', '111', '115', '190', '180', '347', '349', '202', '200') having count(*) = 10;
  if not found then raise exception 'Faltan modelos en tax_form: los plazos se cuelgan de ellos.'; end if;
end $$;

insert into public.tax_form_deadline (form_code, cadence, period, months_after, day, direct_debit, legal_ref) values
  ('303', 'quarterly', '*',  1, 20,   true,  'RIVA (RD 1624/1992), art. 71.4: del 1 al 20 de abril, julio y octubre'),
  ('303', 'quarterly', '4T', 1, 30,   true,  'RIVA (RD 1624/1992), art. 71.4: el cuarto trimestre, del 1 al 30 de enero'),
  ('303', 'monthly',    '*',  1, 30,   true,  'RIVA (RD 1624/1992), art. 71.4: los 30 primeros días del mes siguiente'),
  ('303', 'monthly',    '01', 1, null, true,  'RIVA (RD 1624/1992), art. 71.4: la de enero, hasta el último día de febrero'),
  ('390', 'annual',      '0A', 1, 30,   false, 'Orden EHA/3111/2009: del 1 al 30 de enero'),
  ('111', 'quarterly', '*',  1, 20,   true,  'RIRPF (RD 439/2007), art. 108.1: los 20 primeros días de abril, julio, octubre y enero'),
  ('111', 'monthly',    '*',  1, 20,   true,  'RIRPF (RD 439/2007), art. 108.1: los 20 primeros días del mes siguiente'),
  ('115', 'quarterly', '*',  1, 20,   true,  'RIRPF (RD 439/2007), art. 108.1: los 20 primeros días de abril, julio, octubre y enero'),
  ('115', 'monthly',    '*',  1, 20,   true,  'RIRPF (RD 439/2007), art. 108.1: los 20 primeros días del mes siguiente'),
  ('190', 'annual',      '0A', 1, 31,   false, 'RIRPF (RD 439/2007), art. 108.2: del 1 al 31 de enero'),
  ('180', 'annual',      '0A', 1, 31,   false, 'RIRPF (RD 439/2007), art. 108.2: del 1 al 31 de enero'),
  ('347', 'annual',      '0A', 2, null, false, 'Orden EHA/3012/2008: el mes de febrero'),
  ('349', 'quarterly', '*',  1, 20,   false, 'RIVA, art. 81; Orden EHA/769/2010: los 20 primeros días del mes siguiente al trimestre'),
  ('349', 'quarterly', '4T', 1, 30,   false, 'RIVA, art. 81; Orden EHA/769/2010: el cuarto trimestre, del 1 al 30 de enero'),
  ('202', 'instalments_202', '1P', 1, 20, true, 'Ley 27/2014 (LIS), art. 40.1: los 20 primeros días de abril'),
  ('202', 'instalments_202', '2P', 1, 20, true, 'Ley 27/2014 (LIS), art. 40.1: los 20 primeros días de octubre'),
  ('202', 'instalments_202', '3P', 1, 20, true, 'Ley 27/2014 (LIS), art. 40.1: los 20 primeros días de diciembre'),
  ('200', 'annual',      '0A', 7, 25,   true,  'Ley 27/2014 (LIS), art. 124.1: los 25 días naturales siguientes a los 6 meses del cierre (año natural: del 1 al 25 de julio)')
on conflict (form_code, cadence, period) do nothing;

-- festivos: desde aquí lo escribe scripts/conta/i01/festivos.mjs (no se toca a mano)
insert into public.official_source (key, name, url, sha256, downloaded_at) values ('boe-fiestas-laborales-2026', 'Resolución de 17 de octubre de 2025, de la Dirección General de Trabajo, por la que se publica la relación de fiestas laborales para el año 2026.', 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-21667', 'f85e22b21de215dafdc2491eab6a535b0c92e744c8d2ae79d3d4c0532c9770e0', '2026-10-17T20:34:06.235Z')
  on conflict (key) do nothing;
insert into public.tax_holiday_year (year, scope, source_key, provisional_reason) values (2026, 'ES', 'boe-fiestas-laborales-2026', null)
  on conflict (year, scope) do nothing;
insert into public.tax_holiday_year (year, scope, source_key, provisional_reason) values (2026, 'ES-MD', 'boe-fiestas-laborales-2026', null)
  on conflict (year, scope) do nothing;
insert into public.tax_holiday (day, scope, name, source_key) values
  ('2026-01-01', 'ES', 'Año Nuevo', 'boe-fiestas-laborales-2026'),
  ('2026-01-01', 'ES-MD', 'Año Nuevo', 'boe-fiestas-laborales-2026'),
  ('2026-01-06', 'ES', 'Epifanía del Señor', 'boe-fiestas-laborales-2026'),
  ('2026-01-06', 'ES-MD', 'Epifanía del Señor', 'boe-fiestas-laborales-2026'),
  ('2026-03-19', 'ES', 'San José', 'boe-fiestas-laborales-2026'),
  ('2026-04-02', 'ES', 'Jueves Santo', 'boe-fiestas-laborales-2026'),
  ('2026-04-02', 'ES-MD', 'Jueves Santo', 'boe-fiestas-laborales-2026'),
  ('2026-04-03', 'ES', 'Viernes Santo', 'boe-fiestas-laborales-2026'),
  ('2026-04-03', 'ES-MD', 'Viernes Santo', 'boe-fiestas-laborales-2026'),
  ('2026-05-01', 'ES', 'Fiesta del Trabajo', 'boe-fiestas-laborales-2026'),
  ('2026-05-01', 'ES-MD', 'Fiesta del Trabajo', 'boe-fiestas-laborales-2026'),
  ('2026-05-02', 'ES-MD', 'Fiesta de la Comunidad de Madrid', 'boe-fiestas-laborales-2026'),
  ('2026-07-25', 'ES', 'Santiago Apóstol/Día Nacional de Galicia', 'boe-fiestas-laborales-2026'),
  ('2026-08-15', 'ES', 'Asunción de la Virgen', 'boe-fiestas-laborales-2026'),
  ('2026-08-15', 'ES-MD', 'Asunción de la Virgen', 'boe-fiestas-laborales-2026'),
  ('2026-10-12', 'ES', 'Fiesta Nacional de España', 'boe-fiestas-laborales-2026'),
  ('2026-10-12', 'ES-MD', 'Fiesta Nacional de España', 'boe-fiestas-laborales-2026'),
  ('2026-11-02', 'ES', 'Día siguiente a Todos los Santos', 'boe-fiestas-laborales-2026'),
  ('2026-11-02', 'ES-MD', 'Día siguiente a Todos los Santos', 'boe-fiestas-laborales-2026'),
  ('2026-12-07', 'ES', 'Lunes siguiente al Día de la Constitución Española', 'boe-fiestas-laborales-2026'),
  ('2026-12-07', 'ES-MD', 'Lunes siguiente al Día de la Constitución Española', 'boe-fiestas-laborales-2026'),
  ('2026-12-08', 'ES', 'Inmaculada Concepción', 'boe-fiestas-laborales-2026'),
  ('2026-12-08', 'ES-MD', 'Inmaculada Concepción', 'boe-fiestas-laborales-2026'),
  ('2026-12-25', 'ES', 'Natividad del Señor', 'boe-fiestas-laborales-2026'),
  ('2026-12-25', 'ES-MD', 'Natividad del Señor', 'boe-fiestas-laborales-2026')
  on conflict (day, scope) do nothing;
insert into public.official_source (key, name, url, sha256, downloaded_at) values ('boe-fiestas-laborales-2027', 'Resolución de 8 de octubre de 2026, de la Dirección General de Trabajo, por la que se publica relación de fiestas laborales para el año 2027.', 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-21254', '2e8c47e795d370466bdfe4372d5a6789a1dcd906b68218da8d1b5569a992eb48', '2026-10-17T20:34:07.094Z')
  on conflict (key) do nothing;
insert into public.tax_holiday_year (year, scope, source_key, provisional_reason) values (2027, 'ES', 'boe-fiestas-laborales-2027', 'Publicado el BOE (BOE-A-2026-21254); falta cotejarlo con el calendario de la Comunidad de Madrid en el BOCM.')
  on conflict (year, scope) do nothing;
insert into public.tax_holiday_year (year, scope, source_key, provisional_reason) values (2027, 'ES-MD', 'boe-fiestas-laborales-2027', 'Publicado el BOE (BOE-A-2026-21254); falta cotejarlo con el calendario de la Comunidad de Madrid en el BOCM.')
  on conflict (year, scope) do nothing;
insert into public.tax_holiday (day, scope, name, source_key) values
  ('2027-01-01', 'ES', 'Año Nuevo', 'boe-fiestas-laborales-2027'),
  ('2027-01-01', 'ES-MD', 'Año Nuevo', 'boe-fiestas-laborales-2027'),
  ('2027-01-06', 'ES', 'Epifanía del Señor', 'boe-fiestas-laborales-2027'),
  ('2027-01-06', 'ES-MD', 'Epifanía del Señor', 'boe-fiestas-laborales-2027'),
  ('2027-03-19', 'ES', 'San José', 'boe-fiestas-laborales-2027'),
  ('2027-03-19', 'ES-MD', 'San José', 'boe-fiestas-laborales-2027'),
  ('2027-03-25', 'ES', 'Jueves Santo', 'boe-fiestas-laborales-2027'),
  ('2027-03-25', 'ES-MD', 'Jueves Santo', 'boe-fiestas-laborales-2027'),
  ('2027-03-26', 'ES', 'Viernes Santo', 'boe-fiestas-laborales-2027'),
  ('2027-03-26', 'ES-MD', 'Viernes Santo', 'boe-fiestas-laborales-2027'),
  ('2027-05-01', 'ES', 'Fiesta del Trabajo', 'boe-fiestas-laborales-2027'),
  ('2027-05-01', 'ES-MD', 'Fiesta del Trabajo', 'boe-fiestas-laborales-2027'),
  ('2027-08-16', 'ES', 'Lunes siguiente a asunción de la Virgen', 'boe-fiestas-laborales-2027'),
  ('2027-08-16', 'ES-MD', 'Lunes siguiente a asunción de la Virgen', 'boe-fiestas-laborales-2027'),
  ('2027-10-12', 'ES', 'Fiesta Nacional de España', 'boe-fiestas-laborales-2027'),
  ('2027-10-12', 'ES-MD', 'Fiesta Nacional de España', 'boe-fiestas-laborales-2027'),
  ('2027-11-01', 'ES', 'Todos los Santos', 'boe-fiestas-laborales-2027'),
  ('2027-11-01', 'ES-MD', 'Todos los Santos', 'boe-fiestas-laborales-2027'),
  ('2027-12-06', 'ES', 'Día de la Constitución Española', 'boe-fiestas-laborales-2027'),
  ('2027-12-06', 'ES-MD', 'Día de la Constitución Española', 'boe-fiestas-laborales-2027'),
  ('2027-12-08', 'ES', 'Inmaculada Concepción', 'boe-fiestas-laborales-2027'),
  ('2027-12-08', 'ES-MD', 'Inmaculada Concepción', 'boe-fiestas-laborales-2027'),
  ('2027-12-25', 'ES', 'Natividad del Señor', 'boe-fiestas-laborales-2027'),
  ('2027-12-25', 'ES-MD', 'Natividad del Señor', 'boe-fiestas-laborales-2027')
  on conflict (day, scope) do nothing;
-- festivos: hasta aquí

-- ── Lectura para todos (catálogos), escritura solo por migración ────────────
alter table public.tax_holiday_year enable row level security;
alter table public.tax_holiday enable row level security;
alter table public.tax_form_deadline enable row level security;
drop policy if exists tax_holiday_year_select on public.tax_holiday_year;
create policy tax_holiday_year_select on public.tax_holiday_year for select to authenticated using (true);
drop policy if exists tax_holiday_select on public.tax_holiday;
create policy tax_holiday_select on public.tax_holiday for select to authenticated using (true);
drop policy if exists tax_form_deadline_select on public.tax_form_deadline;
create policy tax_form_deadline_select on public.tax_form_deadline for select to authenticated using (true);
grant select on table public.tax_holiday_year, public.tax_holiday, public.tax_form_deadline to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.tax_holiday_year, public.tax_holiday, public.tax_form_deadline to conta_lectura;
  end if;
end $$;

-- ── ¿Se trabaja ese día? ────────────────────────────────────────────────────
-- p_scopes: los ámbitos cuyos festivos cuentan. Sin el año cargado, para: una
-- fecha calculada con un calendario a medias sería una fecha falsa.
create or replace function public.conta_impuesto_habil(p_dia date, p_scopes text[])
returns boolean language plpgsql stable set search_path = public as $$
declare v_falta text;
begin
  select string_agg(s, ', ') into v_falta from unnest(p_scopes) s
   where not exists (select 1 from public.tax_holiday_year y where y.year = extract(year from p_dia)::int and y.scope = s);
  if v_falta is not null then
    raise exception 'No están cargados los festivos de % (%): sin ellos no se puede calcular el plazo.', extract(year from p_dia)::int, v_falta
      using errcode = 'P0002';
  end if;
  return extract(isodow from p_dia) < 6
     and not exists (select 1 from public.tax_holiday h where h.day = p_dia and h.scope = any (p_scopes));
end $$;

-- ── El último mes de un periodo ─────────────────────────────────────────────
create or replace function public.conta_impuesto_fin_periodo(p_cadencia text, p_periodo text)
returns smallint language sql immutable set search_path = public as $$
  select case
    when p_cadencia = 'quarterly' and p_periodo ~ '^[1-4]T$' then (substr(p_periodo, 1, 1)::int * 3)::smallint
    when p_cadencia = 'monthly' and p_periodo ~ '^(0[1-9]|1[0-2])$' then p_periodo::smallint
    when p_cadencia = 'annual' and p_periodo = '0A' then 12::smallint
    when p_cadencia = 'instalments_202' and p_periodo = '1P' then 3::smallint
    when p_cadencia = 'instalments_202' and p_periodo = '2P' then 9::smallint
    when p_cadencia = 'instalments_202' and p_periodo = '3P' then 11::smallint
  end
$$;

-- ── El plazo de un modelo y periodo ─────────────────────────────────────────
create or replace function public.conta_impuesto_plazo(p_modelo text, p_cadencia text, p_ejercicio int, p_periodo text,
                                                       p_ambito text default 'ES-MD')
returns table (presentacion date, presentacion_regla date, domiciliacion date, regla text, provisional text)
language plpgsql stable set search_path = public as $$
declare
  r public.tax_form_deadline; v_fin smallint; v_mes date; v_dia date; v_p_aeat date; v_n int := 0;
  v_empresa constant text[] := array[p_ambito];
  v_aeat constant text[] := array['ES', 'ES-MD'];
begin
  v_fin := public.conta_impuesto_fin_periodo(p_cadencia, p_periodo);
  if v_fin is null then
    raise exception 'El periodo «%» no es de un modelo %.', p_periodo,
      case p_cadencia when 'quarterly' then 'trimestral' when 'monthly' then 'mensual' when 'annual' then 'anual' when 'instalments_202' then 'de pagos fraccionados' else p_cadencia end
      using errcode = '22023';
  end if;
  select * into r from public.tax_form_deadline d
   where d.form_code = p_modelo and d.cadence = p_cadencia and d.period in (p_periodo, '*')
   order by (d.period = p_periodo) desc limit 1;
  if r.form_code is null then
    raise exception 'No tengo la regla del plazo del % (%, periodo %): no se inventa.', p_modelo, p_cadencia, p_periodo using errcode = 'P0002';
  end if;

  -- El día de la regla: meses después del último mes del periodo, ese día o el último del mes.
  v_mes := (make_date(p_ejercicio, v_fin, 1) + make_interval(months => r.months_after))::date;
  v_dia := case when r.day is null then (v_mes + interval '1 month - 1 day')::date
                else make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, r.day) end;
  presentacion_regla := v_dia;
  regla := r.legal_ref;

  -- Presentación para la empresa: el primer hábil desde el día de la regla, con su calendario.
  presentacion := v_dia;
  while not public.conta_impuesto_habil(presentacion, v_empresa) loop presentacion := presentacion + 1; end loop;

  -- Domiciliación: desde el último día del plazo genérico (calendario de la AEAT),
  -- el último hábil que deja 3 hábiles hasta él, incluido.
  if r.direct_debit then
    v_p_aeat := v_dia;
    while not public.conta_impuesto_habil(v_p_aeat, v_aeat) loop v_p_aeat := v_p_aeat + 1; end loop;
    domiciliacion := v_p_aeat;
    while v_n < 3 loop
      if public.conta_impuesto_habil(domiciliacion, v_aeat) then v_n := v_n + 1; end if;
      domiciliacion := domiciliacion - 1;
    end loop;
    while not public.conta_impuesto_habil(domiciliacion, v_aeat) loop domiciliacion := domiciliacion - 1; end loop;
  end if;

  -- Si algún festivo usado es provisional, se dice.
  select string_agg(distinct y.year || ' (' || y.scope || '): ' || y.provisional_reason, ' · ') into provisional
    from public.tax_holiday_year y
   where y.provisional_reason is not null
     and y.scope = any (v_empresa || case when r.direct_debit then v_aeat else '{}'::text[] end)
     and y.year between extract(year from least(coalesce(domiciliacion, v_dia), v_dia))::int
                    and extract(year from greatest(presentacion, coalesce(v_p_aeat, presentacion)))::int;
  return next;
end $$;
comment on function public.conta_impuesto_plazo(text, text, int, text, text) is
  'I01a. Último día de presentación (trasladado si cae en inhábil para la empresa) y último día domiciliado (3 días hábiles, Orden HAC/241/2025) de un modelo y periodo. Para si falta la regla o los festivos del año.';

revoke all on function public.conta_impuesto_habil(date, text[]) from public, anon;
revoke all on function public.conta_impuesto_plazo(text, text, int, text, text) from public, anon;
grant execute on function public.conta_impuesto_habil(date, text[]) to authenticated, service_role;
grant execute on function public.conta_impuesto_fin_periodo(text, text) to authenticated, service_role;
grant execute on function public.conta_impuesto_plazo(text, text, int, text, text) to authenticated, service_role;
