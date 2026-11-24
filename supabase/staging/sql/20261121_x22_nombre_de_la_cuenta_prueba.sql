-- supabase/staging/sql/20261121_x22_nombre_de_la_cuenta_prueba.sql
--
-- SOLO STAGING. Prueba del X22 (20261121T1600_x22_nombre_de_la_cuenta y 20261121T1610_x22_reglas_con_nombre), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra los objetos que cambia la 1600:
--   public.bank_saldos_cuentas(uuid,date,text[])
--   public.conta_banco_a_mano(uuid,date,text,text,numeric,text)
--   public.conta_impuesto_retenciones_diario(uuid,integer,text)
--   public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)
--   public.conta_saldos_terceros(uuid,date)
--   public.conta_tpv_dia_ejemplo(uuid,jsonb,uuid)
--   public.conta_tpv_factura_de(uuid,date)
--   public.conta_tpv_factura_guardar(uuid,text,text)
--
-- Regla 31: el antes y el después con la MISMA consulta y la MISMA cuenta. «Ahora» se mide con la 1600 puesta; «antes»,
-- después de su vuelta atrás de verdad (con \i), que devuelve las funciones a como estaban.
--   0. La empresa de la cuenta A (o la D) con su 70000000 y una 430; a las dos se les deja una explicación distinta del
--      nombre (la 70000000 trae la suya, «Lo que vendes…»). Un banco de caja con su 572, para apuntar a mano.
--   1. Cinco, llamadas de verdad como su administrador: la factura del día al guardarla (conta_tpv_factura_guardar) y al
--      leerla (conta_tpv_factura_de); el banco a mano (su concepto, sin escribir uno, es la cuenta); la lectura del banco
--      (bank_saldos_cuentas) y las cifras (conta_saldos_terceros) sobre lo apuntado. Ahora: el nombre del plan.
--   2. Las otras tres (retenciones, pagar con cuenta, día de ejemplo) necesitan una retención, una recibida o un día del
--      TPV: se mide su texto, ahora sin «coalesce(…plain_name, …name)» como nombre.
--   3. La vuelta atrás de la 1600: las mismas cinco llamadas dan la explicación, y las ocho vuelven a la huella de hoy.
--   4. La 1610: una regla escrita como la 0210 («→ <explicación> · <código>») pasa al nombre, con su registro; su vuelta
--      atrás la devuelve y quita el registro.
--
-- Sin datos reales (T11): los usuarios y la empresa son los de prueba de staging; las explicaciones, inventadas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X22: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 0 · La empresa, sus dos cuentas y un banco de caja (como postgres) ----------------------------------------------------
do $$
declare v_c uuid; v_acc uuid; v_u text; v_700 public.company_account; v_430 public.company_account; v_572 uuid; v_t uuid;
begin
  select c.id, c.account_id,
         case c.account_id when 'c01a0000-0000-4000-8000-00000000000a' then 'c01a0000-0000-4000-8000-0000000000a1' else 'c01d0000-0000-4000-8000-0000000000d1' end
    into v_c, v_acc, v_u
    from public.company c
   where c.account_id in ('c01a0000-0000-4000-8000-00000000000a', 'c01d0000-0000-4000-8000-00000000000d')
     and exists (select 1 from public.company_account a where a.company_id = c.id and a.code = '70000000')
     and exists (select 1 from public.company_account a where a.company_id = c.id and a.code like '430%' and length(a.code) = 8)
     and exists (select 1 from public.company_account a where a.company_id = c.id and a.code like '572%' and length(a.code) = 8)
   order by c.account_id, c.id limit 1;
  if v_c is null then raise exception 'PRUEBA X22 · 0: ni la cuenta A ni la D tienen una empresa con la 70000000, una 430 y una 572'; end if;
  update public.company_account set plain_name = coalesce(nullif(btrim(plain_name), ''), 'Explicación inventada X22 de la 700')
   where company_id = v_c and code = '70000000' returning * into v_700;
  update public.company_account set plain_name = 'Explicación inventada X22 de la 430'
   where id = (select id from public.company_account where company_id = v_c and code like '430%' and length(code) = 8 order by code limit 1)
  returning * into v_430;
  select id into v_572 from public.company_account where company_id = v_c and code like '572%' and length(code) = 8 order by code limit 1;
  -- Para apuntar a mano hace falta un ejercicio abierto que tenga el día de hoy; si la empresa no lo tiene, uno de prueba.
  if not exists (select 1 from public.fiscal_year where company_id = v_c and current_date between starts_on and ends_on) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, v_c, to_char(current_date, 'YYYY'), date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date);
  end if;
  insert into public.treasury_account (account_id, company_id, kind, name) values (v_acc, v_c, 'cash', 'Caja de la prueba X22') returning id into v_t;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_c, v_572, 'bank_account', v_t::text, 'principal', 'manual');
  perform set_config('x22.empresa', v_c::text, true);
  perform set_config('x22.admin', v_u, true);
  perform set_config('x22.banco', v_t::text, true);
  perform set_config('x22.c700', v_700.code, true);
  perform set_config('x22.n700', v_700.name, true);
  perform set_config('x22.e700', v_700.plain_name, true);
  perform set_config('x22.c430', v_430.code, true);
  perform set_config('x22.n430', v_430.name, true);
  perform set_config('x22.e430', v_430.plain_name, true);
  raise notice 'PRUEBA X22 · 0: la % (« % », explicación « % ») y la % (« % », explicación « % »).',
    v_700.code, v_700.name, v_700.plain_name, v_430.code, v_430.name, v_430.plain_name;
end $$;

-- La misma vara para «ahora» y para «antes»: cinco llamadas de verdad, como el administrador de la cuenta.
create function pg_temp.x22_medir(p_fase text) returns void language plpgsql as $f$
declare
  v_c uuid := current_setting('x22.empresa')::uuid; r jsonb; v text;
begin
  r := public.conta_tpv_factura_guardar(v_c, current_setting('x22.c700'), 'Prueba X22');
  perform set_config('x22.' || p_fase || '.factura_guardar', r ->> 'nombre', true);
  r := public.conta_tpv_factura_de(v_c, current_date);
  perform set_config('x22.' || p_fase || '.factura_de', r -> 'factura' ->> 'nombre', true);
  r := public.conta_banco_a_mano(current_setting('x22.banco')::uuid, current_date, current_setting('x22.c700'), null, 12.34, 'Prueba X22');
  select l.concept into v from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = (r ->> 'asiento_id')::uuid and a.code = current_setting('x22.c700');
  perform set_config('x22.' || p_fase || '.banco_a_mano', v, true);
  perform public.conta_banco_a_mano(current_setting('x22.banco')::uuid, current_date, current_setting('x22.c430'), 'Prueba X22', 5.67, 'Prueba X22');
  select b.nombre into v from public.bank_saldos_cuentas(v_c, current_date, array['700']) b where b.cuenta = current_setting('x22.c700');
  perform set_config('x22.' || p_fase || '.bank_saldos_cuentas', v, true);
  select s.nombre into v from public.conta_saldos_terceros(v_c, current_date) s where s.cuenta = current_setting('x22.c430');
  perform set_config('x22.' || p_fase || '.saldos_terceros', v, true);
end $f$;

-- La huella del texto de las ocho, para «ahora» y para «antes».
create function pg_temp.x22_huellas(p_fase text) returns void language plpgsql as $f$
declare f record;
begin
  for f in select p.proname firma, md5(p.prosrc) huella,
                  p.prosrc ~* 'coalesce\(\s*[a-z_0-9]+\.plain_name\s*,\s*[a-z_0-9]+\.name\s*\)' con_explicacion
             from pg_proc p
            where p.oid in ('public.bank_saldos_cuentas(uuid,date,text[])'::regprocedure, 'public.conta_banco_a_mano(uuid,date,text,text,numeric,text)'::regprocedure,
                            'public.conta_impuesto_retenciones_diario(uuid,integer,text)'::regprocedure, 'public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)'::regprocedure,
                            'public.conta_saldos_terceros(uuid,date)'::regprocedure, 'public.conta_tpv_dia_ejemplo(uuid,jsonb,uuid)'::regprocedure,
                            'public.conta_tpv_factura_de(uuid,date)'::regprocedure, 'public.conta_tpv_factura_guardar(uuid,text,text)'::regprocedure) loop
    perform set_config('x22.' || p_fase || '.huella.' || f.firma, f.huella, true);
    perform set_config('x22.' || p_fase || '.explica.' || f.firma, f.con_explicacion::text, true);
  end loop;
end $f$;

-- 1 · Ahora, con la 1600 puesta ---------------------------------------------------------------------------------------
select pg_temp.x22_huellas('ahora');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('x22.admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.x22_medir('ahora');
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare f text; v text;
begin
  foreach f in array array['factura_guardar', 'factura_de', 'banco_a_mano', 'bank_saldos_cuentas'] loop
    v := current_setting('x22.ahora.' || f, true);
    if v is distinct from current_setting('x22.n700') then raise exception 'PRUEBA X22 · 1: % da « % », no el nombre del plan « % »', f, v, current_setting('x22.n700'); end if;
  end loop;
  v := current_setting('x22.ahora.saldos_terceros', true);
  if v is distinct from current_setting('x22.n430') then raise exception 'PRUEBA X22 · 1: conta_saldos_terceros da « % », no « % »', v, current_setting('x22.n430'); end if;
  raise notice 'PRUEBA X22 · 1: las cinco llamadas dan el nombre del plan (« % · % », « % · % »).',
    current_setting('x22.c700'), current_setting('x22.n700'), current_setting('x22.c430'), current_setting('x22.n430');
end $$;

-- 2 · Las otras tres, por su texto (y las ocho, de paso) -------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['bank_saldos_cuentas(uuid,date,text[])', 'conta_banco_a_mano(uuid,date,text,text,numeric,text)',
                           'conta_impuesto_retenciones_diario(uuid,integer,text)', 'conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)',
                           'conta_tpv_dia_ejemplo(uuid,jsonb,uuid)', 'conta_tpv_factura_de(uuid,date)', 'conta_tpv_factura_guardar(uuid,text,text)'] loop
    if current_setting('x22.ahora.explica.' || split_part(f, '(', 1), true) is distinct from 'false' then
      raise exception 'PRUEBA X22 · 2: % sigue dando la explicación como nombre', f;
    end if;
  end loop;
  -- La de las cifras la guarda a propósito en un solo sitio: para saber si una cuenta es «por localizar».
  if (select count(*) from regexp_matches((select prosrc from pg_proc where oid = 'public.conta_saldos_terceros(uuid,date)'::regprocedure),
                                          'coalesce\(\s*ca\.plain_name\s*,\s*ca\.name\s*\)', 'gi')) <> 1 then
    raise exception 'PRUEBA X22 · 2: conta_saldos_terceros debería mirar la explicación solo para «por localizar»';
  end if;
  raise notice 'PRUEBA X22 · 2: ninguna de las ocho da la explicación como nombre (la de las cifras la mira solo para «por localizar»).';
end $$;

-- 3 · La vuelta atrás de la 1600, y la misma vara ----------------------------------------------------------------------
\i supabase/vuelta-atras/20261121T1600_x22_nombre_de_la_cuenta.down.sql
select pg_temp.x22_huellas('antes');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('x22.admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.x22_medir('antes');
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare f text; v text; r record; n int := 0;
begin
  foreach f in array array['factura_guardar', 'factura_de', 'banco_a_mano', 'bank_saldos_cuentas'] loop
    v := current_setting('x22.antes.' || f, true);
    if v is distinct from current_setting('x22.e700') then raise exception 'PRUEBA X22 · 3: antes, % daba « % » y no la explicación « % »', f, v, current_setting('x22.e700'); end if;
    raise notice 'PRUEBA X22 · %: antes « % » · ahora « % »', f, v, current_setting('x22.ahora.' || f);
  end loop;
  v := current_setting('x22.antes.saldos_terceros', true);
  if v is distinct from current_setting('x22.e430') then raise exception 'PRUEBA X22 · 3: antes, conta_saldos_terceros daba « % » y no « % »', v, current_setting('x22.e430'); end if;
  raise notice 'PRUEBA X22 · saldos_terceros: antes « % » · ahora « % »', v, current_setting('x22.ahora.saldos_terceros');
  -- Las ocho vuelven a la huella con la que la 1600 las encontró (la de su guarda).
  for r in select * from (values
      ('bank_saldos_cuentas(uuid,date,text[])', 'bbed3c914944a06024830b4d1763ea06'),
      ('conta_banco_a_mano(uuid,date,text,text,numeric,text)', 'd3f920d897bd9e6e337d0970dbdfb9b3'),
      ('conta_impuesto_retenciones_diario(uuid,integer,text)', '5e0734d5dfffa15752173ad32753cc0d'),
      ('conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)', '6d94ed17d431258186a60dc358e0c921'),
      ('conta_saldos_terceros(uuid,date)', '004163e9d95d0ad5ade86b2899833504'),
      ('conta_tpv_dia_ejemplo(uuid,jsonb,uuid)', '1dbb8fa8ea073a32a8c64ff66760ebc9'),
      ('conta_tpv_factura_de(uuid,date)', 'e8b999171a6ef123efe488fb3268b469'),
      ('conta_tpv_factura_guardar(uuid,text,text)', 'dfb1d86fd898a386c7c6096d8d97a637')) x(firma, huella) loop
    if current_setting('x22.antes.huella.' || split_part(r.firma, '(', 1), true) is distinct from r.huella then
      raise exception 'PRUEBA X22 · 3: la vuelta atrás no devuelve % a su huella de hoy', r.firma;
    end if;
    if current_setting('x22.antes.huella.' || split_part(r.firma, '(', 1)) = current_setting('x22.ahora.huella.' || split_part(r.firma, '(', 1)) then
      raise exception 'PRUEBA X22 · 3: % no había cambiado con la 1600', r.firma;
    end if;
    n := n + 1;
  end loop;
  raise notice 'PRUEBA X22 · 3: la vuelta atrás devuelve las % a su huella de hoy, y con ellas la explicación.', n;
end $$;

-- 4 · La 1610: una regla escrita como la 0210 ---------------------------------------------------------------------------
do $$
declare v_c uuid := current_setting('x22.empresa')::uuid; v_id uuid;
begin
  insert into public.bank_rule (account_id, company_id, words, condition, target, origin, status, created_by_name)
  select c.account_id, c.id, format('Cuando el concepto tenga «PRUEBA X22» → %s · %s', current_setting('x22.e700'), current_setting('x22.c700')),
         jsonb_build_object('contiene', 'PRUEBA X22'), jsonb_build_object('cuenta', current_setting('x22.c700')), 'folvy', 'activa', 'Prueba X22'
    from public.company c where c.id = v_c
  returning id into v_id;
  perform set_config('x22.regla', v_id::text, true);
end $$;
\i supabase/migrations/20261121T1610_x22_reglas_con_nombre.sql
do $$
declare v text;
begin
  select words into v from public.bank_rule where id = current_setting('x22.regla')::uuid;
  if v is distinct from format('Cuando el concepto tenga «PRUEBA X22» → %s · %s', current_setting('x22.n700'), current_setting('x22.c700')) then
    raise exception 'PRUEBA X22 · 4: la 1610 no deja el nombre en la regla (« % »)', v;
  end if;
  if not exists (select 1 from public.bank_rule_log where rule_id = current_setting('x22.regla')::uuid and action = 'cambiada' and created_by_name = 'Tanda X22 · 1610') then
    raise exception 'PRUEBA X22 · 4: falta el registro de la regla cambiada';
  end if;
  raise notice 'PRUEBA X22 · 4: la regla dice « % », con su registro.', v;
end $$;
\i supabase/vuelta-atras/20261121T1610_x22_reglas_con_nombre.down.sql
do $$
declare v text;
begin
  select words into v from public.bank_rule where id = current_setting('x22.regla')::uuid;
  if v is distinct from format('Cuando el concepto tenga «PRUEBA X22» → %s · %s', current_setting('x22.e700'), current_setting('x22.c700')) then
    raise exception 'PRUEBA X22 · 4: la vuelta atrás de la 1610 no devuelve la regla (« % »)', v;
  end if;
  if exists (select 1 from public.bank_rule_log where rule_id = current_setting('x22.regla')::uuid and created_by_name = 'Tanda X22 · 1610') then
    raise exception 'PRUEBA X22 · 4: la vuelta atrás de la 1610 no quita su registro';
  end if;
  raise notice 'PRUEBA X22 · 4: la vuelta atrás de la 1610 devuelve la regla y quita su registro.';
end $$;

rollback;
