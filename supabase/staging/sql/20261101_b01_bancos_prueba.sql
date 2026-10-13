-- ============================================================================
-- PRUEBA (staging) · B01 · bancos y conciliación: las tablas y las funciones
-- (20261101T0100 y T0110). Todo en una transacción con ROLLBACK: no deja nada.
-- Fichero entero y como USUARIO (el administrador de A con su rol
-- «authenticated»), como pide el encargo. Datos inventados.
--
--   1. Cuentas: «¿De qué local es esta cuenta?» obligatoria; dos bancos nuevos
--      de A con su cuenta contable (Norte y Sur).
--   2. Importar: entra lo que cuadra; lo que no, no; el mismo fichero dos
--      veces no cambia nada; la continuidad con el anterior (sigue / hueco); el
--      IBAN de otro → «Revisa esta cuenta», sin corregir solo.
--   3. Casar a una cuenta: el asiento propuesto en la serie de tesorería; con
--      «validar solo lo seguro», validado y numerado en la 4.
--   4. Factura recibida: pagada por el banco (paid_at, payment_entry_id).
--   5. P2: el pago ya apuntado se ENLAZA: un pago por dos caminos = un asiento.
--   6. Liquidación: cobrada por el banco.
--   7. Traspaso entre dos cuentas propias: un asiento, dos movimientos casados.
--   8. Nada se casa dos veces.
--   9. Deshacer: la propuesta se quita; lo validado se anula con contraasiento;
--      la factura vuelve a «sin pagar».
--  10. Antes del corte: solo se enlaza.
--  11. Reglas: la de Folvy nace propuesta; todo cambio queda en su registro.
--  12. Posible repetido: el mismo movimiento por otro camino no entra como nuevo.
--  13. RLS: otra cuenta no ve nada ni puede casar.
-- ============================================================================

begin;

create temp table _b (que text primary key, id uuid) on commit drop;
grant all on _b to authenticated;

-- ── 0 · Siembra (como el dueño de la base): dos cuentas 572 en el plan de A, y
--        el pago de L-0412 ya apuntado a mano (propuesto), para el paso 5 ───
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_prev jsonb;
begin
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, keywords, kind, status, is_common, source, created_by_name)
  select account_id, company_id, plan, x.code, template_code, x.name, x.name, keywords, kind, status, is_common, source, 'prueba B01'
    from public.company_account, (values ('57200902', 'Bancos · Cuenta Norte (prueba B)'), ('57200903', 'Bancos · Cuenta Sur (prueba B)')) as x(code, name)
   where company_id = emp and code = '57200001';
  if (select count(*) from public.company_account where company_id = emp and code in ('57200902', '57200903')) <> 2 then
    raise exception 'PRUEBA B01 · 0: no se sembraron las dos cuentas 572.';
  end if;
  v_prev := public._journal_entry_proponer(emp, jsonb_build_object('fecha', '2026-10-08', 'series', 3, 'concepto', 'Pago a Panadería · L-0412',
              'source_type', 'supplier_payment', 'source_id', 'c1b0a000-0000-4000-8000-000000000511', 'confianza', 'probable',
              'porque', 'La factura está marcada como pagada'),
            '[{"cuenta":"40000004","debe":87.40,"haber":0,"comun":true},{"cuenta":"57200902","debe":0,"haber":87.40,"comun":true}]', '{}', 'prueba B01', null);
  insert into _b values ('pago511', (v_prev->>'id')::uuid);
  raise notice '0 · sembradas 57200902 y 57200903 en el plan de A, y el pago de L-0412 apuntado (propuesto)';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 1 · Cuentas ─────────────────────────────────────────────────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v uuid; v_ok boolean := false;
begin
  begin
    perform public.bank_cuenta_alta(emp, 'bank', 'Cuenta Norte', 'ES7601829001020000000017', '57200902', null, false);
  exception when others then v_ok := sqlerrm like '%¿De qué local es esta cuenta?%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 · 1: dio de alta sin preguntar de qué local es.'; end if;
  v_ok := false;
  begin
    perform public.bank_cuenta_alta(emp, 'bank', 'Sin IBAN', null, null, null, true);
  exception when others then v_ok := sqlerrm like '%necesita su IBAN%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 · 1: un banco sin IBAN entró.'; end if;
  v := public.bank_cuenta_alta(emp, 'bank', 'Cuenta Norte', 'ES7601829001020000000017', '57200902', null, true);
  insert into _b values ('norte', v);
  v := public.bank_cuenta_alta(emp, 'bank', 'Cuenta Sur', 'ES5001829002010000000025', '57200903', 'c01a0000-0000-4000-8000-0000000000a2', false);
  insert into _b values ('sur', v);
  if (select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
       where l.entity = 'bank_account' and l.entity_id = (select id from _b where que = 'norte')::text) is distinct from '57200902' then
    raise exception 'PRUEBA B01 · 1: la cuenta Norte no quedó enlazada a 57200902.';
  end if;
  if exists (select 1 from public.bank_cuentas_por_dar_de_alta(emp) where code in ('57200902', '57200903')) then
    raise exception 'PRUEBA B01 · 1: una 572 con banco sigue «por dar de alta».';
  end if;
  raise notice '1 · alta con la pregunta del local (común / Norte Centro), sin IBAN no, y enlazadas a su 572';
end $$;

-- ── 2 · Importar ────────────────────────────────────────────────────────────
do $$
declare
  norte uuid := (select id from _b where que = 'norte'); sur uuid := (select id from _b where que = 'sur');
  v_r jsonb; v_ok boolean := false;
  movs constant jsonb := '[
    {"fecha":"2026-10-06","importe":-12.50,"concepto_banco":"COMISION MANTENIMIENTO","concepto_limpio":"Comision mantenimiento","comun":"17","huella":"n1","huella_suave":"s1"},
    {"fecha":"2026-10-07","importe":-152.30,"concepto_banco":"RECIBO PANADERIA","concepto_limpio":"Recibo PANADERIA","comun":"03","huella":"n2","huella_suave":"s2"},
    {"fecha":"2026-10-08","importe":-87.40,"concepto_banco":"TRANSFERENCIA A PANADERIA","concepto_limpio":"Transferencia a PANADERIA","comun":"04","huella":"n3","huella_suave":"s3"},
    {"fecha":"2026-10-09","importe":8693.20,"concepto_banco":"TRANSFERENCIA DE PLATAFORMA NORTE","concepto_limpio":"Transferencia de PLATAFORMA NORTE","comun":"04","huella":"n4","huella_suave":"s4"},
    {"fecha":"2026-10-11","importe":-2000.00,"concepto_banco":"TRASPASO A CUENTA SUR","concepto_limpio":"Traspaso a cuenta SUR","comun":"04","huella":"n5","huella_suave":"s5"},
    {"fecha":"2026-10-12","importe":-3.10,"concepto_banco":"COMISION TRANSFERENCIA","concepto_limpio":"Comision transferencia","comun":"17","huella":"n6","huella_suave":"s6"}
  ]';
begin
  -- No cuadra → no entra, y dice las cifras.
  begin
    perform public.bank_importar(norte, 'fichero', 'norma43', 'mal.n43', repeat('a', 64), '2026-10-01', '2026-10-13', 10000, 10000, null, null, movs);
  exception when others then v_ok := sqlerrm like 'No cuadra: saldo inicial%';
  end;
  if not v_ok or exists (select 1 from public.bank_statement where treasury_account_id = norte) then
    raise exception 'PRUEBA B01 · 2: entró un extracto que no cuadra.';
  end if;
  v_r := public.bank_importar(norte, 'fichero', 'norma43', 'norte.n43', repeat('b', 64), '2026-10-01', '2026-10-13', 10000, 16434.80, null,
                              'ES9900000000000000000000', movs);
  if (v_r->>'nuevos')::int <> 6 or (v_r->>'repetidos')::int <> 0 or v_r->>'continuidad' <> 'primero' then
    raise exception 'PRUEBA B01 · 2: importación: %', v_r;
  end if;
  -- El mismo fichero: no cambia nada y lo dice.
  v_r := public.bank_importar(norte, 'fichero', 'norma43', 'norte.n43', repeat('b', 64), '2026-10-01', '2026-10-13', 10000, 16434.80, null, null, movs);
  if not (v_r->>'repetido')::boolean or v_r->>'mensaje' not like 'Este fichero ya se subió el %' then raise exception 'PRUEBA B01 · 2: el mismo fichero dos veces: %', v_r; end if;
  -- Otro fichero que se solapa (los mismos movimientos): todos repetidos.
  v_r := public.bank_importar(norte, 'fichero', 'norma43', 'otra-vez.n43', repeat('c', 64), '2026-10-01', '2026-10-13', 10000, 16434.80, null, null, movs);
  if (v_r->>'nuevos')::int <> 0 or (v_r->>'repetidos')::int <> 6 then raise exception 'PRUEBA B01 · 2: solapado: %', v_r; end if;
  if (select count(*) from public.bank_movement where treasury_account_id = norte) <> 6 then raise exception 'PRUEBA B01 · 2: hay movimientos dos veces.'; end if;
  -- Continuidad: el siguiente empieza donde acabó (sigue) o no (hueco, con cuánto).
  v_r := public.bank_importar(norte, 'fichero', 'norma43', 'n-sigue.n43', repeat('d', 64), '2026-10-14', '2026-10-14', 16434.80, 16434.80, null, null, '[]');
  if v_r->>'continuidad' <> 'sigue' then raise exception 'PRUEBA B01 · 2: continuidad «sigue»: %', v_r; end if;
  v_r := public.bank_importar(norte, 'fichero', 'norma43', 'n-hueco.n43', repeat('e', 64), '2026-10-16', '2026-10-16', 16400.00, 16400.00, null, null, '[]');
  if v_r->>'continuidad' <> 'hueco' or (v_r->>'hueco')::numeric <> -34.80 then raise exception 'PRUEBA B01 · 2: continuidad «hueco»: %', v_r; end if;
  -- P1: el IBAN del fichero no era el de la cuenta → revisión propuesta, IBAN sin tocar.
  if (select iban from public.treasury_account where id = norte) <> 'ES7601829001020000000017'
     or (select iban_review->>'iban_propuesto' from public.treasury_account where id = norte) <> 'ES9900000000000000000000' then
    raise exception 'PRUEBA B01 · 2: el IBAN se corrigió solo o no se propuso la revisión.';
  end if;
  -- Sur: el otro lado del traspaso. Un Excel sin saldos tiene que decir por qué no se comprobó.
  v_ok := false;
  begin
    perform public.bank_importar(sur, 'fichero', 'csv:bbva', 'sur.xlsx', repeat('f', 64), '2026-10-11', '2026-10-11', null, null, null, null,
      '[{"fecha":"2026-10-11","importe":2000.00,"concepto_banco":"TRASPASO DE CUENTA NORTE","huella":"s1","huella_suave":"t1"}]');
  exception when others then v_ok := sqlerrm like 'Un extracto sin saldos tiene que decir por qué%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 · 2: un extracto sin saldos entró sin decir por qué.'; end if;
  v_r := public.bank_importar(sur, 'fichero', 'csv:bbva', 'sur.xlsx', repeat('f', 64), '2026-10-11', '2026-10-11', null, null,
    'El fichero no trae saldos.', null, '[{"fecha":"2026-10-11","importe":2000.00,"concepto_banco":"TRASPASO DE CUENTA NORTE","huella":"s1","huella_suave":"t1"}]');
  if v_r->>'continuidad' <> 'sin_saldo' then raise exception 'PRUEBA B01 · 2: Excel sin saldos: %', v_r; end if;
  raise notice '2 · cuadre, mismo fichero, solapado, continuidad (sigue y hueco de −34,80), IBAN a revisar sin tocar, Excel sin saldos dicho';
end $$;

-- ── 3 · Casar a una cuenta: propuesto en la serie de tesorería; seguro validado ──
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; norte uuid := (select id from _b where que = 'norte');
  m1 uuid; m6 uuid; v_r jsonb; v_e public.journal_entry;
begin
  select id into m1 from public.bank_movement where treasury_account_id = norte and fingerprint = 'n1';
  select id into m6 from public.bank_movement where treasury_account_id = norte and fingerprint = 'n6';
  v_r := public.bank_casar(m1, '{"tipo":"cuenta","lineas":[{"cuenta":"62600000","importe":12.50}]}', 'seguro',
                           'Comisión del banco: el concepto común 17 es «intereses, comisiones»', '[]', 'folvy', null);
  select * into v_e from public.journal_entry where id = (v_r->>'asiento')::uuid;
  if v_e.status <> 'propuesto' or v_e.series <> 3 or v_e.source_type <> 'bank' or v_e.source_id <> m1 or (v_r->>'validado')::boolean then
    raise exception 'PRUEBA B01 · 3: el asiento no es una propuesta de la serie 3 del banco: % %', v_e.status, v_e.series;
  end if;
  if (select string_agg(ca.code || ':' || jl.debit || '/' || jl.credit, ' ' order by jl.position) from public.journal_line jl
        join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = v_e.id) <> '57200902:0.00/12.50 62600000:12.50/0.00' then
    raise exception 'PRUEBA B01 · 3: las líneas no son 572 al haber y 626 al debe.';
  end if;
  insert into _b values ('m1', m1), ('e1', v_e.id);
  -- La empresa elige serie 4 y validar solo lo seguro.
  perform public.bank_ajustes_guardar(emp, 4::smallint, true, null);
  v_r := public.bank_casar(m6, '{"tipo":"cuenta","lineas":[{"cuenta":"62600000","importe":3.10}]}', 'seguro', 'Comisión del banco', '[]', 'folvy', null);
  select * into v_e from public.journal_entry where id = (v_r->>'asiento')::uuid;
  if v_e.status <> 'validado' or v_e.series <> 4 or v_e.number is null or v_e.hash is null then
    raise exception 'PRUEBA B01 · 3: lo seguro con «validar solo lo seguro» no quedó validado en la 4: % % % (%)', v_e.status, v_e.series, v_e.number, v_r->>'aviso';
  end if;
  insert into _b values ('m6', m6), ('e6', v_e.id);
  if (select count(*) from public.bank_activity_log where movement_id in (m1, m6)) <> 3 then
    raise exception 'PRUEBA B01 · 3: «Lo que ha hecho Folvy» no tiene los tres apuntes (casado, casado, validado).';
  end if;
  raise notice '3 · propuesto en la serie 3 (572 haber / 626 debe); con el ajuste, validado en la 4 con número y huella; registrado';
end $$;

-- ── 4 y 5 · Facturas: pagada por el banco; y la ya apuntada se enlaza (P2) ──
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; norte uuid := (select id from _b where que = 'norte');
  f513 constant uuid := 'c1b0a000-0000-4000-8000-000000000513'; f511 constant uuid := 'c1b0a000-0000-4000-8000-000000000511';
  m2 uuid; m3 uuid; v_r jsonb; v_prev jsonb; v_inv public.supplier_invoice; n_antes int;
begin
  select id into m2 from public.bank_movement where treasury_account_id = norte and fingerprint = 'n2';
  select id into m3 from public.bank_movement where treasury_account_id = norte and fingerprint = 'n3';
  v_r := public.bank_casar(m2, jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', f513, 'importe', 152.30)),
                           'cuenta_tercero', '40000004', 'metodo', 'domiciliacion'), 'probable', 'Mismo importe y proveedor que la factura L-0431', '[]', 'persona', null);
  select * into v_inv from public.supplier_invoice where id = f513;
  if v_inv.paid_at <> '2026-10-07' or v_inv.payment_entry_id <> (v_r->>'asiento')::uuid or v_inv.paid_by_name <> 'Folvy · banco' then
    raise exception 'PRUEBA B01 · 4: la factura no quedó pagada por el banco: % %', v_inv.paid_at, v_inv.payment_entry_id;
  end if;
  insert into _b values ('m2', m2), ('e2', (v_r->>'asiento')::uuid);
  -- P2: el pago de L-0412 ya estaba apuntado (propuesto, paso 0). El banco lo enlaza, no crea otro.
  v_prev := jsonb_build_object('id', (select id from _b where que = 'pago511'));
  select count(*) into n_antes from public.journal_entry where company_id = emp;
  v_r := public.bank_casar(m3, jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', f511, 'importe', 87.40)),
                           'cuenta_tercero', '40000004'), 'probable', 'Mismo importe que L-0412', '[]', 'persona', null);
  if (v_r->>'creado')::boolean or (v_r->>'asiento')::uuid <> (v_prev->>'id')::uuid
     or (select count(*) from public.journal_entry where company_id = emp) <> n_antes then
    raise exception 'PRUEBA B01 · 5: el pago ya apuntado no se enlazó (o se creó otro asiento): %', v_r;
  end if;
  raise notice '4 · L-0431 pagada por el banco el 07/10 con su asiento · 5 · L-0412: el pago ya apuntado se enlaza; asientos antes % = después %', n_antes, n_antes;
end $$;

-- ── 6 · Liquidación cobrada; 7 · traspaso; 8 · nada dos veces ───────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; norte uuid := (select id from _b where que = 'norte'); sur uuid := (select id from _b where que = 'sur');
  cs constant uuid := 'c0300000-0000-4000-8000-000000000104'; m4 uuid; m5 uuid; ms uuid; v_r jsonb; v_ok boolean := false;
begin
  select id into m4 from public.bank_movement where treasury_account_id = norte and fingerprint = 'n4';
  select id into m5 from public.bank_movement where treasury_account_id = norte and fingerprint = 'n5';
  select id into ms from public.bank_movement where treasury_account_id = sur;
  v_r := public.bank_casar(m4, jsonb_build_object('tipo', 'liquidacion', 'liquidacion_id', cs, 'cuenta_cliente', '43000001'), 'seguro',
                           'Cuadra con su liquidación: neto 8.693,20', '[]', 'folvy', null);
  if (select collected_on from public.channel_settlement where id = cs) <> '2026-10-09' or (select collected_amount from public.channel_settlement where id = cs) <> 8693.20 then
    raise exception 'PRUEBA B01 · 6: la liquidación no quedó cobrada.';
  end if;
  v_r := public.bank_casar(m5, jsonb_build_object('tipo', 'traspaso', 'otro_movimiento_id', ms), 'seguro', 'Sale de Norte y entra en Sur el mismo día', '[]', 'folvy', null);
  if (select count(*) from public.bank_match where journal_entry_id = (v_r->>'asiento')::uuid and status = 'vivo') <> 2
     or (select status from public.bank_movement where id = ms) <> 'casado'
     or (select string_agg(ca.code || ':' || jl.debit || '/' || jl.credit, ' ' order by jl.position) from public.journal_line jl
           join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = (v_r->>'asiento')::uuid) <> '57200902:0.00/2000.00 57200903:2000.00/0.00' then
    raise exception 'PRUEBA B01 · 7: el traspaso no es un asiento con los dos movimientos casados.';
  end if;
  insert into _b values ('e5', (v_r->>'asiento')::uuid), ('m5', m5);
  begin
    perform public.bank_casar(m4, '{"tipo":"cuenta","lineas":[{"cuenta":"43000001","importe":8693.20}]}', 'probable', 'otra vez', '[]', 'persona', null);
  exception when unique_violation then v_ok := sqlerrm like 'Este movimiento ya está casado%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 · 8: un movimiento se casó dos veces.'; end if;
  raise notice '6 · liquidación cobrada el 09/10 · 7 · traspaso: un asiento 572/572, los dos casados · 8 · el segundo casado, rechazado';
end $$;

-- ── 9 · Deshacer ────────────────────────────────────────────────────────────
do $$
declare
  m1 uuid := (select id from _b where que = 'm1'); e1 uuid := (select id from _b where que = 'e1');
  e6 uuid := (select id from _b where que = 'e6'); m2 uuid := (select id from _b where que = 'm2');
  v_r jsonb;
begin
  v_r := public.bank_deshacer((select id from public.bank_match where movement_id = m1 and status = 'vivo'), 'No era una comisión');
  if exists (select 1 from public.journal_entry where id = e1) or (select status from public.bank_movement where id = m1) <> 'pendiente' then
    raise exception 'PRUEBA B01 · 9: deshacer no quitó la propuesta o no devolvió el movimiento.';
  end if;
  v_r := public.bank_deshacer((select id from public.bank_match where journal_entry_id = e6 and status = 'vivo'), 'Prueba de anular');
  if (select status from public.journal_entry where id = e6) <> 'anulado'
     or not exists (select 1 from public.journal_entry where reverses_entry_id = e6) then
    raise exception 'PRUEBA B01 · 9: lo validado no se anuló con su contraasiento.';
  end if;
  v_r := public.bank_deshacer((select id from public.bank_match where movement_id = m2 and status = 'vivo'), 'Era otra factura');
  if (select paid_at from public.supplier_invoice where id = 'c1b0a000-0000-4000-8000-000000000513') is not null then
    raise exception 'PRUEBA B01 · 9: la factura sigue pagada tras deshacer.';
  end if;
  if (select count(*) from public.bank_match where status = 'deshecho' and undo_reason is not null and movement_id in (m1, m2)) <> 2 then
    raise exception 'PRUEBA B01 · 9: el casado deshecho no queda con su porqué.';
  end if;
  raise notice '9 · propuesta quitada; validado anulado con contraasiento; factura sin pagar otra vez; los deshechos se quedan con su porqué';
end $$;

-- ── 10 · Antes del corte; 11 · reglas; 12 · posible repetido ────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; norte uuid := (select id from _b where que = 'norte');
  v_r jsonb; v_m uuid; v_ok boolean := false; v_regla uuid;
begin
  perform public.bank_ajustes_guardar(emp, 4::smallint, false, '2026-10-20');
  v_r := public.bank_importar(norte, 'fichero', 'norma43', 'antes.n43', repeat('9', 64), '2026-10-17', '2026-10-17', 16400.00, 16390.00, null, null,
    '[{"fecha":"2026-10-17","importe":-10.00,"concepto_banco":"RECIBO","huella":"a1","huella_suave":"sa1"}]');
  select id into v_m from public.bank_movement where treasury_account_id = norte and fingerprint = 'a1';
  if not (select before_cutover from public.bank_movement where id = v_m) then raise exception 'PRUEBA B01 · 10: no se marcó «antes del corte».'; end if;
  begin
    perform public.bank_casar(v_m, '{"tipo":"cuenta","lineas":[{"cuenta":"62800000","importe":10.00}]}', 'probable', 'x', '[]', 'persona', null);
  exception when others then v_ok := sqlerrm like '%antes de la fecha de corte%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 · 10: antes del corte se creó un asiento.'; end if;
  perform public.bank_proponer(v_m, 'antes_corte_sin_pareja', 'duda', 'Antes del corte · sin pareja en el libro', null);

  v_ok := false;
  begin
    perform public.bank_regla_guardar(emp, null, 'Cuando el concepto tenga «PANADERIA» → Panadería Luna', '{"contiene":"PANADERIA"}',
                                      '{"cuenta":"40000004"}', 'folvy', 'activa');
  exception when others then v_ok := sqlerrm like '%nace «propuesta»%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 · 11: una regla de Folvy nació activa.'; end if;
  v_regla := public.bank_regla_guardar(emp, null, 'Cuando el concepto tenga «PANADERIA» → Panadería Luna', '{"contiene":"PANADERIA"}',
                                       '{"cuenta":"40000004"}', 'folvy', 'propuesta');
  perform public.bank_regla_estado(v_regla, 'activa');
  perform public.bank_regla_confirmada(v_regla);
  perform public.bank_regla_estado(v_regla, 'apagada');
  if (select string_agg(action, ',' order by created_at) from public.bank_rule_log where rule_id = v_regla) <> 'propuesta,aceptada,usada,apagada' then
    raise exception 'PRUEBA B01 · 11: el registro de la regla no tiene todo: %', (select string_agg(action, ',' order by created_at) from public.bank_rule_log where rule_id = v_regla);
  end if;

  -- 12: el mismo día, importe y orden que n6, sin sus referencias → posible repetido, no nuevo.
  v_r := public.bank_importar(norte, 'fichero', 'csv:bbva', 'otro-camino.xlsx', repeat('8', 64), '2026-10-12', '2026-10-12', null, null,
    'Excel sin saldos', null, '[{"fecha":"2026-10-12","importe":-3.10,"concepto_banco":"Comisión","huella":"otra","huella_suave":"s6"}]');
  if (v_r->>'posibles_repetidos')::int <> 1 then raise exception 'PRUEBA B01 · 12: no se cazó el posible repetido: %', v_r; end if;
  select id into v_m from public.bank_movement where treasury_account_id = norte and fingerprint = 'otra';
  v_ok := false;
  begin perform public.bank_casar(v_m, '{"tipo":"cuenta","lineas":[{"cuenta":"62600000","importe":3.10}]}', 'probable', 'x', '[]', 'persona', null);
  exception when others then v_ok := sqlerrm like 'Primero di si es el mismo%'; end;
  if not v_ok then raise exception 'PRUEBA B01 · 12: un posible repetido se pudo casar sin decidir.'; end if;
  perform public.bank_repetido_resolver(v_m, true);
  if (select status from public.bank_movement where id = v_m) <> 'ignorado' then raise exception 'PRUEBA B01 · 12: «es el mismo» no lo ignoró.'; end if;
  raise notice '10 · antes del corte: solo enlazar · 11 · regla de Folvy propuesta→aceptada→usada→apagada, todo registrado · 12 · posible repetido decidido';
end $$;
reset role;

-- ── 13 · RLS: la cuenta de B no ve nada de A y no puede casar ──────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false; m uuid := (select id from _b where que = 'm1');
begin
  if (select count(*) from public.bank_movement) + (select count(*) from public.bank_statement) + (select count(*) from public.bank_match)
     + (select count(*) from public.bank_activity_log) + (select count(*) from public.bank_rule) + (select count(*) from public.bank_settings) <> 0 then
    raise exception 'PRUEBA B01 · 13: B ve filas de bancos de A.';
  end if;
  begin
    perform public.bank_casar(m, '{"tipo":"cuenta","lineas":[{"cuenta":"62600000","importe":12.50}]}', 'probable', 'x', '[]', 'persona', null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA B01 · 13: B pudo casar un movimiento de A.'; end if;
  raise notice '13 · B no ve ni una fila de A y no puede casar (42501)';
end $$;
reset role;

do $$ begin raise notice 'PRUEBA B01 · bancos en verde: 13 de 13.'; end $$;
rollback;
