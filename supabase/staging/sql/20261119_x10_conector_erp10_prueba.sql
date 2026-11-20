-- supabase/staging/sql/20261119_x10_conector_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X10 (20261119T1250_x10_conector_erp10), que el ensayo de staging
-- pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra el objeto: public.connector (una fila nueva, code = 'erp10'). No cambia ninguna tabla,
-- columna ni función.
--
--   1. El conector está una vez, con sus cuatro claves cifradas y la base del despacho en claro.
--   2. Pasarla dos veces no cambia nada (on conflict do nothing).
--   3. Con una conexión de Diez y otra de ERP10 en la MISMA sociedad (cuenta y sociedad
--      inventadas, creadas aquí), la búsqueda de Diez (connector.code = 'diez', como
--      diezDespacho.ts) encuentra una sola, la suya; y la de ERP10, la suya.
--   4. La vuelta atrás (el fichero de verdad, con \i) quita el conector cuando no hay conexiones.
--
-- Sin datos reales (T11).
--
-- sin usuario: el catálogo de conectores es global y solo lo escribe una migración; las
-- conexiones de la sección 3 las pone la prueba por debajo, para mirar qué encuentra cada
-- búsqueda (las de Diez y ERP10 son de la clave de servicio, no de un usuario).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X10: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 1 · Una vez, con sus campos ------------------------------------------------------------------
do $$
declare n int; s jsonb;
begin
  select count(*), max(config_schema::text)::jsonb into n, s from public.connector where code = 'erp10';
  if n <> 1 then raise exception 'PRUEBA X10 · 1: el conector erp10 está % veces', n; end if;
  if (select count(*) from jsonb_array_elements(s->'fields') f where f->>'type' = 'secret') <> 4 then raise exception 'PRUEBA X10 · 1: no son 4 claves cifradas'; end if;
  if not exists (select 1 from jsonb_array_elements(s->'fields') f where f->>'key' = 'nombre_bd' and f->>'type' = 'text') then raise exception 'PRUEBA X10 · 1: falta la base del despacho'; end if;
  if exists (select 1 from jsonb_array_elements(s->'fields') f where f->>'label' ~* 'token|api|endpoint') then raise exception 'PRUEBA X10 · 1: una etiqueta dice token, API o endpoint'; end if;
  raise notice 'PRUEBA X10 · 1: el conector erp10, una vez, con 4 claves cifradas y la base del despacho.';
end $$;

-- 2 · Dos veces seguidas -----------------------------------------------------------------------
insert into public.connector (code, name, category, connection_type, managed_by, direction, description, config_schema, features, is_available, status, sort_order)
values ('erp10', 'otro', 'other', 'credentials', 'client', 'bidirectional', 'otro', '{}'::jsonb, '[]'::jsonb, true, 'active', 1)
on conflict (code) do nothing;
do $$ begin
  if (select name from public.connector where code = 'erp10') <> 'ERP10 (despacho)' then raise exception 'PRUEBA X10 · 2: la segunda pasada cambió la fila'; end if;
  raise notice 'PRUEBA X10 · 2: pasarla otra vez no cambia nada.';
end $$;

-- 3 · Diez y ERP10 en la misma sociedad --------------------------------------------------------
insert into public.accounts (id, name, slug) values ('00000000-0000-0000-0000-0000000a1010', 'Cuenta X10 inventada', 'cuenta-x10-inventada');
insert into public.company (id, account_id, legal_name, tax_id) values ('00000000-0000-0000-0000-0000000c1010', '00000000-0000-0000-0000-0000000a1010', 'Sociedad X10 inventada', 'B00000000');
insert into public.account_connector (account_id, connector_id, scope, company_id, status, external_account_id)
select '00000000-0000-0000-0000-0000000a1010', id, 'company', '00000000-0000-0000-0000-0000000c1010', 'connected', case code when 'diez' then 'C0009' else '99999' end
  from public.connector where code in ('diez', 'erp10');
do $$
declare d int; e int; bd text;
begin
  select count(*), max(ac.external_account_id) into d, bd from public.account_connector ac join public.connector c on c.id = ac.connector_id
   where ac.account_id = '00000000-0000-0000-0000-0000000a1010' and ac.company_id = '00000000-0000-0000-0000-0000000c1010'
     and ac.scope = 'company' and c.code = 'diez' and ac.status = 'connected';
  select count(*) into e from public.account_connector ac join public.connector c on c.id = ac.connector_id
   where ac.account_id = '00000000-0000-0000-0000-0000000a1010' and ac.company_id = '00000000-0000-0000-0000-0000000c1010' and c.code = 'erp10';
  if d <> 1 or bd <> 'C0009' then raise exception 'PRUEBA X10 · 3: Diez encuentra % conexiones (%)', d, bd; end if;
  if e <> 1 then raise exception 'PRUEBA X10 · 3: ERP10 encuentra % conexiones', e; end if;
  raise notice 'PRUEBA X10 · 3: con las dos en la misma sociedad, Diez encuentra la suya (una) y ERP10 la suya (una).';
end $$;

-- 4 · La vuelta atrás --------------------------------------------------------------------------
-- Con conexiones, para (lo mismo que hace el fichero, aquí para poder seguir dentro de la
-- transacción); sin ellas, el fichero de verdad la quita.
do $$ begin
  if not exists (select 1 from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'erp10') then
    raise exception 'PRUEBA X10 · 4: no hay conexiones con las que ver que para';
  end if;
end $$;
delete from public.account_connector where account_id = '00000000-0000-0000-0000-0000000a1010';
\i supabase/vuelta-atras/20261119T1250_x10_conector_erp10.down.sql
do $$ begin
  if exists (select 1 from public.connector where code = 'erp10') then raise exception 'PRUEBA X10 · 4: la vuelta atrás no lo ha quitado'; end if;
  raise notice 'PRUEBA X10 · 4: sin conexiones, la vuelta atrás quita el conector.';
end $$;

rollback;
