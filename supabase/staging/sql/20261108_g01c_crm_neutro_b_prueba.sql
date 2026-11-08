-- supabase/staging/sql/20261108_g01c_crm_neutro_b_prueba.sql
--
-- SOLO STAGING. Prueba del G01c · PR B de la clave neutra (20261108T0112).
-- Todo en una transacción con ROLLBACK, con datos inventados (T11): no cambia
-- staging.
--
--   0. Antes: una conexión inventada con su secreto en Vault llamado como hoy
--      en producción («conta_bitrix:<cuenta>»), filas de los tipos y del
--      origen de antes (de antes del corte) y una neutra (de después).
--   1. La tanda: los tipos y el origen, neutros (con su copia); fuera la
--      tabla, los espejos y las funciones de antes (las dos de los espejos,
--      vacías y sin disparador); guardar los clientes sigue guardando;
--      «ya_no_es_cliente_en_crm» entra. Las columnas de antes (de las tablas
--      y de las vistas) siguen: son para después, en su propio PR.
--   2. El secreto se llama «conta_crm:bitrix24:<cuenta>» y la conexión lee la
--      MISMA dirección, sin volver a pegarla (Julio, 08/11).
--   3. La vuelta atrás: todo como antes, con las filas de después del corte
--      neutras, y el secreto con su nombre de antes y la misma dirección.
--
-- sin usuario: todo lo de esta tanda lo hace el servidor (guardar clientes, la conexión) o la propia tanda; ninguna persona lo llama.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01c-B: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _u on commit drop as
select p.account_id as cuenta from public.user_profiles p where p.active and p.role in ('admin', 'manager') order by p.created_at limit 1;
create temp table _antes (firma text primary key, huella text) on commit drop;
create temp table _dato (clave text primary key, valor text) on commit drop;
create temp table _vault on commit drop as select to_regclass('vault.secrets') is not null as hay;

select to_regclass('public.conta_crm_bitrix') is null as ya_esta_la_0112 \gset
-- Si la 0112 ya está (el aplicar de staging la pasa antes que esta prueba),
-- primero su vuelta atrás: así la prueba parte siempre de lo de antes.
\if :ya_esta_la_0112
insert into _antes select firma, huella from public.funcion_respaldo where migracion = '20261108T0112_g01c_crm_neutro_b';
\i supabase/vuelta-atras/20261108T0112_g01c_crm_neutro_b.down.sql
\else
insert into _antes select f, md5(pg_get_functiondef(f::regprocedure)) from unnest(array[
  'public.conta_bitrix_guardar_clientes(uuid,jsonb)', 'public.conta_bitrix_confirmar_mapa(uuid,jsonb)', 'public.conta_bitrix_aplicar_union(uuid)',
  'public.conta_bitrix_guardar_conexion(uuid,text,text,text,text)', 'public.conta_bitrix_secreto(uuid)', 'public.conta_bitrix_guardar_fichas(uuid,jsonb)',
  'public._conta_bitrix_campo_sensible(jsonb)', 'public._conta_crm_a_bitrix()', 'public._conta_crm_desde_bitrix()']) f;
\endif

-- 0 · Antes de la tanda: la conexión, el secreto con el nombre de hoy y las filas de antes y de después del corte.
do $$
declare a uuid := (select cuenta from _u); l_antes uuid; l_despues uuid; v_ref uuid;
begin
  if a is null then raise exception 'PRUEBA G01c-B · 0: staging no tiene ninguna persona administradora o encargada activa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal) values (a, 'bitrix24', 'pruebas', 'portal-de-prueba.bitrix24.es')
  on conflict (account_id, crm) do nothing;
  if (select hay from _vault) then
    perform public.conta_crm_guardar_conexion(a, 'bitrix24', 'pruebas', 'https://portal-de-prueba.bitrix24.es/rest/1/clavedeprueba/', 'portal-de-prueba.bitrix24.es', 'PERSONA PRUEBA');
    select url_ref into v_ref from public.conta_crm where account_id = a and crm = 'bitrix24';
    -- Como está hoy en producción: el secreto se llama «conta_bitrix:<cuenta>».
    perform vault.update_secret(v_ref, null, 'conta_bitrix:' || a::text);
    insert into _dato values ('url', (select md5(url) from public.conta_crm_secreto(a, 'bitrix24'))), ('ref', v_ref::text);
    if (select name from vault.secrets where id = v_ref) <> 'conta_bitrix:' || a::text or (select valor from _dato where clave = 'url') is distinct from md5('https://portal-de-prueba.bitrix24.es/rest/1/clavedeprueba/') then
      raise exception 'PRUEBA G01c-B · 0: cambiar solo el nombre del secreto cambia la dirección.';
    end if;
  end if;
  insert into public.conta_gestoria_lectura (account_id, origen, entorno, por, quien_name, empezada_at) values (a, 'bitrix', 'pruebas', 'persona', 'PRUEBA G01C-B', timestamptz '2026-11-07 10:00+00')
  returning id into l_antes;
  insert into public.conta_gestoria_lectura (account_id, origen, entorno, por, quien_name, empezada_at) values (a, 'crm', 'pruebas', 'persona', 'PRUEBA G01C-B', timestamptz '2026-11-08 01:00+00')
  returning id into l_despues;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, datos)
  select a, l_antes, t, t, 'PRUEBA G01C-B antes', '{}' from unnest(array['bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix']) t;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, datos) values (a, l_despues, 'crm_sin_cobro', 'x', 'PRUEBA G01C-B después', '{}');
  raise notice 'G01c-B · 0: la conexión con el secreto llamado como hoy, y las filas de antes y de después del corte. OK';
end $$;
\i supabase/migrations/20261108T0112_g01c_crm_neutro_b.sql

-- 1 · Lo que deja la tanda.
do $$
declare a uuid := (select cuenta from _u); r jsonb;
begin
  if exists (select 1 from public.conta_gestoria_diferencia where tipo in ('bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix'))
     or exists (select 1 from public.conta_gestoria_lectura where origen = 'bitrix') then
    raise exception 'PRUEBA G01c-B · 1: quedan tipos u origen de antes.';
  end if;
  if (select count(*) from public.conta_gestoria_diferencia where porque = 'PRUEBA G01C-B antes' and tipo in ('crm_sin_cobro', 'nif_repetido_en_crm', 'correo_repetido_en_crm')) <> 3 then
    raise exception 'PRUEBA G01c-B · 1: los tipos de antes no pasan a los neutros.';
  end if;
  if to_regclass('public.conta_crm_bitrix') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname ilike '%bitrix%' and proname not in ('_conta_crm_a_bitrix', '_conta_crm_desde_bitrix')) then
    raise exception 'PRUEBA G01c-B · 1: queda algo de antes (tabla o función con «bitrix»).';
  end if;
  -- Las dos de los espejos se quedan hasta la tanda siguiente: sin disparador y sin nombrar nada de antes.
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and p.proname in ('_conta_crm_a_bitrix', '_conta_crm_desde_bitrix'))
     or exists (select 1 from pg_proc where proname in ('_conta_crm_a_bitrix', '_conta_crm_desde_bitrix') and prosrc ~ 'conta_crm_bitrix') then
    raise exception 'PRUEBA G01c-B · 1: public._conta_crm_a_bitrix o public._conta_crm_desde_bitrix siguen con disparador o nombran conta_crm_bitrix.';
  end if;
  if (select count(*) from public._copia_g01c_crm_neutro_b c join public.conta_gestoria_diferencia d on d.id = c.id where c.tabla = 'conta_gestoria_diferencia' and d.porque = 'PRUEBA G01C-B antes') <> 3 then
    raise exception 'PRUEBA G01c-B · 1: la copia no guarda las tres diferencias de antes.';
  end if;
  r := public.conta_crm_guardar_clientes(a, 'bitrix24', jsonb_build_array(jsonb_build_object('clave', 'ficha:empresa:9951', 'nif', null, 'situacion', 'activo', 'motivo', null,
    'principal', jsonb_build_object('tipoFicha', 'empresa', 'idExterno', '9951', 'nombre', 'CLIENTE PRUEBA G01C-B', 'situacion', 'activo', 'servicios', '[]'::jsonb),
    'fichas', jsonb_build_array(jsonb_build_object('tipoFicha', 'empresa', 'idExterno', '9951', 'nombre', 'CLIENTE PRUEBA G01C-B', 'situacion', 'activo')))));
  if (r->>'nuevos')::int <> 1 or not exists (select 1 from public.conta_consulta_clientes c join public.conta_gestoria_cliente g on g.party_id = c.cliente_id
                                               where g.id_externo = '9951' and c.ficha_en_el_crm = '9951') then
    raise exception 'PRUEBA G01c-B · 1: guardar los clientes ya no guarda, o la vista no lo enseña (%).', r;
  end if;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, tipo, porque_codigo, porque, crm, tipo_ficha, id_externo, datos)
  select a, l.id, 'ya_no_es_cliente_en_crm', 'x', 'PRUEBA G01C-B', 'bitrix24', 'contacto', '9952', '{}' from public.conta_gestoria_lectura l where l.quien_name = 'PRUEBA G01C-B' limit 1;
  raise notice 'G01c-B · 1: tipos y origen neutros, nada de antes, guardar clientes guarda y «ya no es cliente en tu CRM» entra. OK';
end $$;

-- 2 · El secreto, con su nombre nuevo y la misma dirección.
do $$
declare a uuid := (select cuenta from _u);
begin
  if not (select hay from _vault) or not exists (select 1 from _dato where clave = 'ref') then raise notice 'G01c-B · 2: sin Vault en esta base: se prueba en staging.'; return; end if;
  if (select name from vault.secrets where id = (select valor from _dato where clave = 'ref')::uuid) <> 'conta_crm:bitrix24:' || a::text then
    raise exception 'PRUEBA G01c-B · 2: el secreto no se llama como debe.';
  end if;
  if (select md5(url) from public.conta_crm_secreto(a, 'bitrix24')) is distinct from (select valor from _dato where clave = 'url') then
    raise exception 'PRUEBA G01c-B · 2: la conexión ya no lee la misma dirección.';
  end if;
  raise notice 'G01c-B · 2: el secreto se llama «conta_crm:bitrix24:<cuenta>» y la conexión lee la misma dirección, sin volver a pegarla. OK';
end $$;

-- 3 · La vuelta atrás.
\i supabase/vuelta-atras/20261108T0112_g01c_crm_neutro_b.down.sql
do $$
declare f record; a uuid := (select cuenta from _u);
begin
  for f in select * from _antes loop
    if md5(pg_get_functiondef(f.firma::regprocedure)) is distinct from f.huella then raise exception 'PRUEBA G01c-B · 3: % no vuelve a ser la de antes.', f.firma; end if;
  end loop;
  if (select count(*) from _antes) <> 9 then raise exception 'PRUEBA G01c-B · 3: faltan funciones por comparar (%).', (select count(*) from _antes); end if;
  if to_regclass('public._copia_g01c_crm_neutro_b') is not null then
    raise exception 'PRUEBA G01c-B · 3: queda la copia de la tanda.';
  end if;
  if to_regclass('public.conta_crm_bitrix') is null
     or (select count(*) from pg_trigger where not tgisinternal and tgname in ('conta_crm_a_bitrix', 'conta_crm_bitrix_a_crm')) <> 2
     or not exists (select 1 from public.conta_crm_bitrix where account_id = a) then
    raise exception 'PRUEBA G01c-B · 3: conta_crm_bitrix no vuelve con su fila y sus espejos.';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
        and (table_name, column_name) in (('conta_gestoria_ficha', 'bitrix_id'), ('conta_gestoria_cliente', 'bitrix_id'), ('conta_gestoria_cliente', 'forma_pago_bitrix'),
                                          ('conta_gestoria_cliente', 'emisor_segun_bitrix'), ('conta_gestoria_diferencia', 'bitrix_id'),
                                          ('conta_consulta_clientes', 'forma_de_pago_en_bitrix'), ('conta_consulta_diferencias', 'ficha_en_bitrix'))) <> 7
     or not exists (select 1 from public.conta_gestoria_cliente where id_externo = '9951' and bitrix_id = '9951') then
    raise exception 'PRUEBA G01c-B · 3: las columnas de antes no vuelven, o no vuelven rellenas.';
  end if;
  if (select count(*) from public.conta_gestoria_diferencia where porque = 'PRUEBA G01C-B antes' and tipo in ('bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix')) <> 3
     or (select tipo from public.conta_gestoria_diferencia where porque = 'PRUEBA G01C-B después') <> 'crm_sin_cobro'
     or (select origen from public.conta_gestoria_lectura where quien_name = 'PRUEBA G01C-B' and empezada_at < '2026-11-08') <> 'bitrix'
     or (select origen from public.conta_gestoria_lectura where quien_name = 'PRUEBA G01C-B' and empezada_at > '2026-11-08') <> 'crm'
     or exists (select 1 from public.conta_gestoria_diferencia where tipo = 'ya_no_es_cliente_en_crm') then
    raise exception 'PRUEBA G01c-B · 3: los tipos o el origen no vuelven como estaban (antes del corte, los de antes; después, los neutros).';
  end if;
  if (select hay from _vault) and exists (select 1 from _dato where clave = 'ref') then
    if (select name from vault.secrets where id = (select valor from _dato where clave = 'ref')::uuid) <> 'conta_bitrix:' || a::text
       or (select md5(url) from public.conta_bitrix_secreto(a)) is distinct from (select valor from _dato where clave = 'url') then
      raise exception 'PRUEBA G01c-B · 3: el secreto no vuelve a su nombre de antes con la misma dirección.';
    end if;
  end if;
  raise notice 'G01c-B · 3: la vuelta atrás deja todo como estaba tras el PR A, también el secreto. OK';
end $$;

rollback;
