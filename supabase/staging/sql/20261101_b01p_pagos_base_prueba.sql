-- ============================================================================
-- PRUEBA (staging) · B01 Revolut · PR 2a (1234, que solo añade): la base del
-- «Pagar» común. Todo en una transacción con ROLLBACK. Datos INVENTADOS
-- (IBAN del banco 9999, T11), en la cuenta D de staging (la que tiene plan
-- también en la base local del W09).
--
--   0. La vuelta atrás deja la base sin el 2a, y la 1234 lo vuelve a poner.
--   1. Sin permiso no se paga: «Nadie tiene todavía el permiso» (y 42501).
--      Solo un administrador da el permiso (a sí mismo también).
--   2. La salida: una cuenta sin Revolut no paga; Revolut solo para leer,
--      tampoco («Activar pagos»); con PAY, sí.
--   3. Lo que no se paga: domiciliada, sin aprobar, sin IBAN, sin su 400.
--   4. Aprobar: un pago con IBAN comprobado y bajo el tope sale «listo» sin
--      segunda; dos a la vez (IBAN nuevo y por encima del tope) piden UNA
--      segunda para los dos; la misma factura no se puede pagar dos veces.
--   5. La segunda con la LLAVE (clave de servicio): un reto equivocado no vale
--      y se descarta; el bueno deja el lote «listo», de esa huella.
--   6. El PIN de pago: sin PIN, se dice; crearlo pide el código del correo;
--      4 fallos dicen cuántos quedan, el 5.º lo bloquea y los pagos siguen
--      esperando; recuperarlo pide otro código; con una lista distinta de la
--      vista no vale; con la buena, «listo» con su PIN.
--   7. Dos personas que pagan: la segunda la da la otra, nunca quien aprobó.
--   8. Los topes: solo un administrador los cambia; por encima del del día,
--      segunda aprobación.
--   9. «No pagar»: cancela y la factura vuelve a tener lo pendiente.
--  10. Quién ve qué: otra cuenta no ve los pagos; nadie lee los retos ni los
--      PIN; nadie lee la clave pública de una llave; lo de la clave de
--      servicio no lo llama una persona.
--  11. La llave nueva: registrarla pide antes el código del correo; un
--      contador que no sube la quita (puede estar copiada).
--  12. La integridad: una factura o un proveedor con un pago no se pueden
--      borrar (23503, on delete restrict).
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

-- ── 0 · Vuelta atrás y otra vez delante ─────────────────────────────────────
-- La 1234 solo añade: desde la rama puede haber ido ya de verdad (W05).
\i supabase/vuelta-atras/20261101T1234_b01p_pagos_base.down.sql
do $$ begin
  if to_regclass('public.conta_pago_lote') is not null or to_regclass('public.conta_pago_pin') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'conta\_pago\_%' and proname <> 'conta_pago_a_mano' or proname like '\_conta\_pago\_%' or proname like 'conta\_llave%')) then
    raise exception 'PRUEBA B01 PR 2a · 0: la vuelta atrás no deja la base sin el 2a.';
  end if;
end $$;
\i supabase/migrations/20261101T1234_b01p_pagos_base.sql

create temp table _q (clave text primary key, v text) on commit drop;
grant all on _q to authenticated, service_role;
insert into _q values
  ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('ana', 'c01d0000-0000-4000-8000-0000000000d1'), ('luis', 'b01b0000-0000-4000-8000-0000000000e2'),
  ('otra', 'c01a0000-0000-4000-8000-0000000000a1');

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _q where clave = 'cuenta'); e uuid := (select v::uuid from _q where clave = 'empresa');
        s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; b uuid; b2 uuid; i int := 0; s uuid;
begin
  if not exists (select 1 from public.company where id = e and account_id = a) then raise exception 'PRUEBA B01 PR 2a · siembra: no está la empresa de la cuenta D.'; end if;
  -- Una segunda persona de la cuenta D, inventada (la usa el punto 7).
  insert into auth.users (id, email) values ((select v::uuid from _q where clave = 'luis'), 'segunda.prueba@ejemplo.invalid');
  insert into public.user_profiles (user_id, account_id, role, active, display_name)
  values ((select v::uuid from _q where clave = 'luis'), a, 'manager', true, 'Segunda Prueba');
  -- Proveedores: 1 sin pagos anteriores (IBAN nuevo), 2 con el IBAN comprobado,
  -- 3 domiciliado, 4 sin IBAN, 5 sin su 400.
  insert into public.supplier (account_id, name, legal_name, iban) values (a, 'Suministros Prueba 2a', 'Suministros Prueba 2a S.L.', 'ES2999990000000000001234') returning id into s1;
  insert into public.supplier (account_id, name, iban) values (a, 'Bebidas Prueba 2a', 'ES2599990000000000004410') returning id into s2;
  update public.supplier set iban_verified_at = now() where id = s2;
  insert into public.supplier (account_id, name, iban, payment_method) values (a, 'Domiciliado Prueba 2a', 'ES9699990000000000007788', 'direct_debit') returning id into s3;
  insert into public.supplier (account_id, name) values (a, 'Sin IBAN Prueba 2a') returning id into s4;
  insert into public.supplier (account_id, name, iban) values (a, 'Sin cuenta Prueba 2a', 'ES9699990000000000007788') returning id into s5;
  insert into _q values ('s1', s1), ('s2', s2), ('s3', s3), ('s4', s4), ('s5', s5);
  foreach s in array array[s1, s2, s3, s4] loop
    i := i + 1;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (a, e, 'pymes', '4000999' || i, '4000', 'Proveedores · Prueba 2a ' || i, 'own', 'manual');
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, e, ca.id, 'supplier', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '4000999' || i;
  end loop;
  -- Facturas.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status) values
    (a, e, s1, 'P2A-1', '2026-10-01', 1028.50, 'en_revision'), (a, e, s2, 'P2A-2', '2026-10-02', 310.00, 'en_revision'),
    (a, e, s2, 'P2A-3', '2026-10-03', 3204.20, 'en_revision'), (a, e, s3, 'P2A-4', '2026-10-04', 30.00, 'en_revision'),
    (a, e, s4, 'P2A-5', '2026-10-05', 40.00, 'en_revision'), (a, e, s5, 'P2A-6', '2026-10-06', 60.00, 'en_revision'),
    (a, e, s1, 'P2A-7', '2026-10-07', 50.00, 'en_revision'), (a, e, s1, 'P2A-8', '2026-10-08', 20.00, 'en_revision'),
    (a, e, s2, 'P2A-9', '2026-10-09', 400.00, 'en_revision'), (a, e, s2, 'P2A-10', '2026-10-10', 15.00, 'en_revision');
  insert into _q select 'f' || substr(invoice_number, 5), id from public.supplier_invoice where account_id = a and invoice_number like 'P2A-%';
  -- Dos bancos: uno sin Revolut y otro con Revolut (aún solo para leer).
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (a, e, 'bank', 'Prueba 2a · Sin Revolut', 'ES3099990000000000005678', '572', true) returning id into b2;
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (a, e, 'bank', 'Prueba 2a · Revolut', 'ES3099990000000000005678', '572', true) returning id into b;
  insert into public.bank_aggregator_link (account_id, company_id, treasury_account_id, provider, external_account_id, consent_id, consent_valid_until)
  values (a, e, b, 'revolut', 'prueba-2a-cuenta', 'prueba-2a', '9999-12-31T00:00:00Z');
  delete from public.revolut_conexion where company_id = e;
  insert into public.revolut_conexion (account_id, company_id, entorno, estado, certificado, certificado_huella, vuelta, permisos, created_by_name)
  values (a, e, 'sandbox', 'conectada', '-----BEGIN CERTIFICATE-----' || chr(10) || 'INVENTADO' || chr(10) || '-----END CERTIFICATE-----',
          repeat('b', 64), 'https://app.sumied.com/bancos/revolut/vuelta', 'READ,WRITE', 'Prueba 2a');
  insert into _q values ('banco', b), ('banco_sin', b2);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _q where clave in ('f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10'));

-- ── 1 · Sin permiso no se paga ──────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); b uuid := (select v::uuid from _q where clave = 'banco'); x jsonb;
begin
  x := public.conta_pago_preparar(e, (select v::uuid from _q where clave = 'f2'), b);
  if (x->>'se_puede')::boolean or x->>'porque' not like '%Revolut está conectado solo para leer%' then
    raise exception 'PRUEBA B01 PR 2a · 1: sin PAY, preparar tenía que decir «solo para leer» primero: %', x;
  end if;
  if (x->'quien'->>'n')::int <> 0 or (x->'quien'->>'yo_puedo')::boolean then raise exception 'PRUEBA B01 PR 2a · 1: nadie tenía que poder pagar todavía: %', x->'quien'; end if;
  begin
    perform public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f2'))));
    raise exception 'PRUEBA B01 PR 2a · 1: se aprobó un pago sin permiso.';
  exception when insufficient_privilege then null; end;
  x := public.conta_pago_permiso_dar(e, (select v::uuid from _q where clave = 'ana'));
  if (x->>'n')::int <> 1 or x->>'frase' not like '%Es la única persona que paga%' then raise exception 'PRUEBA B01 PR 2a · 1: dar el permiso a sí misma: %', x; end if;
  raise notice 'PRUEBA B01 PR 2a · 1: sin permiso, no se aprueba; «%»', x->>'frase';
end $$;
-- La segunda persona (encargada, no administradora) no puede dar permisos.
select set_config('request.jwt.claims', json_build_object('sub', 'b01b0000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
do $$ begin
  perform public.conta_pago_permiso_dar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'luis'));
  raise exception 'PRUEBA B01 PR 2a · 1: una encargada se dio el permiso de pagar.';
exception when insufficient_privilege then raise notice 'PRUEBA B01 PR 2a · 1: una encargada no da permisos (42501).'; end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);

-- ── 2 · La salida ───────────────────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); x jsonb;
begin
  x := public.conta_pago_preparar(e, (select v::uuid from _q where clave = 'f2'), (select v::uuid from _q where clave = 'banco_sin'));
  if (x->>'se_puede')::boolean or x->>'porque' not like 'Desde «Prueba 2a · Sin Revolut» no se puede pagar con Sumied%' then raise exception 'PRUEBA B01 PR 2a · 2: una cuenta sin Revolut: %', x->>'porque'; end if;
end $$;
reset role;
update public.revolut_conexion set permisos = 'READ,WRITE,PAY' where company_id = (select v::uuid from _q where clave = 'empresa');
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); b uuid := (select v::uuid from _q where clave = 'banco'); x jsonb;
begin
  x := public.conta_pago_preparar(e, (select v::uuid from _q where clave = 'f2'), b);
  if not (x->>'se_puede')::boolean or x->>'iban_check' <> 'comprobado' or (x->>'importe')::numeric <> 310 or jsonb_array_length(x->'motivos') <> 0 then
    raise exception 'PRUEBA B01 PR 2a · 2: con PAY, P2A-2 se tenía que poder pagar sin segunda: %', x;
  end if;
  x := public.conta_pago_preparar(e, (select v::uuid from _q where clave = 'f1'), b);
  if x->'motivos' <> '["iban_nuevo"]'::jsonb or x->>'beneficiario' <> 'Suministros Prueba 2a S.L.' then raise exception 'PRUEBA B01 PR 2a · 2: P2A-1 tenía que pedir segunda por IBAN nuevo: %', x; end if;
  raise notice 'PRUEBA B01 PR 2a · 2: sin Revolut no; solo para leer no; con PAY sí. P2A-1: %.', x->'motivos_texto';
end $$;

-- ── 3 · Lo que no se paga ───────────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); b uuid := (select v::uuid from _q where clave = 'banco'); x jsonb; c text; esperado text;
begin
  for c, esperado in values ('f4', '%no se paga por transferencia: la paga el banco solo (domiciliada)%'), ('f5', '%no tiene un IBAN válido en su ficha%'),
                            ('f6', '%no tiene su cuenta de proveedor (400)%') loop
    x := public.conta_pago_preparar(e, (select v::uuid from _q where clave = c), b);
    if (x->>'se_puede')::boolean or x->>'porque' not like esperado then raise exception 'PRUEBA B01 PR 2a · 3: % tenía que decir «%»: %', c, esperado, x->>'porque'; end if;
    begin
      perform public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = c))));
      raise exception 'PRUEBA B01 PR 2a · 3: se aprobó %.', c;
    exception when check_violation then null; end;
  end loop;
  if exists (select 1 from public.conta_pago_lote where company_id = e) then raise exception 'PRUEBA B01 PR 2a · 3: un aprobar que para dejó un lote.'; end if;
  raise notice 'PRUEBA B01 PR 2a · 3: domiciliada, sin IBAN y sin 400 no se pagan, y no queda nada.';
end $$;

-- ── 4 · Aprobar ─────────────────────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); b uuid := (select v::uuid from _q where clave = 'banco'); x jsonb;
begin
  x := public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f2'))));
  if x->>'estado' <> 'listo' or x->'segunda' <> 'null'::jsonb then raise exception 'PRUEBA B01 PR 2a · 4: P2A-2 tenía que salir listo sin segunda: %', x; end if;
  begin
    perform public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f2'))));
    raise exception 'PRUEBA B01 PR 2a · 4: P2A-2 se aprobó dos veces.';
  exception when check_violation then null; end;
  x := public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f1')), jsonb_build_object('id', (select v from _q where clave = 'f3'))));
  if x->>'estado' <> 'esperando_segunda' or (x->>'pagos')::int <> 2 or (x->>'total')::numeric <> 4232.70
     or x->'segunda'->>'quien' <> 'la_misma' or x->'segunda'->'motivos' <> '["iban_nuevo", "tope_pago"]'::jsonb or x->>'huella' !~ '^[0-9a-f]{64}$' then
    raise exception 'PRUEBA B01 PR 2a · 4: P2A-1 y P2A-3 juntas tenían que pedir UNA segunda (IBAN nuevo y tope): %', x;
  end if;
  insert into _q values ('lote1', x->>'lote'), ('huella1', x->>'huella');
  x := public.conta_pago_lote_ver((x->>'lote')::uuid);
  if not (x->>'puedo_dar')::boolean or jsonb_array_length(x->'pagos') <> 2 then raise exception 'PRUEBA B01 PR 2a · 4: la pantalla de la segunda: %', x; end if;
  raise notice 'PRUEBA B01 PR 2a · 4: P2A-2 listo; P2A-1 y P2A-3, una segunda para las dos (%).', x->'motivos_texto';
end $$;
reset role;
do $$ begin
  if (select v from _q where clave = 'huella1') <> public._conta_pago_huella((select v::uuid from _q where clave = 'lote1')) then
    raise exception 'PRUEBA B01 PR 2a · 4: la huella guardada no es la de la lista.';
  end if;
end $$;

-- ── 5 · La segunda con la llave (la función que comprueba la firma, 2b) ────
set local role service_role;
do $$
declare ana uuid := (select v::uuid from _q where clave = 'ana'); l uuid := (select v::uuid from _q where clave = 'lote1'); x jsonb; r uuid;
begin
  x := public.conta_pago_reto_crear(ana, 'confirmar', 'llave', encode(sha256('reto-uno'::bytea), 'hex'), l, null);
  r := (x->>'reto')::uuid;
  x := public.conta_pago_reto_usar(r, ana, encode(sha256('otro-reto'::bytea), 'hex'), 'Windows');
  if (x->>'ok')::boolean or x->>'porque' not like 'La llave no ha firmado esto%' then raise exception 'PRUEBA B01 PR 2a · 5: una firma de otro reto valió: %', x; end if;
  x := public.conta_pago_reto_usar(r, ana, encode(sha256('reto-uno'::bytea), 'hex'), 'Windows');
  if (x->>'ok')::boolean then raise exception 'PRUEBA B01 PR 2a · 5: el reto descartado valió después.'; end if;
  begin
    perform public.conta_pago_reto_crear(ana, 'confirmar', 'codigo', encode(sha256('x'::bytea), 'hex'), l, null);
    raise exception 'PRUEBA B01 PR 2a · 5: un pago se pudo confirmar con un código del correo.';
  exception when check_violation then null; end;
  x := public.conta_pago_reto_crear(ana, 'confirmar', 'llave', encode(sha256('reto-dos'::bytea), 'hex'), l, null);
  x := public.conta_pago_reto_usar((x->>'reto')::uuid, ana, encode(sha256('reto-dos'::bytea), 'hex'), 'Windows');
  if not (x->>'ok')::boolean or (x->>'pagos')::int <> 2 then raise exception 'PRUEBA B01 PR 2a · 5: con la llave buena: %', x; end if;
  if coalesce((select estado || '/' || segunda_via || '/' || segunda_por_nombre from public.conta_pago_lote where id = l), 'sin fila') <> 'listo/llave/Admin Oeste'
     or (select count(*) from public.conta_pago_salida where lote_id = l and estado = 'lista') <> 2 then
    raise exception 'PRUEBA B01 PR 2a · 5: el lote no quedó listo con la llave de Admin Oeste.';
  end if;
  raise notice 'PRUEBA B01 PR 2a · 5: «%»', x->>'frase';
end $$;
reset role;

-- ── 6 · El PIN de pago ──────────────────────────────────────────────────────
set local role authenticated;
do $$
declare x jsonb;
begin
  x := public.conta_pago_aprobar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'banco'),
         jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f7'))));
  if x->>'estado' <> 'esperando_segunda' then raise exception 'PRUEBA B01 PR 2a · 6: P2A-7 (IBAN nuevo) tenía que esperar la segunda: %', x; end if;
  insert into _q values ('lote2', x->>'lote'), ('huella2', x->>'huella');
  if public.conta_pago_pin_mio() <> '{"tiene": false, "quedan": null, "bloqueado": false}'::jsonb then raise exception 'PRUEBA B01 PR 2a · 6: pin_mio sin PIN: %', public.conta_pago_pin_mio(); end if;
end $$;
reset role;
set local role service_role;
do $$
declare ana uuid := (select v::uuid from _q where clave = 'ana'); l uuid := (select v::uuid from _q where clave = 'lote2'); h text := (select v from _q where clave = 'huella2');
        bueno text := encode(sha256('sal|123987'::bytea), 'hex'); malo text := encode(sha256('sal|000001'::bytea), 'hex'); x jsonb; r uuid; i int;
begin
  x := public.conta_pago_pin_confirmar(ana, l, bueno, h, null);
  if not (x->>'sin_pin')::boolean then raise exception 'PRUEBA B01 PR 2a · 6: sin PIN tenía que decirlo: %', x; end if;
  begin
    perform public.conta_pago_pin_guardar(ana, bueno, repeat('ab', 16));
    raise exception 'PRUEBA B01 PR 2a · 6: se creó un PIN sin el código del correo.';
  exception when insufficient_privilege then null; end;
  x := public.conta_pago_reto_crear(ana, 'crear_pin', 'codigo', encode(sha256('482913'::bytea), 'hex'), null, 'a•••@ejemplo.invalid');
  r := (x->>'reto')::uuid;
  x := public.conta_pago_reto_usar(r, ana, encode(sha256('111111'::bytea), 'hex'), null);
  if (x->>'quedan')::int <> 2 then raise exception 'PRUEBA B01 PR 2a · 6: un código mal tenía que dejar 2 intentos: %', x; end if;
  x := public.conta_pago_reto_usar(r, ana, encode(sha256('482913'::bytea), 'hex'), null);
  if not (x->>'ok')::boolean then raise exception 'PRUEBA B01 PR 2a · 6: el código bueno no valió: %', x; end if;
  x := public.conta_pago_pin_guardar(ana, bueno, repeat('ab', 16));
  if not (x->>'nuevo')::boolean then raise exception 'PRUEBA B01 PR 2a · 6: crear el PIN: %', x; end if;
  for i in 1..4 loop
    x := public.conta_pago_pin_confirmar(ana, l, malo, h, null);
    if (x->>'quedan')::int <> 5 - i then raise exception 'PRUEBA B01 PR 2a · 6: fallo %: %', i, x; end if;
  end loop;
  x := public.conta_pago_pin_confirmar(ana, l, malo, h, null);
  if not coalesce((x->>'bloqueado')::boolean, false) or coalesce((select estado from public.conta_pago_lote where id = l), 'sin fila') <> 'esperando_segunda' then
    raise exception 'PRUEBA B01 PR 2a · 6: el 5.º fallo tenía que bloquear el PIN y dejar el pago esperando: %', x;
  end if;
  x := public.conta_pago_pin_confirmar(ana, l, bueno, h, null);
  if not (x->>'bloqueado')::boolean then raise exception 'PRUEBA B01 PR 2a · 6: bloqueado, el PIN bueno valió.'; end if;
  -- Recuperarlo: otro código del correo, y el PIN nuevo.
  x := public.conta_pago_reto_crear(ana, 'crear_pin', 'codigo', encode(sha256('305118'::bytea), 'hex'), null, 'a•••@ejemplo.invalid');
  perform public.conta_pago_reto_usar((x->>'reto')::uuid, ana, encode(sha256('305118'::bytea), 'hex'), null);
  x := public.conta_pago_pin_guardar(ana, bueno, repeat('cd', 16));
  if (x->>'nuevo')::boolean or coalesce((select intentos from public.conta_pago_pin where user_id = ana), -1) <> 0 or not exists (select 1 from public.conta_pago_pin where user_id = ana and bloqueado_at is null) then
    raise exception 'PRUEBA B01 PR 2a · 6: recuperar el PIN tenía que desbloquearlo: %', x;
  end if;
  -- Con otra lista (la vista no es la de ahora), no vale.
  x := public.conta_pago_pin_confirmar(ana, l, bueno, (select v from _q where clave = 'huella1'), null);
  if (x->>'ok')::boolean or x->>'porque' not like 'La lista de pagos ha cambiado%' then raise exception 'PRUEBA B01 PR 2a · 6: con otra lista valió: %', x; end if;
  x := public.conta_pago_pin_confirmar(ana, l, bueno, h, 'iPhone');
  if not (x->>'ok')::boolean or coalesce((select segunda_via from public.conta_pago_lote where id = l), 'sin fila') <> 'pin' then raise exception 'PRUEBA B01 PR 2a · 6: con el PIN bueno: %', x; end if;
  raise notice 'PRUEBA B01 PR 2a · 6: sin PIN, se dice; 5 fallos lo bloquean; recuperado con el correo; «%»', x->>'frase';
end $$;
reset role;

-- ── 7 · Dos personas que pagan ──────────────────────────────────────────────
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); x jsonb;
begin
  x := public.conta_pago_permiso_dar(e, (select v::uuid from _q where clave = 'luis'));
  if (x->>'n')::int <> 2 then raise exception 'PRUEBA B01 PR 2a · 7: dar el permiso a la segunda persona: %', x; end if;
  x := public.conta_pago_aprobar(e, (select v::uuid from _q where clave = 'banco'), jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f8'))));
  if x->'segunda'->>'quien' <> 'otra' or x->'segunda'->'personas' <> '["Segunda Prueba"]'::jsonb then raise exception 'PRUEBA B01 PR 2a · 7: con dos, la segunda la da la otra: %', x; end if;
  insert into _q values ('lote3', x->>'lote'), ('huella3', x->>'huella');
end $$;
reset role;
set local role service_role;
do $$
declare l uuid := (select v::uuid from _q where clave = 'lote3'); x jsonb;
begin
  begin
    perform public.conta_pago_reto_crear((select v::uuid from _q where clave = 'ana'), 'confirmar', 'llave', repeat('1', 64), l, null);
    raise exception 'PRUEBA B01 PR 2a · 7: quien aprobó pudo pedir dar su propia segunda.';
  exception when insufficient_privilege then null; end;
  x := public.conta_pago_pin_confirmar((select v::uuid from _q where clave = 'ana'), l, encode(sha256('sal|123987'::bytea), 'hex'), (select v from _q where clave = 'huella3'), null);
  if (x->>'ok')::boolean or x->>'porque' not like 'Lo aprobaste tú%' then raise exception 'PRUEBA B01 PR 2a · 7: quien aprobó dio su propia segunda con el PIN: %', x; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'b01b0000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_pago_para_mi((select v::uuid from _q where clave = 'empresa'));
begin
  if jsonb_array_length(x) <> 1 or x->0->>'lote' <> (select v from _q where clave = 'lote3') then raise exception 'PRUEBA B01 PR 2a · 7: lo que espera a la segunda persona: %', x; end if;
  if not (public.conta_pago_lote_ver((select v::uuid from _q where clave = 'lote3'))->>'puedo_dar')::boolean then raise exception 'PRUEBA B01 PR 2a · 7: la segunda persona no podía darla.'; end if;
end $$;
reset role;
set local role service_role;
do $$
declare luis uuid := (select v::uuid from _q where clave = 'luis'); l uuid := (select v::uuid from _q where clave = 'lote3'); x jsonb;
begin
  x := public.conta_pago_reto_crear(luis, 'confirmar', 'llave', encode(sha256('reto-luis'::bytea), 'hex'), l, null);
  x := public.conta_pago_reto_usar((x->>'reto')::uuid, luis, encode(sha256('reto-luis'::bytea), 'hex'), 'Android');
  if not (x->>'ok')::boolean or coalesce((select segunda_por_nombre from public.conta_pago_lote where id = l), 'sin fila') <> 'Segunda Prueba' then raise exception 'PRUEBA B01 PR 2a · 7: la otra persona con su llave: %', x; end if;
  raise notice 'PRUEBA B01 PR 2a · 7: con dos personas, quien aprobó no puede (ni con la llave ni con el PIN); la otra sí, con su llave.';
end $$;
reset role;

-- ── 8 · Los topes ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'b01b0000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.conta_pago_topes_poner((select v::uuid from _q where clave = 'empresa'), 100, 200);
  raise exception 'PRUEBA B01 PR 2a · 8: una encargada cambió los topes.';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); x jsonb;
begin
  begin
    perform public.conta_pago_topes_poner(e, 6000, 5000);
    raise exception 'PRUEBA B01 PR 2a · 8: un tope por pago mayor que el del día cupo.';
  exception when invalid_parameter_value then null; end;
  x := public.conta_pago_topes_poner(e, 3000, 4700);
  -- Hoy van 310 + 1.028,50 + 3.204,20 + 50 + 20 = 4.612,70; con 400 más, pasa de 4.700.
  if (public.conta_pago_topes(e)->>'aprobado_hoy')::numeric <> 4612.70 then raise exception 'PRUEBA B01 PR 2a · 8: lo aprobado hoy: %', public.conta_pago_topes(e); end if;
  x := public.conta_pago_aprobar(e, (select v::uuid from _q where clave = 'banco'), jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f9'))));
  if x->'segunda'->'motivos' <> '["tope_dia"]'::jsonb then raise exception 'PRUEBA B01 PR 2a · 8: por encima del tope del día tenía que pedir segunda: %', x; end if;
  insert into _q values ('lote4', x->>'lote');
  raise notice 'PRUEBA B01 PR 2a · 8: solo un administrador cambia los topes; por encima del del día, segunda.';
end $$;

-- ── 9 · «No pagar» ──────────────────────────────────────────────────────────
do $$
declare l uuid := (select v::uuid from _q where clave = 'lote4'); x jsonb;
begin
  x := public.conta_pago_cancelar(l, 'Lo pago la semana que viene');
  if coalesce((select estado from public.conta_pago_lote where id = l), 'sin fila') <> 'cancelado' or x->>'frase' not like 'No ha salido nada: 1 pago cancelado%' then raise exception 'PRUEBA B01 PR 2a · 9: cancelar: %', x; end if;
  if (public.conta_pago_preparar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'f9'), (select v::uuid from _q where clave = 'banco'))->>'importe')::numeric <> 400 then
    raise exception 'PRUEBA B01 PR 2a · 9: tras cancelar, P2A-9 tenía que volver a tener 400 pendientes.';
  end if;
  begin
    perform public.conta_pago_cancelar((select v::uuid from _q where clave = 'lote4'), null);
    raise exception 'PRUEBA B01 PR 2a · 9: se canceló dos veces.';
  exception when check_violation then null; end;
  raise notice 'PRUEBA B01 PR 2a · 9: «%»', x->>'frase';
end $$;

-- ── 10 · Quién ve qué ───────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.conta_pago_lote where company_id = (select v::uuid from _q where clave = 'empresa');
  if n <> 5 then raise exception 'PRUEBA B01 PR 2a · 10: la administradora tenía que ver sus 5 lotes y ve %.', n; end if;
  begin perform 1 from public.conta_pago_reto limit 1; raise exception 'PRUEBA B01 PR 2a · 10: una persona leyó los retos.'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.conta_pago_pin limit 1; raise exception 'PRUEBA B01 PR 2a · 10: una persona leyó los PIN.'; exception when insufficient_privilege then null; end;
  begin perform public_key from public.conta_llave limit 1; raise exception 'PRUEBA B01 PR 2a · 10: una persona leyó la clave pública de una llave.'; exception when insufficient_privilege then null; end;
  begin
    perform public.conta_pago_reto_crear(auth.uid(), 'crear_pin', 'codigo', repeat('2', 64), null, null);
    raise exception 'PRUEBA B01 PR 2a · 10: una persona llamó a lo de la clave de servicio.';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.conta_pago_lote where company_id = (select v::uuid from _q where clave = 'empresa');
  if n <> 0 then raise exception 'PRUEBA B01 PR 2a · 10: alguien de otra cuenta ve % lotes de D.', n; end if;
  begin
    perform public.conta_pago_quien((select v::uuid from _q where clave = 'empresa'));
    raise exception 'PRUEBA B01 PR 2a · 10: alguien de otra cuenta leyó quién paga en D.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA B01 PR 2a · 10: otra cuenta no ve nada; retos, PIN y claves públicas, nadie.';
end $$;
reset role;

-- ── 11 · La llave nueva ─────────────────────────────────────────────────────
set local role service_role;
do $$
declare ana uuid := (select v::uuid from _q where clave = 'ana'); x jsonb; r uuid; k uuid;
begin
  begin
    perform public.conta_pago_reto_crear(ana, 'registrar', 'llave', repeat('3', 64), null, null);
    raise exception 'PRUEBA B01 PR 2a · 11: se pudo registrar una llave sin el código del correo.';
  exception when insufficient_privilege then null; end;
  x := public.conta_pago_reto_crear(ana, 'activar_llave', 'codigo', encode(sha256('771204'::bytea), 'hex'), null, 'a•••@ejemplo.invalid');
  perform public.conta_pago_reto_usar((x->>'reto')::uuid, ana, encode(sha256('771204'::bytea), 'hex'), null);
  x := public.conta_pago_reto_crear(ana, 'registrar', 'llave', encode(sha256('registro'::bytea), 'hex'), null, null);
  r := (x->>'reto')::uuid;
  x := public.conta_llave_guardar(ana, r, encode(sha256('registro'::bytea), 'hex'), 'AAAAAAAAAAAAAAAAAAAAAA', 'pQECAyYgASFYIA', -7, 5, 'app.sumied.com', 'Windows', array['internal']);
  k := (x->>'llave')::uuid;
  if public.conta_llave_de(ana, 'AAAAAAAAAAAAAAAAAAAAAA', 'APP.SUMIED.COM')->>'id' <> k::text then raise exception 'PRUEBA B01 PR 2a · 11: no se encuentra la llave guardada.'; end if;
  if public.conta_llave_de(ana, 'AAAAAAAAAAAAAAAAAAAAAA', 'app.folvy.app') is not null then raise exception 'PRUEBA B01 PR 2a · 11: una llave de app.sumied.com valió en app.folvy.app.'; end if;
  if not (public.conta_llave_usada(k, 6)->>'ok')::boolean then raise exception 'PRUEBA B01 PR 2a · 11: un contador que sube no valió.'; end if;
  x := public.conta_llave_usada(k, 6);
  if (x->>'ok')::boolean or public.conta_llave_de(ana, 'AAAAAAAAAAAAAAAAAAAAAA', 'app.sumied.com') is not null then raise exception 'PRUEBA B01 PR 2a · 11: un contador que no sube tenía que quitar la llave: %', x; end if;
  raise notice 'PRUEBA B01 PR 2a · 11: registrar pide el correo; la llave es de su dirección; contador que no sube = quitada.';
end $$;
reset role;


-- ── 12 · La integridad ──────────────────────────────────────────────────────
do $$
begin
  begin
    delete from public.supplier_invoice where id = (select v::uuid from _q where clave = 'f2');
    raise exception 'PRUEBA B01 PR 2a · 12: se borró una factura con un pago.';
  exception when foreign_key_violation then null; end;
  begin
    delete from public.supplier where id = (select v::uuid from _q where clave = 's2');
    raise exception 'PRUEBA B01 PR 2a · 12: se borró un proveedor con pagos.';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.conta_pago_salida (account_id, company_id, lote_id, invoice_id, supplier_id, amount, beneficiario, iban, iban_check, concepto, estado)
    select account_id, company_id, lote_id, gen_random_uuid(), supplier_id, 1, 'x', iban, 'comprobado', 'x', 'cancelada' from public.conta_pago_salida limit 1;
    raise exception 'PRUEBA B01 PR 2a · 12: cupo un pago de una factura que no existe.';
  exception when foreign_key_violation then null; end;
  raise notice 'PRUEBA B01 PR 2a · 12: una factura o un proveedor con pagos no se borran; un pago sin factura no cabe.';
end $$;

rollback;
