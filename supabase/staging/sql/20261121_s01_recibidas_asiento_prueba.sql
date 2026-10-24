-- supabase/staging/sql/20261121_s01_recibidas_asiento_prueba.sql
--
-- SOLO STAGING. La 0150 del S01 (cambia: banco_facturas_recibidas_pendientes),
-- por sus caminos:
--   1. Si staging aún no la tiene, se aplica aquí, dentro de la transacción.
--   2. El contrato no cambia: las mismas columnas, con el mismo nombre, tipo y
--      orden (pg_get_function_result contra el literal del contrato).
--   3. COMO USUARIO de A: una factura pendiente de su empresa sin asiento sale
--      con journal_entry_id nulo; con un asiento vivo de esa factura (borrador),
--      sale con ESE asiento; borrado el asiento, nula otra vez. Y las demás
--      facturas no cambian (las mismas filas antes y después).
--   4. La vuelta atrás, de verdad: el cuerpo queda byte a byte como el de
--      antes (md5 de pg_get_functiondef = f6e2f68f6d1fcec1618f255e57929812,
--      el de producción y staging el 17/10) y journal_entry_id vuelve a ser la
--      columna de la factura (nula).
--
-- Todo acaba en ROLLBACK: staging no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 recibidas: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 1 · La 0150, si falta (aplicada, el cuerpo lee journal_entry por source_id).
select position('e.source_id = i.id' in pg_get_functiondef('public.banco_facturas_recibidas_pendientes(uuid, date)'::regprocedure)) = 0 as falta_0150 \gset
\if :falta_0150
\echo '>>> Staging aún no tiene la 0150 del S01: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261121T0150_s01_recibidas_asiento_por_origen.sql
\endif

-- 2 · El contrato.
do $$
declare v text := pg_get_function_result('public.banco_facturas_recibidas_pendientes(uuid, date)'::regprocedure);
begin
  if v <> 'TABLE(invoice_id uuid, supplier_id uuid, supplier_name text, supplier_tax_id text, invoice_number text, invoice_date date, due_date date, total numeric, pending numeric, read_iban text, journal_entry_id uuid, status text)' then
    raise exception 'PRUEBA S01 recibidas 2: el contrato ha cambiado: %', v;
  end if;
  raise notice 'S01 recibidas 2: el contrato es el mismo (12 columnas, mismo nombre, tipo y orden).';
end $$;

-- La factura de la prueba: pendiente, de la empresa A, sin asiento vivo.
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  f uuid;
begin
  select i.id into f from public.supplier_invoice i
   where i.account_id = a and i.company_id = emp and i.status in ('en_revision', 'aprobada', 'con_discrepancias')
     and i.paid_at is null and i.doc_kind = 'invoice'
     and not exists (select 1 from public.journal_entry e where e.company_id = emp and e.source_type = 'supplier_invoice'
                      and e.source_id = i.id and e.status in ('propuesto', 'borrador', 'validado'))
   order by i.invoice_date, i.id limit 1;
  if f is null then raise exception 'PRUEBA S01 recibidas: la empresa A no tiene ninguna factura pendiente sin asiento.'; end if;
  perform set_config('prueba_recibidas.factura', f::text, true);
end $$;

-- 3 · Como usuario de A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  f constant uuid := current_setting('prueba_recibidas.factura')::uuid;
  v uuid; n int; nulas_antes int;
begin
  select journal_entry_id into v from public.banco_facturas_recibidas_pendientes(emp) where invoice_id = f;
  if not found then raise exception 'PRUEBA S01 recibidas 3a: A no ve su factura pendiente.'; end if;
  if v is not null then raise exception 'PRUEBA S01 recibidas 3a: sin asiento, journal_entry_id tenía que ser nulo y es %.', v; end if;
  -- Como A: sin usuario, la función dice «Esa empresa no está» (pide ser de la cuenta).
  select count(*), count(*) filter (where journal_entry_id is null) into n, nulas_antes from public.banco_facturas_recibidas_pendientes(emp);
  perform set_config('prueba_recibidas.filas', n::text, true);
  perform set_config('prueba_recibidas.nulas', nulas_antes::text, true);
  raise notice 'S01 recibidas 3a: la factura sin asiento sale con journal_entry_id nulo.';
end $$;
reset role;

-- El asiento vivo de esa factura, en borrador (como postgres: es la preparación).
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_y uuid; e uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026' and status = 'open';
  if v_y is null then raise exception 'PRUEBA S01 recibidas: falta el ejercicio 2026 abierto de la empresa A.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id)
  values (a, emp, v_y, 2, '2026-10-13', 'Prueba de la 0150 · factura recibida', 'supplier_invoice', current_setting('prueba_recibidas.factura')::uuid)
  returning id into e;
  perform set_config('prueba_recibidas.asiento', e::text, true);
end $$;

set local role authenticated;
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  f constant uuid := current_setting('prueba_recibidas.factura')::uuid;
  e constant uuid := current_setting('prueba_recibidas.asiento')::uuid;
  v uuid; n int; nulas int;
begin
  select journal_entry_id into v from public.banco_facturas_recibidas_pendientes(emp) where invoice_id = f;
  if v is distinct from e then raise exception 'PRUEBA S01 recibidas 3b: con su asiento vivo tenía que salir %, sale %.', e, coalesce(v::text, 'nulo'); end if;
  select count(*), count(*) filter (where journal_entry_id is null) into n, nulas from public.banco_facturas_recibidas_pendientes(emp);
  if n <> current_setting('prueba_recibidas.filas')::int or nulas <> current_setting('prueba_recibidas.nulas')::int - 1 then
    raise exception 'PRUEBA S01 recibidas 3b: las demás facturas han cambiado: % filas (antes %), % nulas (antes %).',
      n, current_setting('prueba_recibidas.filas'), nulas, current_setting('prueba_recibidas.nulas');
  end if;
  raise notice 'S01 recibidas 3b: con su asiento en borrador sale ese asiento; las otras % facturas, igual.', n - 1;
end $$;
reset role;

delete from public.journal_entry where id = current_setting('prueba_recibidas.asiento')::uuid;
set local role authenticated;
do $$
declare v uuid;
begin
  select journal_entry_id into v from public.banco_facturas_recibidas_pendientes('3b34403a-a7d6-4a48-a8d7-737e8cababdc')
   where invoice_id = current_setting('prueba_recibidas.factura')::uuid;
  if v is not null then raise exception 'PRUEBA S01 recibidas 3c: sin asiento vivo tenía que volver a ser nulo y es %.', v; end if;
  raise notice 'S01 recibidas 3c: borrado el asiento, nulo otra vez.';
end $$;
reset role;

-- 4 · La vuelta atrás, de verdad.
\i supabase/vuelta-atras/20261121T0150_s01_recibidas_asiento_por_origen.down.sql
do $$
declare h text := md5(pg_get_functiondef('public.banco_facturas_recibidas_pendientes(uuid, date)'::regprocedure));
begin
  if h <> 'f6e2f68f6d1fcec1618f255e57929812' then
    raise exception 'PRUEBA S01 recibidas 4: la vuelta atrás no deja el cuerpo de antes (md5 %).', h;
  end if;
  raise notice 'S01 recibidas 4: vuelta atrás, el cuerpo de antes byte a byte (md5 f6e2f68f…).';
end $$;

rollback;
