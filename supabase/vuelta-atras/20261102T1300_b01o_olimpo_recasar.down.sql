-- supabase/vuelta-atras/20261102T1300_b01o_olimpo_recasar.down.sql
--
-- Vuelta atrás de la 1300 (Olimpo), en el orden inverso:
--   c. deshace los dos casados nuevos (bank_deshacer: sus asientos propuestos se
--      quitan y las dos facturas vuelven a «aprobada» sin pagar);
--   b. devuelve los asientos 4/3312 y 4/3310 (_conta_asientos_borrado_deshacer:
--      con sus líneas, su número y su huella de antes);
--   a. los dos casados de antes, vivos con su asiento; sus movimientos como
--      estaban; y el pago y el asiento de pago de la 26/13028, desde
--      conta_b01o_antes.
-- Como la persona que aceptó las propuestas, solo dentro de la transacción.
-- Sin la tabla de antes (staging, o si no se aplicó), no hace nada.
-- sin prueba con datos: los datos son de Olimpo y solo están en producción; la prueba con datos es el ensayo de producción, que aplica la tanda y la deshace con esto dentro de su transacción y compara las cuentas «como antes». En staging la llama 20261102_b01o_olimpo_prueba.sql, sin datos.
do $$
declare
  v_c1   constant uuid := 'a79e4d17-44f8-4f97-b13d-e2e9b3fe04b6';
  v_c2   constant uuid := 'e7e87d64-c7d4-4118-966a-d8c30613addf';
  v_mov1 constant uuid := '0e62eb54-1b29-463a-a67f-242c03174f0a';
  v_mov2 constant uuid := '910ca451-c900-4fe4-97b0-9afd40cc287d';
  v_as1  constant uuid := 'cb8a8506-0110-4d20-9303-2e4a91e91e0f';
  v_alb  constant uuid := '37060996-e406-4046-9a5d-c45bf94a260c';
  v_quien uuid; v_lote uuid; x record; r jsonb;
begin
  if to_regclass('public.conta_b01o_antes') is null then return; end if;
  select created_by into v_quien from public.bank_match where id = v_c1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_quien, 'role', 'authenticated')::text, true);

  -- c · Los casados nuevos, fuera.
  for x in select id from public.bank_match where movement_id in (v_mov1, v_mov2) and status = 'vivo' loop
    perform public.bank_deshacer(x.id, 'Vuelta atrás de la 1300 (Olimpo).');
  end loop;

  -- b · Los asientos, de vuelta.
  select lote into v_lote from public.conta_asiento_borrado
   where que = 'asiento' and deshecho_at is null and motivo like 'B01 · Olimpo: asiento de pago casado con lo que no era%' order by at desc limit 1;
  if v_lote is not null then
    r := public._conta_asientos_borrado_deshacer(v_lote);
    raise notice 'B01 cola 2 · vuelta atrás de la 1300: %', r->>'texto';
  end if;

  -- a · Los casados de antes, como estaban.
  for x in select * from public.conta_b01o_antes loop
    update public.bank_match set status = 'vivo', journal_entry_id = x.journal_entry_id, undone_at = null, undone_by = null, undone_by_name = null, undo_reason = null
     where id = x.match_id;
    update public.bank_movement set status = x.mov_status, confidence = x.mov_confidence, reason = x.mov_reason, proposal = x.mov_proposal, updated_at = now()
     where id = x.movement_id;
    insert into public.supplier_invoice_payment select * from jsonb_populate_recordset(null::public.supplier_invoice_payment, x.pagos)
      on conflict do nothing;
  end loop;
  update public.supplier_invoice set payment_entry_id = v_as1 where id = v_alb;
  perform set_config('request.jwt.claims', '', true);
  drop table public.conta_b01o_antes;
end $$;
