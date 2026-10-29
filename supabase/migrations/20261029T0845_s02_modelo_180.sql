-- supabase/migrations/20261029T0845_s02_modelo_180.sql
-- cambia: public.tax_return_check · prueba: supabase/staging/sql/20261029_s02_modelo_180_prueba.sql
--
-- S02 · EL 180, CALCULADO POR SUMIED DESDE LOS 115 DEL AÑO (encargo de Julio,
-- 29/10: «sigue con el 180, igual que el 190»), con el molde de la 1950.
--
--   company_lease                                                     [NUEVA]
--     El inmueble arrendado de cada arrendador (su ficha de proveedor): la
--     situación (1-4 del anexo VI), la referencia catastral y la dirección.
--     El 180 la pide en cada registro de perceptor y Sumied no la tenía en
--     ningún sitio. Se lee con la regla de los impuestos; se escribe solo
--     con conta_impuesto_180_inmueble_poner. Hoy, un inmueble por arrendador.
--   conta_impuesto_180_calcular(empresa, ejercicio)                    [NUEVA]
--     Crea (o recalcula) el borrador del 180 del año (periodo «0A»):
--       · recorre los periodos del 115 del año con conta_impuesto_retenciones_diario
--         (la misma regla que el 115: lo que cuenta y lo que no);
--       · un perceptor por arrendador (el tercero de la 4751 o la subcuenta
--         del proveedor), con su NIF, su nombre y la provincia de su ficha;
--         el porcentaje, el del último asiento del año («de haberse utilizado
--         más de un porcentaje se indicará exclusivamente el último»), y su
--         inmueble (company_lease);
--       · casillas: [01] número de perceptores, [02] base y [03] retenciones
--         (los totales del registro de declarante, posiciones 136-175);
--       · lo comprobado: que sume los 115 del año, periodo a periodo
--         ('sum_115_vs_180'); NIF que falta o no vale ('payees_180_nif');
--         arrendador sin provincia ('payees_180_province'); arrendador sin
--         inmueble ('lease_180'); asientos con retención sin modelo.
--     El 180 es informativo: no se paga. Queda con resultado «cero». Uno
--     presentado no se recalcula; uno revisado vuelve a borrador.
--   conta_impuesto_180_inmueble_poner(empresa, proveedor, datos)        [NUEVA]
--     Guarda el inmueble de un arrendador, comprobado como lo pide el anexo, y
--     dice qué ha guardado.
--   conta_impuesto_180_fichero(declaración, usuario)   [NUEVA, solo servicio]
--     Los datos del fichero (lo llama conta-hacienda, «fichero_180»). Con un
--     error sin resolver o un aviso sin mirar, no da datos.
--   tax_return_check: tres claves más ('payees_180_nif', 'payees_180_province',
--     'lease_180'). El CHECK solo amplía.
--
-- Nada del camino del pedido: lo llaman solo las pantallas de Impuestos.

-- ── 1. El CHECK de lo comprobado (solo amplía) ─────────────────────────────
alter table public.tax_return_check drop constraint if exists tax_return_check_check_key_check;
alter table public.tax_return_check add constraint tax_return_check_check_key_check
  check (check_key in ('book_vs_303', 'ledger_477_472', 'sum_303_vs_390', 'sum_111_vs_190', 'sum_115_vs_180',
                       'third_parties_347', 'mail_invoices_missing', 'out_of_period', 'file_layout', 'previous_offset',
                       'ledger_4751', 'payees_111', 'withholding_unclassified', 'base_200',
                       'payees_190_nif', 'payees_190_province', 'payroll_190',
                       'payees_180_nif', 'payees_180_province', 'lease_180'));

-- ── 2. El inmueble arrendado ──────────────────────────────────────────────
create table if not exists public.company_lease (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  supplier_id       uuid not null references public.supplier(id) on delete cascade,
  situation         text not null check (situation in ('1', '2', '3', '4')),
  cadastral_ref     text check (cadastral_ref ~ '^[0-9A-Z]{20}$'),
  street_type       text,
  street_name       text not null check (btrim(street_name) <> ''),
  number_type       text check (number_type in ('NUM', 'KM.', 'S/N')),
  street_number     text,
  number_qualifier  text,
  block             text,
  portal            text,
  stair             text,
  floor             text,
  door              text,
  complement        text,
  locality          text,
  municipality      text not null check (btrim(municipality) <> ''),
  municipality_code text check (municipality_code ~ '^[0-9]{5}$'),
  province          text not null check (province ~ '^(0[1-9]|[1-4][0-9]|5[0-3])$'),
  postal_code       text not null check (postal_code ~ '^[0-9]{5}$'),
  updated_by        uuid,
  updated_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, supplier_id),
  -- Con referencia catastral, situación 1, 2 o 3; sin ella, la 4 (anexo VI, «SITUACIÓN DEL INMUEBLE»).
  check ((situation = '4') = (cadastral_ref is null))
);
comment on table public.company_lease is
  'S02. El inmueble arrendado de cada arrendador (su ficha de proveedor), con lo que pide el registro de perceptor del 180 (anexo VI): situación, referencia catastral y dirección. Se escribe con conta_impuesto_180_inmueble_poner.';
create index if not exists company_lease_account_idx on public.company_lease (account_id);

alter table public.company_lease enable row level security;
drop policy if exists company_lease_select on public.company_lease;
create policy company_lease_select on public.company_lease for select to authenticated using (public.conta_impuesto_puede_ver(company_id));
revoke all on table public.company_lease from anon, authenticated;
grant select on table public.company_lease to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.company_lease to conta_lectura;
  end if;
end $$;

-- ── 3. El borrador del 180 ────────────────────────────────────────────────
create or replace function public.conta_impuesto_180_calcular(p_company uuid, p_year int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; o public.tax_obligation; r public.tax_return; v_plazo record; v_quien text := public.conta_impuesto_quien();
  v_cad text; v_pers text[]; v_per text; v_d jsonb; v_asientos jsonb := '[]'; v_sin_modelo jsonb := '[]';
  v_lineas jsonb; v_trim jsonb := '[]'; v_n int; v_base numeric; v_ret numeric; v_det jsonb;
  v_dif text; v_falta text; v_ret115 numeric; v_box jsonb;
  e text := 'FM999G999G990D00';
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, calcula sus impuestos.' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2023 or p_year > extract(year from now())::int then
    raise exception 'El 180 de «%» no se puede calcular: el diseño del fichero es del 2023 en adelante, y el año tiene que haber empezado.', p_year using errcode = '22023';
  end if;
  select * into o from public.tax_obligation where company_id = p_company and form_code = '180' and valid_to is null and active;
  if o.id is null then raise exception 'Esta empresa no presenta el 180 (no está en sus modelos).' using errcode = 'P0002'; end if;

  select * into r from public.tax_return where company_id = p_company and form_code = '180' and fiscal_year = p_year and period = '0A' and sequence = 1 for update;
  if r.id is not null and r.status not in ('pending', 'draft', 'reviewed') then
    raise exception 'El 180 de % ya está «%»: no se recalcula.', p_year, public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if r.id is null then
    select * into v_plazo from public.conta_impuesto_plazo_si_hay('180', o.cadence, p_year, '0A');
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date,
                                   due_date_direct_debit, due_provisional, alert_on, status)
    values (c.account_id, p_company, o.id, '180', p_year, o.cadence, '0A', v_plazo.presentacion, null, v_plazo.provisional,
            v_plazo.presentacion, 'draft')
    returning * into r;
  elsif r.status <> 'draft' then
    update public.tax_return set status = 'draft' where id = r.id returning * into r;
  end if;

  -- Los periodos del 115 del año: los de su obligación (trimestres o meses).
  select coalesce(public.conta_impuesto_cadencia_de(p_company, '115'), 'quarterly') into v_cad;
  v_pers := case when v_cad = 'monthly' then array['01','02','03','04','05','06','07','08','09','10','11','12'] else array['1T','2T','3T','4T'] end;
  foreach v_per in array v_pers loop
    v_d := public.conta_impuesto_retenciones_diario(p_company, p_year, v_per);
    v_asientos := v_asientos || coalesce((select jsonb_agg(a || jsonb_build_object('periodo', v_per)) from jsonb_array_elements(v_d->'asientos') a
                                           where a->>'tipo' = '115'), '[]');
    v_sin_modelo := v_sin_modelo || coalesce((select jsonb_agg(a) from jsonb_array_elements(v_d->'asientos') a where a->>'tipo' = 'sin_modelo'), '[]');
    v_trim := v_trim || jsonb_build_array(jsonb_build_object('periodo', v_per,
      'base', (v_d#>>'{sumas,115,base}')::numeric, 'retenido', (v_d#>>'{sumas,115,retenido}')::numeric));
  end loop;

  -- ── Los arrendadores: por perceptor (el tercero de la 4751 o la subcuenta del proveedor), con su ficha y su inmueble ──
  with a as (
    select x->>'perceptor' as perceptor, max(x->>'perceptor_nombre') as cuenta_nombre,
           sum((x->>'base')::numeric) as base, sum((x->>'retenido')::numeric) as retenido,
           -- El porcentaje: el del último asiento del año con base.
           (array_agg(round(100 * (x->>'retenido')::numeric / (x->>'base')::numeric, 2) order by x->>'fecha' desc, x->>'numero' desc)
              filter (where coalesce((x->>'base')::numeric, 0) <> 0))[1] as porcentaje,
           jsonb_agg(jsonb_build_object('asiento', x->>'asiento', 'fecha', x->>'fecha', 'serie', x->>'serie', 'numero', x->>'numero',
                                        'base', (x->>'base')::numeric, 'retenido', (x->>'retenido')::numeric, 'periodo', x->>'periodo') order by x->>'fecha') as asientos
      from jsonb_array_elements(v_asientos) x
     group by 1
  ), f as (
    select a.*, s.id as proveedor, coalesce(nullif(s.tax_id, ''), nullif(p.tax_id, '')) as nif,
           coalesce(nullif(s.legal_name, ''), nullif(s.name, ''), nullif(p.name, ''), a.cuenta_nombre) as nombre,
           case when coalesce(nullif(upper(s.country_code), ''), 'ES') = 'ES' and regexp_replace(coalesce(s.fiscal_postal_code, ''), '\D', '', 'g') ~ '^(0[1-9]|[1-4][0-9]|5[0-2])\d{3}$'
                then left(regexp_replace(s.fiscal_postal_code, '\D', '', 'g'), 2) end as provincia,
           ls.id as inmueble_id,
           case when ls.id is not null then jsonb_build_object(
             'situacion', ls.situation, 'catastral', ls.cadastral_ref, 'tipo_via', ls.street_type, 'nombre_via', ls.street_name,
             'tipo_numeracion', ls.number_type, 'numero', ls.street_number, 'calificador', ls.number_qualifier, 'bloque', ls.block,
             'portal', ls.portal, 'escalera', ls.stair, 'planta', ls.floor, 'puerta', ls.door, 'complemento', ls.complement,
             'localidad', ls.locality, 'municipio', ls.municipality, 'codigo_municipio', ls.municipality_code,
             'provincia', ls.province, 'cp', ls.postal_code) end as inmueble
      from a
      left join public.party p on p.account_id = c.account_id and p.id::text = a.perceptor
      -- Un enlace por subcuenta (el más antiguo, si hubiera dos): una línea por arrendador.
      left join lateral (select l.entity_id from public.company_account_link l
                          where l.account_id = c.account_id and l.company_id = p_company and l.company_account_id::text = a.perceptor
                            and l.entity = 'supplier' and l.role = 'principal' order by l.created_at, l.id limit 1) l on true
      left join lateral (select pr.supplier_id from public.party_role pr where pr.account_id = c.account_id and pr.party_id = p.id and pr.supplier_id is not null limit 1) pr on true
      left join public.supplier s on s.account_id = c.account_id and s.id::text = coalesce(l.entity_id, pr.supplier_id::text)
      left join public.company_lease ls on ls.account_id = c.account_id and ls.company_id = p_company and ls.supplier_id = s.id
     where abs(a.retenido) >= 0.005 or abs(a.base) >= 0.005
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'origen', 'diario', 'modalidad', '1',
           'perceptor', f.perceptor, 'proveedor', f.proveedor, 'nif', f.nif, 'nombre', f.nombre, 'provincia', f.provincia,
           'nif_valido', f.nif is not null and public._verifactu_nif_es_valido(f.nif),
           'porcentaje', coalesce(f.porcentaje, 0), 'inmueble', f.inmueble,
           'base', round(f.base, 2), 'retenciones', round(f.retenido, 2), 'asientos', f.asientos) order by f.nombre), '[]')
    into v_lineas
    from f;

  -- Las líneas: cada arrendador, con su foto.
  delete from public.tax_return_line where tax_return_id = r.id;
  insert into public.tax_return_line (tax_return_id, account_id, company_id, boxes, frozen)
  select r.id, c.account_id, p_company, array['01', '02', '03'], l from jsonb_array_elements(v_lineas) l;

  -- Las casillas: los totales del registro de declarante («si un mismo perceptor figura en varios registros, se computará una sola vez»).
  select count(distinct coalesce(l->>'nif', l->>'perceptor')), coalesce(sum((l->>'base')::numeric), 0), coalesce(sum((l->>'retenciones')::numeric), 0)
    into v_n, v_base, v_ret from jsonb_array_elements(v_lineas) l;
  delete from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, source)
  values (r.id, c.account_id, p_company, '01', v_n, jsonb_build_object('de', 'los arrendadores (un perceptor cada uno)')),
         (r.id, c.account_id, p_company, '02', round(v_base, 2), jsonb_build_object('de', 'la suma de lo pagado en alquileres con retención en el año, sin IVA')),
         (r.id, c.account_id, p_company, '03', round(v_ret, 2), jsonb_build_object('de', 'la suma de lo retenido en la 4751, de los 115 del año'))
  on conflict (tax_return_id, box) do nothing;

  update public.tax_return set result_kind = case when jsonb_array_length(v_lineas) = 0 then 'no_activity' else 'zero' end, amount = 0,
         calculated_at = now(), updated_at = now() where id = r.id;

  -- ── Lo comprobado (se rehace entero) ──
  delete from public.tax_return_check where tax_return_id = r.id;

  -- a) Que sume los 115 del año, periodo a periodo: lo que el 115 declaró ([02] y [03]) contra el diario.
  with t as (
    select x->>'periodo' as periodo, (x->>'base')::numeric as base, (x->>'retenido')::numeric as retenido, d.id as decl, d.status,
           (select coalesce(sum(b.value), 0) from public.tax_return_box b where b.tax_return_id = d.id and b.box = '02') as base115,
           (select coalesce(sum(b.value), 0) from public.tax_return_box b where b.tax_return_id = d.id and b.box = '03') as ret115
      from jsonb_array_elements(v_trim) x
      left join public.tax_return d on d.company_id = p_company and d.form_code = '115' and d.fiscal_year = p_year and d.period = x->>'periodo' and d.sequence = 1
  )
  select string_agg(t.periodo || ': ' || concat_ws(' y ',
                      case when abs(t.ret115 - t.retenido) >= 0.005 then 'lo retenido, ' || translate(to_char(t.ret115, e), ',.', '.,') || ' € en el 115 y ' ||
                                                                          translate(to_char(t.retenido, e), ',.', '.,') || ' € en el diario' end,
                      case when abs(t.base115 - t.base) >= 0.005 then 'la base, ' || translate(to_char(t.base115, e), ',.', '.,') || ' € en el 115 y ' ||
                                                                       translate(to_char(t.base, e), ',.', '.,') || ' € en el diario' end), '; ' order by t.periodo)
           filter (where t.decl is not null and (abs(t.ret115 - t.retenido) >= 0.005 or abs(t.base115 - t.base) >= 0.005)),
         string_agg(t.periodo, ', ' order by t.periodo) filter (where t.decl is null and (t.retenido <> 0 or t.base <> 0)),
         jsonb_agg(jsonb_build_object('periodo', t.periodo, 'declaracion', t.decl, 'estado', t.status, 'base_115', t.base115, 'retenido_115', t.ret115,
                                      'base_diario', t.base, 'retenido_diario', t.retenido) order by t.periodo),
         coalesce(sum(t.ret115), 0)
    into v_dif, v_falta, v_det, v_ret115
    from t;
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'sum_115_vs_180', case when v_dif is null and v_falta is null then 'ok' else 'warning' end,
          case when v_dif is null and v_falta is null
               then 'El 180 suma lo mismo que los 115 del año: ' || translate(to_char(v_ret, e), ',.', '.,') || ' € retenidos.'
               else concat_ws(' ',
                      case when v_dif is not null then 'No casa con los 115 del año: ' || v_dif || '.' end,
                      case when v_falta is not null then 'Hay retenciones de alquiler en el diario y no hay 115 en Sumied de: ' || v_falta || '.' end) end,
          jsonb_build_object('periodos', v_det, 'retenido_180', round(v_ret, 2), 'retenido_115', round(v_ret115, 2)));

  -- b) NIF que falta o no vale.
  select coalesce(jsonb_agg(l), '[]'), count(*) into v_det, v_n from jsonb_array_elements(v_lineas) l where not coalesce((l->>'nif_valido')::boolean, false);
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'payees_180_nif', case when v_n > 0 then 'error' else 'ok' end,
          case when v_n = 0 then 'Cada arrendador tiene un NIF que vale.'
               when v_n = 1 then '1 arrendador sin NIF o con un NIF que no vale: ' || coalesce((select l->>'nombre' from jsonb_array_elements(v_det) l limit 1), 'uno sin ficha de proveedor') || '. Corrígelo en su ficha.'
               else v_n || ' arrendadores sin NIF o con un NIF que no vale. Corrígelo en su ficha.' end,
          jsonb_build_object('perceptores', v_det));

  -- c) Arrendador sin provincia (la de su domicilio: el anexo la pide).
  select coalesce(jsonb_agg(l), '[]'), count(*) into v_det, v_n from jsonb_array_elements(v_lineas) l where coalesce(l->>'provincia', '') = '';
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'payees_180_province', case when v_n > 0 then 'error' else 'ok' end,
          case when v_n = 0 then 'Cada arrendador tiene su provincia.'
               when v_n = 1 then '1 arrendador sin provincia (sin código postal español en su ficha): ' || coalesce((select l->>'nombre' from jsonb_array_elements(v_det) l limit 1), 'uno sin ficha de proveedor') || '.'
               else v_n || ' arrendadores sin provincia (sin código postal español en su ficha).' end,
          jsonb_build_object('perceptores', v_det));

  -- d) Arrendador sin inmueble: el 180 lleva la situación, la referencia catastral y la dirección del local.
  select coalesce(jsonb_agg(l), '[]'), count(*) into v_det, v_n from jsonb_array_elements(v_lineas) l where l->'inmueble' is null or jsonb_typeof(l->'inmueble') = 'null';
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'lease_180', case when v_n > 0 then 'error' else 'ok' end,
          case when v_n = 0 then 'Cada arrendador tiene su inmueble: situación, referencia catastral y dirección.'
               when v_n = 1 then '1 arrendador sin el inmueble arrendado: ' || coalesce((select l->>'nombre' from jsonb_array_elements(v_det) l limit 1), 'uno sin ficha de proveedor') ||
                                 '. Ponlo en su fila: el 180 lleva la referencia catastral y la dirección del local.'
               else v_n || ' arrendadores sin el inmueble arrendado. Ponlo en su fila: el 180 lleva la referencia catastral y la dirección del local.' end,
          jsonb_build_object('perceptores', v_det));

  -- e) Asientos con retención sin modelo en el año.
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title, detail)
  values (r.id, c.account_id, p_company, 'withholding_unclassified', case when jsonb_array_length(v_sin_modelo) > 0 then 'error' else 'ok' end,
          case when jsonb_array_length(v_sin_modelo) = 0 then 'Cada asiento con retención del año tiene su modelo.'
               when jsonb_array_length(v_sin_modelo) = 1 then '1 asiento del año mueve la 4751 sin gasto ni nómina: Sumied no sabe si va en el 180. Ábrelo en el diario.'
               else jsonb_array_length(v_sin_modelo) || ' asientos del año mueven la 4751 sin gasto ni nómina: Sumied no sabe si van en el 180. Ábrelos en el diario.' end,
          jsonb_build_object('asientos', v_sin_modelo));

  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, c.account_id, p_company, auth.uid(), v_quien, 'calculation',
          v_quien || ' calculó el 180 de ' || p_year || ' desde los 115 del año: ' || translate(to_char(v_ret, e), ',.', '.,') || ' € retenidos.',
          jsonb_build_object('periodos', v_trim));

  select jsonb_object_agg(box, value) into v_box from public.tax_return_box where tax_return_id = r.id and value is not null;
  return jsonb_build_object('declaracion', r.id, 'modelo', '180', 'ejercicio', p_year,
                            'perceptores', (select count(*) from public.tax_return_line where tax_return_id = r.id),
                            'casillas', coalesce(v_box, '{}'),
                            'errores', (select count(*) from public.tax_return_check where tax_return_id = r.id and result = 'error'),
                            'avisos', (select count(*) from public.tax_return_check where tax_return_id = r.id and result = 'warning'),
                            'quien', v_quien);
end $$;

comment on function public.conta_impuesto_180_calcular(uuid, int) is
  'S02. Crea o recalcula el borrador del 180 del año desde los periodos del 115 (conta_impuesto_retenciones_diario): un perceptor por arrendador, con su ficha y su inmueble (company_lease), las casillas [01]-[03] del registro de declarante y lo comprobado (suma de los 115, NIF, provincia, inmueble). Informativo: resultado cero. Uno presentado no se recalcula.';

-- ── 4. El inmueble de un arrendador ───────────────────────────────────────
create or replace function public.conta_impuesto_180_inmueble_poner(p_company uuid, p_supplier uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.company; s public.supplier; v_quien text := public.conta_impuesto_quien();
  v_sit text := btrim(coalesce(p_datos->>'situacion', ''));
  v_cat text := nullif(upper(regexp_replace(coalesce(p_datos->>'catastral', ''), '\s', '', 'g')), '');
  v_via text := nullif(btrim(coalesce(p_datos->>'nombre_via', '')), '');
  v_mun text := nullif(btrim(coalesce(p_datos->>'municipio', '')), '');
  v_cmun text := nullif(regexp_replace(coalesce(p_datos->>'codigo_municipio', ''), '\s', '', 'g'), '');
  v_prov text := nullif(btrim(coalesce(p_datos->>'provincia', '')), '');
  v_cp text := nullif(regexp_replace(coalesce(p_datos->>'cp', ''), '\s', '', 'g'), '');
  v_tn text := nullif(upper(btrim(coalesce(p_datos->>'tipo_numeracion', ''))), '');
  v_num text := nullif(btrim(coalesce(p_datos->>'numero', '')), '');
  v_falta text[] := '{}';
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, pone los datos de sus impuestos.' using errcode = '42501';
  end if;
  -- Regla 9: el proveedor, de la cuenta de la empresa.
  select * into s from public.supplier where id = p_supplier and account_id = c.account_id;
  if s.id is null then raise exception 'Ese arrendador no es un proveedor de esta cuenta.' using errcode = 'P0002'; end if;

  if v_sit not in ('1', '2', '3', '4') then v_falta := v_falta || 'la situación (1, 2, 3 o 4)'::text; end if;
  if v_sit in ('1', '2', '3') and coalesce(v_cat, '') !~ '^[0-9A-Z]{20}$' then v_falta := v_falta || 'la referencia catastral (20 letras y cifras; sin ella, la situación es la 4)'::text; end if;
  if v_via is null then v_falta := v_falta || 'la calle'::text; end if;
  if v_mun is null then v_falta := v_falta || 'el municipio'::text; end if;
  if v_cmun is not null and v_cmun !~ '^[0-9]{5}$' then v_falta := v_falta || 'el código de municipio del INE (5 cifras, o en blanco)'::text; end if;
  if coalesce(v_prov, '') !~ '^(0[1-9]|[1-4][0-9]|5[0-3])$' then v_falta := v_falta || 'la provincia (dos cifras, de 01 a 53)'::text; end if;
  if coalesce(v_cp, '') !~ '^[0-9]{5}$' then v_falta := v_falta || 'el código postal (5 cifras)'::text; end if;
  if v_tn is not null and v_tn not in ('NUM', 'KM.', 'S/N') then v_falta := v_falta || 'el tipo de numeración (NUM, KM. o S/N)'::text; end if;
  if array_length(v_falta, 1) > 0 then
    raise exception 'Falta o no vale: %.', array_to_string(v_falta, '; ') using errcode = '22023';
  end if;

  insert into public.company_lease as l (account_id, company_id, supplier_id, situation, cadastral_ref, street_type, street_name, number_type, street_number,
                                         number_qualifier, block, portal, stair, floor, door, complement, locality, municipality, municipality_code,
                                         province, postal_code, updated_by, updated_by_name)
  values (c.account_id, p_company, s.id, v_sit, case when v_sit = '4' then null else v_cat end,
          nullif(upper(btrim(coalesce(p_datos->>'tipo_via', ''))), ''), v_via, coalesce(v_tn, case when v_num is null then 'S/N' else 'NUM' end), v_num,
          nullif(btrim(coalesce(p_datos->>'calificador', '')), ''), nullif(btrim(coalesce(p_datos->>'bloque', '')), ''),
          nullif(btrim(coalesce(p_datos->>'portal', '')), ''), nullif(btrim(coalesce(p_datos->>'escalera', '')), ''),
          nullif(btrim(coalesce(p_datos->>'planta', '')), ''), nullif(btrim(coalesce(p_datos->>'puerta', '')), ''),
          nullif(btrim(coalesce(p_datos->>'complemento', '')), ''), nullif(btrim(coalesce(p_datos->>'localidad', '')), ''),
          v_mun, v_cmun, v_prov, v_cp, auth.uid(), v_quien)
  on conflict (company_id, supplier_id) do update
     set situation = excluded.situation, cadastral_ref = excluded.cadastral_ref, street_type = excluded.street_type, street_name = excluded.street_name,
         number_type = excluded.number_type, street_number = excluded.street_number, number_qualifier = excluded.number_qualifier, block = excluded.block,
         portal = excluded.portal, stair = excluded.stair, floor = excluded.floor, door = excluded.door, complement = excluded.complement,
         locality = excluded.locality, municipality = excluded.municipality, municipality_code = excluded.municipality_code, province = excluded.province,
         postal_code = excluded.postal_code, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();

  return jsonb_build_object('ok', true,
    'mensaje', 'Guardado el local de ' || coalesce(nullif(s.legal_name, ''), s.name) || ': ' || v_via || coalesce(' ' || v_num, '') || ', ' || v_cp || ' ' || v_mun ||
               case when v_sit = '4' then ', sin referencia catastral (situación 4)' else ', referencia catastral …' || right(v_cat, 4) end ||
               '. Vuelve a calcular el 180 para que lo lleve.');
end $$;

comment on function public.conta_impuesto_180_inmueble_poner(uuid, uuid, jsonb) is
  'S02. Guarda el inmueble arrendado de un arrendador (company_lease) con lo que pide el anexo VI del 180: situación, referencia catastral si la tiene y dirección. Dice qué ha guardado.';

-- ── 5. Los datos del fichero (solo el servicio: conta-hacienda) ────────────
create or replace function public.conta_impuesto_180_fichero(p_return uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.tax_return; c public.company; v_n int; v_quien text;
begin
  select * into r from public.tax_return where id = p_return and form_code = '180';
  if r.id is null then raise exception 'Ese 180 no está.' using errcode = 'P0002'; end if;
  select count(*) into v_n from public.tax_return_check where tax_return_id = r.id and result = 'error' and check_key <> 'file_layout';
  if v_n > 0 then
    raise exception 'Este 180 tiene % que resolver en «Lo comprobado»: sin eso no se prepara el fichero.',
      case when v_n = 1 then 'una cosa' else v_n || ' cosas' end using errcode = '22023';
  end if;
  select count(*) into v_n from public.tax_return_check where tax_return_id = r.id and result = 'warning' and accepted_at is null;
  if v_n > 0 then
    raise exception 'Antes, mira % de «Lo comprobado» y dalo por bueno si lo está: con un aviso sin mirar no se prepara el fichero.',
      case when v_n = 1 then 'el aviso' else 'los ' || v_n || ' avisos' end using errcode = '22023';
  end if;
  if r.result_kind is null then raise exception 'Este 180 no está calculado todavía: no se prepara el fichero.' using errcode = '22023'; end if;
  select * into c from public.company where id = r.company_id;
  v_quien := coalesce(public.conta_impuesto_nombre_de(p_user), c.legal_name);
  return jsonb_build_object(
    'ejercicio', r.fiscal_year, 'nif', c.tax_id, 'nombre', c.legal_name,
    'contacto', jsonb_build_object('telefono', coalesce(c.phone, ''), 'nombre', v_quien),
    -- El número identificativo: 180, el año y la secuencia de la declaración (13 cifras).
    'numero', '180' || r.fiscal_year || lpad(r.sequence::text, 6, '0'),
    'perceptores', (select coalesce(jsonb_agg(jsonb_build_object(
                       'nif', l.frozen->>'nif', 'nombre', l.frozen->>'nombre', 'provincia', l.frozen->>'provincia',
                       'modalidad', coalesce(l.frozen->>'modalidad', '1'), 'base', (l.frozen->>'base')::numeric,
                       'porcentaje', (l.frozen->>'porcentaje')::numeric, 'retenciones', (l.frozen->>'retenciones')::numeric,
                       'inmueble', l.frozen->'inmueble') order by l.frozen->>'nombre'), '[]')
                      from public.tax_return_line l where l.tax_return_id = r.id));
end $$;

comment on function public.conta_impuesto_180_fichero(uuid, uuid) is
  'S02. Los datos del fichero del 180 (conta-hacienda, «fichero_180»): declarante, persona de contacto y un arrendador con su inmueble por línea. Con un error sin resolver o un aviso sin mirar en lo comprobado, no da datos. Solo el servicio.';

revoke all on function public.conta_impuesto_180_calcular(uuid, int) from public, anon;
revoke all on function public.conta_impuesto_180_inmueble_poner(uuid, uuid, jsonb) from public, anon;
revoke all on function public.conta_impuesto_180_fichero(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conta_impuesto_180_calcular(uuid, int) to authenticated, service_role;
grant execute on function public.conta_impuesto_180_inmueble_poner(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.conta_impuesto_180_fichero(uuid, uuid) to service_role;
