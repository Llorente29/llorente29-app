-- ============================================================================
-- PRUEBA (staging) · B02 · T1 (0200): lo que entra y el motor en la base.
-- Todo en una transacción con ROLLBACK. Fichero entero; los caminos de verdad
-- (bank_importar, bank_facturas_para_casar, bank_casar) como USUARIO (el
-- administrador de A, rol «authenticated»). Datos INVENTADOS, en el banco
-- «B01 · Mercado» de la semilla del B01; tarjetas de prueba de las pasarelas.
--
--   1. _bank_contraparte_limpia con los ejemplos de abajo (los mismos pasa la
--      prueba unitaria tests/unit/modules/conta/entradaB02.test.ts contra el
--      front: si cambia uno, cambia el otro).
--   2. bank_importar guarda la contraparte limpia y sin tarjeta, y el tipo.
--   3. bank_facturas_para_casar trae la aprobada y la «en revisión», con su estado.
--   4. Casar el pago entero de una factura «en revisión»: se casa, la factura
--      NO se aprueba ni se marca pagada.
--   5. La diferencia pequeña: el asiento lleva su tercera línea y cuadra; la
--      factura aprobada queda pagada. Una diferencia grande, o propuesta por la
--      máquina, PARA.
--   6. Lo de antes, igual: un pago a una cuenta, como con la 0110.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

-- ── 1 · La contraparte limpia (EJEMPLOS: entrada → salida) ──────────────────
create temp table _ejemplos (entrada text, salida text) on commit drop;
insert into _ejemplos values
  ('************3085 RECARGAS INVENTADAS', 'Recargas Inventadas'),
  ('PAGO FACT DISTRIBUCIONES INVENTADAS', 'Pago Fact Distribuciones Inventadas'),
  ('EMPRESA INVENTADA FOOD S.L.', 'Empresa Inventada Food S.L.'),
  ('XXXX 1234 KIOSCO DE LA ESQUINA', 'Kiosco de la Esquina'),
  ('LIQUIDACION SEMANA 39 REF 12345678901234', 'Liquidacion Semana 39 Ref'),
  ('ES0182000000000000000001', null),
  ('  ', null),
  ('ALMACENES DEL SUR SL', 'Almacenes del Sur SL'),
  ('Y OTRA COSA Y MAS', 'Y Otra Cosa y Mas'),
  ('NOMINA OCTUBRE 4111111111111111', 'Nomina Octubre'),
  ('CAFETERÍA ÑANDÚ', 'Cafetería Ñandú');
do $$
declare e record; n int := 0;
begin
  for e in select * from _ejemplos loop
    if public._bank_contraparte_limpia(e.entrada) is distinct from e.salida then
      raise exception 'PRUEBA B02 · 1: «%» dio «%» y tenía que dar «%».', e.entrada, public._bank_contraparte_limpia(e.entrada), e.salida;
    end if;
    n := n + 1;
  end loop;
  raise notice '1 · contraparte limpia: % ejemplos, bien', n;
end $$;

create temp table _r (que text primary key, id uuid, texto text) on commit drop;
grant all on _r to authenticated;

-- ── 0 · Siembra (como el dueño): un proveedor y tres facturas ───────────────
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; s uuid; f uuid;
begin
  insert into public.supplier (account_id, name) values (a, 'Proveedor Inventado B02') returning id into s;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status)
  values (a, emp, s, 'B02-REV', date '2026-09-20', 248.61, 'en_revision') returning id into f; insert into _r values ('f_rev', f, null);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status)
  values (a, emp, s, 'B02-APR', date '2026-09-21', 100.00, 'aprobada') returning id into f; insert into _r values ('f_apr', f, null);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status)
  values (a, emp, s, 'B02-APR2', date '2026-09-22', 100.00, 'aprobada') returning id into f; insert into _r values ('f_apr2', f, null);
  insert into _r values ('c400', null, (select code from public.company_account where company_id = emp and code like '400%' order by code limit 1)),
                        ('c626', null, (select code from public.company_account where company_id = emp and code like '626%' order by code limit 1)),
                        ('c629', null, (select code from public.company_account where company_id = emp and code like '629%' order by code limit 1));
  if exists (select 1 from _r where que in ('c400', 'c626', 'c629') and texto is null) then raise exception 'PRUEBA B02 · 0: staging no tiene 400, 626 o 629 en la empresa A.'; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 2 · Importar como usuario ───────────────────────────────────────────────
do $$
declare r jsonb; m record; mv jsonb := '[]'::jsonb; i int;
begin
  for i in 1..5 loop
    mv := mv || jsonb_build_array(jsonb_build_object('fecha', '2026-09-25', 'importe', (array[-248.61, -101.50, -105.00, -101.00, -12.00])[i],
      'concepto_banco', 'TRANSFERENCIAS · PROVEEDOR INVENTADO B02', 'concepto_limpio', 'Transferencias proveedor inventado b02',
      'contraparte', (array['PROVEEDOR INVENTADO B02 4111111111111111', 'PROVEEDOR INVENTADO B02', 'PROVEEDOR INVENTADO B02', 'PROVEEDOR INVENTADO B02', ''])[i],
      'tipo', (array['TRANSFERENCIAS', 'TRANSFERENCIAS', 'TRANSFERENCIAS', 'TRANSFERENCIAS', null])[i],
      'huella', 'b02-entrada-' || i, 'huella_suave', 'b02-entrada-s' || i));
  end loop;
  r := public.bank_importar('b0100000-0000-4000-8000-0000000000b3', 'fichero', 'csv:bbva', 'prueba-b02.xlsx', repeat('b', 64),
    date '2026-09-25', date '2026-09-25', null, null, 'prueba', null, mv);
  for m in select * from public.bank_movement where statement_id = (r->>'extracto')::uuid order by fingerprint loop
    insert into _r values ('m' || right(m.fingerprint, 1), m.id, null);
  end loop;
  select * into m from public.bank_movement where id = (select id from _r where que = 'm1');
  if m.counterparty is distinct from 'Proveedor Inventado B02' or m.movement_type is distinct from 'TRANSFERENCIAS' then
    raise exception 'PRUEBA B02 · 2: se guardó «%» / «%».', m.counterparty, m.movement_type;
  end if;
  select * into m from public.bank_movement where id = (select id from _r where que = 'm5');
  if m.counterparty is not null or m.movement_type is not null then raise exception 'PRUEBA B02 · 2: sin contraparte ni tipo tenía que quedar vacío.'; end if;
  raise notice '2 · importado como usuario: contraparte limpia y sin tarjeta, tipo aparte';
end $$;

-- ── 3 · Las facturas para casar, con su estado ──────────────────────────────
do $$
begin
  if (select estado from public.bank_facturas_para_casar('3b34403a-a7d6-4a48-a8d7-737e8cababdc') where id = (select id from _r where que = 'f_rev')) is distinct from 'en_revision'
     or (select estado from public.bank_facturas_para_casar('3b34403a-a7d6-4a48-a8d7-737e8cababdc') where id = (select id from _r where que = 'f_apr')) is distinct from 'aprobada' then
    raise exception 'PRUEBA B02 · 3: bank_facturas_para_casar no trae las dos con su estado.';
  end if;
  raise notice '3 · facturas para casar: la aprobada y la en revisión';
end $$;

-- ── 4 · El pago entero de una factura «en revisión» ─────────────────────────
do $$
declare r jsonb; f public.supplier_invoice;
begin
  r := public.bank_casar((select id from _r where que = 'm1'), jsonb_build_object('tipo', 'factura_recibida',
    'facturas', jsonb_build_array(jsonb_build_object('id', (select id from _r where que = 'f_rev'), 'importe', 248.61)),
    'cuenta_tercero', (select texto from _r where que = 'c400'), 'tercero_id', null, 'concepto', 'Pago a Proveedor Inventado B02'),
    'probable', 'prueba', '[]'::jsonb, 'persona', null);
  select * into f from public.supplier_invoice where id = (select id from _r where que = 'f_rev');
  if f.status <> 'en_revision' or f.paid_at is not null then raise exception 'PRUEBA B02 · 4: la factura en revisión quedó % / %.', f.status, f.paid_at; end if;
  if not exists (select 1 from public.bank_match_item where supplier_invoice_id = f.id) then raise exception 'PRUEBA B02 · 4: el casado no apunta a la factura.'; end if;
  raise notice '4 · en revisión: casado, y la factura sigue en revisión y sin pagar';
end $$;

-- ── 5 · La diferencia pequeña ───────────────────────────────────────────────
do $$
declare r jsonb; f public.supplier_invoice; d numeric; h numeric; n int; v text;
begin
  r := public.bank_casar((select id from _r where que = 'm2'), jsonb_build_object('tipo', 'factura_recibida',
    'facturas', jsonb_build_array(jsonb_build_object('id', (select id from _r where que = 'f_apr'), 'importe', 100.00)),
    'cuenta_tercero', (select texto from _r where que = 'c400'), 'tercero_id', null, 'concepto', 'Pago a Proveedor Inventado B02',
    'diferencia', jsonb_build_object('cuenta', (select texto from _r where que = 'c626'), 'importe', 1.50, 'concepto', 'Comisión del pago')),
    'probable', 'prueba', '[]'::jsonb, 'persona', null);
  select count(*), sum(debit), sum(credit) into n, d, h from public.journal_line where entry_id = (r->>'asiento')::uuid;
  if n <> 3 or d <> h or d <> 101.50 then raise exception 'PRUEBA B02 · 5: el asiento tiene % líneas, debe % y haber %.', n, d, h; end if;
  if not exists (select 1 from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id
                  where jl.entry_id = (r->>'asiento')::uuid and ca.code = (select texto from _r where que = 'c626') and jl.debit = 1.50) then
    raise exception 'PRUEBA B02 · 5: la diferencia no va al debe de su cuenta.';
  end if;
  select * into f from public.supplier_invoice where id = (select id from _r where que = 'f_apr');
  if f.status <> 'pagada' then raise exception 'PRUEBA B02 · 5: la factura aprobada pagada entera quedó %.', f.status; end if;
  begin
    perform public.bank_casar((select id from _r where que = 'm3'), jsonb_build_object('tipo', 'factura_recibida',
      'facturas', jsonb_build_array(jsonb_build_object('id', (select id from _r where que = 'f_apr2'), 'importe', 100.00)),
      'cuenta_tercero', (select texto from _r where que = 'c400'), 'tercero_id', null, 'concepto', 'x',
      'diferencia', jsonb_build_object('cuenta', (select texto from _r where que = 'c626'), 'importe', 5.00)), 'probable', 'prueba', '[]'::jsonb, 'persona', null);
  exception when others then v := sqlerrm; end;
  if v not like 'Una diferencia de 5,00 € no es pequeña%' then raise exception 'PRUEBA B02 · 5: una diferencia de 5 € dijo «%».', v; end if;
  v := null;
  begin
    perform public.bank_casar((select id from _r where que = 'm4'), jsonb_build_object('tipo', 'factura_recibida',
      'facturas', jsonb_build_array(jsonb_build_object('id', (select id from _r where que = 'f_apr2'), 'importe', 100.00)),
      'cuenta_tercero', (select texto from _r where que = 'c400'), 'tercero_id', null, 'concepto', 'x',
      'diferencia', jsonb_build_object('cuenta', (select texto from _r where que = 'c626'), 'importe', 1.00)), 'seguro', 'prueba', '[]'::jsonb, 'folvy', null);
  exception when others then v := sqlerrm; end;
  if v is distinct from 'Una diferencia no se apunta sola: la confirma la persona.' then raise exception 'PRUEBA B02 · 5: la diferencia de la máquina dijo «%».', v; end if;
  raise notice '5 · diferencia pequeña: 3 líneas que cuadran y la factura pagada; la grande y la de la máquina, PARAN';
end $$;

-- ── 6 · Lo de antes, igual ──────────────────────────────────────────────────
do $$
declare r jsonb; n int;
begin
  r := public.bank_casar((select id from _r where que = 'm5'), jsonb_build_object('tipo', 'cuenta', 'concepto', 'Un gasto',
    'lineas', jsonb_build_array(jsonb_build_object('cuenta', (select texto from _r where que = 'c629'), 'importe', 12.00))), 'probable', 'prueba', '[]'::jsonb, 'persona', null);
  select count(*) into n from public.journal_line where entry_id = (r->>'asiento')::uuid;
  if n <> 2 then raise exception 'PRUEBA B02 · 6: un pago a una cuenta tenía que dar 2 líneas y dio %.', n; end if;
  raise notice '6 · lo de antes, igual';
end $$;
reset role;

rollback;
