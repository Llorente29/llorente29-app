-- supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
--
-- DL1 · Adleta (43000006, marca Lobbers): las autofacturas que faltan en los
-- libros (Julio, DL1·12 y DL1·13, 06/11). Cinco asientos en Foodint, propuestos
-- y validados en la misma transacción con _dl1_validar (journal_entry_validar,
-- como si los pulsara Julio): el de 01/01 no lo enseña el libro diario.
--
-- Lectura B (Julio, 06/11): lo que pone Adleta son bases y el IVA va encima.
--   LF-2026-001 · abril 1-15 ...... base 3.319,58 + IVA 331,96 = 3.651,54
--   Ajuste · diferencia de Uber .... base    69,07 + IVA   6,91 =    75,98 (el resto del ajuste de 407,94 es el IVA de la 001)
--   LF-2026-002 · abril 16-30 ...... base 3.753,96 + IVA 375,40 = 4.129,36 (Adleta pagó 3.753,96: debe 375,40)
--   LF-2026-004 · mayo 1-15 ........ base 2.939,57 + IVA 293,96 = 3.233,53
-- Van con fecha del 01/10/2026 (decisión de Julio): el 2T está presentado y
-- cerrado en Diez; su IVA (1.008,23) entra en el 4T. El periodo real va en el
-- concepto y en la lista de la gestoría. Serie 1, como las de marzo (ALC/CARAB/
-- PCAST): la 705 por local, con su analítica; la 477 con su tipo, su base y el
-- libro de emitidas; la 43000006 por el total, con el número del documento.
--
--   Diciembre de 2025, 2.ª quincena: el cobro de 2.743,91 del 19/01/2026 no
--   tiene autofactura. Es de 2025: el 01/01/2026, Debe 43000006 / Haber 11300000.
--   Su IVA lo mira la gestoría.
--
-- Lo que tiene que dar: 43000006 de −12.075,14 a +1.759,18 (lo que Adleta debe
-- de lo liquidado: 182,93 + 0,01 + 600,85 + 299,99 + 300,00 + 375,40).
--
-- SIN VUELTA ATRÁS, a propósito: se validan, y un asiento validado se anula con
-- un contraasiento. Lo dice el manifiesto, con lo esperado.

create or replace function public._dl1_venta_proponer(p_company uuid, p_fecha date, p_serie int, p_concepto text, p_porque text, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_y uuid; v_e uuid; l jsonb; v_pos int := 0; v_cta uuid; v_debe numeric := 0; v_haber numeric := 0; v_mal text; v_loc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1 Adleta: esa empresa no está.'; end if;
  if exists (select 1 from public.journal_entry where company_id = p_company and account_id = v_acc and concept = p_concepto and status <> 'anulado') then
    raise exception 'DL1 Adleta: ya hay un asiento vivo «%»: no se propone otro.', p_concepto;
  end if;
  select id into v_y from public.fiscal_year where company_id = p_company and account_id = v_acc and p_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'DL1 Adleta: no hay ejercicio para el %.', p_fecha; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_debe := v_debe + coalesce((l->>'debe')::numeric, 0); v_haber := v_haber + coalesce((l->>'haber')::numeric, 0);
  end loop;
  if v_debe <> v_haber or v_debe = 0 then raise exception 'DL1 Adleta: «%» no cuadra (debe %, haber %).', p_concepto, v_debe, v_haber; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason, created_by_name)
  values (v_acc, p_company, v_y, p_serie, p_fecha, p_concepto, 'manual', 'propuesto', 'seguro', p_porque, 'Julio (tanda DL1)')
  returning id into v_e;
  for l in select * from jsonb_array_elements(p_lineas) loop
    select id into v_cta from public.company_account where company_id = p_company and account_id = v_acc and code = l->>'cuenta';
    if v_cta is null then raise exception 'DL1 Adleta: la cuenta % no está en el plan de la empresa.', l->>'cuenta'; end if;
    v_loc := nullif(l->>'local', '')::uuid;
    if v_loc is not null and not exists (select 1 from public.locations where id = v_loc and account_id = v_acc) then
      raise exception 'DL1 Adleta: el local % no es de la cuenta.', v_loc;
    end if;
    v_pos := v_pos + 1;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     document_ref, tax_rate_id, tax_base, vat_book, tax_documents)
    values (v_acc, p_company, v_e, v_pos, v_cta, coalesce((l->>'debe')::numeric, 0), coalesce((l->>'haber')::numeric, 0), l->>'concepto', v_loc, v_loc is null,
            nullif(l->>'documento', ''), nullif(l->'iva'->>'tipo', '')::uuid, (l->'iva'->>'base')::numeric,
            case when l ? 'iva' then 'issued' end, 1);
  end loop;
  select string_agg(m.motivo, ' · ' order by m.orden) into v_mal from public.conta_motivos_para_validar(v_e) m;
  if v_mal is not null then raise exception 'DL1 Adleta: «%» no se podría validar: %', p_concepto, v_mal; end if;
  return v_e;
end $$;
revoke all on function public._dl1_venta_proponer(uuid, date, int, text, text, jsonb) from public, anon, authenticated, service_role;
comment on function public._dl1_venta_proponer(uuid, date, int, text, text, jsonb) is
  'DL1. Propone un asiento manual de la serie que se diga, con local y documento por línea; para si no cuadra, si ya hay uno vivo con ese concepto o si no se podría validar. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_alc constant uuid := '38158159-cd71-4056-950b-53425afac1ce';   -- Foodint Alcalá
  v_car constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';   -- Foodint Carabanchel
  v_pca constant uuid := '629f9154-b888-48ed-9b8c-ffae77620615';   -- Foodint Plaza Castilla
  v_iva10 constant uuid := '79d77d54-606c-4395-b968-02a99eb64dc3';  -- IVA reducido, 10 %
  v_porque constant text := 'DL1 (Julio, 06/11): autofactura de Adleta que no estaba en los libros. Lectura B: la cifra de Adleta es la base y el IVA va encima. Con fecha del 01/10: el 2T está presentado y cerrado en Diez; su IVA va al 4T.';
  r record; v_ids jsonb := '[]'::jsonb; v_id uuid; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Adleta: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;

  for r in select * from (values
      ('Autofactura Adleta LF-2026-001 · abril 1-15 · apuntada el 01/10', 'LF-2026-001', 1077.78, 1118.81, 1122.99, 3319.58, 331.96),
      ('Ajuste de Adleta · abril 1-15 · diferencia de Uber · apuntado el 01/10', 'Ajuste LF-2026-001', 18.88, 22.55, 27.64, 69.07, 6.91),
      ('Autofactura Adleta LF-2026-002 · abril 16-30 · apuntada el 01/10', 'LF-2026-002', 1836.16, 912.36, 1005.44, 3753.96, 375.40),
      ('Autofactura Adleta LF-2026-004 · mayo 1-15 · apuntada el 01/10', 'LF-2026-004', 1546.11, 580.51, 812.95, 2939.57, 293.96)
    ) x(concepto, doc, alc, car, pca, base, iva) loop
    if r.alc + r.car + r.pca <> r.base then raise exception 'DL1 Adleta: el reparto por local de % no suma su base.', r.doc; end if;
    v_id := public._dl1_venta_proponer(v_e, date '2026-10-01', 1, r.concepto, v_porque,
      jsonb_build_array(
        jsonb_build_object('cuenta', '43000006', 'debe', r.base + r.iva, 'documento', r.doc),
        jsonb_build_object('cuenta', '70500000', 'haber', r.alc, 'local', v_alc),
        jsonb_build_object('cuenta', '70500000', 'haber', r.car, 'local', v_car),
        jsonb_build_object('cuenta', '70500000', 'haber', r.pca, 'local', v_pca),
        jsonb_build_object('cuenta', '47700000', 'haber', r.iva, 'iva', jsonb_build_object('tipo', v_iva10, 'base', r.base))));
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.base + r.iva);
  end loop;

  -- Diciembre de 2025, 2.ª quincena: de 2025, contra la 113.
  v_id := public._dl1_venta_proponer(v_e, date '2026-01-01', 1,
    'Autofactura Adleta · diciembre de 2025, 16-31 (cobrada el 19/01) · contra la 113',
    'DL1 (Julio, 06/11): el cobro de 2.743,91 del 19/01/2026 es la 2.ª quincena de diciembre de 2025, sin autofactura (la 1.ª, ALC003, se pagó el 15/12). Es de 2025: contra la 113. Su IVA lo mira la gestoría.',
    jsonb_build_array(jsonb_build_object('cuenta', '43000006', 'debe', 2743.91, 'documento', 'Adleta diciembre 16-31'),
                      jsonb_build_object('cuenta', '11300000', 'haber', 2743.91)));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 2743.91);

  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 Adleta: % asientos apuntados y validados.', v_n;
end $$;
