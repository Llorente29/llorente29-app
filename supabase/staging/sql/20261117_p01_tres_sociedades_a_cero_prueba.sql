-- supabase/staging/sql/20261117_p01_tres_sociedades_a_cero_prueba.sql
--
-- SOLO STAGING (y la base local del W09). Prueba del P01 · las tres sociedades a cero
-- (20261117T1015). Todo en una transacción con ROLLBACK. Sociedades INVENTADAS.
--
--   1. Sin la cuenta de las tres sociedades del P01, la migración no toca nada.
--   2. Una cuenta inventada con tres sociedades (la segunda, sin ejercicio) y una cuarta
--      sociedad de control en OTRA cuenta, cada una con lo que entra por correo.
--   3. Las guardas paran sin dejar nada: cifras distintas de las esperadas, un asiento puesto
--      a propósito, quien fija el corte ya no es administrador, y el corte de Bancos puesto.
--   4. De verdad: borra lo de las tres y nada de la cuarta; nombres = razón social; la segunda
--      recibe el ejercicio; _conta_corte = 2026-11-01 en las tres y nulo en la cuarta.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001',
                                                         'a175c0b8-2eaf-4285-9688-53042910a86e')) then
    raise exception 'PRUEBA P01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda corre como el dueño.
set constraints all immediate;

-- 1 · Sin la cuenta del P01, nada.
create temp table prueba_antes on commit drop as
  select (select count(*) from public.supplier_invoice) f, (select count(*) from public.document_inbox) b,
         (select count(*) from public.inbound_email_log) c, (select count(*) from public.supplier) s,
         (select md5(string_agg(id::text || coalesce(trade_name, ''), '|' order by id)) from public.company) n;
\i supabase/migrations/20261117T1015_p01_tres_sociedades_a_cero.sql
do $$ begin
  if (select count(*) from public.supplier_invoice) <> (select f from prueba_antes) or (select count(*) from public.document_inbox) <> (select b from prueba_antes)
     or (select count(*) from public.inbound_email_log) <> (select c from prueba_antes) or (select count(*) from public.supplier) <> (select s from prueba_antes)
     or (select md5(string_agg(id::text || coalesce(trade_name, ''), '|' order by id)) from public.company) <> (select n from prueba_antes) then
    raise exception 'PRUEBA P01 1: sin la cuenta del P01 la migración ha tocado algo.';
  end if;
end $$;

-- 2 · Las sociedades inventadas. Cuenta A (tres) y cuenta B (la cuarta, de control).
do $$
declare
  u  constant uuid := 'f0100000-0000-4000-8000-0000000000e1';
  a  constant uuid := 'f0100000-0000-4000-8000-0000000000a1';
  b  constant uuid := 'f0100000-0000-4000-8000-0000000000b1';
  e  uuid; s uuid; f uuid; d uuid; i int := 0;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'admin.prueba@p01-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (a, 'Prueba P01 A', 'p01-prueba-a', 'active', 'otra_actividad', 'contabilidad'),
    (b, 'Prueba P01 B', 'p01-prueba-b', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, a, 'admin', true, 'Prueba P01', now(), now());
  insert into public.company (id, account_id, legal_name, trade_name, setup_step) values
    ('f0100000-0000-4000-8000-000000000c01', a, 'Prueba P01 Uno, S.L.', 'Prueba P01', 'cuentas'),
    ('f0100000-0000-4000-8000-000000000c02', a, 'Prueba P01 Dos, S.L.', 'Prueba P01', 'cuentas'),
    ('f0100000-0000-4000-8000-000000000c03', a, 'Prueba P01 Tres, S.L.', 'Prueba P01', 'cuentas'),
    ('f0100000-0000-4000-8000-000000000c04', b, 'Prueba P01 Control, S.L.', 'Prueba P01', 'cuentas');
  -- Ejercicio 2026 en la primera, la tercera y la de control; la segunda, sin ninguno.
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, created_by) values
    (a, 'f0100000-0000-4000-8000-000000000c01', '2026', '2026-01-01', '2026-12-31', u),
    (a, 'f0100000-0000-4000-8000-000000000c03', '2026', '2026-01-01', '2026-12-31', u),
    (b, 'f0100000-0000-4000-8000-000000000c04', '2026', '2026-01-01', '2026-12-31', u);
  -- Lo que entra por correo, en las cuatro: un proveedor por cuenta, y por sociedad una
  -- factura con su línea, su fila de bandeja, su actividad, su correo, una propuesta y una esperada.
  foreach e in array array['f0100000-0000-4000-8000-000000000c01', 'f0100000-0000-4000-8000-000000000c02',
                           'f0100000-0000-4000-8000-000000000c03', 'f0100000-0000-4000-8000-000000000c04']::uuid[] loop
    i := i + 1;
    select id into s from public.supplier where account_id = (select account_id from public.company where id = e);
    if s is null then
      insert into public.supplier (account_id, name) values ((select account_id from public.company where id = e), 'Proveedor P01 ' || i) returning id into s;
      insert into public.supplier_contact (account_id, supplier_id, name) values ((select account_id from public.company where id = e), s, 'Contacto P01');
    end if;
    insert into public.document_inbox (account_id, company_id, channel, status)
    values ((select account_id from public.company where id = e), e, 'subida', 'recibido') returning id into d;
    insert into public.supplier_invoice (account_id, company_id, supplier_id, source, status, invoice_number, inbox_id)
    values ((select account_id from public.company where id = e), e, s, 'ocr', 'en_revision', 'P01-' || i, d) returning id into f;
    insert into public.supplier_invoice_line (supplier_invoice_id) values (f);
    update public.document_inbox set status = 'factura', supplier_invoice_id = f where id = d;
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values ((select account_id from public.company where id = e), e, d, f, 'folvy', 'recibida', 'Prueba P01');
    insert into public.inbound_email_log (account_id, company_id, email_id, to_address, outcome)
    values ((select account_id from public.company where id = e), e, 'p01-' || i, 'facturas-p01@prueba.test', 'recibido');
    insert into public.conta_propuesta_pendiente (account_id, company_id, origen, origen_id, que, porque)
    values ((select account_id from public.company where id = e), e, 'purchase_accrual', 'p01-' || i, 'Prueba P01', 'Prueba P01');
    insert into public.supplier_expected_invoice (account_id, company_id, supplier_id, source, typical_day)
    values ((select account_id from public.company where id = e), e, s, 'a_mano', 1);
  end loop;
end $$;

create temp table prueba_control on commit drop as
  select public._p01_dentro('f0100000-0000-4000-8000-0000000000b1', array['f0100000-0000-4000-8000-000000000c04']::uuid[]) j;
create temp table prueba_esperado on commit drop as
  select public._p01_dentro('f0100000-0000-4000-8000-0000000000a1',
           array['f0100000-0000-4000-8000-000000000c01', 'f0100000-0000-4000-8000-000000000c02', 'f0100000-0000-4000-8000-000000000c03']::uuid[]) j;

do $$
declare j jsonb := (select j from prueba_esperado);
begin
  -- Lo sembrado, contado a mano: tres de cada en las tres sociedades, un proveedor en su cuenta.
  if (j->>'supplier_invoice')::int <> 3 or (j->>'supplier_invoice_line')::int <> 3 or (j->>'document_inbox')::int <> 3
     or (j->>'document_activity')::int <> 3 or (j->>'inbound_email_log')::int <> 3 or (j->>'conta_propuesta_pendiente')::int <> 3
     or (j->>'supplier_expected_invoice')::int <> 3 or (j->>'supplier')::int <> 1 or (j->>'supplier_contact')::int <> 1 then
    raise exception 'PRUEBA P01 2: lo sembrado no es lo que se cuenta: %.', j;
  end if;
end $$;

-- 3 · Las guardas. Cada una en su bloque: si no para, la prueba falla; si para, no queda nada.
do $$
declare
  a  constant uuid := 'f0100000-0000-4000-8000-0000000000a1';
  u  constant uuid := 'f0100000-0000-4000-8000-0000000000e1';
  es constant uuid[] := array['f0100000-0000-4000-8000-000000000c01', 'f0100000-0000-4000-8000-000000000c02', 'f0100000-0000-4000-8000-000000000c03']::uuid[];
  j  jsonb := (select j from prueba_esperado);
  m  text;
begin
  -- 3a · Cifras que no son las esperadas.
  begin
    perform public._p01_a_cero(a, es, u, date '2026-10-31', 'erp10', jsonb_set(j, '{supplier_invoice}', '4'));
    raise exception 'PRUEBA P01 3a: con cifras distintas no ha parado.';
  exception when raise_exception then
    get stacked diagnostics m = message_text;
    if m not like 'P01 a cero: no se toca nada. Lo que hay no es lo medido%' then raise exception 'PRUEBA P01 3a: ha parado por otra cosa: %', m; end if;
  end;
  -- 3b · Un asiento puesto a propósito.
  begin
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, es[1], (select id from public.fiscal_year where company_id = es[1]), 1, date '2026-11-05', 'Asiento P01 a propósito', 'manual');
    perform public._p01_a_cero(a, es, u, date '2026-10-31', 'erp10', j);
    raise exception 'PRUEBA P01 3b: con un asiento no ha parado.';
  exception when raise_exception then
    get stacked diagnostics m = message_text;
    if m not like 'P01 a cero: no se toca nada.%Hay asientos.%' then raise exception 'PRUEBA P01 3b: ha parado por otra cosa: %', m; end if;
  end;
  -- 3c · Quien fija el corte ya no es administrador activo.
  begin
    update public.user_profiles set active = false where user_id = u and account_id = a;
    perform public._p01_a_cero(a, es, u, date '2026-10-31', 'erp10', j);
    raise exception 'PRUEBA P01 3c: sin administrador activo no ha parado.';
  exception when raise_exception then
    get stacked diagnostics m = message_text;
    if m not like 'P01 a cero: no se toca nada.%administrador activo%' then raise exception 'PRUEBA P01 3c: ha parado por otra cosa: %', m; end if;
  end;
  -- 3d · El corte de Bancos puesto en una.
  begin
    insert into public.bank_settings (account_id, company_id, cutover_date) values (a, es[2], date '2026-11-01');
    perform public._p01_a_cero(a, es, u, date '2026-10-31', 'erp10', j);
    raise exception 'PRUEBA P01 3d: con el corte de Bancos puesto no ha parado.';
  exception when raise_exception then
    get stacked diagnostics m = message_text;
    if m not like 'P01 a cero: no se toca nada.%corte de Bancos%' then raise exception 'PRUEBA P01 3d: ha parado por otra cosa: %', m; end if;
  end;
  -- Y nada de lo de antes se ha movido.
  if public._p01_dentro(a, es) is distinct from j then raise exception 'PRUEBA P01 3: una guarda ha dejado algo a medias.'; end if;
  if exists (select 1 from public.journal_entry where company_id = any(es)) or exists (select 1 from public.bank_settings where company_id = any(es)) then
    raise exception 'PRUEBA P01 3: quedan el asiento o el corte de Bancos de las guardas.';
  end if;
end $$;

-- 4 · De verdad.
do $$
declare
  a  constant uuid := 'f0100000-0000-4000-8000-0000000000a1';
  u  constant uuid := 'f0100000-0000-4000-8000-0000000000e1';
  es constant uuid[] := array['f0100000-0000-4000-8000-000000000c01', 'f0100000-0000-4000-8000-000000000c02', 'f0100000-0000-4000-8000-000000000c03']::uuid[];
  c4 constant uuid := 'f0100000-0000-4000-8000-000000000c04';
  r  jsonb;
begin
  r := public._p01_a_cero(a, es, u, date '2026-10-31', 'erp10', (select j from prueba_esperado));
  if exists (select 1 from jsonb_each_text(public._p01_dentro(a, es)) where value <> '0') then
    raise exception 'PRUEBA P01 4: queda algo dentro: %.', public._p01_dentro(a, es);
  end if;
  if public._p01_dentro('f0100000-0000-4000-8000-0000000000b1', array[c4]) is distinct from (select j from prueba_control) then
    raise exception 'PRUEBA P01 4: la de control ha cambiado: antes %, después %.', (select j from prueba_control),
      public._p01_dentro('f0100000-0000-4000-8000-0000000000b1', array[c4]);
  end if;
  if (select count(*) from public.company where id = any(es) and trade_name = legal_name) <> 3
     or (select trade_name from public.company where id = c4) <> 'Prueba P01' then
    raise exception 'PRUEBA P01 4: los nombres no son la razón social en las tres, o la de control ha cambiado.';
  end if;
  if not exists (select 1 from public.fiscal_year where company_id = es[2] and code = '2026' and starts_on = '2026-01-01'
                   and ends_on = '2026-12-31' and created_by = u and previous_year_id is null) then
    raise exception 'PRUEBA P01 4: la segunda no tiene el ejercicio 2026 como las otras.';
  end if;
  if exists (select 1 from unnest(es) e where public._conta_corte(e) is distinct from date '2026-11-01') or public._conta_corte(c4) is not null then
    raise exception 'PRUEBA P01 4: _conta_corte no da el 01/11/2026 en las tres, o la de control tiene corte.';
  end if;
  if (select count(*) from public.fiscal_year where company_id = any(es) and origin = 'mixed' and origin_program = 'erp10' and imported_until = '2026-10-31') <> 3
     or (select count(*) from public.fiscal_period_lock where company_id = any(es) and kind = 'migrated') <> 30 then
    raise exception 'PRUEBA P01 4: el corte no ha quedado como lo deja la pantalla (ejercicio mixto de erp10 y 10 meses cerrados en cada una).';
  end if;
  if (select count(*) from public.fiscal_period_lock where company_id = any(es) and locked_by = u) <> 30 then
    raise exception 'PRUEBA P01 4: los meses cerrados no los firma quien fija el corte.';
  end if;
  if r->'fuera_antes' is distinct from r->'fuera_despues' then raise exception 'PRUEBA P01 4: fuera ha cambiado.'; end if;
  raise notice 'PRUEBA P01 4: %', r;
end $$;

select 'PRUEBA P01 tres sociedades a cero: en verde' as resultado;
rollback;
