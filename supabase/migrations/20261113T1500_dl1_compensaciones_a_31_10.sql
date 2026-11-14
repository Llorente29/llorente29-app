-- supabase/migrations/20261113T1500_dl1_compensaciones_a_31_10.sql
--
-- DL1 · Las compensaciones del 16–31/10 de Just Eat y de Glovo, a 31/10 (Julio,
-- DL1·24, respuesta del 13/11, punto 3). Nada en el camino del pedido.
--
-- La 0935 compensó 11 liquidaciones del 16–31/10 en la fecha de la liquidación
-- (Glovo 9 a 01/11, 1.402,45; Just Eat 2 a 07/11, 111,75), pero sus facturas de
-- comisión son de octubre. Cada compensación se anula en su fecha y se vuelve a
-- proponer igual, línea a línea, a 31/10 y enlazada a su liquidación, por el
-- camino de la aplicación (_journal_entry_proponer); se valida como Julio.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  r record; v_old record; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int; v_lineas jsonb; v_res jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 compensaciones a 31/10: sin la cuenta de Foodint, no hay nada que mover.';
    return;
  end if;

  for r in select * from (values
      ('9898413d-3e24-434c-a653-3e9c7f97239f'::uuid, 62.47),
      ('7c336ed5-3825-4177-b1a8-11068b16a7a7', 453.19),
      ('0a36579b-883e-4816-a188-12b78aa5f5ec', 27.68),
      ('509360e3-0116-45dc-a71d-2ec15ab08da2', 47.22),
      ('3476eeba-ee42-4bc4-ae1e-5bf5cecbbc3b', 30.86),
      ('514868a1-a61c-4dbb-a016-b968044b1aa2', 45.78),
      ('d6ecc55f-6bb5-4042-818e-3a7f1266d978', 227.35),
      ('80a20dfb-7c7d-4cf3-9db2-37369acc4b72', 490.95),
      ('6fa3dcae-ba1f-441d-a5cc-d1fb7c40c850', 16.95),
      ('3e1fa8d7-ec67-49c8-9209-0a94f58add16', 54.00),
      ('31c67dd0-d6c5-4975-a706-51ddc89a5050', 57.75)
    ) x(liq, importe) loop
    -- Una sola compensación viva, validada, de noviembre, de dos líneas por su importe; y su factura, de octubre.
    select e.* into v_old from public.journal_entry e
     where e.company_id = v_e and e.source_type = 'channel_settlement' and e.source_id = r.liq and e.status <> 'anulado';
    if v_old.id is null or v_old.status <> 'validado' or v_old.entry_date <= date '2026-10-31'
       or (select count(*) from public.journal_entry e where e.company_id = v_e and e.source_type = 'channel_settlement' and e.source_id = r.liq and e.status <> 'anulado') <> 1
       or (select count(*) from public.journal_line l where l.entry_id = v_old.id) <> 2
       or (select sum(l.debit) from public.journal_line l where l.entry_id = v_old.id) <> r.importe
       or not exists (select 1 from public.channel_settlement c join public.supplier_invoice s on s.id = c.commission_invoice_id
                       where c.id = r.liq and c.account_id = v_acc and s.grand_total = r.importe and s.invoice_date <= date '2026-10-31') then
      raise exception 'DL1 compensaciones a 31/10: la liquidación % no tiene una sola compensación validada de noviembre por % con su factura de octubre: no se mueve nada.', r.liq, r.importe;
    end if;
    select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'concepto', l.concept,
             'local_id', l.location_id, 'comun', l.is_common, 'marca_id', l.brand_id, 'tercero_id', l.party_id, 'documento', l.document_ref,
             'iva', null, 'retencion', null) order by l.position)
      into v_lineas
      from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_old.id;

    perform public._dl1_anular(v_e, v_julio, 'Julio', v_old.id, 'DL1·24: la compensación va a 31/10, con su factura de octubre.', v_old.entry_date);

    v_res := public._journal_entry_proponer(v_e,
      jsonb_build_object('series', v_old.series, 'fecha', '2026-10-31', 'concepto', v_old.concept, 'source_type', 'channel_settlement',
        'source_id', r.liq, 'confianza', 'seguro',
        'porque', 'DL1·24 (Julio, 13/11): la compensación de su factura de comisión de octubre, a 31/10 (antes, a ' || to_char(v_old.entry_date, 'DD/MM') || ').',
        'razones', coalesce(v_old.reasons, '[]'::jsonb), 'party_id', v_old.party_id, 'documento', v_old.document_ref),
      v_lineas, null, 'Julio (tanda DL1)', null);
    v_id := (v_res->>'id')::uuid;
    if v_id is null or coalesce((v_res->>'existente')::boolean, false)
       or (select entry_date from public.journal_entry where id = v_id) <> date '2026-10-31' then
      raise exception 'DL1 compensaciones a 31/10: la compensación de % no ha salido nueva a 31/10 (%): no se mueve nada.', r.liq, v_res;
    end if;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.importe);
  end loop;

  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 compensaciones a 31/10: % compensaciones movidas a 31/10 y validadas como Julio.', v_n;
end $$;
