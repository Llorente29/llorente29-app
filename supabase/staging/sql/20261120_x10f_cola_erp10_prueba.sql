-- supabase/staging/sql/20261120_x10f_cola_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X10f (20261120T2010_x10f_cola_erp10 y 20261120T2011_x10f_lote_desde_el_servidor),
-- que el ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra los objetos: public.conta_erp10_envio (la columna «como»), public.conta_erp10_cola,
-- public.conta_erp10_despertar, public.conta_erp10_atascados y public.conta_erp10_lote_apuntar (cambia la guarda).
--
--   0. La forma: «como» admite nulos; las tres funciones nuevas, con sus permisos (la cola, solo el servidor).
--   1. La cola contesta (sin escribir nada) y lo atascado de una empresa que no está, para.
--   2. conta_erp10_lote_apuntar: con sesión de alguien que no es de la cuenta, para como antes; sin sesión,
--      la guarda deja pasar al servidor (y para después, por la empresa que no existe).
--   3. Las vueltas atrás (los ficheros de verdad, con \i): la de la 2011 restaura la función de antes,
--      la de la 2010 quita lo añadido.
--
-- Sin datos reales (T11): no crea ni lee filas de nadie.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X10f: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 0 · La forma -----------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_erp10_envio'
                  and column_name = 'como' and is_nullable = 'YES') then
    raise exception 'PRUEBA X10f · 0: falta la columna «como» (que admite nulos)';
  end if;
  if to_regprocedure('public.conta_erp10_cola(integer)') is null or to_regprocedure('public.conta_erp10_despertar()') is null
     or to_regprocedure('public.conta_erp10_atascados(uuid)') is null then
    raise exception 'PRUEBA X10f · 0: falta alguna de las tres funciones';
  end if;
  if has_function_privilege('authenticated', 'public.conta_erp10_cola(integer)', 'execute')
     or has_function_privilege('anon', 'public.conta_erp10_cola(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_erp10_despertar()', 'execute') then
    raise exception 'PRUEBA X10f · 0: la cola o el despertador los puede llamar alguien que no es el servidor';
  end if;
  if not has_function_privilege('authenticated', 'public.conta_erp10_atascados(uuid)', 'execute')
     or has_function_privilege('anon', 'public.conta_erp10_lote_apuntar(uuid,date,jsonb,jsonb,text)', 'execute') then
    raise exception 'PRUEBA X10f · 0: los permisos de lo atascado o del lote no son los que tocan';
  end if;
  raise notice 'PRUEBA X10f · 0: «como» admite nulos; la cola y el despertador, solo el servidor; lo atascado, la cuenta; el lote, nunca anon.';
end $$;

-- 1 · La cola contesta, y lo atascado de una empresa que no está, para --------------------------------
do $$
declare v_n integer; v_ok boolean := false;
begin
  select count(*) into v_n from public.conta_erp10_cola(50);
  begin
    perform public.conta_erp10_atascados('00000000-0000-4000-8000-0000000010f0');
  exception when sqlstate 'P0002' then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA X10f · 1: lo atascado de una empresa que no está no para'; end if;
  raise notice 'PRUEBA X10f · 1: la cola contesta (% por salir solos ahora en staging) y lo atascado de una empresa que no está, para.', v_n;
end $$;

-- 2 · La guarda del lote --------------------------------------------------------------------------------
do $$
declare v_def text := pg_get_functiondef('public.conta_erp10_lote_apuntar(uuid,date,jsonb,jsonb,text)'::regprocedure);
begin
  if position('auth.uid() is not null and not public.belongs_to_account' in v_def) = 0
     or position('auth.uid() is not null and not public.current_user_is_admin_of' in v_def) = 0 then
    raise exception 'PRUEBA X10f · 2: la guarda del lote no es la del X10f';
  end if;
end $$;
-- Con sesión de alguien que no es de ninguna cuenta: para, como antes.
do $$
declare v_c uuid; v_ok boolean := false;
begin
  select company_id into v_c from public.conta_erp10_salida_empresa limit 1;
  if v_c is null then select id into v_c from public.company limit 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000010f1', 'role', 'authenticated')::text, true);
  begin
    perform public.conta_erp10_lote_apuntar(v_c, current_date, '[{"nombre":"x","filas":1,"huella":"x"}]'::jsonb, '[]'::jsonb, 'Prueba X10f');
  exception when sqlstate 'P0002' or sqlstate '42501' then v_ok := true;
  end;
  perform set_config('request.jwt.claims', '', true);
  if not v_ok then raise exception 'PRUEBA X10f · 2: alguien que no es de la cuenta ha pasado la guarda del lote'; end if;
end $$;
-- Sin sesión (el servidor): la guarda deja pasar; para después, porque el lote no lleva partidas.
do $$
declare v_c uuid; v_msg text;
begin
  select company_id into v_c from public.conta_erp10_salida_empresa limit 1;
  if v_c is null then select id into v_c from public.company limit 1; end if;
  if v_c is null then
    raise notice 'PRUEBA X10f · 2: esta base no tiene ninguna empresa: no se puede probar el lote sin sesión.';
    return;
  end if;
  begin
    perform public.conta_erp10_lote_apuntar(v_c, current_date, '[{"nombre":"x","filas":1,"huella":"x"}]'::jsonb, '[]'::jsonb, 'Prueba X10f');
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is distinct from 'No hay nada que apuntar: el lote no lleva ninguna partida.' then
    raise exception 'PRUEBA X10f · 2: sin sesión, el lote no llega a mirar sus partidas (%)', v_msg;
  end if;
  raise notice 'PRUEBA X10f · 2: con sesión ajena, el lote para como antes; sin sesión (el servidor), pasa la guarda.';
end $$;

-- 3 · Las vueltas atrás -----------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261120T2011_x10f_lote_desde_el_servidor.down.sql
\i supabase/vuelta-atras/20261120T2010_x10f_cola_erp10.down.sql
do $$ begin
  if position('auth.uid() is not null' in pg_get_functiondef('public.conta_erp10_lote_apuntar(uuid,date,jsonb,jsonb,text)'::regprocedure)) > 0 then
    raise exception 'PRUEBA X10f · 3: la vuelta atrás no ha devuelto la guarda de antes al lote';
  end if;
  if to_regprocedure('public.conta_erp10_cola(integer)') is not null or to_regprocedure('public.conta_erp10_atascados(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_erp10_envio' and column_name = 'como') then
    raise exception 'PRUEBA X10f · 3: la vuelta atrás no ha quitado lo añadido';
  end if;
  raise notice 'PRUEBA X10f · 3: las vueltas atrás devuelven el lote de antes y quitan la cola, el despertador, lo atascado y «como».';
end $$;

rollback;
