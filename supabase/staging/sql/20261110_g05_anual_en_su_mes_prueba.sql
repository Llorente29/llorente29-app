-- supabase/staging/sql/20261110_g05_anual_en_su_mes_prueba.sql
--
-- SOLO STAGING. La 1622 (G05 · nº 89: una anual, entera y solo en su mes), con
-- datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 1622, dos veces.
--   2. Un cliente inventado con tres líneas: una anual con su importe (300 €,
--      desde junio), una anual con tarifa (120 € al año, desde febrero) y una
--      mensual (150 €).
--   3. Como la persona: la anual de 300 € vale 300 en junio y 0 en noviembre y en
--      julio; la de tarifa, 120 en febrero y 0 en los demás; la mensual, 150 todos
--      los meses (no cambia). Antes del «desde», 0.
--   4. La vuelta atrás de la 1622 (vuelve la de antes: 25 € cada mes), y otra vez la 1622.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 ANUAL: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1622, dos veces.
\i supabase/migrations/20261110T1622_g05_anual_en_su_mes.sql
\i supabase/migrations/20261110T1622_g05_anual_en_su_mes.sql
do $$ begin raise notice 'G05 ANUAL · 1: la 1622 carga, y dos veces. OK'; end $$;

-- 2 · Lo de antes, inventado.
create temp table _g (clave text primary key, v text) on commit drop;
grant select on _g to authenticated;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c uuid; s1 uuid; s2 uuid; s3 uuid; l1 uuid; l2 uuid; l3 uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 ANUAL · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Talleres Prueba Anual, S.L.', 'B00000988') returning id into c;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values
    (a, e, 'g05_anual_soc', 'Impuesto de sociedades prueba', 'fijo_anio') returning id into s1;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values
    (a, e, 'g05_anual_cert', 'Certificado digital prueba', 'fijo_anio') returning id into s2;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values
    (a, e, 'g05_anual_ges', 'Gestoría prueba', 'fijo_mes') returning id into s3;
  insert into public.conta_tarifa (account_id, company_id, servicio_id, importe, periodo, desde) values (a, e, s2, 120, 'anio', '2025-01-01');
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, importe_propio, periodo, desde)
    values (a, e, c, s1, 'manual', 300, 'anio', '2026-06-01') returning id into l1;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, periodo, desde)
    values (a, e, c, s2, 'manual', 'anio', '2026-02-01') returning id into l2;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, origen, importe_propio, periodo, desde)
    values (a, e, c, s3, 'manual', 150, 'mes', '2026-01-01') returning id into l3;
  insert into _g values ('l1', l1), ('l2', l2), ('l3', l3);
end $$;

-- 3 · Como la persona (administradora de la cuenta A).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare l1 uuid := (select v::uuid from _g where clave = 'l1'); l2 uuid := (select v::uuid from _g where clave = 'l2'); l3 uuid := (select v::uuid from _g where clave = 'l3');
        x record;
begin
  for x in select * from (values
      (l1, date '2026-05-01', 0::numeric), (l1, date '2026-06-01', 300), (l1, date '2026-07-01', 0), (l1, date '2026-11-01', 0), (l1, date '2027-06-15', 300),
      (l2, date '2026-02-01', 120), (l2, date '2026-11-01', 0), (l2, date '2027-02-01', 120),
      (l3, date '2026-06-01', 150), (l3, date '2026-11-01', 150)) v(linea, mes, esperado) loop
    if public.conta_linea_al_mes(x.linea, x.mes) is distinct from x.esperado then
      raise exception 'G05 ANUAL · 3: en % sale % y tenía que salir %.', x.mes, public.conta_linea_al_mes(x.linea, x.mes), x.esperado;
    end if;
  end loop;
  raise notice 'G05 ANUAL · 3: la anual entera en su mes y 0 en los demás (con su importe y con tarifa); la mensual, igual. OK';
end $$;
reset role;

-- 4 · La vuelta atrás (vuelve la de antes), y otra vez la 1622.
\i supabase/vuelta-atras/20261110T1622_g05_anual_en_su_mes.down.sql
do $$ begin
  if public.conta_linea_al_mes((select v::uuid from _g where clave = 'l1'), date '2026-11-01') is distinct from 25.00 then
    raise exception 'G05 ANUAL · 4: la vuelta atrás no ha dejado la función como estaba.';
  end if;
end $$;
\i supabase/migrations/20261110T1622_g05_anual_en_su_mes.sql
do $$ begin
  if public.conta_linea_al_mes((select v::uuid from _g where clave = 'l1'), date '2026-11-01') is distinct from 0::numeric then
    raise exception 'G05 ANUAL · 4: otra vez la 1622 no cuenta bien.';
  end if;
  raise notice 'G05 ANUAL · 4: vuelta atrás (la de antes, 25 € al mes) y otra vez la 1622. OK';
end $$;

rollback;
