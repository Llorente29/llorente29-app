-- supabase/staging/sql/20261127_k14f_codigos_cegid_prueba.sql
--
-- SOLO STAGING. Prueba del K14f (20261127T0823): atar fichas a su cliente de Cegid. Todo en una transacción con
-- ROLLBACK. Usa public._conta_cegid_atar.
--
-- En staging no hay QBO Integrity: la migración no toca nada (1). El camino que sigue en producción se ensaya en la
-- gestoría del núcleo (semilla K02), todo inventado (T11):
--   2. Una ficha con su fila de cobro vacía y otra sin fila: _conta_cegid_atar pone su código y lo apunta en
--      conta_cegid_atado. Un código que ya es de otra ficha no se ata.
--   3. La vuelta atrás, en su forma: fichas sin código y lo apuntado fuera.
--
-- sin usuario: lo hace la migración, como dueño, con la función interna (_conta_cegid_atar, sin permiso para usuarios).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K14f: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_cegid_atar(uuid,uuid,int,text,text)') is null then
    raise exception 'PRUEBA K14f · 0: falta _conta_cegid_atar (Q10d).';
  end if;
end $$;
set local statement_timeout = '60s';

-- 1 · La migración, otra vez: en staging no hace nada.
\i supabase/migrations/20261127T0823_k14f_codigos_cegid.sql

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2';
  p1 constant uuid := 'c0f14f00-0000-4000-8000-0000000000b1'; p2 constant uuid := 'c0f14f00-0000-4000-8000-0000000000b2';
  p3 constant uuid := 'c0f14f00-0000-4000-8000-0000000000b3'; n int;
begin
  insert into public.party (id, account_id, name) values (p1, a, 'Cliente de Prueba K14f Uno'), (p2, a, 'Cliente de Prueba K14f Dos'), (p3, a, 'Cliente de Prueba K14f Tres');
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente) values (emp, p1, a, null), (emp, p3, a, 99801);
  perform public._conta_cegid_atar(emp, p1, 99811, 'a_mano', 'K14f · códigos de Cegid del 27/11');
  perform public._conta_cegid_atar(emp, p2, 99812, 'a_mano', 'K14f · códigos de Cegid del 27/11');
  select count(*) into n from public.conta_cobro_cliente where company_id = emp and codigo_cliente in (99811, 99812) and party_id in (p1, p2);
  if n <> 2 then raise exception 'PRUEBA K14f · 2: las dos fichas tenían que llevar su código, no %.', n; end if;
  select count(*) into n from public.conta_cegid_atado where company_id = emp and quien = 'K14f · códigos de Cegid del 27/11';
  if n <> 2 then raise exception 'PRUEBA K14f · 2: lo atado tenía que quedar apuntado dos veces, no %.', n; end if;
  begin
    perform public._conta_cegid_atar(emp, p2, 99801, 'a_mano', 'prueba');
    raise exception 'PRUEBA K14f · 2: un código de otra ficha no se tenía que atar.';
  exception when unique_violation then null; end;
  raise notice 'PRUEBA K14f · 2: dos fichas atadas (una sin fila); un código ajeno, no.';
  -- 3 · La vuelta atrás, en su forma.
  update public.conta_cobro_cliente set codigo_cliente = null
   where company_id = emp and party_id in (select party_id from public.conta_cegid_atado where company_id = emp and quien = 'K14f · códigos de Cegid del 27/11');
  delete from public.conta_cegid_atado where company_id = emp and quien = 'K14f · códigos de Cegid del 27/11';
  select count(*) into n from public.conta_cobro_cliente where company_id = emp and codigo_cliente in (99811, 99812);
  if n <> 0 then raise exception 'PRUEBA K14f · 3: la vuelta atrás tenía que dejar las fichas sin código.'; end if;
  raise notice 'PRUEBA K14f · 3: vuelta atrás: fichas sin código.';
end $$;
\i supabase/vuelta-atras/20261127T0823_k14f_codigos_cegid.down.sql

rollback;
