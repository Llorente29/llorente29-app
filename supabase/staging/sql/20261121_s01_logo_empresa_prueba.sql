-- supabase/staging/sql/20261121_s01_logo_empresa_prueba.sql
--
-- SOLO STAGING. La 0120 del S01 (el logo de cada empresa), por sus caminos:
--   1. Si staging aún no la tiene, se aplica aquí, dentro de la transacción.
--   2. La columna, el bucket (privado, 1 MB, png/jpeg/webp) y sus cuatro políticas.
--   3. COMO USUARIO de A (administrador de A): sube un logo en la carpeta de A,
--      lo lee, y apunta su ruta en su empresa. No puede subir en la carpeta de B
--      y no ve el logo de B (que se sube antes, sin rol).
--   4. La vuelta atrás, de verdad: sin políticas y sin columna.
--
-- Cambia: company.logo_path (columna nueva), el bucket company-logos y sus
-- políticas en storage.objects. Todo acaba en ROLLBACK: staging no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 0120: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · La 0120, si falta.
select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'logo_path') as falta_0120 \gset
\if :falta_0120
\echo '>>> Staging aún no tiene la 0120 del S01: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261121T0120_s01_logo_empresa.sql
\endif

-- 2 · Lo que añade.
do $$
declare b storage.buckets; n int;
begin
  select * into b from storage.buckets where id = 'company-logos';
  if b.id is null or b.public or b.file_size_limit <> 1048576 or b.allowed_mime_types <> array['image/png', 'image/jpeg', 'image/webp'] then
    raise exception 'PRUEBA S01 0120: el bucket company-logos no es el pedido (privado, 1 MB, png/jpeg/webp): %', row_to_json(b);
  end if;
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'company_logos_%';
  if n <> 4 then raise exception 'PRUEBA S01 0120: se esperaban 4 políticas del bucket y hay %.', n; end if;
  raise notice 'S01 0120 2: columna, bucket privado de 1 MB y sus 4 políticas.';
end $$;

-- El logo de B, sin rol (como lo subiría B).
insert into storage.objects (bucket_id, name, owner)
values ('company-logos', 'c01b0000-0000-4000-8000-00000000000b/x/b.png', null);

-- 3 · Como usuario de A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare n int; e uuid;
begin
  select id into e from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1;
  insert into storage.objects (bucket_id, name, owner)
  values ('company-logos', 'c01a0000-0000-4000-8000-00000000000a/' || e || '/a.png', 'c01a0000-0000-4000-8000-0000000000a1');
  update public.company set logo_path = 'c01a0000-0000-4000-8000-00000000000a/' || e || '/a.png' where id = e;
  -- A ve el suyo y no el de B (si staging tiene más logos de A, también los ve: se cuentan solo estos dos).
  select count(*) into n from storage.objects where bucket_id = 'company-logos' and name like 'c01a0000-0000-4000-8000-00000000000a/%/a.png';
  if n <> 1 then raise exception 'PRUEBA S01 0120: A no ve el logo que acaba de subir (% filas).', n; end if;
  if exists (select 1 from storage.objects where bucket_id = 'company-logos' and name = 'c01b0000-0000-4000-8000-00000000000b/x/b.png') then
    raise exception 'PRUEBA S01 0120: A ve el logo de B.';
  end if;
  if (select logo_path from public.company where id = e) is null then raise exception 'PRUEBA S01 0120: A no ha podido apuntar el logo en su empresa.'; end if;
  raise notice 'S01 0120 3a: A sube su logo, lo ve, no ve el de B y lo apunta en su empresa.';
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('company-logos', 'c01b0000-0000-4000-8000-00000000000b/x/intruso.png', 'c01a0000-0000-4000-8000-0000000000a1');
    raise exception 'PRUEBA S01 0120: A ha podido subir un logo en la carpeta de B.';
  exception when insufficient_privilege then raise notice 'S01 0120 3b: A no sube en la carpeta de B (42501).';
  end;
end $$;
reset role;

-- 4 · La vuelta atrás, de verdad.
-- La guarda: con un logo puesto, la vuelta atrás PARA sin tocar nada (savepoint y
-- ON_ERROR_STOP 0 para ver que falla; después, como si no hubiera pasado).
do $$ begin
  if not (exists (select 1 from public.company where logo_path is not null)) then raise exception 'PRUEBA S01 0120 4: para probar la guarda hacía falta un logo puesto.'; end if;
end $$;
savepoint guarda;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261121T0120_s01_logo_empresa.down.sql
\set guarda_fallo :ERROR
\set ON_ERROR_STOP 1
rollback to savepoint guarda;
\if :guarda_fallo
\echo 'S01 0120 4 guarda: con un logo puesto, la vuelta atrás para y no toca nada.'
\else
do $$ begin raise exception 'PRUEBA S01 0120 4: con un logo puesto, la vuelta atrás no ha parado.'; end $$;
\endif
-- Sin eso (como justo después de la tanda), se deshace entera.
update public.company set logo_path = null where logo_path is not null;
\i supabase/vuelta-atras/20261121T0120_s01_logo_empresa.down.sql
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'company_logos_%')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'logo_path') then
    raise exception 'PRUEBA S01 0120: la vuelta atrás no ha quitado las políticas o la columna.';
  end if;
  raise notice 'S01 0120 4: vuelta atrás, sin políticas y sin columna (el bucket, con logos, se queda y lo dice).';
end $$;

rollback;
