-- supabase/staging/sql/20261121_x25_cuenta_de_cobro_prueba.sql
--
-- SOLO STAGING. Prueba del X25 (20261121T1800_x25_cuenta_de_cobro), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra el objeto que cambia: public.company_account_misma_cuenta() (la función del disparador
-- company_account_link_misma_cuenta de public.company_account_link).
--
-- Como el administrador de la cuenta de prueba A (o la D, si la A no tiene el plan activado), con lo que hace la ficha
-- del cliente (company_account_link_set y company_account_link_unset, el papel «pago» del cliente):
--   1. Un cliente inventado con su 430; una 430 de «plataforma» y una 551 de «socio», inventadas.
--   2. Su «Cuenta de cobro», la 430 de la plataforma: se guarda; y lo que lee una emitida nueva (su enlace «pago») es
--      esa. Luego la 551 del socio: también (cualquier subcuenta). La suya propia, no, con su frase.
--   3. «Quitar»: sin cuenta de cobro, la emitida vuelve a lo de antes (nada en su enlace «pago»).
--   4. La vuelta atrás (el fichero de verdad, con \i): el disparador de antes, que al cliente solo le deja un 57 o un
--      43 (la 551 ya no entra) y vuelve a su huella de hoy.
-- Sin datos reales (T11): la empresa y el usuario son los de prueba de staging; los nombres, inventados.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X25: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 0 · La empresa (A o D, la que tenga el plan) y su administrador (como postgres) ---------------------------------
do $$
declare v_c uuid; v_acc uuid; v_u text; v_p uuid;
begin
  select c.id, c.account_id,
         case c.account_id when 'c01a0000-0000-4000-8000-00000000000a' then 'c01a0000-0000-4000-8000-0000000000a1' else 'c01d0000-0000-4000-8000-0000000000d1' end
    into v_c, v_acc, v_u
    from public.company c
   where c.account_id in ('c01a0000-0000-4000-8000-00000000000a', 'c01d0000-0000-4000-8000-00000000000d')
     and exists (select 1 from public.company_account a where a.company_id = c.id and a.code like '4300%')
   order by c.account_id, c.id limit 1;
  if v_c is null then raise exception 'PRUEBA X25 · 0: ni la cuenta A ni la D tienen una empresa con el plan'; end if;
  insert into public.party (account_id, name, tax_id, source) values (v_acc, 'Cliente Inventado X25', null, 'manual') returning id into v_p;
  insert into public.party_role (account_id, party_id, role) values (v_acc, v_p, 'customer');
  perform set_config('x25.empresa', v_c::text, true);
  perform set_config('x25.admin', v_u, true);
  perform set_config('x25.cliente', v_p::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('x25.admin'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1 · Su 430, la de una «plataforma» y la 551 de un «socio» ------------------------------------------------------
do $$
declare v_c uuid := current_setting('x25.empresa')::uuid; r jsonb;
begin
  r := public.company_account_add(v_c, '4300', 'Clientes · Cliente Inventado X25', null, 'customer', current_setting('x25.cliente'), 'Prueba X25', 'manual');
  perform set_config('x25.suya', r->>'id', true); perform set_config('x25.suya_code', r->>'code', true);
  r := public.company_account_add(v_c, '4300', 'Clientes · Plataforma Inventada X25', null, null, null, 'Prueba X25', 'manual');
  perform set_config('x25.plataforma', r->>'id', true); perform set_config('x25.plataforma_code', r->>'code', true);
  r := public.company_account_add(v_c, '551', 'Socio Inventado X25', null, null, null, 'Prueba X25', 'manual');
  perform set_config('x25.socio', r->>'id', true); perform set_config('x25.socio_code', r->>'code', true);
  raise notice 'PRUEBA X25 · 1: su 430 %, la de la plataforma % y la del socio %.', current_setting('x25.suya_code'), current_setting('x25.plataforma_code'), current_setting('x25.socio_code');
end $$;

-- Lo que lee la emitida nueva: el enlace «pago» del cliente en la empresa (deLaEmpresa → cuentaCobro).
create function pg_temp.x25_de_su_ficha() returns text language sql stable as $f$
  select a.code from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = current_setting('x25.empresa')::uuid and l.entity = 'customer' and l.entity_id = current_setting('x25.cliente')
     and l.role = 'pago'
$f$;

-- 2 · Su cuenta de cobro: la 430 de la plataforma, la 551 del socio; la suya, no ------------------------------------
do $$
declare v_c uuid := current_setting('x25.empresa')::uuid; v_msg text;
begin
  perform public.company_account_link_set(v_c, 'customer', current_setting('x25.cliente'), 'pago', current_setting('x25.plataforma')::uuid, 'Prueba X25', 'manual');
  if pg_temp.x25_de_su_ficha() is distinct from current_setting('x25.plataforma_code') then
    raise exception 'PRUEBA X25 · 2: la emitida no trae la 430 de la plataforma (trae %)', pg_temp.x25_de_su_ficha();
  end if;
  perform public.company_account_link_set(v_c, 'customer', current_setting('x25.cliente'), 'pago', current_setting('x25.socio')::uuid, 'Prueba X25', 'manual');
  if pg_temp.x25_de_su_ficha() is distinct from current_setting('x25.socio_code') then
    raise exception 'PRUEBA X25 · 2: la 551 del socio no ha quedado como su cuenta de cobro (trae %)', pg_temp.x25_de_su_ficha();
  end if;
  begin
    perform public.company_account_link_set(v_c, 'customer', current_setting('x25.cliente'), 'pago', current_setting('x25.suya')::uuid, 'Prueba X25', 'manual');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from 'Esa es la cuenta del propio cliente: no se le cobra con ella.' then
    raise exception 'PRUEBA X25 · 2: su propia 430 como cuenta de cobro no para bien (%)', v_msg;
  end if;
  raise notice 'PRUEBA X25 · 2: su cuenta de cobro, la % (plataforma) y luego la % (socio); la emitida nueva la trae. La suya: «%»',
    current_setting('x25.plataforma_code'), current_setting('x25.socio_code'), v_msg;
end $$;

-- 3 · «Quitar»: la emitida vuelve a lo de antes -------------------------------------------------------------------
do $$
begin
  perform public.company_account_link_unset(current_setting('x25.empresa')::uuid, 'customer', current_setting('x25.cliente'), 'pago', 'Prueba X25');
  if pg_temp.x25_de_su_ficha() is not null then raise exception 'PRUEBA X25 · 3: «Quitar» no la quita (%)', pg_temp.x25_de_su_ficha(); end if;
  raise notice 'PRUEBA X25 · 3: quitada, la emitida vuelve a lo de antes (sin cuenta de cobro en su ficha).';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 4 · La vuelta atrás ----------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261121T1800_x25_cuenta_de_cobro.down.sql
do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.company_account_misma_cuenta()'::regprocedure) <> 'a1e037b1945cefa738868a9b39ab60c5' then
    raise exception 'PRUEBA X25 · 4: la vuelta atrás no devuelve el disparador a su huella de hoy';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('x25.admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_msg text;
begin
  begin
    perform public.company_account_link_set(current_setting('x25.empresa')::uuid, 'customer', current_setting('x25.cliente'), 'pago', current_setting('x25.socio')::uuid, 'Prueba X25', 'manual');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ '^Se le paga desde un banco o caja \(57\)' then raise exception 'PRUEBA X25 · 4: sin la 1800, la 551 debería no entrar (%)', v_msg; end if;
  raise notice 'PRUEBA X25 · 4: la vuelta atrás deja el disparador de antes (huella de hoy): la 551 ya no entra («%»).', v_msg;
end $$;
reset role;

rollback;
