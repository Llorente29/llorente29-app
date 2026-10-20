-- supabase/staging/sql/20261125_i01d_autoliquidaciones_prueba.sql
--
-- SOLO STAGING. Prueba de 20261125T0300_i01d_autoliquidaciones, con \i dentro
-- de la transacción y ROLLBACK: staging no cambia. Nombra lo nuevo y lo
-- cambiado: public.conta_proveedor_iva_clase, public.conta_pais_nombre,
-- public.conta_impuesto_303_cajas, public.conta_impuesto_303_desde_libro,
-- public.conta_impuesto_303_calcular, public.conta_libro_iva_deducir_en,
-- public.conta_vat_book_desde_asiento y public.conta_motivos_para_validar.
--
-- Por los CAMINOS (regla 10), como administrador de A, con tres proveedores
-- INVENTADOS de A —uno de Francia con NIF-IVA, uno de Estados Unidos y uno de
-- España— y facturas del 05/10/2026:
--   1. La clase de cada ficha (país, NIF-IVA, VIES y régimen de IVA).
--   2. Una compra intracomunitaria (base 100,00): con su 472 «Compra en otro
--      país de la UE» y su 477 de autorrepercusión, se valida; al libro va UNA
--      fila (la 472): inversión del sujeto pasivo, clave 09, país FR, NIF-IVA.
--   3. Sin la 477, no se valida: «falta la autorrepercusión».
--   4. El tipo contra el país: la de Francia al 21 % normal, la de España con
--      «Compra en otro país de la UE» y la de Estados Unidos con «Compra en
--      otro país de la UE»: ninguna se valida, y cada una dice por qué.
--   5. La de Estados Unidos (base 50,00) con «Inversión del sujeto pasivo» y
--      su 477: se valida; al libro, clave 01, país US, tipo de NIF 04.
--   6. El 303 del 4T: lo que cambia por estas dos compras es [10]/[11] 100/21,
--      [36]/[37] 100/21, [12]/[13] 50/10,50 y [28]/[29] 50/10,50, y la [46] no
--      se mueve; el cálculo y conta_impuesto_303_desde_libro dicen lo mismo, y
--      no queda nada apartado como «falta la autorrepercusión».
--   7. Anular la intracomunitaria: el contraasiento se valida y el 303 vuelve.
--   8. El testigo de «deducida en» lleva en la [28]/[29] la inversión del
--      sujeto pasivo que no es intracomunitaria (1T, con una recibida
--      inventada de Diez).
--   9. Otra cuenta no ve el 303 de A desde el libro.
--  10. La vuelta atrás deja las cuatro funciones BYTE A BYTE como estaban
--      (md5 de producción del 20/10) y quita las nuevas; y otra vez hacia delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA AUTOLIQUIDACIONES: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- W03 (20/10): staging tiene la m01 de verdad, como producción
-- (20261126_w03_c06b_y_m01_de_verdad.sql): su journal_entry_validar llama a
-- conta_motivos_para_validar. Esta prueba ya no la carga; si faltara, para.
do $$ begin
  if position('conta_motivos_para_validar' in coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.journal_entry_validar(uuid,text)')), '')) = 0 then
    raise exception 'PRUEBA AUTOLIQUIDACIONES: staging no tiene la m01 de verdad (falta 20261126_w03_c06b_y_m01_de_verdad.sql al principio del manifiesto).';
  end if;
end $$;
\i supabase/migrations/20261125T0300_i01d_autoliquidaciones.sql

do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if (select tax_id from public.company where id = v_a) <> 'B28000016' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES: la empresa A ya no tiene el NIF inventado B28000016: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2026 and status not in ('draft', 'pending', 'reviewed'))
     or exists (select 1 from public.vat_book_entry where company_id = v_a and coalesce(received_date, issue_date) between '2026-01-01' and '2026-03-31') then
    raise exception 'PRUEBA AUTOLIQUIDACIONES: A ya tiene un 303 de 2026 presentado o libro de IVA del 1T: esta prueba ya no mide lo que cree.';
  end if;
  if public.conta_mes_cerrado(v_a, '2026-10-05') then
    raise exception 'PRUEBA AUTOLIQUIDACIONES: octubre de 2026 está cerrado en A: esta prueba ya no puede validar.';
  end if;
end $$;

-- Una factura de proveedor de A, propuesta: gasto, la 472 del tipo (si lo
-- lleva), la 477 de autorrepercusión (si se pide) y el proveedor.
create or replace function pg_temp.factura(p_prov uuid, p_sub text, p_num text, p_base numeric, p_tipo text, p_con477 boolean)
returns uuid language plpgsql as $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  t public.tax_rate; v_cuota numeric := 0; v_i uuid; v_l jsonb; r jsonb;
begin
  if p_tipo is not null then
    select * into t from public.tax_rate where is_system and code = p_tipo and valid_to is null;
    v_cuota := round(p_base * t.rate / 100, 2);
  end if;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, p_prov, v_e, p_num, '2026-10-05', 'aprobada', 'manual', p_base, p_base, 0, 'Prueba I01d') returning id into v_i;
  v_l := jsonb_build_array(jsonb_build_object('cuenta', '62900000', 'debe', p_base, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', p_num));
  if p_tipo is not null then
    v_l := v_l || jsonb_build_object('cuenta', '47200021', 'debe', v_cuota, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', p_num,
                                     'iva', jsonb_build_object('tipo_id', t.id, 'base', p_base, 'libro', 'received', 'deducible', 'yes', 'facturas', 1));
  end if;
  if p_con477 then
    v_l := v_l || jsonb_build_object('cuenta', '47700021', 'debe', 0, 'haber', v_cuota, 'local_id', v_loc, 'comun', false, 'documento', p_num);
  end if;
  v_l := v_l || jsonb_build_object('cuenta', p_sub, 'debe', 0, 'haber', p_base + case when p_con477 then 0 else v_cuota end,
                                   'local_id', v_loc, 'comun', false, 'documento', p_num);
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-10-05', 'concepto', 'Factura de la prueba I01d · ' || p_num, 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba I01d', 'documento', p_num), v_l, null, 'Prueba I01d');
  return (r->>'id')::uuid;
end $$;
grant execute on function pg_temp.factura(uuid, text, text, numeric, text, boolean) to authenticated;

-- El motivo por el que no se valida (o «se valida»).
create or replace function pg_temp.validar(p_entry uuid) returns text language plpgsql as $$
begin
  perform public.journal_entry_validar(p_entry, 'Prueba I01d');
  return 'se valida';
exception when sqlstate '23514' then return sqlerrm;
end $$;
grant execute on function pg_temp.validar(uuid) to authenticated;

-- Lo que el libro dice del 303 del 4T de A, en las casillas que mira esta prueba.
create or replace function pg_temp.libro4t() returns jsonb language sql as $$
  select public.conta_impuesto_303_desde_libro('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T')
$$;
grant execute on function pg_temp.libro4t() to authenticated;
create or replace function pg_temp.delta(a jsonb, b jsonb) returns text language sql as $$
  select coalesce(string_agg(k || '=' || ((coalesce((b->'casillas'->>k)::numeric, 0) - coalesce((a->'casillas'->>k)::numeric, 0))), ' ' order by k), '')
    from unnest(array['10', '11', '12', '13', '28', '29', '36', '37']) k
   where coalesce((b->'casillas'->>k)::numeric, 0) <> coalesce((a->'casillas'->>k)::numeric, 0)
$$;
grant execute on function pg_temp.delta(jsonb, jsonb) to authenticated;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · La clase de cada ficha ──────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_fr uuid; v_us uuid; v_es uuid; v_mal text;
begin
  select string_agg(format('%s→%s (tendría que ser %s)', x.caso, public.conta_proveedor_iva_clase(x.pais, x.tipo, x.nif, x.vies, x.regimen), x.clase), '; ')
    into v_mal
    from (values
      ('España', 'ES', 'nif_es', 'B00000000', 'valid', null, 'nacional'),
      ('España con inversión del sujeto pasivo', 'ES', 'nif_es', 'B00000000', 'valid', 'inversion_sujeto_pasivo', 'isp_nacional'),
      ('Francia con NIF-IVA', 'FR', 'vat_eu', 'FR00123456789', 'valid', null, 'intracomunitaria'),
      ('Francia, VIES sin contestar', 'FR', 'vat_eu', 'FR00123456789', 'pending', null, 'intracomunitaria'),
      ('Francia, VIES dice que no', 'FR', 'vat_eu', 'FR00123456789', 'invalid', null, 'ue_sin_nif_iva'),
      ('Portugal sin NIF', 'PT', null, null, null, null, 'ue_sin_nif_iva'),
      ('Estados Unidos', 'US', 'foreign', null, null, null, 'isp_extranjero'),
      ('Singapur', 'SG', 'foreign', 'X1', null, null, 'isp_extranjero')) x(caso, pais, tipo, nif, vies, regimen, clase)
   where public.conta_proveedor_iva_clase(x.pais, x.tipo, x.nif, x.vies, x.regimen) <> x.clase;
  if v_mal is not null then raise exception 'PRUEBA AUTOLIQUIDACIONES · 1: %', v_mal; end if;
  if public.conta_pais_nombre('fr') <> 'Francia' or public.conta_pais_nombre('ZZ') <> 'ZZ' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 1: el país en palabras da % y %.', public.conta_pais_nombre('fr'), public.conta_pais_nombre('ZZ');
  end if;

  insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, country_code, tax_id_check_status, is_active, created_by_name)
  values (v_acc, 'Francesa Prueba I01d', 'Francesa Prueba I01d SAS', 'FR00123456789', 'vat_eu', 'FR', 'pending', true, 'Prueba I01d') returning id into v_fr;
  insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, country_code, is_active, created_by_name)
  values (v_acc, 'Americana Prueba I01d', 'Americana Prueba I01d Inc.', 'US-0000001', 'foreign', 'US', true, 'Prueba I01d') returning id into v_us;
  insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, country_code, tax_id_check_status, is_active, created_by_name)
  values (v_acc, 'Española Prueba I01d', 'Española Prueba I01d, S.L.', 'B00000041', 'nif_es', 'ES', 'valid', true, 'Prueba I01d') returning id into v_es;
  perform set_config('prueba.fr', v_fr::text, true);
  perform set_config('prueba.us', v_us::text, true);
  perform set_config('prueba.es', v_es::text, true);
  perform set_config('prueba.sub_fr', public.company_account_add(v_e, '4000', 'Francesa Prueba I01d', null, 'supplier', v_fr::text, 'Prueba I01d')->>'code', true);
  perform set_config('prueba.sub_us', public.company_account_add(v_e, '4000', 'Americana Prueba I01d', null, 'supplier', v_us::text, 'Prueba I01d')->>'code', true);
  perform set_config('prueba.sub_es', public.company_account_add(v_e, '4000', 'Española Prueba I01d', null, 'supplier', v_es::text, 'Prueba I01d')->>'code', true);
  perform set_config('prueba.antes', pg_temp.libro4t()::text, true);
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 1: las ocho fichas, cada una en su clase; tres proveedores inventados con su subcuenta.';
end $$;

-- ── 2 · La intracomunitaria, con su autorrepercusión ────────────────────────
do $$
declare v_entry uuid; m text; v jsonb; n int;
begin
  v_entry := pg_temp.factura(current_setting('prueba.fr')::uuid, current_setting('prueba.sub_fr'), 'PI01D-FR-1', 100, 'ue_compra', true);
  m := pg_temp.validar(v_entry);
  if m <> 'se valida' then raise exception 'PRUEBA AUTOLIQUIDACIONES · 2: la intracomunitaria con su 477 no se valida: %', m; end if;
  select count(*), (array_agg(to_jsonb(b)))[1] into n, v from public.vat_book_entry b where b.entry_id = v_entry;
  if n <> 1 or v->>'book' <> 'received' or not (v->>'reverse_charge')::boolean or v->>'operation_key' <> '09' or v->>'counterpart_country' <> 'FR'
     or v->>'counterpart_id_type' <> '02' or v->>'counterpart_tax_id' <> 'FR00123456789' or (v->>'tax_base')::numeric <> 100
     or (v->>'tax_amount')::numeric <> 21 or (v->>'deductible_amount')::numeric <> 21 or v->>'qualification' <> 'S2' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 2: al libro van % filas; la primera: %', n, v;
  end if;
  perform set_config('prueba.entry_fr', v_entry::text, true);
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 2: se valida; al libro, una fila: inversión del sujeto pasivo, clave 09, FR, NIF-IVA (02), base 100,00 y cuota 21,00 deducible.';
end $$;

-- ── 3 · Sin la 477, no ──────────────────────────────────────────────────────
do $$
declare m text;
begin
  m := pg_temp.validar(pg_temp.factura(current_setting('prueba.fr')::uuid, current_setting('prueba.sub_fr'), 'PI01D-FR-2', 100, 'ue_compra', false));
  if m not like 'No se valida: falta la autorrepercusión.%21,00 €%0,00 €%' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 3: sin la 477 dice «%».', m;
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 3: «%»', m;
end $$;

-- ── 4 · El tipo contra el país ──────────────────────────────────────────────
do $$
declare m1 text; m2 text; m3 text;
begin
  m1 := pg_temp.validar(pg_temp.factura(current_setting('prueba.fr')::uuid, current_setting('prueba.sub_fr'), 'PI01D-FR-3', 100, 'iva_general', false));
  m2 := pg_temp.validar(pg_temp.factura(current_setting('prueba.es')::uuid, current_setting('prueba.sub_es'), 'PI01D-ES-1', 100, 'ue_compra', true));
  m3 := pg_temp.validar(pg_temp.factura(current_setting('prueba.us')::uuid, current_setting('prueba.sub_us'), 'PI01D-US-1', 50, 'ue_compra', true));
  if m1 not like 'No se valida: el apunte 2 lleva «%». Francesa Prueba I01d es de Francia y tiene NIF-IVA europeo: su compra es intracomunitaria y va con «Compra en otro país de la UE»%'
     or m2 not like 'No se valida: el apunte 2 lleva «%». Española Prueba I01d es de España: su compra lleva el IVA de su factura.%'
     or m3 not like 'No se valida: el apunte 2 lleva «%». Americana Prueba I01d es de fuera de la UE (Estados Unidos): su compra va con «Inversión del sujeto pasivo»%' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 4: dicen «%», «%» y «%».', m1, m2, m3;
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 4: «%» · «%» · «%»', m1, m2, m3;
end $$;

-- ── 5 · Fuera de la UE: inversión del sujeto pasivo ─────────────────────────
do $$
declare v_entry uuid; m text; v jsonb;
begin
  v_entry := pg_temp.factura(current_setting('prueba.us')::uuid, current_setting('prueba.sub_us'), 'PI01D-US-2', 50, 'isp', true);
  m := pg_temp.validar(v_entry);
  if m <> 'se valida' then raise exception 'PRUEBA AUTOLIQUIDACIONES · 5: la de Estados Unidos con «Inversión del sujeto pasivo» no se valida: %', m; end if;
  select to_jsonb(b) into v from public.vat_book_entry b where b.entry_id = v_entry;
  if not (v->>'reverse_charge')::boolean or v->>'operation_key' <> '01' or v->>'counterpart_country' <> 'US' or v->>'counterpart_id_type' <> '04'
     or (v->>'tax_amount')::numeric <> 10.50 then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 5: al libro va %', v;
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 5: se valida; al libro, inversión del sujeto pasivo, clave 01, US, tipo de NIF 04, cuota 10,50.';
end $$;

-- ── 6 · El 303 del 4T ───────────────────────────────────────────────────────
do $$
declare
  v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  a jsonb := current_setting('prueba.antes')::jsonb; d jsonb; k jsonb; v_mal text;
begin
  d := pg_temp.libro4t();
  if pg_temp.delta(a, d) <> '10=100.00 11=21.00 12=50.00 13=10.50 28=50.00 29=10.50 36=100.00 37=21.00'
     or (d->>'46')::numeric <> (a->>'46')::numeric or d->'no_sabe' ? 'autorrepercusion' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 6: desde el libro cambia «%» y la [46] pasa de % a %; no sabe %.', pg_temp.delta(a, d), a->>'46', d->>'46', d->'no_sabe';
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 6: desde el libro cambian «%» y la [46] no se mueve (%).', pg_temp.delta(a, d), d->>'46';
  -- Calculado una vez para tener el borrador; con la [110] a mano (abajo), otra vez.
  perform public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  perform set_config('prueba.d', d::text, true);
end $$;
reset role;
-- La [110] a mano (0): sin ella, si el 4T de A sale a pagar, el cálculo no
-- escribe casillas (no sabe lo que quedaba de antes) y la prueba no mediría nada.
insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, origin, manual_reason)
select r.id, r.account_id, r.company_id, '110', 0, 'manual', 'Prueba I01d: sin nada que compensar de antes'
  from public.tax_return r where r.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and r.form_code = '303' and r.fiscal_year = 2026 and r.period = '4T' and r.sequence = 1
on conflict (tax_return_id, box) do update set value = 0, origin = 'manual', manual_reason = excluded.manual_reason;
set local role authenticated;
do $$
declare
  v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  d jsonb := current_setting('prueba.d')::jsonb; k jsonb; v_mal text;
begin
  k := public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  if not (k->>'sabido')::boolean then raise exception 'PRUEBA AUTOLIQUIDACIONES · 6: con la [110] a mano el 4T no se sabe: %', k; end if;
  select string_agg(format('[%s] %s ≠ %s', x.key, x.value, k->'casillas'->>x.key), '; ') into v_mal
    from jsonb_each_text(d->'casillas') x where (k->'casillas'->>x.key)::numeric is distinct from x.value::numeric;
  if v_mal is not null or (k->'casillas'->>'27')::numeric is distinct from (d->>'27')::numeric or (k->'casillas'->>'45')::numeric is distinct from (d->>'45')::numeric then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 6: el cálculo y el libro no dicen lo mismo: % (27: % y %; 45: % y %).', v_mal,
      k->'casillas'->>'27', d->>'27', k->'casillas'->>'45', d->>'45';
  end if;
  if exists (select 1 from jsonb_array_elements(k->'no_sabe') x where x->>'motivo' = 'autorrepercusion') then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 6: el cálculo aún aparta «falta la autorrepercusión»: %', k->'no_sabe';
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 6: el cálculo dice lo mismo que el libro (la [46], %).', d->>'46';
end $$;
reset role;
-- El ensayo: el apunte autoliquidado del libro, con las casillas de cada clase (como postgres: la función no es de nadie más).
do $$
declare v_mal text;
begin
  select string_agg(b.entry_id || ': ' || array_to_string(x.cajas, ','), '; ') into v_mal
    from public.vat_book_entry b cross join lateral public.conta_impuesto_303_cajas(b) x
   where b.entry_id in (select id from public.journal_entry where concept like 'Factura de la prueba I01d%' and status = 'validado')
     and array_to_string(x.cajas, ',') not in ('10,11,36,37', '12,13,28,29');
  if v_mal is not null then raise exception 'PRUEBA AUTOLIQUIDACIONES · 6: casillas raras: %', v_mal; end if;
end $$;
set local role authenticated;

-- ── 7 · Anular la intracomunitaria ──────────────────────────────────────────
do $$
declare r jsonb; d jsonb; a jsonb := current_setting('prueba.antes')::jsonb;
begin
  r := public.journal_entry_anular(current_setting('prueba.entry_fr')::uuid, 'Prueba I01d: la anulo', '2026-10-06', 'Prueba I01d');
  if (select status from public.journal_entry where id = (r->>'contraasiento')::uuid) <> 'validado' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 7: el contraasiento no queda validado: %', r;
  end if;
  d := pg_temp.libro4t();
  if pg_temp.delta(a, d) <> '12=50.00 13=10.50 28=50.00 29=10.50' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 7: anulada la intracomunitaria, el 4T cambia «%».', pg_temp.delta(a, d);
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 7: el contraasiento se valida y la intracomunitaria sale del 303 (queda «%»).', pg_temp.delta(a, d);
end $$;

-- ── 8 · El testigo de «deducida en» ─────────────────────────────────────────
reset role;
do $$
declare
  v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_cuenta uuid; v_ej uuid; v_e1 uuid := 'd0300000-0000-4000-8000-000000090001'; v_e2 uuid := 'd0300000-0000-4000-8000-000000090002';
begin
  select account_id into v_cuenta from public.company where id = v_a;
  select id into v_ej from public.fiscal_year where company_id = v_a and code = '2026';
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type,
                                    external_program, external_year, external_series, external_number)
  values (v_e1, v_cuenta, v_a, v_ej, 2, '2026-03-30', 'Recibida inventada de la prueba 0300', 'migrated', 'diez', '2026', '2', '90301'),
         (v_e2, v_cuenta, v_a, v_ej, 2, '2026-03-31', 'Autoliquidada inventada de la prueba 0300', 'migrated', 'diez', '2026', '2', '90302');
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values
    (v_cuenta, v_a, v_e1, 1, (select id from public.company_account where company_id = v_a and code = '60000000'), 100.00, 0),
    (v_cuenta, v_a, v_e1, 2, (select id from public.company_account where company_id = v_a and code = '47200021'), 21.00, 0),
    (v_cuenta, v_a, v_e1, 3, (select id from public.company_account where company_id = v_a and code = '40000000'), 0, 121.00),
    (v_cuenta, v_a, v_e2, 1, (select id from public.company_account where company_id = v_a and code = '62900000'), 40.00, 0),
    (v_cuenta, v_a, v_e2, 2, (select id from public.company_account where company_id = v_a and code = '47200021'), 8.40, 0),
    (v_cuenta, v_a, v_e2, 3, (select id from public.company_account where company_id = v_a and code = '47700021'), 0, 8.40),
    (v_cuenta, v_a, v_e2, 4, (select id from public.company_account where company_id = v_a and code = '40000000'), 0, 40.00);
  insert into public.vat_book_entry (account_id, company_id, entry_id, book, invoice_type, number, issue_date, received_date,
                                     counterpart_name, tax_base, tax_rate, tax_amount, deductible_amount, reverse_charge, operation_key, source_type)
  values (v_cuenta, v_a, v_e1, 'received', 'F1', 'PRUEBA-0300-1', '2026-03-30', '2026-03-30', 'Proveedor inventado de la prueba', 100.00, 21, 21.00, 21.00, false, '01', 'migrated'),
         (v_cuenta, v_a, v_e2, 'received', 'F1', 'PRUEBA-0300-2', '2026-03-31', '2026-03-31', 'Extranjero inventado de la prueba', 40.00, 21, 8.40, 8.40, true, '01', 'migrated');
end $$;
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r jsonb; t1 jsonb; d jsonb;
begin
  r := public.conta_libro_iva_deducir_en(v_a, '[{"e":"2026","s":"2","n":"90301"}]', 2026, '2T', 'Prueba 0300');
  select x into t1 from jsonb_array_elements(r->'testigo') x where x->>'periodo' = '1T/2026';
  if (r->>'marcadas')::int <> 1 or (t1->>'libro_28')::numeric <> 40.00 or (t1->>'libro_29')::numeric <> 8.40 then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 8: el testigo del 1T da % (tendría que llevar la autoliquidada: 40,00 y 8,40).', r->'testigo';
  end if;
  d := public.conta_impuesto_303_desde_libro(v_a, 2026, '1T');
  if d->'casillas' <> '{"12": 40.00, "13": 8.40, "28": 40.00, "29": 8.40}'::jsonb or (d->>'46')::numeric <> 0 then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 8: el 1T desde el libro da %.', d;
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 8: el testigo de «deducida en» lleva la autoliquidada en la [28]/[29] del 1T (40,00 y 8,40), como el 303.';
end $$;

-- ── 9 · Otra cuenta no ──────────────────────────────────────────────────────
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
  begin
    perform public.conta_impuesto_303_desde_libro('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T');
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 9: otra cuenta ve el 303 de A desde el libro.';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 9: otra cuenta no lo ve.';
end $$;

-- ── 10 · Vuelta atrás (byte a byte) y otra vez hacia delante ────────────────
reset role;
\i supabase/vuelta-atras/20261125T0300_i01d_autoliquidaciones.down.sql
do $$
declare v_mal text;
begin
  select string_agg(f || ' ' || coalesce(md5(prosrc), 'no está'), '; ') into v_mal
    from (values ('public.conta_impuesto_303_calcular(uuid,integer,text)', '911debc83af0c4f782d1dc7138423661'),
                 ('public.conta_libro_iva_deducir_en(uuid,jsonb,integer,text,text)', '89e4fde383d80331d16c287a8059dada'),
                 ('public.conta_vat_book_desde_asiento(uuid)', 'f5570d0cdb353daaa5f4a8eb59c37662'),
                 ('public.conta_motivos_para_validar(uuid)', 'ed8b9e8c2e2a1740b4052ea9479d8520')) x(f, h)
    left join pg_proc p on p.oid = to_regprocedure(x.f)
   where md5(p.prosrc) is distinct from x.h;
  if v_mal is not null then raise exception 'PRUEBA AUTOLIQUIDACIONES · 10: la vuelta atrás no deja byte a byte: %', v_mal; end if;
  if to_regprocedure('public.conta_impuesto_303_desde_libro(uuid,integer,text)') is not null
     or to_regprocedure('public.conta_impuesto_303_cajas(public.vat_book_entry)') is not null
     or to_regprocedure('public.conta_proveedor_iva_clase(text,text,text,text,text)') is not null
     or to_regprocedure('public.conta_pais_nombre(text)') is not null then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 10: la vuelta atrás deja alguna función nueva.';
  end if;
end $$;
\i supabase/migrations/20261125T0300_i01d_autoliquidaciones.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_303_desde_libro(uuid,integer,text)') is null
     or (select prosrc from pg_proc where oid = 'public.conta_motivos_para_validar(uuid)'::regprocedure) not like '%0300%' then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 10: hacia delante otra vez no vuelve todo.';
  end if;
end $$;

-- ── 11 · La 0310 y su vuelta atrás, sin Foodint: no tocan nada ─────────────
do $$ begin perform set_config('prueba.proveedores', (select count(*)::text from public.supplier), true); end $$;
\i supabase/migrations/20261125T0310_i01d_proveedores_foodint.sql
\i supabase/vuelta-atras/20261125T0310_i01d_proveedores_foodint.down.sql
do $$ begin
  if (select count(*)::text from public.supplier) <> current_setting('prueba.proveedores') then
    raise exception 'PRUEBA AUTOLIQUIDACIONES · 11: sin Foodint, la 0310 o su vuelta atrás han tocado proveedores.';
  end if;
  raise notice 'PRUEBA AUTOLIQUIDACIONES · 11: sin Foodint, la 0310 y su vuelta atrás no tocan nada.';
end $$;

\echo '>>> PRUEBA AUTOLIQUIDACIONES (0300): en verde. ROLLBACK: staging no cambia.'
rollback;
