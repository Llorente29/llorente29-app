-- supabase/staging/sql/20261014_c05_prueba_cambia.sql
--
-- SOLO STAGING. Prueba de lo que el C05 cambia de lo que ya existe
-- (supabase/migrations/20261014T0120_c05_cambia.sql), por sus CAMINOS
-- (regla 10), no por su fórmula. Todo en una transacción con ROLLBACK.
--
--   1. journal_entry · trg_journal_entry_libro_registro:
--      a. los asientos validados de la semilla del C04 ya tienen sus filas
--         del libro registro (la 0120 las crea al final);
--      b. VALIDAR una propuesta de factura recibida con retención crea su fila,
--         con la retención;
--      c. ANULAR la venta del día marca su fila anulada, y el contraasiento no
--         crea ninguna (el libro no dobla ni resta dos veces);
--      d. validar un asiento sin IVA no crea nada.
--   2. conta_resultado_por_local: una regularización (7 → 129) validada en
--      octubre NO cambia el resultado de octubre (con ella dentro, antes, la
--      venta desaparecía del resultado).
-- Sobre la empresa A de la semilla (cuenta c01a…). Ninguna cuenta real.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C05 cambia: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

\echo '>>> 1a. Lo validado de la semilla ya está en el libro registro'
do $$
declare v record; n int;
begin
  -- Factura recibida validada (Compras nº 1) y venta del día validada (Ventas nº 1).
  select count(*) into n from public.vat_book_entry where entry_id = 'c5514b60-5c2f-4776-a0b7-8783245d7c96';
  if n <> 1 then raise exception 'PRUEBA C05 · 1a: la factura recibida validada tiene % filas en el libro (espero 1).', n; end if;
  select * into v from public.vat_book_entry where entry_id = 'c5514b60-5c2f-4776-a0b7-8783245d7c96';
  if v.book <> 'received' or v.invoice_type <> 'F1' or v.tax_amount <> 116.65 or v.voided_at is not null then
    raise exception 'PRUEBA C05 · 1a: la fila de la factura recibida está mal: % % cuota % anulada %', v.book, v.invoice_type, v.tax_amount, v.voided_at;
  end if;
  select * into v from public.vat_book_entry where entry_id = 'fc7df35a-c53c-460e-907a-ebea3d7fef8b';
  if v.id is null or v.book <> 'issued' or v.invoice_type not in ('F2', 'F4') or v.counterpart_name <> 'VENTAS A CONSUMIDOR FINAL' or v.tax_amount <> 8.99 then
    raise exception 'PRUEBA C05 · 1a: la venta del día no está bien en el libro: % % % cuota %', v.book, v.invoice_type, v.counterpart_name, v.tax_amount;
  end if;
  raise notice 'PRUEBA C05 · 1a en verde: recibida F1 116,65 · venta % «%» 8,99.', v.invoice_type, v.counterpart_name;
end $$;

\echo '>>> 1b. Validar una propuesta crea su fila (con la retención)'
do $$
declare v record; r jsonb;
begin
  if exists (select 1 from public.vat_book_entry where entry_id = '42c2e336-8f37-409c-ba41-389f499880be') then
    raise exception 'PRUEBA C05 · 1b: la propuesta ya tiene fila en el libro antes de validarse.';
  end if;
  r := public.journal_entry_validar('42c2e336-8f37-409c-ba41-389f499880be', 'Prueba C05');
  select * into v from public.vat_book_entry where entry_id = '42c2e336-8f37-409c-ba41-389f499880be';
  if v.id is null then raise exception 'PRUEBA C05 · 1b: validada (%), pero sin fila en el libro registro.', r; end if;
  if v.book <> 'received' or v.tax_amount <> 315.00 or v.withholding_amount is null then
    raise exception 'PRUEBA C05 · 1b: fila mal: % cuota % retención %', v.book, v.tax_amount, v.withholding_amount;
  end if;
  raise notice 'PRUEBA C05 · 1b en verde: Compras nº % → recibida %, cuota 315,00, retención %.', r->>'numero', v.invoice_type, v.withholding_amount;
end $$;

\echo '>>> 1c. Anular la venta marca su fila; el contraasiento no crea ninguna'
do $$
declare r jsonb; v record; n int;
begin
  r := public.journal_entry_anular('fc7df35a-c53c-460e-907a-ebea3d7fef8b', 'Prueba C05: anular la venta del día');
  select * into v from public.vat_book_entry where entry_id = 'fc7df35a-c53c-460e-907a-ebea3d7fef8b';
  if v.voided_at is null or v.voided_by_entry_id is distinct from (r->>'contraasiento')::uuid then
    raise exception 'PRUEBA C05 · 1c: la fila de la venta anulada no está marcada (anulada %, por %).', v.voided_at, v.voided_by_entry_id;
  end if;
  select count(*) into n from public.vat_book_entry where entry_id = (r->>'contraasiento')::uuid;
  if n <> 0 then raise exception 'PRUEBA C05 · 1c: el contraasiento ha creado % filas en el libro.', n; end if;
  raise notice 'PRUEBA C05 · 1c en verde: venta anulada en el libro, contraasiento sin filas.';
end $$;

\echo '>>> 2. La regularización no se come el resultado del mes (conta_resultado_por_local)'
do $$
declare antes numeric; despues numeric; p jsonb; n int;
begin
  -- Una venta validada en octubre para que haya algo que regularizar.
  p := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('fecha', '2026-10-20', 'source_type', 'manual', 'series', 4, 'concepto', 'Prueba C05: ingreso sin IVA', 'confianza', 'seguro', 'porque', 'prueba'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '57200001', 'debe', 500, 'local_id', 'c01a0000-0000-4000-8000-0000000000a2'),
      jsonb_build_object('cuenta', '77800000', 'haber', 500, 'local_id', 'c01a0000-0000-4000-8000-0000000000a2')));
  perform public.journal_entry_validar((p->>'id')::uuid, 'Prueba C05');
  select count(*) into n from public.vat_book_entry where entry_id = (p->>'id')::uuid;
  if n <> 0 then raise exception 'PRUEBA C05 · 1d: un asiento sin IVA ha creado % filas en el libro.', n; end if;
  select sum(resultado) into antes from public.conta_resultado_por_local('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-10-01', '2026-10-31', false);
  -- La regularización de ese ingreso: 778 a la 129.
  p := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
    jsonb_build_object('fecha', '2026-10-31', 'source_type', 'closing', 'series', 4, 'concepto', 'Prueba C05: regularización', 'confianza', 'seguro', 'porque', 'prueba'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '77800000', 'debe', 500, 'local_id', 'c01a0000-0000-4000-8000-0000000000a2'),
      jsonb_build_object('cuenta', '12900000', 'haber', 500, 'comun', true)));
  perform public.journal_entry_validar((p->>'id')::uuid, 'Prueba C05');
  select sum(resultado) into despues from public.conta_resultado_por_local('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-10-01', '2026-10-31', false);
  if despues is distinct from antes then
    raise exception 'PRUEBA C05 · 2: con la regularización el resultado de octubre pasa de % a %.', antes, despues;
  end if;
  raise notice 'PRUEBA C05 · 1d y 2 en verde: sin IVA no hay libro; resultado de octubre % antes y después de regularizar.', antes;
end $$;

reset role;
\echo '>>> PRUEBA C05 (journal_entry, conta_resultado_por_local) en verde. ROLLBACK: no queda nada.'
rollback;
