-- supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
--
-- SOLO STAGING. Prueba del E01 (20261116T1840). Todo en una transacción
-- con ROLLBACK. Datos inventados, en las cuentas de prueba A, B y la del
-- despacho de prueba (C01 y Sumied de prueba).
-- Prueba lo que cambia en caliente: public.company_inbound_address,
-- public.conta_entrada_correo, public.conta_direccion_entrada,
-- public.conta_direccion_facturas, public.conta_correo_facturas,
-- public.conta_puerta y public.conta_documentos_recibidos.
--
--   1. La regla del dominio, los tres casos: cuenta Folvy sin despacho
--      (folvy), cuenta Sumied (sumied), cuenta Folvy con despacho Sumied con
--      permiso vivo (sumied); y con el permiso revocado, otra vez folvy.
--   2. Las direcciones de la 1840 (su paso 6), dos veces: una dirección nueva por cada una de Folvy de una
--      empresa de dominio Sumied, no dos; la de Folvy sigue encendida; las de
--      la cuenta Folvy sin despacho, intactas.
--   3. Las pantallas: Correo de facturas, Documentos y Documentos recibidos
--      enseñan la misma, la de su dominio; la de Folvy viva no sale.
--   4. Crear la dirección: en el dominio de la regla.
--   5. El correo apunta por qué cuenta de Resend entró, y la primera se queda.
--   6. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- La tanda, por si el workflow no la ha pasado ya (se puede pasar dos veces).
\i supabase/migrations/20261116T1840_e01_entrada_sumied.sql

-- Las empresas de la prueba: A (cuenta Folvy, sin despacho), B (cuenta Folvy;
-- se le da un despacho de marca Sumied) y la del hostal (cuenta Sumied).
create temp table e01 (k text primary key, v uuid) on commit drop;
insert into e01 values
  ('a', (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1)),
  ('b', (select id from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' order by created_at limit 1)),
  ('s', (select id from public.company where account_id = 'd5ac0000-0000-4000-8000-00000000c010' order by created_at limit 1)),
  ('despacho', (select id from public.accounts where product_brand = 'sumied' and id = 'd5ac0000-0000-4000-8000-0000000000a0'));
grant select on e01 to authenticated;

delete from public.company_tax_presenter where company_id = (select v from e01 where k = 'b');
insert into public.company_tax_presenter (company_id, account_id, mode, advisor_account_id, advisor_basis, consented_by, consented_by_name, consented_at)
select (select v from e01 where k = 'b'), 'c01b0000-0000-4000-8000-00000000000b', 'advisor', (select v from e01 where k = 'despacho'), 'social_collaborator',
       'c01b0000-0000-4000-8000-0000000000b1', 'Persona de Prueba', now();

-- 1 · La regla.
do $$
declare a text := public._conta_dominio_entrada((select v from e01 where k = 'a'));
        b text := public._conta_dominio_entrada((select v from e01 where k = 'b'));
        s text := public._conta_dominio_entrada((select v from e01 where k = 's'));
begin
  if a <> 'entrada.folvy.app' or b <> 'entrada.sumied.com' or s <> 'entrada.sumied.com' then
    raise exception 'PRUEBA E01 · 1: la regla no da folvy / sumied / sumied: % / % / %', a, b, s;
  end if;
  update public.company_tax_presenter set revoked_at = now(), revoked_by = 'c01b0000-0000-4000-8000-0000000000b1' where company_id = (select v from e01 where k = 'b');
  if public._conta_dominio_entrada((select v from e01 where k = 'b')) <> 'entrada.folvy.app' then
    raise exception 'PRUEBA E01 · 1: con el permiso revocado, B sigue en entrada.sumied.com.';
  end if;
  update public.company_tax_presenter set revoked_at = null, revoked_by = null where company_id = (select v from e01 where k = 'b');
  raise notice 'PRUEBA E01 · 1: Folvy sin despacho → %, cuenta Sumied → %, Folvy con despacho Sumied → % (revocado → folvy).', a, s, b;
end $$;

-- 2 · Las direcciones de la 1840, dos veces.
delete from public.company_inbound_address where company_id in (select v from e01 where k in ('a', 'b', 's'));
insert into public.company_inbound_address (account_id, company_id, kind, local_part, domain, active, created_by_name) values
  ('c01a0000-0000-4000-8000-00000000000a', (select v from e01 where k = 'a'), 'facturas', 'facturas-e01-prueba-a', 'entrada.folvy.app', true, 'Prueba E01'),
  ('c01b0000-0000-4000-8000-00000000000b', (select v from e01 where k = 'b'), 'facturas', 'facturas-e01-prueba-b', 'entrada.folvy.app', true, 'Prueba E01'),
  ('d5ac0000-0000-4000-8000-00000000c010', (select v from e01 where k = 's'), 'facturas', 'facturas-e01-prueba-s', 'entrada.folvy.app', true, 'Prueba E01');
create temp table e01_antes on commit drop as
  select company_id, kind, local_part, domain, active from public.company_inbound_address where company_id not in (select v from e01 where k in ('b', 's'));
\i supabase/migrations/20261116T1840_e01_entrada_sumied.sql
\i supabase/migrations/20261116T1840_e01_entrada_sumied.sql
do $$
declare n int; m int;
begin
  select count(*) into n from public.company_inbound_address where created_by_name = 'Tanda E01 · entrada.sumied.com' and company_id in (select v from e01 where k in ('b', 's'));
  if n <> 2 then raise exception 'PRUEBA E01 · 2: la 1840 dos veces deja % direcciones nuevas en B y el hostal, y debían ser 2.', n; end if;
  if exists (select 1 from public.company_inbound_address where company_id in (select v from e01 where k in ('b', 's')) and lower(domain) = 'entrada.folvy.app' and not active) then
    raise exception 'PRUEBA E01 · 2: una de entrada.folvy.app se ha apagado.';
  end if;
  if not exists (select 1 from public.company_inbound_address where company_id = (select v from e01 where k = 'b') and local_part = 'facturas-e01-prueba-b' and domain = 'entrada.sumied.com' and active) then
    raise exception 'PRUEBA E01 · 2: B no tiene la misma dirección en entrada.sumied.com, encendida.';
  end if;
  select count(*) into m from (select company_id, kind, local_part, domain, active from public.company_inbound_address where company_id not in (select v from e01 where k in ('b', 's'))
                                except select * from e01_antes) x;
  if m <> 0 or exists (select 1 from public.company_inbound_address where company_id = (select v from e01 where k = 'a') and domain <> 'entrada.folvy.app') then
    raise exception 'PRUEBA E01 · 2: la 1840 ha tocado direcciones de empresas que no son de Sumied (%).', m;
  end if;
  raise notice 'PRUEBA E01 · 2: dos pasadas, % nuevas (no %), las de Folvy encendidas, A intacta.', n, n * 2;
end $$;

-- 3 · Las pantallas, como la administradora de B y como la de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare c jsonb := public.conta_correo_facturas((select v from e01 where k = 'b'));
        p jsonb := public.conta_puerta((select v from e01 where k = 'b'), 30);
        d jsonb := public.conta_documentos_recibidos((select v from e01 where k = 'b'), current_date - 30, current_date);
begin
  if c->>'direccion' is distinct from 'facturas-e01-prueba-b@entrada.sumied.com' then raise exception 'PRUEBA E01 · 3: Correo de facturas de B dice %', c->>'direccion'; end if;
  if p->'direccion'->>'direccion' is distinct from 'facturas-e01-prueba-b@entrada.sumied.com' then raise exception 'PRUEBA E01 · 3: Documentos de B dice %', p->'direccion'; end if;
  if p::text like '%e01-prueba-b@entrada.folvy.app%' then raise exception 'PRUEBA E01 · 3: Documentos de B enseña la de entrada.folvy.app: %', p->'direcciones'; end if;
  if d::text like '%e01-prueba-b@entrada.folvy.app%' or d::text not like '%e01-prueba-b@entrada.sumied.com%' then raise exception 'PRUEBA E01 · 3: Documentos recibidos de B no enseña la de Sumied.'; end if;
  raise notice 'PRUEBA E01 · 3: B ve % en las tres pantallas.', c->>'direccion';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare c jsonb := public.conta_correo_facturas((select v from e01 where k = 'a'));
        p jsonb := public.conta_puerta((select v from e01 where k = 'a'), 30);
begin
  if c->>'direccion' is distinct from 'facturas-e01-prueba-a@entrada.folvy.app' or p->'direccion'->>'direccion' is distinct from 'facturas-e01-prueba-a@entrada.folvy.app' then
    raise exception 'PRUEBA E01 · 3: A (Folvy) no ve la suya: % / %', c->>'direccion', p->'direccion';
  end if;
  raise notice 'PRUEBA E01 · 3: A ve % en Correo de facturas y en Documentos.', c->>'direccion';
end $$;
reset role;

-- 4 · Crear la dirección, en el dominio de la regla (B: la de documentos, que no tiene).
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb := public.conta_direccion_entrada((select v from e01 where k = 'b'), 'documentos', 'Persona de Prueba');
        y jsonb := public.conta_direccion_entrada((select v from e01 where k = 'b'), 'facturas', 'Persona de Prueba');
begin
  if r->>'direccion' not like '%@entrada.sumied.com' or (r->>'ya_estaba')::boolean then raise exception 'PRUEBA E01 · 4: la de documentos de B nace en %', r->>'direccion'; end if;
  if y->>'direccion' <> 'facturas-e01-prueba-b@entrada.sumied.com' or not (y->>'ya_estaba')::boolean then raise exception 'PRUEBA E01 · 4: la de facturas de B no es la que ya tenía: %', y; end if;
  if public.conta_puerta((select v from e01 where k = 'b'), 30)->'direccion'->>'direccion' <> r->>'direccion' then raise exception 'PRUEBA E01 · 4: con la de documentos, Documentos no la enseña.'; end if;
  raise notice 'PRUEBA E01 · 4: nace %; la de facturas ya estaba.', r->>'direccion';
end $$;
reset role;

-- 5 · Por qué cuenta de Resend entró cada correo.
select public.conta_entrada_correo(jsonb_build_object('email_id', 'e01-prueba-1', 'to', 'facturas-e01-prueba-b@entrada.sumied.com', 'from', 'proveedor@ejemplo.test',
  'subject', 'Factura', 'company_id', (select v from e01 where k = 'b'), 'resultado', 'confirmacion', 'detalle', jsonb_build_object('codigo', '123456789'), 'cuenta_resend', 'sumied'));
select public.conta_entrada_correo(jsonb_build_object('email_id', 'e01-prueba-1', 'to', 'facturas-e01-prueba-b@entrada.sumied.com', 'from', 'proveedor@ejemplo.test',
  'subject', 'Factura', 'company_id', (select v from e01 where k = 'b'), 'resultado', 'confirmacion', 'detalle', jsonb_build_object('codigo', '123456789')));
select public.conta_entrada_correo(jsonb_build_object('email_id', 'e01-prueba-2', 'to', 'facturas-e01-prueba-a@entrada.folvy.app', 'from', 'proveedor@ejemplo.test',
  'subject', 'Factura', 'company_id', (select v from e01 where k = 'a'), 'resultado', 'recibido', 'detalle', '{}'::jsonb));
do $$ begin
  if (select resend_account from public.inbound_email_log where email_id = 'e01-prueba-1') is distinct from 'sumied'
     or (select resend_account from public.inbound_email_log where email_id = 'e01-prueba-2') is not null then
    raise exception 'PRUEBA E01 · 5: la cuenta de Resend no queda apuntada como debe.';
  end if;
  raise notice 'PRUEBA E01 · 5: el de Sumied queda «sumied» (también al volver a apuntarlo sin cuenta); el de antes, vacío.';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare c jsonb := public.conta_correo_facturas((select v from e01 where k = 'b'));
begin
  -- B tiene ahora la de documentos (4): Correo de facturas enseña esa; la confirmación de la de facturas se ve con su dirección.
  if c->>'direccion' not like '%@entrada.sumied.com' then raise exception 'PRUEBA E01 · 5: Correo de facturas de B dice %', c->>'direccion'; end if;
  raise notice 'PRUEBA E01 · 5: Correo de facturas de B: %.', c->>'direccion';
end $$;
reset role;

-- 6 · La vuelta atrás, y otra vez delante (sin los correos de la prueba: con ellos, la vuelta atrás para, y así debe).
delete from public.inbound_email_log where email_id like 'e01-prueba-%';
\i supabase/vuelta-atras/20261116T1840_e01_entrada_sumied.down.sql
do $$ begin
  if to_regprocedure('public._conta_dominio_entrada(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'inbound_email_log' and column_name = 'resend_account')
     or not exists (select 1 from pg_constraint where conname = 'company_inbound_address_company_id_kind_key')
     or position('E01 ·' in pg_get_functiondef('public.conta_puerta(uuid,integer)'::regprocedure)) > 0
     or exists (select 1 from public.company_inbound_address where created_by_name = 'Tanda E01 · entrada.sumied.com') then
    raise exception 'PRUEBA E01 · 6: la vuelta atrás no deja las cosas como estaban.';
  end if;
  raise notice 'PRUEBA E01 · 6: la vuelta atrás quita la 1840 y sus direcciones.';
end $$;
\i supabase/migrations/20261116T1840_e01_entrada_sumied.sql

rollback;
