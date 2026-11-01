-- ============================================================================
-- PRUEBA (staging) · B01 Revolut · PR 2c-1 (1703, que solo añade): «Dejar de
-- pagar». Todo en una transacción con ROLLBACK. Datos INVENTADOS (IBAN del
-- banco 9999, T11), en la cuenta D. Necesita la 1234 y la 1614.
--
--   0. La vuelta atrás quita la columna y la función, y la 1703 las vuelve a poner.
--   1. oauth_para solo admite conectar | activar_pagos | dejar_de_pagar.
--   2. Dejar de pagar: nadie puede pagar al instante, lo que esperaba la
--      segunda o estaba listo se cancela (y sus retos dejan de valer), lo que
--      ya salió al banco sigue, y la conexión queda sin PAY.
--   3. Después, «Aprobar y pagar» lo dice: sin permiso, y Revolut solo para leer.
--   4. Solo la clave de servicio la llama.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

\i supabase/vuelta-atras/20261101T1703_b01p_dejar_de_pagar.down.sql
do $$ begin
  if to_regprocedure('public.conta_pago_dejar(uuid,uuid,text,text)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'revolut_conexion' and column_name = 'oauth_para') then
    raise exception 'PRUEBA B01 PR 2c-1 · 0: la vuelta atrás no quita la columna o la función.';
  end if;
end $$;
\i supabase/migrations/20261101T1703_b01p_dejar_de_pagar.sql

create temp table _q (clave text primary key, v text) on commit drop;
grant all on _q to authenticated, service_role;
insert into _q values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'), ('ana', 'c01d0000-0000-4000-8000-0000000000d1');

do $$
declare a uuid := (select v::uuid from _q where clave = 'cuenta'); e uuid := (select v::uuid from _q where clave = 'empresa'); s uuid; b uuid;
begin
  insert into public.supplier (account_id, name, iban) values (a, 'Bebidas Prueba 2c', 'ES2599990000000000004410') returning id into s;
  update public.supplier set iban_verified_at = now() where id = s;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, e, 'pymes', '40009971', '4000', 'Proveedores · Prueba 2c', 'own', 'manual');
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, e, ca.id, 'supplier', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '40009971';
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status) values
    (a, e, s, 'P2C-1', '2026-10-01', 10, 'en_revision'), (a, e, s, 'P2C-2', '2026-10-02', 20, 'en_revision'), (a, e, s, 'P2C-3', '2026-10-03', 4000, 'en_revision');
  insert into _q select 'f' || substr(invoice_number, 5), id from public.supplier_invoice where account_id = a and invoice_number like 'P2C-%';
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_active) values (a, e, 'bank', 'Prueba 2c · Revolut', 'ES3099990000000000005678', '572', true) returning id into b;
  insert into public.bank_aggregator_link (account_id, company_id, treasury_account_id, provider, external_account_id, consent_id, consent_valid_until)
  values (a, e, b, 'revolut', 'cuenta-eur-prueba-2c', 'prueba-2c', '9999-12-31T00:00:00Z');
  delete from public.revolut_conexion where company_id = e;
  insert into public.revolut_conexion (account_id, company_id, entorno, estado, certificado, certificado_huella, vuelta, permisos, created_by_name)
  values (a, e, 'sandbox', 'conectada', '-----BEGIN CERTIFICATE-----' || chr(10) || 'INVENTADO' || chr(10) || '-----END CERTIFICATE-----', repeat('d', 64), 'https://app.sumied.com/bancos/revolut/vuelta', 'READ,WRITE,PAY', 'Prueba 2c');
  delete from public.conta_pago_permiso where company_id = e;
  insert into _q values ('banco', b);
  -- 1 · oauth_para
  begin
    update public.revolut_conexion set oauth_para = 'otra_cosa' where company_id = e;
    raise exception 'PRUEBA B01 PR 2c-1 · 1: cupo un oauth_para que no es de Sumied.';
  exception when check_violation then null; end;
  update public.revolut_conexion set oauth_para = 'dejar_de_pagar' where company_id = e;
end $$;
set local role service_role;
select public.conta_pago_activar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'ana'));
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _q where clave in ('f1', 'f2', 'f3'));
do $$
declare e uuid := (select v::uuid from _q where clave = 'empresa'); b uuid := (select v::uuid from _q where clave = 'banco'); x jsonb;
begin
  x := public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f1'))));
  insert into _q values ('listo', x->>'lote');
  x := public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f3'))));
  if x->>'estado' <> 'esperando_segunda' then raise exception 'PRUEBA B01 PR 2c-1 · 2: P2C-3 (más de 3.000) tenía que esperar la segunda: %', x; end if;
  insert into _q values ('espera', x->>'lote');
  x := public.conta_pago_aprobar(e, b, jsonb_build_array(jsonb_build_object('id', (select v from _q where clave = 'f2'))));
  insert into _q values ('salido', x->>'lote');
end $$;
reset role;
set local role service_role;
do $$
declare x jsonb; ana uuid := (select v::uuid from _q where clave = 'ana');
begin
  -- Uno ya salió al banco: dejar de pagar no lo toca.
  x := public.conta_pago_mandar_empezar((select v::uuid from _q where clave = 'salido'));
  x := public.conta_pago_reto_crear(ana, 'confirmar', 'llave', repeat('e', 64), (select v::uuid from _q where clave = 'espera'), null);
  insert into _q values ('reto', x->>'reto');
  -- 2 · Dejar de pagar
  x := public.conta_pago_dejar((select v::uuid from _q where clave = 'empresa'), ana, 'Admin Oeste', null);
  if (x->>'permisos')::int <> 1 or (x->>'lotes')::int <> 2 or x->>'frase' not like 'Ya no se puede pagar con Revolut desde Sumied. Quitado el permiso de pagar a 1 persona. 2 pagos que esperaban no saldrán.' then
    raise exception 'PRUEBA B01 PR 2c-1 · 2: dejar de pagar: %', x;
  end if;
  if coalesce((select estado from public.conta_pago_lote where id = (select v::uuid from _q where clave = 'listo')), '-') <> 'cancelado'
     or coalesce((select estado from public.conta_pago_lote where id = (select v::uuid from _q where clave = 'espera')), '-') <> 'cancelado'
     or coalesce((select estado from public.conta_pago_lote where id = (select v::uuid from _q where clave = 'salido')), '-') <> 'enviando' then
    raise exception 'PRUEBA B01 PR 2c-1 · 2: lo cancelado o lo ya salido no queda como debe.';
  end if;
  if (public.conta_pago_reto_usar((select v::uuid from _q where clave = 'reto'), ana, repeat('e', 64), null)->>'ok')::boolean then raise exception 'PRUEBA B01 PR 2c-1 · 2: el reto del pago cancelado siguió valiendo.'; end if;
  if coalesce((select permisos from public.revolut_conexion where company_id = (select v::uuid from _q where clave = 'empresa')), '-') <> 'READ,WRITE' then raise exception 'PRUEBA B01 PR 2c-1 · 2: la conexión siguió con PAY.'; end if;
  raise notice 'PRUEBA B01 PR 2c-1 · 2: «%»; lo ya salido sigue su camino.', x->>'frase';
end $$;
reset role;
-- 3 · Después, «Aprobar y pagar» lo dice.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_pago_preparar((select v::uuid from _q where clave = 'empresa'), (select v::uuid from _q where clave = 'f1'), (select v::uuid from _q where clave = 'banco'));
begin
  if (x->>'se_puede')::boolean or x->>'porque' not like 'Revolut está conectado solo para leer%' or (x->'quien'->>'yo_puedo')::boolean then raise exception 'PRUEBA B01 PR 2c-1 · 3: después de dejar de pagar: %', x; end if;
  begin perform public.conta_pago_dejar((select v::uuid from _q where clave = 'empresa'), auth.uid(), 'x', null); raise exception 'PRUEBA B01 PR 2c-1 · 4: una persona llamó a dejar de pagar.'; exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA B01 PR 2c-1 · 3 y 4: «Aprobar y pagar» dice «%»; solo la clave de servicio deja de pagar.', x->>'porque';
end $$;
reset role;

rollback;
