-- supabase/staging/sql/20261028_s01_enlace_validado_prueba.sql
--
-- SOLO STAGING. Prueba de la 0735 del S01 · PR 3 (el cobro por el enlace nace
-- validado), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- En la empresa A, con datos INVENTADOS que se siembra ella misma (un cliente,
-- su 430 y tres facturas de 121,00 €), por los CAMINOS de verdad: el TPV y los
-- cobros los apunta el servidor (service_role, como conta-redsys-aviso y
-- conta-stripe-webhook), y la devolución la hace el administrador (anular el
-- asiento con su contraasiento, como en Contabilidad › Asientos).
--
--   0. Si el ensayo ya pasó la 0735 en esta transacción, no se vuelve a pasar;
--      lo de antes de las dos funciones es la huella de su respaldo.
--   1. Cobro con Redsys: su asiento nace VALIDADO (con número y huella), «TPV
--      del banco · por abonar» 121,00 al debe contra la 430 del cliente.
--   2. Cobro con Stripe: lo mismo, contra «Stripe · por abonar».
--   3. Validar a mano sigue igual: el administrador valida un asiento
--      propuesto; alguien sin cuenta, no (el mismo mensaje de siempre).
--   4. La devolución: el administrador anula el asiento del cobro de Redsys.
--      El contraasiento (validado) le da la vuelta, el cobro sale de la factura
--      (vuelve a deber 121,00), y la pasarela y la 430 quedan como antes.
--   5. Si no se puede validar (un motivo de conta_motivos_para_validar,
--      inventado en un savepoint), el cobro se apunta igual, el asiento se queda
--      propuesto y el historial de la factura dice por qué.
--   6. La vuelta atrás: las dos funciones con la huella de antes, sin respaldo,
--      y sin _journal_entry_validar.
--
-- Nombra lo que toca, para el analizador: journal_entry_validar,
-- _journal_entry_validar, _s01_asiento_cobro, journal_entry, journal_line,
-- customer_invoice_payment, customer_invoice_event, conta_enlace_pago,
-- conta_cobro_redsys, conta_pasarela_cuenta, conta_motivos_para_validar.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 VALIDADO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
-- Los cerrojos, de golpe y en el mismo orden que la prueba del PR 1 (sin chocar con una e2e que clona su carril).
set local lock_timeout = '120s';
lock table public.accounts, public.company, public.company_account, public.bank_match in share row exclusive mode;
lock table public.conta_enlace_pago, public.treasury_account, public.journal_entry in access exclusive mode;

-- ── 0 · La 0735, una vez ─────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261028T0735_s01_enlace_validado') as ya_esta_la_0735 \gset
\if :ya_esta_la_0735
\else
\i supabase/migrations/20261028T0735_s01_enlace_validado.sql
\endif
create temp table _md5 (firma text primary key, antes text) on commit drop;
insert into _md5 select firma, huella from public.funcion_respaldo where migracion = '20261028T0735_s01_enlace_validado';
do $$ begin
  if (select count(*) from _md5) <> 2 or to_regprocedure('public._journal_entry_validar(uuid,text)') is null then
    raise exception 'PRUEBA S01 VALIDADO · 0: la 0735 no dejó sus dos respaldos o _journal_entry_validar.';
  end if;
end $$;

-- Las líneas de un asiento, en una frase («43009902 0.00/121.00 · …», por código).
create or replace function pg_temp.lineas(p uuid) returns text language sql as $$
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by ca.code)
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = p
$$;
-- El saldo de una cuenta en los asientos vivos (propuestos, borradores y validados).
create or replace function pg_temp.saldo(p_company uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(coalesce(jl.debit, 0) - coalesce(jl.credit, 0)), 0)::numeric(14,2)
    from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id join public.company_account ca on ca.id = jl.company_account_id
   where ca.company_id = p_company and ca.code = p_code and je.status in ('propuesto', 'borrador', 'validado')
$$;

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('clave', 'sq7HjrUOBfKmC576ILgskD5srU870gJ7');

-- ── Siembra (como el dueño): un cliente, su 430 y tres facturas de 121,00 € ──
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        tra uuid := (select id from public.payment_method where code = 'transferencia' and account_id is null limit 1);
        s uuid; f uuid; i int;
begin
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente S01 Validado', 'B00000562') returning id into s;
  insert into _p values ('cliente', s);
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select a, e, ca.plan, '43009902', ca.template_code, 'Clientes · S01 validado', ca.kind, ca.source from public.company_account ca where ca.company_id = e and ca.code = '43000001';
  if not found then raise exception 'PRUEBA S01 VALIDADO · siembra: la empresa A no tiene la 43000001 de molde.'; end if;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, e, ca.id, 'customer', s::text, 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '43009902';
  for i in 1..3 loop
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                         party_id, customer, payment_method_id, email_to, base, tax, total)
    values (a, e, 'emitida', 'a_mano', 'S01V', 2026, i, 'S01V-' || i, public.conta_hoy() - 5, public.conta_hoy() + 10, s,
            jsonb_build_object('nombre', 'Cliente S01 Validado'), tra, 'pagos@cliente-s01v.example', 100.00, 21.00, 121.00)
    returning id into f;
    insert into _p values ('f' || i, f);
  end loop;
end $$;

-- ── 1 · Cobro con Redsys (como el servidor): el asiento nace validado ───────
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); t text; ped text; x jsonb; ent uuid; pas text; je public.journal_entry;
begin
  perform public.conta_cobro_redsys_guardar(e, '999008881', '1', (select v from _p where clave = 'clave'), false, true, 'prueba', true, 'Prueba');
  t := public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f1'));
  if t is null then raise exception 'PRUEBA S01 VALIDADO · 1: con Redsys abierto no hay enlace.'; end if;
  ped := public.conta_enlace_pago_pedido(t, 121);
  x := public.conta_enlace_pago_cobrado_redsys(ped, '999008881', 121, 'tarjeta', '123456');
  if (x->>'hecho')::boolean is not true then raise exception 'PRUEBA S01 VALIDADO · 1: el cobro dio %.', x; end if;
  select entry_id into ent from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f1');
  select * into je from public.journal_entry where id = ent;
  select code into pas from public.conta_pasarela_cuenta where company_id = e and proveedor = 'redsys';
  if je.status <> 'validado' or je.number is null or je.hash is null or je.hash = 'pendiente' or je.source_type <> 'customer_payment'
     or je.validated_by_name <> 'Sumied (cobro confirmado por el banco)' then
    raise exception 'PRUEBA S01 VALIDADO · 1: el asiento del cobro con Redsys está % (nº %, por «%»).', je.status, je.number, je.validated_by_name;
  end if;
  if pg_temp.lineas(ent) <> format('43009902 0.00/121.00 · %s 121.00/0.00', pas) then
    raise exception 'PRUEBA S01 VALIDADO · 1: el asiento fue «%».', pg_temp.lineas(ent);
  end if;
  insert into _p values ('ent_redsys', ent), ('pas_tpv', pas), ('tpv_antes', (pg_temp.saldo(e, pas) - 121)::text);
  raise notice '1 · Redsys: el asiento del cobro nace validado (nº % de su serie), %', je.number, pg_temp.lineas(ent);
end $$;

-- ── 2 · Cobro con Stripe (TPV fuera del enlace): también validado ───────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); t text; x jsonb; je public.journal_entry;
begin
  perform public.conta_cobro_stripe_apuntar(e, 'acct_prueba_s01v', 'activo', 'activo', true, 0, 'Prueba');
  perform public.conta_cobro_redsys_guardar(e, '999008881', '1', null, false, false, 'prueba', true, 'Prueba');
  t := public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f2'));
  if public.conta_enlace_pago_datos(t)->>'proveedor' <> 'stripe' then raise exception 'PRUEBA S01 VALIDADO · 2: fuera del enlace, no cobra Stripe.'; end if;
  perform public.conta_enlace_pago_sesion(t, 'cs_prueba_s01v_2');
  x := public.conta_enlace_pago_cobrado('cs_prueba_s01v_2', 'acct_prueba_s01v', 'pi_prueba_s01v_2', 121, 'tarjeta', null);
  if (x->>'hecho')::boolean is not true or x->>'asiento' is null then raise exception 'PRUEBA S01 VALIDADO · 2: el cobro de Stripe dio %.', x; end if;
  select * into je from public.journal_entry where id = (x->>'asiento')::uuid;
  if je.status <> 'validado' or je.number is null or je.validated_by_name <> 'Sumied (cobro confirmado por Stripe)' then
    raise exception 'PRUEBA S01 VALIDADO · 2: el asiento del cobro con Stripe está % (por «%»).', je.status, je.validated_by_name;
  end if;
  insert into _p values ('pas_stripe', (select code from public.conta_pasarela_cuenta where company_id = e and proveedor = 'stripe'));
  raise notice '2 · Stripe: el asiento del cobro nace validado (nº %), %', je.number, pg_temp.lineas(je.id);
end $$;
reset role;

-- ── 3 · Validar a mano, igual que antes ─────────────────────────────────────
-- Un asiento propuesto (el administrador propone y valida); sin cuenta, no.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; val jsonb;
begin
  r := public.journal_entry_proponer(e,
    jsonb_build_object('fecha', public.conta_hoy(), 'series', 4, 'concepto', 'Prueba S01 validar a mano', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba.'),
    jsonb_build_array(jsonb_build_object('cuenta', '43009902', 'debe', 10, 'haber', 0, 'comun', true, 'tercero_id', (select v from _p where clave = 'cliente')),
                      jsonb_build_object('cuenta', (select v from _p where clave = 'pas_stripe'), 'debe', 0, 'haber', 10, 'comun', true)),
    null, 'Prueba');
  insert into _p values ('ent_mano', r->>'id');
  val := public.journal_entry_validar((r->>'id')::uuid, 'Prueba');
  if (select status from public.journal_entry where id = (r->>'id')::uuid) <> 'validado' or (val->>'numero') is null then
    raise exception 'PRUEBA S01 VALIDADO · 3: validar a mano dio %.', val;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.journal_entry_validar((select v::uuid from _p where clave = 'ent_mano'), 'Nadie'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Solo un administrador o un encargado de la cuenta valida asientos.' and v_err not like 'permission denied%' then
    raise exception 'PRUEBA S01 VALIDADO · 3: sin cuenta, validar dijo «%».', coalesce(v_err, 'nada');
  end if;
  raise notice '3 · validar a mano: el administrador, sí; sin cuenta, no («%»)', v_err;
end $$;
reset role;

-- ── 4 · La devolución: anular el asiento del cobro le da la vuelta ──────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare ent uuid := (select v::uuid from _p where clave = 'ent_redsys'); r jsonb;
begin
  r := public.journal_entry_anular(ent, 'El cliente devolvió el pago con tarjeta', null, 'Prueba');
  insert into _p values ('contra', r->>'contraasiento');
end $$;
reset role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); ent uuid := (select v::uuid from _p where clave = 'ent_redsys');
        c uuid := (select v::uuid from _p where clave = 'contra'); pas text := (select v from _p where clave = 'pas_tpv');
begin
  if (select status from public.journal_entry where id = ent) <> 'anulado'
     or (select status || ' ' || source_type from public.journal_entry where id = c) <> 'validado reversal' then
    raise exception 'PRUEBA S01 VALIDADO · 4: el asiento quedó % y el contraasiento %.',
      (select status from public.journal_entry where id = ent), (select status || ' ' || source_type from public.journal_entry where id = c);
  end if;
  if pg_temp.lineas(c) <> format('43009902 121.00/0.00 · %s 0.00/121.00', pas) then
    raise exception 'PRUEBA S01 VALIDADO · 4: el contraasiento fue «%».', pg_temp.lineas(c);
  end if;
  if exists (select 1 from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f1'))
     or (select pendiente from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f1')) <> 121 then
    raise exception 'PRUEBA S01 VALIDADO · 4: después de la devolución la factura no vuelve a deber 121,00.';
  end if;
  if pg_temp.saldo(e, pas) <> (select v::numeric from _p where clave = 'tpv_antes') then
    raise exception 'PRUEBA S01 VALIDADO · 4: «TPV del banco · por abonar» quedó en % (antes del cobro, %).', pg_temp.saldo(e, pas), (select v from _p where clave = 'tpv_antes');
  end if;
  raise notice '4 · la devolución: el contraasiento validado le da la vuelta (%), la factura vuelve a deber 121,00 y la pasarela, como antes', pg_temp.lineas(c);
end $$;

-- ── 5 · Si no se puede validar: propuesto, y la factura lo dice ─────────────
savepoint sin_validar;
create or replace function public.conta_motivos_para_validar(p_entry uuid)
returns table(orden integer, codigo text, motivo text) language plpgsql stable set search_path to 'public' as $f$
begin
  orden := 7; codigo := 'mes_cerrado'; motivo := 'El mes de prueba está cerrado.'; return next;
end $f$;
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); t text; ped text; x jsonb; ent uuid;
begin
  perform public.conta_cobro_redsys_guardar(e, '999008881', '1', null, false, true, 'prueba', true, 'Prueba');
  t := public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f3'));
  ped := public.conta_enlace_pago_pedido(t, 121);
  x := public.conta_enlace_pago_cobrado_redsys(ped, '999008881', 121, 'tarjeta', '654321');
  if (x->>'hecho')::boolean is not true then raise exception 'PRUEBA S01 VALIDADO · 5: sin poder validar, el cobro no se apuntó: %.', x; end if;
  select entry_id into ent from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f3');
  if ent is null or (select status from public.journal_entry where id = ent) <> 'propuesto' then
    raise exception 'PRUEBA S01 VALIDADO · 5: el asiento quedó %.', (select status from public.journal_entry where id = ent);
  end if;
  if not exists (select 1 from public.customer_invoice_event where invoice_id = (select v::uuid from _p where clave = 'f3')
                  and kind = 'asiento_sin_validar' and text like 'El asiento del cobro de 121,00 € se queda propuesto, sin validar: El mes de prueba está cerrado.%') then
    raise exception 'PRUEBA S01 VALIDADO · 5: la factura no dice por qué no se validó.';
  end if;
  raise notice '5 · sin poder validar: el cobro se apunta, el asiento se queda propuesto y la factura dice por qué';
end $$;
reset role;
rollback to savepoint sin_validar;
release savepoint sin_validar;

-- ── 6 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T0735_s01_enlace_validado.down.sql
do $$
declare dif text;
begin
  if exists (select 1 from public.funcion_respaldo where migracion = '20261028T0735_s01_enlace_validado') then
    raise exception 'PRUEBA S01 VALIDADO · 6: la vuelta atrás deja respaldos.';
  end if;
  select string_agg(m.firma, ', ') into dif from _md5 m where md5(pg_get_functiondef(to_regprocedure(m.firma))) <> m.antes;
  if dif is not null then raise exception 'PRUEBA S01 VALIDADO · 6: la vuelta atrás no deja igual: %.', dif; end if;
  if to_regprocedure('public._journal_entry_validar(uuid,text)') is not null then
    raise exception 'PRUEBA S01 VALIDADO · 6: la vuelta atrás deja _journal_entry_validar.';
  end if;
  raise notice '6 · la vuelta atrás: las dos funciones con la huella de antes y sin _journal_entry_validar';
end $$;
rollback;
