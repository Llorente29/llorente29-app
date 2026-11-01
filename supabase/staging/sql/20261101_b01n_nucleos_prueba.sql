-- ============================================================================
-- PRUEBA (staging) · B01 · PR 3a (2030): los núcleos de casar. Todo en una
-- transacción con ROLLBACK. Datos INVENTADOS (IBAN del banco 9999, T11), en la
-- cuenta D de staging (la de la prueba de la 1614). Necesita la 0915 (PC01 E2), la 1234 y la 1614.
--
-- Nombra lo que toca, para el analizador: bank_casar, conta_remesa_casar,
-- mark_supplier_invoice_paid, journal_entry_validar, _bank_casar_nucleo,
-- _conta_remesa_casar_nucleo, _mark_supplier_invoice_paid_nucleo,
-- conta_pago_casar_banco.
--
--   0. Las tres públicas, con su huella de producción (bank_casar 0f253b11,
--      conta_remesa_casar 57bb45e3, mark_supplier_invoice_paid 927ffeee) y
--      sin núcleos (si la 2030 ya estaba, después de su vuelta atrás).
--   1. ANTES = DESPUÉS (Julio, 01/11): el mismo caso con las funciones de
--      antes y con las de la 2030, a los dos lados de un savepoint. Casar un
--      pago a mano con su cargo (conta_remesa_casar), casar un cargo con una
--      factura (bank_casar), marcar pagada a mano una factura sin pago con
--      asiento (mark_supplier_invoice_paid, que para), casar una remesa de
--      fichero que se valida sola (journal_entry_validar) y las tres guardas con
--      una persona de otra cuenta. Se compara lo que devuelven y lo que dejan
--      escrito: frases, facturas, casados, asientos y sus líneas, el registro
--      de Bancos y el de las remesas. Tiene que ser idéntico.
--   2. Nadie de fuera llama a un núcleo; conta_pago_casar_banco, solo la clave
--      de servicio.
--   3. El cargo de un pago por Revolut, casado solo con la clave de servicio:
--      sin cargo todavía lo dice; con el cargo (y su comisión aparte), lo casa
--      con su remesa «banco» como «folvy», la factura queda pagada por
--      «Sumied»; la segunda vez dice que ya no espera.
--   4. La vuelta atrás otra vez: las públicas vuelven a su huella.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01 PR 3a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_pago_lote') is null or to_regprocedure('public.conta_pago_mandar_empezar(uuid)') is null then
    raise exception 'PRUEBA B01 PR 3a · 0: faltan la 1234 o la 1614.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · Las públicas, como en producción ────────────────────────────────────
-- Si la 2030 ya está (la vuelta atrás restaura de su respaldo), primero su vuelta atrás.
select to_regprocedure('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)') is not null as ya_esta_la_2030 \gset
\if :ya_esta_la_2030
\i supabase/vuelta-atras/20261101T2030_b01n_nucleos_casar.down.sql
\endif
do $$
declare h text;
begin
  for h in select format('%s=%s', p.proname, left(md5(pg_get_functiondef(p.oid)), 8)) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in ('bank_casar', 'conta_remesa_casar', 'mark_supplier_invoice_paid')
              and format('%s=%s', p.proname, left(md5(pg_get_functiondef(p.oid)), 8)) not in ('bank_casar=0f253b11', 'conta_remesa_casar=57bb45e3', 'mark_supplier_invoice_paid=927ffeee') loop
    raise exception 'PRUEBA B01 PR 3a · 0: no es la de producción: %.', h;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_bank_casar_nucleo', '_conta_remesa_casar_nucleo', '_mark_supplier_invoice_paid_nucleo', 'conta_pago_casar_banco')) then
    raise exception 'PRUEBA B01 PR 3a · 0: hay un núcleo.';
  end if;
  raise notice 'PRUEBA B01 PR 3a · 0: las tres públicas, con su huella de producción y sin núcleos.';
end $$;

create temp table _n (clave text primary key, v text) on commit drop;
grant all on _n to authenticated, service_role;
insert into _n values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('admin', 'c01d0000-0000-4000-8000-0000000000d1'), ('otra', 'c01b0000-0000-4000-8000-0000000000b1');

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _n where clave = 'cuenta'); e uuid := (select v::uuid from _n where clave = 'empresa');
        s uuid; b uuid; c572 uuid;
begin
  -- Los asientos de los casados van al ejercicio 2026: si la empresa no lo tiene, se le pone (la prueba acaba en ROLLBACK).
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select a, e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = e and date '2026-10-24' between starts_on and ends_on);
  insert into public.supplier (account_id, name, legal_name, iban) values (a, 'Proveedor 3a Prueba', 'Proveedor 3a Prueba S.L.', 'ES9299990000000000003301') returning id into s;
  update public.supplier set iban_verified_at = now() where id = s;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (a, e, 'pymes', '40009931', '4000', 'Proveedores · 3a', 'own', 'manual');
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, e, ca.id, 'supplier', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '40009931';
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status) values
    (a, e, s, 'P3A-1', '2026-10-01', 100.00, 'en_revision'), (a, e, s, 'P3A-2', '2026-10-02', 50.00, 'en_revision'),
    (a, e, s, 'P3A-3', '2026-10-03', 30.00, 'en_revision'), (a, e, s, 'P3A-4', '2026-10-04', 75.00, 'en_revision');
  insert into _n select 'f' || substr(invoice_number, 5), id from public.supplier_invoice where account_id = a and invoice_number like 'P3A-_';
  -- Un banco con su 572 y ligado a Revolut, para el caso 3.
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (a, e, 'bank', 'Prueba 3a · Revolut', 'ES5099990000000000003378', '572', true) returning id into b;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (a, e, 'pymes', '57209931', '572', 'Bancos · Prueba 3a', 'own', 'manual') returning id into c572;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (a, e, c572, 'bank_account', b::text, 'principal', 'manual');
  insert into public.bank_aggregator_link (account_id, company_id, treasury_account_id, provider, external_account_id, consent_id, consent_valid_until)
  values (a, e, b, 'revolut', 'cuenta-eur-prueba-3a', 'prueba-3a', '9999-12-31T00:00:00Z');
  delete from public.revolut_conexion where company_id = e;
  insert into public.revolut_conexion (account_id, company_id, entorno, estado, certificado, certificado_huella, vuelta, permisos, created_by_name)
  values (a, e, 'sandbox', 'conectada', '-----BEGIN CERTIFICATE-----' || chr(10) || 'INVENTADO' || chr(10) || '-----END CERTIFICATE-----',
          repeat('c', 64), 'https://app.sumied.com/bancos/revolut/vuelta', 'READ,WRITE,PAY', 'Prueba 3a');
  delete from public.conta_pago_permiso where company_id = e;
  insert into _n values ('banco', b);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _n where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _n where clave in ('f1', 'f2', 'f3', 'f4'));
reset role;

-- ── 1 · Antes = después ─────────────────────────────────────────────────────
-- El caso: lo corre el dueño con la sesión de la administradora de A (las
-- públicas son security definer y su guarda mira auth.uid(), no el rol). Lo que
-- devuelve es lo que se compara: sin ids (cambian a cada lado) y con los
-- códigos de remesa y números de asiento tapados.
create function pg_temp.caso() returns jsonb language plpgsql as $$
declare
  e uuid := (select v::uuid from _n where clave = 'empresa'); b uuid := (select v::uuid from _n where clave = 'banco');
  f1 uuid := (select v::uuid from _n where clave = 'f1'); f2 uuid := (select v::uuid from _n where clave = 'f2'); f3 uuid := (select v::uuid from _n where clave = 'f3');
  r jsonb; x jsonb; rem uuid; rem3 uuid; m1 uuid; m2 uuid; m3 uuid; lin uuid; out jsonb := '{}'::jsonb; err text;
  tapar text := 'R-\d{4}/\d{3}';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from _n where clave = 'admin'), 'role', 'authenticated')::text, true);
  -- Los dos cargos del banco.
  r := public.bank_importar(b, 'fichero', 'csv:bbva', 'prueba-3a.xlsx', repeat('3', 64), date '2026-10-23', date '2026-10-23', null, null, 'prueba', null,
    jsonb_build_array(
      jsonb_build_object('fecha', '2026-10-23', 'importe', -100.00, 'concepto_banco', 'TRANSFERENCIA 3A UNO', 'concepto_limpio', 'Transferencia 3a uno', 'huella', 'p3a-1', 'huella_suave', 'p3a-s1'),
      jsonb_build_object('fecha', '2026-10-23', 'importe', -50.00, 'concepto_banco', 'TRANSFERENCIA 3A DOS', 'concepto_limpio', 'Transferencia 3a dos', 'huella', 'p3a-2', 'huella_suave', 'p3a-s2'),
      jsonb_build_object('fecha', '2026-10-23', 'importe', -30.00, 'concepto_banco', 'TRANSFERENCIA 3A TRES', 'concepto_limpio', 'Transferencia 3a tres', 'huella', 'p3a-3', 'huella_suave', 'p3a-s3')));
  select id into m1 from public.bank_movement where statement_id = (r->>'extracto')::uuid and bank_concept = 'TRANSFERENCIA 3A UNO';
  select id into m2 from public.bank_movement where statement_id = (r->>'extracto')::uuid and bank_concept = 'TRANSFERENCIA 3A DOS';
  select id into m3 from public.bank_movement where statement_id = (r->>'extracto')::uuid and bank_concept = 'TRANSFERENCIA 3A TRES';
  -- conta_remesa_casar: un pago a mano de P3A-1 y su cargo.
  x := public.conta_pago_a_mano(e, f1, b, date '2026-10-22', 100.00);
  rem := (x->>'remesa')::uuid;
  x := public.conta_remesa_casar(m1, rem, null);
  out := out || jsonb_build_object('remesa_casar', jsonb_build_object('frase', regexp_replace(x->>'frase', tapar, 'R-X', 'g'), 'pagos', x->'pagos', 'pagadas', x->'pagadas', 'validado_solo', x->'validado_solo'));
  -- bank_casar: el cargo de 50 con P3A-2.
  x := public.bank_casar(m2, jsonb_build_object('tipo', 'factura_recibida', 'cuenta_tercero', '40009931', 'facturas', jsonb_build_array(jsonb_build_object('id', f2, 'importe', 50.00))),
         'seguro', 'Es el pago de P3A-2.', '[]'::jsonb, 'persona', null);
  out := out || jsonb_build_object('bank_casar', x);
  -- mark_supplier_invoice_paid a mano: para (sin pago con asiento).
  begin perform public.mark_supplier_invoice_paid(f3, date '2026-10-23', 'transfer'); exception when others then err := sqlstate || ' ' || sqlerrm; end;
  out := out || jsonb_build_object('marcar_a_mano', err);
  -- conta_remesa_casar con validación sola (el núcleo de journal_entry_validar): una remesa de fichero
  -- de P3A-3, con su IBAN confirmado y descargada; el cargo es su total al céntimo.
  x := public.conta_remesa_pagos_crear(e, b, public.conta_hoy(), jsonb_build_array(jsonb_build_object('id', f3)));
  rem3 := (x->>'remesa')::uuid;
  for lin in select id from public.conta_pago_remesa_linea where remesa_id = rem3 and iban_check <> 'comprobado' and iban_confirmed_at is null loop
    perform public.conta_remesa_iban_confirmar(lin);
  end loop;
  perform public.conta_remesa_descargada(rem3, encode(sha256('fichero 3a'::bytea), 'hex'), 1);
  x := public.conta_remesa_casar(m3, rem3, null);
  out := out || jsonb_build_object('remesa_validada_sola', jsonb_build_object('frase', regexp_replace(x->>'frase', tapar, 'R-X', 'g'), 'pagadas', x->'pagadas', 'validado_solo', x->'validado_solo'));
  -- Las guardas, con una persona de otra cuenta.
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from _n where clave = 'otra'), 'role', 'authenticated')::text, true);
  err := null; begin perform public.conta_remesa_casar(m1, rem, null); exception when others then err := sqlstate || ' ' || sqlerrm; end;
  out := out || jsonb_build_object('guarda_remesa', err);
  err := null; begin perform public.bank_casar(m2, '{"tipo":"cuenta"}'::jsonb, 'seguro', 'x', '[]'::jsonb, 'persona', null); exception when others then err := sqlstate || ' ' || sqlerrm; end;
  out := out || jsonb_build_object('guarda_bank', err);
  err := null; begin perform public.mark_supplier_invoice_paid(f3, date '2026-10-23', 'transfer'); exception when others then err := sqlstate || ' ' || sqlerrm; end;
  out := out || jsonb_build_object('guarda_marcar', err);
  err := null; begin perform public.bank_casar('00000000-0000-4000-8000-000000000000', '{}'::jsonb, 'seguro', 'x', '[]'::jsonb, 'persona', null); exception when others then err := sqlstate || ' ' || sqlerrm; end;
  out := out || jsonb_build_object('sin_movimiento', err);
  err := null; begin perform public.conta_remesa_casar(m1, '00000000-0000-4000-8000-000000000000', null); exception when others then err := sqlstate || ' ' || sqlerrm; end;
  out := out || jsonb_build_object('sin_remesa', err);
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from _n where clave = 'admin'), 'role', 'authenticated')::text, true);
  -- Lo que queda escrito.
  out := out || jsonb_build_object(
    'facturas', (select jsonb_agg(jsonb_build_object('n', invoice_number, 'status', status, 'paid_at', paid_at, 'metodo', paid_method, 'por', paid_by_name, 'asiento', payment_entry_id is not null) order by invoice_number)
                   from public.supplier_invoice where id in (f1, f2, f3)),
    -- La huella del asiento sale de su id y de su hora (cambian a cada lado): se mira que la tenga y encadene, no cuál es.
    'asientos_validados', (select jsonb_agg(jsonb_build_object('serie', je.series, 'numero', je.number, 'por', regexp_replace(coalesce(je.validated_by_name, ''), tapar, 'R-X', 'g'),
                   'con_huella', je.hash ~ '^[0-9a-f]{64}$', 'encadena', je.chain_seq is not null) order by je.number)
                  from public.journal_entry je where je.id in (select journal_entry_id from public.bank_match where movement_id in (m1, m2, m3)) and je.status = 'validado'),
    'pagos', (select jsonb_agg(jsonb_build_object('n', si.invoice_number, 'importe', p.amount, 'con_asiento', p.entry_id is not null) order by si.invoice_number, p.amount)
                from public.supplier_invoice_payment p join public.supplier_invoice si on si.id = p.invoice_id where p.invoice_id in (f1, f2, f3)),
    'registro_pagos', (select jsonb_agg(jsonb_build_object('n', si.invoice_number, 'accion', l.action, 'metodo', l.paid_method, 'por', l.actor_name) order by si.invoice_number, l.action)
                from public.supplier_invoice_payment_log l join public.supplier_invoice si on si.id = l.invoice_id where l.invoice_id in (f1, f2, f3)),
    'casados', (select jsonb_agg(jsonb_build_object('mov', bm.bank_concept, 'kind', b2.kind, 'status', b2.status, 'por', b2.by_who, 'confianza', b2.confidence, 'porque', regexp_replace(coalesce(b2.reason, ''), tapar, 'R-X', 'g'),
                   'items', (select jsonb_agg(jsonb_build_object('importe', i.amount, 'marcada', i.marked_by_bank) order by i.amount) from public.bank_match_item i where i.match_id = b2.id)) order by bm.bank_concept)
                  from public.bank_match b2 join public.bank_movement bm on bm.id = b2.movement_id where b2.movement_id in (m1, m2, m3)),
    'movimientos', (select jsonb_agg(jsonb_build_object('c', bank_concept, 'status', status) order by bank_concept) from public.bank_movement where id in (m1, m2, m3)),
    'asientos', (select jsonb_agg(jsonb_build_object('status', je.status, 'serie', je.series, 'numerado', je.number is not null, 'concepto', regexp_replace(coalesce(je.concept, ''), tapar, 'R-X', 'g'),
                   'lineas', (select jsonb_agg(jsonb_build_object('debe', jl.debit, 'haber', jl.credit) order by jl.debit, jl.credit) from public.journal_line jl where jl.entry_id = je.id)) order by je.concept)
                  from public.journal_entry je where je.id in (select journal_entry_id from public.bank_match where movement_id in (m1, m2, m3))),
    'registro_bancos', (select jsonb_agg(jsonb_build_object('accion', l.action, 'por', l.by_who, 'resumen', regexp_replace(coalesce(l.summary, ''), tapar, 'R-X', 'g')) order by l.created_at, l.action)
                  from public.bank_activity_log l where l.movement_id in (m1, m2, m3)),
    'registro_remesa', (select jsonb_agg(regexp_replace(ev.texto, tapar, 'R-X', 'g') order by ev.at, ev.texto) from public.conta_pago_remesa_evento ev where ev.remesa_id in (rem, rem3)));
  -- Los ids cambian a cada lado del savepoint: fuera.
  return regexp_replace(out::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'U', 'g')::jsonb;
end $$;

savepoint antes_de_la_2030;
select pg_temp.caso()::text as antes \gset
rollback to savepoint antes_de_la_2030;
\i supabase/migrations/20261101T2030_b01n_nucleos_casar.sql
select pg_temp.caso()::text as despues \gset
-- psql no sustituye sus variables dentro de un bloque $$: las dos medidas, a la tabla de la prueba.
insert into _n values ('antes', :'antes'), ('despues', :'despues');
do $$
declare a jsonb := (select v::jsonb from _n where clave = 'antes'); d jsonb := (select v::jsonb from _n where clave = 'despues'); k text;
begin
  if a is distinct from d then
    for k in select key from jsonb_each(a) where a->key is distinct from d->key loop
      raise warning 'PRUEBA B01 PR 3a · 1: «%» antes %, después %.', k, left((a->k)::text, 600), left((d->k)::text, 600);
    end loop;
    raise exception 'PRUEBA B01 PR 3a · 1: las públicas no hacen lo mismo con los núcleos.';
  end if;
  if a->'remesa_casar'->>'pagadas' <> '1' or a->>'guarda_remesa' not like '42501 %' or a->>'guarda_bank' not like '42501 %' or a->>'marcar_a_mano' not like '23514 %'
     or a->>'sin_movimiento' not like 'P0002 %' or a->>'sin_remesa' not like 'P0002 %' or jsonb_array_length(a->'casados') <> 3
     or not (a->'remesa_validada_sola'->>'validado_solo')::boolean or jsonb_array_length(coalesce(a->'asientos_validados', '[]')) <> 1 then
    raise exception 'PRUEBA B01 PR 3a · 1: el caso no ha recorrido lo que tenía que recorrer: %', left(a::text, 1500);
  end if;
  raise notice 'PRUEBA B01 PR 3a · 1: antes = después (% claves comparadas): casar un pago a mano y un cargo con su factura, marcar a mano (para), las guardas y lo que queda escrito.',
    (select count(*) from jsonb_object_keys(a));
end $$;

-- ── 2 · Nadie de fuera llama a un núcleo ────────────────────────────────────
do $$
declare f text; r text;
begin
  foreach f in array array['public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', 'public._conta_remesa_casar_nucleo(uuid,uuid,uuid[],text)',
                           'public._mark_supplier_invoice_paid_nucleo(uuid,date,text,text)'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(r, f, 'execute') then raise exception 'PRUEBA B01 PR 3a · 2: % puede llamar a %.', r, f; end if;
    end loop;
  end loop;
  if has_function_privilege('authenticated', 'public.conta_pago_casar_banco(uuid)', 'execute') or has_function_privilege('anon', 'public.conta_pago_casar_banco(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.conta_pago_casar_banco(uuid)', 'execute') then
    raise exception 'PRUEBA B01 PR 3a · 2: conta_pago_casar_banco no es solo de la clave de servicio.';
  end if;
  -- Las públicas siguen como estaban: la persona las llama.
  if not has_function_privilege('authenticated', 'public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_remesa_casar(uuid,uuid,uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_supplier_invoice_paid(uuid,date,text)', 'execute') then
    raise exception 'PRUEBA B01 PR 3a · 2: una pública ha perdido su permiso.';
  end if;
  raise notice 'PRUEBA B01 PR 3a · 2: los núcleos, de nadie de fuera; conta_pago_casar_banco, solo la clave de servicio; las públicas, como estaban.';
end $$;

-- ── 3 · El cargo de un pago por Revolut, casado solo ────────────────────────
-- El pago, por el camino de verdad: activar, aprobar (IBAN comprobado y bajo el
-- tope: listo), mandar y lo que dice el banco.
set local role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select public.conta_pago_activar((select v::uuid from _n where clave = 'empresa'), (select v::uuid from _n where clave = 'admin')) is not null as activado;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _n where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb;
begin
  x := public.conta_pago_aprobar((select v::uuid from _n where clave = 'empresa'), (select v::uuid from _n where clave = 'banco'),
         jsonb_build_array(jsonb_build_object('id', (select v from _n where clave = 'f4'))));
  if x->>'estado' <> 'listo' then raise exception 'PRUEBA B01 PR 3a · 3: P3A-4 tenía que salir listo: %', x; end if;
  insert into _n values ('lote', x->>'lote');
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
do $$
declare x jsonb; s uuid;
begin
  x := public.conta_pago_mandar_empezar((select v::uuid from _n where clave = 'lote'));
  s := (x->'pagos'->0->>'salida')::uuid;
  insert into _n values ('salida', s);
  -- Antes de que el banco diga nada: no hay nada que casar.
  if (public.conta_pago_casar_banco(s)->>'casado')::boolean then raise exception 'PRUEBA B01 PR 3a · 3: casó un pago que el banco no ha pagado.'; end if;
  perform public.conta_pago_banco_dice(s, 'pagada', 'tx-prueba-3a', null);
  -- Pagado, pero sin el cargo todavía.
  x := public.conta_pago_casar_banco(s);
  if (x->>'casado')::boolean or x->>'porque' <> 'El cargo aún no ha llegado del banco.' then raise exception 'PRUEBA B01 PR 3a · 3: sin cargo dijo: %', x; end if;
  -- Llega el cargo, con la comisión aparte (su id lleva «:comision»), como lo trae la lectura de Revolut.
  perform public.bank_importar((select v::uuid from _n where clave = 'banco'), 'agregador:revolut', 'agregador:revolut', 'Revolut · prueba 3a', null,
    date '2026-10-24', date '2026-10-24', null, null, 'Prueba sin saldo.', null, jsonb_build_array(
      jsonb_build_object('fecha', '2026-10-24', 'importe', -75.00, 'concepto_banco', 'A PROVEEDOR 3A PRUEBA', 'ref2', 'tx-prueba-3a:l1', 'huella', '2026-10-24|-7500|||tx-prueba-3a:l1|1', 'huella_suave', '2026-10-24|-7500|1'),
      jsonb_build_object('fecha', '2026-10-24', 'importe', -0.20, 'concepto_banco', 'COMISION REVOLUT 3A', 'ref2', 'tx-prueba-3a:l1:comision', 'huella', '2026-10-24|-20|||tx-prueba-3a:l1:comision|1', 'huella_suave', '2026-10-24|-20|1')));
end $$;
-- Sin sesión de nadie: la clave de servicio, como la lectura de cada hora.
select set_config('request.jwt.claims', '', true);
do $$
declare x jsonb; s uuid := (select v::uuid from _n where clave = 'salida'); f uuid := (select v::uuid from _n where clave = 'f4');
begin
  x := public.conta_pago_casar_banco(s);
  if not (x->>'casado')::boolean or (x->>'pagadas')::int <> 1 then raise exception 'PRUEBA B01 PR 3a · 3: no casó el cargo: %', x; end if;
  if coalesce((select status || '/' || coalesce(paid_by_name, '—') || '/' || paid_method from public.supplier_invoice where id = f), 'sin fila') <> 'pagada/Sumied/transfer' then
    raise exception 'PRUEBA B01 PR 3a · 3: la factura no queda pagada por «Sumied»: %', (select status || '/' || coalesce(paid_by_name, '—') from public.supplier_invoice where id = f);
  end if;
  if coalesce((select b.by_who || '/' || bm.bank_concept from public.bank_match b join public.bank_movement bm on bm.id = b.movement_id where b.id = (x->>'match')::uuid), 'sin fila') <> 'folvy/A PROVEEDOR 3A PRUEBA' then
    raise exception 'PRUEBA B01 PR 3a · 3: el casado no es de «folvy» o no es el cargo (la comisión no se casa).';
  end if;
  if coalesce((select estado from public.conta_pago_remesa_linea_estado where id = (select remesa_linea_id from public.conta_pago_salida where id = s)), 'sin fila') <> 'pagada' then
    raise exception 'PRUEBA B01 PR 3a · 3: la línea de la remesa «banco» no queda pagada.';
  end if;
  x := public.conta_pago_casar_banco(s);
  if (x->>'casado')::boolean or x->>'porque' not like 'El pago ya no espera su cargo%' then raise exception 'PRUEBA B01 PR 3a · 3: la segunda vez dijo: %', x; end if;
  raise notice 'PRUEBA B01 PR 3a · 3: «%» El cargo de Revolut, casado solo como «folvy»; la factura, pagada por «Sumied»; la comisión, aparte; la segunda vez, nada.', left((public.conta_pago_casar_banco(s))->>'porque', 60);
end $$;
reset role;

-- ── 4 · La vuelta atrás otra vez ────────────────────────────────────────────
\i supabase/vuelta-atras/20261101T2030_b01n_nucleos_casar.down.sql
do $$ begin
  if (select string_agg(format('%s=%s', p.proname, left(md5(pg_get_functiondef(p.oid)), 8)), ',' order by p.proname) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname in ('bank_casar', 'conta_remesa_casar', 'mark_supplier_invoice_paid'))
     <> 'bank_casar=0f253b11,conta_remesa_casar=57bb45e3,mark_supplier_invoice_paid=927ffeee' then
    raise exception 'PRUEBA B01 PR 3a · 4: la vuelta atrás no devuelve las públicas de producción.';
  end if;
  raise notice 'PRUEBA B01 PR 3a · 4: la vuelta atrás, también con lo casado por los núcleos, devuelve las públicas de producción.';
end $$;

rollback;
