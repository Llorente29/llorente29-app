-- supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
--
-- SOLO STAGING. R08 · Bancos: conciliar en un paso, por sus CAMINOS (regla 10), en una
-- transacción que acaba en ROLLBACK: staging no cambia. Con la sesión de la persona de la
-- cuenta del núcleo y lo que monta la semilla R08 (e2e_r08_preparar, delante en el manifiesto):
--   1945 · el saldo del banco es el cierre del último extracto de la cadena (tres el 19/11: el
--          último que llegó) y el de Sumied cuenta solo lo que está en el diario;
--   2040 · conciliar a una cuenta deja el asiento VALIDADO; cinco a la vez, cinco validados;
--          casar con una factura recibida, validado y la factura pagada; lo que concilia Sumied
--          solo, validado; deshacer cada uno (un contraasiento) y volver a conciliarlo; un
--          asiento que ya salió a ERP10 no se deshace y lo dice;
--   2120 · el recibo que el banco no cobró se aparta solo (por la cadena); conciliarlo apartado
--          lo dice en palabras; volver a abrirlo y conciliarlo;
--   y las vueltas atrás de las tres.
-- Después de cada paso: el estado del asiento, el del movimiento, el de la factura y el saldo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R08: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/migrations/20261119T1945_r08_saldo_del_banco.sql
\i supabase/migrations/20261119T2040_r08_conciliar_valida.sql
\i supabase/migrations/20261119T2120_r08_cargo_no_cobrado.sql

create temp table _p (k text primary key, v text) on commit drop;
grant all on _p to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _p where _p.k = $1 $$;
-- El estado del asiento del casado vivo de un movimiento, y el del movimiento.
create function pg_temp.asiento(m uuid) returns text language sql as $$
  select coalesce((select e.status from public.bank_match b join public.journal_entry e on e.id = b.journal_entry_id where b.movement_id = m and b.status = 'vivo'), 'sin asiento') $$;
create function pg_temp.mov(m uuid) returns text language sql as $$ select status from public.bank_movement where id = m $$;
create function pg_temp.saldo() returns numeric language sql as $$ select public.bank_saldo_diario(pg_temp.p('e')::uuid, date '2026-12-31', pg_temp.p('c572')) $$;
create function pg_temp.cuenta(m uuid, c text, imp numeric) returns jsonb language sql as $$
  select jsonb_build_object('tipo', 'cuenta', 'concepto', 'Prueba R08', 'lineas', jsonb_build_array(jsonb_build_object('cuenta', c, 'importe', imp))) $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', 'c0e20000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; f jsonb;
begin
  r := public.e2e_r08_preparar('r08p', '2026-11-12.1');
  insert into _p values ('e', r->>'empresa'), ('banco', r->>'banco'), ('c572', r->>'cuenta572'), ('nov', (r->'noviembre')::text), ('nominas', (r->'nominas')::text);
  f := public.e2e_e05b_preparar('r08f', '2026-11-12.1');
  insert into _p values ('fact', f->'facturas'->'hoy'->>'id'), ('pago', f->'pagos'->>'hoy'), ('prov', f->>'proveedor'), ('c400', f->>'cuentaProveedor');
end $$;
create function pg_temp.n(caso text) returns uuid language sql as $$ select (pg_temp.p('nov')::jsonb->>caso)::uuid $$;
grant execute on all functions in schema pg_temp to authenticated;

-- 1 · El saldo del banco: el del último de los tres extractos del 19/11.
do $$
declare x record;
begin
  select * into x from public.bank_saldo_extracto(pg_temp.p('banco')::uuid, date '2026-11-30');
  if x.saldo <> 1094.39 then raise exception 'PRUEBA R08 · 1: el saldo del banco sale % y es 1.094,39 (el último que llegó).', x.saldo; end if;
  raise notice '1 OK: el saldo del banco, el del último extracto del 19/11 (llegó a las %): %.', to_char(x.llego at time zone 'Europe/Madrid', 'HH24:MI'), x.saldo;
end $$;

-- 2 · Conciliar a una cuenta: el asiento, validado.
do $$
declare s0 numeric := pg_temp.saldo(); m uuid := pg_temp.n('gasto1');
begin
  perform public.bank_casar(m, pg_temp.cuenta(m, '62800000', 18.87), 'probable', 'Lo dijiste tú: papelería.', '[]'::jsonb, 'persona', null);
  if pg_temp.asiento(m) <> 'validado' or pg_temp.mov(m) <> 'casado' then raise exception 'PRUEBA R08 · 2: asiento %, movimiento %.', pg_temp.asiento(m), pg_temp.mov(m); end if;
  if pg_temp.saldo() <> s0 - 18.87 then raise exception 'PRUEBA R08 · 2: el saldo pasa de % a %.', s0, pg_temp.saldo(); end if;
  raise notice '2 OK: a una cuenta: asiento validado, movimiento conciliado; la 572 pasa de % a %.', s0, pg_temp.saldo();
end $$;

-- 3 · Cinco nóminas a la vez, a la misma cuenta: cinco asientos validados.
do $$
declare s0 numeric := pg_temp.saldo(); m uuid; imp numeric; n int := 0; t numeric := 0;
begin
  for m in select (jsonb_array_elements_text(pg_temp.p('nominas')::jsonb))::uuid loop
    select -amount into imp from public.bank_movement where id = m;
    perform public.bank_casar(m, pg_temp.cuenta(m, '46500000', imp), 'probable', 'Lo dijiste tú: nómina.', '[]'::jsonb, 'persona', null);
    if pg_temp.asiento(m) <> 'validado' then raise exception 'PRUEBA R08 · 3: una nómina queda %.', pg_temp.asiento(m); end if;
    n := n + 1; t := t + imp;
  end loop;
  if n <> 5 or t <> 6119.71 or pg_temp.saldo() <> s0 - 6119.71 then raise exception 'PRUEBA R08 · 3: % nóminas por %; la 572 de % a %.', n, t, s0, pg_temp.saldo(); end if;
  raise notice '3 OK: % nóminas a la 46500000, % €, cinco asientos validados; la 572 pasa de % a %.', n, t, s0, pg_temp.saldo();
end $$;

-- 4 · Casar con una factura recibida: el asiento validado y la factura pagada.
do $$
declare m uuid := pg_temp.p('pago')::uuid;
begin
  perform public.bank_casar(m, jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', pg_temp.p('fact'), 'importe', 60.50)),
    'cuenta_tercero', pg_temp.p('c400'), 'concepto', 'Pago de la factura'), 'probable', 'Lo dijiste tú: paga la factura.', '[]'::jsonb, 'persona', null);
  if pg_temp.asiento(m) <> 'validado' then raise exception 'PRUEBA R08 · 4: el asiento queda %.', pg_temp.asiento(m); end if;
  if (select status from public.supplier_invoice where id = pg_temp.p('fact')::uuid) <> 'pagada' then raise exception 'PRUEBA R08 · 4: la factura no queda pagada.'; end if;
  raise notice '4 OK: con su factura recibida: asiento validado y la factura, pagada.';
end $$;

-- 5 · Lo que concilia Sumied solo: también validado.
do $$
declare m uuid := pg_temp.n('gasto2');
begin
  perform public.bank_casar(m, pg_temp.cuenta(m, '62600000', 0.30), 'seguro', 'Mismo texto que las comisiones de siempre.', '[]'::jsonb, 'folvy', null);
  if pg_temp.asiento(m) <> 'validado' then raise exception 'PRUEBA R08 · 5: el asiento de Sumied solo queda %.', pg_temp.asiento(m); end if;
  raise notice '5 OK: lo que concilia Sumied solo, validado (antes, solo con el ajuste encendido).';
end $$;

-- 6 · Deshacer cada uno y volver a conciliarlo.
do $$
declare m uuid; b uuid; r jsonb; s0 numeric; e uuid; vivos int; imp numeric;
begin
  -- Una nómina del grupo: las otras cuatro siguen.
  m := (pg_temp.p('nominas')::jsonb->>0)::uuid;
  select -amount into imp from public.bank_movement where id = m;
  select id, journal_entry_id into b, e from public.bank_match where movement_id = m and status = 'vivo';
  s0 := pg_temp.saldo();
  r := public.bank_deshacer(b, 'Prueba R08: me equivoqué de cuenta');
  if pg_temp.mov(m) <> 'pendiente' or (select status from public.journal_entry where id = e) <> 'anulado' then raise exception 'PRUEBA R08 · 6: deshecho, movimiento % y asiento %.', pg_temp.mov(m), (select status from public.journal_entry where id = e); end if;
  select count(*) into vivos from public.bank_match where status = 'vivo' and movement_id in (select (jsonb_array_elements_text(pg_temp.p('nominas')::jsonb))::uuid);
  if vivos <> 4 then raise exception 'PRUEBA R08 · 6: quedan % nóminas conciliadas y son 4.', vivos; end if;
  if pg_temp.saldo() <> s0 + imp then raise exception 'PRUEBA R08 · 6: la 572 pasa de % a %.', s0, pg_temp.saldo(); end if;
  raise notice '6a OK: deshecha una nómina («%»): por conciliar; su asiento, anulado con su contraasiento; las otras 4 siguen; la 572 vuelve a %.', r->>'asiento', pg_temp.saldo();
  perform public.bank_casar(m, pg_temp.cuenta(m, '46500000', imp), 'probable', 'Lo dijiste tú: nómina.', '[]'::jsonb, 'persona', null);
  if pg_temp.asiento(m) <> 'validado' then raise exception 'PRUEBA R08 · 6: reconciliada, queda %.', pg_temp.asiento(m); end if;
  -- La de la factura: vuelve a pendiente, y otra vez pagada.
  m := pg_temp.p('pago')::uuid;
  select id into b from public.bank_match where movement_id = m and status = 'vivo';
  perform public.bank_deshacer(b, 'Prueba R08: deshacer');
  if (select status from public.supplier_invoice where id = pg_temp.p('fact')::uuid) = 'pagada' then raise exception 'PRUEBA R08 · 6: deshecho, la factura sigue pagada.'; end if;
  perform public.bank_casar(m, jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', pg_temp.p('fact'), 'importe', 60.50)),
    'cuenta_tercero', pg_temp.p('c400'), 'concepto', 'Pago de la factura'), 'probable', 'Lo dijiste tú: paga la factura.', '[]'::jsonb, 'persona', null);
  if (select status from public.supplier_invoice where id = pg_temp.p('fact')::uuid) <> 'pagada' or pg_temp.asiento(m) <> 'validado' then raise exception 'PRUEBA R08 · 6: la factura no vuelve a pagada.'; end if;
  -- La de Sumied solo y la de la cuenta.
  foreach m in array array[pg_temp.n('gasto2'), pg_temp.n('gasto1')] loop
    select id into b from public.bank_match where movement_id = m and status = 'vivo';
    perform public.bank_deshacer(b, 'Prueba R08: deshacer');
    if pg_temp.mov(m) <> 'pendiente' then raise exception 'PRUEBA R08 · 6: deshecho, queda %.', pg_temp.mov(m); end if;
    perform public.bank_casar(m, pg_temp.cuenta(m, case when m = pg_temp.n('gasto2') then '62600000' else '62800000' end, abs((select amount from public.bank_movement where id = m))),
      'probable', 'Lo dijiste tú.', '[]'::jsonb, 'persona', null);
    if pg_temp.asiento(m) <> 'validado' then raise exception 'PRUEBA R08 · 6: reconciliado, queda %.', pg_temp.asiento(m); end if;
  end loop;
  raise notice '6 OK: cada uno, deshecho y conciliado otra vez: la nómina, la factura (pendiente y pagada otra vez), la de Sumied solo y la de la cuenta.';
end $$;

-- 7 · Lo que ya salió a ERP10 no se deshace, y lo dice.
reset role;
do $$
declare m uuid := pg_temp.n('gasto1'); v_l uuid;
begin
  insert into public.conta_erp10_salida_lote (account_id, company_id, mes, ficheros)
  select account_id, company_id, date '2026-11-01', '["asientos.xlsx"]'::jsonb from public.bank_movement where id = m returning id into v_l;
  insert into public.conta_erp10_salida_partida (account_id, company_id, lote_id, entry_id, clase, huella)
  select b.account_id, b.company_id, v_l, b.journal_entry_id, 'asiento', 'prueba-r08' from public.bank_match b where b.movement_id = m and b.status = 'vivo';
end $$;
set local role authenticated;
do $$
declare v_msg text;
begin
  begin
    perform public.bank_deshacer((select id from public.bank_match where movement_id = pg_temp.n('gasto1') and status = 'vivo'), 'Prueba R08');
    raise exception 'PRUEBA R08 · 7: ha deshecho uno que ya salió a ERP10.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg not like 'No se deshace: el asiento % ya salió a ERP10.%' then raise exception 'PRUEBA R08 · 7: dice «%».', v_msg; end if;
  raise notice '7 OK: uno que ya salió a ERP10 no se deshace: «%»', v_msg;
end $$;

-- 8 · El recibo que el banco no cobró: se aparta solo; conciliarlo apartado lo dice en palabras;
--     volver a abrirlo y conciliarlo.
do $$
declare r jsonb; m uuid := pg_temp.n('telefonia'); v_msg text;
begin
  r := public.bank_apartar_no_cobrados(pg_temp.p('e')::uuid);
  if pg_temp.mov(m) <> 'ignorado' or jsonb_array_length(r) <> 1 or (r->0->>'importe')::numeric <> -31.50 then
    raise exception 'PRUEBA R08 · 8: el recibo queda % y se ha apartado %.', pg_temp.mov(m), r;
  end if;
  begin
    perform public.bank_casar(m, pg_temp.cuenta(m, '62800000', 31.50), 'probable', 'Prueba.', '[]'::jsonb, 'persona', null);
    raise exception 'PRUEBA R08 · 8: ha dejado conciliar uno apartado.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg <> 'Este movimiento está apartado: el banco no lo cobró. Vuelve a abrirlo para conciliarlo.' then raise exception 'PRUEBA R08 · 8: dice «%».', v_msg; end if;
  perform public.bank_desapartar(m);
  perform public.bank_casar(m, pg_temp.cuenta(m, '62800000', 31.50), 'probable', 'Lo dijiste tú.', '[]'::jsonb, 'persona', null);
  if pg_temp.asiento(m) <> 'validado' then raise exception 'PRUEBA R08 · 8: reabierto y conciliado, queda %.', pg_temp.asiento(m); end if;
  raise notice '8 OK: el recibo de 31,50 que el banco no cobró se aparta solo; conciliarlo apartado dice «%»; reabierto, se concilia validado.', v_msg;
end $$;
reset role;

-- 9 · Las vueltas atrás, en orden inverso: las funciones vuelven a las de antes.
\i supabase/vuelta-atras/20261119T2120_r08_cargo_no_cobrado.down.sql
\i supabase/vuelta-atras/20261119T2040_r08_conciliar_valida.down.sql
\i supabase/vuelta-atras/20261119T1945_r08_saldo_del_banco.down.sql
do $$ begin
  if md5(pg_get_functiondef('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure)) <> '9b90a7d302bebf86aa7ad582e41bf5e2'
     or md5(pg_get_functiondef('public.bank_deshacer(uuid,text)'::regprocedure)) <> '2bd4986001f368ade6dd483b9b23dc54'
     or md5(pg_get_functiondef('public._bank_cargos_anulados(uuid)'::regprocedure)) <> '5f152fbae949adbb4f09190aae710171'
     or to_regprocedure('public.bank_apartar_no_cobrados(uuid)') is not null or to_regprocedure('public.bank_saldo_extracto(uuid, date)') is not null then
    raise exception 'PRUEBA R08 · 9: las vueltas atrás no dejan las funciones como estaban.';
  end if;
  raise notice '9 OK: las vueltas atrás dejan las funciones de antes, byte a byte.';
end $$;

do $$ begin raise notice 'PRUEBA R08: 9 de 9 bien.'; end $$;
rollback;
