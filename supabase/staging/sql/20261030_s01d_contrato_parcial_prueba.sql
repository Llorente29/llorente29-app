-- supabase/staging/sql/20261030_s01d_contrato_parcial_prueba.sql
--
-- SOLO STAGING. Prueba de la 1638 (S01d-b, respuesta 3 de Julio): el cuadro
-- PARCIAL de un aplazamiento y añadir el del año siguiente, por el camino de
-- la pantalla (bank_contrato_guardar), como el administrador de A, con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. Números inventados
-- con la forma de la resolución de la TGSS: 4 cuotas, el cuadro de este año
-- trae 2 y la deuda pendiente al final.
--
--   1. Un cuadro parcial cuya deuda pendiente no cuadra no se guarda; el que
--      cuadra, sí: 4 cuotas, 2 filas, lo pendiente por fila y el aviso de
--      las cuotas que faltan.
--   2. El cuadro del año siguiente se añade al mismo contrato (no crea otro);
--      subirlo otra vez no añade nada.
--   3. Un cuadro completo sigue como antes: el capital suma lo aplazado.
--   4. La cuenta B no añade filas a un contrato de A.
--   5. La vuelta atrás deja la función como estaba, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01d-b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261030T1638_s01d_contrato_parcial.sql

create temp table _s01db (k text primary key, v text) on commit drop;
grant all on _s01db to authenticated;
insert into _s01db select 'emp', id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'B28000016';

-- ── 1 · Cuadro parcial ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  emp uuid := (select x.v::uuid from _s01db x where x.k = 'emp');
  corto text := coalesce((select code from public.company_account where company_id = emp and code like '521%' order by code limit 1),
                         (select code from public.company_account where company_id = emp and code like '520%' order by code limit 1));
  intereses text := coalesce((select code from public.company_account where company_id = emp and code like '669%' order by code limit 1),
                             (select code from public.company_account where company_id = emp and code like '662%' order by code limit 1));
  cuadro jsonb := '[{"fecha":"2026-11-30","cuota":330,"capital":300,"intereses":30},{"fecha":"2026-12-31","cuota":330,"capital":310,"intereses":20}]';
  datos jsonb; res jsonb; c public.recurring_contract;
begin
  if emp is null or corto is null or intereses is null then raise exception 'PRUEBA S01d-b · 1: faltan la empresa de A o sus cuentas 52x y 66x.'; end if;
  datos := jsonb_build_object('tipo', 'aplazamiento', 'nombre', 'Prueba S01d-b · aplazamiento', 'contiene', 'PRUEBA S01DB APLAZ',
    'importe', 1000, 'cuotas', 4, 'capital_corto', corto, 'intereses', intereses, 'cuadro', cuadro, 'documento', 'resolucion-inventada.pdf', 'documento_tipo', 'pdf');
  begin
    perform public.bank_contrato_guardar(emp, datos || '{"pendiente": 395}');
    raise exception 'PRUEBA S01d-b · 1: guarda un cuadro parcial cuya deuda pendiente no cuadra.';
  exception when sqlstate '22023' then
    if sqlerrm not like '%no cuadra%' then raise exception 'PRUEBA S01d-b · 1: el aviso dice otra cosa: %', sqlerrm; end if;
  end;
  begin
    perform public.bank_contrato_guardar(emp, datos);
    raise exception 'PRUEBA S01d-b · 1: guarda un cuadro parcial sin su deuda pendiente.';
  exception when sqlstate '22023' then null; end;
  res := public.bank_contrato_guardar(emp, datos || '{"pendiente": 390}');
  select * into c from public.recurring_contract where id = (res->>'id')::uuid;
  if c.installments <> 4 or jsonb_array_length(c.schedule) <> 2 or c.principal <> 1000 or c.amount <> 330
     or (c.schedule->0->>'pendiente')::numeric <> 700 or (c.schedule->1->>'pendiente')::numeric <> 390 then
    raise exception 'PRUEBA S01d-b · 1: el contrato parcial no queda como debe: %', row_to_json(c);
  end if;
  if res->>'mensaje' not like '%4 cuotas%Faltan las cuotas de 2027: sube el cuadro de ese año cuando llegue.' then
    raise exception 'PRUEBA S01d-b · 1: la confirmación dice %', res->>'mensaje';
  end if;
  insert into _s01db values ('contrato', c.id::text);
  raise notice 'PRUEBA S01d-b · 1: el parcial que no cuadra no se guarda; el que sí, con 4 cuotas y 2 filas. %', res->>'mensaje';
end $$;

-- ── 2 · El cuadro del año siguiente, al mismo contrato ─────────────────────
do $$
declare
  emp uuid := (select x.v::uuid from _s01db x where x.k = 'emp');
  id_c uuid := (select x.v::uuid from _s01db x where x.k = 'contrato');
  antes int := (select count(*) from public.recurring_contract where company_id = emp);
  cuadro jsonb := '[{"fecha":"2026-12-31","cuota":330,"capital":310,"intereses":20},{"fecha":"2027-01-31","cuota":200,"capital":190,"intereses":10},{"fecha":"2027-02-28","cuota":205,"capital":200,"intereses":5}]';
  res jsonb; c public.recurring_contract;
begin
  res := public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'cuadro', cuadro, 'documento', 'resolucion-2027-inventada.pdf'));
  select * into c from public.recurring_contract where id = id_c;
  if jsonb_array_length(c.schedule) <> 4 or c.installments <> 4 or (c.schedule->3->>'pendiente')::numeric <> 0
     or (select count(*) from public.recurring_contract where company_id = emp) <> antes then
    raise exception 'PRUEBA S01d-b · 2: el año nuevo no se añade al mismo contrato: % (%).', row_to_json(c), res;
  end if;
  if res->>'mensaje' <> 'Añadidas 2 cuotas a «Prueba S01d-b · aplazamiento»: ya tiene 4 de 4.' then
    raise exception 'PRUEBA S01d-b · 2: la confirmación dice %', res->>'mensaje';
  end if;
  begin
    perform public.bank_contrato_guardar(emp, jsonb_build_object('contrato', id_c, 'cuadro', cuadro));
    raise exception 'PRUEBA S01d-b · 2: subir otra vez el mismo cuadro añade algo.';
  exception when sqlstate '22023' then null; end;
  raise notice 'PRUEBA S01d-b · 2: el año nuevo se añade al mismo contrato (4 de 4, lo pendiente a 0); subirlo otra vez no añade nada.';
end $$;

-- ── 3 · Un cuadro completo, como antes ─────────────────────────────────────
do $$
declare
  emp uuid := (select x.v::uuid from _s01db x where x.k = 'emp');
  corto text := (select code from public.company_account where company_id = emp and code like '52%' order by code limit 1);
  intereses text := (select code from public.company_account where company_id = emp and code like '66%' order by code limit 1);
  cuadro jsonb := '[{"fecha":"2026-11-30","cuota":520,"capital":500,"intereses":20},{"fecha":"2026-12-30","cuota":510,"capital":500,"intereses":10}]';
begin
  begin
    perform public.bank_contrato_guardar(emp, jsonb_build_object('tipo', 'prestamo', 'nombre', 'Prueba S01d-b · préstamo', 'contiene', 'PRUEBA S01DB PREST',
      'importe', 1000.01, 'capital_corto', corto, 'intereses', intereses, 'cuadro', cuadro));
    raise exception 'PRUEBA S01d-b · 3: guarda un cuadro completo que no suma lo prestado.';
  exception when sqlstate '22023' then null; end;
  perform public.bank_contrato_guardar(emp, jsonb_build_object('tipo', 'prestamo', 'nombre', 'Prueba S01d-b · préstamo', 'contiene', 'PRUEBA S01DB PREST',
    'importe', 1000, 'capital_corto', corto, 'intereses', intereses, 'cuadro', cuadro));
  raise notice 'PRUEBA S01d-b · 3: un cuadro completo sigue como antes.';
end $$;

-- ── 4 · La cuenta B ────────────────────────────────────────────────────────
select set_config('s01db.emp', (select x.v from _s01db x where x.k = 'emp'), true);
select set_config('s01db.contrato', (select x.v from _s01db x where x.k = 'contrato'), true);
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.bank_contrato_guardar(current_setting('s01db.emp')::uuid,
      jsonb_build_object('contrato', current_setting('s01db.contrato'), 'cuadro', '[{"fecha":"2028-01-31","cuota":1,"capital":1,"intereses":0}]'::jsonb));
    raise exception 'PRUEBA S01d-b · 4: B añade filas a un contrato de A.';
  exception when no_data_found then null; end;
  raise notice 'PRUEBA S01d-b · 4: la cuenta B no toca los contratos de A.';
end $$;
reset role;

-- ── 5 · La vuelta atrás, y otra vez delante ────────────────────────────────
\i supabase/vuelta-atras/20261030T1638_s01d_contrato_parcial.down.sql
do $$ begin
  if position('cuotas_totales' in pg_get_functiondef('public.bank_contrato_guardar(uuid,jsonb)'::regprocedure)) > 0
     or position('v_pendiente' in pg_get_functiondef('public.bank_contrato_guardar(uuid,jsonb)'::regprocedure)) > 0
     or exists (select 1 from public.funcion_respaldo where migracion = '20261030T1638_s01d_contrato_parcial') then
    raise exception 'PRUEBA S01d-b · 5: la vuelta atrás deja algo de la 1638.';
  end if;
end $$;
\i supabase/migrations/20261030T1638_s01d_contrato_parcial.sql
do $$ begin raise notice 'PRUEBA S01d-b · 5: la vuelta atrás deja bank_contrato_guardar como estaba; y otra vez delante.'; end $$;

rollback;
