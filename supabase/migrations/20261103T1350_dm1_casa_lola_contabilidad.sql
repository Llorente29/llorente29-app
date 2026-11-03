-- supabase/migrations/20261103T1350_dm1_casa_lola_contabilidad.sql
--
-- DM1 · La contabilidad de demo de Casa Lola (03/11/2026). Encargo DM1·3
-- urgente: Julio enseña hoy Sumied a una gestoría con Casa Lola, la cuenta de
-- demostración, y Casa Lola no tiene contabilidad ninguna (ni empresa, ni plan,
-- ni un asiento: medido el 03/11 en producción, con su account_id).
--
-- Qué hace:
--   1. Crea public.demo_contabilidad_sembrar(cuenta): siembra la contabilidad de
--      una cuenta de demo (accounts.is_demo) que aún no tiene empresa. Solo la
--      llama la plataforma (ni authenticated ni anon). Sirve para la prueba de
--      staging (sobre un doble inventado) y, mañana, para «Restaurar la demo».
--   2. La llama para Casa Lola (623d946a…), después de marcarla como demo
--      (accounts.is_demo, la puerta del PR 2a: una cuenta de demo no manda nada
--      fuera). Si Casa Lola no está (staging), no hace nada y lo dice.
--
-- Todo va por los caminos de la app, como el administrador de la cuenta
-- («Demo Folvy», su primer administrador): el alta de la empresa, el plan
-- (company_chart_activate), los clientes y su 430, el cierre del día
-- (conta_proponer_dias, con las ventas de Folvy de la cuenta), las recibidas
-- (asiento como el de «se apunta sola»), el extracto (bank_importar), el
-- casado (bank_casar), el 303 (calcular, apuntar el justificante como
-- presentado fuera, contabilizar y casar su cargo). Así la cadena de huellas,
-- el libro de IVA y las pantallas salen solos, sin escribir a mano en ellos.
--
-- Todo inventado y que se ve inventado (T11): NIF de todo ceros con su control
-- (B00000018 la empresa; B00000026…B00000067 sus proveedores; B00000083,
-- B00000091 y B00000125 las plataformas), IBAN del banco 9999, CSV del 303
-- «DEMO…». Comprobados el 03/11 contra producción: no los tiene nadie.
--
-- Lo que NO lleva hoy (dicho a Julio): los PDF de las recibidas y el
-- justificante de un pago (son ficheros de Storage), las nóminas y «Restaurar
-- la demo» (el botón). Las ventas de Folvy de Casa Lola llegan al 08/10; del
-- 09/10 al 01/11 van cuatro asientos de ventas inventadas, por semana, con la
-- media diaria de septiembre de cada canal.
--
-- Solo toca la cuenta que recibe: cada consulta lleva su account_id (regla 9).
-- Vuelta atrás: supabase/vuelta-atras/20261103T1350_dm1_casa_lola_contabilidad.down.sql

create or replace function public.demo_contabilidad_sembrar(p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true);
  v_quien constant text := 'Demo Folvy';
  v_actor uuid; v_emp uuid; v_fy uuid; v_banco uuid; v_572 text; v_loc uuid; r record; x record; v jsonb; v_id uuid; v_e uuid;
  v_tipo10 uuid; v_tipo4 uuid; v_tipo21 uuid; v_477_10 text; v_472_4 text; v_472_10 text; v_472_21 text;
  v_ventas text; v_gasto text; v_comision text; v_bancarios text;
  v_dias int := 0; v_recibidas int := 0; v_liq int := 0; v_movs jsonb := '[]'::jsonb; v_casados int := 0; v_n int := 0;
  v_base numeric; v_iva numeric; v_total numeric; v_bruto numeric; v_neto numeric; v_com numeric; v_com_iva numeric;
  v_303 uuid; v_303_imp numeric; v_303_4t jsonb; v_saldo numeric := 25000; v_ini date := date '2026-08-01'; v_fin date := date '2026-11-02';
begin
  -- Las guardas: una cuenta de demo, sin empresa todavía.
  if not exists (select 1 from public.accounts a where a.id = p_account and a.is_demo) then
    raise exception 'DEMO: la cuenta % no está marcada como demo (accounts.is_demo): no se siembra.', p_account using errcode = '42501';
  end if;
  if exists (select 1 from public.company c where c.account_id = p_account) then
    raise exception 'DEMO: la cuenta % ya tiene empresa: no se siembra encima.', p_account using errcode = '23505';
  end if;
  select u.user_id into v_actor from public.user_profiles u
   where u.account_id = p_account and u.role = 'admin' and u.active order by u.created_at limit 1;
  if v_actor is null then raise exception 'DEMO: la cuenta % no tiene administrador.', p_account using errcode = 'P0002'; end if;
  select l.id into v_loc from public.locations l where l.account_id = p_account and l.active order by l.created_at limit 1;
  if v_loc is null then raise exception 'DEMO: la cuenta % no tiene local.', p_account using errcode = 'P0002'; end if;

  -- Como su administrador, en la cuenta.
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_account::text, true);

  -- 1 · La empresa, su perfil, el ejercicio 2026, el local, el banco y la serie.
  insert into public.company (account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
                              fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
                              setup_step, created_by)
  values (p_account, 'Casa Lola Restauración, S.L.', 'Casa Lola', 'B00000018', 'nif_es', 'company',
          'Calle', 'de la Demostración', '1', '28001', 'Madrid', 'Madrid', 'ES', 'nombre', v_actor)
  returning id into v_emp;
  insert into public.company_tax_profile (company_id, account_id, tax_territory, vat_period, chart_kind, account_digits, tax_forms, sales_tax_rate_code)
  values (v_emp, p_account, 'peninsula_baleares', 'quarterly', 'pymes', 8, array['111', '115', '200', '202', '303', '347', '390'], 'iva_reducido');
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, created_by)
  values (p_account, v_emp, 2026, date '2026-01-01', date '2026-12-31', v_actor) returning id into v_fy;
  update public.company set setup_step = 'hecho', setup_completed_at = now() where id = v_emp;
  insert into public.location_company (location_id, company_id, account_id, created_by)
  select l.id, v_emp, p_account, v_actor from public.locations l where l.account_id = p_account;
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default, created_by)
  values (p_account, v_emp, 'bank', 'Cuenta principal', 'ES8999990000150000000001', '572', true, v_actor) returning id into v_banco;
  insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, is_default, created_by)
  values (p_account, v_emp, 'F', 'Facturas', 'invoice', 6, true, v_actor);

  -- 2 · El plan (como «Activar el plan» de la pantalla) y la 572 del banco.
  perform public.company_chart_activate(v_emp, false, v_quien);
  v_572 := public.company_account_add(v_emp, '572', 'Banco · cuenta principal', null, 'bank_account', v_banco::text, v_quien)->>'code';

  select a.code into v_ventas from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.code like '700%' and a.kind = 'template' order by a.code limit 1;
  select a.code into v_gasto from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.code like '600%' and a.kind = 'template' order by a.code limit 1;
  select a.code into v_comision from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.code like '623%' and a.kind = 'template' order by a.code limit 1;
  select a.code into v_bancarios from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.code like '626%' and a.kind = 'template' order by a.code limit 1;
  for r in select t.id, t.rate, a.code, k.role from public.tax_rate t
             join public.company_account_link k on k.company_id = v_emp and k.account_id = p_account and k.entity = 'tax_rate' and k.entity_id = t.id::text
             join public.company_account a on a.id = k.company_account_id loop
    if r.rate = 10 then v_tipo10 := r.id; if r.role = 'repercutido' then v_477_10 := r.code; else v_472_10 := r.code; end if; end if;
    if r.rate = 4 and r.role = 'soportado' then v_tipo4 := r.id; v_472_4 := r.code; end if;
    if r.rate = 21 and r.role = 'soportado' then v_tipo21 := r.id; v_472_21 := r.code; end if;
  end loop;
  if v_477_10 is null or v_472_4 is null or v_472_10 is null or v_472_21 is null or v_ventas is null or v_gasto is null then
    raise exception 'DEMO: al plan le falta una cuenta (477/472 al 4, 10 o 21 %%, 700 o 600).';
  end if;

  -- 3 · Quién cobra cada canal (como «Plataformas» en Clientes y proveedores), con su 430.
  create temp table _demo_canal (canal uuid, slug text, party uuid, cuenta text, nombre text, nif text, comision numeric) on commit drop;
  insert into _demo_canal (canal, slug, nombre, nif, comision)
  select ch.id, ch.slug, k.nombre, k.nif, k.comision
    from public.sales_channel ch
    join (values ('glovo', 'Glovo', 'B00000083', 0.30), ('uber', 'Uber Eats', 'B00000091', 0.30), ('justeat', 'Just Eat', 'B00000125', 0.25),
                 ('shop', 'Clientes de la tienda online', null, 0.014), ('salon', 'Clientes del salón', null, 0.004)) k(slug, nombre, nif, comision)
      on k.slug = ch.slug
   where ch.account_id = p_account;
  for r in select * from _demo_canal loop
    v_id := (public.party_save_customer(p_account, null, r.nombre, r.nif, '{}'::jsonb, v_quien)->>'party_id')::uuid;
    perform public.party_add_role(v_id, 'platform', jsonb_build_object('channelId', r.canal));
    update _demo_canal set party = v_id,
           cuenta = public.company_account_add(v_emp, '4300', r.nombre, null, 'customer', v_id::text, v_quien)->>'code'
     where canal = r.canal;
  end loop;

  -- 4 · Los proveedores de Cocina, con su NIF (inventado) en la ficha y en su tercero.
  create temp table _demo_prov (supplier uuid, party uuid, cuenta text, nif text, pct numeric, base_mes numeric) on commit drop;
  insert into _demo_prov (supplier, nif, pct, base_mes)
  select s.id, k.nif, k.pct, k.base_mes
    from public.supplier s
    join (values ('Frutas y Verduras Hermanos Vega', 'B00000026', 4, 3850), ('Carnes Sierra Norte', 'B00000034', 10, 11900),
                 ('Pescados del Cantábrico', 'B00000042', 10, 8700), ('Distribuciones Castilla', 'B00000059', 10, 5600),
                 ('Bodegas y Bebidas Madrid', 'B00000067', 21, 6900), ('Panadería La Espiga', 'B00000075', 4, 1450)) k(nombre, nif, pct, base_mes)
      on k.nombre = s.name
   where s.account_id = p_account;
  update public.supplier s set tax_id = d.nif, tax_id_type = 'nif_es' from _demo_prov d where s.id = d.supplier and s.account_id = p_account and s.tax_id is null;
  update _demo_prov d set party = pr.party_id from public.party_role pr where pr.account_id = p_account and pr.role = 'supplier' and pr.supplier_id = d.supplier;
  update public.party p set tax_id = d.nif from _demo_prov d where p.id = d.party and p.account_id = p_account and p.tax_id is null;
  update _demo_prov d set cuenta = a.code
    from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v_emp and k.account_id = p_account and k.entity = 'supplier' and k.entity_id = d.supplier::text and k.role = 'principal';
  if exists (select 1 from _demo_prov where cuenta is null or party is null) then
    raise exception 'DEMO: a un proveedor le falta su subcuenta o su tercero.';
  end if;

  -- 5 · Las ventas de Folvy: el cierre del día las propone y se validan.
  perform public.conta_cerrar_dias(v_emp, now());
  v := public.conta_proponer_dias(v_emp, now());
  if (v->>'fallos')::int > 0 or (v->>'sin_propuesta')::int > 0 then
    raise exception 'DEMO: el cierre del día no propone todo: %', v;
  end if;
  for v_e in select e.id from public.journal_entry e where e.company_id = v_emp and e.account_id = p_account and e.status = 'propuesto' order by e.entry_date loop
    perform public.journal_entry_validar(v_e, v_quien);
    v_dias := v_dias + 1;
  end loop;

  -- 6 · Del 09/10 al 01/11, ventas inventadas por semana: la media diaria de septiembre de cada canal.
  for x in select * from (values (date '2026-10-09', date '2026-10-11'), (date '2026-10-12', date '2026-10-18'),
                                 (date '2026-10-19', date '2026-10-25'), (date '2026-10-26', date '2026-11-01')) s(desde, hasta) loop
    v := '[]'::jsonb; v_total := 0;
    for r in select c.cuenta, c.party, c.nombre,
                    round(coalesce((select sum(l.debit) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
                                     join public.company_account a on a.id = l.company_account_id
                                    where e.company_id = v_emp and e.account_id = p_account and e.status = 'validado' and e.source_type = 'sales_day'
                                      and e.entry_date between date '2026-09-01' and date '2026-09-30' and a.code = c.cuenta), 0) / 30
                          * (x.hasta - x.desde + 1), 2) as importe
               from _demo_canal c order by c.cuenta loop
      continue when r.importe = 0;
      v := v || jsonb_build_array(jsonb_build_object('cuenta', r.cuenta, 'debe', r.importe, 'tercero_id', r.party, 'local_id', v_loc,
                                                     'concepto', 'Cobra ' || r.nombre));
      v_total := v_total + r.importe;
    end loop;
    v_base := round(v_total / 1.10, 2); v_iva := v_total - v_base;
    v := v || jsonb_build_array(jsonb_build_object('cuenta', v_ventas, 'haber', v_base, 'local_id', v_loc, 'concepto', 'Ventas de tus marcas'),
                                jsonb_build_object('cuenta', v_477_10, 'haber', v_iva, 'local_id', v_loc, 'concepto', 'IVA repercutido 10 %',
                                                   'iva', jsonb_build_object('tipo_id', v_tipo10, 'base', v_base, 'libro', 'issued', 'facturas', 1)));
    v_e := (public.journal_entry_proponer(v_emp,
      jsonb_build_object('series', 1, 'fecha', x.hasta, 'source_type', 'manual', 'confianza', 'seguro',
                         'concepto', format('Ventas del %s al %s (resumen semanal de la demo)', to_char(x.desde, 'DD/MM'), to_char(x.hasta, 'DD/MM')),
                         'porque', 'Demo: ventas inventadas con la media diaria de septiembre de cada canal; las de Folvy llegan al 08/10.'),
      v, null, v_quien)->>'id')::uuid;
    perform public.journal_entry_validar(v_e, v_quien);
    v_dias := v_dias + 1;
  end loop;

  -- 7 · Las recibidas: una al mes de cada proveedor (agosto, septiembre y octubre), aprobadas y apuntadas.
  for r in select d.*, s.name, m.mes, m.k
             from _demo_prov d join public.supplier s on s.id = d.supplier and s.account_id = p_account
             cross join (values (date '2026-08-31', 0.92), (date '2026-09-30', 1.0), (date '2026-10-31', 1.06)) m(mes, k)
            order by m.mes, s.name loop
    v_base := round(r.base_mes * r.k, 2); v_iva := round(v_base * r.pct / 100, 2); v_total := v_base + v_iva;
    insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, due_date,
                                         status, match_status, source, arrival_channel, reading_confidence,
                                         tax_base_total, tax_total, grand_total, approved_at, approved_by, approved_by_name,
                                         created_at, updated_at, created_by, created_by_name, issuer_name, issuer_tax_id)
    values (p_account, v_emp, r.supplier, v_loc, 'invoice', format('DEMO-%s-%s', to_char(r.mes, 'YYMM'), right(r.nif, 3)), r.mes, r.mes + 30,
            'aprobada', 'ok', 'manual', 'correo', 'seguro', v_base, v_iva, v_total, r.mes + time '12:00', v_actor, v_quien,
            (r.mes + time '10:00') at time zone 'Europe/Madrid', (r.mes + time '12:00') at time zone 'Europe/Madrid', v_actor, v_quien,
            r.name, r.nif)
    returning id into v_id;
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
    values (p_account, v_id, case r.pct when 4 then v_tipo4 when 10 then v_tipo10 else v_tipo21 end, r.pct, v_base, v_iva);
    -- El asiento, como el de «se apunta sola» (_conta_factura_apuntar): gasto, su 472 con el libro y la subcuenta.
    v_e := (public.journal_entry_proponer(v_emp,
      jsonb_build_object('series', 2, 'fecha', r.mes, 'source_type', 'supplier_invoice', 'source_id', v_id, 'confianza', 'seguro',
                         'concepto', format('Factura %s · DEMO-%s-%s', r.name, to_char(r.mes, 'YYMM'), right(r.nif, 3)),
                         'porque', format('Factura de %s con todo en su ficha (gasto %s); cuadra al céntimo.', r.name, v_gasto),
                         'party_id', r.party, 'documento', format('DEMO-%s-%s', to_char(r.mes, 'YYMM'), right(r.nif, 3))),
      jsonb_build_array(
        jsonb_build_object('cuenta', v_gasto, 'debe', v_base, 'local_id', v_loc),
        jsonb_build_object('cuenta', case r.pct when 4 then v_472_4 when 10 then v_472_10 else v_472_21 end, 'debe', v_iva, 'local_id', v_loc,
                           'iva', jsonb_build_object('tipo_id', case r.pct when 4 then v_tipo4 when 10 then v_tipo10 else v_tipo21 end,
                                                     'base', v_base, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
        jsonb_build_object('cuenta', r.cuenta, 'haber', v_total, 'local_id', v_loc, 'tercero_id', r.party,
                           'documento', format('DEMO-%s-%s', to_char(r.mes, 'YYMM'), right(r.nif, 3)))),
      null, v_quien)->>'id')::uuid;
    perform public.journal_entry_validar(v_e, v_quien);
    update public.supplier_invoice set journal_entry_id = v_e where id = v_id and account_id = p_account;
    v_recibidas := v_recibidas + 1;
    -- Su pago por el banco el día 10 del mes siguiente (la de octubre, por pagar: vence el 30/11).
    if r.mes < date '2026-10-31' then
      v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', r.mes + 10, 'importe', -v_total,
        'concepto', 'TRANSFERENCIA A ' || upper(r.name), 'clase', 'factura', 'id', v_id, 'cuenta', r.cuenta, 'tercero', r.party));
    end if;
  end loop;

  -- 8 · Lo que pagan las plataformas y la tienda: la liquidación del mes (bruto al 430, comisión y su IVA, neto al banco).
  for r in select c.*, m.desde, m.hasta from _demo_canal c
             cross join (values (date '2026-08-01', date '2026-08-31'), (date '2026-09-01', date '2026-09-30'), (date '2026-10-01', date '2026-11-01')) m(desde, hasta)
            where c.slug in ('glovo', 'uber', 'justeat', 'shop') order by m.desde, c.slug loop
    select coalesce(sum(l.debit), 0) into v_bruto from public.journal_line l join public.journal_entry e on e.id = l.entry_id
      join public.company_account a on a.id = l.company_account_id
     where e.company_id = v_emp and e.account_id = p_account and e.status = 'validado' and e.entry_date between r.desde and r.hasta and a.code = r.cuenta;
    continue when v_bruto = 0;
    v_com := round(v_bruto * r.comision, 2);
    v_com_iva := case when r.slug = 'shop' then 0 else round(v_com * 0.21, 2) end;
    v_neto := v_bruto - v_com - v_com_iva;
    v := jsonb_build_array(jsonb_build_object('cuenta', v_572, 'debe', v_neto, 'concepto', 'Pago de ' || r.nombre),
                           jsonb_build_object('cuenta', case when r.slug = 'shop' then v_bancarios else v_comision end, 'debe', v_com, 'local_id', v_loc,
                                              'concepto', case when r.slug = 'shop' then 'Comisión de la pasarela de pago' else 'Comisión de ' || r.nombre end));
    if v_com_iva > 0 then
      v := v || jsonb_build_array(jsonb_build_object('cuenta', v_472_21, 'debe', v_com_iva, 'local_id', v_loc, 'tercero_id', r.party,
                                                     'documento', format('DEMO-LIQ-%s-%s', upper(r.slug), to_char(r.desde, 'YYMM')),
                                                     'iva', jsonb_build_object('tipo_id', v_tipo21, 'base', v_com, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)));
    end if;
    v := v || jsonb_build_array(jsonb_build_object('cuenta', r.cuenta, 'haber', v_bruto, 'tercero_id', r.party,
                                                   'concepto', format('Ventas del %s al %s', to_char(r.desde, 'DD/MM'), to_char(r.hasta, 'DD/MM'))));
    v_e := (public.journal_entry_proponer(v_emp,
      jsonb_build_object('series', 1, 'fecha', least(r.hasta + 3, v_fin), 'source_type', 'manual', 'confianza', 'seguro', 'party_id', r.party,
                         'concepto', format('Liquidación de %s del %s al %s', r.nombre, to_char(r.desde, 'DD/MM'), to_char(r.hasta, 'DD/MM/YYYY')),
                         'porque', format('Demo: lo vendido por %s en el periodo, menos su comisión (%s %%)%s.', r.nombre, round(r.comision * 100, 1),
                                          case when v_com_iva > 0 then ' y su IVA' else '' end),
                         'documento', format('DEMO-LIQ-%s-%s', upper(r.slug), to_char(r.desde, 'YYMM'))),
      v, null, v_quien)->>'id')::uuid;
    perform public.journal_entry_validar(v_e, v_quien);
    v_liq := v_liq + 1;
    v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', least(r.hasta + 3, v_fin), 'importe', v_neto,
      'concepto', 'TRANSF. RECIBIDA ' || upper(r.nombre) || ' LIQUIDACION ' || to_char(r.desde, 'MM/YYYY'), 'clase', 'asiento', 'asiento', v_e));
  end loop;

  -- 9 · El salón: el abono del datáfono cada lunes (lo de la semana anterior) y su comisión al mes.
  select c.* into r from _demo_canal c where c.slug = 'salon';
  if r.cuenta is not null then
    for x in select g::date as lunes from generate_series(timestamp '2026-08-17', timestamp '2026-11-02', interval '7 days') g loop
      select coalesce(sum(l.debit), 0) into v_bruto from public.journal_line l join public.journal_entry e on e.id = l.entry_id
        join public.company_account a on a.id = l.company_account_id
       where e.company_id = v_emp and e.account_id = p_account and e.status = 'validado' and e.source_type in ('sales_day', 'manual')
         and e.entry_date between x.lunes - 7 and x.lunes - 1 and a.code = r.cuenta and l.debit > 0;
      continue when v_bruto = 0;
      v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', x.lunes, 'importe', v_bruto,
        'concepto', 'ABONO TPV COMERCIO DEMO ' || to_char(x.lunes - 7, 'DD/MM') || '-' || to_char(x.lunes - 1, 'DD/MM'),
        'clase', 'cuenta', 'cuenta', r.cuenta, 'tercero', r.party));
    end loop;
    for x in select * from (values (date '2026-08-31', date '2026-08-01'), (date '2026-09-30', date '2026-09-01'), (date '2026-10-31', date '2026-10-01')) m(fin, ini) loop
      select round(coalesce(sum(l.debit), 0) * r.comision, 2) into v_com from public.journal_line l join public.journal_entry e on e.id = l.entry_id
        join public.company_account a on a.id = l.company_account_id
       where e.company_id = v_emp and e.account_id = p_account and e.status = 'validado' and e.entry_date between x.ini and x.fin and a.code = r.cuenta and l.debit > 0;
      continue when v_com = 0;
      v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', x.fin, 'importe', -v_com,
        'concepto', 'COMISIONES TPV ' || to_char(x.ini, 'MM/YYYY'), 'clase', 'gasto', 'cuenta', v_bancarios));
    end loop;
  end if;

  -- 10 · El 303 del tercer trimestre: calcular (con lo de julio a septiembre ya en el libro).
  v := public.conta_impuesto_303_calcular(v_emp, 2026, '3T');
  -- Sin el 2T en Sumied, lo que quedaba por compensar ([110]) no se sabe: se dice a mano, como la persona.
  if not coalesce((v->>'sabido')::boolean, false) and nullif(v->>'declaracion', '') is not null then
    perform public.conta_impuesto_casillas_poner((v->>'declaracion')::uuid, jsonb_build_object('110', 0),
      'Demo: del 2T no quedaba nada por compensar (Casa Lola empieza en Sumied en el tercer trimestre).');
    v := public.conta_impuesto_303_calcular(v_emp, 2026, '3T');
  end if;
  -- Su resultado, con su signo: la [71] (positivo, a ingresar; negativo, a compensar).
  v_303 := nullif(v->>'declaracion', '')::uuid;
  v_303_imp := (v->'casillas'->>'71')::numeric;
  if v_303 is null or v_303_imp is null then raise exception 'DEMO: el 303 del 3T no ha salido: %', v; end if;
  if v_303_imp > 0 then
    v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', date '2026-10-20', 'importe', -v_303_imp,
      'concepto', 'IMPUESTOS AEAT MODELO 303 3T 2026', 'clase', 'impuesto'));
  end if;

  -- Y dos sin casar, para que la demo enseñe qué pide la mano.
  v_movs := v_movs || jsonb_build_array(
    jsonb_build_object('fecha', date '2026-10-28', 'importe', -186.40, 'concepto', 'RECIBO SEGURO MULTIRRIESGO LOCAL POLIZA DEMO-0001', 'clase', 'suelto'),
    jsonb_build_object('fecha', date '2026-10-30', 'importe', 350.00, 'concepto', 'TRANSF. RECIBIDA DEVOLUCION FIANZA DEMO', 'clase', 'suelto'));

  -- 11 · El extracto, de una vez (como «Subir extracto»), con su saldo.
  create temp table _demo_mov on commit drop as
  select row_number() over (order by (m->>'fecha')::date, (m->>'importe')::numeric desc, m->>'concepto') as n, m
    from jsonb_array_elements(v_movs) m;
  select coalesce(sum((m->>'importe')::numeric), 0) into v_total from _demo_mov;
  v := public.bank_importar(v_banco, 'fichero', 'norma43', 'extracto-demo-casa-lola.n43', md5('demo-casa-lola-' || p_account::text) || md5('extracto-' || p_account::text), v_ini, v_fin,
    v_saldo, v_saldo + v_total, null, 'ES8999990000150000000001',
    (select jsonb_agg(jsonb_build_object('fecha', m->>'fecha', 'importe', (m->>'importe')::numeric, 'concepto_banco', m->>'concepto',
                                         'concepto_limpio', m->>'concepto', 'huella', md5('demo|' || n || '|' || (m->>'fecha') || '|' || (m->>'importe')),
                                         'huella_suave', md5('demo-suave|' || n)) order by n) from _demo_mov));

  -- 12 · El casado: cada movimiento con lo suyo, menos los dos sueltos.
  for x in select d.m, b.id as mov from _demo_mov d
             join public.bank_movement b on b.account_id = p_account and b.treasury_account_id = v_banco
                                        and b.fingerprint = md5('demo|' || d.n || '|' || (d.m->>'fecha') || '|' || (d.m->>'importe'))
            where d.m->>'clase' not in ('suelto', 'impuesto') order by d.n loop
    if x.m->>'clase' = 'factura' then
      perform public.bank_casar(x.mov, jsonb_build_object('tipo', 'factura_recibida', 'cuenta_tercero', x.m->>'cuenta', 'tercero_id', x.m->>'tercero',
        'facturas', jsonb_build_array(jsonb_build_object('id', x.m->>'id', 'importe', -(x.m->>'importe')::numeric))),
        'seguro', 'El importe y el proveedor son los de su factura.', '[]'::jsonb, 'persona', null);
    elsif x.m->>'clase' = 'asiento' then
      perform public.bank_casar(x.mov, jsonb_build_object('tipo', 'asiento', 'entry_id', x.m->>'asiento'),
        'seguro', 'Es el neto de su liquidación.', '[]'::jsonb, 'persona', null);
    else
      perform public.bank_casar(x.mov, jsonb_build_object('tipo', 'cuenta', 'tercero_id', x.m->>'tercero',
        'lineas', jsonb_build_array(jsonb_build_object('cuenta', x.m->>'cuenta', 'importe', abs((x.m->>'importe')::numeric)))),
        'seguro', case when x.m->>'clase' = 'gasto' then 'La comisión del datáfono del mes.' else 'Lo cobrado con tarjeta en el salón esa semana.' end,
        '[]'::jsonb, 'persona', null);
    end if;
    v_casados := v_casados + 1;
  end loop;

  -- Los asientos que ha propuesto el casado, validados (como «Validar» en el Diario).
  for v_e in select e.id from public.journal_entry e where e.company_id = v_emp and e.account_id = p_account and e.status = 'propuesto' order by e.entry_date, e.created_at loop
    perform public.journal_entry_validar(v_e, v_quien);
  end loop;

  -- 13 · El 303 del 3T, presentado (fuera, con su justificante apuntado), contabilizado y su cargo casado.
  perform public.conta_impuesto_justificante_apuntar(v_emp, jsonb_build_object(
    'modelo', '303', 'ejercicio', 2026, 'periodo', '3T', 'presentada', '2026-10-19', 'csv', 'DEMO000000000000', 'justificante', '3030000000001',
    'nif', 'B00000018', 'resultado', v_303_imp,
    'casillas', (select jsonb_object_agg(b.box, b.value) from public.tax_return_box b where b.tax_return_id = v_303 and b.account_id = p_account and b.value is not null)));
  perform public.conta_impuesto_303_contabilizar(v_303);
  if v_303_imp > 0 then
    select b.id into v_id from public.bank_movement b where b.account_id = p_account and b.treasury_account_id = v_banco
       and b.op_date = date '2026-10-20' and b.amount = -v_303_imp limit 1;
    perform public.conta_impuesto_casar_cargo(v_303, v_id);
    v_casados := v_casados + 1;
  end if;

  -- 14 · El 303 del cuarto trimestre, en borrador.
  v_303_4t := public.conta_impuesto_303_calcular(v_emp, 2026, '4T');

  select count(*) into v_n from public.journal_entry e where e.company_id = v_emp and e.account_id = p_account and e.status = 'validado';
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return jsonb_build_object('empresa', v_emp, 'asientos', v_n, 'dias_de_ventas', v_dias, 'recibidas', v_recibidas, 'liquidaciones', v_liq,
                            'movimientos', (select count(*) from _demo_mov), 'casados', v_casados, 'sin_casar', 2,
                            'iva_3t', v_303_imp, 'iva_4t', v_303_4t);
end $$;
comment on function public.demo_contabilidad_sembrar(uuid) is
  'DM1 (03/11/2026). Siembra la contabilidad de demo de una cuenta de demo (accounts.is_demo) sin empresa, por los caminos de la app y como su administrador. Solo la plataforma.';
revoke all on function public.demo_contabilidad_sembrar(uuid) from public, anon, authenticated;

-- Casa Lola: la marca de demo y su contabilidad. En staging no está: no se hace nada.
do $$
declare v_casa_lola constant uuid := '623d946a-a0ce-4f34-8c00-9761dfed8331'; v jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_casa_lola) then
    raise notice 'DEMO: no está Casa Lola (esto no es producción): no se siembra nada.';
    return;
  end if;
  update public.accounts set is_demo = true where id = v_casa_lola and is_demo is not true;
  v := public.demo_contabilidad_sembrar(v_casa_lola);
  raise notice 'DEMO · Casa Lola: %', v;
end $$;
