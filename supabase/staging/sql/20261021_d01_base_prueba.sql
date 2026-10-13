-- supabase/staging/sql/20261021_d01_base_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0200 (la base de Facturas recibidas) y de
-- 20261021T0210 (los tres CHECK que se amplían: public.supplier_contact,
-- public.company_account_link, public.journal_entry_document; y la regla de
-- repetidas en public.supplier_invoice, como disparador). Todo en una
-- transacción con ROLLBACK. Como administrador de A y como el de B (RLS A/B).
--
--   1. El ajuste «Recibe la mercancía con Folvy»: sembrado para la empresa de
--      A, lo cambia su administrador; el de B no puede.
--   2. La dirección de facturas: facturas-<empresa>@entrada.folvy.app, nace
--      apagada, no lleva el NIF y la segunda vez devuelve la misma.
--   3. La regla única de repetidas (con la 0230): el mismo número normalizado
--      y el mismo total del mismo proveedor no entra dos veces; con otro total
--      o con «No es repetida», sí. La función dice repetida y posible igual que
--      el núcleo de lectura.
--   4. La función para B: devuelve la factura pendiente con su contrato
--      (nombres, tipos y orden de las columnas, fijados aquí).
--   5. Los tres CHECK: 'billing', 'aprendido_diez' y 'factura_recibida' valen;
--      lo de antes sigue valiendo; lo que no existe, no.
--   6. Las esperadas: aprender y «no llegadas» corren como usuario.
--   7. Escribir directamente en las tablas nuevas: no. Y B no ve nada de A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('prueba.empresa', (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1), true);
select set_config('prueba.empresa_b', (select id::text from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' order by created_at limit 1), true);

-- ── 0 · Lo que crean las dos migraciones ─────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.company_purchase_setting where company_id = current_setting('prueba.empresa')::uuid) then
    raise exception 'PRUEBA D01 · 0: la empresa de A no tiene su ajuste de compras sembrado.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'supplier_contact_role_check')) not like '%billing%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'company_account_link_source_check')) not like '%aprendido_diez%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_document_kind_check')) not like '%factura_recibida%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_document_kind_check')) not like '%resumen_ventas%' then
    raise exception 'PRUEBA D01 · 0: algún CHECK no está ampliado como dice la 0210.';
  end if;
  raise notice 'PRUEBA D01 · 0: ajuste sembrado (recibe mercancía: %), y los tres CHECK ampliados sin perder lo de antes.',
    (select receives_goods from public.company_purchase_setting where company_id = current_setting('prueba.empresa')::uuid);
end $$;

-- ── 1 a 6 · Como administrador de A ──────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := current_setting('prueba.empresa')::uuid;
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_prov constant uuid := 'c01a0000-0000-4000-8000-0000000000a3'; -- Hermanos Ruiz, de A (semilla)
  r jsonb; v_i1 uuid; v_i2 uuid; v_n int; v_t record; v_res text;
begin
  -- 1 · el ajuste
  r := public.conta_ajustes_compras_guardar(v_e, true, false, 'Prueba D01');
  if (r->>'receives_goods')::boolean is not true or r->>'updated_by_name' <> 'Prueba D01' then raise exception 'PRUEBA D01 · 1: el ajuste no se ha guardado: %', r; end if;
  if public.conta_recibe_mercancia(v_e) is not true then raise exception 'PRUEBA D01 · 1: conta_recibe_mercancia no dice lo guardado.'; end if;
  raise notice 'PRUEBA D01 · 1: «Recibe la mercancía con Folvy» guardado por su administrador, con su porqué: %', r->>'receives_goods_reason';

  -- 2 · la dirección
  r := public.conta_direccion_facturas(v_e, 'Prueba D01');
  if r->>'direccion' !~ '^facturas-[a-z0-9-]+@entrada\.folvy\.app$' or (r->>'active')::boolean or (r->>'ya_estaba')::boolean then
    raise exception 'PRUEBA D01 · 2: la dirección no es la esperada: %', r;
  end if;
  if r->>'direccion' ~ (select lower(coalesce(nullif(regexp_replace(tax_id, '[^A-Za-z0-9]', '', 'g'), ''), 'nonif')) from public.company where id = v_e) then
    raise exception 'PRUEBA D01 · 2: la dirección lleva el NIF.';
  end if;
  if not (public.conta_direccion_facturas(v_e, 'Prueba D01')->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 · 2: la segunda vez ha hecho otra.'; end if;
  raise notice 'PRUEBA D01 · 2: dirección %, apagada hasta que el dominio exista; la segunda vez, la misma.', r->>'direccion';

  -- 3 · repetidas
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_prov, v_e, 'D01/0001-A', '2026-09-30', 'en_revision', 'manual', 110, 100, 10, 'Prueba D01') returning id into v_i1;
  -- Desde la 0230, repetida es número Y total (como el C01b): con el mismo total no entra…
  begin
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
    values (v_acc, v_prov, v_e, 'd01 0001 a', '2026-10-01', 'en_revision', 'manual', 110, 'Prueba D01');
    raise exception 'PRUEBA D01 · 3: ha entrado la misma factura con el número escrito de otra forma.';
  exception when unique_violation then raise notice 'PRUEBA D01 · 3: «d01 0001 a» por 110 no entra: es «D01/0001-A» del mismo proveedor.'; end;
  -- …con otro total sí entra (es «posible», pregunta), y con «No es repetida», también con el mismo total.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values (v_acc, v_prov, v_e, 'd01 0001 a', '2026-10-01', 'en_revision', 'manual', 999, 'Prueba D01') returning id into v_i2;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, not_duplicate_confirmed_at, not_duplicate_confirmed_by_name)
  values (v_acc, v_prov, v_e, 'd01 0001 a', '2026-10-01', 'en_revision', 'manual', 110, 'Prueba D01', now(), 'Prueba D01');
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, 'D01-0001/A', '2026-10-05', 110);
  if v_res is distinct from 'repetida' then raise exception 'PRUEBA D01 · 3: la función no dice repetida (%).', v_res; end if;
  -- Desde la 0260 (la del C01b), el mismo número sin total no es nada.
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, 'D01-0001/A', null, null);
  if v_n <> 0 then raise exception 'PRUEBA D01 · 3: el mismo número sin total sale como algo.'; end if;
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, 'D01/0002', '2026-09-30', 110);
  if v_res is distinct from 'posible' then raise exception 'PRUEBA D01 · 3: misma fecha y total con otro número no es «posible» (%).', v_res; end if;
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, 'D01/0003', '2026-10-31', 110);
  if v_n <> 0 then raise exception 'PRUEBA D01 · 3: el mismo total otro día sale como repetida.'; end if;
  -- Las que ya estaban repetidas (staging tiene las del C01b) no se tocan: se listan, y se pueden editar.
  select count(*) into v_n from public.supplier_invoice_repetidas_que_hay(v_acc);
  update public.supplier_invoice set notes = coalesce(notes, '') where id in (select unnest(ids) from public.supplier_invoice_repetidas_que_hay(v_acc));
  raise notice 'PRUEBA D01 · 3: con «No es repetida» sí entra; la función dice repetida, posible y nada, como el núcleo; las % repetida(s) de antes siguen ahí y se pueden editar.', v_n;

  -- 4 · la función para B
  if pg_get_function_result('public.banco_facturas_recibidas_pendientes(uuid,date)'::regprocedure) <> 'TABLE(invoice_id uuid, supplier_id uuid, supplier_name text, supplier_tax_id text, invoice_number text, invoice_date date, due_date date, total numeric, pending numeric, read_iban text, journal_entry_id uuid, status text)' then
    raise exception 'PRUEBA D01 · 4: el contrato de la función para B ha cambiado: %', pg_get_function_result('public.banco_facturas_recibidas_pendientes(uuid,date)'::regprocedure);
  end if;
  select * into v_t from public.banco_facturas_recibidas_pendientes(v_e) where invoice_id = v_i1;
  if v_t.invoice_id is null or v_t.pending <> 110 or v_t.invoice_number <> 'D01/0001-A' then raise exception 'PRUEBA D01 · 4: la factura pendiente no sale bien: %', to_jsonb(v_t); end if;
  raise notice 'PRUEBA D01 · 4: la función para B devuelve la pendiente con su contrato de 12 columnas.';

  -- 5 · los CHECK, como usuario
  insert into public.supplier_contact (account_id, supplier_id, name, role, email) values (v_acc, v_prov, 'Facturación Prueba', 'billing', 'facturas@ejemplo.test');
  begin
    insert into public.supplier_contact (account_id, supplier_id, name, role) values (v_acc, v_prov, 'Otro', 'no_existe');
    raise exception 'PRUEBA D01 · 5: ha entrado un papel de contacto que no existe.';
  exception when check_violation then null; end;
  raise notice 'PRUEBA D01 · 5: el contacto de facturación entra; un papel que no existe, no.';

  -- 6 · esperadas
  v_n := public.conta_esperadas_aprender(v_e, '2026-10-20');
  select count(*) into v_n from public.conta_esperadas_no_llegadas(v_e, '2026-10-20');
  raise notice 'PRUEBA D01 · 6: esperadas aprendidas y «no llegadas» corren como usuario (% no llegadas en staging).', v_n;

  -- 7 · escribir directamente en lo nuevo: no
  begin
    insert into public.document_inbox (account_id, channel) values (v_acc, 'subida');
    raise exception 'PRUEBA D01 · 7: ha dejado escribir en document_inbox directamente.';
  exception when insufficient_privilege then raise notice 'PRUEBA D01 · 7: escribir en la bandeja directamente: no.'; end;
  perform set_config('prueba.factura', v_i1::text, true);
end $$;
reset role;

-- ── 7 · Como administrador de B ──────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := current_setting('prueba.empresa')::uuid; v_n int;
begin
  begin
    perform public.conta_ajustes_compras_guardar(v_e, false, true, 'B');
    raise exception 'PRUEBA D01 · 7: B ha cambiado el ajuste de A.';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.banco_facturas_recibidas_pendientes(v_e);
    raise exception 'PRUEBA D01 · 7: B ha leído las pendientes de A.';
  exception when sqlstate 'P0002' then null; end;
  select (select count(*) from public.company_purchase_setting where company_id = v_e) + (select count(*) from public.company_inbound_address where company_id = v_e)
       + (select count(*) from public.supplier_invoice_tax) + (select count(*) from public.document_inbox where account_id = 'c01a0000-0000-4000-8000-00000000000a')
       + (select count(*) from public.supplier_invoice where id = current_setting('prueba.factura')::uuid) into v_n;
  if v_n <> 0 then raise exception 'PRUEBA D01 · 7: B ve % fila(s) de A.', v_n; end if;
  begin
    perform * from public.supplier_invoice_repetida('c01a0000-0000-4000-8000-00000000000a', null, null, 'X', null, null);
    raise exception 'PRUEBA D01 · 7: B ha preguntado por repetidas de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 · 7: B no cambia ni lee nada de A (ajuste, dirección, facturas, pendientes, repetidas).';
end $$;
reset role;

rollback;
