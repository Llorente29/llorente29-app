-- supabase/staging/sql/20261120_k06_pagar_con_cuenta_prueba.sql
--
-- SOLO STAGING. Prueba del K06 (20261120T0840_k06_pagar_con_cuenta), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción
-- con ROLLBACK: staging no cambia. Nombra el objeto:
-- public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text) (nueva). No
-- cambia ninguna que exista.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. La
-- subcuenta del socio (55100001) y las recibidas son inventadas, dentro de la
-- transacción (T11).
--
--   0. La 0840 está delante (la pone el ensayo); _bank_recibida_pagado es la
--      del N10 (no se toca: se mira su md5 al empezar y al acabar).
--   2. Regla 10, por sus caminos:
--      a. guardar una recibida pagada con la 551: su asiento validado (serie 4,
--         Debe 40000071 / Haber 55100001 por el total), su pago con su asiento,
--         la factura pagada;
--      b. casarla en Bancos: lo pagado para Bancos (_bank_recibida_pagado) es su
--         total, y Bancos ya no la propone para casar (bank_facturas_para_casar);
--         la que no se paga sigue propuesta;
--      c. otra vez la misma: no se paga dos veces.
--   3. Lo que no paga, con su frase: una fecha después de hoy, la cuenta del
--      proveedor, un banco (va por Bancos), una cuenta que no está en el plan,
--      una sin validar, una de las que se compensan con su liquidación.
--   4. Deshacer: la vuelta atrás (el fichero de verdad) quita la función; el
--      pago hecho se queda con su asiento, y Bancos sigue sin proponerla.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K06: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Lo de antes.
create temp table _k06 (clave text primary key, valor text) on commit drop;
grant select, insert on _k06 to authenticated;
insert into _k06 values ('md5_pagado', md5(pg_get_functiondef('public._bank_recibida_pagado(uuid)'::regprocedure)));
do $$ begin
  if to_regprocedure('public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)') is null then
    raise exception 'PRUEBA K06 · 0: falta la 0840 delante (la pone el ensayo de staging).';
  end if;
  if not exists (select 1 from public.company where id = 'c0e20000-0000-4000-8000-0000000000e3') then
    raise exception 'PRUEBA K06 · 0: falta la gestoría del núcleo (seed_k02_nucleo_staging.sql).';
  end if;
  raise notice '0 · la 0840 delante; _bank_recibida_pagado medida (md5).';
end $$;

-- Lo inventado: la 55100001 del socio y cuatro recibidas del Proveedor de Prueba Ficha Uno (su 40000071).
insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', 'pymes', '55100001', '551', 'Cuenta corriente con socios · Socio de Prueba K06', 'own', 'manual')
on conflict (company_id, code) do nothing;
insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                     tax_base_total, tax_total, grand_total, needs_review, payment_method, created_by_name)
select x.id::uuid, 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', 'c0e40000-0000-4000-8000-0000000000a1', 'invoice',
       x.numero, date '2026-10-20', x.estado, 'manual', 100, 21, 121, false, x.forma, 'prueba K06'
  from (values ('c0e60000-0000-4000-8000-0000000000f1', 'K06-PRUEBA-1', 'aprobada', null),
               ('c0e60000-0000-4000-8000-0000000000f2', 'K06-PRUEBA-2', 'aprobada', null),
               ('c0e60000-0000-4000-8000-0000000000f3', 'K06-PRUEBA-3', 'en_revision', null),
               ('c0e60000-0000-4000-8000-0000000000f4', 'K06-PRUEBA-4', 'aprobada', 'compensation')) x(id, numero, estado, forma);

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 2 · Regla 10, por sus caminos.
do $$
declare r jsonb; v_e uuid; v_n int; v_pagado numeric; v_estado text; v_ap text;
begin
  if public._bank_recibida_pagado('c0e60000-0000-4000-8000-0000000000f1') <> 0 then raise exception 'PRUEBA K06 · 2: la 1 ya tenía algo pagado'; end if;
  if not exists (select 1 from public.bank_facturas_para_casar('c0e20000-0000-4000-8000-0000000000e3') where id = 'c0e60000-0000-4000-8000-0000000000f1') then
    raise exception 'PRUEBA K06 · 2: antes de pagarla, Bancos no la proponía';
  end if;
  -- a · Guardarla pagada con la 551.
  r := public.conta_recibida_pagar_con_cuenta('c0e20000-0000-4000-8000-0000000000e3', 'c0e60000-0000-4000-8000-0000000000f1', '55100001', date '2026-10-25', 'Prueba K06');
  v_e := (r->>'asiento')::uuid;
  select string_agg(a.code || ':' || l.debit || ':' || l.credit, ' ' order by l.position) into v_ap
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_e;
  if v_ap <> '40000071:121.00:0.00 55100001:0.00:121.00' then raise exception 'PRUEBA K06 · 2a: el asiento es %', v_ap; end if;
  if (select series || ':' || status || ':' || source_type || ':' || document_ref from public.journal_entry where id = v_e) <> '4:validado:supplier_payment:K06-PRUEBA-1' then
    raise exception 'PRUEBA K06 · 2a: el asiento no es serie 4, validado, de pago, con su número';
  end if;
  select count(*) into v_n from public.supplier_invoice_payment where invoice_id = 'c0e60000-0000-4000-8000-0000000000f1' and entry_id = v_e and amount = 121 and paid_on = '2026-10-25';
  if v_n <> 1 then raise exception 'PRUEBA K06 · 2a: el pago con su asiento no está (%)', v_n; end if;
  select status into v_estado from public.supplier_invoice where id = 'c0e60000-0000-4000-8000-0000000000f1';
  if v_estado <> 'pagada' then raise exception 'PRUEBA K06 · 2a: la factura está %', v_estado; end if;
  if r->>'frase' !~ '^Pago apuntado con la 55100001 .*: 121,00 € el 25/10/2026, asiento 4 / \d+\. La factura K06-PRUEBA-1 queda pagada\.$' then
    raise exception 'PRUEBA K06 · 2a: la frase es «%»', r->>'frase';
  end if;
  raise notice '2a · %', r->>'frase';
  -- b · Bancos: lo pagado es su total y ya no la propone; la 2, sin pagar, sí.
  v_pagado := public._bank_recibida_pagado('c0e60000-0000-4000-8000-0000000000f1');
  if v_pagado <> 121 then raise exception 'PRUEBA K06 · 2b: para Bancos lleva pagado %', v_pagado; end if;
  if exists (select 1 from public.bank_facturas_para_casar('c0e20000-0000-4000-8000-0000000000e3') where id = 'c0e60000-0000-4000-8000-0000000000f1') then
    raise exception 'PRUEBA K06 · 2b: pagada, Bancos la sigue proponiendo para casar';
  end if;
  if not exists (select 1 from public.bank_facturas_para_casar('c0e20000-0000-4000-8000-0000000000e3') where id = 'c0e60000-0000-4000-8000-0000000000f2') then
    raise exception 'PRUEBA K06 · 2b: la que no se paga ya no está propuesta';
  end if;
  raise notice '2b · para Bancos, la 1 lleva pagados % y no se propone; la 2 sigue propuesta.', v_pagado;
  -- c · Otra vez: no.
  begin
    perform public.conta_recibida_pagar_con_cuenta('c0e20000-0000-4000-8000-0000000000e3', 'c0e60000-0000-4000-8000-0000000000f1', '55100001', date '2026-10-25', 'Prueba K06');
    raise exception 'PRUEBA K06 · 2c: se ha pagado dos veces';
  exception when sqlstate '23514' then raise notice '2c · otra vez: %', sqlerrm;
  end;
end $$;

-- 3 · Lo que no paga, con su frase.
do $$
declare x record;
begin
  for x in select * from (values
      ('después de hoy', 'c0e60000-0000-4000-8000-0000000000f2', '55100001', (public.conta_hoy() + 1)::text, '22023', 'aún no ha llegado'),
      ('la del proveedor', 'c0e60000-0000-4000-8000-0000000000f2', '40000071', '2026-10-25', '23514', 'es la del proveedor'),
      ('un banco', 'c0e60000-0000-4000-8000-0000000000f2', '57200001', '2026-10-25', '23514', 'se casa en Bancos'),
      ('fuera del plan', 'c0e60000-0000-4000-8000-0000000000f2', '55199999', '2026-10-25', '23514', 'no está en el plan'),
      ('sin validar', 'c0e60000-0000-4000-8000-0000000000f3', '55100001', '2026-10-25', '23514', 'no está por pagar'),
      ('compensación', 'c0e60000-0000-4000-8000-0000000000f4', '55100001', '2026-10-25', '23514', 'se paga con su liquidación')) t(que, factura, cuenta, fecha, codigo, frase) loop
    begin
      perform public.conta_recibida_pagar_con_cuenta('c0e20000-0000-4000-8000-0000000000e3', x.factura::uuid, x.cuenta, x.fecha::date, 'Prueba K06');
      raise exception 'PRUEBA K06 · 3 (%): se ha pagado', x.que;
    exception when others then
      if sqlerrm like 'PRUEBA K06%' then raise; end if;
      if sqlstate <> x.codigo or sqlerrm not like '%' || x.frase || '%' then raise exception 'PRUEBA K06 · 3 (%): % «%»', x.que, sqlstate, sqlerrm; end if;
      raise notice '3 · %: %', x.que, sqlerrm;
    end;
  end loop;
  if exists (select 1 from public.supplier_invoice_payment where invoice_id in ('c0e60000-0000-4000-8000-0000000000f2', 'c0e60000-0000-4000-8000-0000000000f3', 'c0e60000-0000-4000-8000-0000000000f4')) then
    raise exception 'PRUEBA K06 · 3: ha quedado un pago de las que no se pagan';
  end if;
end $$;
reset role;

-- 4 · Deshacer: la vuelta atrás quita la función; el pago se queda.
\i supabase/vuelta-atras/20261120T0840_k06_pagar_con_cuenta.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)') is not null then raise exception 'PRUEBA K06 · 4: la vuelta atrás no la quita'; end if;
  if (select count(*) from public.supplier_invoice_payment p join public.journal_entry e on e.id = p.entry_id and e.status = 'validado'
       where p.invoice_id = 'c0e60000-0000-4000-8000-0000000000f1') <> 1 then raise exception 'PRUEBA K06 · 4: el pago hecho no se ha quedado con su asiento'; end if;
  if exists (select 1 from public.bank_facturas_para_casar('c0e20000-0000-4000-8000-0000000000e3') where id = 'c0e60000-0000-4000-8000-0000000000f1') then
    raise exception 'PRUEBA K06 · 4: sin la función, Bancos vuelve a proponer la pagada';
  end if;
  if md5(pg_get_functiondef('public._bank_recibida_pagado(uuid)'::regprocedure)) <> (select valor from _k06 where clave = 'md5_pagado') then
    raise exception 'PRUEBA K06 · 4: _bank_recibida_pagado ha cambiado';
  end if;
  raise notice '4 · la vuelta atrás quita la función; el pago se queda con su asiento y Bancos no la propone; _bank_recibida_pagado, la misma (md5).';
end $$;

rollback;
