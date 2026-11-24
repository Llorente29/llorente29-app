-- supabase/migrations/20261112T1451_dl1_cloudtown_enero.sql
--
-- DL1 · Cloudtown (43000004): enero de Carabanchel, y la 43000004 a cero
-- (Julio, DL1·16, 12/11). Va DESPUÉS de la 1421 (la AF-02593): si su asiento no
-- está validado, para.
--
-- Lo que pasó en enero: el 09/01 se traspasó el local de Carabanchel. Cloudtown
-- emitió la AF-02514 de todo enero (5.350,94) a nombre del anterior titular y
-- no la va a rehacer; su FV-02514 (1.196,37) está en nuestros libros (04/02) y
-- compensada; el 09/02 pagó a Llorente29 el neto del mes (4.154,57), y el 09/03
-- Llorente29 pagó al anterior titular su parte (718,14, asiento 4/1869), que
-- hoy está en la 678.
--
--   1. Factura de Llorente29 a Cloudtown por su parte de enero (09–31/01), por
--      el camino de la aplicación (_dl1_factura_emitir, en producción desde la
--      2213), en la serie F, local Carabanchel, como las de Adleta: la fecha de
--      expedición es el día en que se emite y la fecha de operación va en el
--      concepto. Total 4.632,80 = parte del neto (4.154,57 − 718,14 = 3.436,43)
--      + el stock que ya está en los libros (1.196,37); base 4.211,64 + IVA 10 %
--      421,16 (4T). Verifactu está apagado para Foodint.
--   2. Los 718,14 del 09/03, de la 678 a la 43000004, con su fecha: no llevan
--      IVA (el candado del #484 los deja).
--   3. La FV-02593 (stock de febrero, Carabanchel), que no estaba en los libros
--      de ninguna forma, como recibida con fecha del 01/10 (su IVA, al 4T), como
--      las demás FV de Cloudtown: 600 por la base, una 472 por tipo con su base y
--      el libro de recibidas, 40000002 por el total y 769 por el céntimo (las
--      líneas del PDF suman 1.141,00 y su total es 1.140,99).
--   4. Su compensación con la AF-02593: Debe 40000002 / Haber 43000004, 1.140,99.
--
-- Lo que tiene que dar: 43000004 de −4.210,62 a −0,67. Los 0,67 son la apertura
-- de 2026 (−3.409,16, lo que Cloudtown pagó de más en 2025) frente a lo que
-- pagó de menos en 2026 (400,00 de la AF-02494, 500,00 de la AF-02584, 5,99 de
-- la AF-02608, 2,50 de la AF-02609, 1.500,00 de la AF-02666 y 1.000,00 de la
-- AF-02718: 3.408,49). La 678 de marzo baja 718,14; el IVA repercutido con
-- fecha del 4T sube 421,16.
--
-- SIN VUELTA ATRÁS, a propósito: una factura emitida se corrige con una
-- rectificativa; un asiento validado, con un contraasiento.

create or replace function public._dl1_asiento_iva(p_company uuid, p_fecha date, p_serie int, p_concepto text, p_porque text, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_y uuid; v_e uuid; l jsonb; v_pos int := 0; v_cta uuid; v_debe numeric := 0; v_haber numeric := 0; v_mal text; v_loc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1: esa empresa no está.'; end if;
  if exists (select 1 from public.journal_entry where company_id = p_company and account_id = v_acc and concept = p_concepto and status <> 'anulado') then
    raise exception 'DL1: ya hay un asiento vivo «%»: no se propone otro.', p_concepto;
  end if;
  select id into v_y from public.fiscal_year where company_id = p_company and account_id = v_acc and p_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'DL1: no hay ejercicio para el %.', p_fecha; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_debe := v_debe + coalesce((l->>'debe')::numeric, 0); v_haber := v_haber + coalesce((l->>'haber')::numeric, 0);
  end loop;
  if v_debe <> v_haber or v_debe = 0 then raise exception 'DL1: «%» no cuadra (debe %, haber %).', p_concepto, v_debe, v_haber; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason, created_by_name)
  values (v_acc, p_company, v_y, p_serie, p_fecha, p_concepto, 'manual', 'propuesto', 'seguro', p_porque, 'Julio (tanda DL1)')
  returning id into v_e;
  for l in select * from jsonb_array_elements(p_lineas) loop
    select id into v_cta from public.company_account where company_id = p_company and account_id = v_acc and code = l->>'cuenta';
    if v_cta is null then raise exception 'DL1: la cuenta % no está en el plan de la empresa.', l->>'cuenta'; end if;
    v_loc := nullif(l->>'local', '')::uuid;
    if v_loc is not null and not exists (select 1 from public.locations where id = v_loc and account_id = v_acc) then
      raise exception 'DL1: el local % no es de la cuenta.', v_loc;
    end if;
    if l ? 'iva' and coalesce(l->'iva'->>'libro', '') not in ('issued', 'received') then
      raise exception 'DL1: la línea de IVA de la % no dice su libro (issued o received).', l->>'cuenta';
    end if;
    v_pos := v_pos + 1;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     party_id, document_ref, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents)
    values (v_acc, p_company, v_e, v_pos, v_cta, coalesce((l->>'debe')::numeric, 0), coalesce((l->>'haber')::numeric, 0), l->>'concepto', v_loc, v_loc is null,
            nullif(l->>'tercero', '')::uuid, nullif(l->>'documento', ''), nullif(l->'iva'->>'tipo', '')::uuid, (l->'iva'->>'base')::numeric,
            l->'iva'->>'libro', case when l->'iva'->>'libro' = 'received' then 'yes' end, 1);
  end loop;
  select string_agg(m.motivo, ' · ' order by m.orden) into v_mal from public.conta_motivos_para_validar(v_e) m;
  if v_mal is not null then raise exception 'DL1: «%» no se podría validar: %', p_concepto, v_mal; end if;
  return v_e;
end $$;
revoke all on function public._dl1_asiento_iva(uuid, date, int, text, text, jsonb) from public, anon, authenticated, service_role;
comment on function public._dl1_asiento_iva(uuid, date, int, text, text, jsonb) is
  'DL1. Propone un asiento manual con local, tercero, documento y, si la línea lleva IVA, su tipo, su base y su libro (emitidas o recibidas); para si no cuadra, si ya hay uno vivo con ese concepto o si no se podría validar. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_cloud constant uuid := '915b4784-9c28-4a29-8158-7d1d5abfa38c';  -- CLOUDTOWN BRANDS, S.L., en Contactos, enlazada a la 43000004 y la 40000002
  v_car constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';    -- Foodint Carabanchel
  v_iva4 constant uuid := '5e2ab5fe-d803-4c51-9924-e8c95b21911d';
  v_iva10 constant uuid := '79d77d54-606c-4395-b968-02a99eb64dc3';
  v_iva21 constant uuid := '36887d70-bcc4-4590-94ea-331213f90da3';
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_705 uuid; v_f jsonb; v_ids jsonb := '[]'::jsonb; v_id uuid; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Cloudtown enero: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  if not exists (select 1 from public.journal_entry where company_id = v_e and account_id = v_acc and status = 'validado'
                  and concept = 'Autofactura Cloudtown AF-02593 · febrero 2026 · Carabanchel · apuntada el 01/10') then
    raise exception 'DL1 Cloudtown enero: la AF-02593 (1421) no está validada. Esta tanda va después.';
  end if;
  if not exists (select 1 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                  where k.company_id = v_e and k.entity = 'customer' and k.entity_id = v_cloud::text and k.role = 'principal' and a.code = '43000004') then
    raise exception 'DL1 Cloudtown enero: Cloudtown no está enlazada a la 43000004: la factura abriría otra 430.';
  end if;
  select id into v_705 from public.company_account where company_id = v_e and account_id = v_acc and code = '70500000';

  -- 1. La factura de enero (09–31/01) a Cloudtown.
  v_f := public._dl1_factura_emitir(v_e, v_julio, 'Julio',
    jsonb_build_object('cliente_id', v_cloud, 'fecha', v_hoy, 'serie', 'F', 'local_id', v_car,
                       'notas', 'DL1 · Cloudtown Carabanchel 09/01/2026 – 31/01/2026 · fecha de operación del periodo.'),
    jsonb_build_array(jsonb_build_object('concepto', 'Servicio de cocina para Cloudtown, Carabanchel, 09–31/01/2026 (fecha de operación). La AF-02514 de Cloudtown salió a nombre del anterior titular.',
                                         'cantidad', 1, 'precio', 4211.64, 'tipo_id', v_iva10, 'cuenta_id', v_705)));
  if (v_f->>'total')::numeric <> 4632.80 then
    raise exception 'DL1 Cloudtown enero: la factura sale por % y se esperaba 4.632,80.', v_f->>'total';
  end if;

  -- 2. Los 718,14 del 09/03: de la 678 a la 43000004.
  v_id := public._dl1_asiento_iva(v_e, date '2026-03-09', 4,
    'Parte del anterior titular de la liquidación de Cloudtown de enero (01–08/01), pagada por cuenta de Cloudtown',
    'DL1 (Julio, 12/11): el pago del 09/03 (asiento 4/1869) no es un gasto: es la parte de la liquidación de enero de Cloudtown que era del anterior titular de Carabanchel. De la 678 a la 43000004, sin IVA.',
    jsonb_build_array(jsonb_build_object('cuenta', '43000004', 'debe', 718.14, 'tercero', v_cloud, 'documento', '4/1869'),
                      jsonb_build_object('cuenta', '67800000', 'haber', 718.14, 'documento', '4/1869')));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 718.14);

  -- 3. La FV-02593 (stock de febrero, Carabanchel), recibida, con fecha del 01/10.
  v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 2,
    'Factura de stock Cloudtown FV-02593 · febrero 2026 · Carabanchel · apuntada el 01/10',
    'DL1 (Julio, 12/11): la factura de stock de febrero de Carabanchel no estaba en los libros. Con fecha del 01/10: el 1T está presentado; su IVA se deduce en el 4T.',
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 1013.82, 'local', v_car, 'documento', 'FV-02593'),
      jsonb_build_object('cuenta', '47200004', 'debe', 2.67, 'local', v_car, 'documento', 'FV-02593', 'iva', jsonb_build_object('tipo', v_iva4, 'base', 66.70, 'libro', 'received')),
      jsonb_build_object('cuenta', '47200010', 'debe', 67.63, 'local', v_car, 'documento', 'FV-02593', 'iva', jsonb_build_object('tipo', v_iva10, 'base', 676.28, 'libro', 'received')),
      jsonb_build_object('cuenta', '47200021', 'debe', 56.88, 'local', v_car, 'documento', 'FV-02593', 'iva', jsonb_build_object('tipo', v_iva21, 'base', 270.84, 'libro', 'received')),
      jsonb_build_object('cuenta', '40000002', 'haber', 1140.99, 'local', v_car, 'tercero', v_cloud, 'documento', 'FV-02593'),
      jsonb_build_object('cuenta', '76900000', 'haber', 0.01, 'local', v_car, 'documento', 'FV-02593')));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 1141.00);

  -- 4. Su compensación con la AF-02593.
  v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 4,
    'Compensación con Cloudtown · FV-02593 contra la AF-02593 (febrero, Carabanchel)',
    'DL1 (Julio, 12/11): Cloudtown liquidó febrero de Carabanchel por el neto (AF-02593 − FV-02593 = 7.923,74, cobrado el 06/03).',
    jsonb_build_array(jsonb_build_object('cuenta', '40000002', 'debe', 1140.99, 'tercero', v_cloud, 'documento', 'FV-02593'),
                      jsonb_build_object('cuenta', '43000004', 'haber', 1140.99, 'tercero', v_cloud, 'documento', 'AF-02593')));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 1140.99);

  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 Cloudtown enero: emitida la % (%), y % asientos validados.', v_f->>'numero', v_f->>'total', v_n;
end $$;
