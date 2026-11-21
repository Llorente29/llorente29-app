-- supabase/migrations/20261112T1842_dl1_octubre_bancos.sql
--
-- DL1 · Cerrar octubre de Llorente29: cuatro correcciones y los 33 movimientos
-- del banco sin casar (Julio, DL1·17 y DL1·18, 12/11). Todo como Julio y por el
-- camino de la aplicación: bank_casar para casar (como «Apuntar sin factura»
-- o el pago de una factura) y journal_entry_validar para validar
-- (_dl1_validar). Nada toca un IVA presentado: lo que va en el 1T–3T (por
-- fecha) no cambia.
--
-- A · Tres de las cuatro correcciones (aprobadas por Julio; la gestoría las
--     revisa). La 1.6 (las liquidaciones del IVA duplicadas en la serie 9) se
--     queda fuera (Julio, 12/11): su contraasiento lleva 472 y 477 sin tipo ni
--     libro registro, como las trajo Diez, y la regla 5 de la validación no lo
--     admite; borrarlas tampoco se puede (antes del corte, cadena de huellas).
--   2.1  Caja: 3.998,88 de años anteriores. 01/01: Debe 113 / Haber 570.
--   4.9  Banco ···4525: 290,00 de más en la apertura. 01/01: Debe 113 / Haber
--        57200002; empieza 2026 en 1.607,10.
--   4.11 «Glovo Ventas» (43000101), −884,74 de 2024. 01/01: Debe 43000101 /
--        Haber 43000001; la 43000101 queda a 0.
--
-- B · Los 33 movimientos de octubre, cada uno con su destino (ver la lista):
--     facturas (AMIRSA, Orange, Europastry), cuenta (la comisión, Glovo, el
--     socio, los de la empresa, Supabase y Nobleza) y, sin justificante y sin
--     IVA, los gastos sin factura ni ticket. El local, el de la cuenta del banco.
--     Europastry: el pago del 15/10 (175,47) paga la 24056932 (175,46) y el
--     céntimo que sobra va a la 24093211; el del 28/10 (221,73) paga el resto de
--     la 24093211 (221,74). Las dos quedan pagadas, sin resto ni redondeo.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento, y un casado se deshace en Bancos.

create or replace function public._dl1_casar(p_company uuid, p_actor uuid, p_nombre text, p_movimiento uuid, p_destino jsonb, p_porque text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true); v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1 casar: esa empresa no está.'; end if;
  if not exists (select 1 from public.bank_movement where id = p_movimiento and company_id = p_company and account_id = v_acc) then
    raise exception 'DL1 casar: el movimiento % no es de la empresa.', p_movimiento;
  end if;
  -- Como si lo casara la persona en Bancos: su usuario y su cuenta activa, solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  v_r := public.bank_casar(p_movimiento, p_destino, 'seguro', p_porque, '[]'::jsonb, 'persona', null);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return v_r;
end $$;
revoke all on function public._dl1_casar(uuid, uuid, text, uuid, jsonb, text) from public, anon, authenticated, service_role;
comment on function public._dl1_casar(uuid, uuid, text, uuid, jsonb, text) is
  'DL1. Casa un movimiento del banco con bank_casar, como una persona de la cuenta (por «persona», confianza segura). Solo una tanda.';


-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_glovo constant uuid := '720afecb-a89b-4ca9-a249-f11dcb451c38';   -- GLOVOAPP SPAIN PLATFORM (Contactos)
  v_porque constant text := 'DL1 (Julio, 12/11): octubre de Llorente29, movimiento a movimiento.';
  v_sin constant text := 'DL1 (Julio, 12/11): gasto sin justificante y sin IVA; cuando llegue el documento se corrige en el 4T.';
  r record; v_res jsonb; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int; v_st text;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 octubre: sin la cuenta de Foodint, no hay nada que hacer.';
    return;
  end if;
  -- A · 2.1, 4.9 y 4.11: a 01/01, sin IVA.
  for r in select * from (values
      ('Caja: saldo de años anteriores a reservas (incidencia 2.1)', '11300000', '57000000', 3998.88, null::uuid),
      ('Banco ···4525: 290,00 de más en la apertura, a reservas (incidencia 4.9)', '11300000', '57200002', 290.00, null::uuid),
      ('«Glovo Ventas» (43000101), apuntes de 2024, a la cuenta de Glovo (incidencia 4.11)', '43000101', '43000001', 884.74, v_glovo)
    ) x(concepto, debe, haber, importe, tercero) loop
    v_id := public._dl1_asiento_iva(v_e, date '2026-01-01', 4, r.concepto,
      'DL1 (Julio, 12/11): corrección aprobada por Julio; la revisa la gestoría.',
      jsonb_build_array(jsonb_build_object('cuenta', r.debe, 'debe', r.importe),
                        jsonb_build_object('cuenta', r.haber, 'haber', r.importe, 'tercero', r.tercero)));
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.importe);
  end loop;

  -- B · Los 33 movimientos. destino: el de bank_casar, como en Bancos.
  for r in select * from (values
    -- Facturas
    ('44c2be91-d919-413e-9b22-2169097a0e39'::uuid, -191.00, '{"tipo":"factura_recibida","metodo":"transfer","concepto":"Pago a AMIRSA HOSTELERIA, S.L. · 2026/17791","facturas":[{"id":"35d478e6-5f6e-4cb4-949b-6fc830dbeb56","importe":191}],"tercero_id":"2fb40a5a-b684-49c8-bb0a-49a3cf9448db","cuenta_tercero":"40000010"}'::jsonb),
    ('23b55819-3caa-43de-8702-77d3f3930e18', -34.95, '{"tipo":"factura_recibida","metodo":"transfer","concepto":"Pago a Orange (Jazztel) · S11/0177416578","facturas":[{"id":"9a87fa22-fbc7-471b-bf1d-a88c856259ea","importe":34.95}],"tercero_id":"605325fe-d0be-42e1-b37d-11fbcd4bc2be","cuenta_tercero":"41000043"}'),
    ('456cb1a0-e467-4825-a45d-c2a1f835c0ac', -175.47, '{"tipo":"factura_recibida","metodo":"transfer","concepto":"Pago a EUROPASTRY, S.A. · 24056932 (y 0,01 de la 24093211)","facturas":[{"id":"70be91a4-44e4-4944-9fcf-a91a1ca051bc","importe":175.46},{"id":"524d1208-4f77-4035-aa7a-a001d2461b9d","importe":0.01}],"tercero_id":"8159013c-21b8-4e54-8573-32f9c7a80148","cuenta_tercero":"40000006"}'),
    ('c0a07b7d-f93c-41c1-87a9-0c2bb07846ae', -221.73, '{"tipo":"factura_recibida","metodo":"transfer","concepto":"Pago a EUROPASTRY, S.A. · 24093211 (el resto)","facturas":[{"id":"524d1208-4f77-4035-aa7a-a001d2461b9d","importe":221.73}],"tercero_id":"8159013c-21b8-4e54-8573-32f9c7a80148","cuenta_tercero":"40000006"}'),
    -- A una cuenta
    ('db2cdfa2-45d4-43e3-bdcf-5b306113db24', -12.00, '{"tipo":"cuenta","concepto":"Comisión del banco · liquidación de intereses, comisiones y gastos","lineas":[{"cuenta":"62600000","importe":12}]}'),
    ('fb279cdc-e0bd-47fa-ab57-ea161e5ec814', -1174.18, '{"tipo":"cuenta","concepto":"Pago a Nobleza Vacuna de las facturas 238-2026 (985,25) y 239-2026 (188,93), de septiembre","tercero_id":"54d443b6-6e40-4041-b188-0e0b171c3627","lineas":[{"cuenta":"40000011","importe":1174.18}]}'),
    ('526f19b1-d459-4fca-b6dd-1b9320930e41', 310.77, '{"tipo":"cuenta","concepto":"Cobro de Glovo · su liquidación, pendiente","tercero_id":"720afecb-a89b-4ca9-a249-f11dcb451c38","lineas":[{"cuenta":"43000001","importe":310.77}]}'),
    ('5fe019a3-c17c-4b0d-854e-aaae9cef2cbf', -500.00, '{"tipo":"cuenta","concepto":"Devolución parcial de un préstamo del socio a la empresa","lineas":[{"cuenta":"55100001","importe":500}]}'),
    ('9402aaac-4c75-4ff6-99f2-5593d4e30fb2', -8.00, '{"tipo":"cuenta","concepto":"OpenAI · programa de la empresa, sin factura","lineas":[{"cuenta":"62900005","importe":8}]}'),
    ('1c76cf38-22ff-4172-b5ae-0d2561c1af72', 1.78, '{"tipo":"cuenta","concepto":"Devolución de Uber Eats · de la empresa","lineas":[{"cuenta":"60000001","importe":1.78}]}'),
    ('23502ada-69e9-4585-8999-b70668af78bc', -9.24, '{"tipo":"cuenta","concepto":"Anthropic · programa comprado fuera, comisión del banco dentro","lineas":[{"cuenta":"62900005","importe":9.24}]}'),
    ('f6e9582f-ec51-4d7a-85cf-1e2b41a23901', -11.30, '{"tipo":"cuenta","concepto":"Anthropic · programa comprado fuera, comisión del banco dentro","lineas":[{"cuenta":"62900005","importe":11.3}]}'),
    ('b218f0d1-b015-40dc-b558-981033593f2c', -32.29, '{"tipo":"cuenta","concepto":"Supabase · programa comprado fuera, comisión del banco dentro; pendiente de su factura","tercero_id":"bc36a66c-d61f-4e9d-a5bd-051b9eabd93a","lineas":[{"cuenta":"41000037","importe":32.29}]}'),
    -- Sin justificante y sin IVA
    ('3fe979c2-9d1f-4a5d-aa6e-6408b9ec8b73', -10.94, '{"tipo":"cuenta","concepto":"Sin justificante · Iberdrola","lineas":[{"cuenta":"62800000","importe":10.94}]}'),
    ('ec29f52e-b768-410d-9219-c24ed83ef9f8', -378.96, '{"tipo":"cuenta","concepto":"Sin justificante · Iberdrola","lineas":[{"cuenta":"62800000","importe":378.96}]}'),
    ('7f36c6ab-3fbb-4582-8765-06cb225bfcaa', -80.00, '{"tipo":"cuenta","concepto":"Sin justificante · butano de Carabanchel","lineas":[{"cuenta":"62800000","importe":80}]}'),
    ('210da10d-5ed4-4052-8073-1b5b59d74059', -75.80, '{"tipo":"cuenta","concepto":"Sin justificante · Mercadona","lineas":[{"cuenta":"60000001","importe":75.8}]}'),
    ('33b71a1f-9bde-4525-b97a-7a8f84c62da1', -103.60, '{"tipo":"cuenta","concepto":"Sin justificante · Carrefour Vallecas","lineas":[{"cuenta":"60000001","importe":103.6}]}'),
    ('f67cf4fd-9af6-4a54-8305-b398a55dd57c', -360.00, '{"tipo":"cuenta","concepto":"Sin justificante · motor de la campana (Carabanchel)","lineas":[{"cuenta":"62200000","importe":360}]}'),
    ('7f84e932-f3db-4c6b-a665-8fac0d087d47', -378.10, '{"tipo":"cuenta","concepto":"Sin justificante · campana, su factura 80 (Carabanchel)","lineas":[{"cuenta":"62200000","importe":378.1}]}'),
    ('40ddb3eb-e3b1-4fe5-afd1-decb789ff9fb', -128.48, '{"tipo":"cuenta","concepto":"Sin justificante · Amazon","lineas":[{"cuenta":"62900000","importe":128.48}]}'),
    ('a05c5d19-9d21-47e7-9080-7e38d7931054', -126.66, '{"tipo":"cuenta","concepto":"Sin justificante · Amazon","lineas":[{"cuenta":"62900000","importe":126.66}]}'),
    ('a1692b55-1bf7-495a-a104-2175ee75dec8', -49.99, '{"tipo":"cuenta","concepto":"Sin justificante · Amazon","lineas":[{"cuenta":"62900000","importe":49.99}]}'),
    ('f346a2c2-dff5-4bc5-9436-78caf8d58f38', -16.41, '{"tipo":"cuenta","concepto":"Sin justificante · Amazon","lineas":[{"cuenta":"62900000","importe":16.41}]}'),
    ('41eed6c1-51ab-41e7-98db-6dd983c3090b', -126.51, '{"tipo":"cuenta","concepto":"Sin justificante · Amazon","lineas":[{"cuenta":"62900000","importe":126.51}]}'),
    ('a7baf999-f31e-4dec-bd94-e8cc71fa5685', -108.21, '{"tipo":"cuenta","concepto":"Sin justificante · Amazon","lineas":[{"cuenta":"62900000","importe":108.21}]}'),
    ('0d02f510-950e-4270-8743-114d5041c052', -36.66, '{"tipo":"cuenta","concepto":"Sin justificante · hogar y electricidad","lineas":[{"cuenta":"62900000","importe":36.66}]}'),
    ('e32fd409-c445-4100-a614-08a83c77216c', -29.99, '{"tipo":"cuenta","concepto":"Sin justificante · Masmovil","lineas":[{"cuenta":"62900000","importe":29.99}]}'),
    ('dfaf1a19-66e4-47b7-8882-502d8f989b02', -6.01, '{"tipo":"cuenta","concepto":"Sin justificante · Facebook","lineas":[{"cuenta":"62700000","importe":6.01}]}'),
    ('69b77a96-3b92-4269-90ac-6923cf5a3550', -45.68, '{"tipo":"cuenta","concepto":"Sin justificante · Diez Software","lineas":[{"cuenta":"62900005","importe":45.68}]}'),
    ('3d757cc3-59a1-4a7b-9d07-bc04c1f16b4e', -35.00, '{"tipo":"cuenta","concepto":"Sin justificante · Hubrise","lineas":[{"cuenta":"62900005","importe":35}]}'),
    ('79838483-186a-405e-8a8e-416e50ded8e1', -35.00, '{"tipo":"cuenta","concepto":"Sin justificante · Hubrise","lineas":[{"cuenta":"62900005","importe":35}]}'),
    ('4883b5af-147e-41d4-bd33-5aef0bf0bc40', -35.00, '{"tipo":"cuenta","concepto":"Sin justificante · Hubrise","lineas":[{"cuenta":"62900005","importe":35}]}')
  ) x(mov, importe, destino) loop
    if not exists (select 1 from public.bank_movement where id = r.mov and company_id = v_e and amount = r.importe
                    and op_date between date '2026-10-01' and date '2026-10-31' and status in ('por_aclarar', 'propuesto')) then
      raise exception 'DL1 octubre: el movimiento % ya no está sin casar por % en octubre: no se casa nada.', r.mov, r.importe;
    end if;
    v_res := public._dl1_casar(v_e, v_julio, 'Julio', r.mov, r.destino,
      case when r.destino->>'concepto' like 'Sin justificante%' then v_sin else v_porque end);
    select status into v_st from public.journal_entry where id = (v_res->>'asiento')::uuid;
    if v_st = 'propuesto' then
      v_ids := v_ids || jsonb_build_object('id', v_res->>'asiento', 'importe', abs(r.importe));
    elsif v_st is distinct from 'validado' then
      raise exception 'DL1 octubre: el asiento del movimiento % está % y no se puede validar.', r.mov, coalesce(v_st, 'sin asiento');
    end if;
  end loop;

  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  if exists (select 1 from public.bank_movement where company_id = v_e and op_date between date '2026-10-01' and date '2026-10-31'
              and status in ('por_aclarar', 'propuesto')) then
    raise exception 'DL1 octubre: después de casar quedan movimientos de octubre sin casar.';
  end if;
  raise notice 'DL1 octubre: % asientos validados como Julio (3 correcciones y los 33 casados).', v_n;
end $$;
