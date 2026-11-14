-- supabase/migrations/20261113T1905_dl1_justeat_restos.sql
--
-- DL1·29 · Just Eat: lo de antes de octubre que tiene documento (Julio, 13/11,
-- respuestas de las 19:00). Nada en el camino del pedido. Cifras de los 43
-- estados de cuenta de Just Eat de 2026 (16/06–31/10).
--   1. Las 8 facturas de comisión de junio a agosto de liquidaciones «de
--      referencia» (3972671, 3985628, 3994688, 3994650, 4019492, 4018942, 4040922
--      y 4060895): su asiento (de Diez) y su compensación (los «COMP» de Diez en
--      la 43000003) ya están. Se aprueban y se pagan por compensación fuera de
--      Sumied (_conta_comision_pagar), y dejan de estar en «en revisión».
--   2. Las 3 que Diez no compensó (3972691 y 4040338, 10,35 y 3,70; el abono
--      3994768, −5,98): su compensación con la 43000003, a 01/10 (los
--      trimestres de antes están presentados), con el periodo real.
--   3. Los 12 cargos GL que Just Eat descuenta en el estado de cuenta (11 de la
--      campaña de envío gratis JET+, 137,54; 2 de gestión de pedidos en
--      efectivo, 2,25), que Diez nunca apuntó: sin IVA, como gasto (62300003)
--      contra la 43000003, a 01/10, cada uno con su número y su liquidación.
-- Todo validado como Julio. Lo que no tiene documento (los pagos de Bendito
-- Burrito de Florencio Llorente que no llegaron al banco, y lo de antes del
-- 16/06) NO se toca.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_je constant uuid := '1fc25ef9-67d7-4b7d-b331-71f6379d131f';   -- Just Eat, su tercero
  r record; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int; v_lin jsonb := '[]'::jsonb; v_tot numeric := 0; v_lista text;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Just Eat restos: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;

  -- 1. Las 8 facturas: en revisión, con su asiento de Diez validado y su «COMP» en la 43000003.
  for r in select * from (values
      ('55eb23c1-c4d4-4b8d-9623-366ebf708042'::uuid, '3972671', 8.71),
      ('fd9b4099-7123-4666-9732-8c121f02dadd', '3985628', 3.03),
      ('3785d9ed-87e4-4402-a860-9d66fc0f3628', '3994688', 38.13),
      ('4b99c770-fec7-4d80-891e-9664a0c20a45', '3994650', -11.95),
      ('277f737d-4b21-4c23-8b00-99e68d938d9c', '4019492', 2.78),
      ('e1a1205c-74b2-4e0d-bcea-543f6d85292a', '4018942', 9.11),
      ('e7aac1aa-ed7f-4dca-9547-de9e590fc8fd', '4040922', 4.36),
      ('0b04ff45-c0aa-4716-b8e7-fda0e2093e1b', '4060895', 2.78)
    ) x(id, num, total) loop
    if not exists (select 1 from public.supplier_invoice s join public.journal_entry j on j.id = s.journal_entry_id
                    where s.id = r.id and s.account_id = v_acc and s.invoice_number = r.num and s.grand_total = r.total
                      and s.status = 'en_revision' and s.paid_at is null and j.status = 'validado')
       or not exists (select 1 from public.journal_line l join public.journal_entry j on j.id = l.entry_id join public.company_account a on a.id = l.company_account_id
                       where j.company_id = v_e and j.status = 'validado' and a.code = '43000003' and j.concept like 'COMP ' || r.num || '%') then
      raise exception 'DL1 Just Eat restos: la factura % no está como se midió (en revisión, con su asiento y su COMP): no se apunta nada.', r.num;
    end if;
    update public.supplier_invoice set status = 'aprobada', approved_at = now(), approved_by = null, approved_by_name = 'Julio (tanda DL1)', updated_at = now()
     where id = r.id;
    if not public._conta_comision_pagar(r.id, true) then
      raise exception 'DL1 Just Eat restos: la factura % no se ha podido pagar por compensación: no se apunta nada.', r.num;
    end if;
  end loop;

  -- 2. Las 3 sin compensar, a 01/10.
  if (select count(*) from public.supplier_invoice s join public.journal_entry j on j.id = s.journal_entry_id
       where s.account_id = v_acc and j.status = 'validado'
         and ((s.invoice_number = '3972691' and s.grand_total = 10.35) or (s.invoice_number = '4040338' and s.grand_total = 3.70)
              or (s.invoice_number = '3994768' and s.grand_total = -5.98))) <> 3
     or exists (select 1 from public.journal_entry j where j.company_id = v_e and j.status <> 'anulado'
                 and (j.concept like 'COMP 3972691%' or j.concept like 'COMP 4040338%' or j.concept like 'COMP 3994768%')) then
    raise exception 'DL1 Just Eat restos: las 3 facturas sin compensar no están como se midieron: no se apunta nada.';
  end if;
  v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 4,
    'Just Eat · compensación de las facturas 3972691 y 4040338 y del abono 3994768 (16/06–15/08/2026)',
    'DL1·29 (Julio, 13/11): Just Eat las descontó en sus estados de cuenta de junio a agosto, y Diez no apuntó su compensación. A 01/10 porque esos trimestres están presentados.',
    jsonb_build_array(
      jsonb_build_object('cuenta', '41000004', 'debe', 10.35, 'tercero', v_je, 'local', '92d7656e-082e-452a-8ebc-236b2d6ebf5f', 'concepto', 'Factura 3972691 (16–30/06), compensada'),
      jsonb_build_object('cuenta', '41000004', 'debe', 3.70, 'tercero', v_je, 'local', '92d7656e-082e-452a-8ebc-236b2d6ebf5f', 'concepto', 'Factura 4040338 (01–15/08), compensada'),
      jsonb_build_object('cuenta', '43000003', 'debe', 5.98, 'tercero', v_je, 'local', '92d7656e-082e-452a-8ebc-236b2d6ebf5f', 'concepto', 'Abono 3994768 (01–15/07), compensado'),
      jsonb_build_object('cuenta', '43000003', 'haber', 14.05, 'tercero', v_je, 'local', '92d7656e-082e-452a-8ebc-236b2d6ebf5f', 'concepto', 'Compensadas con sus facturas'),
      jsonb_build_object('cuenta', '41000004', 'haber', 5.98, 'tercero', v_je, 'local', '92d7656e-082e-452a-8ebc-236b2d6ebf5f', 'concepto', 'Compensado con su abono')));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 20.03);

  -- 3. Los 12 cargos GL, a 01/10, cada uno con su número.
  for r in select * from (values
      ('GL011070421', '3994650', '2026-07-15', 'campaña', 11.96, '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid),
      ('GL011070422', '3994685', '2026-07-15', 'campaña', 2.99, '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid),
      ('GL003078721', '3994688', '2026-07-15', 'gestión efectivo', 1.50, '629f9154-b888-48ed-9b8c-ffae77620615'::uuid),
      ('GL011070432', '3994688', '2026-07-15', 'campaña', 8.97, '629f9154-b888-48ed-9b8c-ffae77620615'::uuid),
      ('GL011070433', '3994749', '2026-07-15', 'campaña', 2.99, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('GL011070413', '3994768', '2026-07-15', 'campaña', 5.98, '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid),
      ('GL011070434', '3994819', '2026-07-15', 'campaña', 47.84, '629f9154-b888-48ed-9b8c-ffae77620615'::uuid),
      ('GL011070435', '3994893', '2026-07-15', 'campaña', 23.92, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('GL011070436', '3995007', '2026-07-15', 'campaña', 2.99, '629f9154-b888-48ed-9b8c-ffae77620615'::uuid),
      ('GL011070420', '3995710', '2026-07-15', 'campaña', 23.92, '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid),
      ('GL011070447', '3995780', '2026-07-15', 'campaña', 5.98, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('GL003122516', '4041108', '2026-08-15', 'gestión efectivo', 0.75, '38158159-cd71-4056-950b-53425afac1ce'::uuid)
    ) x(gl, liq, fecha, tipo, importe, loc) loop
    if exists (select 1 from public.journal_line l join public.journal_entry j on j.id = l.entry_id where j.company_id = v_e and j.status <> 'anulado' and (l.concept like '%' || r.gl || '%' or j.concept like '%' || r.gl || '%')) then
      raise exception 'DL1 Just Eat restos: el cargo % ya está apuntado: no se apunta nada.', r.gl;
    end if;
    v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '62300003', 'debe', r.importe, 'local', r.loc,
      'concepto', r.gl || ' · ' || case r.tipo when 'campaña' then 'campaña envío gratis JET+' else 'coste de gestión de pedidos en efectivo' end || ' · liquidación ' || r.liq || ' (' || to_char(r.fecha::date, 'DD/MM/YYYY') || ')'));
    v_tot := v_tot + r.importe;
  end loop;
  if v_tot <> 139.79 or jsonb_array_length(v_lin) <> 12 then raise exception 'DL1 Just Eat restos: los cargos GL suman % (%): se midieron 139,79 en 12.', v_tot, jsonb_array_length(v_lin); end if;
  v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '43000003', 'haber', v_tot, 'tercero', v_je, 'concepto', 'Cargos descontados por Just Eat en sus estados de cuenta'));
  v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 4,
    'Just Eat · 12 cargos GL de sus estados de cuenta, sin IVA (16/06–30/09/2026)',
    'DL1·29 (Julio, 13/11): Just Eat los descontó en sus estados de cuenta (campaña de envío gratis JET+ y coste de gestión de pedidos en efectivo) y Diez nunca los apuntó. Sin IVA: Just Eat no da factura de ellos. A 01/10 porque esos trimestres están presentados.',
    v_lin);
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', v_tot);

  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 Just Eat restos: 8 facturas pagadas por compensación y % asientos validados como Julio.', v_n;
end $$;
