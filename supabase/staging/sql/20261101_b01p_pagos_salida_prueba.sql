-- ============================================================================
-- PRUEBA (staging) · B01 Revolut · PR 2b (1614, que cambia el tipo de remesa y
-- su vista, y añade funciones): la salida al banco en la base. Todo en una
-- transacción con ROLLBACK. Datos INVENTADOS (IBAN del banco 9999, T11), en la
-- cuenta D de staging. Necesita la 1234 (PR 2a), ya aplicada.
--
--   0. La vuelta atrás deja el tipo y la vista como estaban (la huella de la
--      vista de producción, cc12648e…), y la 1614 los vuelve a poner.
--   1. «Activar pagos»: solo un administrador; queda como la primera persona
--      que puede pagar.
--   2. Mandar un pago listo: una remesa «banco», en el banco desde que se
--      manda, con su línea pendiente; lo que necesita la función (la cuenta en
--      el banco, el request_id); el lote, «enviando».
--   3. Un IBAN nuevo: sin la segunda no se manda; con ella, la línea queda
--      confirmada (quién) y la ficha del proveedor también.
--   4. Lo que dice el banco: pagado (y lo mismo dos veces, sin cambio);
--      rechazado (la línea, rechazada; la factura vuelve a tener lo
--      pendiente); un lote ya mandado no se manda otra vez.
--   5. Si el IBAN de la ficha cambia entre aprobar y mandar, no se manda nada.
--   6. Lo que espera respuesta del banco, y que Bancos ofrece la remesa
--      «banco» para casar su cargo como cualquier otra.
--   7. Nadie más que la clave de servicio llama a lo de mandar.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

do $$ begin
  if to_regclass('public.conta_pago_lote') is null then raise exception 'PRUEBA B01 PR 2b · 0: falta la 1234 (PR 2a).'; end if;
end $$;

-- ── 0 · Vuelta atrás y otra vez delante ─────────────────────────────────────
\i supabase/vuelta-atras/20261101T1614_b01p_pagos_salida.down.sql
do $$ begin
  if md5(pg_get_viewdef('public.conta_pago_remesa_estado'::regclass, true)) <> 'cc12648ef880bf89971873b65cd23092' then
    raise exception 'PRUEBA B01 PR 2b · 0: la vuelta atrás no deja la vista de antes (huella %).', md5(pg_get_viewdef('public.conta_pago_remesa_estado'::regclass, true));
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'conta_pago_remesa_kind_check')) like '%banco%'
     or to_regprocedure('public.conta_pago_mandar_empezar(uuid)') is not null then
    raise exception 'PRUEBA B01 PR 2b · 0: la vuelta atrás no quita el tipo «banco» o sus funciones.';
  end if;
end $$;
\i supabase/migrations/20261101T1614_b01p_pagos_salida.sql

create temp table _q (clave text primary key, v text) on commit drop;
grant all on _q to authenticated, service_role;
insert into _q values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('ana', 'c01d0000-0000-4000-8000-0000000000d1'), ('luis', 'b01b0000-0000-4000-8000-0000000000e3');

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _q where clave = 'cuenta'); e uuid := (select v::uuid from _q where clave = 'empresa');
        s1 uuid; s2 uuid; b uuid; i int := 0; s uuid;
begin
  insert into auth.users (id, email) values ((select v::uuid from _q where clave = 'luis'), 'segunda.2b@ejemplo.invalid');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values ((select v::uuid from _q where clave = 'luis'), a, 'manager', true, 'Encargada 2b');
  insert into public.supplier (account_id, name, legal_name, iban) values (a, 'Suministros Prueba 2b', 'Suministros Prueba 2b S.L.', 'ES2999990000000000001234') returning id into s1;
  insert into public.supplier (account_id, name, iban) values (a, 'Bebidas Prueba 2b', 'ES2599990000000000004410') returning id into s2;
  update public.supplier set iban_verified_at = now() where id = s2;
  insert into _q values ('s1', s1), ('s2', s2);
  foreach s in array array[s1, s2] loop
    i := i + 1;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (a, e, 'pymes', '4000998' || i, '4000', 'Proveedores · Prueba 2b ' || i, 'own', 'manual');
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, e, ca.id, 'supplier', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '4000998' || i;
  end loop;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status) values
    (a, e, s1, 'P2B-1', '2026-10-01', 1028.50, 'en_revision'), (a, e, s2, 'P2B-2', '2026-10-02', 310.00, 'en_revision'),
    (a, e, s2, 'P2B-3', '2026-10-03', 120.00, 'en_revision');
  insert into _q select 'f' || substr(invoice_number, 5), id from public.supplier_invoice where account_id = a and invoice_number like 'P2B-%';
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active)
  values (a, e, 'bank', 'Prueba 2b · Revolut', 'ES3099990000000000005678', '572', true) returning id into b;
  insert into public.bank_aggregator_link (account_id, company_id, treasury_account_id, provider, external_account_id, consent_id, consent_valid_until)
  values (a, e, b, 'revolut', 'cuenta-eur-prueba-2b', 'prueba-2b', '9999-12-31T00:00:00Z');
  delete from public.revolut_conexion where company_id = e;
  insert into public.revolut_conexion (account_id, company_id, entorno, estado, certificado, certificado_huella, vuelta, permisos, created_by_name)
  values (a, e, 'sandbox', 'conectada', '-----BEGIN CERTIFICATE-----' || chr(10) || 'INVENTADO' || chr(10) || '-----END CERTIFICATE-----',
          repeat('c', 64), 'https://app.sumied.com/bancos/revolut/vuelta', 'READ,WRITE,PAY', 'Prueba 2b');
  delete from public.conta_pago_permiso where company_id = e;
  insert into _q values ('banco', b);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _q where clave in ('f1', 'f2', 'f3'));
reset role;

-- ── 1 · «Activar pagos» ─────────────────────────────────────────────────────
set local role service_role;
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); x jsonb;
begin
  begin
    perform public.conta_pago_activar(e, (select v::uuid from _q where clave = 'luis'));
    raise exception 'PRUEBA B01 PR 2b · 1: una encargada activó los pagos.';
  exception when insufficient_privilege then null; end;
  x := public.conta_pago_activar(e, (select v::uuid from _q where clave = 'ana'));
  if (x->>'n')::int <> 1 or x->'personas' <> '["Admin Oeste"]'::jsonb then raise exception 'PRUEBA B01 PR 2b · 1: activar: %', x; end if;
  x := public.conta_pago_activar(e, (select v::uuid from _q where clave = 'ana'));
  if (x->>'n')::int <> 1 then raise exception 'PRUEBA B01 PR 2b · 1: activar dos veces dio dos permisos: %', x; end if;
  raise notice 'PRUEBA B01 PR 2b · 1: solo un administrador activa los pagos, y queda como quien paga (una vez).';
end $$;
reset role;

-- ── 2 · Mandar un pago listo ────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb;
begin
  x := public.conta_pago_aprobar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'banco'),
         jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f2'))));
  if x->>'estado' <> 'listo' then raise exception 'PRUEBA B01 PR 2b · 2: P2B-2 tenía que salir listo: %', x; end if;
  insert into _q values ('lote2', x->>'lote');
  x := public.conta_pago_aprobar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'banco'),
         jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f1'))));
  if x->>'estado' <> 'esperando_segunda' then raise exception 'PRUEBA B01 PR 2b · 2: P2B-1 (IBAN nuevo) tenía que esperar la segunda: %', x; end if;
  insert into _q values ('lote1', x->>'lote');
  x := public.conta_pago_aprobar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'banco'),
         jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f3'))));
  insert into _q values ('lote3', x->>'lote');
end $$;
reset role;
set local role service_role;
do $$
declare x jsonb; l uuid := (select v::uuid from _q where clave = 'lote2'); r public.conta_pago_remesa_estado;
begin
  x := public.conta_pago_mandar_empezar(l);
  if x->>'cuenta' <> 'cuenta-eur-prueba-2b' or jsonb_array_length(x->'pagos') <> 1 or (x->'pagos'->0->>'importe')::numeric <> 310
     or x->'pagos'->0->>'request_id' !~ '^[0-9a-f-]{36}$' or x->>'codigo' !~ '^R-\d{4}/\d{3}$' then
    raise exception 'PRUEBA B01 PR 2b · 2: lo que necesita la función: %', x;
  end if;
  select * into r from public.conta_pago_remesa_estado where id = (x->>'remesa')::uuid;
  if r.kind <> 'banco' or r.estado <> 'en_banco' or r.por_cargar <> 310 then raise exception 'PRUEBA B01 PR 2b · 2: la remesa banco: % % %', r.kind, r.estado, r.por_cargar; end if;
  if (select estado from public.conta_pago_remesa_linea_estado where remesa_id = r.id) <> 'pendiente' then raise exception 'PRUEBA B01 PR 2b · 2: la línea no queda pendiente del cargo.'; end if;
  if coalesce((select estado from public.conta_pago_lote where id = l), 'sin fila') <> 'enviando'
     or coalesce((select estado from public.conta_pago_salida where lote_id = l), 'sin fila') <> 'enviando' then
    raise exception 'PRUEBA B01 PR 2b · 2: el lote y su pago tenían que quedar «enviando».';
  end if;
  insert into _q values ('salida2', x->'pagos'->0->>'salida'), ('remesa2', x->>'remesa');
  raise notice 'PRUEBA B01 PR 2b · 2: mandado como remesa % «banco», en el banco, con su línea pendiente del cargo.', x->>'codigo';
end $$;

-- ── 3 · Un IBAN nuevo ───────────────────────────────────────────────────────
do $$
declare ana uuid := (select v::uuid from _q where clave = 'ana'); l uuid := (select v::uuid from _q where clave = 'lote1'); x jsonb; s uuid := (select v::uuid from _q where clave = 's1');
begin
  begin
    perform public.conta_pago_mandar_empezar(l);
    raise exception 'PRUEBA B01 PR 2b · 3: se mandó un IBAN nuevo sin la segunda aprobación.';
  exception when check_violation then null; end;
  x := public.conta_pago_reto_crear(ana, 'confirmar', 'llave', encode(sha256('reto-2b'::bytea), 'hex'), l, null);
  x := public.conta_pago_reto_usar((x->>'reto')::uuid, ana, encode(sha256('reto-2b'::bytea), 'hex'), 'Windows');
  if not (x->>'ok')::boolean then raise exception 'PRUEBA B01 PR 2b · 3: la segunda con la llave: %', x; end if;
  x := public.conta_pago_mandar_empezar(l);
  insert into _q values ('salida1', x->'pagos'->0->>'salida');
  if coalesce((select iban_confirmed_by_name from public.conta_pago_remesa_linea where remesa_id = (x->>'remesa')::uuid), 'nadie') <> 'Admin Oeste'
     or coalesce((select estado from public.conta_pago_remesa_linea_estado where remesa_id = (x->>'remesa')::uuid), 'sin fila') <> 'pendiente' then
    raise exception 'PRUEBA B01 PR 2b · 3: la línea del IBAN nuevo tenía que quedar confirmada por Admin Oeste y pendiente del cargo.';
  end if;
  if (select iban_verified_at from public.supplier where id = s) is null then raise exception 'PRUEBA B01 PR 2b · 3: la ficha no quedó con el IBAN confirmado.'; end if;
  raise notice 'PRUEBA B01 PR 2b · 3: sin la segunda no se manda; con ella, la línea y la ficha quedan con el IBAN confirmado.';
end $$;

-- ── 4 · Lo que dice el banco ────────────────────────────────────────────────
do $$
declare x jsonb; s2 uuid := (select v::uuid from _q where clave = 'salida2'); s1 uuid := (select v::uuid from _q where clave = 'salida1');
begin
  x := public.conta_pago_banco_dice(s2, 'esperando_banco', 'tx-prueba-2', null);
  x := public.conta_pago_banco_dice(s2, 'pagada', 'tx-prueba-2', null);
  if coalesce((select estado || '/' || banco_id from public.conta_pago_salida where id = s2), 'sin fila') <> 'pagada/tx-prueba-2'
     or coalesce((select estado from public.conta_pago_lote where id = (select v::uuid from _q where clave = 'lote2')), 'sin fila') <> 'enviado' then
    raise exception 'PRUEBA B01 PR 2b · 4: pagado: el pago o el lote no quedan bien.';
  end if;
  if not (public.conta_pago_banco_dice(s2, 'pagada', 'tx-prueba-2', null)->>'sin_cambio')::boolean then raise exception 'PRUEBA B01 PR 2b · 4: lo mismo dos veces cambió algo.'; end if;
  if not (public.conta_pago_banco_dice(s2, 'esperando_banco', 'tx-prueba-2', null)->>'sin_cambio')::boolean then raise exception 'PRUEBA B01 PR 2b · 4: un pagado volvió atrás.'; end if;
  x := public.conta_pago_banco_dice(s1, 'rechazada', 'tx-prueba-1', 'No había saldo bastante en la cuenta.');
  if x->>'frase' not like 'Revolut no ha hecho el pago: No había saldo bastante en la cuenta. La factura sigue por pagar.' then raise exception 'PRUEBA B01 PR 2b · 4: la frase del rechazo: %', x; end if;
  if coalesce((select estado from public.conta_pago_remesa_linea_estado where id = (select remesa_linea_id from public.conta_pago_salida where id = s1)), 'sin fila') <> 'rechazada' then
    raise exception 'PRUEBA B01 PR 2b · 4: rechazado: la línea no queda rechazada.';
  end if;
  begin
    perform public.conta_pago_mandar_empezar((select v::uuid from _q where clave = 'lote2'));
    raise exception 'PRUEBA B01 PR 2b · 4: un lote ya mandado se mandó otra vez.';
  exception when check_violation then null; end;
  raise notice 'PRUEBA B01 PR 2b · 4: pagado (y sin cambio la segunda vez); rechazado: la factura vuelve a tener lo pendiente; no se manda dos veces.';
end $$;
reset role;
do $$ begin
  if public._conta_pago_pendiente((select v::uuid from _q where clave = 'f1')) <> 1028.50 then
    raise exception 'PRUEBA B01 PR 2b · 4: rechazado: P2B-1 tenía que volver a tener 1.028,50 pendientes y tiene %.', public._conta_pago_pendiente((select v::uuid from _q where clave = 'f1'));
  end if;
end $$;
set local role service_role;

-- ── 5 · El IBAN cambia entre aprobar y mandar ───────────────────────────────
do $$
declare l uuid := (select v::uuid from _q where clave = 'lote3');
begin
  update public.supplier set iban = 'ES9699990000000000007788' where id = (select v::uuid from _q where clave = 's2');
  begin
    perform public.conta_pago_mandar_empezar(l);
    raise exception 'PRUEBA B01 PR 2b · 5: se mandó con un IBAN distinto del aprobado.';
  exception when check_violation then null; end;
  if coalesce((select estado from public.conta_pago_lote where id = l), 'sin fila') <> 'listo' or exists (select 1 from public.conta_pago_remesa r where r.company_id = (select v::uuid from _q where clave = 'empresa') and r.kind = 'banco' and r.id not in (select remesa_id from public.conta_pago_salida where remesa_id is not null)) then
    raise exception 'PRUEBA B01 PR 2b · 5: al parar, quedó algo a medias.';
  end if;
  raise notice 'PRUEBA B01 PR 2b · 5: el IBAN de la ficha cambió: no se manda, y no queda nada a medias.';
end $$;

-- ── 6 · Lo que espera al banco, y casar el cargo ────────────────────────────
do $$
declare x jsonb := public.conta_pago_por_saber((select v::uuid from _q where clave = 'empresa'));
begin
  if exists (select 1 from jsonb_array_elements(x) e where e->>'estado' not in ('enviando', 'enviada', 'esperando_banco')) then raise exception 'PRUEBA B01 PR 2b · 6: por saber: %', x; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := to_jsonb(array(select to_jsonb(r) from public.conta_remesas_para_casar((select v::uuid from _q where clave = 'empresa')) r));
begin
  if not exists (select 1 from jsonb_array_elements(x) e where e::text like '%' || (select v from _q where clave = 'remesa2') || '%') then
    raise exception 'PRUEBA B01 PR 2b · 6: Bancos no ofrece la remesa «banco» para casar su cargo: %', left(x::text, 400);
  end if;
  raise notice 'PRUEBA B01 PR 2b · 6: Bancos ofrece la remesa «banco» para casar su cargo, como cualquier otra.';
end $$;

-- ── 7 · Solo la clave de servicio ───────────────────────────────────────────
do $$ begin
  begin perform public.conta_pago_mandar_empezar((select v::uuid from _q where clave = 'lote3')); raise exception 'PRUEBA B01 PR 2b · 7: una persona mandó un lote.'; exception when insufficient_privilege then null; end;
  begin perform public.conta_pago_banco_dice((select v::uuid from _q where clave = 'salida2'), 'pagada', 'x', null); raise exception 'PRUEBA B01 PR 2b · 7: una persona dijo lo del banco.'; exception when insufficient_privilege then null; end;
  begin perform public.conta_pago_activar((select v::uuid from _q where clave = 'empresa'), auth.uid()); raise exception 'PRUEBA B01 PR 2b · 7: una persona se activó los pagos sin pasar por Revolut.'; exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA B01 PR 2b · 7: mandar, lo del banco y activar, solo la clave de servicio.';
end $$;
reset role;

rollback;
