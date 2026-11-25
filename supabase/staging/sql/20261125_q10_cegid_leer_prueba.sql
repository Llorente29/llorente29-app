-- supabase/staging/sql/20261125_q10_cegid_leer_prueba.sql
--
-- SOLO STAGING. La 1840 del Q10 (leer la facturación de Cegid), en las cuentas A y B de pruebas, con ROLLBACK:
--   1. La 1840, dos veces: el conector «diezrec» (uno solo) y las tres tablas de lo leído.
--   2. Lo leído (sembrado como lo escribe conta-cegid-leer, con la clave de servicio: aquí, como postgres) lo lee
--      la persona de la cuenta A y NO la de la cuenta B; y nadie lo escribe desde la pantalla (solo select).
--   3. La vuelta atrás: sin conexiones, quita las tablas y el conector; y otra vez la 1840.
-- Datos inventados (T11). Nada sale a Cegid: esto es solo la base.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 CEGID: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261125T1840_q10_cegid_leer.sql
\i supabase/migrations/20261125T1840_q10_cegid_leer.sql
do $$ begin
  if (select count(*) from public.connector where code = 'diezrec') <> 1
     or to_regclass('public.conta_cegid_cliente') is null or to_regclass('public.conta_cegid_concepto') is null or to_regclass('public.conta_cegid_factura') is null then
    raise exception 'Q10 CEGID · 1: falta algo de la 1840.';
  end if;
  raise notice 'Q10 CEGID · 1: la 1840 carga, y dos veces. OK';
end $$;

create temp table _c (clave text primary key, v text) on commit drop;
grant select on _c to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into _c values ('empresa', v_e::text);
  insert into public.conta_cegid_cliente (company_id, account_id, codigo, nombre_fiscal, nif, conceptos)
  values (v_e, v_acc, 167, 'Cliente Prueba Cegid, S.L.', 'B00000000', '[{"codigoConcepto": "0008", "importe": 20, "cantidad": 5, "totalLinea": 100}]');
  insert into public.conta_cegid_concepto (company_id, account_id, codigo, descripcion, por_iva, con_retencion) values (v_e, v_acc, '0008', 'GESTIÓN LABORAL', 21, false);
  insert into public.conta_cegid_factura (company_id, account_id, ejercicio, serie, codigo, cliente, base, iva, total, lineas)
  values (v_e, v_acc, 2026, '1', 2742, 167, 100, 21, 121, '[{"linea": 1, "codigoConcepto": "0008", "importe": 20, "cantidad": 5}]');
end $$;

-- 2 · La persona de A lo lee; no lo escribe.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa');
begin
  if (select count(*) from public.conta_cegid_cliente where company_id = v_e) <> 1 or (select count(*) from public.conta_cegid_factura where company_id = v_e) <> 1
     or (select count(*) from public.conta_cegid_concepto where company_id = v_e) <> 1 then
    raise exception 'Q10 CEGID · 2: la persona de A no ve lo leído de Cegid de su empresa.';
  end if;
  begin
    insert into public.conta_cegid_cliente (company_id, account_id, codigo) values (v_e, 'c01a0000-0000-4000-8000-00000000000a', 1);
    raise exception 'Q10 CEGID · 2: desde la pantalla se ha escrito en lo leído de Cegid.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_cegid_cliente) or exists (select 1 from public.conta_cegid_factura) or exists (select 1 from public.conta_cegid_concepto) then
    raise exception 'Q10 CEGID · 2: la cuenta B ve lo leído de Cegid de la A.';
  end if;
  raise notice 'Q10 CEGID · 2: A lo lee, B no, y desde la pantalla no se escribe. OK';
end $$;
reset role;

-- 3 · La vuelta atrás (sin conexiones con «diezrec») y otra vez la 1840.
do $$ begin
  if exists (select 1 from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'diezrec') then
    raise notice 'Q10 CEGID · 3: esta base ya tiene conexiones con «diezrec»: la vuelta atrás deja el conector (lo dice y se mira abajo).';
  end if;
end $$;
\i supabase/vuelta-atras/20261125T1840_q10_cegid_leer.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_cliente') is not null or to_regclass('public.conta_cegid_factura') is not null then
    raise exception 'Q10 CEGID · 3: la vuelta atrás no quita las tablas.';
  end if;
  if not exists (select 1 from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'diezrec')
     and exists (select 1 from public.connector where code = 'diezrec') then
    raise exception 'Q10 CEGID · 3: sin conexiones, la vuelta atrás no quita el conector.';
  end if;
  raise notice 'Q10 CEGID · 3: la vuelta atrás lo deja como estaba. OK';
end $$;
\i supabase/migrations/20261125T1840_q10_cegid_leer.sql
\echo 'Q10 CEGID · 3: y otra vez la 1840. OK'

rollback;
