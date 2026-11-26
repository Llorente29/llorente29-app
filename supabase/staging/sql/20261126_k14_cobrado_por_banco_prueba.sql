-- supabase/staging/sql/20261126_k14_cobrado_por_banco_prueba.sql
--
-- SOLO STAGING. Prueba del K14 (20261126T0915_k14_cobrado_por_banco): la tabla de lo cobrado por el banco, casado con su
-- cliente. Todo en una transacción con ROLLBACK: staging no cambia. Lo que añade: public.conta_banco_cobro,
-- public.conta_banco_cobro_recibo, public.conta_banco_cobros_datos, public.conta_banco_cobros_guardar y
-- public.conta_banco_cobro_decidir.
--
-- En la gestoría de ejemplo del núcleo (semillas K02, K04 y K05), con su «Banco principal», como el usuario del núcleo.
-- Todo inventado (T11). Los caminos, por las funciones que usan la app y la pantalla:
--   1. Leer un extracto de cinco entradas (bank_importar): un cliente de GoCardless que paga su recibo devuelto de 72,60
--      con 2 € de recargo; una empresa sin GoCardless (cobro del mes); un abono del TPV; un abono de GoCardless; y un
--      apellido común.
--   2. Lo que lee el motor (conta_banco_cobros_datos): las cinco entradas, los dos clientes y el recibo sin cobrar; uno
--      marcado a mano como «Cobrado por otra vía» (G04) no sale. Una empresa sin GoCardless: {aplica: false}.
--   3. Lo que guarda (conta_banco_cobros_guardar), con las filas que da el motor: las cuentas, el recibo pagado por el
--      banco, el recargo y el cobro del mes. El abono de GoCardless no se guarda.
--   4. El mismo extracto otra vez: no entra nada (bank_importar) y guardar lo mismo deja una fila por entrada y el recibo
--      una sola vez. Que otra entrada pague el mismo recibo para la escritura entera, y lo dice.
--   5. «Sí, es este» (conta_banco_cobro_decidir) en la del apellido común; lo lee el motor (decisiones) y guardar no lo
--      borra. «No es de ningún cliente» y deshacer.
--   6. La vuelta atrás: no queda nada del K14.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K14: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_banco_cobro') is null or to_regprocedure('public.conta_banco_cobros_guardar(uuid,jsonb,text)') is null then
    raise exception 'PRUEBA K14 · 0: falta la 20261126T0915 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _k14 (k text primary key, v text) on commit drop;
grant all on _k14 to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _k14 where _k14.k = $1 $$;

-- 0 · Preparar (inventado): dos clientes de la gestoría. Uno cobra por GoCardless y su recibo de noviembre se devolvió;
--     otro recibo suyo de octubre se cobró a mano por otra vía (G04).
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  insert into public.party (id, account_id, name, tax_id) values
    ('c0f14000-0000-4000-8000-0000000000b1', a, 'PERSONA INVENTADA K14 UNO', null),
    ('c0f14000-0000-4000-8000-0000000000b2', a, 'EMPRESA INVENTADA K14 DOS SL', null);
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id) values
    (emp, 'CU0K14A', a, 'Persona Inventada K14 Uno', 'c0f14000-0000-4000-8000-0000000000b1');
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id) values (emp, 'MD0K14A', a, 'CU0K14A');
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, forma_cobro) values
    (emp, 'c0f14000-0000-4000-8000-0000000000b2', a, 'transferencia');
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe) values
    (emp, 'PM0K14A1', a, 'MD0K14A', 'failed', '2026-11-04', 72.6),
    (emp, 'PM0K14A0', a, 'MD0K14A', 'charged_back', '2026-10-05', 72.6),
    (emp, 'PM0K14A9', a, 'MD0K14A', 'paid_out', '2026-09-04', 72.6);
  insert into public.conta_gc_cobro_otra_via (company_id, gc_id, account_id, via, fecha, nota, quien_name) values
    (emp, 'PM0K14A0', a, 'transferencia', '2026-10-20', 'Prueba K14', 'Persona de Prueba K14');
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 1 · Leer el extracto ------------------------------------------------------------------------------------------------------
create function pg_temp.movs() returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('fecha', f, 'importe', i, 'concepto_banco', c, 'concepto_limpio', c, 'huella', 'k14-' || h, 'huella_suave', 'k14s-' || h) order by h)
    from (values
      ('1', '2026-11-19', 74.60, 'TRANSFER INMEDIATA, Persona Inventada K14 Uno, Persona Inventada K14 Uno, 000001020261119, Recibo noviembre'),
      ('2', '2026-11-20', 121.00, 'TRANSFER INMEDIATA, Empresa Inventada K14 Dos S.L., Empresa Inventada K14 Dos S.L., 000001020261120, Fra noviembre'),
      ('3', '2026-11-21', 300.00, 'WEB340941087 2111, Comercia Global Payments'),
      ('4', '2026-11-06', 500.00, 'TRANSF. A SU FAVOR, 00000000-GOCARDLESS LTD, 00000000-GOCARDLESS LTD, 020261106000001'),
      ('5', '2026-11-22', 30.00, 'TRANSFER INMEDIATA, GONZALEZ, GONZALEZ, 000001020261122, Cuota')
    ) t(h, f, i, c)
$f$;
do $$
declare r jsonb;
begin
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'xlsx', 'k14-diezbank.xlsx', repeat('e', 64), date '2026-11-06', date '2026-11-22',
                            null, null, 'Prueba K14', null, pg_temp.movs());
  if (r->>'nuevos')::int <> 5 then raise exception 'PRUEBA K14 · 1: %', r; end if;
  insert into _k14 select 'm' || replace(fingerprint, 'k14-', ''), id from public.bank_movement where fingerprint like 'k14-%';
  raise notice 'PRUEBA K14 · 1: leído, 5 entradas nuevas.';
end $$;

-- 2 · Lo que lee el motor ---------------------------------------------------------------------------------------------------
do $$
declare d jsonb; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  d := public.conta_banco_cobros_datos(emp);
  if not (d->>'aplica')::boolean then raise exception 'PRUEBA K14 · 2: no aplica (%)', d; end if;
  if (select count(*) from jsonb_array_elements(d->'entradas') e where e->>'concepto' like '%K14%' or e->>'concepto' like 'WEB340941087 2111%' or e->>'concepto' like '%020261106000001%' or e->>'concepto' like '%GONZALEZ%') <> 5 then
    raise exception 'PRUEBA K14 · 2: las entradas (%)', d->'entradas';
  end if;
  if not exists (select 1 from jsonb_array_elements(d->'clientes') c where c->>'party_id' = 'c0f14000-0000-4000-8000-0000000000b1' and c->'nombres_gc' ? 'Persona Inventada K14 Uno')
     or not exists (select 1 from jsonb_array_elements(d->'clientes') c where c->>'party_id' = 'c0f14000-0000-4000-8000-0000000000b2') then
    raise exception 'PRUEBA K14 · 2: los clientes (%)', d->'clientes';
  end if;
  if (select string_agg(r->>'gc_id', ',' order by r->>'gc_id') from jsonb_array_elements(d->'recibos') r where r->>'gc_id' like 'PM0K14%') is distinct from 'PM0K14A1' then
    raise exception 'PRUEBA K14 · 2: los recibos sin cobrar (sin el cobrado por otra vía ni el cobrado) (%)', d->'recibos';
  end if;
  if (public.conta_banco_cobros_datos('c0e20000-0000-4000-8000-0000000000e2')->>'aplica')::boolean then
    raise exception 'PRUEBA K14 · 2: una empresa sin GoCardless no casa nada aquí';
  end if;
  raise notice 'PRUEBA K14 · 2: 5 entradas, los 2 clientes y 1 recibo sin cobrar (el cobrado por otra vía no sale). Sin GoCardless: no aplica.';
end $$;

-- 3 · Lo que guarda: las filas del motor (porBanco.ts) para este extracto ---------------------------------------------------
create function pg_temp.filas(con_otro boolean default false) returns jsonb language sql as $f$
  select jsonb_build_array(
    jsonb_build_object('movement_id', pg_temp.p('m1'), 'fecha', '2026-11-19', 'importe', 74.60, 'via', 'transferencia', 'estado', 'casado',
      'party_id', 'c0f14000-0000-4000-8000-0000000000b1', 'porque', 'El que paga: «Persona Inventada K14 Uno»', 'recargo', 2.00, 'cobro', 0,
      'recibos', jsonb_build_array(jsonb_build_object('gc_id', 'PM0K14A1', 'importe', 72.60))),
    jsonb_build_object('movement_id', pg_temp.p('m2'), 'fecha', '2026-11-20', 'importe', 121.00, 'via', 'transferencia', 'estado', 'casado',
      'party_id', 'c0f14000-0000-4000-8000-0000000000b2', 'porque', 'El que paga: «Empresa Inventada K14 Dos S.L.»', 'recargo', 0, 'cobro', 121.00,
      'recibos', case when con_otro then jsonb_build_array(jsonb_build_object('gc_id', 'PM0K14A1', 'importe', 72.60)) else '[]'::jsonb end),
    jsonb_build_object('movement_id', pg_temp.p('m3'), 'fecha', '2026-11-21', 'importe', 300.00, 'via', 'tarjeta', 'estado', 'tarjeta',
      'party_id', null, 'porque', 'Total de un día del TPV: cobrado con tarjeta, sin asignar', 'recargo', 0, 'cobro', 0, 'recibos', '[]'::jsonb),
    jsonb_build_object('movement_id', pg_temp.p('m5'), 'fecha', '2026-11-22', 'importe', 30.00, 'via', 'transferencia', 'estado', 'por_confirmar',
      'party_id', 'c0f14000-0000-4000-8000-0000000000b2', 'porque', 'El que paga: «GONZALEZ» se parece, pero no basta (1 palabra)', 'recargo', 0, 'cobro', 0, 'recibos', '[]'::jsonb))
$f$;
do $$
declare r jsonb; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  r := public.conta_banco_cobros_guardar(emp, pg_temp.filas(), 'k14-1');
  if (r->>'guardadas')::int <> 4 or (r->>'casados')::int <> 2 or (r->>'casados_importe')::numeric <> 195.60
     or (r->>'por_confirmar')::int <> 1 or (r->>'tarjeta_importe')::numeric <> 300 or (r->>'recibos')::int <> 1 then
    raise exception 'PRUEBA K14 · 3: las cuentas (%)', r;
  end if;
  if not exists (select 1 from public.conta_banco_cobro b join public.conta_banco_cobro_recibo x on x.movement_id = b.movement_id
                  where b.movement_id = pg_temp.p('m1')::uuid and x.gc_id = 'PM0K14A1' and b.recargo = 2 and b.cobro = 0 and b.mes = '2026-11-01') then
    raise exception 'PRUEBA K14 · 3: el recibo pagado por el banco y su recargo';
  end if;
  if not exists (select 1 from public.conta_banco_cobro where movement_id = pg_temp.p('m2')::uuid and estado = 'casado' and cobro = 121 and mes = '2026-11-01') then
    raise exception 'PRUEBA K14 · 3: el cobro del mes de la empresa sin GoCardless';
  end if;
  if exists (select 1 from public.conta_banco_cobro where movement_id = pg_temp.p('m4')::uuid) then raise exception 'PRUEBA K14 · 3: el abono de GoCardless no se guarda'; end if;
  insert into _k14 values ('cuentas', r::text);
  raise notice 'PRUEBA K14 · 3: %', r;
end $$;

-- 4 · El mismo extracto otra vez; y un recibo que paga otra entrada ---------------------------------------------------------
do $$
declare r jsonb; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; ok boolean := false;
begin
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'xlsx', 'k14-diezbank.xlsx', repeat('e', 64), date '2026-11-06', date '2026-11-22',
                            null, null, 'Prueba K14', null, pg_temp.movs());
  if coalesce((r->>'nuevos')::int, 0) <> 0 then raise exception 'PRUEBA K14 · 4: el mismo extracto ha metido algo (%)', r; end if;
  r := public.conta_banco_cobros_guardar(emp, pg_temp.filas(), 'k14-1');
  if r::text <> pg_temp.p('cuentas') then raise exception 'PRUEBA K14 · 4: guardar otra vez cambia las cuentas (%)', r; end if;
  if (select count(*) from public.conta_banco_cobro where movement_id::text in (pg_temp.p('m1'), pg_temp.p('m2'), pg_temp.p('m3'), pg_temp.p('m5'))) <> 4 then
    raise exception 'PRUEBA K14 · 4: una fila por entrada';
  end if;
  begin
    perform public.conta_banco_cobros_guardar(emp, pg_temp.filas(true), 'k14-1');
  exception when unique_violation then
    ok := sqlerrm like 'El recibo PM0K14A1 ya lo paga otra entrada del banco.%';
  end;
  if not ok then raise exception 'PRUEBA K14 · 4: dos entradas pagando el mismo recibo no para'; end if;
  if (select count(*) from public.conta_banco_cobro_recibo where gc_id = 'PM0K14A1') <> 1 then raise exception 'PRUEBA K14 · 4: el recibo, una sola vez'; end if;
  raise notice 'PRUEBA K14 · 4: el mismo extracto no mete nada; guardar otra vez, lo mismo; el mismo recibo en otra entrada para y lo dice.';
end $$;

-- 5 · Lo que decide una persona ---------------------------------------------------------------------------------------------
do $$
declare t text; d jsonb; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  t := public.conta_banco_cobro_decidir(pg_temp.p('m5')::uuid, 'c0f14000-0000-4000-8000-0000000000b2', false, 'Persona de Prueba K14');
  if t <> 'Apuntado: la entrada del 22/11 de 30,00 € es de EMPRESA INVENTADA K14 DOS SL.' then raise exception 'PRUEBA K14 · 5: «%»', t; end if;
  d := public.conta_banco_cobros_datos(emp);
  if not exists (select 1 from jsonb_array_elements(d->'decisiones') x where x->>'movement_id' = pg_temp.p('m5') and x->>'party_id' = 'c0f14000-0000-4000-8000-0000000000b2' and not (x->>'ninguno')::boolean) then
    raise exception 'PRUEBA K14 · 5: el motor no lee la decisión (%)', d->'decisiones';
  end if;
  perform public.conta_banco_cobros_guardar(emp, pg_temp.filas(), 'k14-1');
  if not exists (select 1 from public.conta_banco_cobro where movement_id = pg_temp.p('m5')::uuid and decidido_party = 'c0f14000-0000-4000-8000-0000000000b2' and decidido_nombre = 'Persona de Prueba K14') then
    raise exception 'PRUEBA K14 · 5: guardar ha borrado la decisión';
  end if;
  t := public.conta_banco_cobro_decidir(pg_temp.p('m5')::uuid, null, true, 'Persona de Prueba K14');
  if t <> 'Apuntado: la entrada del 22/11 de 30,00 € no es de ningún cliente.' then raise exception 'PRUEBA K14 · 5: «%»', t; end if;
  t := public.conta_banco_cobro_decidir(pg_temp.p('m5')::uuid, null, false, 'Persona de Prueba K14');
  if t <> 'Deshecho: Sumied vuelve a casar esta entrada solo.' or exists (select 1 from public.conta_banco_cobro where movement_id = pg_temp.p('m5')::uuid and decidido_en is not null) then
    raise exception 'PRUEBA K14 · 5: deshacer («%»)', t;
  end if;
  raise notice 'PRUEBA K14 · 5: «Sí, es este», el motor lo lee y guardar no lo borra; «No es de ningún cliente»; deshacer.';
end $$;

-- 6 · La vuelta atrás ---------------------------------------------------------------------------------------------------------
reset role;
\i supabase/vuelta-atras/20261126T0915_k14_cobrado_por_banco.down.sql
do $$ begin
  if to_regclass('public.conta_banco_cobro') is not null or to_regclass('public.conta_banco_cobro_recibo') is not null
     or to_regprocedure('public.conta_banco_cobros_datos(uuid)') is not null or to_regprocedure('public.conta_banco_cobros_guardar(uuid,jsonb,text)') is not null
     or to_regprocedure('public.conta_banco_cobro_decidir(uuid,uuid,boolean,text)') is not null or to_regprocedure('public._conta_banco_cobro_empresa(uuid)') is not null then
    raise exception 'PRUEBA K14 · 6: la vuelta atrás deja algo';
  end if;
  raise notice 'PRUEBA K14 · 6: la vuelta atrás no deja nada del K14.';
end $$;

rollback;
