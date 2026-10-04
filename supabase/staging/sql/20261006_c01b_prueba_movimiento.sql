-- supabase/staging/sql/20261006_c01b_prueba_movimiento.sql
--
-- C01b · Pruebas de la tarea 2 en staging-conta, DESPUÉS de aplicar
-- 20261006T0100/0110/0120. Termina en ROLLBACK: no deja nada.
--
--   1. ANTES = DESPUÉS: scripts/conta/c01b_antes_despues.sql, «faltan» a 0.
--   2. Lo que tiene que haber movido, caso a caso (semillas C01 y C01b).
--   3. compliance_docs_due: al contacto de administración; si no, al principal.
--   4. Clonado de la plantilla (decisión 4): cuenta nueva desde la cuenta A con
--      migrate_kitchen_core VIEJA y con la NUEVA; mismo resultado: cada email,
--      teléfono y dirección de cada proveedor clonado está en su sitio nuevo.
--   5. Vuelta atrás: 0120 → 0110 → 0100, con los md5 de producción al final.

begin;

\echo '>>> 1. Antes = después'
-- La consulta del fichero, sin su «;» final, para poder meterla entre paréntesis
-- (el workflow corre psql desde la raíz del repositorio).
\set q_ad `sed -e 's/;[[:space:]]*$//' scripts/conta/c01b_antes_despues.sql`
create temp table ad as select * from (:q_ad) x;
select * from ad;
do $$ begin
  if exists (select 1 from ad where faltan <> 0) then
    raise exception 'PRUEBA C01b: antes = después NO cuadra: %', (select json_agg(ad) from ad where faltan <> 0);
  end if;
end $$;

\echo '>>> 2. Caso a caso'
do $$
declare
  a_ruiz  constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  a_norte constant uuid := 'c1b0a000-0000-4000-8000-0000000000a6';
  v jsonb;
begin
  -- Mercados del Norte: teléfono → contacto principal; dirección sin CP → propuesta sin CP ni población.
  if not exists (select 1 from public.supplier_contact where supplier_id = a_norte and is_primary and phone = '600 000 007') then
    raise exception 'PRUEBA C01b: Mercados del Norte no tiene su teléfono en un contacto principal.';
  end if;
  select value into v from public.supplier_proposal where supplier_id = a_norte and source = 'legacy_address' and status = 'pending';
  if v is null or v->>'line' <> 'Calle Mayor 3, Alcobendas' or v->>'postal_code' is not null or v->>'street' <> 'Calle Mayor 3, Alcobendas' then
    raise exception 'PRUEBA C01b: la dirección por confirmar de Mercados del Norte no es la esperada: %', v;
  end if;
  -- Hermanos Ruiz: IVA [10, 21] → dos referencias a tax_rate de península.
  if (select array_agg(t.rate order by t.rate) from public.supplier s join public.tax_rate t on t.id = any(s.usual_tax_rate_ids) where s.id = a_ruiz)
     is distinct from array[10.00, 21.00]::numeric[] then
    raise exception 'PRUEBA C01b: los IVA de Hermanos Ruiz no son 10 y 21.';
  end if;
  -- El disparador rechaza un IVA que no existe.
  begin
    update public.supplier set usual_tax_rate_ids = array[gen_random_uuid()] where id = a_ruiz;
    raise exception 'PRUEBA C01b: el disparador dejó guardar un IVA inexistente.';
  exception when foreign_key_violation then null;
  end;
  raise notice 'Caso a caso: OK';
end $$;

\echo '>>> 3. compliance_docs_due'
savepoint cdd;
do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_ruiz   constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  v text;
begin
  -- La ficha técnica de Hermanos Ruiz (semilla C01b) está en la lista.
  if not exists (select 1 from public.compliance_docs_due(30) where supplier_id = a_ruiz) then
    raise exception 'PRUEBA C01b: la ficha técnica de Hermanos Ruiz no sale en compliance_docs_due.';
  end if;
  -- a) Su principal (semilla del C01) no tiene email y no hay administración:
  --    no se manda nada (decisión 3), aunque haya otro contacto con email.
  if exists (select 1 from public.supplier_contact where supplier_id = a_ruiz and (is_primary or role = 'admin') and nullif(btrim(email), '') is not null) then
    raise exception 'PRUEBA C01b: la semilla ya no es el caso «sin destinatario»; revisa la prueba.';
  end if;
  select supplier_email into v from public.compliance_docs_due(30) where supplier_id = a_ruiz;
  if v is not null then raise exception 'PRUEBA C01b a): sin administración ni principal con email sale %', v; end if;
  -- b) Con un contacto de administración, va a él.
  insert into public.supplier_contact (account_id, supplier_id, name, role, email)
  values (a_cuenta, a_ruiz, 'Administración prueba', 'admin', 'admin.prueba@hermanosruiz.test');
  select supplier_email into v from public.compliance_docs_due(30) where supplier_id = a_ruiz;
  if v is distinct from 'admin.prueba@hermanosruiz.test' then raise exception 'PRUEBA C01b b): no va a administración, va a %', v; end if;
  -- c) Sin administración y con principal con email, al principal.
  delete from public.supplier_contact where supplier_id = a_ruiz and role = 'admin';
  update public.supplier_contact set email = 'principal.prueba@hermanosruiz.test' where supplier_id = a_ruiz and is_primary;
  select supplier_email into v from public.compliance_docs_due(30) where supplier_id = a_ruiz;
  if v is distinct from 'principal.prueba@hermanosruiz.test' then raise exception 'PRUEBA C01b c): no va al principal, va a %', v; end if;
  -- d) Nadie con email: nada.
  update public.supplier_contact set email = null where supplier_id = a_ruiz;
  select supplier_email into v from public.compliance_docs_due(30) where supplier_id = a_ruiz;
  if v is not null then raise exception 'PRUEBA C01b d): sin contactos con email sigue saliendo %', v; end if;
  raise notice 'compliance_docs_due: OK (sin destinatario, administración, principal, nadie).';
end $$;
rollback to savepoint cdd;

\echo '>>> 4. Clonado de la plantilla: función vieja y nueva'
savepoint clon;
insert into public.accounts (id, name, slug, status, business_type)
values ('c1b0f000-0000-4000-8000-0000000000f1', 'Clon viejo C01b', 'clon-viejo-c01b', 'active', 'restaurante'),
       ('c1b0f000-0000-4000-8000-0000000000f2', 'Clon nuevo C01b', 'clon-nuevo-c01b', 'active', 'restaurante');
\ir ../../vuelta-atras/20261006T0120_c01b_lectores.down.sql
select * from public.migrate_kitchen_core('c01a0000-0000-4000-8000-00000000000a', 'c1b0f000-0000-4000-8000-0000000000f1', true);
\ir ../../migrations/20261006T0120_c01b_lectores.sql
select * from public.migrate_kitchen_core('c01a0000-0000-4000-8000-00000000000a', 'c1b0f000-0000-4000-8000-0000000000f2', true);
do $$
declare
  viejo constant uuid := 'c1b0f000-0000-4000-8000-0000000000f1';
  nuevo constant uuid := 'c1b0f000-0000-4000-8000-0000000000f2';
  v_prov int; v_faltan int;
begin
  select count(*) into v_prov from public.supplier where account_id = nuevo;
  if v_prov = 0 or v_prov <> (select count(*) from public.supplier where account_id = viejo) then
    raise exception 'PRUEBA C01b: el clon nuevo tiene % proveedores y el viejo %.', v_prov, (select count(*) from public.supplier where account_id = viejo);
  end if;
  -- Lo que el clon viejo llevaba en columnas viejas, el nuevo lo lleva en su sitio (por nombre de proveedor DENTRO de cada clon).
  select count(*) into v_faltan from public.supplier o
   where o.account_id = viejo and (
     (nullif(btrim(o.email), '') is not null and not exists (
        select 1 from public.supplier n join public.supplier_contact c on c.supplier_id = n.id
         where n.account_id = nuevo and n.name = o.name and lower(btrim(c.email)) = lower(btrim(o.email))))
  or (nullif(btrim(o.phone), '') is not null and not exists (
        select 1 from public.supplier n join public.supplier_contact c on c.supplier_id = n.id
         where n.account_id = nuevo and n.name = o.name and btrim(c.phone) = btrim(o.phone)))
  or (nullif(btrim(o.address), '') is not null and not exists (
        select 1 from public.supplier n where n.account_id = nuevo and n.name = o.name
           and (nullif(btrim(n.fiscal_street), '') is not null
                or exists (select 1 from public.supplier_proposal p where p.supplier_id = n.id and p.field = 'fiscal_address'
                             and btrim(p.value->>'line') = btrim(o.address))))));
  if v_faltan > 0 then raise exception 'PRUEBA C01b: al clonar se pierden datos de % proveedores.', v_faltan; end if;
  -- Y el clon nuevo no escribe en las columnas viejas.
  if exists (select 1 from public.supplier where account_id = nuevo and (email is not null or phone is not null or address is not null)) then
    raise exception 'PRUEBA C01b: el clon nuevo sigue escribiendo en las columnas viejas.';
  end if;
  raise notice 'Clonado: % proveedores, mismo resultado con la función vieja y la nueva.', v_prov;
end $$;
rollback to savepoint clon;

\echo '>>> 5. Vuelta atrás 0120 → 0110 → 0100'
\ir ../../vuelta-atras/20261006T0120_c01b_lectores.down.sql
\ir ../../vuelta-atras/20261006T0110_c01b_datos.down.sql
\ir ../../vuelta-atras/20261006T0100_c01b_estructura.down.sql
do $$
declare v_cdd text; v_mkc text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_cdd from pg_proc p where p.proname = 'compliance_docs_due';
  select md5(pg_get_functiondef(p.oid)) into v_mkc from pg_proc p where p.proname = 'migrate_kitchen_core';
  if v_cdd <> '64fec3b5acecb3948e7fbf334a66a7e0' or v_mkc <> '5dca6db9b000003a8d5ce97f16d42fda' then
    raise exception 'PRUEBA C01b: tras la vuelta atrás las funciones no son las de producción (cdd %, mkc %).', v_cdd, v_mkc;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'usual_tax_rate_ids')
     or to_regclass('public.c01b_movimiento_registro') is not null then
    raise exception 'PRUEBA C01b: la vuelta atrás de la 0100 no ha quitado lo suyo.';
  end if;
  raise notice 'Vuelta atrás: OK; md5 = producción.';
end $$;

\echo '>>> TODO EN VERDE. ROLLBACK: no queda nada de la prueba.'
rollback;
