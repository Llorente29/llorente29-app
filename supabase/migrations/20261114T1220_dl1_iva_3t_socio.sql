-- supabase/migrations/20261114T1220_dl1_iva_3t_socio.sql
--
-- DL1·28 (Julio, 13/11) · el IVA y la cuenta del socio, iguales que en Diez.
-- Nada en el camino del pedido.
--   1. El 4/3155 de Diez, que Sumied no tiene: una compra pagada por el socio
--      para la empresa. Debe 60000001 / Haber 55100001, 28,00, a 05/10.
--   2. La liquidación del IVA del 3T de 2026 por el camino de Sumied
--      (conta_impuesto_303_contabilizar, Impuestos › Trimestre), con las
--      casillas del 303 presentado, como la haría Julio en la pantalla. La
--      función decide la fecha (30/09, o el primer día abierto) y valida.
-- Los duplicados del 1T y el 2T (9/2 y 9/3) ya están anulados con el 9/5 y el
-- 9/6 (01/10): aquí no se tocan.
--
-- sin hueco: no retira ningún asiento ni resumen del día; solo añade dos asientos.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_3t constant uuid := '76943ee6-26b3-467a-8410-3733feb1e235';
  v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true);
  v_id uuid; v_n int; v_r jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 IVA 3T y socio: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  if exists (select 1 from public.journal_entry e where e.company_id = v_e and e.status <> 'anulado' and e.concept like '%(4/3155 de Diez)%') then
    raise exception 'DL1 IVA 3T y socio: el 4/3155 ya está: no se apunta nada.';
  end if;
  if not exists (select 1 from public.tax_return t where t.id = v_3t and t.company_id = v_e and t.form_code = '303'
                  and t.fiscal_year = 2026 and t.period = '3T' and t.status = 'filed' and t.liquidation_entry_id is null) then
    raise exception 'DL1 IVA 3T y socio: el 303 del 3T no está presentado y sin contabilizar: no se apunta nada.';
  end if;

  -- 1. El 4/3155.
  begin
    v_id := public._dl1_asiento_iva(v_e, date '2026-10-05', 4,
      'Compra diaria del socio: compras hechas por el socio para la empresa (4/3155 de Diez)',
      'DL1·28 (Julio, 13/11): el único asiento de Diez desde el 01/10 que no viene de Sumied; una compra de súper pagada por el socio.',
      jsonb_build_array(jsonb_build_object('cuenta', '60000001', 'debe', 28.00),
                        jsonb_build_object('cuenta', '55100001', 'haber', 28.00)));
    v_n := public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 28.00)));
  exception when others then raise exception using errcode = format('DS1%s', left(sqlstate, 2)), message = sqlerrm; end;

  -- 2. La liquidación del 3T, como si la contabilizara Julio en Impuestos › Trimestre.
  perform set_config('request.jwt.claims', json_build_object('sub', v_julio, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_julio::text || ':' || v_acc::text, true);
  begin
    v_r := public.conta_impuesto_303_contabilizar(v_3t);
  exception when others then raise exception using errcode = format('DT3%s', left(sqlstate, 2)), message = sqlerrm; end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  if not coalesce((v_r->>'ok')::boolean, false) or v_r->>'asiento' is null or coalesce((v_r->>'existente')::boolean, false) then
    raise exception using errcode = 'DT3XX', message = format('DL1 IVA 3T y socio: la liquidación del 3T no ha salido (%s).', v_r);
  end if;
  if (select status from public.journal_entry where id = (v_r->>'asiento')::uuid) <> 'validado' then
    raise exception using errcode = 'DT3VV', message = 'DL1 IVA 3T y socio: la liquidación del 3T no ha quedado validada.';
  end if;
  raise notice 'DL1 IVA 3T y socio: 4/3155 y %', v_r->>'mensaje';
end $$;
