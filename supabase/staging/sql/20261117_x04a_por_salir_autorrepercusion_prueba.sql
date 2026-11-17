-- supabase/staging/sql/20261117_x04a_por_salir_autorrepercusion_prueba.sql
--
-- SOLO STAGING. Prueba del X04a (20261117T1550_x04a_por_salir_autorrepercusion),
-- que el ensayo de staging pone delante en la misma sesión. Todo en una
-- transacción con ROLLBACK: staging no cambia. Nombra el objeto que cambia:
-- public.conta_erp10_por_salir(uuid,date).
--
-- Con una empresa inventada de la cuenta A, creada aquí, y los asientos validados
-- por el camino de verdad (journal_entry_validar):
--   1. Una inversión del sujeto pasivo y una compra intracomunitaria (la
--      autorrepercusión en la 477 sin tipo) salen, como recibidas, sin aviso.
--   2. Una recibida normal y una emitida siguen saliendo igual.
--   3. Si el IVA del asiento no es el de su libro, el aviso sigue, con el importe
--      con coma decimal y punto de miles.
--   4. La vuelta atrás deja la función como la dejó la X02: la ISP vuelve a no
--      salir, con el aviso de antes (la prueba de que el arreglo es lo que cambia).
--
-- Sin datos reales (T11): nombres inventados, que se ven inventados.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X04a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if (select count(*) from pg_proc where proname = 'conta_erp10_por_salir') <> 1 then
    raise exception 'PRUEBA X04a: conta_erp10_por_salir tiene más de una firma (regla 2).';
  end if;
end $$;
set local statement_timeout = '120s';

-- La empresa inventada y sus asientos (administrador de A) --------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c uuid; y uuid; x record; e uuid; cu jsonb; t21 uuid; tisp uuid; tue uuid; k record;
begin
  insert into public.company (account_id, legal_name) values (a, 'Empresa Inventada X04a, S.L.') returning id into c;
  perform set_config('x04a.c', c::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  for x in select * from (values
      ('62200000', '622', 'Reparaciones', 'template'), ('62900000', '629', 'Otros servicios', 'template'), ('70000000', '700', 'Ventas', 'template'),
      ('47200000', '472', 'IVA soportado', 'template'), ('47700000', '477', 'IVA repercutido', 'template'),
      ('40000001', '4000', 'Proveedor Inventado X04a', 'own'), ('43000001', '4300', 'Cliente Inventado X04a', 'own')
    ) v(codigo, plantilla, nombre, clase) loop
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', x.codigo, x.plantilla, x.nombre, x.clase, 'manual');
  end loop;
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;
  select id into t21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  select id into tisp from public.tax_rate where is_system and code = 'isp' and valid_to is null;
  select id into tue from public.tax_rate where is_system and code = 'ue_compra' and valid_to is null;
  if t21 is null or tisp is null or tue is null then raise exception 'PRUEBA X04a: faltan los tipos de IVA del sistema (iva_general, isp, ue_compra).'; end if;
  perform public.conta_erp10_salida_poner(c, true, '0009', 8, '2026-10-01');

  -- La ISP y la intracomunitaria: el soportado con su libro y la autorrepercusión en la 477 sin tipo.
  for k in select * from (values ('isp', '62200000', tisp, 'X04a-ISP'), ('ue', '62900000', tue, 'X04a-UE')) v(clave, gasto, tipo, numero) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
    values (a, c, y, 4, '2026-10-06', 'Inventada X04a · ' || k.clave, 'manual', k.numero, '2026-10-02') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date)
    values (a, c, e, 1, (cu ->> k.gasto)::uuid, 1000, 0, null, null, null, null, null, null),
           (a, c, e, 2, (cu ->> '47200000')::uuid, 210, 0, k.tipo, 1000, 'received', 'yes', k.numero, '2026-10-02'),
           (a, c, e, 3, (cu ->> '47700000')::uuid, 0, 210, null, null, null, null, null, null),
           (a, c, e, 4, (cu ->> '40000001')::uuid, 0, 1000, null, null, null, null, null, null);
    perform public.journal_entry_validar(e);
    perform set_config('x04a.' || k.clave, e::text, true);
  end loop;

  -- Una recibida normal y una emitida.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
  values (a, c, y, 4, '2026-10-07', 'Recibida inventada X04a', 'manual', 'X04a-R', '2026-10-07') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date)
  values (a, c, e, 1, (cu ->> '62900000')::uuid, 100, 0, null, null, null, null, null, null),
         (a, c, e, 2, (cu ->> '47200000')::uuid, 21, 0, t21, 100, 'received', 'yes', 'X04a-R', '2026-10-07'),
         (a, c, e, 3, (cu ->> '40000001')::uuid, 0, 121, null, null, null, null, null, null);
  perform public.journal_entry_validar(e);
  perform set_config('x04a.recibida', e::text, true);
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
  values (a, c, y, 1, '2026-10-08', 'Emitida inventada X04a', 'customer_invoice', 'X04a-E', '2026-10-08') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, document_ref, document_date)
  values (a, c, e, 1, (cu ->> '43000001')::uuid, 1452, 0, null, null, null, null, null),
         (a, c, e, 2, (cu ->> '70000000')::uuid, 0, 1200, null, null, null, null, null),
         (a, c, e, 3, (cu ->> '47700000')::uuid, 0, 252, t21, 1200, 'issued', 'X04a-E', '2026-10-08');
  perform public.journal_entry_validar(e);
  perform set_config('x04a.emitida', e::text, true);
end $$;

-- 1 y 2 · Salen la ISP, la intracomunitaria, la recibida y la emitida -----------------------------
do $$
declare r jsonb; p jsonb; k record;
begin
  r := public.conta_erp10_por_salir(current_setting('x04a.c')::uuid, '2026-10-01');
  for k in select * from (values ('isp', 'recibida'), ('ue', 'recibida'), ('recibida', 'recibida'), ('emitida', 'emitida')) v(clave, clase) loop
    select x into p from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x04a.' || k.clave);
    if p is null then raise exception 'PRUEBA X04a · 1: «%» no está en lo que sale.', k.clave; end if;
    if p ->> 'clase' <> k.clase or not (p ->> 'sale')::boolean
       or exists (select 1 from jsonb_array_elements_text(p -> 'avisos') t where t like 'El IVA del asiento%') then
      raise exception 'PRUEBA X04a · 1: «%» sale como «%» (sale: %) con avisos %.', k.clave, p ->> 'clase', p ->> 'sale', p -> 'avisos';
    end if;
  end loop;
  raise notice 'PRUEBA X04a · 1 y 2 bien: la ISP y la intracomunitaria salen como recibidas, sin el aviso del IVA; la recibida y la emitida, igual.';
end $$;

-- 3 · Si el IVA no es el del libro, el aviso sigue, con coma decimal -------------------------------
do $$
declare r jsonb; p jsonb;
begin
  -- Se toca el libro de la emitida (solo dentro de esta transacción) para que no cuadre.
  update public.vat_book_entry set tax_amount = 1234.5 where entry_id = current_setting('x04a.emitida')::uuid;
  r := public.conta_erp10_por_salir(current_setting('x04a.c')::uuid, '2026-10-01');
  select x into p from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x04a.emitida');
  if (p ->> 'sale')::boolean or p -> 'avisos' ->> 0 <> 'El IVA del asiento (252,00 €) no es el de su registro de IVA (1.234,50 €): no sale.' then
    raise exception 'PRUEBA X04a · 3: la emitida descuadrada sale % con avisos %.', p ->> 'sale', p -> 'avisos';
  end if;
  raise notice 'PRUEBA X04a · 3 bien: %', p -> 'avisos' ->> 0;
end $$;

-- 4 · La vuelta atrás: la función de la X02, que deja fuera la ISP -----------------------------------
\i supabase/vuelta-atras/20261117T1550_x04a_por_salir_autorrepercusion.down.sql
do $$
declare r jsonb; p jsonb;
begin
  if (select count(*) from pg_proc where proname = 'conta_erp10_por_salir') <> 1 then
    raise exception 'PRUEBA X04a · 4: después de la vuelta atrás, conta_erp10_por_salir tiene más de una firma.';
  end if;
  r := public.conta_erp10_por_salir(current_setting('x04a.c')::uuid, '2026-10-01');
  select x into p from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x04a.isp');
  if (p ->> 'sale')::boolean or p -> 'avisos' ->> 0 not like 'El IVA del asiento (420.00 €)%' then
    raise exception 'PRUEBA X04a · 4: con la función de la X02, la ISP sale % con avisos %.', p ->> 'sale', p -> 'avisos';
  end if;
  raise notice 'PRUEBA X04a: 4 de 4 bien. Con la de la X02, la ISP no salía: «%».', p -> 'avisos' ->> 0;
end $$;
select set_config('request.jwt.claims', '', true);

rollback;
