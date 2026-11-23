-- supabase/staging/sql/20261123_k10c_varios_pagos_prueba.sql
--
-- SOLO STAGING. Prueba del K10c (20261123T0920_k10c_varios_pagos), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra lo nuevo: public.conta_recibida_pago_apuntar,
-- public.conta_recibida_pago_se_puede_cambiar, public.conta_recibida_pago_cambiar, public.conta_recibida_pago_borrar y
-- public._conta_k10c_estado. No cambia nada que exista.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. Proveedor, cuentas, facturas y movimientos del
-- banco inventados (T11). Por sus CAMINOS (regla 10): la recibida se propone y se valida (journal_entry_proponer y
-- journal_entry_validar), los pagos se apuntan, se cambian y se borran con las funciones nuevas, y la conciliación va
-- por Bancos (bank_importar y bank_casar), como la pantalla.
--   1. Una factura de 121,00 pagada en dos: 60,00 con una cuenta y 61,00 con otra. Tras el primero, pagada en parte
--      (faltan 61,00); tras el segundo, pagada. Cada pago, su asiento validado en la serie 4.
--   2. Un tercer pago que se pasa del total: rechazado (antes del segundo, uno de 62,00; después, uno de 1,00).
--   3. Cambiar el segundo (otra cuenta y otro concepto): el mismo número; su huella cambia y la cadena sigue íntegra.
--   4. Borrar el primero: la factura vuelve a pagada en parte (faltan 60,00), su asiento se borra y la serie se
--      renumera sin huecos; y volver a apuntarlo la deja pagada.
--   5. Conciliar uno con el banco: otra factura casada en Bancos con su movimiento; ese pago no se cambia ni se borra
--      aquí («se deshace en Bancos»).
--   6. La vuelta atrás quita las funciones; los pagos y asientos se quedan como quedaron, con la cadena íntegra.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K10c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_recibida_pago_apuntar(uuid,uuid,text,date,numeric,text,text)') is null then raise exception 'PRUEBA K10c · 0: falta la 0920 delante.'; end if;
end $$;
set local statement_timeout = '120s';
create temp table _k10c (clave text primary key, valor text) on commit drop;
grant all on _k10c to authenticated;

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; k record;
begin
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values
    ('c0f40000-0000-4000-8000-0000000000a1', a, 'Proveedor de Prueba K10c, S.L.', 'B00011213', 'ES', 'general');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '40000099', '4000', 'Proveedor de Prueba K10c', 'own', 'manual'),
    (a, emp, 'pymes', '62900099', '629', 'Otros servicios de prueba K10c', 'own', 'manual'),
    (a, emp, 'pymes', '55100099', '551', 'Cuenta corriente con socio de prueba K10c', 'own', 'manual'),
    (a, emp, 'pymes', '55500099', '555', 'Partidas pendientes de prueba K10c', 'own', 'manual')
  on conflict (company_id, code) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, emp, c.id, 'supplier', 'c0f40000-0000-4000-8000-0000000000a1', 'principal', 'manual' from public.company_account c where c.company_id = emp and c.code = '40000099';
  for k in select * from (values ('f1', 'K10C-DOS-PAGOS'), ('f2', 'K10C-BANCO')) v(n, numero) loop
    insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                         tax_base_total, tax_total, grand_total, needs_review, created_by_name, created_at)
    values (('c0f40000-0000-4000-8000-0000000000' || k.n)::uuid, a, emp, 'c0f40000-0000-4000-8000-0000000000a1', 'invoice', k.numero, date '2026-11-05',
            'aprobada', 'manual', 100, 21, 121, false, 'prueba K10c', timestamptz '2026-11-05 10:00+01');
  end loop;
end $$;

-- La recibida por la propuesta, como la pantalla, y validada.
create or replace function pg_temp.k10c_recibida(p_factura uuid) returns uuid language plpgsql as $$
declare
  t uuid := (select id from public.tax_rate where is_system and code = 'iva_general' and valid_to is null);
  v_num text := (select invoice_number from public.supplier_invoice where id = p_factura); v_r jsonb; v_e uuid;
begin
  v_r := public.journal_entry_proponer('c0e20000-0000-4000-8000-0000000000e3',
    jsonb_build_object('series', 2, 'fecha', date '2026-11-05', 'concepto', 'Prueba K10c · ' || v_num, 'source_type', 'supplier_invoice', 'source_id', p_factura,
                       'confianza', 'seguro', 'porque', 'prueba K10c', 'documento', v_num),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62900099', 'debe', 100, 'haber', 0, 'comun', true, 'documento', v_num),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', v_num,
                         'iva', jsonb_build_object('tipo_id', t, 'base', 100, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '40000099', 'debe', 0, 'haber', 121, 'comun', true, 'documento', v_num)), null, 'Prueba K10c');
  v_e := (v_r ->> 'id')::uuid;
  perform public.journal_entry_validar(v_e, 'Prueba K10c');
  update public.supplier_invoice set journal_entry_id = v_e where id = p_factura;
  return v_e;
end $$;
create or replace function pg_temp.k10c_estado(p_factura uuid) returns text language sql as $$
  select estado || ' · pendiente ' || pendiente from public.conta_recibida_pago where invoice_id = p_factura
$$;
create or replace function pg_temp.k10c_huella(p_entry uuid) returns text language sql as $$
  select left(md5(public.journal_entry_canonico(p_entry)), 12)
$$;
grant execute on function pg_temp.k10c_recibida(uuid) to authenticated;
grant execute on function pg_temp.k10c_estado(uuid) to authenticated;
grant execute on function pg_temp.k10c_huella(uuid) to authenticated;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; f1 constant uuid := 'c0f40000-0000-4000-8000-0000000000f1';
  r1 jsonb; r2 jsonb; v_msg text; v_num2 int;
begin
  perform pg_temp.k10c_recibida(f1);
  -- 1 · Dos pagos con dos cuentas.
  r1 := public.conta_recibida_pago_apuntar(emp, f1, '55100099', date '2026-11-10', 60, 'Primer pago K10c', 'Prueba K10c');
  if pg_temp.k10c_estado(f1) not like 'pagada_parte · pendiente 61.00' then raise exception 'PRUEBA K10c · 1: tras el primer pago, %', pg_temp.k10c_estado(f1); end if;
  -- 2 · Uno que se pasa: rechazado.
  begin perform public.conta_recibida_pago_apuntar(emp, f1, '55500099', date '2026-11-11', 62, null, 'Prueba K10c'); exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ 'pasa del total' then raise exception 'PRUEBA K10c · 2: uno de 62,00 con 61,00 pendientes (%)', v_msg; end if;
  r2 := public.conta_recibida_pago_apuntar(emp, f1, '55500099', date '2026-11-11', 61, 'Segundo pago K10c', 'Prueba K10c');
  if pg_temp.k10c_estado(f1) not like 'pagada · pendiente 0.00' or (select status from public.supplier_invoice where id = f1) <> 'pagada' then
    raise exception 'PRUEBA K10c · 1: tras el segundo pago, % (%)', pg_temp.k10c_estado(f1), (select status from public.supplier_invoice where id = f1);
  end if;
  v_msg := null;
  begin perform public.conta_recibida_pago_apuntar(emp, f1, '55500099', date '2026-11-12', 1, null, 'Prueba K10c'); exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'PRUEBA K10c · 2: un tercer pago con la factura pagada se ha apuntado'; end if;
  insert into _k10c values ('p1', r1->>'pago'), ('e1', r1->>'asiento'), ('p2', r2->>'pago'), ('e2', r2->>'asiento'), ('n2', r2->>'numero'),
                           ('h1', pg_temp.k10c_huella((r1->>'asiento')::uuid)), ('h2', pg_temp.k10c_huella((r2->>'asiento')::uuid));
  raise notice 'PRUEBA K10c · 1: 121,00 en dos pagos: 60,00 con la 55100099 (asiento 4 / %, huella %) y 61,00 con la 55500099 (asiento 4 / %, huella %): pagada.',
    r1->>'numero', pg_temp.k10c_huella((r1->>'asiento')::uuid), r2->>'numero', pg_temp.k10c_huella((r2->>'asiento')::uuid);
  raise notice 'PRUEBA K10c · 2: uno que se pasa, rechazado («%»); y otro más con la factura pagada, también.', left(coalesce(v_msg, ''), 90);

  -- 3 · Cambiar el segundo: el mismo número.
  r2 := public.conta_recibida_pago_cambiar((r2->>'pago')::uuid, '55100099', date '2026-11-12', 61, 'Segundo pago K10c, cambiado', 'Prueba K10c');
  if (r2->>'numero')::int <> (select valor::int from _k10c where clave = 'n2') then raise exception 'PRUEBA K10c · 3: ha cambiado el número (%)', r2; end if;
  if pg_temp.k10c_huella((select valor::uuid from _k10c where clave = 'e2')) = (select valor from _k10c where clave = 'h2') then raise exception 'PRUEBA K10c · 3: la huella no ha cambiado'; end if;
  if (select c.code from public.journal_line l join public.company_account c on c.id = l.company_account_id where l.entry_id = (select valor::uuid from _k10c where clave = 'e2') and l.credit > 0) <> '55100099' then
    raise exception 'PRUEBA K10c · 3: el asiento no lleva la cuenta nueva';
  end if;
  raise notice 'PRUEBA K10c · 3: «%» (huella % → %).', r2->>'frase', (select valor from _k10c where clave = 'h2'), pg_temp.k10c_huella((select valor::uuid from _k10c where clave = 'e2'));

  -- 4 · Borrar el primero, y volver a apuntarlo.
  v_num2 := (select number from public.journal_entry where id = (select valor::uuid from _k10c where clave = 'e2'));
  r1 := public.conta_recibida_pago_borrar((select valor::uuid from _k10c where clave = 'p1'), 'Prueba K10c: el primero se apuntó con la cuenta que no era', 'Prueba K10c');
  if pg_temp.k10c_estado(f1) not like 'pagada_parte · pendiente 60.00' or (select status from public.supplier_invoice where id = f1) <> 'aprobada' then
    raise exception 'PRUEBA K10c · 4: tras borrar el primero, % (%)', pg_temp.k10c_estado(f1), (select status from public.supplier_invoice where id = f1);
  end if;
  if exists (select 1 from public.journal_entry where id = (select valor::uuid from _k10c where clave = 'e1')) then raise exception 'PRUEBA K10c · 4: su asiento sigue ahí'; end if;
  raise notice 'PRUEBA K10c · 4: «%» El segundo pasa del 4 / % al 4 / %; la factura, pagada en parte (faltan 60,00).',
    r1->>'frase', v_num2, (select number from public.journal_entry where id = (select valor::uuid from _k10c where clave = 'e2'));
  r1 := public.conta_recibida_pago_apuntar(emp, f1, '55100099', date '2026-11-13', 60, 'Primer pago K10c, otra vez', 'Prueba K10c');
  if (select status from public.supplier_invoice where id = f1) <> 'pagada' then raise exception 'PRUEBA K10c · 4: vuelto a apuntar, no queda pagada'; end if;
  raise notice 'PRUEBA K10c · 4: vuelto a apuntar: %', r1->>'frase';
end $$;
reset role;

-- 5 · Conciliar uno con el banco (Bancos, como la pantalla).
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  f2 constant uuid := 'c0f40000-0000-4000-8000-0000000000f2'; r jsonb; x jsonb; v_mov uuid; v_pago uuid; v_se jsonb; v_msg text;
begin
  perform pg_temp.k10c_recibida(f2);
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'csv:bbva', 'prueba-k10c.xlsx', repeat('d', 64), date '2026-11-14', date '2026-11-14', null, null, 'prueba', null,
         jsonb_build_array(jsonb_build_object('fecha', '2026-11-14', 'importe', -121.00, 'concepto_banco', 'TRANSFERENCIA K10C', 'concepto_limpio', 'Transferencia k10c',
                                              'contraparte', 'PROVEEDOR K10C', 'tipo', 'TRANSFERENCIAS', 'huella', 'k10c-banco-1', 'huella_suave', 'k10c-banco-s1')));
  select id into v_mov from public.bank_movement where statement_id = (r->>'extracto')::uuid and bank_concept = 'TRANSFERENCIA K10C' order by created_at desc limit 1;
  x := public.bank_casar(v_mov, jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', f2, 'importe', 121.00)),
         'cuenta_tercero', '40000099', 'tercero_id', null, 'concepto', 'Pago a Proveedor K10c'), 'probable', 'prueba', '[]'::jsonb, 'persona', null);
  select id into v_pago from public.supplier_invoice_payment where invoice_id = f2 and bank_match_id is not null;
  if v_pago is null then raise exception 'PRUEBA K10c · 5: casar no ha escrito el pago (%)', x; end if;
  v_se := public.conta_recibida_pago_se_puede_cambiar(v_pago);
  if (v_se->>'puede')::boolean or v_se->>'porque' !~ 'conciliado' then raise exception 'PRUEBA K10c · 5: un pago conciliado se podría cambiar (%)', v_se; end if;
  begin perform public.conta_recibida_pago_borrar(v_pago, 'prueba', 'Prueba K10c'); exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from v_se->>'porque' then raise exception 'PRUEBA K10c · 5: borrar uno conciliado (%)', v_msg; end if;
  raise notice 'PRUEBA K10c · 5: casada en Bancos: pagada; su pago no se cambia ni se borra aquí: «%»', v_msg;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · La vuelta atrás.
\i supabase/vuelta-atras/20261123T0920_k10c_varios_pagos.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_pago_apuntar(uuid,uuid,text,date,numeric,text,text)') is not null
     or to_regprocedure('public.conta_recibida_pago_borrar(uuid,text,text)') is not null then
    raise exception 'PRUEBA K10c · 6: la vuelta atrás no quita las funciones';
  end if;
  if public._conta_cadena_rota('c0e20000-0000-4000-8000-0000000000e3') <> 0 then raise exception 'PRUEBA K10c · 6: la cadena no cuadra'; end if;
  raise notice 'PRUEBA K10c · 6: la vuelta atrás quita las funciones; la cadena, íntegra.';
end $$;

rollback;
