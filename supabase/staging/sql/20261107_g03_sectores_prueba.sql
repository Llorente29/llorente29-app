-- supabase/staging/sql/20261107_g03_sectores_prueba.sql
--
-- SOLO STAGING. La tanda del G03 (el sector de cada empresa), por sus caminos:
--   1. La 1945 (columna, CHECK, disparador), si staging aún no la tiene.
--   2. La 1946 sobre datos: cada empresa con sector; ninguna que no cuadre con
--      is_hospitality; una con sector ya puesto a mano no se toca; las nulas
--      que no son de hostelería siguen nulas.
--   3. Las dos cuentas ancladas (QBO y Casa Lola), con ids inventados que se
--      cambian por los suyos solo dentro de la prueba: inventadas aquí, con
--      las empresas medidas en producción (2 y 1), y la guarda PARA si no
--      son esas.
--   4. COMO USUARIO de A (set local role authenticated, con su sub), por los
--      caminos de la pantalla: Ajustes de hoy escribe is_hospitality y el
--      sector la sigue; Ajustes del G03 escribirá el sector e is_hospitality
--      lo sigue; un sector que no existe no entra.
--   5. Crear una empresa: con is_hospitality, con sector, sin nada.
--   6. Las dos vueltas atrás, de verdad y en orden inverso.
--
-- Todo acaba en ROLLBACK: staging es compartido y no cambia. Datos inventados (T11).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes on commit drop as
select id, is_hospitality from public.company;

-- 1 · La 1945, si falta.
select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'sector') as falta_1945 \gset
\if :falta_1945
\echo '>>> Staging aún no tiene la 1945 del G03: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261107T1945_g03_sector.sql
\endif
-- Pasarla dos veces no cambia nada (main la volverá a pasar al fusionar).
\i supabase/migrations/20261107T1945_g03_sector.sql

-- 3 · Las dos cuentas ancladas, inventadas con sus ids de producción (solo en esta transacción).
insert into public.accounts (id, name, slug, status, business_type, product_brand)
values ('f4e8032d-510a-4e57-914c-4b67732d8655', 'PRUEBA G03 GESTORIA', 'g03-prueba-gestoria', 'active', 'otra_actividad', 'sumied'),
       ('623d946a-a0ce-4f34-8c00-9761dfed8331', 'PRUEBA G03 RESTAURANTE', 'g03-prueba-restaurante', 'active', 'restaurante', 'sumied');
insert into public.company (account_id, legal_name, tax_id, is_hospitality)
values ('f4e8032d-510a-4e57-914c-4b67732d8655', 'PRUEBA G03 GESTORIA UNO SL', 'B00000001', false),
       ('f4e8032d-510a-4e57-914c-4b67732d8655', 'PRUEBA G03 GESTORIA DOS SL', 'B00000002', false),
       ('623d946a-a0ce-4f34-8c00-9761dfed8331', 'PRUEBA G03 RESTAURANTE SL', 'B00000003', null);
-- La 1945 ya está: al crearlas con is_hospitality, ya llevan sector. Se les quita para que las rellene la 1946.
update public.company set sector = null where account_id in ('f4e8032d-510a-4e57-914c-4b67732d8655', '623d946a-a0ce-4f34-8c00-9761dfed8331');
-- Y todas las de staging, sin sector (como en producción antes de la 1946), salvo una puesta a mano:
-- la primera empresa de A (se busca por su cuenta: su id cambia de una base a otra).
update public.company set sector = null;
update public.company set sector = 'gestoria' where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
create temp table _a_mano on commit drop as select id, is_hospitality from public.company where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);

savepoint antes_1946;
-- La guarda: si la cuenta de la gestoría no tiene sus 2 empresas, PARA sin poner nada.
insert into public.company (account_id, legal_name, tax_id) values ('f4e8032d-510a-4e57-914c-4b67732d8655', 'PRUEBA G03 GESTORIA TRES SL', 'B00000004');
\set ON_ERROR_STOP 0
\i supabase/migrations/20261107T1946_g03_sector_de_hoy.sql
\set ON_ERROR_STOP 1
rollback to savepoint antes_1946;
do $$ begin
  if exists (select 1 from public.company where sector is not null and id <> (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1)) then
    raise exception 'PRUEBA G03 · 3: con 3 empresas en la gestoría, la 1946 ha puesto sectores.';
  end if;
  raise notice 'G03 · 3: con una empresa de más en la cuenta anclada, la 1946 para sin poner nada. OK';
end $$;

-- 2 · La 1946.
\i supabase/migrations/20261107T1946_g03_sector_de_hoy.sql
do $$
declare n int;
begin
  if exists (select 1 from public.company where sector is null) then raise exception 'PRUEBA G03 · 2: quedan empresas sin sector.'; end if;
  if exists (select 1 from public.company where (sector = 'hosteleria') is distinct from coalesce(is_hospitality, false)) then
    raise exception 'PRUEBA G03 · 2: hay empresas cuyo sector no cuadra con is_hospitality.';
  end if;
  select count(*) into n from public.company where account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' and sector = 'gestoria' and is_hospitality = false;
  if n <> 2 then raise exception 'PRUEBA G03 · 2: la cuenta de la gestoría tenía que quedar con sus 2 empresas en gestoría; % lo están.', n; end if;
  if not exists (select 1 from public.company where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and sector = 'hosteleria' and is_hospitality) then
    raise exception 'PRUEBA G03 · 2: la cuenta del restaurante sin decir tenía que quedar de hostelería, con is_hospitality sí.';
  end if;
  if not exists (select 1 from public.company c join _a_mano m using (id) where c.sector = 'gestoria' and c.is_hospitality is not distinct from m.is_hospitality) then
    raise exception 'PRUEBA G03 · 2: la empresa con el sector puesto a mano ha cambiado.';
  end if;
  -- Fuera de las dos cuentas ancladas, is_hospitality no cambia en ninguna (las nulas que no son hostelería siguen nulas).
  select count(*) into n from public.company c join _antes a using (id) where c.is_hospitality is distinct from a.is_hospitality and c.id <> (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
  if n <> 0 then raise exception 'PRUEBA G03 · 2: la 1946 ha cambiado is_hospitality de % empresa(s) fuera de las anclas.', n; end if;
  select count(*) into n from public.company c join _antes a using (id) where a.is_hospitality is not true and c.sector = 'hosteleria';
  if n <> 0 then raise exception 'PRUEBA G03 · 2: % empresa(s) sin hostelería han quedado de hostelería.', n; end if;
  raise notice 'G03 · 2: todas con sector, ninguna que no cuadre, las anclas y la de a mano bien, is_hospitality igual en el resto. OK';
end $$;

-- 4 · Como usuario de A (admin de su cuenta), por los caminos de Ajustes.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare s text; h boolean;
begin
  -- Ajustes de hoy (guardarHosteleria): escribe is_hospitality; el sector la sigue.
  update public.company set is_hospitality = true where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1) returning sector, is_hospitality into s, h;
  if s is distinct from 'hosteleria' then raise exception 'PRUEBA G03 · 4a: con is_hospitality sí, el sector quedó en %.', s; end if;
  update public.company set is_hospitality = false where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1) returning sector into s;
  if s is distinct from 'general' then raise exception 'PRUEBA G03 · 4b: de hostelería a no, el sector quedó en %.', s; end if;
  -- Ajustes del G03: escribe el sector; is_hospitality lo sigue.
  update public.company set sector = 'hosteleria' where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1) returning is_hospitality into h;
  if h is distinct from true then raise exception 'PRUEBA G03 · 4c: con sector hostelería, is_hospitality quedó en %.', h; end if;
  update public.company set sector = 'gestoria' where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1) returning is_hospitality into h;
  if h is distinct from false then raise exception 'PRUEBA G03 · 4d: con sector gestoría, is_hospitality quedó en %.', h; end if;
  -- Una gestoría que dice «no» a hostelería sigue siendo gestoría.
  update public.company set is_hospitality = false where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1) returning sector into s;
  if s is distinct from 'gestoria' then raise exception 'PRUEBA G03 · 4e: una gestoría que dice no a hostelería pasó a %.', s; end if;
  -- Las dos a la vez: manda el sector.
  update public.company set sector = 'general', is_hospitality = true where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1) returning sector, is_hospitality into s, h;
  if s <> 'general' or h then raise exception 'PRUEBA G03 · 4f: con las dos a la vez quedó % · %.', s, h; end if;
  begin
    update public.company set sector = 'agencia_viajes' where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
    raise exception 'PRUEBA G03 · 4g: entró un sector que no existe.';
  exception when check_violation then raise notice 'G03 · 4g: un sector que no existe no entra (23514).';
  end;
  raise notice 'G03 · 4: como usuario, cada lado sigue al otro. OK';
end $$;
reset role;

-- 5 · Crear una empresa.
do $$
declare s text; h boolean;
begin
  insert into public.company (account_id, legal_name, tax_id, is_hospitality) values ('c01a0000-0000-4000-8000-00000000000a', 'PRUEBA G03 NUEVA UNO SL', 'B00000005', true) returning sector into s;
  if s is distinct from 'hosteleria' then raise exception 'PRUEBA G03 · 5a: nueva con hostelería, sector %.', s; end if;
  insert into public.company (account_id, legal_name, tax_id, sector) values ('c01a0000-0000-4000-8000-00000000000a', 'PRUEBA G03 NUEVA DOS SL', 'B00000006', 'gestoria') returning is_hospitality into h;
  if h is not null then raise exception 'PRUEBA G03 · 5b: nueva de gestoría, is_hospitality %.', h; end if;
  insert into public.company (account_id, legal_name, tax_id) values ('c01a0000-0000-4000-8000-00000000000a', 'PRUEBA G03 NUEVA TRES SL', 'B00000007') returning sector into s;
  if s is not null then raise exception 'PRUEBA G03 · 5c: nueva sin nada, sector %.', s; end if;
  raise notice 'G03 · 5: al crear, lo mismo. OK';
end $$;

-- 6 · Las vueltas atrás, en orden inverso.
\i supabase/vuelta-atras/20261107T1946_g03_sector_de_hoy.down.sql
do $$ begin
  if exists (select 1 from public.company where sector is not null) then raise exception 'PRUEBA G03 · 6a: tras la vuelta atrás de la 1946 quedan sectores.'; end if;
  if exists (select 1 from public.company where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and is_hospitality is not null) then
    raise exception 'PRUEBA G03 · 6a: el restaurante anclado no vuelve a «sin decir».';
  end if;
  raise notice 'G03 · 6a: vuelta atrás de la 1946, sin sectores y el restaurante sin decir. OK';
end $$;
\i supabase/vuelta-atras/20261107T1945_g03_sector.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'sector') then raise exception 'PRUEBA G03 · 6b: queda la columna.'; end if;
  if exists (select 1 from pg_catalog.pg_trigger where tgname = 'company_sector_al_dia') then raise exception 'PRUEBA G03 · 6b: queda el disparador.'; end if;
  if to_regprocedure('public._company_sector_al_dia()') is not null then raise exception 'PRUEBA G03 · 6b: queda la función.'; end if;
  raise notice 'G03 · 6b: vuelta atrás de la 1945, sin columna, disparador ni función. OK';
end $$;

rollback;
