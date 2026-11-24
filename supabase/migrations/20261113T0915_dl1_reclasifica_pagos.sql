-- supabase/migrations/20261113T0915_dl1_reclasifica_pagos.sql
--
-- DL1 · Tres pagos de octubre casados «sin justificante» que pagan facturas que
-- ya estaban en los libros (Julio, 13/11; lo vio B). Se repasaron los 23 de la
-- 1842: solo estos tienen, en su acreedor, una factura sin pagar a 30/09 del
-- mismo importe.
--   4/3398 · 01/10 · 10,94  · Iberdrola → factura 2/2553 (23/09), 41000023.
--   4/3406 · 07/10 · 378,96 · Iberdrola → factura 2/2554 (29/09), 41000023.
--   4/3409 · 13/10 · 29,99  · Masmovil  → la factura de Xfera que quedaba a 30/09, 41000011.
-- (Hubrise ×3 no: sus facturas de agosto y septiembre ya estaban pagadas; los
-- de octubre siguen sin justificante. Lo que coincide con «Riders» es casualidad
-- de importe, no del acreedor.)
--
-- Se reclasifican con un asiento con la fecha del pago: Debe el acreedor /
-- Haber el gasto, con el mismo local, sin IVA. El banco y su casado no se
-- tocan (deshacer el casado anularía con fecha de hoy y las 572 de octubre
-- llevarían el pago dos veces).
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  r record; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 reclasifica: sin la cuenta de Foodint, no hay nada que hacer.';
    return;
  end if;
  for r in select * from (values
      ('6d16fe46-a115-4e87-b92d-c832a74e48c4'::uuid, '4/3398', date '2026-10-01', 10.94, '62800000', '41000023', 'da5558e8-d6eb-4b81-aa23-58bf9c0109ba'::uuid,
       '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid, 'Iberdrola · factura 21260923010113265 (2/2553)'),
      ('04a5db15-abee-45d3-b45f-15931ff98bbe', '4/3406', date '2026-10-07', 378.96, '62800000', '41000023', 'da5558e8-d6eb-4b81-aa23-58bf9c0109ba',
       '92d7656e-082e-452a-8ebc-236b2d6ebf5f', 'Iberdrola · factura 21260929010123269 (2/2554)'),
      ('0969d6c2-51ac-40e0-8826-0c6d4dfa57bd', '4/3409', date '2026-10-13', 29.99, '62900000', '41000011', '64847e3e-121f-455c-b249-043c0f9564cb',
       '38158159-cd71-4056-950b-53425afac1ce', 'Xfera (Masmovil) · la factura que quedaba sin pagar a 30/09')
    ) x(id, n, fecha, importe, gasto, acreedor, tercero, local, que) loop
    if not exists (select 1 from public.journal_entry e where e.id = r.id and e.company_id = v_e and e.status = 'validado' and e.entry_date = r.fecha
                    and e.series || '/' || e.number = r.n)
       or (select count(*) from public.journal_line l join public.company_account a on a.id = l.company_account_id
            where l.entry_id = r.id and a.code = r.gasto and l.debit = r.importe and l.location_id = r.local) <> 1 then
      raise exception 'DL1 reclasifica: el % no está como se midió (validado, del %, % a la %): no se toca nada.', r.n, r.fecha, r.importe, r.gasto;
    end if;
    v_id := public._dl1_asiento_iva(v_e, r.fecha, 4, 'Reclasifica el pago ' || r.n || ': ' || r.que,
      'DL1 (Julio, 13/11): el pago se casó como gasto sin justificante y paga una factura que ya estaba en la cuenta del acreedor.',
      jsonb_build_array(jsonb_build_object('cuenta', r.acreedor, 'debe', r.importe, 'tercero', r.tercero, 'local', r.local),
                        jsonb_build_object('cuenta', r.gasto, 'haber', r.importe, 'local', r.local)));
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.importe);
  end loop;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 reclasifica: % pagos reclasificados contra su acreedor, validados como Julio.', v_n;
end $$;
