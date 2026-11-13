-- supabase/migrations/20261113T0155_b01r23_noviembre_bancos.sql
--
-- B01r·23 · El banco de noviembre de Llorente29 (Foodint), del 01/11 al 12/11
-- (Julio, 13/11: concurso el 20/11; la contabilidad, cerrada a 15/11). El
-- modelo es el de octubre (D, 20261112T1842_dl1_octubre_bancos.sql): cada
-- movimiento por bank_casar como Julio (_dl1_casar), y su asiento validado como
-- si lo validara él (_dl1_validar). Nada toca un IVA presentado.
--
-- Los 55 sin casar del 13/11 a las 01:30, uno a uno (ver el PR):
--   40 se casan:
--     · 16 con su liquidación, al céntimo (regla 1): 8 de Uber que proponía el
--       motor; 3 de Uber y 4 de Glovo que el motor no propuso (cobradas fuera de
--       su ventana o en otro banco que el de su local); y la factura
--       OB-2026-000439 de Tatic ApS («APS* OPEN-BANKING», 10,00).
--     · 13 cobros de Uber y de Glovo sin liquidación cargada (regla 2): contra
--       la cuenta de la plataforma, «su liquidación, pendiente».
--     ·  7 gastos sin factura ni ticket (regla 3): sin justificante y sin IVA.
--     ·  4 del banco o de la empresa: las cuotas y la devolución del plan de
--       Revolut (comisión del banco) y la devolución de Uber Eats.
--    9 se apartan, por el camino de la aplicación (bank_ignorar):
--     · 4 cargos que el BBVA anuló porque no había saldo (como los del 30/10,
--       tanda 2350): Iberdrola −395,25 y Reciclajes Ecológicos −1.617,31 en
--       ···4525; Vodafone −31,50 y Jazztel −35,45 en la principal. La lectura del
--       agregador lo dice: el saldo bajó ese importe y al día siguiente volvió
--       («hueco» por ese mismo importe), y sin ellos ···4525 cuadra al céntimo.
--     · 5 de 0,00 € de Revolut: comprobación de tarjeta (regla 6).
--    6 se quedan fuera, al informe (reglas 4 y 5): las tres «RECOBRO DEUDA
--      VENCIDA PRESTAMO» (ninguna anterior apuntada así), el pago al socio
--      (espera a Julio), QBO Integrity −537,60 (su acreedor ya está a −1.843,60
--      sin facturas) y la transferencia de −1.210,00 a la propia empresa (el
--      otro lado, en Revolut, ya está casado contra una cuenta con su asiento:
--      casarla obliga a deshacer aquel).
--   Y se validan los 5 asientos de noviembre que ya estaban casados y propuestos
--   (cuatro cobros de la principal y el traspaso de 1.574,00 de ···0133 a ···4525).
--
-- SIN VUELTA ATRÁS, a propósito, como la de octubre: un asiento validado se
-- anula con un contraasiento, un casado se deshace en Bancos y un apartado, con
-- «Deshacer».

create or replace function public._b01r23_ignorar(p_company uuid, p_actor uuid, p_motivo text, p_movs jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; x jsonb; v_m public.bank_movement; v_n int := 0;
  v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true);
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'B01r23 apartar: esa empresa no está.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'B01r23 apartar: falta el motivo.'; end if;
  if jsonb_array_length(coalesce(p_movs, '[]'::jsonb)) = 0 then raise exception 'B01r23 apartar: no hay movimientos.'; end if;
  for x in select * from jsonb_array_elements(p_movs) loop
    select * into v_m from public.bank_movement where id = (x->>'id')::uuid for update;
    if v_m.id is null or v_m.company_id is distinct from p_company or v_m.account_id is distinct from v_acc then
      raise exception 'B01r23 apartar: el movimiento % no está en la empresa: no se toca nada.', x->>'id';
    end if;
    if v_m.amount <> (x->>'importe')::numeric or v_m.op_date <> (x->>'fecha')::date then
      raise exception 'B01r23 apartar: el movimiento % es de % el % y se esperaba % el %: no se toca nada.',
        x->>'id', v_m.amount, v_m.op_date, x->>'importe', x->>'fecha';
    end if;
    if v_m.status not in ('por_aclarar', 'propuesto') then
      raise exception 'B01r23 apartar: el movimiento % ya no está sin casar (está %): no se toca nada.', x->>'id', v_m.status;
    end if;
  end loop;
  -- Como si lo pulsara la persona: su usuario y su cuenta activa, solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  for x in select * from jsonb_array_elements(p_movs) loop
    perform public.bank_ignorar((x->>'id')::uuid, p_motivo);
    v_n := v_n + 1;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return v_n;
end $$;
revoke all on function public._b01r23_ignorar(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
comment on function public._b01r23_ignorar(uuid, uuid, text, jsonb) is
  'B01r23. Aparta con bank_ignorar, como una persona de la cuenta, movimientos sin casar (por aclarar o propuestos) anclados por id, importe y fecha; para si alguno no está en la empresa, no cuadra o ya no está sin casar. Solo una tanda.';


-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_glovo constant text := '720afecb-a89b-4ca9-a249-f11dcb451c38';   -- GLOVOAPP SPAIN PLATFORM (Contactos)
  v_uber constant text := '477a9cd0-dce2-452d-a68d-cc1d8076c026';    -- UBER (Contactos)
  v_porque constant text := 'B01r23 (Julio, 13/11): noviembre de Llorente29, movimiento a movimiento.';
  v_sin constant text := 'B01r23 (Julio, 13/11): gasto sin justificante y sin IVA; cuando llegue el documento se corrige en el 4T.';
  -- Los que se quedan fuera (al informe): tienen que seguir sin casar al acabar, y solo ellos.
  v_fuera constant uuid[] := array[
    '5d80d05f-8d27-49b9-abf0-99d9cb9ca7cd',   -- −1.210,00 a la propia empresa (el otro lado ya está casado en Revolut)
    '7b9b5132-2861-4d6d-852f-53739dafe320',   -- −457,49 recobro de deuda vencida del préstamo
    '63c89636-a53b-4003-bc50-dc86e0e2d00b',   -- −30,00 recobro de deuda vencida del préstamo
    '8fb0c82f-f1ac-49bd-8338-b1df5b6dcb08',   -- −159,94 recobro de deuda vencida del préstamo
    '322d4cc1-9a0d-4866-867a-7e75e6225ad9',   -- −18,00 al socio (espera a Julio)
    'df68f127-8f5f-405b-b54a-14d7f6eac6de'    -- −537,60 QBO Integrity
  ]::uuid[];
  r record; v_res jsonb; v_st text; v_ids jsonb := '[]'::jsonb; v_n int; v_ap int; v_cero int; v_quedan uuid[];
  liq constant text := '{"tipo":"liquidacion","concepto":"%s","tercero_id":"%s","cuenta_cliente":"%s","liquidacion_id":"%s"}';
  pend constant text := '{"tipo":"cuenta","concepto":"Cobro de %s · su liquidación, pendiente","tercero_id":"%s","lineas":[{"cuenta":"%s","importe":%s}]}';
  cta constant text := '{"tipo":"cuenta","concepto":"%s","lineas":[{"cuenta":"%s","importe":%s}]}';
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'B01r23 noviembre: sin la cuenta de Foodint, no hay nada que hacer.';
    return;
  end if;

  -- A · Los 40 que se casan. destino: el de bank_casar, como en Bancos.
  for r in select x.mov, x.importe, x.destino::jsonb destino from (values
    -- Con su liquidación, al céntimo (regla 1). Uber, las que proponía el motor:
    ('fee81a31-c53f-4dc6-9912-5bba9b5d5501'::uuid, 72.07, format(liq, 'Cobro de Uber · Bendito Burrito (Calle de Florencio Llorente 29) 26/10–01/11', v_uber, '43000002', '27aec71e-58aa-4c10-bda1-7175bde72352')),
    ('f1a9d846-aae2-471a-aac8-054cae0581a3', 98.67, format(liq, 'Cobro de Uber · Mila''s Sandwiches (Calle de Florencio Llorente 29) 26/10–01/11', v_uber, '43000002', 'e20596af-8ecc-461d-9b20-ddf94999eecc')),
    ('1742b19d-c8a8-4862-ac7b-dff67b9e28bf', 169.05, format(liq, 'Cobro de Uber · Milanesa House (Calle de Florencio Llorente 29) 26/10–01/11', v_uber, '43000002', 'e9b28c1f-01ad-4c63-a7ab-cf00cfbab02b')),
    ('58923bb3-b7d6-412f-8479-7f92b3b7d950', 16.76, format(liq, 'Cobro de Uber · Bendito Burrito (Calle de Florencio Llorente 29) 02/11–08/11', v_uber, '43000002', '2df0d24b-8967-4613-b2b2-c3dab97fe0d1')),
    ('03e05598-a4e3-4d2d-9172-e1ae488100e2', 120.79, format(liq, 'Cobro de Uber · Milanesa House (Calle de Florencio Llorente 29) 02/11–08/11', v_uber, '43000002', '9db92f07-4b5a-4e7d-b92b-37011d8b17a3')),
    ('cf118dd9-4719-4be6-856b-0e1f4bc32db2', 188.70, format(liq, 'Cobro de Uber · Meraki Pita (Calle de Florencio Llorente 29) 26/10–08/11', v_uber, '43000002', 'b4487609-f3da-4989-90db-012f2a932442')),
    ('00634f6e-d3e2-4202-83d4-9e565a36f1ec', 94.54, format(liq, 'Cobro de Uber · Meraki Pita (Calle de Camichi 4) 12/10–01/11', v_uber, '43000002', 'c9962eeb-b3df-45bb-945d-43840417a0a8')),
    ('06cf53a2-6fae-4708-8f67-6587d9f2bb13', 19.76, format(liq, 'Cobro de Uber · Meraki Pita (Calle de Camichi 4) 02/11–08/11', v_uber, '43000002', '375b05dd-0035-4c3f-accf-30cebf4fc2f4')),
    -- Uber, al céntimo y en la fecha de su liquidación, que el motor no propuso:
    ('55691d30-5377-42cf-9da2-1e35dc4a3708', 54.98, format(liq, 'Cobro de Uber · Milanesa House (Calle de Camichi 4) 26/10–01/11', v_uber, '43000002', '38f3a652-b19e-4bea-b4b8-f19477497998')),
    ('2a93a39a-d707-431e-8550-1d2db95af530', 159.30, format(liq, 'Cobro de Uber · Milanesa House (Calle de Camichi 4) 02/11–08/11', v_uber, '43000002', '288ee5d8-21ba-4d6f-98f4-33f07b2bbff9')),
    ('2813e3b0-8fd4-43b4-942f-1b3e7655f820', 293.68, format(liq, 'Cobro de Uber · Lovers Burger (Calle de Camichi 4) 02/11–08/11', v_uber, '43000002', '31940af7-72a5-48bf-be38-4095591cbcde')),
    -- Glovo, al céntimo, de la quincena 01/10–15/10 (Florencio Llorente), que el motor no propuso:
    ('b0f87ef7-d018-48d3-a003-3e79aaab1cec', 29.38, format(liq, 'Cobro de Glovo · Scandal Burger (Florencio Llorente) 01/10–15/10', v_glovo, '43000001', '095526fe-a89a-4257-823e-5333eddcca4f')),
    ('3349ab11-bd4b-4b46-be02-0d3e0d58725e', 44.16, format(liq, 'Cobro de Glovo · Bendito Burrito (Florencio Llorente) 01/10–15/10', v_glovo, '43000001', 'b1125db3-683c-4ce9-a623-365339fa5f2c')),
    ('e3bfb010-6e4e-4796-822c-c5896a4111fe', 58.24, format(liq, 'Cobro de Glovo · The Urban Kebab (Florencio Llorente) 01/10–15/10', v_glovo, '43000001', 'a22365e3-540d-4748-a5a9-3750f77d379d')),
    ('a6d69241-8f83-46c8-974f-e82057c045d7', 236.27, format(liq, 'Cobro de Glovo · Mila''s Sandwiches (Florencio Llorente) 01/10–15/10', v_glovo, '43000001', 'babeae66-bf43-48cb-880a-3b7f78af0f82')),
    -- La factura OB-2026-000439 de Tatic ApS (open banking), 10,00, con la tarjeta de ···0133:
    ('fd0dca7b-fe63-40d8-8b11-7ffd63b98aa7', -10.00, '{"tipo":"factura_recibida","metodo":"card","concepto":"Pago a Tatic ApS · OB-2026-000439","facturas":[{"id":"df1cbdef-26c1-47e2-b76a-f39f189a65fc","importe":10}],"tercero_id":"13b8896c-ff52-4b97-9deb-dc06a262bb19","cuenta_tercero":"41000046"}'),
    -- Cobros sin liquidación cargada (regla 2). Uber («LIQ. OP. Nº», Stichting Custodian Uber Payments):
    ('544cd2f3-e37b-4c78-9f65-38dde3f4cae4', 187.12, format(pend, 'Uber', v_uber, '43000002', '187.12')),
    ('d96dc767-8537-4119-8da3-e3359f9d790c', 1063.55, format(pend, 'Uber', v_uber, '43000002', '1063.55')),
    ('ecb603b7-5228-46d9-b82f-21572fa3d988', 952.07, format(pend, 'Uber', v_uber, '43000002', '952.07')),
    ('febc4c5f-6fcb-4aa7-ac49-4a87f3ee8b35', 103.08, format(pend, 'Uber', v_uber, '43000002', '103.08')),
    ('5783b22b-4f05-40c6-945a-046d8a4452f6', 39.87, format(pend, 'Uber', v_uber, '43000002', '39.87')),
    ('7f1662f4-7094-4ef2-97e5-4c0c8ded161e', 72.84, format(pend, 'Uber', v_uber, '43000002', '72.84')),
    -- Glovo:
    ('a67dcc85-c907-49f4-934d-3a4f6fe40cd3', 224.95, format(pend, 'Glovo', v_glovo, '43000001', '224.95')),
    ('9de02d63-6a51-41be-bfe2-cad1c5ae3d1d', 611.42, format(pend, 'Glovo', v_glovo, '43000001', '611.42')),
    ('dc0a83fe-0f1e-401a-b329-de4a8a2de622', 963.79, format(pend, 'Glovo', v_glovo, '43000001', '963.79')),
    ('21b09cd3-26d7-4008-8e61-e2fe3ce6af6b', 112.14, format(pend, 'Glovo', v_glovo, '43000001', '112.14')),
    ('66c15635-9c8a-4acd-9fad-a8691bbe2d01', 185.73, format(pend, 'Glovo', v_glovo, '43000001', '185.73')),
    ('4af79b94-5a3c-4d2e-8164-5caf3ce38454', 189.97, format(pend, 'Glovo', v_glovo, '43000001', '189.97')),
    ('fda6f0d9-5c8d-4a77-9baa-a2c066876e45', 544.54, format(pend, 'Glovo', v_glovo, '43000001', '544.54')),
    -- Del banco y de la empresa:
    ('f78f0e90-3601-4dde-95ab-b92e83709fb9', -10.00, format(cta, 'Comisión del banco · cuota del plan de Revolut', '62600000', '10')),
    ('c4fadd45-fd9b-4663-b8a3-2208c2e5481e', -35.00, format(cta, 'Comisión del banco · cuota del plan de Revolut', '62600000', '35')),
    ('86bc370a-dcab-4a74-b18d-86904eb795e6', 9.00, format(cta, 'Comisión del banco · devolución de la parte no usada del plan de Revolut', '62600000', '9')),
    ('acea8fd4-b8ec-49a1-8ddd-44ad9be44fe4', 3.24, format(cta, 'Devolución de Uber Eats · de la empresa', '60000001', '3.24')),
    -- Sin justificante y sin IVA (regla 3):
    ('dc5c6f0a-8a3a-4405-8cd9-3a99202cd7f3', -3.71, format(cta, 'Sin justificante · GitHub (programa comprado fuera; la comisión del banco va dentro)', '62900005', '3.71')),
    ('192986a1-7ea7-4e62-b60d-c313f9caebe3', -13.41, format(cta, 'Sin justificante · Anthropic (programa comprado fuera; la comisión del banco va dentro)', '62900005', '13.41')),
    ('94f7ccbe-cbb2-4fe3-90c4-bd233a1ee363', -21.76, format(cta, 'Sin justificante · Claude (Anthropic)', '62900005', '21.76')),
    ('579ffd6d-fb89-4181-9160-b9f6b36f34f0', -5.03, format(cta, 'Sin justificante · Facebook', '62700000', '5.03')),
    ('1a64d490-b106-4890-aa43-4270c31cef54', -13.14, format(cta, 'Sin justificante · Amazon', '62900000', '13.14')),
    ('19d88e5a-2b39-4887-99de-d0f369c2f342', -18.33, format(cta, 'Sin justificante · Scdad Española Contrat', '62900000', '18.33')),
    ('d4a236da-4a10-4a44-908b-ef335e480a47', -61.00, format(cta, 'Sin justificante · Ofitor 2000', '62900000', '61'))
  ) x(mov, importe, destino) loop
    if not exists (select 1 from public.bank_movement where id = r.mov and company_id = v_e and amount = r.importe
                    and op_date between date '2026-11-01' and date '2026-11-30' and status in ('por_aclarar', 'propuesto')) then
      raise exception 'B01r23 noviembre: el movimiento % ya no está sin casar por % en noviembre: no se casa nada.', r.mov, r.importe;
    end if;
    v_res := public._dl1_casar(v_e, v_julio, 'Julio', r.mov, r.destino,
      case when r.destino->>'concepto' like 'Sin justificante%' then v_sin else v_porque end);
    select status into v_st from public.journal_entry where id = (v_res->>'asiento')::uuid;
    if v_st = 'propuesto' then
      v_ids := v_ids || jsonb_build_object('id', v_res->>'asiento', 'importe', abs(r.importe));
    elsif v_st is distinct from 'validado' then
      raise exception 'B01r23 noviembre: el asiento del movimiento % está % y no se puede validar.', r.mov, coalesce(v_st, 'sin asiento');
    end if;
  end loop;

  -- B · Los 5 asientos de noviembre que ya estaban casados y propuestos: se validan con los demás.
  v_ids := v_ids || '[{"id":"8054db00-33e6-4d65-aff5-ce123bf62d49","importe":223.50},
                      {"id":"d195f335-166e-4182-b25e-28bedfb33eb9","importe":100.42},
                      {"id":"2cc9ed92-0f34-41f0-a0bd-9dd0845a3a6c","importe":44.21},
                      {"id":"5b91a06e-5bb6-4206-a3b9-f3258ba656e3","importe":11.83},
                      {"id":"3a3f6180-3886-4fd8-bb54-5a116a096c56","importe":1574.00}]'::jsonb;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);

  -- C · Se apartan: los cargos que el banco anuló y las comprobaciones de tarjeta de Revolut.
  v_ap := public._b01r23_ignorar(v_e, v_julio, 'Anulado por el banco: no había saldo', '[
    {"id":"4edeeffb-dd3d-4d9d-98a9-a6b02fc1d674","importe":-395.25,"fecha":"2026-11-06"},
    {"id":"2620e344-b56d-4afb-baca-abb8cd48313c","importe":-1617.31,"fecha":"2026-11-11"},
    {"id":"ba3ecdbc-5527-4bf8-9f60-cd3a0a82baf8","importe":-31.50,"fecha":"2026-11-10"},
    {"id":"09305f04-f960-45bf-9998-1df44bbe06cc","importe":-35.45,"fecha":"2026-11-11"}]'::jsonb);
  v_cero := public._b01r23_ignorar(v_e, v_julio, 'Comprobación de tarjeta', '[
    {"id":"883fffb3-75a0-42cb-9204-50727ee8c734","importe":0,"fecha":"2026-11-06"},
    {"id":"5f8bcf12-2158-47cc-9b17-635e4b437315","importe":0,"fecha":"2026-11-06"},
    {"id":"2ad9ecf6-4489-4802-a5e9-e8c1a393271a","importe":0,"fecha":"2026-11-07"},
    {"id":"3b227566-f696-41d0-b702-2eabf0f188da","importe":0,"fecha":"2026-11-07"},
    {"id":"a6f9e5dc-da6e-4d31-a1e3-da66c9fb788a","importe":0,"fecha":"2026-11-08"}]'::jsonb);

  -- D · Lo que queda sin casar en noviembre (hasta el 12/11) son los 6 de fuera, y solo ellos.
  select array_agg(id order by id) into v_quedan from public.bank_movement
   where company_id = v_e and op_date between date '2026-11-01' and date '2026-11-12' and status in ('por_aclarar', 'propuesto', 'pendiente');
  if v_quedan is distinct from (select array_agg(x order by x) from unnest(v_fuera) x) then
    raise exception 'B01r23 noviembre: después de casar quedan sin casar % y se esperaban los 6 de fuera.', v_quedan;
  end if;
  raise notice 'B01r23 noviembre: 40 casados, % asientos validados como Julio, % cargos anulados y % comprobaciones de tarjeta apartados; quedan fuera los 6 del informe.', v_n, v_ap, v_cero;
end $$;
