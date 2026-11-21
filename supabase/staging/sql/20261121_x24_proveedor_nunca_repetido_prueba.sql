-- supabase/staging/sql/20261121_x24_proveedor_nunca_repetido_prueba.sql
--
-- SOLO STAGING. Prueba del X24 (20261121T1700_x24_proveedor_sin_nif y 20261121T1710_x24_nif_unico), que el ensayo
-- de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra los objetos que cambia: public._conta_proveedor_solo(uuid,text) y public._conta_proveedor_solo_deshacer(uuid,text);
-- y el índice nuevo public.ux_supplier_account_nif_clave, que sustituye a ux_supplier_account_tax_id.
--
-- sin usuario: las dos funciones son internas (solo las llaman el disparador del R14 y «Deshacer», que mira la
-- cuenta antes); se llaman como postgres, como el disparador.
--
-- Una cuenta inventada, X, con una sociedad (sin plan: el alta no crea subcuentas, que no es lo que se prueba):
--   1. Un proveedor SIN NIF y una factura suya CON NIF (su nombre escrito de otra manera, con la forma jurídica): la
--      factura va a ese, se le completa el NIF, queda «existente» con lo que tenía antes, y lo dice en la actividad.
--      «Deshacer» le quita el NIF y lo dice.
--   2. Dos sin NIF con el mismo nombre: no se une a ninguno, no se da de alta, y el motivo dice cuántos. Y ninguno:
--      se da de alta como siempre.
--   3. «B-00000000» contra «B00000000» en la misma cuenta: la base lo para (23505); en otra cuenta, no.
--   4. Las vueltas atrás: sin el índice nuevo, el de antes deja pasar el «B-00000000»; y las dos funciones vuelven a
--      su huella de hoy.
-- NIF todo ceros y nombres inventados (T11).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X24: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La cuenta X (y otra, Y, para el NIF en otra cuenta) ------------------------------------------------
insert into public.accounts (id, name, slug, status, business_type, product_brand) values
  ('a1240000-0000-4000-8000-000000000010', 'Prueba X24 X', 'x24-prueba-x', 'active', 'otra_actividad', 'contabilidad'),
  ('a1240000-0000-4000-8000-000000000020', 'Prueba X24 Y', 'x24-prueba-y', 'active', 'otra_actividad', 'contabilidad');
insert into public.company (id, account_id, legal_name, tax_id, setup_step, created_at) values
  ('a1240000-0000-4000-8000-000000000011', 'a1240000-0000-4000-8000-000000000010', 'Prueba X24 Uno, S.L.', 'A00000000', 'nombre', now());

-- Una recibida leída sin proveedor, como la deja la lectura.
create function pg_temp.x24_llega(p_n int, p_nif text, p_nombre text) returns uuid language plpgsql as $f$
declare v uuid := ('a1240000-0000-4000-8000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.supplier_invoice (id, account_id, company_id, status, source, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, reading)
  values (v, 'a1240000-0000-4000-8000-000000000010', 'a1240000-0000-4000-8000-000000000011', 'en_revision', 'ocr', 'X24-' || p_n, date '2026-11-10', 100, 10, 110,
          jsonb_build_object('factura', jsonb_build_object('proveedor', jsonb_build_object('nombre', p_nombre, 'nif', p_nif))));
  return v;
end $f$;
create function pg_temp.x24_proveedor(p_nombre text, p_nif text default null, p_cuenta uuid default 'a1240000-0000-4000-8000-000000000010') returns uuid language sql as $f$
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (p_cuenta, p_nombre, p_nombre, p_nif, true, 'Prueba X24') returning id
$f$;

-- 1 · Uno sin NIF y una factura suya con NIF: se une y se le completa el NIF; «Deshacer» se lo quita ----------
do $$
declare s uuid; f uuid; r jsonb; x public.conta_proveedor_solo; v_nif text; n_antes int; n_despues int; v_act text;
begin
  s := pg_temp.x24_proveedor('Frutas Inventadas Uno');
  select count(*) into n_antes from public.supplier where account_id = 'a1240000-0000-4000-8000-000000000010';
  f := pg_temp.x24_llega(1, 'J-00000000', 'FRUTAS INVENTADAS UNO, S.L.');
  r := public._conta_proveedor_solo(f);
  select count(*) into n_despues from public.supplier where account_id = 'a1240000-0000-4000-8000-000000000010';
  select * into x from public.conta_proveedor_solo where invoice_id = f;
  select tax_id into v_nif from public.supplier where id = s;
  if r->>'que' <> 'existente' or (r->>'supplier_id')::uuid <> s or n_despues <> n_antes then
    raise exception 'PRUEBA X24 · 1: no se ha unido al que ya estaba (%; proveedores % → %)', r, n_antes, n_despues;
  end if;
  if v_nif is distinct from 'J00000000' or x.nif_completado->>'nif' <> 'J00000000' or x.nif_completado->>'tax_id_antes' is not null then
    raise exception 'PRUEBA X24 · 1: no le ha completado el NIF como toca (tax_id %, registro %)', v_nif, x.nif_completado;
  end if;
  select text into v_act from public.document_activity where supplier_invoice_id = f order by created_at desc limit 1;
  if v_act !~ 'uno que ya estaba sin NIF: Sumied le ha completado el NIF \(J00000000\)' then raise exception 'PRUEBA X24 · 1: la actividad no lo dice (%)', v_act; end if;
  raise notice 'PRUEBA X24 · 1: la factura va al que ya estaba (sin proveedor nuevo: % → %), con el NIF completado. «%»', n_antes, n_despues, v_act;
  r := public._conta_proveedor_solo_deshacer(f, 'Prueba X24');
  select tax_id into v_nif from public.supplier where id = s;
  if v_nif is not null or not exists (select 1 from public.supplier where id = s) or r->>'texto' !~ 'vuelve a no tener NIF' then
    raise exception 'PRUEBA X24 · 1: «Deshacer» no le quita el NIF (tax_id %, %)', v_nif, r;
  end if;
  raise notice 'PRUEBA X24 · 1: «Deshacer» le quita el NIF y lo dice: «%»', r->>'texto';
end $$;

-- 2 · Dos sin NIF con el mismo nombre: ninguno, y por qué ------------------------------------------------------
do $$
declare f uuid; r jsonb; n_antes int; n_despues int;
begin
  perform pg_temp.x24_proveedor('Verduras Inventadas, S.L.');
  perform pg_temp.x24_proveedor('VERDURAS INVENTADAS SL');
  select count(*) into n_antes from public.supplier where account_id = 'a1240000-0000-4000-8000-000000000010';
  f := pg_temp.x24_llega(2, 'J00000000', 'Verduras Inventadas S.L.');
  r := public._conta_proveedor_solo(f);
  select count(*) into n_despues from public.supplier where account_id = 'a1240000-0000-4000-8000-000000000010';
  if r->>'que' <> 'no' or r->>'motivo' <> 'Hay 2 proveedores sin NIF con este nombre: elige.' or n_despues <> n_antes
     or (select supplier_id from public.supplier_invoice where id = f) is not null then
    raise exception 'PRUEBA X24 · 2: con dos sin NIF del mismo nombre, % (proveedores % → %)', r, n_antes, n_despues;
  end if;
  raise notice 'PRUEBA X24 · 2: con dos sin NIF del mismo nombre, ninguno y ninguno nuevo: «%»', r->>'motivo';
end $$;

-- 2b · Ninguno sin NIF con ese nombre: se da de alta como siempre (el R14) ----------------------------------------
do $$
declare f uuid; r jsonb; n_antes int; n_despues int;
begin
  select count(*) into n_antes from public.supplier where account_id = 'a1240000-0000-4000-8000-000000000010';
  f := pg_temp.x24_llega(3, 'J00000000', 'Pescados Inventados, S.L.');
  r := public._conta_proveedor_solo(f);
  select count(*) into n_despues from public.supplier where account_id = 'a1240000-0000-4000-8000-000000000010';
  if r->>'que' <> 'alta' or n_despues <> n_antes + 1 then raise exception 'PRUEBA X24 · 2b: sin nadie con ese nombre, % (proveedores % → %)', r, n_antes, n_despues; end if;
  raise notice 'PRUEBA X24 · 2b: sin nadie sin NIF con ese nombre, uno nuevo (proveedores % → %).', n_antes, n_despues;
end $$;

-- 3 · «B-00000000» contra «B00000000»: la base lo para en la misma cuenta, no en otra ---------------------------
do $$
declare v_ok boolean := false;
begin
  perform pg_temp.x24_proveedor('Carnes Inventadas', 'B00000000');
  begin
    perform pg_temp.x24_proveedor('Carnes Inventadas Bis', 'B-00000000');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA X24 · 3: la base ha dejado «B-00000000» con «B00000000» ya en la cuenta'; end if;
  perform pg_temp.x24_proveedor('Carnes Inventadas', 'B-00000000', 'a1240000-0000-4000-8000-000000000020');
  raise notice 'PRUEBA X24 · 3: «B-00000000» con «B00000000» en la misma cuenta, la base lo para (23505); en otra cuenta, entra.';
end $$;

-- 4 · Las vueltas atrás ----------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261121T1710_x24_nif_unico.down.sql
do $$ begin
  if to_regclass('public.ux_supplier_account_nif_clave') is not null or to_regclass('public.ux_supplier_account_tax_id') is null then
    raise exception 'PRUEBA X24 · 4: la vuelta atrás de la 1710 no deja el índice de antes';
  end if;
  perform pg_temp.x24_proveedor('Carnes Inventadas Bis', 'B-00000000');
  raise notice 'PRUEBA X24 · 4: sin la 1710, el índice de antes deja pasar «B-00000000» (era el hueco).';
end $$;
\i supabase/vuelta-atras/20261121T1700_x24_proveedor_sin_nif.down.sql
do $$
declare r record;
begin
  for r in select x.firma, x.huella, md5(p.prosrc) viva from (values
      ('public._conta_proveedor_solo(uuid,text)', 'c08220cba6008efd80cf55b1298d4b80'),
      ('public._conta_proveedor_solo_deshacer(uuid,text)', '90e2be7dea6c26cabc854d75c159f696')) x(firma, huella)
    join pg_proc p on p.oid = to_regprocedure(x.firma) loop
    if r.viva <> r.huella then raise exception 'PRUEBA X24 · 4: la vuelta atrás no devuelve % a su huella de hoy', r.firma; end if;
  end loop;
  raise notice 'PRUEBA X24 · 4: la vuelta atrás de la 1700 devuelve las dos funciones a su huella de hoy.';
end $$;

rollback;
