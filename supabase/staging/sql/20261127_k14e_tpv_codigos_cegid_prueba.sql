-- supabase/staging/sql/20261127_k14e_tpv_codigos_cegid_prueba.sql
--
-- SOLO STAGING. Prueba del K14e (20261127T0119): atar las fichas de los pagos con tarjeta a su cliente de Cegid. Todo en
-- una transacción con ROLLBACK. Usa public._conta_cegid_atar y public.conta_banco_cobro_tarjeta.
--
-- En staging no hay QBO Integrity: la migración no toca nada (1). El camino que sigue en producción se ensaya en la
-- gestoría del núcleo (semilla K02), todo inventado (T11):
--   2. Una ficha con su fila de cobro vacía y otra sin fila: _conta_cegid_atar pone su código (y lo apunta en
--      conta_cegid_atado), y el pago de cada una, su cegid_codigo. Un código que ya es de otra ficha no se ata.
--   3. La vuelta atrás, la misma de producción en su forma: fichas sin código, lo apuntado fuera y pagos sin código.
--
-- sin usuario: lo hace la migración, como dueño, con la función interna (_conta_cegid_atar, sin permiso para usuarios).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K14e: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_cegid_atar(uuid,uuid,int,text,text)') is null or to_regclass('public.conta_banco_cobro_tarjeta') is null then
    raise exception 'PRUEBA K14e · 0: faltan _conta_cegid_atar (Q10d) o conta_banco_cobro_tarjeta (K14c).';
  end if;
end $$;
set local statement_timeout = '60s';

-- 1 · La migración, otra vez: en staging no hace nada.
\i supabase/migrations/20261127T0119_k14e_tpv_codigos_cegid.sql

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2';
  p1 constant uuid := 'c0f14e00-0000-4000-8000-0000000000b1'; p2 constant uuid := 'c0f14e00-0000-4000-8000-0000000000b2';
  p3 constant uuid := 'c0f14e00-0000-4000-8000-0000000000b3'; n int; v jsonb;
begin
  insert into public.party (id, account_id, name) values (p1, a, 'Cliente de Prueba K14e Uno'), (p2, a, 'Cliente de Prueba K14e Dos'), (p3, a, 'Cliente de Prueba K14e Tres');
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente) values (emp, p1, a, null), (emp, p3, a, 99901);
  insert into public.conta_banco_cobro_tarjeta (company_id, pagado_en, importe, account_id, crm_id, etapa, party_id, estado, porque) values
    (emp, timestamptz '2026-11-19 13:00:00+01', 48.40, a, '90201', 'enlace_pago', p1, 'casado', 'prueba'),
    (emp, timestamptz '2026-11-24 18:00:00+01', 48.40, a, '90202', 'enlace_pago', p2, 'casado', 'prueba');
  -- 2 · Atar: la de la fila vacía y la que no tenía fila.
  perform public._conta_cegid_atar(emp, p1, 99911, 'a_mano', 'K14e · alta en Cegid del 27/11');
  perform public._conta_cegid_atar(emp, p2, 99912, 'a_mano', 'K14e · alta en Cegid del 27/11');
  update public.conta_banco_cobro_tarjeta t set cegid_codigo = c.codigo_cliente from public.conta_cobro_cliente c
   where t.company_id = emp and c.company_id = emp and c.party_id = t.party_id and t.crm_id in ('90201', '90202');
  select count(*) into n from public.conta_banco_cobro_tarjeta t join public.conta_cobro_cliente c on c.company_id = emp and c.party_id = t.party_id
   where t.company_id = emp and t.cegid_codigo = c.codigo_cliente and c.codigo_cliente in (99911, 99912);
  if n <> 2 then raise exception 'PRUEBA K14e · 2: los dos pagos tenían que llevar el código de su ficha, no %.', n; end if;
  select count(*) into n from public.conta_cegid_atado where company_id = emp and quien = 'K14e · alta en Cegid del 27/11';
  if n <> 2 then raise exception 'PRUEBA K14e · 2: lo atado tenía que quedar apuntado dos veces, no %.', n; end if;
  begin
    perform public._conta_cegid_atar(emp, p2, 99901, 'a_mano', 'prueba');
    raise exception 'PRUEBA K14e · 2: un código de otra ficha no se tenía que atar.';
  exception when unique_violation then null; end;
  raise notice 'PRUEBA K14e · 2: dos fichas atadas (una sin fila), sus pagos con su código; un código ajeno, no.';
end $$;

-- 3 · La vuelta atrás, en su forma, sobre las de la prueba.
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; n int;
begin
  update public.conta_cobro_cliente set codigo_cliente = null
   where company_id = emp and party_id in (select party_id from public.conta_cegid_atado where company_id = emp and quien = 'K14e · alta en Cegid del 27/11');
  delete from public.conta_cegid_atado where company_id = emp and quien = 'K14e · alta en Cegid del 27/11';
  update public.conta_banco_cobro_tarjeta set cegid_codigo = null where company_id = emp and crm_id in ('90201', '90202');
  select count(*) into n from public.conta_cobro_cliente where company_id = emp and codigo_cliente in (99911, 99912);
  if n <> 0 then raise exception 'PRUEBA K14e · 3: la vuelta atrás tenía que dejar las fichas sin código.'; end if;
  raise notice 'PRUEBA K14e · 3: vuelta atrás: fichas y pagos sin código.';
end $$;
\i supabase/vuelta-atras/20261127T0119_k14e_tpv_codigos_cegid.down.sql

rollback;
