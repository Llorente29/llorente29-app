-- supabase/staging/sql/20261126_r20b_cifras_del_banco_prueba.sql
--
-- SOLO STAGING. Prueba del R20b (20261126T1139_r20b_cifras_del_banco), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo que añade: public.conta_cifras_del_banco.
--
-- En la gestoría de ejemplo del núcleo (semillas K02, K04 y K05), con su «Banco principal», como el usuario del núcleo.
-- Todo inventado (T11). Por sus caminos:
--   1. Un extracto de dos entradas (bank_importar): una transferencia de un cliente que paga su recibo devuelto de
--      GoCardless y un abono del TPV. Lo que el K14 guarda de ellas (conta_banco_cobros_guardar, como lo llama su motor).
--   2. Como el usuario de la cuenta: la empresa sale cruzada con el banco; el recibo, pagado por el banco con su
--      entrada y su importe; el TPV, sin asignar, con su fecha y su importe.
--   3. Como alguien de otra cuenta: nada. Como el servidor (la comprobación de cada noche): lo mismo que el usuario.
--   4. La vuelta atrás (el fichero de verdad): sin la función.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R20b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_banco_cobro') is null or to_regprocedure('public.conta_cifras_del_banco(uuid)') is null then
    raise exception 'PRUEBA R20b · 0: faltan el K14 (20261126T0915) o la 20261126T1139 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _r20b (k text primary key, v text) on commit drop;
grant all on _r20b to authenticated;

-- 0 · Preparar (inventado): un cliente de la gestoría que cobra por GoCardless, con un recibo de noviembre devuelto.
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  insert into public.party (id, account_id, name, tax_id) values ('c0f20b00-0000-4000-8000-0000000000b1', a, 'PERSONA INVENTADA R20B', null);
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id) values (emp, 'CU0R20B', a, 'Persona Inventada R20b', 'c0f20b00-0000-4000-8000-0000000000b1');
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id) values (emp, 'MD0R20B', a, 'CU0R20B');
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe) values (emp, 'PM0R20B1', a, 'MD0R20B', 'failed', '2026-11-04', 72.6);
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 1 · El extracto y lo que el K14 guarda de él
do $$
declare r jsonb;
begin
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'xlsx', 'r20b-diezbank.xlsx', repeat('f', 64), date '2026-11-19', date '2026-11-21',
    null, null, 'Prueba R20b', null, jsonb_build_array(
      jsonb_build_object('fecha', '2026-11-19', 'importe', 74.60, 'concepto_banco', 'TRANSFER INMEDIATA, Persona Inventada R20b, Persona Inventada R20b, 000001020261119, Recibo',
        'concepto_limpio', 'TRANSFER INMEDIATA Persona Inventada R20b', 'huella', 'r20b-1', 'huella_suave', 'r20bs-1'),
      jsonb_build_object('fecha', '2026-11-21', 'importe', 300.00, 'concepto_banco', 'WEB340941087 2111, Comercia Global Payments',
        'concepto_limpio', 'WEB340941087 Comercia Global Payments', 'huella', 'r20b-2', 'huella_suave', 'r20bs-2')));
  if (r->>'nuevos')::int <> 2 then raise exception 'PRUEBA R20b · 1: %', r; end if;
  insert into _r20b select replace(fingerprint, 'r20b-', 'm'), id from public.bank_movement where fingerprint like 'r20b-%';
  r := public.conta_banco_cobros_guardar('c0e20000-0000-4000-8000-0000000000e3', jsonb_build_array(
    jsonb_build_object('movement_id', (select v from _r20b where k = 'm1'), 'fecha', '2026-11-19', 'importe', 74.60, 'via', 'transferencia', 'estado', 'casado',
      'party_id', 'c0f20b00-0000-4000-8000-0000000000b1', 'porque', 'Nombre del que paga: prueba', 'recargo', 2.00, 'cobro', 0, 'mes', '2026-11-01',
      'recibos', jsonb_build_array(jsonb_build_object('gc_id', 'PM0R20B1', 'importe', 72.60))),
    jsonb_build_object('movement_id', (select v from _r20b where k = 'm2'), 'fecha', '2026-11-21', 'importe', 300.00, 'via', 'tarjeta', 'estado', 'tarjeta',
      'party_id', null, 'porque', 'Cobrado con tarjeta, sin asignar', 'recargo', 0, 'cobro', 0, 'mes', '2026-11-01', 'recibos', '[]'::jsonb)), 'prueba-r20b');
  raise notice 'PRUEBA R20b · 1 OK: dos entradas leídas y guardadas por el K14: %', r;
end $$;

-- 2 · Como el usuario de la cuenta
do $$ declare j jsonb; begin
  j := public.conta_cifras_del_banco('c0e20000-0000-4000-8000-0000000000e0');
  if not (j->'cruzadas') @> '["c0e20000-0000-4000-8000-0000000000e3"]'::jsonb then raise exception 'PRUEBA R20b · 2: la empresa no sale cruzada: %', j->'cruzadas'; end if;
  if not exists (select 1 from jsonb_array_elements(j->'recibos') x where x->>'gc_id' = 'PM0R20B1' and (x->>'importe')::numeric = 72.60
                   and x->>'movement_id' = (select v from _r20b where k = 'm1') and x->>'via' = 'transferencia') then
    raise exception 'PRUEBA R20b · 2: el recibo pagado por el banco: %', j->'recibos';
  end if;
  if not exists (select 1 from jsonb_array_elements(j->'tarjeta') x where x->>'movement_id' = (select v from _r20b where k = 'm2') and (x->>'importe')::numeric = 300
                   and x->>'fecha' = '2026-11-21') then
    raise exception 'PRUEBA R20b · 2: el TPV sin asignar: %', j->'tarjeta';
  end if;
  if exists (select 1 from jsonb_array_elements(j->'tarjeta') x where x->>'movement_id' = (select v from _r20b where k = 'm1')) then
    raise exception 'PRUEBA R20b · 2: una transferencia casada sale como TPV';
  end if;
  raise notice 'PRUEBA R20b · 2 OK: cruzada, el recibo pagado por el banco (72,60 €) y el TPV sin asignar (300,00 €)';
end $$;

-- 3 · Otra cuenta: nada. El servidor: lo mismo.
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-00000000ffff","role":"authenticated"}', true);
do $$ declare j jsonb; begin
  j := public.conta_cifras_del_banco('c0e20000-0000-4000-8000-0000000000e0');
  if jsonb_array_length(j->'cruzadas') + jsonb_array_length(j->'recibos') + jsonb_array_length(j->'tarjeta') <> 0 then raise exception 'PRUEBA R20b · 3: otra cuenta ve algo: %', j; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ declare j jsonb; begin
  j := public.conta_cifras_del_banco('c0e20000-0000-4000-8000-0000000000e0');
  if not exists (select 1 from jsonb_array_elements(j->'recibos') x where x->>'gc_id' = 'PM0R20B1') then raise exception 'PRUEBA R20b · 3: el servidor no ve el recibo: %', j; end if;
  raise notice 'PRUEBA R20b · 3 OK: otra cuenta no ve nada; el servidor, lo mismo que el usuario';
end $$;
select set_config('request.jwt.claims', '', true);

-- 4 · La vuelta atrás, el fichero de verdad
\i supabase/vuelta-atras/20261126T1139_r20b_cifras_del_banco.down.sql
do $$ begin
  if to_regprocedure('public.conta_cifras_del_banco(uuid)') is not null then raise exception 'PRUEBA R20b · 4: la vuelta atrás dejó la función'; end if;
  if not exists (select 1 from public.conta_banco_cobro_recibo where gc_id = 'PM0R20B1') then raise exception 'PRUEBA R20b · 4: la vuelta atrás se llevó lo del K14'; end if;
  raise notice 'PRUEBA R20b · 4 OK: la vuelta atrás quita la función y deja lo del K14';
end $$;

rollback;
