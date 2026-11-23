-- supabase/staging/sql/20261123_x29_extractos_prueba.sql
--
-- SOLO STAGING. Prueba del X29 (20261123T1712_x29_extractos_anade y 20261123T1713_x29_borradas_no_vuelven), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Lo que cambia: public.bank_importar (las borradas no entran y cuentan aparte) y public.bank_movement (el disparador
-- _bank_movimiento_no_borrado). Lo que añade: validar por movimiento, casar_plegado y la tabla de huellas borradas.
--
-- En la gestoría de ejemplo del núcleo (semillas K02, K04 y K05), con su «Banco principal», como el usuario del núcleo.
-- Datos inventados. Los caminos (regla 10), por las funciones que usa la pantalla:
--   1. Leer un extracto de cinco líneas (bank_importar): cinco nuevas.
--   2. Contabilizar en bloque tres (bank_casar, uno a uno como «Contabilizar los marcados»): uno paga una factura
--      recibida, que queda PAGADA; los otros dos a una cuenta de gasto. Los tres, validados en el diario (serie 3).
--   3. No contabilizar uno (bank_ignorar) y permitirlo otra vez (bank_desapartar).
--   4. Validar dos y quitar la validación de uno: no tocan su asiento.
--   5. Borrar líneas (bank_movimientos_borrar): la contabilizada no (y dice por qué); la otra sí. Volver a leer un
--      extracto que la trae: no entra y cuenta como borrada, aparte de las repetidas. Quitar la huella: vuelve.
--      El disparador también frena una inserción que no pasa por bank_importar.
--   6. Deshacer uno contabilizado (bank_deshacer): vuelve a estar sin contabilizar.
--   7. Regla 31: lo ya conciliado de toda la base, igual antes y después (la misma vara).
--   8. La vuelta atrás: bank_importar como antes, sin disparador y sin lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X29: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.bank_movimientos_borrar(uuid[],text)') is null or to_regclass('public.bank_movimiento_borrado') is null then
    raise exception 'PRUEBA X29 · 0: faltan la 1712 y la 1713 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _x29 (k text primary key, v text) on commit drop;
grant all on _x29 to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x29 where _x29.k = $1 $$;

create function pg_temp.vara() returns text language sql stable as $f$
  select count(distinct m.id) || ' · ' || coalesce(md5(string_agg(concat_ws('|', m.id, m.status, b.journal_entry_id, e.number, e.status, l.position, l.company_account_id, l.debit, l.credit),
                                                          ',' order by m.id, l.position)), '-')
    from public.bank_movement m join public.bank_match b on b.movement_id = m.id and b.status = 'vivo'
    join public.journal_entry e on e.id = b.journal_entry_id join public.journal_line l on l.entry_id = e.id
   where m.fingerprint not like 'x29-%'
$f$;
insert into _x29 values ('vara', pg_temp.vara());

-- 0 · Preparar (inventado): una 62600000 si no está y una factura recibida aprobada de 121,00.
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select a, emp, 'pymes', '62600000', '626', 'Servicios bancarios (prueba X29)', 'own', 'manual'
   where not exists (select 1 from public.company_account o where o.company_id = emp and o.code = '62600000');
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name)
  values ('c0e70000-0000-4000-8000-0000000002c9', a, emp, 'c0e40000-0000-4000-8000-0000000000a1', 'invoice', 'X29-PRUEBA-1', date '2026-10-20',
          'aprobada', 'manual', 100, 21, 121, false, 'prueba X29');
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 1 · Leer un extracto de cinco líneas -------------------------------------------------------------------------------------
create function pg_temp.movs(huellas text[]) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('fecha', '2026-11-1' || i, 'importe', case i when 1 then -121.00 else -(10 + i) end,
                                      'concepto_banco', 'PRUEBA X29 ' || h, 'concepto_limpio', 'Prueba X29 ' || h, 'huella', 'x29-' || h, 'huella_suave', 'x29s-' || h) order by i)
    from unnest(huellas) with ordinality t(h, i)
$f$;
do $$
declare r jsonb;
begin
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'norma43', 'x29-prueba-1.n43', repeat('a', 64), date '2026-11-11', date '2026-11-15',
                            null, null, 'Prueba X29', null, pg_temp.movs(array['uno', 'dos', 'tres', 'cuatro', 'cinco']));
  if (r->>'nuevos')::int <> 5 or (r->>'repetidos')::int <> 0 or (r->>'borradas')::int <> 0 then raise exception 'PRUEBA X29 · 1: %', r; end if;
  insert into _x29 select 'm_' || replace(fingerprint, 'x29-', ''), id from public.bank_movement where treasury_account_id = 'c0e20000-0000-4000-8000-0000000000b0' and fingerprint like 'x29-%';
  raise notice 'PRUEBA X29 · 1: leído, 5 nuevas, 0 repetidas, 0 borradas.';
end $$;

-- 2 · Contabilizar en bloque tres: uno paga la factura; dos a la 62600000 -------------------------------------------------
do $$
declare r jsonb; v_inv public.supplier_invoice; n int;
begin
  r := public.bank_casar(pg_temp.p('m_uno')::uuid, jsonb_build_object('tipo', 'factura_recibida',
         'facturas', jsonb_build_array(jsonb_build_object('id', 'c0e70000-0000-4000-8000-0000000002c9', 'importe', 121.00)), 'cuenta_tercero', '40000071'),
         'probable', 'Mismo importe que X29-PRUEBA-1', '[]', 'persona', null);
  insert into _x29 values ('b_uno', r->>'match');
  r := public.bank_casar(pg_temp.p('m_dos')::uuid, '{"tipo":"cuenta","concepto":"Comisión","lineas":[{"cuenta":"62600000","importe":12}]}', 'probable', 'Lo dijiste tú', '[]', 'persona', null);
  insert into _x29 values ('b_dos', r->>'match');
  r := public.bank_casar(pg_temp.p('m_tres')::uuid, '{"tipo":"cuenta","concepto":"Comisión","lineas":[{"cuenta":"62600000","importe":13}]}', 'probable', 'Lo dijiste tú', '[]', 'persona', null);
  select * into v_inv from public.supplier_invoice where id = 'c0e70000-0000-4000-8000-0000000002c9';
  select count(*) into n from public.bank_movement m join public.bank_match b on b.movement_id = m.id and b.status = 'vivo'
    join public.journal_entry e on e.id = b.journal_entry_id
   where m.id in (pg_temp.p('m_uno')::uuid, pg_temp.p('m_dos')::uuid, pg_temp.p('m_tres')::uuid) and m.status = 'casado' and e.status = 'validado' and e.series = 3;
  if n <> 3 or v_inv.status <> 'pagada' then raise exception 'PRUEBA X29 · 2: % de 3 en el diario; la factura, %.', n, v_inv.status; end if;
  raise notice 'PRUEBA X29 · 2: tres contabilizados en bloque (serie 3, validados); la factura X29-PRUEBA-1, pagada.';
end $$;

-- 3 · No contabilizar uno y permitirlo otra vez ---------------------------------------------------------------------------
do $$ begin
  perform public.bank_ignorar(pg_temp.p('m_cuatro')::uuid, 'No es de la empresa (prueba X29)');
  if (select status from public.bank_movement where id = pg_temp.p('m_cuatro')::uuid) <> 'ignorado' then raise exception 'PRUEBA X29 · 3: no ha quedado sin contabilizar'; end if;
  perform public.bank_desapartar(pg_temp.p('m_cuatro')::uuid);
  if (select status from public.bank_movement where id = pg_temp.p('m_cuatro')::uuid) = 'ignorado' then raise exception 'PRUEBA X29 · 3: no se ha permitido otra vez'; end if;
  raise notice 'PRUEBA X29 · 3: «No contabilizar» y «Permitir contabilizar», ida y vuelta.';
end $$;

-- 4 · Validar dos y quitar la validación de uno: el asiento no cambia -------------------------------------------------------
do $$
declare r jsonb; h text;
begin
  select hash into h from public.journal_entry where id = (select journal_entry_id from public.bank_match where id = pg_temp.p('b_dos')::uuid);
  r := public.bank_validar(array[pg_temp.p('m_dos')::uuid, pg_temp.p('m_cuatro')::uuid], 'Prueba X29');
  if (r->>'validados')::int <> 2 or r->>'texto' <> 'Validados: 2 movimientos.' then raise exception 'PRUEBA X29 · 4: validar (%)', r; end if;
  r := public.bank_validar(array[pg_temp.p('m_dos')::uuid], 'Prueba X29');
  if (r->>'ya')::int <> 1 then raise exception 'PRUEBA X29 · 4: validar dos veces (%)', r; end if;
  r := public.bank_quitar_validacion(array[pg_temp.p('m_cuatro')::uuid]);
  if (r->>'quitadas')::int <> 1 or (select validated_at from public.bank_movement where id = pg_temp.p('m_cuatro')::uuid) is not null
     or (select validated_by_name from public.bank_movement where id = pg_temp.p('m_dos')::uuid) <> 'Prueba X29' then
    raise exception 'PRUEBA X29 · 4: quitar la validación (%)', r;
  end if;
  if (select hash from public.journal_entry where id = (select journal_entry_id from public.bank_match where id = pg_temp.p('b_dos')::uuid)) <> h then
    raise exception 'PRUEBA X29 · 4: validar ha tocado el asiento';
  end if;
  raise notice 'PRUEBA X29 · 4: validados 2, quitada la validación de 1; el asiento, igual.';
end $$;

-- 5 · Borrar líneas: la contabilizada no; la otra sí, y no vuelve ------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := public.bank_movimientos_borrar(array[pg_temp.p('m_dos')::uuid, pg_temp.p('m_cinco')::uuid], 'Prueba X29');
  if (r->>'borradas')::int <> 1 or jsonb_array_length(r->'no') <> 1 or r->'no'->>0 not like '%está contabilizada: deshazla antes'
     or exists (select 1 from public.bank_movement where id = pg_temp.p('m_cinco')::uuid)
     or not exists (select 1 from public.bank_movement where id = pg_temp.p('m_dos')::uuid) then
    raise exception 'PRUEBA X29 · 5: borrar (%)', r;
  end if;
  insert into _x29 values ('borrar', r->>'texto');
  -- Otro extracto que trae la borrada y dos que ya estaban: la borrada no entra y cuenta aparte.
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'norma43', 'x29-prueba-2.n43', repeat('b', 64), date '2026-11-11', date '2026-11-16',
                            null, null, 'Prueba X29', null, pg_temp.movs(array['uno', 'dos', 'cinco', 'seis']));
  if (r->>'nuevos')::int <> 1 or (r->>'repetidos')::int <> 2 or (r->>'borradas')::int <> 1
     or exists (select 1 from public.bank_movement where fingerprint = 'x29-cinco') then
    raise exception 'PRUEBA X29 · 5: la borrada ha vuelto o no cuenta aparte (%)', r;
  end if;
  if not exists (select 1 from public.bank_activity_log where statement_id = (r->>'extracto')::uuid and summary like '%2 que ya estaban · 1 borrada antes%') then
    raise exception 'PRUEBA X29 · 5: el registro no dice la borrada aparte';
  end if;
  insert into _x29 values ('reimportar', r::text);
end $$;
reset role;
do $$ begin
  -- El disparador, como red: una inserción que no pasa por bank_importar tampoco la mete.
  insert into public.bank_movement (account_id, company_id, treasury_account_id, op_date, value_date, amount, bank_concept, clean_concept, fingerprint, soft_fingerprint, status)
  values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', 'c0e20000-0000-4000-8000-0000000000b0', date '2026-11-15', date '2026-11-15',
          -15, 'PRUEBA X29 CINCO', 'Prueba X29 cinco', 'x29-cinco', 'x29s-otra', 'pendiente');
  if exists (select 1 from public.bank_movement where fingerprint = 'x29-cinco') then raise exception 'PRUEBA X29 · 5: el disparador no la frena'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.bank_movimiento_borrado_quitar('c0e20000-0000-4000-8000-0000000000b0', 'x29-cinco');
  if not (r->>'quitada')::boolean then raise exception 'PRUEBA X29 · 5: quitar la huella (%)', r; end if;
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'norma43', 'x29-prueba-3.n43', repeat('c', 64), date '2026-11-15', date '2026-11-15',
                            null, null, 'Prueba X29', null, pg_temp.movs(array['cinco']));
  if (r->>'nuevos')::int <> 1 or (r->>'borradas')::int <> 0 then raise exception 'PRUEBA X29 · 5: quitada la huella, no vuelve (%)', r; end if;
  raise notice 'PRUEBA X29 · 5: «%». Al volver a leer: %. El disparador la frena también por otro camino. Quitada la huella, vuelve.',
    pg_temp.p('borrar'), pg_temp.p('reimportar');
end $$;

-- 6 · Deshacer uno contabilizado -------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_b uuid := (select id from public.bank_match where movement_id = pg_temp.p('m_tres')::uuid and status = 'vivo');
begin
  r := public.bank_deshacer(v_b, 'Prueba X29: deshacer desde Extractos');
  if exists (select 1 from public.bank_match where movement_id = pg_temp.p('m_tres')::uuid and status = 'vivo')
     or (select status from public.bank_movement where id = pg_temp.p('m_tres')::uuid) = 'casado' then
    raise exception 'PRUEBA X29 · 6: deshecho, sigue contabilizado (%)', r;
  end if;
  raise notice 'PRUEBA X29 · 6: deshecho («%»); vuelve a estar sin contabilizar.', r;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 7 · Regla 31 --------------------------------------------------------------------------------------------------------------
do $$ begin
  if pg_temp.vara() <> pg_temp.p('vara') then raise exception 'PRUEBA X29 · 7: lo ya conciliado ha cambiado: antes %, después %.', pg_temp.p('vara'), pg_temp.vara(); end if;
  raise notice 'PRUEBA X29 · 7: lo ya conciliado de toda la base, antes % y después %.', pg_temp.p('vara'), pg_temp.vara();
end $$;

-- 8 · La vuelta atrás -------------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261123T1713_x29_borradas_no_vuelven.down.sql
\i supabase/vuelta-atras/20261123T1712_x29_extractos_anade.down.sql
do $$ begin
  if to_regclass('public.bank_movimiento_borrado') is not null or to_regprocedure('public.bank_validar(uuid[],text)') is not null
     or exists (select 1 from pg_trigger where tgname = 'trg_bank_movimiento_no_borrado')
     or exists (select 1 from information_schema.columns where table_name = 'bank_movement' and column_name = 'validated_at')
     or strpos(pg_get_functiondef('public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)'::regprocedure), 'X29') > 0 then
    raise exception 'PRUEBA X29 · 8: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X29 · 8: la vuelta atrás deja bank_importar como antes, sin disparador y sin lo nuevo.';
  raise notice 'PRUEBA X29: 8 de 8 bien.';
end $$;

rollback;
