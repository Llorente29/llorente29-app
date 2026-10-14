-- supabase/staging/sql/20261111_c06b_cuenta_lectura_prueba.sql
--
-- SOLO STAGING. Prueba de «C06b · aviso #178: de qué lectura del histórico
-- viene cada subcuenta» (20261111T0500): company_account.import_run_id y
-- conta_diez_subcuentas. Todo en una transacción con ROLLBACK: no cambia
-- staging.
--
--   1. Las tres altas de conta_diez_subcuentas (propia con nombre, propia sin
--      nombre y la de serie de su hoja) escriben la lectura en curso; la que ya
--      estaba no se toca (sigue sin lectura); las rechazadas no entran.
--   2. Lo demás, como en la 0300: nuevas, estaban, rechazadas y sinNombre.
--   3. La clave ajena: una lectura que no existe no se puede escribir.
--
-- La 0510 (rellenar las 27 de Foodint) no se aplica en staging: allí no están
-- y su guarda pide exactamente 27. Su selección se ensayó en producción con un
-- select (27 candidatas, 27 con una sola lectura «hecho», 1 lectura, 1 cuenta).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b cuenta-lectura: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

do $$
begin
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    ('c06b0000-0000-4000-8000-0000000000a1', 'Prueba Lectura C06b', 'c06b-prueba-lectura', 'active', 'otra_actividad', 'contabilidad');
  insert into public.company (id, account_id, legal_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at) values
    ('c06b0000-0000-4000-8000-0000000000a2', 'c06b0000-0000-4000-8000-0000000000a1', 'Prueba Lectura, S.L.', 'B12345674', 'nif_es', 'company', 'hecho', now());
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits)
  values ('c06b0000-0000-4000-8000-0000000000a2', 'c06b0000-0000-4000-8000-0000000000a1', 'pymes', 8);
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values ('c06b0000-0000-4000-8000-0000000000a1', 'c06b0000-0000-4000-8000-0000000000a2', 'pymes', '62900000', '629', 'Otros servicios', 'template', 'serie');
end $$;

set local role service_role;

-- 1 y 2 · Las altas llevan su lectura; lo demás, como antes.
do $$
declare r jsonb; c constant uuid := 'c06b0000-0000-4000-8000-0000000000a2'; v_run uuid; n int;
begin
  insert into public.import_run (account_id, company_id, program, kind, created_by_name)
  values ('c06b0000-0000-4000-8000-0000000000a1', c, 'diez', 'historico', 'Prueba C06b') returning id into v_run;
  r := public.conta_diez_subcuentas(c, v_run, jsonb_build_array(
    jsonb_build_object('code', '70000003', 'nombre', 'Ventas de la prueba'),
    jsonb_build_object('code', '41000034', 'nombre', null),
    jsonb_build_object('code', '62400000', 'nombre', 'Transportes'),
    jsonb_build_object('code', '62900000', 'nombre', 'Otros servicios'),
    jsonb_build_object('code', '1234', 'nombre', 'Corta'),
    jsonb_build_object('code', '99900001', 'nombre', 'De nada')));
  if (r ->> 'nuevas')::int <> 3 or (r ->> 'estaban')::int <> 1 or jsonb_array_length(r -> 'rechazadas') <> 2 or (r -> 'sinNombre') <> '["41000034"]'::jsonb then
    raise exception '2: esperaba 3 nuevas, 1 que estaba, 2 rechazadas y sinNombre [41000034], y es %.', r;
  end if;
  select count(*) into n from public.company_account where company_id = c and code in ('70000003', '41000034', '62400000') and import_run_id = v_run;
  if n <> 3 then raise exception '1: de las 3 altas, solo % llevan su lectura.', n; end if;
  if (select import_run_id from public.company_account where company_id = c and code = '62900000') is not null then
    raise exception '1: la que ya estaba ha cogido la lectura.';
  end if;
  if exists (select 1 from public.company_account where company_id = c and code in ('1234', '99900001')) then raise exception '2: entró una rechazada.'; end if;
  if (select source from public.company_account where company_id = c and code = '62400000') <> 'serie' then raise exception '2: la de serie de su hoja ya no es de serie.'; end if;
  raise notice '1 y 2 OK: las 3 altas (propia, sin nombre, de serie) con su lectura; la que estaba, sin tocar; rechazos como antes.';
end $$;

-- 3 · La clave ajena.
do $$
begin
  begin
    update public.company_account set import_run_id = gen_random_uuid()
     where company_id = 'c06b0000-0000-4000-8000-0000000000a2' and code = '70000003';
    raise exception '3: se ha podido escribir una lectura que no existe.';
  exception when foreign_key_violation then null;
  end;
  raise notice '3 OK: solo una lectura que existe.';
end $$;
reset role;

rollback;
