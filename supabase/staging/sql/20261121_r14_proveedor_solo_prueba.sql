-- supabase/staging/sql/20261121_r14_proveedor_solo_prueba.sql
--
-- SOLO STAGING. Prueba del R14 (20261121T1110_r14_proveedor_solo_anade,
-- 20261121T1120_r14_proveedor_solo_al_leer y 20261121T1130_r14_proveedor_solo_completar),
-- que el ensayo de staging pone delante en la misma sesión. Todo en una transacción con
-- ROLLBACK: staging no cambia. Lo que crea: public.conta_gasto_por_venta,
-- public._r14_sin_tildes, public._conta_gasto_por_venta, public.conta_gasto_propuesto,
-- public.conta_proveedor_solo, public._r14_partir_direccion, public._conta_proveedor_solo,
-- public.conta_proveedor_solo_deshacer y el disparador r14_proveedor_solo
-- (public.tg_r14_proveedor_solo) en public.supplier_invoice.
--
-- Monta dos cuentas inventadas: X, con dos sociedades (X1, B00000000, y X2, A00000000) y
-- una plataforma (NL000000000B01), e Y, con una (Y1, G00000000). El disparador es
-- DIFERIDO (actúa al confirmar); aquí, que acaba en ROLLBACK, se le hace actuar con
-- «set constraints … immediate», como la confirmación.
--   1. Lo que crea y sus permisos.
--   2. Llega leída una factura de un NIF que la cuenta no tiene: antes de confirmar, sin
--      proveedor; al confirmar, el proveedor nuevo con lo leído, un solo tercero, su
--      subcuenta 40000001 (vende pollo: 600 → 4000) y la cuenta propuesta con su porqué.
--   3. La siguiente del mismo NIF, en X2: el mismo proveedor (el mismo tercero) y su
--      subcuenta en X2; ninguno nuevo.
--   4. La de la plataforma: su ficha de proveedor en el tercero de la plataforma (no otro),
--      su 41000001 y la comisión, 623, con su porqué.
--   5. No se da de alta: sin NIF, con un NIF que no valida, con el de la propia empresa;
--      cada una con su motivo. Ni la anulada.
--   6. «Deshacer»: Y no puede; X sí. La de X2 suelta el proveedor y su subcuenta; la de
--      X1, además, lo borra (con su tercero y su subcuenta). Vuelta a leer, no se rehace.
--   7. Lo que ya estaba leído se completa al aplicar (1130), contado antes y después con
--      la misma vara (regla 31); la segunda pasada no toca nada. Con una factura validada
--      en X2, la siguiente suya en X1 propone la cuenta de X2; la validada sin proveedor
--      no se toca.
--   8. Las tres vueltas atrás quitan todo.
--
-- Como el cliente: u (X) o w (Y) en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R14: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Montar X (X1, X2 y la plataforma) e Y (Y1) --------------------------------------------------
do $$
declare
  u constant uuid := 'a1140000-0000-4000-8000-000000000001';
  w constant uuid := 'a1140000-0000-4000-8000-000000000002';
  x constant uuid := 'a1140000-0000-4000-8000-000000000010';
  y constant uuid := 'a1140000-0000-4000-8000-000000000020';
  v_p uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', z.id, 'authenticated', 'authenticated', z.correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    from (values (u, 'x@r14-prueba.test'), (w, 'y@r14-prueba.test')) z(id, correo);
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba R14 X', 'r14-prueba-x', 'active', 'otra_actividad', 'contabilidad'), (y, 'Prueba R14 Y', 'r14-prueba-y', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Admin X', now(), now()), (w, y, 'admin', true, 'Admin Y', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step, created_at) values
    ('a1140000-0000-4000-8000-000000000011', x, 'Prueba Uno, S.L.', 'B00000000', 'nombre', now() - interval '2 days'),
    ('a1140000-0000-4000-8000-000000000012', x, 'Prueba Dos, S.L.', 'A00000000', 'nombre', now() - interval '1 day'),
    ('a1140000-0000-4000-8000-000000000021', y, 'Prueba Ajena, S.L.', 'G00000000', 'nombre', now());
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits) values
    ('a1140000-0000-4000-8000-000000000011', x, 'pymes', 8), ('a1140000-0000-4000-8000-000000000012', x, 'pymes', 8);
  -- La plataforma de X: su tercero, sin ficha de proveedor.
  insert into public.party (account_id, name, tax_id, source) values (x, 'Plataforma de Ejemplo', 'NL000000000B01', 'manual') returning id into v_p;
  insert into public.party_role (account_id, party_id, role) values (x, v_p, 'platform');
end $$;
-- El plan de X1 y X2, como lo activa su administrador.
select set_config('request.jwt.claims', json_build_object('sub', 'a1140000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select public.company_chart_activate('a1140000-0000-4000-8000-000000000011', false, 'Prueba R14') is not null as x1,
       public.company_chart_activate('a1140000-0000-4000-8000-000000000012', false, 'Prueba R14') is not null as x2;
select set_config('request.jwt.claims', '', true);

-- Una recibida leída, como la deja conta_factura_desde_lectura: sin proveedor, con lo leído y sus líneas.
create function pg_temp.r14_llega(p_n int, p_empresa text, p_nif text, p_nombre text, p_lineas text[], p_estado text default 'en_revision') returns uuid language plpgsql as $f$
declare v uuid := ('a1140000-0000-4000-8000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.supplier_invoice (id, account_id, company_id, status, source, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, reading)
  values (v, 'a1140000-0000-4000-8000-000000000010', ('a1140000-0000-4000-8000-0000000000' || p_empresa)::uuid, p_estado, 'ocr', 'R14-' || p_n, date '2026-11-10', 100, 10, 110,
          jsonb_build_object('factura', jsonb_build_object('proveedor', jsonb_build_object('nombre', p_nombre, 'nif', p_nif,
            'direccion', 'C/ Inventada 1, 28000 Madrid (Madrid)', 'email', 'pedidos@ejemplo.test', 'telefono', '900000000', 'web', 'ejemplo.test'))));
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
  select v, t, 1, 50, 50, 10, o::int from unnest(p_lineas) with ordinality z(t, o);
  return v;
end $f$;
create function pg_temp.r14_que(p uuid) returns text language sql as $f$
  select coalesce(x.que || coalesce(' · ' || x.motivo, ''), 'nada') from (select 1) z left join public.conta_proveedor_solo x on x.invoice_id = p
$f$;
create function pg_temp.r14_subcuenta(p_empresa text, p_s uuid) returns text language sql as $f$
  select a.code from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = ('a1140000-0000-4000-8000-0000000000' || p_empresa)::uuid and k.entity = 'supplier' and k.entity_id = p_s::text and k.role = 'principal'
$f$;

-- 1 · Lo que crea y sus permisos -----------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_trigger t where t.tgname = 'r14_proveedor_solo' and t.tgrelid = 'public.supplier_invoice'::regclass and t.tgdeferrable and t.tginitdeferred) then
    raise exception 'PRUEBA R14 · 1: falta el disparador diferido r14_proveedor_solo.';
  end if;
  if has_function_privilege('authenticated', 'public._conta_proveedor_solo(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_proveedor_solo_deshacer(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_gasto_propuesto(uuid,uuid,uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.conta_proveedor_solo', 'insert') then
    raise exception 'PRUEBA R14 · 1: los permisos no son los esperados.';
  end if;
  if (select count(*) from public.conta_gasto_por_venta) < 10 then raise exception 'PRUEBA R14 · 1: la tabla de lo que vende está vacía.'; end if;
  -- Julio, 21/11: el combustible que se almacena, 602 con su porqué; el gas canalizado, 628.
  if public._conta_gasto_por_venta(array['Bombona de butano 12,5 kg']) ->> 'porque' is distinct from 'Combustible para la cocina: 602'
     or public._conta_gasto_por_venta(array['Carbón vegetal 15 kg']) ->> 'hoja' is distinct from '602'
     or public._conta_gasto_por_venta(array['Gas canalizado · noviembre']) ->> 'hoja' is distinct from '628' then
    raise exception 'PRUEBA R14 · 1: el combustible no va a la 602 o el gas canalizado no va a la 628.';
  end if;
  raise notice '1 OK: el disparador diferido, los permisos y la tabla de lo que vende (% filas).', (select count(*) from public.conta_gasto_por_venta);
end $$;

-- 2 · Un NIF que la cuenta no tiene: el proveedor nuevo -------------------------------------------
select pg_temp.r14_llega(1, '11', 'J00000000', 'Suministros Inventados, S.L.', array['POLLO ENTERO 1,8KG', 'ALITAS DE POLLO CONGELADAS', 'Portes']) as f1 \gset
do $$ begin
  if (select supplier_id from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000101') is not null then raise exception 'PRUEBA R14 · 2: tiene proveedor antes de confirmar.'; end if;
end $$;
set constraints public.r14_proveedor_solo immediate;   -- lo que haría la confirmación
set constraints public.r14_proveedor_solo deferred;
do $$
declare s public.supplier; f constant uuid := 'a1140000-0000-4000-8000-000000000101'; g jsonb; h text;
begin
  select p.* into s from public.supplier p join public.supplier_invoice i on i.supplier_id = p.id where i.id = f;
  if s.id is null then raise exception 'PRUEBA R14 · 2: no le ha puesto proveedor: %', pg_temp.r14_que(f); end if;
  if (s.name, s.legal_name, s.tax_id, s.tax_id_type, s.entity_kind, s.fiscal_street, s.fiscal_postal_code, s.fiscal_city, s.website, s.created_from)
     is distinct from ('Suministros Inventados, S.L.', 'Suministros Inventados, S.L.', 'J00000000', 'nif_es', 'company', 'C/ Inventada 1', '28000', 'Madrid',
                       'ejemplo.test', 'factura')
     or not exists (select 1 from public.supplier_contact k where k.supplier_id = s.id and k.is_primary and k.email = 'pedidos@ejemplo.test' and k.phone = '900000000') then
    raise exception 'PRUEBA R14 · 2: la ficha no es la de lo leído: %', row_to_json(s);
  end if;
  if not (s.data_from_invoice ? 'nif' and s.data_from_invoice ? 'direccion' and s.data_from_invoice->'nif'->>'quien' = 'Sumied') then
    raise exception 'PRUEBA R14 · 2: no apunta de qué factura salió cada dato: %', s.data_from_invoice;
  end if;
  if (select count(*) from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and tax_id = 'J00000000') <> 1 then raise exception 'PRUEBA R14 · 2: no es un solo tercero.'; end if;
  if pg_temp.r14_subcuenta('11', s.id) is distinct from '40000001' then raise exception 'PRUEBA R14 · 2: la subcuenta no es la 40000001: %', pg_temp.r14_subcuenta('11', s.id); end if;
  if pg_temp.r14_que(f) <> 'alta' then raise exception 'PRUEBA R14 · 2: no lo apunta como alta: %', pg_temp.r14_que(f); end if;
  select text into h from public.document_activity where supplier_invoice_id = f order by created_at desc limit 1;
  if h is distinct from 'Proveedor nuevo: Sumied ha dado de alta a Suministros Inventados, S.L. con lo que trae la factura, con su subcuenta 40000001.' then
    raise exception 'PRUEBA R14 · 2: la actividad dice: %', h;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', 'a1140000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  g := public.conta_gasto_propuesto('a1140000-0000-4000-8000-000000000011', s.id, f);
  perform set_config('request.jwt.claims', '', true);
  if g->>'cuenta' <> '60000000' or g->>'porque' <> 'Propuesta: vende pollo y alitas → 600 Compras de mercaderías' then
    raise exception 'PRUEBA R14 · 2: la cuenta propuesta es: %', g;
  end if;
  raise notice '2 OK: % (%) dado de alta, un tercero, subcuenta 40000001; «%».', s.name, s.tax_id, g->>'porque';
end $$;

-- 3 · El mismo NIF en X2: el mismo proveedor y su subcuenta en X2 ---------------------------------
select pg_temp.r14_llega(2, '12', 'J00000000', 'SUMINISTROS INVENTADOS SL', array['Pollo troceado']) as f2 \gset
set constraints public.r14_proveedor_solo immediate;
set constraints public.r14_proveedor_solo deferred;
do $$
declare s1 uuid; s2 uuid;
begin
  select supplier_id into s1 from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000101';
  select supplier_id into s2 from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000102';
  if s2 is distinct from s1 then raise exception 'PRUEBA R14 · 3: no es el mismo proveedor: % · %', s1, s2; end if;
  if (select count(*) from public.supplier where account_id = 'a1140000-0000-4000-8000-000000000010' and tax_id = 'J00000000') <> 1 then raise exception 'PRUEBA R14 · 3: ha dado de alta otro.'; end if;
  if pg_temp.r14_subcuenta('12', s2) is distinct from '40000001' or pg_temp.r14_que('a1140000-0000-4000-8000-000000000102') <> 'existente' then
    raise exception 'PRUEBA R14 · 3: en X2: % · %', pg_temp.r14_subcuenta('12', s2), pg_temp.r14_que('a1140000-0000-4000-8000-000000000102');
  end if;
  raise notice '3 OK: en X2, el mismo proveedor (existente) y su subcuenta 40000001 en X2.';
end $$;

-- 4 · La plataforma: su ficha en su tercero y su 410 ----------------------------------------------
select pg_temp.r14_llega(3, '11', 'NL 000000000 B01', 'Plataforma de Ejemplo B.V.', array['Comisión por pedidos', 'Servicio de reparto']) as f3 \gset
set constraints public.r14_proveedor_solo immediate;
set constraints public.r14_proveedor_solo deferred;
do $$
declare s uuid; v_party uuid; g jsonb;
begin
  select supplier_id into s from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000103';
  select id into v_party from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and tax_id = 'NL000000000B01';
  if s is null or not exists (select 1 from public.party_role where party_id = v_party and role = 'supplier' and supplier_id = s) then
    raise exception 'PRUEBA R14 · 4: la factura no va a la ficha de la plataforma: %', pg_temp.r14_que('a1140000-0000-4000-8000-000000000103');
  end if;
  if (select count(*) from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and name ilike '%Plataforma%') <> 1 then raise exception 'PRUEBA R14 · 4: hay otro tercero de la plataforma.'; end if;
  if pg_temp.r14_subcuenta('11', s) is distinct from '41000001' or pg_temp.r14_que('a1140000-0000-4000-8000-000000000103') <> 'plataforma' then
    raise exception 'PRUEBA R14 · 4: % · %', pg_temp.r14_subcuenta('11', s), pg_temp.r14_que('a1140000-0000-4000-8000-000000000103');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', 'a1140000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  g := public.conta_gasto_propuesto('a1140000-0000-4000-8000-000000000011', s, 'a1140000-0000-4000-8000-000000000103');
  perform set_config('request.jwt.claims', '', true);
  if g->>'cuenta' <> '62300000' or g->>'de' <> 'plataforma' then raise exception 'PRUEBA R14 · 4: la cuenta propuesta es: %', g; end if;
  raise notice '4 OK: la plataforma, en su tercero, con su 41000001; «%».', g->>'porque';
end $$;

-- 4b · Julio, 21/11: una plataforma que factura con un NIF de fuera (GB…, que no es de la UE) y cuyo
-- tercero no tiene NIF: se une a ella por su nombre («… Ltd» es la plataforma «…»), nunca suelta.
do $$
declare v_p uuid;
begin
  insert into public.party (account_id, name, source) values ('a1140000-0000-4000-8000-000000000010', 'Pedidos Ejemplo', 'manual') returning id into v_p;
  insert into public.party_role (account_id, party_id, role) values ('a1140000-0000-4000-8000-000000000010', v_p, 'platform');
end $$;
select pg_temp.r14_llega(11, '11', 'GB000000000', 'Pedidos Ejemplo Ltd', array['Service fee']) as f11 \gset
set constraints public.r14_proveedor_solo immediate;
set constraints public.r14_proveedor_solo deferred;
do $$
declare s uuid; v_party uuid;
begin
  select supplier_id into s from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000111';
  select id into v_party from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and name = 'Pedidos Ejemplo';
  if s is null or not exists (select 1 from public.party_role where party_id = v_party and role = 'supplier' and supplier_id = s) then
    raise exception 'PRUEBA R14 · 4b: no va a la plataforma por su nombre: %', pg_temp.r14_que('a1140000-0000-4000-8000-000000000111');
  end if;
  if exists (select 1 from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and tax_id = 'GB000000000') then
    raise exception 'PRUEBA R14 · 4b: ha quedado un tercero suelto con el NIF de fuera.';
  end if;
  raise notice '4b OK: «Pedidos Ejemplo Ltd» (GB000000000) va a la plataforma «Pedidos Ejemplo» por su nombre, sin tercero suelto; %.', pg_temp.r14_que('a1140000-0000-4000-8000-000000000111');
end $$;

-- 5 · No se da de alta: sin NIF, NIF que no valida, el de la propia empresa; ni la anulada ---------
select pg_temp.r14_llega(4, '11', null, 'Sin NIF, S.L.', array['Pan']) as f4 \gset
select pg_temp.r14_llega(5, '11', 'B00000001', 'NIF Malo, S.L.', array['Pan']) as f5 \gset
select pg_temp.r14_llega(6, '11', 'ES B-00000000', 'Prueba Uno, S.L.', array['Pan']) as f6 \gset
set constraints public.r14_proveedor_solo immediate;
set constraints public.r14_proveedor_solo deferred;
do $$ begin
  if pg_temp.r14_que('a1140000-0000-4000-8000-000000000104') <> 'no · La factura no trae el NIF del proveedor: dalo de alta tú.'
     or pg_temp.r14_que('a1140000-0000-4000-8000-000000000105') <> 'no · El NIF leído (B00000001) no es válido: compruébalo en el papel y dalo de alta tú.'
     or pg_temp.r14_que('a1140000-0000-4000-8000-000000000106') <> 'no · El NIF del proveedor (B00000000) es el de Prueba Uno, S.L.: parece una factura emitida, no recibida.' then
    raise exception 'PRUEBA R14 · 5: % | % | %', pg_temp.r14_que('a1140000-0000-4000-8000-000000000104'), pg_temp.r14_que('a1140000-0000-4000-8000-000000000105'), pg_temp.r14_que('a1140000-0000-4000-8000-000000000106');
  end if;
  if exists (select 1 from public.supplier_invoice where id in ('a1140000-0000-4000-8000-000000000104', 'a1140000-0000-4000-8000-000000000105', 'a1140000-0000-4000-8000-000000000106') and supplier_id is not null) then
    raise exception 'PRUEBA R14 · 5: a alguna le ha puesto proveedor.';
  end if;
  raise notice '5 OK: sin NIF, NIF que no valida y el de la propia empresa, cada una con su motivo y sin proveedor.';
end $$;

-- 6 · «Deshacer» --------------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'a1140000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_proveedor_solo_deshacer('a1140000-0000-4000-8000-000000000101', 'Admin Y');
    raise exception 'PRUEBA R14 · 6: Y ha deshecho una de X.';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.conta_proveedor_solo) then raise exception 'PRUEBA R14 · 6: Y ve lo de X.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'a1140000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r2 jsonb; r1 jsonb;
begin
  if (select count(*) from public.conta_proveedor_solo) <> 7 then raise exception 'PRUEBA R14 · 6: X no ve sus 7 filas.'; end if;
  r2 := public.conta_proveedor_solo_deshacer('a1140000-0000-4000-8000-000000000102', 'Admin X');
  r1 := public.conta_proveedor_solo_deshacer('a1140000-0000-4000-8000-000000000101', 'Admin X');
  if r2->>'texto' <> 'Deshecho: la factura ya no es de Suministros Inventados, S.L. y vuelve a no tener proveedor.'
     or r1->>'texto' <> 'Deshecho: Suministros Inventados, S.L. ya no está dado de alta y la factura vuelve a no tener proveedor.' then
    raise exception 'PRUEBA R14 · 6: «Deshacer» dice: % · %', r2, r1;
  end if;
  begin
    perform public.conta_proveedor_solo_deshacer('a1140000-0000-4000-8000-000000000101', 'Admin X');
    raise exception 'PRUEBA R14 · 6: se ha deshecho dos veces.';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if exists (select 1 from public.supplier where account_id = 'a1140000-0000-4000-8000-000000000010' and tax_id = 'J00000000')
     or exists (select 1 from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and tax_id = 'J00000000')
     or exists (select 1 from public.company_account where company_id in ('a1140000-0000-4000-8000-000000000011', 'a1140000-0000-4000-8000-000000000012') and code = '40000001') then
    raise exception 'PRUEBA R14 · 6: después de deshacer queda el proveedor, su tercero o su subcuenta.';
  end if;
end $$;
update public.supplier_invoice set reading = reading || '{"releida": true}' where id = 'a1140000-0000-4000-8000-000000000101';
set constraints public.r14_proveedor_solo immediate;
set constraints public.r14_proveedor_solo deferred;
do $$ begin
  if (select supplier_id from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000101') is not null then raise exception 'PRUEBA R14 · 6: vuelta a leer, lo ha rehecho.'; end if;
  raise notice '6 OK: Y no deshace ni ve; X deshace las dos (la de X2 suelta, la de X1 borra proveedor, tercero y subcuenta); vuelta a leer, no se rehace.';
end $$;

-- 7 · Lo que ya estaba leído, al aplicar ---------------------------------------------------------
-- Llegan como antes de la 1120, sin que nadie las mire (sin disparadores, como en la prueba del E04).
create function pg_temp.r14_sin_mirar(p_n int, p_empresa text, p_nif text, p_nombre text, p_lineas text[], p_estado text default 'en_revision') returns uuid language plpgsql as $f$
declare v uuid;
begin
  set local session_replication_role = replica;
  v := pg_temp.r14_llega(p_n, p_empresa, p_nif, p_nombre, p_lineas, p_estado);
  set local session_replication_role = origin;
  return v;
end $f$;
-- Un asiento validado de la factura: el proveedor al haber (su subcuenta) y el gasto al debe.
create function pg_temp.r14_validada(p uuid, p_gasto text) returns void language plpgsql as $f$
declare e uuid := gen_random_uuid(); si public.supplier_invoice;
begin
  select * into si from public.supplier_invoice where id = p;
  set local session_replication_role = replica;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason, number, validated_at, hash, chain_seq)
  values (e, si.account_id, si.company_id, gen_random_uuid(), 2, date '2026-11-10', 'Prueba R14', 'supplier_invoice', si.id, 'validado', 'seguro', 'Prueba R14',
          900000 + (random() * 99999)::int, now(), md5(e::text), 900000 + (random() * 99999)::int);
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common, tax_documents)
  select si.account_id, si.company_id, e, 1, a.id, 100, 0, false, 1 from public.company_account a where a.company_id = si.company_id and a.code = p_gasto
  union all
  select si.account_id, si.company_id, e, 2, k.company_account_id, 0, 100, false, 1 from public.company_account_link k
   where k.company_id = si.company_id and k.entity = 'supplier' and k.entity_id = si.supplier_id::text and k.role = 'principal';
  set local session_replication_role = origin;
end $f$;
select pg_temp.r14_sin_mirar(7, '12', 'E00000000', 'Reparaciones Inventadas, S.L.', array['Reparación de la cámara', 'Mano de obra']) as f7 \gset
select pg_temp.r14_sin_mirar(8, '12', 'F00000000', 'Anulada, S.L.', array['Pan'], 'anulada') as f8 \gset
-- Julio, 21/11: una ficha suelta (dada de alta a mano, como Cheerfy en Frango) de una plataforma sin ficha.
do $$
declare v_p uuid;
begin
  insert into public.party (account_id, name, source) values ('a1140000-0000-4000-8000-000000000010', 'Reparto Muestra', 'manual') returning id into v_p;
  insert into public.party_role (account_id, party_id, role) values ('a1140000-0000-4000-8000-000000000010', v_p, 'platform');
  insert into public.supplier (id, account_id, name, tax_id, tax_id_type, country_code, is_active)
  values ('a1140000-0000-4000-8000-0000000002a1', 'a1140000-0000-4000-8000-000000000010', 'Reparto Muestra Limited', 'GB000000001', 'foreign', 'GB', true);
end $$;
create temp table _antes on commit drop as
  select i.account_id, i.company_id, count(*) filter (where i.supplier_id is null and i.reading ? 'factura') as sin_proveedor from public.supplier_invoice i
   where i.account_id = 'a1140000-0000-4000-8000-000000000010' group by 1, 2;
\i supabase/migrations/20261121T1130_r14_proveedor_solo_completar.sql
\i supabase/migrations/20261121T1130_r14_proveedor_solo_completar.sql
do $$
declare s uuid; n_antes int; n_despues int;
begin
  select sum(sin_proveedor) into n_antes from _antes;
  select count(*) into n_despues from public.supplier_invoice i where i.account_id = 'a1140000-0000-4000-8000-000000000010' and i.supplier_id is null and i.reading ? 'factura';
  select supplier_id into s from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000107';
  if s is null or pg_temp.r14_subcuenta('12', s) is distinct from '41000001' then raise exception 'PRUEBA R14 · 7: la de reparaciones: % · %', pg_temp.r14_que('a1140000-0000-4000-8000-000000000107'), pg_temp.r14_subcuenta('12', s); end if;
  if (select cuando from public.conta_proveedor_solo where invoice_id = 'a1140000-0000-4000-8000-000000000107') <> 'al_aplicar' then raise exception 'PRUEBA R14 · 7: no dice que fue al aplicar.'; end if;
  if (select supplier_id from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000108') is not null then raise exception 'PRUEBA R14 · 7: ha tocado la anulada.'; end if;
  -- Antes: la 101 y la 102 (deshechas), la 104, 105 y 106 (sin poder), la 107 y la 108 (anulada) = 7 sin proveedor. Después: se completa solo la 107.
  if (n_antes, n_despues) is distinct from (7, 6) then raise exception 'PRUEBA R14 · 7: antes % y después % sin proveedor (esperaba 7 y 6).', n_antes, n_despues; end if;
  if (select r.party_id from public.party_role r where r.supplier_id = 'a1140000-0000-4000-8000-0000000002a1' and r.role = 'supplier')
     is distinct from (select id from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and name = 'Reparto Muestra') then
    raise exception 'PRUEBA R14 · 7: la ficha suelta no se ha unido a su plataforma.';
  end if;
  if not exists (select 1 from public.party where account_id = 'a1140000-0000-4000-8000-000000000010' and tax_id = 'GB000000001' and archived_note = 'Unido a la plataforma Reparto Muestra (R14)') then
    raise exception 'PRUEBA R14 · 7: el tercero suelto no queda archivado con su nota.';
  end if;
  raise notice '7a OK: al aplicar, de % sin proveedor a %: la de reparaciones con su 41000001 (622 → 4100); la anulada y las deshechas, no; la segunda pasada, nada.', n_antes, n_despues;
end $$;
-- La de reparaciones, validada en X2 a la 62200000. Llega otra suya a X1 que vende pan: manda lo de X2.
-- Y una de X1 sin proveedor con su asiento validado (traída así): no se toca.
select pg_temp.r14_validada('a1140000-0000-4000-8000-000000000107', '62200000');
select pg_temp.r14_llega(9, '11', 'E00000000', 'Reparaciones Inventadas, S.L.', array['Pan de molde']) as f9 \gset
select pg_temp.r14_sin_mirar(10, '11', 'G00000000', 'Validada Sin Proveedor, S.L.', array['Pan']) as f10 \gset
select pg_temp.r14_validada('a1140000-0000-4000-8000-000000000110', '60000000');
set constraints public.r14_proveedor_solo immediate;
set constraints public.r14_proveedor_solo deferred;
\i supabase/migrations/20261121T1130_r14_proveedor_solo_completar.sql
do $$
declare s uuid; g jsonb;
begin
  select supplier_id into s from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000109';
  if s is distinct from (select supplier_id from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000107') then raise exception 'PRUEBA R14 · 7: la de X1 no es el mismo proveedor.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', 'a1140000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  g := public.conta_gasto_propuesto('a1140000-0000-4000-8000-000000000011', s, 'a1140000-0000-4000-8000-000000000109');
  perform set_config('request.jwt.claims', '', true);
  if g->>'cuenta' <> '62200000' or g->>'porque' <> 'Propuesta: en Prueba Dos, S.L. sus facturas van a la 62200000 → 62200000 Reparaciones y conservación' then
    raise exception 'PRUEBA R14 · 7: la de otra sociedad propone: %', g;
  end if;
  if (select supplier_id from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000110') is not null
     or exists (select 1 from public.conta_proveedor_solo where invoice_id = 'a1140000-0000-4000-8000-000000000110') then
    raise exception 'PRUEBA R14 · 7: ha tocado la validada.';
  end if;
  if pg_temp.r14_subcuenta('11', s) is distinct from '41000003' then raise exception 'PRUEBA R14 · 7: su subcuenta en X1 (622 → 4100, la siguiente libre: la 41000001 y la 41000002 son de las plataformas): %', pg_temp.r14_subcuenta('11', s); end if;
  raise notice '7b OK: la de X1, el mismo proveedor con su 41000003 (la siguiente libre) y «%»; la validada sin proveedor, sin tocar.', g->>'porque';
end $$;

-- 8 · Las tres vueltas atrás ---------------------------------------------------------------------
-- La de la 1130 PARA si alguna de las completadas al aplicar ya tiene su asiento validado (la 107 lo
-- tiene): fuera los asientos de la prueba antes de pasarla.
do $$ begin
  set local session_replication_role = replica;
  delete from public.journal_line where entry_id in (select id from public.journal_entry where concept = 'Prueba R14' and account_id = 'a1140000-0000-4000-8000-000000000010');
  delete from public.journal_entry where concept = 'Prueba R14' and account_id = 'a1140000-0000-4000-8000-000000000010';
  set local session_replication_role = origin;
end $$;
-- Las vueltas atrás quitan un disparador de supplier_invoice y tablas que la referencian (interbloqueos en
-- staging: 44877021402, 44889381392 y 44890464100).
set local lock_timeout = '60s';
-- Borrar las tablas de la 1110 pide también acceso exclusivo a las que apuntan sus claves ajenas: se cogen
-- todas de una vez y en orden fijo, para esperar a las demás sesiones en vez de cruzarse con ellas.
lock table public.accounts, public.company, public.company_account, public.party, public.supplier, public.supplier_invoice in access exclusive mode;
\i supabase/vuelta-atras/20261121T1130_r14_proveedor_solo_completar.down.sql
do $$ begin
  if (select supplier_id from public.supplier_invoice where id = 'a1140000-0000-4000-8000-000000000107') is not null then raise exception 'PRUEBA R14 · 8: la vuelta atrás de la 1130 no la ha deshecho.'; end if;
  if (select p.name from public.party_role r join public.party p on p.id = r.party_id where r.supplier_id = 'a1140000-0000-4000-8000-0000000002a1' and r.role = 'supplier') <> 'Reparto Muestra Limited'
     or exists (select 1 from public.party where tax_id = 'GB000000001' and archived_at is not null) then
    raise exception 'PRUEBA R14 · 8: la vuelta atrás no devuelve la ficha suelta a su tercero.';
  end if;
end $$;
\i supabase/vuelta-atras/20261121T1120_r14_proveedor_solo_al_leer.down.sql
\i supabase/vuelta-atras/20261121T1110_r14_proveedor_solo_anade.down.sql
do $$ begin
  if to_regclass('public.conta_proveedor_solo') is not null or to_regclass('public.conta_gasto_por_venta') is not null
     or to_regprocedure('public._conta_proveedor_solo(uuid,text)') is not null or to_regprocedure('public.conta_gasto_propuesto(uuid,uuid,uuid)') is not null
     or exists (select 1 from pg_trigger where tgname = 'r14_proveedor_solo') then
    raise exception 'PRUEBA R14 · 8: las vueltas atrás no lo quitan todo.';
  end if;
  raise notice '8 OK: las tres vueltas atrás lo quitan todo.';
end $$;

rollback;
