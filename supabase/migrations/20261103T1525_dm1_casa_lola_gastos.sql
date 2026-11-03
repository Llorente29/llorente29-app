-- cambia: public.demo_contabilidad_sembrar · prueba: supabase/staging/sql/20261103_dm1_casa_lola_gastos_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261103_dm1_casa_lola_gastos_prueba.sql
-- cambia: public.journal_line · prueba: supabase/staging/sql/20261103_dm1_casa_lola_gastos_prueba.sql
-- (journal_entry y journal_line: solo se apaga y se enciende su candado de «inalterable» para borrar los asientos
-- de Casa Lola, como _conta_asientos_borrar del S01q. Hasta el final de la transacción, las demás cuentas leen
-- pero esperan para escribir asientos: el ensayo del #460 tardó unos 9 s.)
--
-- supabase/migrations/20261103T1525_dm1_casa_lola_gastos.sql
--
-- DM1·6 (03/11/2026) · Casa Lola con los gastos de un restaurante de verdad. Encargo de Julio: «personal con su
-- 111, alquiler con retención y su 115, luz, agua, gas y seguros, de julio a hoy, para que el saldo del banco
-- quede en una cifra normal; los controles, en verde; contabiliza también el 303 del 3T y casa su cargo».
-- Con la semilla del #460 el banco acababa en 299.765,79 €: había ventas y compras, pero ni nóminas, ni alquiler,
-- ni suministros.
--
-- Por qué se borra y se siembra otra vez, y no se añade encima: el 303 del 3T de Casa Lola ya está presentado.
-- Una recibida de julio a septiembre que llegara ahora se asentaría en el primer día abierto (el candado del IVA,
-- 1233), en el 4T. Como Casa Lola es una cuenta de demo (accounts.is_demo), su contabilidad se vuelve a hacer
-- entera, en orden, con el 303 calculado al final. Es lo mismo que hará «Restaurar la demo».
--
--   1. BORRA la contabilidad de Casa Lola (solo si es de demo): todo lo de su empresa, como la vuelta atrás de la
--      1350. Los asientos validados no se dejan borrar: se apaga trg_journal_entry_inalterable solo durante el
--      borrado, como _conta_asientos_borrar (S01q, 1837). Necesita «autorizo».
--   2. CAMBIA demo_contabilidad_sembrar (misma firma): además de lo de la 1350,
--        · los modelos 111, 115, 180 y 190 en su perfil (la regla 111→190 y 115→180 de «Datos maestros» mira
--          los modelos que presenta, no si ya toca: el 190 y el 180 se presentan en enero, y los presenta);
--        · cinco acreedores nuevos, inventados (NIF B00000133…B00000174): el arrendador (7.000 € al mes, IVA y
--          retención del 19 %, 115), luz, agua, gas y seguro, de julio a octubre, pagados por el banco;
--        · el personal: 18 personas, la nómina de cada mes de julio a octubre (payroll_summary; la propone el
--          cierre de nóminas, se valida), el líquido pagado a fin de mes y los seguros sociales al mes siguiente;
--        · la 4751 con su modelo (la 47510000, el 111; una nueva, el 115, con la retención de alquileres);
--        · el extracto desde el 01/07;
--        · el 303, el 111 y el 115 del 3T presentados fuera (justificante apuntado), el 303 contabilizado (#463:
--          el «Libro diario» ya no pone en rojo su liquidación) y los tres cargos del 20/10 casados; los del 4T,
--          en borrador.
--   3. SIEMBRA Casa Lola otra vez. Si Casa Lola no está (staging), no hace nada y lo dice.
--
-- Todo inventado y que se ve inventado (T11), comprobado el 03/11 contra producción.
-- Solo toca Casa Lola: cada consulta lleva su account_id (regla 9). Fuera del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261103T1525_dm1_casa_lola_gastos.down.sql (borra y siembra con la de
-- la 1350, tal cual estaba).
set local lock_timeout = '10s';
-- Lo diferido, antes de tocar los candados (ALTER TABLE no se deja con disparadores pendientes).
set constraints all immediate;

-- ── 1 · Borrar la contabilidad de demo de Casa Lola ─────────────────────────
do $$
declare
  -- Casa Lola. La prueba de staging la apunta a su doble con demo.cuenta; en producción no la pone nadie.
  v_acc constant uuid := coalesce(nullif(current_setting('demo.cuenta', true), ''), '623d946a-a0ce-4f34-8c00-9761dfed8331')::uuid;
  v_emp uuid; r record; v_n bigint; v_pasada int := 0; v_hecho boolean; v_quedan text[]; v_partes uuid[];
begin
  -- Solo una cuenta de demo: nunca la contabilidad de una cuenta de verdad.
  if not exists (select 1 from public.accounts where id = v_acc and is_demo) then
    raise notice 'DEMO · borrar: la cuenta % no está o no es de demo: no se borra nada.', v_acc;
    return;
  end if;
  select id into v_emp from public.company where account_id = v_acc;
  if v_emp is not null then
    -- Los terceros que creó la semilla para cobrar cada canal (su 430).
    select coalesce(array_agg(distinct k.entity_id::uuid), '{}') into v_partes from public.company_account_link k
     where k.account_id = v_acc and k.company_id = v_emp and k.entity = 'customer';

    alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
    alter table public.journal_line disable trigger trg_journal_line_inalterable;

    -- Lo que cuelga sin company_id.
    delete from public.bank_match_item i where i.account_id = v_acc
       and i.match_id in (select m.id from public.bank_match m where m.account_id = v_acc and m.company_id = v_emp);
    delete from public.supplier_invoice_tax x where x.account_id = v_acc
       and x.supplier_invoice_id in (select s.id from public.supplier_invoice s where s.account_id = v_acc and s.company_id = v_emp);
    delete from public.supplier_invoice_payment_log x where x.account_id = v_acc
       and x.invoice_id in (select s.id from public.supplier_invoice s where s.account_id = v_acc and s.company_id = v_emp);

    -- Cada tabla con company_id, por pasadas, hasta que no quede nada de la empresa.
    loop
      v_pasada := v_pasada + 1; v_hecho := false; v_quedan := '{}';
      for r in select c.table_name from information_schema.columns c
                 join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
                where c.table_schema = 'public' and c.column_name = 'company_id' and c.table_name <> 'company'
                  and exists (select 1 from information_schema.columns a where a.table_schema = 'public' and a.table_name = c.table_name and a.column_name = 'account_id')
                order by c.table_name loop
        execute format('select count(*) from public.%I where account_id = $1 and company_id = $2', r.table_name) into v_n using v_acc, v_emp;
        continue when v_n = 0;
        begin
          execute format('delete from public.%I where account_id = $1 and company_id = $2', r.table_name) using v_acc, v_emp;
          v_hecho := true;
        exception when foreign_key_violation then
          v_quedan := v_quedan || r.table_name;
        end;
      end loop;
      exit when cardinality(v_quedan) = 0;
      if not v_hecho or v_pasada > 20 then
        raise exception 'DEMO · borrar: quedan filas de la empresa de Casa Lola que otra tabla sujeta: %', v_quedan;
      end if;
    end loop;

    alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
    alter table public.journal_line enable trigger trg_journal_line_inalterable;

    delete from public.customer_fiscal f where f.account_id = v_acc and f.party_id = any (v_partes);
    delete from public.party_role pr where pr.account_id = v_acc and pr.party_id = any (v_partes);
    delete from public.party p where p.account_id = v_acc and p.id = any (v_partes);
    delete from public.company where account_id = v_acc and id = v_emp;
  end if;

  if exists (select 1 from public.company where account_id = v_acc) then
    raise exception 'DEMO · borrar: la cuenta % sigue con empresa.', v_acc;
  end if;
end $$;

-- ── 2 · La semilla, con los gastos ──────────────────────────────────────────
-- La de antes, respaldada para la vuelta atrás (_restaurar_funcion con su huella).
select public._respaldar_funcion('public.demo_contabilidad_sembrar(uuid)', '20261103T1525_dm1_casa_lola_gastos')
 where to_regprocedure('public.demo_contabilidad_sembrar(uuid)') is not null;
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
  v_303 uuid; v_303_imp numeric; v_303_4t jsonb; v_saldo numeric := 10000; v_ini date := date '2026-07-01';
  v_4751_115 text; v_ret_alq uuid; v_465 text; v_476 text; v_ret numeric; v_pago date;
  v_111 uuid; v_111_imp numeric; v_115 uuid; v_115_imp numeric; v_r111 jsonb; v_r115 jsonb; v_4t jsonb := '{}'::jsonb; v_fin date := date '2026-11-02';
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

  -- Las de trabajo de una siembra anterior en la misma transacción (la prueba de staging siembra varias veces).
  drop table if exists _demo_canal, _demo_prov, _demo_gasto, _demo_mov;

  -- Como su administrador, en la cuenta.
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_account::text, true);

  -- 1 · La empresa, su perfil, el ejercicio 2026, el local, el banco y la serie.
  insert into public.company (account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
                              fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
                              legal_form_code, incorporated_on, registry_name, registry_volume, registry_folio, registry_sheet, registry_entry,
                              phone, email, dehu_email, setup_step, created_by)
  values (p_account, 'Casa Lola Restauración, S.L.', 'Casa Lola', 'B00000018', 'nif_es', 'company',
          'Calle', 'de la Demostración', '1', '28001', 'Madrid', 'Madrid', 'ES',
          -- Lo que piden el 200 y el depósito de cuentas, inventado y que se ve inventado (T11).
          'nif_b', date '2024-01-15', 'Registro Mercantil de Madrid', '00000', '1', 'M-000000', '1',
          '900000000', 'contabilidad.casalola@example.invalid', 'notificaciones.casalola@example.invalid', 'nombre', v_actor)
  returning id into v_emp;
  insert into public.company_tax_profile (company_id, account_id, tax_territory, vat_period, chart_kind, account_digits, tax_forms, sales_tax_rate_code)
  values (v_emp, p_account, 'peninsula_baleares', 'quarterly', 'pymes', 8, array['111', '115', '180', '190', '200', '202', '303', '347', '390'], 'iva_reducido');
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, created_by)
  values (p_account, v_emp, 2026, date '2026-01-01', date '2026-12-31', v_actor) returning id into v_fy;
  update public.fiscal_year set average_staff_fixed = 15, average_staff_temporary = 3, is_audited = false where id = v_fy and account_id = p_account;
  -- La actividad (CNAE 5611, restaurantes) y la administradora y socia única, inventada (DNI de todo ceros).
  insert into public.company_activity (account_id, company_id, kind, iae_code, cnae_version, cnae_code, description, started_on, is_main, created_by)
  values (p_account, v_emp, 'business', '1_6714', '2025', '5611', 'Restaurante de dos tenedores', date '2024-01-15', true, v_actor);
  insert into public.company_person (account_id, company_id, full_name, tax_id, roles, ownership_pct, started_on, signs_accounts, created_by)
  values (p_account, v_emp, 'Administradora Demo', '00000000T', array['administrator', 'partner'], 100, date '2024-01-15', true, v_actor);
  update public.company set setup_step = 'hecho', setup_completed_at = now() where id = v_emp;
  insert into public.location_company (location_id, company_id, account_id, created_by)
  select l.id, v_emp, p_account, v_actor from public.locations l where l.account_id = p_account;
  -- Con su local (Casa Lola tiene uno): lo que se casa con el banco lleva local, no «común» sin reparto.
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default, created_by, location_id)
  values (p_account, v_emp, 'bank', 'Cuenta principal', 'ES8999990000150000000001', '572', true, v_actor, v_loc) returning id into v_banco;
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

  -- 4b · Los gastos fijos de un restaurante (DM1·6): el arrendador (alquiler con retención, 115), la luz,
  -- el agua, el gas y el seguro. Proveedores nuevos de Casa Lola, inventados, con su subcuenta de acreedor (410).
  create temp table _demo_gasto (supplier uuid, party uuid, cuenta text, nombre text, legal text, nif text, pct numeric, base_mes numeric,
                                 gasto text, dia text, ret boolean, pago int, cobro text) on commit drop;
  insert into _demo_gasto (nombre, legal, nif, pct, base_mes, gasto, dia, ret, pago, cobro)
  values ('Inmuebles Demo', 'Inmuebles Demo Lavapiés, S.L.', 'B00000133', 21, 7000, '621', 'inicio', true, 2, 'transfer'),
         ('Eléctrica Demo', 'Eléctrica Demo, S.A.', 'B00000141', 21, 2400, '628', 'fin', false, 8, 'direct_debit'),
         ('Aguas Demo', 'Aguas Demo, S.A.', 'B00000158', 10, 260, '628', 'fin', false, 8, 'direct_debit'),
         ('Gas Demo', 'Gas Demo Distribución, S.L.', 'B00000166', 21, 720, '628', 'fin', false, 8, 'direct_debit'),
         ('Seguros Demo', 'Seguros Demo, S.A.', 'B00000174', 0, 310, '625', 'inicio', false, 5, 'direct_debit');
  for r in select * from _demo_gasto loop
    select s.id into v_id from public.supplier s where s.account_id = p_account and s.name = r.nombre;
    if v_id is null then
      insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, default_location_id, payment_method, payment_terms_days,
                                   invoicing_frequency, created_by_name)
      values (p_account, r.nombre, r.legal, r.nif, 'nif_es', v_loc, r.cobro, 0, 'monthly', v_quien) returning id into v_id;
    end if;
    update _demo_gasto set supplier = v_id,
           party = (select pr.party_id from public.party_role pr where pr.account_id = p_account and pr.role = 'supplier' and pr.supplier_id = v_id limit 1),
           gasto = (select a.code from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.kind = 'template'
                     and a.template_code = r.gasto order by a.code limit 1),
           -- Su subcuenta: la que ya le dio el plan si existía (al restaurar la demo), o una de acreedor nueva.
           cuenta = coalesce((select a.code from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                               where k.company_id = v_emp and k.account_id = p_account and k.entity = 'supplier' and k.entity_id = v_id::text
                                 and k.role = 'principal' limit 1),
                             public.company_account_add(v_emp, '4100', r.nombre, null, 'supplier', v_id::text, v_quien)->>'code')
     where nombre = r.nombre;
  end loop;
  update public.party p set tax_id = g.nif from _demo_gasto g where p.id = g.party and p.account_id = p_account and p.tax_id is null;
  if exists (select 1 from _demo_gasto where cuenta is null or party is null or gasto is null) then
    raise exception 'DEMO: a un gasto le falta su subcuenta, su tercero o su cuenta de gasto.';
  end if;
  -- Las retenciones, cada una en su subcuenta de la 4751 con su modelo (como Foodint, S01d 0901): la del plan para
  -- el 111 y una nueva para el 115, con la retención de alquileres enlazada a ella.
  update public.company_account set withholding_model = '111'
   where company_id = v_emp and account_id = p_account and code = '47510000' and withholding_model is null;
  v_4751_115 := public.company_account_add(v_emp, '4751', 'Retenciones de alquileres (modelo 115)', null, null, null, v_quien)->>'code';
  update public.company_account set withholding_model = '115' where company_id = v_emp and account_id = p_account and code = v_4751_115;
  select w.id into v_ret_alq from public.withholding_rate w where w.is_system and w.filed_in = '115' and w.code = 'alquiler' and w.valid_to is null limit 1;
  perform public.company_account_link_set(v_emp, 'withholding_rate', v_ret_alq::text, 'principal',
    (select a.id from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.code = v_4751_115), v_quien);
  select a.code into v_465 from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.kind = 'template' and a.template_code = '465' limit 1;
  select a.code into v_476 from public.company_account a where a.company_id = v_emp and a.account_id = p_account and a.kind = 'template' and a.template_code = '476' limit 1;

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

  -- 7b · Los gastos fijos, de julio a octubre: cada factura aprobada y apuntada (como las de Cocina), el
  -- alquiler con su retención del 19 % (115). Se pagan por el banco: el alquiler por transferencia a los dos
  -- días, lo demás domiciliado a los cinco u ocho; lo que vence después del 02/11, por pagar.
  for r in select g.*, m.mes from _demo_gasto g
             cross join (values (date '2026-07-01'), (date '2026-08-01'), (date '2026-09-01'), (date '2026-10-01')) m(mes)
            order by m.mes, g.nombre loop
    v_base := round(r.base_mes * case extract(month from r.mes) when 7 then 0.95 when 8 then 1.08 when 9 then 1.0 else 0.97 end, 2);
    if r.ret then v_base := r.base_mes; end if;
    v_iva := round(v_base * r.pct / 100, 2);
    v_ret := case when r.ret then round(v_base * 0.19, 2) else 0 end;
    v_total := v_base + v_iva - v_ret;
    v_pago := (case when r.dia = 'inicio' then r.mes else (r.mes + interval '1 month - 1 day')::date end);
    insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, due_date,
                                         status, match_status, source, arrival_channel, reading_confidence,
                                         tax_base_total, tax_total, grand_total, withholding_rate_id, withholding_amount, withholding_base,
                                         approved_at, approved_by, approved_by_name,
                                         created_at, updated_at, created_by, created_by_name, issuer_name, issuer_tax_id)
    values (p_account, v_emp, r.supplier, v_loc, 'invoice', format('DEMO-%s-%s', to_char(r.mes, 'YYMM'), right(r.nif, 3)), v_pago, v_pago + r.pago,
            'aprobada', 'ok', 'manual', 'correo', 'seguro', v_base, v_iva, v_total,
            case when r.ret then v_ret_alq end, nullif(v_ret, 0), case when r.ret then v_base end,
            v_pago + time '12:00', v_actor, v_quien,
            (v_pago + time '10:00') at time zone 'Europe/Madrid', (v_pago + time '12:00') at time zone 'Europe/Madrid', v_actor, v_quien,
            r.legal, r.nif)
    returning id into v_id;
    if r.pct > 0 then
      insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
      values (p_account, v_id, case r.pct when 10 then v_tipo10 else v_tipo21 end, r.pct, v_base, v_iva);
    end if;
    v := jsonb_build_array(jsonb_build_object('cuenta', r.gasto, 'debe', v_base, 'local_id', v_loc));
    if r.pct > 0 then
      v := v || jsonb_build_array(jsonb_build_object('cuenta', case r.pct when 10 then v_472_10 else v_472_21 end, 'debe', v_iva, 'local_id', v_loc,
                 'iva', jsonb_build_object('tipo_id', case r.pct when 10 then v_tipo10 else v_tipo21 end, 'base', v_base, 'libro', 'received',
                                           'deducible', 'yes', 'facturas', 1)));
    end if;
    if r.ret then
      v := v || jsonb_build_array(jsonb_build_object('cuenta', v_4751_115, 'haber', v_ret, 'local_id', v_loc, 'concepto', 'Retención del alquiler (19 %)',
                 'retencion', jsonb_build_object('tipo_id', v_ret_alq, 'base', v_base, 'modelo', '115')));
    end if;
    v := v || jsonb_build_array(jsonb_build_object('cuenta', r.cuenta, 'haber', v_total, 'local_id', v_loc, 'tercero_id', r.party,
                                                   'documento', format('DEMO-%s-%s', to_char(r.mes, 'YYMM'), right(r.nif, 3))));
    v_e := (public.journal_entry_proponer(v_emp,
      jsonb_build_object('series', 2, 'fecha', v_pago, 'source_type', 'supplier_invoice', 'source_id', v_id, 'confianza', 'seguro',
                         'concepto', format('Factura %s · DEMO-%s-%s', r.nombre, to_char(r.mes, 'YYMM'), right(r.nif, 3)),
                         'porque', format('Factura de %s con todo en su ficha (gasto %s)%s; cuadra al céntimo.', r.nombre, r.gasto,
                                          case when r.ret then ', con la retención del alquiler al 19 % (115)' else '' end),
                         'party_id', r.party, 'documento', format('DEMO-%s-%s', to_char(r.mes, 'YYMM'), right(r.nif, 3))),
      v, null, v_quien)->>'id')::uuid;
    perform public.journal_entry_validar(v_e, v_quien);
    update public.supplier_invoice set journal_entry_id = v_e where id = v_id and account_id = p_account;
    v_recibidas := v_recibidas + 1;
    if v_pago + r.pago <= v_fin then
      v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', v_pago + r.pago, 'importe', -v_total,
        'concepto', case when r.cobro = 'transfer' then 'TRANSFERENCIA A ' else 'RECIBO DOMICILIADO ' end || upper(r.legal) || ' ' || to_char(r.mes, 'MM/YYYY'),
        'clase', 'factura', 'id', v_id, 'cuenta', r.cuenta, 'tercero', r.party));
    end if;
  end loop;

  -- 7c · El personal (DM1·6): 18 personas, la nómina del mes como la manda la gestoría (payroll_summary, que el
  -- cierre de nóminas propone solo), validada. El líquido se paga el último día del mes; los seguros sociales,
  -- el último del mes siguiente (los de octubre, por pagar).
  for x in select m.mes, round(36000 * m.k, 2) as bruto from (values (date '2026-07-01', 0.90), (date '2026-08-01', 1.0),
                                                                  (date '2026-09-01', 1.04), (date '2026-10-01', 1.0)) m(mes, k) loop
    v_ret := round(x.bruto * 0.15, 2); v_com := round(x.bruto * 0.0635, 2); v_neto := x.bruto - v_ret - v_com; v_bruto := round(x.bruto * 0.32, 2);
    insert into public.payroll_summary (account_id, company_id, period_month, location_id, gross, employer_ss, employee_ss, irpf, other_deductions,
                                        net, employees_count, source, created_by, created_by_name)
    values (p_account, v_emp, x.mes, v_loc, x.bruto, v_bruto, v_com, v_ret, 0, v_neto, 18, 'manual', v_actor, v_quien) returning id into v_id;
    select e.id into v_e from public.journal_entry e where e.company_id = v_emp and e.account_id = p_account and e.source_type = 'payroll'
       and e.source_id = v_id and e.status = 'propuesto';
    if v_e is null then raise exception 'DEMO: la nómina de % no se ha propuesto sola.', to_char(x.mes, 'MM/YYYY'); end if;
    perform public.journal_entry_validar(v_e, v_quien);
    v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', (x.mes + interval '1 month - 1 day')::date, 'importe', -v_neto,
      'concepto', 'TRANSFERENCIAS NOMINAS ' || to_char(x.mes, 'MM/YYYY'), 'clase', 'cuenta', 'cuenta', v_465,
      'porque', 'El líquido de las nóminas del mes.'));
    if (x.mes + interval '2 month - 1 day')::date <= v_fin then
      v_movs := v_movs || jsonb_build_array(jsonb_build_object('fecha', (x.mes + interval '2 month - 1 day')::date, 'importe', -(v_bruto + v_com),
        'concepto', 'TGSS SEGUROS SOCIALES ' || to_char(x.mes, 'MM/YYYY'), 'clase', 'cuenta', 'cuenta', v_476,
        'porque', 'Los seguros sociales del mes (empresa y trabajador).'));
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

  -- El 111 y el 115 del tercer trimestre: las retenciones de las nóminas y del alquiler de julio a septiembre.
  v_r111 := public.conta_impuesto_retenciones_calcular(v_emp, 2026, '3T', '111');
  v_r115 := public.conta_impuesto_retenciones_calcular(v_emp, 2026, '3T', '115');
  select t.id, t.amount into v_111, v_111_imp from public.tax_return t where t.company_id = v_emp and t.account_id = p_account and t.form_code = '111' and t.fiscal_year = 2026 and t.period = '3T';
  select t.id, t.amount into v_115, v_115_imp from public.tax_return t where t.company_id = v_emp and t.account_id = p_account and t.form_code = '115' and t.fiscal_year = 2026 and t.period = '3T';
  if v_111 is null or v_115 is null or coalesce(v_111_imp, 0) <= 0 or coalesce(v_115_imp, 0) <= 0 then
    raise exception 'DEMO: el 111 o el 115 del 3T no han salido a ingresar: % · %', v_r111, v_r115;
  end if;
  v_movs := v_movs || jsonb_build_array(
    jsonb_build_object('fecha', date '2026-10-20', 'importe', -v_111_imp, 'concepto', 'IMPUESTOS AEAT MODELO 111 3T 2026', 'clase', 'impuesto'),
    jsonb_build_object('fecha', date '2026-10-20', 'importe', -v_115_imp, 'concepto', 'IMPUESTOS AEAT MODELO 115 3T 2026', 'clase', 'impuesto'));

  -- Y dos sin casar (más el cargo del 303), para que la demo enseñe qué pide la mano.
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
        'seguro', coalesce(x.m->>'porque', case when x.m->>'clase' = 'gasto' then 'La comisión del datáfono del mes.' else 'Lo cobrado con tarjeta en el salón esa semana.' end),
        '[]'::jsonb, 'persona', null);
    end if;
    v_casados := v_casados + 1;
  end loop;

  -- Los asientos que ha propuesto el casado, validados (como «Validar» en el Diario).
  for v_e in select e.id from public.journal_entry e where e.company_id = v_emp and e.account_id = p_account and e.status = 'propuesto' order by e.entry_date, e.created_at loop
    perform public.journal_entry_validar(v_e, v_quien);
  end loop;

  -- 13 · El 303, el 111 y el 115 del 3T, presentados (fuera, con su justificante apuntado); el 303 contabilizado
  -- (DM1·5: el «Libro diario» ya no pone en rojo su liquidación) y los tres cargos casados con el banco.
  perform public.conta_impuesto_justificante_apuntar(v_emp, jsonb_build_object(
    'modelo', '303', 'ejercicio', 2026, 'periodo', '3T', 'presentada', '2026-10-19', 'csv', 'DEMO000000000000', 'justificante', '3030000000001',
    'nif', 'B00000018', 'resultado', v_303_imp,
    'casillas', (select jsonb_object_agg(b.box, b.value) from public.tax_return_box b where b.tax_return_id = v_303 and b.account_id = p_account and b.value is not null)));
  perform public.conta_impuesto_303_contabilizar(v_303);
  for x in select * from (values ('111', v_111, v_111_imp, '1110000000001'), ('115', v_115, v_115_imp, '1150000000001')) q(modelo, id, imp, just) loop
    perform public.conta_impuesto_justificante_apuntar(v_emp, jsonb_build_object(
      'modelo', x.modelo, 'ejercicio', 2026, 'periodo', '3T', 'presentada', '2026-10-19', 'csv', 'DEMO' || x.modelo || '000000000', 'justificante', x.just,
      'nif', 'B00000018', 'resultado', x.imp,
      'casillas', (select jsonb_object_agg(b.box, b.value) from public.tax_return_box b where b.tax_return_id = x.id and b.account_id = p_account and b.value is not null)));
  end loop;
  for x in select * from (values (v_303, v_303_imp), (v_111, v_111_imp), (v_115, v_115_imp)) q(id, imp) loop
    continue when coalesce(x.imp, 0) <= 0;
    select b.id into v_id from public.bank_movement b where b.account_id = p_account and b.treasury_account_id = v_banco
       and b.op_date = date '2026-10-20' and b.amount = -x.imp and b.status = 'pendiente' order by b.created_at limit 1;
    if v_id is null then raise exception 'DEMO: no está el cargo de % € del 20/10.', x.imp; end if;
    perform public.conta_impuesto_casar_cargo(x.id, v_id);
    v_casados := v_casados + 1;
  end loop;

  -- 14 · El 303 del cuarto trimestre, en borrador.
  v_303_4t := public.conta_impuesto_303_calcular(v_emp, 2026, '4T');
  -- Y el 111 y el 115 del cuarto, en borrador.
  v_4t := jsonb_build_object('111', public.conta_impuesto_retenciones_calcular(v_emp, 2026, '4T', '111')->'importe',
                             '115', public.conta_impuesto_retenciones_calcular(v_emp, 2026, '4T', '115')->'importe');

  select count(*) into v_n from public.journal_entry e where e.company_id = v_emp and e.account_id = p_account and e.status = 'validado';
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return jsonb_build_object('empresa', v_emp, 'asientos', v_n, 'dias_de_ventas', v_dias, 'recibidas', v_recibidas, 'liquidaciones', v_liq,
                            'movimientos', (select count(*) from _demo_mov), 'casados', v_casados, 'sin_casar', (select count(*) from _demo_mov) - v_casados,
                            'iva_3t', v_303_imp, 'iva_4t', v_303_4t, 'ret_111_3t', v_111_imp, 'ret_115_3t', v_115_imp, 'ret_4t', v_4t,
                            'saldo', (select s.closing_balance from public.bank_statement s where s.treasury_account_id = v_banco and s.account_id = p_account order by s.imported_at desc limit 1));
end $$;
comment on function public.demo_contabilidad_sembrar(uuid) is
  'DM1 (03/11/2026). Siembra la contabilidad de demo de una cuenta de demo (accounts.is_demo) sin empresa, por los caminos de la app y como su administrador. Solo la plataforma.';
revoke all on function public.demo_contabilidad_sembrar(uuid) from public, anon, authenticated;
comment on function public.demo_contabilidad_sembrar(uuid) is
  'DM1 (03/11/2026, con los gastos de la 1525). Siembra la contabilidad de demo de una cuenta de demo (accounts.is_demo) sin empresa, por los caminos de la app y como su administrador. Solo la plataforma.';

-- ── 3 · Sembrar Casa Lola otra vez ──────────────────────────────────────────
do $$
declare v_acc constant uuid := coalesce(nullif(current_setting('demo.cuenta', true), ''), '623d946a-a0ce-4f34-8c00-9761dfed8331')::uuid; v jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc and is_demo) then
    raise notice 'DEMO: la cuenta % no está o no es de demo (esto no es producción): no se siembra nada.', v_acc;
    return;
  end if;
  v := public.demo_contabilidad_sembrar(v_acc);
  -- WARNING y no NOTICE: el ensayo de producción calla los NOTICE, y así su informe dice lo que sale.
  raise warning 'DEMO · %: %', v_acc, v - 'iva_4t';
end $$;
set local lock_timeout to default;
