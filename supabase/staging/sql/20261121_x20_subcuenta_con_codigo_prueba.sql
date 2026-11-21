-- supabase/staging/sql/20261121_x20_subcuenta_con_codigo_prueba.sql
--
-- SOLO STAGING. Prueba del X20 (20261121T0930_x20_subcuenta_con_codigo), que el ensayo de staging pone delante
-- en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra el objeto: public.company_account_add_codigo (función nueva; company_account_add no se toca).
--
--   0. La forma: la función, para la cuenta (authenticated), nunca para anon.
--   1. Como el administrador de la cuenta de prueba A (o la D, si la A no tiene el plan activado): crea una 572 con el código escrito (cuelga de la 572),
--      con su línea en el historial; la misma otra vez para («Ya existe»); un código que no cuelga de nada para
--      con el número que falta; uno con cifras de menos para.
--   2. Alguien de otra cuenta (la B) no puede crearla en esa empresa.
--   3. La vuelta atrás (el fichero de verdad, con \i) quita la función.
--
-- Sin datos reales (T11): los usuarios y la empresa son los de prueba de staging; el nombre, inventado.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X20: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 0 · La forma ---------------------------------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.company_account_add_codigo(uuid,text,text,text)') is null then raise exception 'PRUEBA X20 · 0: falta la función'; end if;
  if has_function_privilege('anon', 'public.company_account_add_codigo(uuid,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.company_account_add_codigo(uuid,text,text,text)', 'execute') then
    raise exception 'PRUEBA X20 · 0: los permisos no son los que tocan';
  end if;
  raise notice 'PRUEBA X20 · 0: la función, para la cuenta y nunca para anon.';
end $$;

-- La empresa de la cuenta A con el plan activado, y el siguiente código libre de su 572 (como postgres).
do $$
declare v_c uuid; v_d int; v_u text;
begin
  -- La cuenta A si tiene una empresa con el plan activado (en staging, sí); si no, la D (como en las semillas).
  select a.company_id, length(a.code), case c.account_id when 'c01a0000-0000-4000-8000-00000000000a' then 'c01a0000-0000-4000-8000-0000000000a1' else 'c01d0000-0000-4000-8000-0000000000d1' end
    into v_c, v_d, v_u
    from public.company_account a join public.company c on c.id = a.company_id
   where c.account_id in ('c01a0000-0000-4000-8000-00000000000a', 'c01d0000-0000-4000-8000-00000000000d')
   order by c.account_id limit 1;
  perform set_config('x20.empresa', coalesce(v_c::text, ''), true);
  perform set_config('x20.admin', coalesce(v_u, ''), true);
  perform set_config('x20.codigo', case when v_c is null then '' else coalesce(public.company_account_siguiente(v_c, '572', v_d), '') end, true);
  perform set_config('x20.corto', coalesce(left('5720000000000', v_d - 1), ''), true);
  perform set_config('x20.sin_padre', coalesce(lpad('1', v_d, '0'), ''), true);
end $$;

-- 1 · Como el administrador de su cuenta ------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('x20.admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_c uuid := nullif(current_setting('x20.empresa'), '')::uuid; v_code text := current_setting('x20.codigo');
  r jsonb; v_msg text;
begin
  if v_c is null then raise notice 'PRUEBA X20 · 1: ni la cuenta A ni la D tienen una empresa con el plan activado: no se puede probar.'; return; end if;
  r := public.company_account_add_codigo(v_c, v_code, 'Banco inventado X20', 'Prueba X20');
  if r ->> 'code' <> v_code or r ->> 'hoja' <> '572' then raise exception 'PRUEBA X20 · 1: no cuelga de la 572 (%)', r; end if;
  if not exists (select 1 from public.company_account where id = (r ->> 'id')::uuid and template_code = '572' and kind = 'own' and name = 'Banco inventado X20') then
    raise exception 'PRUEBA X20 · 1: la subcuenta no ha quedado como debe';
  end if;
  if not exists (select 1 from public.company_account_log where company_id = v_c and code = v_code and que = 'subcuenta_creada') then
    raise exception 'PRUEBA X20 · 1: falta su línea en el historial del plan';
  end if;
  begin perform public.company_account_add_codigo(v_c, v_code, 'Otra vez', 'Prueba X20'); exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from format('Ya existe la %s: ábrela.', v_code) then raise exception 'PRUEBA X20 · 1: la repetida no para bien (%)', v_msg; end if;
  v_msg := null;
  begin perform public.company_account_add_codigo(v_c, current_setting('x20.sin_padre'), 'Sin padre', 'Prueba X20'); exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ '^La [0-9]+ no está en tu plan: no hay de qué cuenta colgarla\.$' then raise exception 'PRUEBA X20 · 1: la que no cuelga de nada no para bien (%)', v_msg; end if;
  v_msg := null;
  begin perform public.company_account_add_codigo(v_c, current_setting('x20.corto'), 'Corta', 'Prueba X20'); exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ '^El código son [0-9]+ cifras' then raise exception 'PRUEBA X20 · 1: la de cifras de menos no para bien (%)', v_msg; end if;
  raise notice 'PRUEBA X20 · 1: crea la % bajo la 572 con su historial; la repetida, la que no cuelga de nada y la corta paran con su frase.', v_code;
end $$;
reset role;

-- 2 · Alguien de otra cuenta (la B) no puede -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_c uuid := nullif(current_setting('x20.empresa'), '')::uuid; v_ok boolean := false;
begin
  if v_c is null then return; end if;
  begin perform public.company_account_add_codigo(v_c, '57200099', 'De otra cuenta', 'Prueba X20'); exception when sqlstate '42501' then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA X20 · 2: alguien de la cuenta B ha creado una subcuenta en una empresa de otra cuenta'; end if;
  raise notice 'PRUEBA X20 · 2: alguien de otra cuenta, no puede.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 3 · La vuelta atrás ----------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261121T0930_x20_subcuenta_con_codigo.down.sql
do $$ begin
  if to_regprocedure('public.company_account_add_codigo(uuid,text,text,text)') is not null then raise exception 'PRUEBA X20 · 3: la vuelta atrás no ha quitado la función'; end if;
  raise notice 'PRUEBA X20 · 3: la vuelta atrás quita la función.';
end $$;

rollback;
