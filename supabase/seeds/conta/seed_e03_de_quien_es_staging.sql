-- ============================================================================
-- E03 · ¿De quién es? · Lo que prepara su e2e, en su carril. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/e03/de-quien-es.spec.ts. Siembra en la cuenta A de la
-- plantilla una segunda sociedad, «Prueba Segunda Takeaway, S.L.» (NIF inventado
-- B00000000), que cada carril clona; y crea una función que la e2e llama con la
-- sesión de la administradora de A (de su carril) y que prepara allí, cada vez de nuevo:
--   · dos recibidas de Mayorista Prueba Alfa (semilla D01) en Taberna de Prueba
--     Norte, leídas de su papel, con IVA al 21 % y su PDF en una ruta del
--     carril (lo sube la e2e): una a nombre de la otra sociedad (con su llegada)
--     y otra a nombre de alguien de fuera (Cliente Inventado, S.L., F00000000).
-- Hasta el real del E03, el disparador de staging es el de antes y las marca
-- «no va a nombre» en cuanto llevan IVA: la función las deja como pregunta (sin
-- marca), que es como las deja el E03.
--
-- Por qué una función y no filas: las líneas de IVA (supplier_invoice_tax) no
-- se pueden escribir con la sesión de una persona, y una semilla no corrige lo
-- que marca un disparador (W07: al aplicarse no hace update). Lo que escribe la
-- función lo escribe al llamarla, en el carril, que se borra al acabar.
--
-- Guardas: aborta si al otro lado hay cuentas de producción; la función solo
-- trabaja en la cuenta A de la plantilla o en la de un carril, y solo para una
-- administradora de esa cuenta. Se puede aplicar dos veces (W07): «not exists» y create or replace.
-- ============================================================================

do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; emp2 constant uuid := 'c01a0000-0000-4000-8000-0000000000e3';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla E03 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.accounts where id = a) then raise exception 'Semilla E03: falta la cuenta de prueba A.'; end if;
  -- La segunda sociedad de A, en la plantilla (cada carril la clona). Solo añade: si ya está, nada.
  if not exists (select 1 from public.company where account_id = a and tax_id = 'B00000000') then
    insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
      fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country, setup_step, setup_completed_at)
    values (emp2, a, 'Prueba Segunda Takeaway, S.L.', 'Prueba Segunda Takeaway', 'B00000000', 'nif_es', 'company',
      'Calle', 'de la Prueba', '14', '28001', 'Madrid', 'Madrid', 'ES', 'hecho', '2026-11-18 00:00:00+00');
    insert into public.company_tax_profile (company_id, account_id, tax_territory, vat_period, chart_kind, account_digits, tax_forms, sales_tax_rate_code)
    values (emp2, a, 'peninsula_baleares', 'quarterly', 'pymes', 8, array['303', '347', '390'], 'iva_reducido');
  end if;
end $$;

create or replace function public.e2e_e03_preparar(p_lado text)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v_acc uuid; emp uuid; emp2 uuid; alfa uuid; v_nif_alfa text; loc uuid; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_sello text := upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint % 1679616));
  r jsonb := '{}'::jsonb; c record; v_id uuid; v_num text; v_ruta text;
begin
  if p_lado is null or p_lado !~ '^[a-z0-9]{1,12}$' then raise exception 'E03 e2e: el lado (ordenador, movil…) en minúsculas.'; end if;
  -- La cuenta A de quien llama, en la plantilla o en un carril (el segundo grupo es el carril).
  select up.account_id into v_acc from public.user_profiles up
   where up.user_id = auth.uid() and up.role = 'admin' and up.active
     and up.account_id::text ~ '^c01a0000-[0-9a-f]{4}-4000-8000-00000000000a$'
   order by up.created_at limit 1;
  if v_acc is null then raise exception 'E03 e2e: solo para la administradora de la cuenta A de prueba (o la de su carril).' using errcode = '42501'; end if;
  select id into emp from public.company where account_id = v_acc and tax_id = 'B28000016';
  select id, tax_id into alfa, v_nif_alfa from public.supplier where account_id = v_acc and name = 'Mayorista Prueba Alfa' order by created_at limit 1;
  select lc.location_id into loc from public.location_company lc where lc.company_id = emp order by lc.location_id limit 1;
  if emp is null or alfa is null then raise exception 'E03 e2e: faltan Taberna de Prueba Norte o Mayorista Prueba Alfa (semillas C00 y D01).'; end if;
  -- La segunda sociedad de la cuenta (la siembra esta semilla en la plantilla; el carril la clona).
  select id into emp2 from public.company where account_id = v_acc and tax_id = 'B00000000';
  if emp2 is null then raise exception 'E03 e2e: falta la segunda sociedad de A (semilla E03).'; end if;
  -- Las dos recibidas, cada vez con su número.
  for c in select * from (values
      ('otra', 'Prueba Segunda Takeaway SL', 'ES-B00000000'),
      ('fuera', 'Cliente Inventado, S.L.', 'F00000000')) t(caso, nombre, nif) loop
    v_num := format('E03-%s-%s-%s', upper(left(p_lado, 3)), upper(c.caso), v_sello);
    v_ruta := format('%s/e03-e2e/%s.pdf', v_acc, v_num);
    insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, status, source,
      reading_confidence, needs_review, tax_base_total, tax_total, grand_total, raw_document_url, created_by_name, reading)
    values (v_acc, emp, alfa, loc, 'invoice', v_num, v_hoy, 'en_revision', 'ocr', 'seguro', false, 100, 21, 121, v_ruta, 'Prueba e2e E03',
      jsonb_build_object('confianza', 'seguro', 'porque', jsonb_build_array('Prueba e2e E03.'), 'comprobaciones', '[]'::jsonb,
        'factura', jsonb_build_object('proveedor', jsonb_build_object('nombre', 'Mayorista Prueba Alfa', 'nif', v_nif_alfa),
                                      'destinatario', jsonb_build_object('nombre', c.nombre, 'nif', c.nif))))
    returning id into v_id;
    insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
    values (v_id, 'Material de limpieza', 1, 100, 100, 21, 0);
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_id, 21, 100, 21);
    -- El disparador de antes la habrá marcado «no va a nombre»: el E03 la deja como pregunta.
    update public.supplier_invoice set vat_non_deductible = false, vat_non_deductible_reason = null
     where id = v_id and vat_non_deductible_reason = 'no_a_nombre';
    if c.caso = 'otra' then
      insert into public.document_inbox (account_id, company_id, channel, status, file_path, file_name, mime_type, size_bytes, supplier_invoice_id)
      values (v_acc, emp, 'subida', 'factura', v_ruta, v_num || '.pdf', 'application/pdf', 1000, v_id);
    end if;
    r := r || jsonb_build_object(c.caso, jsonb_build_object('id', v_id, 'numero', v_num, 'ruta', v_ruta));
  end loop;
  return r || jsonb_build_object('cuenta', v_acc, 'empresa', emp, 'otra_empresa', emp2);
end $function$;
comment on function public.e2e_e03_preparar(text) is 'SOLO STAGING (semilla E03): prepara en la cuenta A de prueba (o la de su carril) una segunda sociedad y dos recibidas que preguntan «¿de quién es?», para su e2e.';
revoke all on function public.e2e_e03_preparar(text) from public, anon;
grant execute on function public.e2e_e03_preparar(text) to authenticated;
