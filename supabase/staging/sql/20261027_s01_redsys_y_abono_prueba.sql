-- supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql
--
-- SOLO STAGING. Prueba de la 2030 y la 2031 del S01 · PR 1 (Redsys como
-- segundo proveedor del enlace de pago, y casar en Bancos el abono con su
-- comisión), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- En la empresa A, con datos INVENTADOS que se siembra ella misma (un cliente,
-- su 430 y tres facturas de 121,00 €), por los CAMINOS de verdad: los datos del
-- TPV y los cobros los apunta el servidor (service_role, como conta-redsys,
-- conta-redsys-aviso y conta-stripe-webhook), la página la abre alguien SIN
-- CUENTA (anon), y el abono llega en un extracto (bank_importar) y lo casa el
-- administrador (conta_abono_pasarela_casar → bank_casar), como en Bancos.
-- Ninguna llamada a Redsys ni a Stripe: la firma la prueban las unitarias.
--
--   1. Guardar el TPV: comercio mal escrito, no; sin clave, «falta la clave»;
--      con la clave de prueba de Redsys, «en pruebas», y la clave en Vault (no
--      en la tabla); «Cómo te pagan» no la ve nunca; el servidor sí.
--   2. En pruebas y sin abrir (cobra = no): ni enlace ni página. Abierto: el
--      enlace cobra por Redsys, con tarjeta; con Bizum en el TPV, también Bizum.
--      Otra clave: el mismo secreto, cambiado.
--   3. El pago con Redsys: el número de pedido; el aviso de otro comercio, no;
--      el bueno cobra 121,00 € por el motor de la E1, con «redsys»; repetido,
--      nada. Un aviso mal firmado se apunta y no cobra.
--   4. Con el TPV fuera del enlace, cobra Stripe (lo de la 2031): el cobro, con
--      «stripe», y su comisión (1,95 €) y su neto (119,05 €).
--   5. Lo que espera su abono: los dos cobros.
--   6. El abono de Stripe: con otro importe o con la comisión que no cuadra, no;
--      el bueno (119,05 €): el asiento 572 119,05 · 626 1,95 contra la 430 121,00,
--      el cobro deja de esperar y Cobros dice «abonado el».
--   7. El abono del TPV (120,40 €, sin comisión conocida): 0,60 € a la 626.
--      Juntar Stripe y TPV en un abono, no.
--   8. Deshacer el casado de Stripe en Bancos: el asiento se va y el cobro
--      vuelve a esperar su abono.
--   9. Lo que el E4 ya hacía, igual: la página sin datos del proveedor.
--  10. La vuelta atrás: la 2031 deja las cuatro funciones con el md5 de antes
--      (desde su respaldo, que se borra);
--      la 2030, sin nada suyo, tampoco la clave en Vault.
--
-- Nombra lo que toca, para el analizador: conta_cobro_redsys, conta_enlace_pago,
-- conta_enlace_pago_intento, conta_redsys_aviso, conta_enlace_pago_para,
-- conta_enlace_pago_ver, conta_enlace_pago_datos, conta_enlace_pago_cobrado,
-- customer_invoice_payment, customer_invoice_event, bank_casar, bank_match,
-- vault.secrets.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 REDSYS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- Lo de antes: las cuatro funciones del enlace tal como las dejó la 1121.
create temp table _md5 (fn text primary key, antes text) on commit drop;
insert into _md5 select p.proname, md5(p.prosrc) from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('conta_enlace_pago_para', 'conta_enlace_pago_ver', 'conta_enlace_pago_datos', 'conta_enlace_pago_cobrado');
-- La 2031 solo va en ROLLBACK (cambia), y su vuelta atrás restaura desde el
-- respaldo que guarda ella misma: no se pasa aquí. La 2030 sí se quita antes,
-- por si el ensayo de la rama la hubiera pasado de verdad.
\i supabase/vuelta-atras/20261027T2030_s01_redsys_y_abono.down.sql
do $$ begin
  if to_regclass('public.conta_cobro_redsys') is not null or (select count(*) from _md5) <> 4 then
    raise exception 'PRUEBA S01 REDSYS · 0: staging no está como antes de la 2030 (o le falta la 1121).';
  end if;
end $$;
\i supabase/migrations/20261027T2030_s01_redsys_y_abono.sql
\i supabase/migrations/20261027T2031_s01_enlace_con_redsys.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('banco', 'b0100000-0000-4000-8000-0000000000b3'), ('clave', 'sq7HjrUOBfKmC576ILgskD5srU870gJ7');

-- ── Siembra (como el dueño): un cliente, su 430 y tres facturas de 121,00 € ──
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        tra uuid := (select id from public.payment_method where code = 'transferencia' and account_id is null limit 1);
        s uuid; f uuid; i int;
begin
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente S01 Tarjeta', 'B00000561') returning id into s;
  insert into _p values ('cliente', s);
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select a, e, ca.plan, '43009901', ca.template_code, 'Clientes · S01', ca.kind, ca.source from public.company_account ca where ca.company_id = e and ca.code = '43000001';
  if not found then raise exception 'PRUEBA S01 REDSYS · siembra: la empresa A no tiene la 43000001 de molde.'; end if;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, e, ca.id, 'customer', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '43009901';
  if not exists (select 1 from public.company_account where company_id = e and code like '626%') then
    raise exception 'PRUEBA S01 REDSYS · siembra: la empresa A no tiene una 626.';
  end if;
  for i in 1..3 loop
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                         party_id, customer, payment_method_id, email_to, base, tax, total)
    values (a, e, 'emitida', 'a_mano', 'S01P', 2026, i, 'S01P-' || i, public.conta_hoy() - 5, public.conta_hoy() + 10, s,
            jsonb_build_object('nombre', 'Cliente S01 Tarjeta'), tra, 'pagos@cliente-s01.example', 100.00, 21.00, 121.00)
    returning id into f;
    insert into _p values ('f' || i, f);
  end loop;
end $$;

-- ── 1 · Guardar el TPV (como el servidor) ──────────────────────────────────
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb; v_err text; ref uuid;
begin
  begin perform public.conta_cobro_redsys_guardar(e, '12345', '1', null, false, true, 'prueba', false, 'Prueba'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'El número de comercio son 9 cifras (te lo da tu banco con el TPV virtual).' then raise exception 'PRUEBA S01 REDSYS · 1: un comercio mal escrito dijo «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_cobro_redsys_guardar(e, '999008881', '1', 'no es una clave', false, true, 'prueba', false, 'Prueba'); exception when others then v_err := sqlerrm; end;
  if v_err not like 'La clave del comercio son 32 letras y números%' then raise exception 'PRUEBA S01 REDSYS · 1: una clave mala dijo «%».', v_err; end if;
  x := public.conta_cobro_redsys_guardar(e, '999 008 881', '001', null, false, true, 'prueba', false, 'Prueba');
  if x->>'estado' <> 'falta_clave' or x->>'frase' <> 'Guardado. Redsys, comercio 999008881: falta la clave del comercio.' then raise exception 'PRUEBA S01 REDSYS · 1: sin clave dio %.', x; end if;
  x := public.conta_cobro_redsys_guardar(e, '999008881', '1', (select v from _p where clave = 'clave'), false, true, 'prueba', false, 'Prueba');
  if x->>'estado' <> 'pruebas' or x->>'frase' <> 'Guardado. Redsys en pruebas, comercio 999008881: tus clientes aún no pagan por aquí; lo abre Julio, empresa a empresa.' then
    raise exception 'PRUEBA S01 REDSYS · 1: con la clave dio %.', x;
  end if;
  if public.conta_cobro_redsys_datos(e)->>'clave' is distinct from (select v from _p where clave = 'clave') then raise exception 'PRUEBA S01 REDSYS · 1: el servidor no lee la clave de Vault.'; end if;
end $$;
reset role;
-- La caja fuerte, mirada como postgres (el servidor la usa solo por las funciones).
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); ref uuid;
begin
  select clave_ref into ref from public.conta_cobro_redsys where company_id = e;
  if ref is null or not exists (select 1 from vault.secrets where id = ref and name = 'conta_redsys:' || e::text) then raise exception 'PRUEBA S01 REDSYS · 1: la clave no está en Vault.'; end if;
  if exists (select 1 from public.conta_cobro_redsys r where r.company_id = e and to_jsonb(r)::text like '%' || (select v from _p where clave = 'clave') || '%') then
    raise exception 'PRUEBA S01 REDSYS · 1: la clave está en la tabla.';
  end if;
  insert into _p values ('ref', ref);
  raise notice '1 · guardar: comercio y clave malos, no; sin clave, «falta la clave»; con ella, «en pruebas» y la clave en Vault, no en la tabla';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_cobro_redsys_leer((select v::uuid from _p where clave = 'empresa')); v_err text;
begin
  if x->>'estado' <> 'pruebas' or (x->>'con_clave')::boolean is not true or x->>'comercio' <> '999008881' or x::text like '%' || (select v from _p where clave = 'clave') || '%' then
    raise exception 'PRUEBA S01 REDSYS · 1: «Cómo te pagan» lee %.', x;
  end if;
  begin perform public.conta_cobro_redsys_datos((select v::uuid from _p where clave = 'empresa')); exception when insufficient_privilege then v_err := 'denegado'; end;
  if v_err is distinct from 'denegado' then raise exception 'PRUEBA S01 REDSYS · 1: el administrador lee la clave.'; end if;
  begin perform 1 from public.conta_cobro_redsys; exception when insufficient_privilege then v_err := 'denegado2'; end;
  if v_err is distinct from 'denegado2' then raise exception 'PRUEBA S01 REDSYS · 1: la tabla del TPV se lee directamente.'; end if;
  raise notice '1 · «Cómo te pagan»: en pruebas, con clave, sin enseñarla; la clave y la tabla, no';
end $$;
reset role;

-- ── 2 · El enlace con Redsys ────────────────────────────────────────────────
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); t text; x jsonb;
begin
  if public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f1')) is not null then
    raise exception 'PRUEBA S01 REDSYS · 2: en pruebas y sin abrir ya hay enlace de pago.';
  end if;
  x := public.conta_cobro_redsys_guardar(e, '999008881', '1', null, false, true, 'prueba', true, 'Prueba');
  if x->>'frase' <> 'Guardado. Redsys en pruebas, comercio 999008881.' or x->>'proveedor_enlace' <> 'redsys' then raise exception 'PRUEBA S01 REDSYS · 2: abierto dio %.', x; end if;
  if (select clave_ref::text from public.conta_cobro_redsys where company_id = e) <> (select v from _p where clave = 'ref') then raise exception 'PRUEBA S01 REDSYS · 2: guardar sin clave perdió la de antes.'; end if;
  t := public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f1'));
  if t is null then raise exception 'PRUEBA S01 REDSYS · 2: con Redsys abierto no hay enlace.'; end if;
  insert into _p values ('token1', t);
  insert into _p values ('token2', public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f2')));
  x := public.conta_enlace_pago_datos(t);
  if x->>'proveedor' <> 'redsys' or x->'redsys'->>'comercio' <> '999008881' or x::text like '%' || (select v from _p where clave = 'clave') || '%' then
    raise exception 'PRUEBA S01 REDSYS · 2: los datos del pago son %.', x;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare x jsonb := public.conta_enlace_pago_ver((select v from _p where clave = 'token1'));
begin
  if x->>'estado' <> 'abierto' or x->>'proveedor' <> 'redsys' or x->'metodos' <> '["tarjeta"]'::jsonb or x::text like '%999008881%' then
    raise exception 'PRUEBA S01 REDSYS · 2: la página enseña %.', x;
  end if;
end $$;
reset role;
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  perform public.conta_cobro_redsys_guardar(e, '999008881', '1', 'Mk9m98IfEblmPfrpsawt7BmxObt98Jev', true, true, 'prueba', true, 'Prueba');
  if public.conta_cobro_redsys_datos(e)->>'clave' <> 'Mk9m98IfEblmPfrpsawt7BmxObt98Jev' then raise exception 'PRUEBA S01 REDSYS · 2: la clave nueva no se lee.'; end if;
end $$;
reset role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if (select clave_ref::text from public.conta_cobro_redsys where company_id = e) <> (select v from _p where clave = 'ref')
     or (select count(*) from vault.secrets where name = 'conta_redsys:' || e::text) <> 1 then
    raise exception 'PRUEBA S01 REDSYS · 2: otra clave no cambió el mismo secreto.';
  end if;
end $$;
set local role service_role;
select public.conta_cobro_redsys_guardar((select v::uuid from _p where clave = 'empresa'), '999008881', '1', (select v from _p where clave = 'clave'), true, true, 'prueba', true, 'Prueba') is not null as guardado;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$ begin
  if public.conta_enlace_pago_ver((select v from _p where clave = 'token1'))->'metodos' <> '["tarjeta", "bizum"]'::jsonb then
    raise exception 'PRUEBA S01 REDSYS · 2: con Bizum en el TPV, la página no lo ofrece.';
  end if;
  raise notice '2 · el enlace: sin abrir, nada; abierto, por Redsys con tarjeta (y Bizum si el banco lo tiene); otra clave cambia el mismo secreto';
end $$;
reset role;

-- ── 3 · El pago con Redsys (como el servidor) ──────────────────────────────
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); ped text; x jsonb; d jsonb;
begin
  ped := public.conta_enlace_pago_pedido((select v from _p where clave = 'token1'), 121);
  if ped !~ '^[0-9]{12}$' then raise exception 'PRUEBA S01 REDSYS · 3: el pedido es «%».', ped; end if;
  insert into _p values ('pedido', ped);
  d := public.conta_redsys_aviso_datos(ped);
  if (d->>'empresa')::uuid <> e or d->>'clave' <> (select v from _p where clave = 'clave') then raise exception 'PRUEBA S01 REDSYS · 3: los datos del aviso son otros.'; end if;
  perform public.conta_redsys_aviso_apuntar(ped, e, false, '0000', 121, 'firma mal: no cobra', '{}'::jsonb);
  x := public.conta_enlace_pago_cobrado_redsys(ped, '111111111', 121, 'tarjeta', '123456');
  if x->>'motivo' <> 'otro_comercio' then raise exception 'PRUEBA S01 REDSYS · 3: de otro comercio dio %.', x; end if;
  if (select pendiente from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f1')) <> 121 then
    raise exception 'PRUEBA S01 REDSYS · 3: el aviso mal firmado o de otro comercio cobró.';
  end if;
  x := public.conta_enlace_pago_cobrado_redsys(ped, '999008881', 121, 'tarjeta', '123456');
  if (x->>'hecho')::boolean is not true or (x->>'apuntado')::numeric <> 121 then raise exception 'PRUEBA S01 REDSYS · 3: el cobro dio %.', x; end if;
  if (select estado from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f1')) <> 'cobrada'
     or (select proveedor from public.conta_enlace_pago where token = (select v from _p where clave = 'token1')) <> 'redsys'
     or not exists (select 1 from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f1') and method = 'tarjeta' and amount = 121) then
    raise exception 'PRUEBA S01 REDSYS · 3: la factura no queda cobrada por Redsys.';
  end if;
  x := public.conta_enlace_pago_cobrado_redsys(ped, '999008881', 121, 'tarjeta', '123456');
  if x->>'motivo' <> 'ya_cobrado' or (select count(*) from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f1')) <> 1 then
    raise exception 'PRUEBA S01 REDSYS · 3: el aviso repetido dio %.', x;
  end if;
  if (select count(*) from public.conta_redsys_aviso where pedido = ped and not firma_ok) <> 1 then raise exception 'PRUEBA S01 REDSYS · 3: el aviso mal firmado no quedó apuntado.'; end if;
  raise notice '3 · Redsys: pedido %, de otro comercio no; el bueno cobra 121,00 €; repetido, nada; mal firmado, apuntado y sin cobrar', ped;
end $$;

-- ── 4 · Stripe, con el TPV fuera del enlace ─────────────────────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb;
begin
  perform public.conta_cobro_stripe_apuntar(e, 'acct_prueba_s01', 'activo', 'activo', true, 0, 'Prueba');
  perform public.conta_cobro_redsys_guardar(e, '999008881', '1', null, true, false, 'prueba', true, 'Prueba');
  if public.conta_enlace_pago_datos((select v from _p where clave = 'token2'))->>'proveedor' <> 'stripe' then raise exception 'PRUEBA S01 REDSYS · 4: fuera del enlace, no cobra Stripe.'; end if;
  perform public.conta_enlace_pago_sesion((select v from _p where clave = 'token2'), 'cs_prueba_s01_2');
  x := public.conta_enlace_pago_cobrado('cs_prueba_s01_2', 'acct_otra_s01', 'pi_x', 121, 'tarjeta', null);
  if x->>'motivo' <> 'otra_cuenta' then raise exception 'PRUEBA S01 REDSYS · 4: de otra cuenta dio %.', x; end if;
  x := public.conta_enlace_pago_cobrado('cs_prueba_s01_2', 'acct_prueba_s01', 'pi_prueba_s01_2', 121, 'tarjeta', null);
  if (x->>'hecho')::boolean is not true or (x->>'apuntado')::numeric <> 121 or x ? 'motivo' then raise exception 'PRUEBA S01 REDSYS · 4: el cobro de Stripe dio %.', x; end if;
  perform public.conta_enlace_pago_comision('cs_prueba_s01_2', 1.95, 119.05);
  if (select proveedor || ' ' || comision || ' ' || neto from public.conta_enlace_pago where sesion = 'cs_prueba_s01_2') <> 'stripe 1.95 119.05' then
    raise exception 'PRUEBA S01 REDSYS · 4: el cobro de Stripe no guardó proveedor, comisión y neto.';
  end if;
  raise notice '4 · Stripe: de otra cuenta no; el bueno cobra 121,00 € con «stripe», con 1,95 € de comisión y 119,05 € de neto';
end $$;
reset role;

-- ── 5 · Lo que espera su abono ─────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_abonos_pasarela_pendientes((select v::uuid from _p where clave = 'empresa'));
begin
  if (select count(*) from jsonb_array_elements(x) r where r->>'factura' like 'S01P-%') <> 2
     or not exists (select 1 from jsonb_array_elements(x) r where r->>'factura' = 'S01P-2' and r->>'proveedor' = 'stripe' and (r->>'neto')::numeric = 119.05 and r->>'cuenta' = '43009901')
     or not exists (select 1 from jsonb_array_elements(x) r where r->>'factura' = 'S01P-1' and r->>'proveedor' = 'redsys' and r->>'neto' is null) then
    raise exception 'PRUEBA S01 REDSYS · 5: lo que espera su abono es %.', x;
  end if;
  raise notice '5 · esperan su abono: el de Stripe (neto 119,05 €) y el del TPV (sin neto)';
end $$;

-- ── 6 y 7 · Los abonos llegan al banco y se casan (como el administrador) ──
do $$
declare mv jsonb := '[]'::jsonb; r jsonb; m record; x jsonb; v_err text; ent uuid; lin text; st uuid; rd uuid; fila jsonb;
begin
  st := (select id from public.conta_enlace_pago where token = (select v from _p where clave = 'token2'));
  rd := (select id from public.conta_enlace_pago where token = (select v from _p where clave = 'token1'));
  insert into _p values ('enlace_stripe', st), ('enlace_tpv', rd);
  for m in select * from (values (1, 119.05, 'STRIPE PAYMENTS EUROPE S01'), (2, 118.00, 'STRIPE PAYMENTS EUROPE OTRO S01'), (3, 120.40, 'ABONO TPV COMERCIO 999008881 S01')) x(i, imp, con) loop
    mv := mv || jsonb_build_array(jsonb_build_object('fecha', to_char(public.conta_hoy(), 'YYYY-MM-DD'), 'importe', m.imp,
      'concepto_banco', m.con, 'concepto_limpio', initcap(m.con), 'contraparte', 'STRIPE S01', 'tipo', 'ABONO',
      'huella', 's01-' || m.i, 'huella_suave', 's01-s' || m.i));
  end loop;
  r := public.bank_importar((select v::uuid from _p where clave = 'banco'), 'fichero', 'csv:bbva', 'prueba-s01.xlsx', repeat('e', 64),
    public.conta_hoy(), public.conta_hoy(), null, null, 'prueba', null, mv);
  for m in select distinct on (bm.bank_concept) bm.* from public.bank_movement bm
            where bm.statement_id = (r->>'extracto')::uuid and bm.bank_concept like '% S01' order by bm.bank_concept, bm.created_at desc loop
    insert into _p values (case m.bank_concept when 'STRIPE PAYMENTS EUROPE S01' then 'mov_stripe' when 'STRIPE PAYMENTS EUROPE OTRO S01' then 'mov_otro' else 'mov_tpv' end, m.id);
  end loop;
  if (select count(*) from _p where clave in ('mov_stripe', 'mov_otro', 'mov_tpv')) <> 3 then raise exception 'PRUEBA S01 REDSYS · 6: el extracto no trae los 3 movimientos.'; end if;

  begin perform public.conta_abono_pasarela_casar((select v::uuid from _p where clave = 'mov_otro'), array[st], 'probable', 'prueba', 'persona'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Stripe dice que la comisión de esos cobros es de 1,95 €, y este abono deja 3,00 €: no cuadra.' then raise exception 'PRUEBA S01 REDSYS · 6: la comisión que no cuadra dijo «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_abono_pasarela_casar((select v::uuid from _p where clave = 'mov_tpv'), array[st, rd], 'probable', 'prueba', 'persona'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Un abono es de un solo proveedor: no se juntan cobros de Stripe y del TPV.' then raise exception 'PRUEBA S01 REDSYS · 7: juntar proveedores dijo «%».', v_err; end if;

  x := public.conta_abono_pasarela_casar((select v::uuid from _p where clave = 'mov_stripe'), array[st], 'seguro',
         'Abono de Stripe del día: 1 cobro, 121,00 € menos 1,95 € de comisión.', 'folvy');
  insert into _p values ('casado_stripe', x->>'casado');
  if x->>'frase' not like 'Casado el abono de Stripe del __/__: 1 cobro, 121,00 € menos 1,95 € de comisión. Asiento: 119,05 € al banco y 1,95 € a comisiones.' then
    raise exception 'PRUEBA S01 REDSYS · 6: casar dijo «%».', x->>'frase';
  end if;
  select journal_entry_id into ent from public.bank_match where id = (x->>'casado')::uuid;
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by ca.code) into lin
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = ent;
  if lin not like '43009901 0.00/121.00 · 572_____ 119.05/0.00 · 626_____ 1.95/0.00' then raise exception 'PRUEBA S01 REDSYS · 6: el asiento fue «%».', lin; end if;
  if (select status from public.bank_movement where id = (select v::uuid from _p where clave = 'mov_stripe')) <> 'casado'
     or not (select entry_created from public.bank_match where id = (x->>'casado')::uuid) then
    raise exception 'PRUEBA S01 REDSYS · 6: el movimiento no quedó casado con su asiento.';
  end if;
  select r2 into fila from jsonb_array_elements(public.conta_cobros_abonos((select v::uuid from _p where clave = 'empresa'))) r2
   where r2->>'id' = (select v from _p where clave = 'f2');
  if (fila->>'abonado')::date is distinct from public.conta_hoy() then raise exception 'PRUEBA S01 REDSYS · 6: Cobros no dice «abonado el»: %.', fila; end if;
  if exists (select 1 from jsonb_array_elements(public.conta_abonos_pasarela_pendientes((select v::uuid from _p where clave = 'empresa'))) r2 where (r2->>'id')::uuid = st) then
    raise exception 'PRUEBA S01 REDSYS · 6: el cobro de Stripe sigue esperando su abono.';
  end if;
  raise notice '6 · %', x->>'frase';
  raise notice '6 · el asiento: %', lin;

  x := public.conta_abono_pasarela_casar((select v::uuid from _p where clave = 'mov_tpv'), array[rd], 'probable', 'Abono del TPV del día.', 'persona');
  select journal_entry_id into ent from public.bank_match where id = (x->>'casado')::uuid;
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by ca.code) into lin
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = ent;
  if lin not like '43009901 0.00/121.00 · 572_____ 120.40/0.00 · 626_____ 0.60/0.00' or (x->>'comision')::numeric <> 0.60 then
    raise exception 'PRUEBA S01 REDSYS · 7: el asiento del TPV fue «%».', lin;
  end if;
  raise notice '7 · %', x->>'frase';
end $$;

-- ── 8 · Deshacer el casado de Stripe en Bancos ─────────────────────────────
do $$
declare c uuid := (select v::uuid from _p where clave = 'casado_stripe'); ent uuid; fila jsonb;
begin
  select journal_entry_id into ent from public.bank_match where id = c;
  perform public.bank_deshacer(c, 'Prueba S01');
  if exists (select 1 from public.journal_entry where id = ent and status in ('propuesto', 'borrador', 'validado')) then
    raise exception 'PRUEBA S01 REDSYS · 8: deshecho el casado, su asiento sigue vivo.';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.conta_abonos_pasarela_pendientes((select v::uuid from _p where clave = 'empresa'))) r
                  where (r->>'id')::uuid = (select v::uuid from _p where clave = 'enlace_stripe')) then
    raise exception 'PRUEBA S01 REDSYS · 8: deshecho el casado, el cobro no vuelve a esperar su abono.';
  end if;
  select r into fila from jsonb_array_elements(public.conta_cobros_abonos((select v::uuid from _p where clave = 'empresa'))) r where r->>'id' = (select v from _p where clave = 'f2');
  if fila->>'abonado' is not null then raise exception 'PRUEBA S01 REDSYS · 8: Cobros sigue diciendo «abonado»: %.', fila; end if;
  if (select estado from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f2')) <> 'cobrada' then
    raise exception 'PRUEBA S01 REDSYS · 8: deshacer el abono descobró la factura.';
  end if;
  raise notice '8 · deshacer en Bancos: el asiento se va, el cobro vuelve a esperar su abono y la factura sigue cobrada';
end $$;
reset role;

-- ── 9 · La página del E4, sin datos del proveedor ───────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare x jsonb := public.conta_enlace_pago_ver((select v from _p where clave = 'token2')); v_err text;
begin
  if x->>'estado' <> 'pagado' or x ? 'stripe' or x::text like '%acct_%' then raise exception 'PRUEBA S01 REDSYS · 9: la página enseña %.', x; end if;
  begin perform public.conta_enlace_pago_pedido((select v from _p where clave = 'token1'), 1); exception when insufficient_privilege then v_err := 'denegado'; end;
  if v_err is distinct from 'denegado' then raise exception 'PRUEBA S01 REDSYS · 9: alguien sin cuenta pide un número de pedido.'; end if;
  raise notice '9 · la página: pagado, sin datos de Stripe ni del TPV; un número de pedido sin cuenta, no';
end $$;
reset role;

-- ── 10 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261027T2031_s01_enlace_con_redsys.down.sql
do $$
declare dif text;
begin
  if exists (select 1 from public.funcion_respaldo where migracion = '20261027T2031_s01_enlace_con_redsys') then
    raise exception 'PRUEBA S01 REDSYS · 10: la vuelta atrás de la 2031 deja respaldos.';
  end if;
  select string_agg(m.fn, ', ') into dif from _md5 m join pg_proc p on p.proname = m.fn and p.pronamespace = 'public'::regnamespace where md5(p.prosrc) <> m.antes;
  if dif is not null then raise exception 'PRUEBA S01 REDSYS · 10: la vuelta atrás de la 2031 no deja igual: %.', dif; end if;
end $$;
\i supabase/vuelta-atras/20261027T2030_s01_redsys_y_abono.down.sql
do $$ begin
  if to_regclass('public.conta_cobro_redsys') is not null or to_regclass('public.conta_enlace_pago_intento') is not null or to_regclass('public.conta_redsys_aviso') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_enlace_pago' and column_name in ('proveedor', 'comision', 'neto', 'abono_match_id'))
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and (proname like '\_s01\_%' or proname like 'conta\_cobro\_redsys\_%' or proname like 'conta\_redsys\_%'
                 or proname in ('conta_enlace_pago_pedido', 'conta_enlace_pago_cobrado_redsys', 'conta_enlace_pago_comision', 'conta_abonos_pasarela_pendientes', 'conta_abono_pasarela_casar', 'conta_cobros_abonos')))
     or exists (select 1 from vault.secrets where name like 'conta\_redsys:%') then
    raise exception 'PRUEBA S01 REDSYS · 10: la vuelta atrás deja algo de la 2030.';
  end if;
  raise notice '10 · la vuelta atrás: la 2031 deja las cuatro funciones con el md5 de antes; la 2030, nada suyo (ni la clave en Vault)';
end $$;
rollback;
