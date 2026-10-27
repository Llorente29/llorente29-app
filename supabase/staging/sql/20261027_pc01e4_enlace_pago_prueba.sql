-- supabase/staging/sql/20261027_pc01e4_enlace_pago_prueba.sql
--
-- SOLO STAGING. Prueba de la 1121 del PC01 · E4 (cobrar con tarjeta y Bizum por
-- Stripe), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la
-- empresa A, con datos INVENTADOS que se siembra ella misma (un cliente y tres
-- facturas), por los CAMINOS de verdad: la cuenta de Stripe y el cobro los
-- apunta el servidor (service_role, como conta-stripe y conta-stripe-webhook),
-- la página de pago la abre alguien SIN CUENTA (anon) y «Cómo te pagan» lo lee
-- el administrador. Ninguna llamada a Stripe: eso lo probó la sonda.
--
--   1. Sin alta: «Cómo te pagan» no tiene cuenta.
--   2. La cuenta, con la tarjeta aún sin activar: no hay enlace de pago.
--   3. Con la tarjeta activa: el enlace de una factura (el mismo la segunda vez),
--      en su historial; otra cuenta de Stripe para la misma empresa, no.
--   4. La página sin cuenta: lo que enseña (tarjeta; Bizum no, aún no está
--      activo), cuenta la apertura, y un token que no existe; anon no lee los
--      datos de Stripe. La columna de Cobros: «abierta 1 vez».
--   5. El cobro: de otra cuenta de Stripe, no; el bueno apunta 121,00 € con
--      Bizum por el motor de la E1 y la factura queda cobrada; el aviso repetido
--      no hace nada.
--   6. Pagado de más (otra factura ya cobrada en parte): apunta lo que quedaba
--      y el historial dice lo que sobra.
--   7. «Cómo te pagan» con la tarjeta activa.
--   8. La vuelta atrás: sin tablas ni funciones de la 1121.
--
-- Nombra lo que toca, para el analizador: conta_cobro_stripe, conta_enlace_pago,
-- customer_invoice_payment, customer_invoice_event.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 E4 PAGO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- La 1121 solo añade: el ensayo de la rama puede haberla pasado ya de verdad (W05).
\i supabase/vuelta-atras/20261027T1121_pc01e4_enlace_pago.down.sql
do $$ begin
  if to_regclass('public.conta_enlace_pago') is not null or to_regclass('public.conta_cobro_stripe') is not null then
    raise exception 'PRUEBA PC01 E4 PAGO · 0: la vuelta atrás no deja staging sin la 1121.';
  end if;
end $$;
\i supabase/migrations/20261027T1121_pc01e4_enlace_pago.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');

-- ── Siembra (como el dueño): un cliente y tres facturas de 121,00 € ────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        tra uuid := (select id from public.payment_method where code = 'transferencia' and account_id is null limit 1);
        s uuid; f uuid; i int;
begin
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente E4 Pago', 'B00000451') returning id into s;
  insert into _p values ('cliente', s);
  for i in 1..3 loop
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                         party_id, customer, payment_method_id, email_to, base, tax, total)
    values (a, e, 'emitida', 'a_mano', 'E4P', 2026, i, 'E4P-' || i, public.conta_hoy() - 5, public.conta_hoy() + 10, s,
            jsonb_build_object('nombre', 'Cliente E4 Pago'), tra, 'pagos@cliente-e4.example', 100.00, 21.00, 121.00)
    returning id into f;
    insert into _p values ('f' || i, f);
  end loop;
  -- La 3, cobrada en parte (100,00 €) antes del enlace.
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note)
  values (a, e, (select v::uuid from _p where clave = 'f3'), public.conta_hoy() - 1, 100.00, 'transferencia', 'prueba E4 pago');
end $$;

-- ── 1 · Sin alta ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if public.conta_cobro_stripe_leer((select v::uuid from _p where clave = 'empresa')) is not null then
    raise exception 'PRUEBA PC01 E4 PAGO · 1: sin alta, «Cómo te pagan» ya tiene cuenta.';
  end if;
  raise notice '1 · sin alta: «Cómo te pagan» no tiene cuenta';
end $$;
reset role;

-- ── 2 y 3 · La cuenta y el enlace (como el servidor) ───────────────────────
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb; t1 text; t2 text; v_err text;
begin
  x := public.conta_cobro_stripe_apuntar(e, 'acct_prueba_e4', 'falta_alta', 'falta_alta', false, 19, 'Prueba');
  if x->>'tarjeta' <> 'falta_alta' or (x->>'pendiente')::int <> 19 or x->>'modo' <> 'prueba' then raise exception 'PRUEBA PC01 E4 PAGO · 2: apuntar dio %.', x; end if;
  if public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f1')) is not null then
    raise exception 'PRUEBA PC01 E4 PAGO · 2: con la tarjeta sin activar ya hay enlace de pago.';
  end if;
  raise notice '2 · la cuenta, con la tarjeta sin activar: sin enlace de pago';

  x := public.conta_cobro_stripe_apuntar(e, 'acct_prueba_e4', 'activo', 'revisando', false, 0, 'Stripe');
  t1 := public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f1'));
  t2 := public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f1'));
  if t1 is null or t1 !~ '^[0-9a-f]{64}$' or t1 is distinct from t2 then raise exception 'PRUEBA PC01 E4 PAGO · 3: el enlace es % y luego %.', t1, t2; end if;
  insert into _p values ('token1', t1);
  insert into _p values ('token3', public.conta_enlace_pago_para((select v::uuid from _p where clave = 'f3')));
  if (select count(*) from public.customer_invoice_event where invoice_id = (select v::uuid from _p where clave = 'f1') and kind = 'enlace_pago') <> 1 then
    raise exception 'PRUEBA PC01 E4 PAGO · 3: el historial de la factura no dice el enlace (una vez).';
  end if;
  begin perform public.conta_cobro_stripe_apuntar(e, 'acct_otra_e4', 'activo', 'activo', true, 0, 'Prueba'); exception when unique_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'Esta empresa ya tiene otra cuenta de Stripe.' then raise exception 'PRUEBA PC01 E4 PAGO · 3: otra cuenta dijo «%».', v_err; end if;
  raise notice '3 · con la tarjeta activa: el enlace (el mismo la segunda vez), en el historial; otra cuenta para la misma empresa, no';
end $$;
reset role;

-- ── 4 · La página, sin cuenta (anon) ────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare x jsonb := public.conta_enlace_pago_ver((select v from _p where clave = 'token1')); v_err text;
begin
  if x->>'estado' <> 'abierto' or x->'metodos' <> '["tarjeta"]'::jsonb or (x->>'pendiente')::numeric <> 121 or x->>'factura' <> 'E4P-1' or x ? 'stripe' then
    raise exception 'PRUEBA PC01 E4 PAGO · 4: la página enseña %.', x;
  end if;
  if public.conta_enlace_pago_ver(repeat('0', 64))->>'estado' <> 'no_existe' or public.conta_enlace_pago_ver('no es un token')->>'estado' <> 'no_existe' then
    raise exception 'PRUEBA PC01 E4 PAGO · 4: un token que no existe no lo dice.';
  end if;
  begin perform public.conta_enlace_pago_datos((select v from _p where clave = 'token1')); exception when insufficient_privilege then v_err := 'denegado'; end;
  if v_err is distinct from 'denegado' then raise exception 'PRUEBA PC01 E4 PAGO · 4: alguien sin cuenta lee los datos de Stripe.'; end if;
  raise notice '4 · la página sin cuenta: la factura, lo pendiente y «tarjeta» (Bizum aún no); un token malo no existe; los datos de Stripe, no';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_enlaces_pago_resumen((select v::uuid from _p where clave = 'empresa'));
begin
  if not exists (select 1 from jsonb_array_elements(x) r where r->>'id' = (select v from _p where clave = 'f1') and (r->>'aperturas')::int = 1) then
    raise exception 'PRUEBA PC01 E4 PAGO · 4: la columna de Cobros dice %.', x;
  end if;
  raise notice '4 · la columna de Cobros: «con enlace · abierta 1 vez»';
end $$;
reset role;

-- ── 5 y 6 · El cobro, por el aviso de Stripe (como el servidor) ────────────
set local role service_role;
do $$
declare x jsonb; d jsonb;
begin
  d := public.conta_enlace_pago_datos((select v from _p where clave = 'token1'));
  if d->>'stripe' <> 'acct_prueba_e4' or (d->>'pendiente')::numeric <> 121 or d->>'modo' <> 'prueba' then raise exception 'PRUEBA PC01 E4 PAGO · 5: los datos son %.', d; end if;
  perform public.conta_enlace_pago_sesion((select v from _p where clave = 'token1'), 'cs_prueba_e4_1');
  x := public.conta_enlace_pago_cobrado('cs_prueba_e4_1', 'acct_otra_e4', 'pi_x', 121, 'bizum', null);
  if x->>'motivo' <> 'otra_cuenta' then raise exception 'PRUEBA PC01 E4 PAGO · 5: de otra cuenta dio %.', x; end if;
  x := public.conta_enlace_pago_cobrado('cs_prueba_e4_1', 'acct_prueba_e4', 'pi_prueba_e4_1', 121, 'bizum', null);
  if (x->>'hecho')::boolean is not true or (x->>'apuntado')::numeric <> 121 then raise exception 'PRUEBA PC01 E4 PAGO · 5: el cobro dio %.', x; end if;
  if (select estado from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f1')) <> 'cobrada'
     or not exists (select 1 from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f1') and method = 'bizum' and amount = 121) then
    raise exception 'PRUEBA PC01 E4 PAGO · 5: la factura no queda cobrada con Bizum.';
  end if;
  x := public.conta_enlace_pago_cobrado('cs_prueba_e4_1', 'acct_prueba_e4', 'pi_prueba_e4_1', 121, 'bizum', null);
  if x->>'motivo' <> 'ya_cobrado' or (select count(*) from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f1')) <> 1 then
    raise exception 'PRUEBA PC01 E4 PAGO · 5: el aviso repetido dio % (o apuntó otra vez).', x;
  end if;
  raise notice '5 · el cobro: de otra cuenta no; el bueno, 121,00 € con Bizum y cobrada; repetido, nada';

  perform public.conta_enlace_pago_sesion((select v from _p where clave = 'token3'), 'cs_prueba_e4_3');
  x := public.conta_enlace_pago_cobrado('cs_prueba_e4_3', 'acct_prueba_e4', 'pi_prueba_e4_3', 121, 'tarjeta', null);
  if (x->>'apuntado')::numeric <> 21 or (x->>'sobra')::numeric <> 100 then raise exception 'PRUEBA PC01 E4 PAGO · 6: pagado de más dio %.', x; end if;
  if not exists (select 1 from public.customer_invoice_event where invoice_id = (select v::uuid from _p where clave = 'f3') and kind = 'cobro' and text like '%hay que devolverlo.') then
    raise exception 'PRUEBA PC01 E4 PAGO · 6: el historial no dice lo que sobra.';
  end if;
  raise notice '6 · pagado de más: apunta lo que quedaba (21,00 €) y el historial dice que sobran 100,00 €';
end $$;
reset role;

-- ── 7 · «Cómo te pagan» con la tarjeta activa ──────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_cobro_stripe_leer((select v::uuid from _p where clave = 'empresa'));
begin
  if x->>'tarjeta' <> 'activo' or x->>'bizum' <> 'revisando' or x ? 'stripe_account_id' then raise exception 'PRUEBA PC01 E4 PAGO · 7: «Cómo te pagan» lee %.', x; end if;
  raise notice '7 · «Cómo te pagan»: tarjeta activa, Bizum en revisión (y sin el identificador de Stripe)';
end $$;
reset role;

-- ── 8 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261027T1121_pc01e4_enlace_pago.down.sql
do $$ begin
  if to_regclass('public.conta_enlace_pago') is not null or to_regclass('public.conta_cobro_stripe') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and (proname like 'conta\_cobro\_stripe\_%' or proname like 'conta\_enlace\_pago\_%' or proname = 'conta_enlaces_pago_resumen')) then
    raise exception 'PRUEBA PC01 E4 PAGO · 8: la vuelta atrás deja algo de la 1121.';
  end if;
  raise notice '8 · la vuelta atrás: sin tablas ni funciones de la 1121';
end $$;
rollback;
