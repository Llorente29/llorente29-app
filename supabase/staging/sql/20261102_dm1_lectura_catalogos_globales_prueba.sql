-- supabase/staging/sql/20261102_dm1_lectura_catalogos_globales_prueba.sql
--
-- SOLO STAGING. Prueba de la 1218 (DM1 · 2b-2: conta_lectura puede leer los
-- catálogos globales), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. En staging no existe conta_lectura: la prueba lo crea DENTRO de la
-- transacción (y se va con el ROLLBACK), sin permisos, como estaba en
-- producción el 02/11. Nombra lo que crea: public.catalogo_curso_global.
-- sin usuario: la 1218 da permisos a conta_lectura (el rol de lectura de los agentes), no a la app; entra como conta_lectura (paso 3) y comprueba que anon y authenticated no leen la vista (paso 2).
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1 1218: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
-- Si la 1218 ya está (el manifiesto la aplica antes que esta prueba, en la misma
-- transacción), primero su vuelta atrás.
select to_regclass('public.catalogo_curso_global') is not null as dm1_1218_aplicada \gset
\if :dm1_1218_aplicada
\i supabase/vuelta-atras/20261102T1218_dm1_lectura_catalogos_globales.down.sql
\endif
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    execute 'create role conta_lectura nologin';
    -- En staging, postgres no es superusuario: para entrar como el rol (paso 3)
    -- tiene que poder hacer SET ROLE, sin heredar sus permisos. Se va con el ROLLBACK.
    execute format('grant conta_lectura to %I with set true, inherit false', current_user);
  end if;
end $$;

-- Un curso global y uno de una cuenta de prueba, para ver qué enseña la vista.
insert into public.course (id, account_id, code, title, delivery_mode)
values ('d1a00000-0000-4000-8000-0000000000c1', null, 'dm1-prueba-global', 'Curso global de prueba DM1', 'solo_archivo'),
       ('d1a00000-0000-4000-8000-0000000000c2', 'c01a0000-0000-4000-8000-00000000000a', 'dm1-prueba-cuenta', 'Curso de la cuenta A, prueba DM1', 'solo_archivo');

create temp table _t (t text) on commit drop;
insert into _t values ('allergen'),('appcc_plans'),('billing_plans'),('dish_family_template'),('ingredient_family_template'),
  ('ingredient_template'),('ingredient_template_allergen'),('kitchen_cut_type_template'),('kitchen_unit'),('modules'),
  ('shop_cuisine'),('submodules'),('tag_template'),('training_path'),('training_path_item');

do $$ declare n int; begin
  select count(*) into n from _t where has_table_privilege('conta_lectura', ('public.' || t)::regclass, 'select');
  if n <> 0 then raise exception 'PRUEBA DM1 1218 · 0: antes, conta_lectura ya lee % de los 15: la prueba no mediría nada.', n; end if;
  raise notice 'DM1 1218 · 0 (rojo a propósito): antes, conta_lectura no lee ninguno de los 15 catálogos.';
end $$;

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261102T1218_dm1_lectura_catalogos_globales.sql

-- ── 2 · Lee los 15 y la vista; nunca course ─────────────────────────────────
-- Las que tienen alguna fila de cuenta no entran (en staging, kitchen_unit).
create temp table _con_cuenta on commit drop as
  select t from _t where t in ('kitchen_unit', 'training_path')
     and (select count(*) from public.kitchen_unit where t = 'kitchen_unit' and account_id is not null)
       + (select count(*) from public.training_path where t = 'training_path' and account_id is not null) > 0;
do $$ declare n int; e int; begin
  select count(*) into e from _con_cuenta;
  select count(*) into n from _t where has_table_privilege('conta_lectura', ('public.' || t)::regclass, 'select');
  if n <> 15 - e then raise exception 'PRUEBA DM1 1218 · 2: conta_lectura lee % de los 15 y debería leer % (las que tienen filas de cuenta no entran).', n, 15 - e; end if;
  if exists (select 1 from _con_cuenta where has_table_privilege('conta_lectura', ('public.' || t)::regclass, 'select')) then
    raise exception 'PRUEBA DM1 1218 · 2: conta_lectura lee una tabla con filas de cuentas.';
  end if;
  raise notice 'DM1 1218 · 2: % de los 15 tienen filas de cuenta y no entran.', e;
  if not has_table_privilege('conta_lectura', 'public.catalogo_curso_global'::regclass, 'select') then
    raise exception 'PRUEBA DM1 1218 · 2: conta_lectura no lee la vista de cursos globales.';
  end if;
  if has_table_privilege('conta_lectura', 'public.course'::regclass, 'select') then
    raise exception 'PRUEBA DM1 1218 · 2: conta_lectura lee course entera (tiene cursos de cuentas).';
  end if;
  if exists (select 1 from _t where has_table_privilege('conta_lectura', ('public.' || t)::regclass, 'insert,update,delete,truncate')) then
    raise exception 'PRUEBA DM1 1218 · 2: conta_lectura puede escribir en algún catálogo.';
  end if;
  if has_table_privilege('anon', 'public.catalogo_curso_global'::regclass, 'select')
     or has_table_privilege('authenticated', 'public.catalogo_curso_global'::regclass, 'select') then
    raise exception 'PRUEBA DM1 1218 · 2: la vista la puede leer la app (anon o authenticated).';
  end if;
  raise notice 'DM1 1218 · 2: conta_lectura lee los catálogos que entran y la vista, no course, y no escribe; la app no lee la vista.';
end $$;

-- ── 3 · Como conta_lectura: la vista solo enseña los cursos sin cuenta ───────
set local role conta_lectura;
select count(*) filter (where id = 'd1a00000-0000-4000-8000-0000000000c1') = 1
       and count(*) filter (where id = 'd1a00000-0000-4000-8000-0000000000c2') = 0
       and count(*) filter (where account_id is not null) = 0 as vista_bien
  from public.catalogo_curso_global \gset
reset role;
\if :vista_bien
do $$ begin raise notice 'DM1 1218 · 3: como conta_lectura, la vista enseña el curso global y ninguno de cuenta.'; end $$;
\else
do $$ begin raise exception 'PRUEBA DM1 1218 · 3: la vista no enseña el curso global, o enseña cursos de una cuenta.'; end $$;
\endif

-- ── 4 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261102T1218_dm1_lectura_catalogos_globales.down.sql
do $$ declare n int; begin
  select count(*) into n from _t where has_table_privilege('conta_lectura', ('public.' || t)::regclass, 'select');
  if n <> 0 then raise exception 'PRUEBA DM1 1218 · 4: tras la vuelta atrás, conta_lectura sigue leyendo % de los 15.', n; end if;
  if to_regclass('public.catalogo_curso_global') is not null then raise exception 'PRUEBA DM1 1218 · 4: la vista sigue.'; end if;
  raise notice 'DM1 1218 · 4: la vuelta atrás quita los 15 permisos y la vista.';
end $$;

rollback;
