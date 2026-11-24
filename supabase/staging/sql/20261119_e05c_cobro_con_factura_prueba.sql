-- supabase/staging/sql/20261119_e05c_cobro_con_factura_prueba.sql
--
-- SOLO STAGING. E05c · El cobro con su factura emitida, por sus CAMINOS (regla 10),
-- en una transacción que acaba en ROLLBACK: staging no cambia. No hay tanda: la base
-- ya lo hace (bank_casar con el destino «factura_emitida», el disparador
-- _pc01_casado_item escribe el cobro y _pc01_casado_deshecho lo quita). Esto lo
-- prueba con la sesión de la persona de la cuenta del núcleo, con lo que monta la
-- semilla E05c (e2e_e05c_preparar), que va delante en el manifiesto:
--   1. la factura empieza pendiente (conta_factura_cobro: por cobrar, 242,00);
--   2. casar el cobro con ella (el destino que arma la pantalla, el del motor): la
--      factura queda cobrada, con su cobro (customer_invoice_payment) y su asiento
--      (la 572 al debe y la 430 al haber); el cliente debe 121,00 en el libro;
--   3. deshacerlo: el cobro se va, la factura vuelve a pendiente, queda el evento
--      «cobro deshecho» y el cliente vuelve a deber 363,00;
--   4. volver a casarlo: cobrada otra vez, con un solo cobro vivo;
--   5. lo que no deja: cobrar otra vez la misma factura con otro ingreso (se pasaría).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E05c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _p (k text primary key, v text) on commit drop;
grant all on _p to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _p where _p.k = $1 $$;
-- El estado y lo que queda de la factura, como lo enseña Cobros (conta_factura_cobro).
create function pg_temp.estado(f uuid) returns text language sql as $$ select estado || ' ' || pendiente from public.conta_factura_cobro where invoice_id = f $$;
-- Lo que debe el cliente en el libro (la 430), con la vara de Bancos (bank_saldos_cuentas).
create function pg_temp.debe(e uuid, c text) returns numeric language sql as $$ select coalesce((select saldo from public.bank_saldos_cuentas(e, date '2026-12-31', array['430']) where cuenta = c), 0) $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c0e20000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.e2e_e05c_preparar('prueba', '2026-11-12.1');
  insert into _p values ('e', r->>'empresa'), ('c', r->>'cuentaCliente'), ('f', r->'facturas'->'cobro'->>'id'), ('mov', r->>'cobro'), ('banco', r->>'cuenta572'),
    ('destino', jsonb_build_object('tipo', 'factura_emitida', 'tercero_id', null, 'concepto', 'Cobro de Cliente de Prueba Bancos prueba',
      'lineas', jsonb_build_array(jsonb_build_object('cuenta', r->>'cuentaCliente', 'importe', 242)),
      'facturas', jsonb_build_array(jsonb_build_object('id', r->'facturas'->'cobro'->>'id', 'importe', 242)))::text);
end $$;

-- 1 · Pendiente al empezar.
do $$ begin
  if pg_temp.estado(pg_temp.p('f')::uuid) <> 'por_cobrar 242.00' then raise exception 'PRUEBA E05c · 1: la factura empieza %.', pg_temp.estado(pg_temp.p('f')::uuid); end if;
  if pg_temp.debe(pg_temp.p('e')::uuid, pg_temp.p('c')) <> 363 then raise exception 'PRUEBA E05c · 1: el cliente debe %.', pg_temp.debe(pg_temp.p('e')::uuid, pg_temp.p('c')); end if;
  raise notice '1 OK: la factura, por cobrar 242,00; el cliente debe 363,00 en el libro.';
end $$;

-- 2 · Casar el cobro con su factura.
do $$
declare r jsonb; l text;
begin
  r := public.bank_casar(pg_temp.p('mov')::uuid, pg_temp.p('destino')::jsonb, 'probable', 'Lo dijiste tú: cobra la factura.', '[]'::jsonb, 'persona', null);
  insert into _p values ('match1', r->>'match');
  if pg_temp.estado(pg_temp.p('f')::uuid) <> 'cobrada 0.00' then raise exception 'PRUEBA E05c · 2: la factura queda %.', pg_temp.estado(pg_temp.p('f')::uuid); end if;
  if (select count(*) || ' ' || sum(amount) from public.customer_invoice_payment where invoice_id = pg_temp.p('f')::uuid) <> '1 242.00' then
    raise exception 'PRUEBA E05c · 2: el cobro no está escrito una vez por 242,00.';
  end if;
  select string_agg(case a.code when pg_temp.p('banco') then 'banco' when pg_temp.p('c') then 'cliente' else a.code end || ' ' || jl.debit || '/' || jl.credit, ', ' order by jl.debit desc)
    into l from public.journal_line jl join public.company_account a on a.id = jl.company_account_id where jl.entry_id = (r->>'asiento')::uuid;
  if l <> 'banco 242.00/0.00, cliente 0.00/242.00' then raise exception 'PRUEBA E05c · 2: el asiento es %.', l; end if;
  if pg_temp.debe(pg_temp.p('e')::uuid, pg_temp.p('c')) <> 121 then raise exception 'PRUEBA E05c · 2: el cliente debe %.', pg_temp.debe(pg_temp.p('e')::uuid, pg_temp.p('c')); end if;
  raise notice '2 OK: casado: la factura, cobrada; su cobro, 242,00; el asiento, %; el cliente debe 121,00.', l;
end $$;

-- 3 · Deshacerlo.
do $$
declare r jsonb;
begin
  r := public.bank_deshacer(pg_temp.p('match1')::uuid, 'Prueba E05c: deshacer');
  if pg_temp.estado(pg_temp.p('f')::uuid) <> 'por_cobrar 242.00' then raise exception 'PRUEBA E05c · 3: deshecho, la factura queda %.', pg_temp.estado(pg_temp.p('f')::uuid); end if;
  if exists (select 1 from public.customer_invoice_payment where invoice_id = pg_temp.p('f')::uuid) then raise exception 'PRUEBA E05c · 3: el cobro sigue.'; end if;
  if not exists (select 1 from public.customer_invoice_event where invoice_id = pg_temp.p('f')::uuid and kind = 'cobro_deshecho') then raise exception 'PRUEBA E05c · 3: no queda el evento.'; end if;
  if pg_temp.debe(pg_temp.p('e')::uuid, pg_temp.p('c')) <> 363 then raise exception 'PRUEBA E05c · 3: el cliente debe %.', pg_temp.debe(pg_temp.p('e')::uuid, pg_temp.p('c')); end if;
  if (select status from public.bank_movement where id = pg_temp.p('mov')::uuid) <> 'pendiente' then raise exception 'PRUEBA E05c · 3: el movimiento no vuelve a pendiente.'; end if;
  raise notice '3 OK: deshecho (%): la factura, otra vez por cobrar 242,00, sin cobro y con su evento; el cliente debe 363,00.', r->>'asiento';
end $$;

-- 4 · Volver a casarlo.
do $$
declare r jsonb;
begin
  r := public.bank_casar(pg_temp.p('mov')::uuid, pg_temp.p('destino')::jsonb, 'probable', 'Lo dijiste tú: cobra la factura.', '[]'::jsonb, 'persona', null);
  if pg_temp.estado(pg_temp.p('f')::uuid) <> 'cobrada 0.00' then raise exception 'PRUEBA E05c · 4: la factura queda %.', pg_temp.estado(pg_temp.p('f')::uuid); end if;
  if (select count(*) from public.customer_invoice_payment where invoice_id = pg_temp.p('f')::uuid) <> 1 then raise exception 'PRUEBA E05c · 4: no hay un solo cobro.'; end if;
  if (select count(*) from public.bank_match where movement_id = pg_temp.p('mov')::uuid and status = 'vivo') <> 1 then raise exception 'PRUEBA E05c · 4: no hay un solo casado vivo.'; end if;
  raise notice '4 OK: casado otra vez: cobrada, con un solo cobro y un solo casado vivo.';
end $$;

-- 5 · Lo que no deja: cobrar otra vez la misma factura con otro ingreso (se pasaría).
-- El ingreso lo crea la propietaria (como lo trae un extracto); lo casa la persona.
reset role;
do $$
declare m uuid;
begin
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept, fingerprint, soft_fingerprint, status, reason)
  select account_id, company_id, treasury_account_id, statement_id, date '2026-10-19', date '2026-10-19', 242.00, 'OTRO COBRO', 'Otro cobro', 'e05c-prueba-otro', 'e05c-prueba-otro', 'por_aclarar', 'Prueba.'
    from public.bank_movement where id = pg_temp.p('mov')::uuid returning id into m;
  insert into _p values ('otro', m);
end $$;
set local role authenticated;
do $$
declare v_msg text;
begin
  begin
    perform public.bank_casar(pg_temp.p('otro')::uuid, pg_temp.p('destino')::jsonb, 'probable', 'Prueba.', '[]'::jsonb, 'persona', null);
    raise exception 'PRUEBA E05c · 5: ha dejado cobrar dos veces la misma factura.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg not like 'La factura % ya tiene cobrados 242,00 € de 242,00 €: este cobro la pasaría.' then raise exception 'PRUEBA E05c · 5: dice «%».', v_msg; end if;
  raise notice '5 OK: cobrarla otra vez no se deja: «%».', v_msg;
end $$;

reset role;
do $$ begin raise notice 'PRUEBA E05c: 5 de 5 bien.'; end $$;
rollback;
