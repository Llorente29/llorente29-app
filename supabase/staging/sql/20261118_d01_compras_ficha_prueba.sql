-- supabase/staging/sql/20261118_d01_compras_ficha_prueba.sql
--
-- SOLO STAGING. Prueba de 20261118T0100 (D01, lo que Compras pregunta de la
-- ficha). Todo en una transacción con ROLLBACK: no cambia staging. Datos de la
-- semilla seed_d01_compras_ficha_staging.sql (inventados). Cambian en caliente,
-- y aquí se prueban por su nombre: public.compras_mirar y
-- public.compras_ficha_le_falta. Como administrador de A, como la pantalla.
--
--   1. Lácteos Prueba Ocho: su recepción usada con la pregunta «¿cómo factura?»
--      abierta y la ficha ya contestada no sale en compras_mirar; con la ficha
--      sin contestar, sí; y una no usada sale aunque la ficha esté contestada.
--   2. Marca Prueba Cedida: con su cuenta de facturas no le falta el tipo de
--      gasto; sin ella, sí. Verduras del Huerto (sin las dos), sí.
--   3. La vuelta atrás, de verdad: vuelve lo de antes (la pregunta de Lácteos
--      sale otra vez, y a Marca Prueba Cedida le falta el tipo de gasto).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 compras ficha: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if not exists (select 1 from public.supplier where id = 'd1c00000-0000-4000-8000-000000000001') then
    raise exception 'PRUEBA D01 compras ficha: falta la semilla seed_d01_compras_ficha_staging.sql.';
  end if;
end $$;
set local statement_timeout = '300s';

create function pg_temp.pregunta_lacteos() returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(public.compras_mirar('c01a0000-0000-4000-8000-00000000000a')->'recepciones') r
                  where r->>'recepcion' = 'd1c00000-0000-4000-8000-000000000101' and r->>'pregunta' = 'ficha_sin_forma')
$$;
create function pg_temp.falta(p uuid, k text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(public.compras_ficha_le_falta(p)) f where f->>'falta' = k)
$$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if pg_temp.pregunta_lacteos() then raise exception 'PRUEBA D01 compras ficha · 1: la pregunta contestada de Lácteos sigue saliendo.'; end if;
  if pg_temp.falta('d1c00000-0000-4000-8000-000000000002', 'tipo_gasto') then raise exception 'PRUEBA D01 compras ficha · 2: a Marca Prueba Cedida, con su cuenta de facturas, le sigue faltando el tipo de gasto.'; end if;
  if not pg_temp.falta('c0c00000-0000-4000-8000-000000000001', 'tipo_gasto') then raise exception 'PRUEBA D01 compras ficha · 2: a Verduras del Huerto, sin tipo de gasto ni cuenta, ya no le falta.'; end if;
  raise notice 'PRUEBA D01 compras ficha · 1 y 2: la pregunta contestada de Lácteos no sale; a Marca Prueba Cedida (con su cuenta) no le falta el tipo de gasto; a Verduras (sin nada), sí.';
end $$;
reset role;

-- Los otros lados, como postgres (en la transacción): la ficha sin contestar, una recepción no usada, y sin su cuenta.
do $$
begin
  update public.supplier set invoicing_mode = null where id = 'd1c00000-0000-4000-8000-000000000001';
end $$;
set local role authenticated;
do $$ begin
  if not pg_temp.pregunta_lacteos() then raise exception 'PRUEBA D01 compras ficha · 1: con la ficha sin decir cómo factura, la pregunta de Lácteos no sale.'; end if;
end $$;
reset role;
do $$
begin
  update public.supplier set invoicing_mode = 'delivery_note_then_invoice' where id = 'd1c00000-0000-4000-8000-000000000001';
  -- Su disparador (la factura desde el papel) no hace nada: la recepción ya tiene su factura.
  update public.goods_receipt_path set consumed_at = null where goods_receipt_id = 'd1c00000-0000-4000-8000-000000000101';
end $$;
set local role authenticated;
do $$ begin
  if not pg_temp.pregunta_lacteos() then raise exception 'PRUEBA D01 compras ficha · 1: una recepción no usada con la pregunta abierta no sale.'; end if;
  raise notice 'PRUEBA D01 compras ficha · 1: con la ficha sin contestar sale; una no usada sale aunque la ficha esté contestada.';
end $$;
reset role;
do $$
begin
  delete from public.company_account_link where entity = 'supplier' and entity_id = 'd1c00000-0000-4000-8000-000000000002' and role = 'gasto';
end $$;
set local role authenticated;
do $$ begin
  if not pg_temp.falta('d1c00000-0000-4000-8000-000000000002', 'tipo_gasto') then raise exception 'PRUEBA D01 compras ficha · 2: sin su cuenta de facturas, a Marca Prueba Cedida no le falta el tipo de gasto.'; end if;
  raise notice 'PRUEBA D01 compras ficha · 2: sin su cuenta de facturas, a Marca Prueba Cedida le falta.';
end $$;
reset role;

-- 3 · La vuelta atrás, de verdad, con la cuenta de vuelta y la recepción usada otra vez.
do $$
declare v_600 uuid;
begin
  select id into v_600 from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '60000000';
  perform public.company_account_link_set('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'supplier', 'd1c00000-0000-4000-8000-000000000002', 'gasto', v_600, 'Prueba D01 compras ficha', 'manual');
  update public.goods_receipt_path set consumed_at = now() where goods_receipt_id = 'd1c00000-0000-4000-8000-000000000101';
end $$;
\i supabase/vuelta-atras/20261118T0100_d01_compras_ficha.down.sql
set local role authenticated;
do $$ begin
  if not pg_temp.pregunta_lacteos() then raise exception 'PRUEBA D01 compras ficha · 3: tras la vuelta atrás, la pregunta de Lácteos no vuelve.'; end if;
  if not pg_temp.falta('d1c00000-0000-4000-8000-000000000002', 'tipo_gasto') then raise exception 'PRUEBA D01 compras ficha · 3: tras la vuelta atrás, a Marca Prueba Cedida no le vuelve a faltar.'; end if;
  raise notice 'PRUEBA D01 compras ficha · 3: la vuelta atrás deja las dos como antes.';
end $$;
reset role;

rollback;
