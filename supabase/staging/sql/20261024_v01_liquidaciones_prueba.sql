-- supabase/staging/sql/20261024_v01_liquidaciones_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T1650_v01_liquidaciones (añade), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A
-- (Taberna de Prueba Norte, carril 0), Glovo en Norte Centro.
--
--   0. Una liquidación de Glovo de la semana del 21 al 27/09 en Norte Centro,
--      por lo que suman sus cierres de esos días (y otra de Glovo sin local).
--   1. Como usuario de A: conta_plataformas la trae en su fila (periodo,
--      plataforma y local), con los cierres de esos días, y la de sin local
--      aparte; y nada de B.
--   2. Resolver la diferencia de la fila como gasto: su asiento (629 contra la
--      430), validado, y la resolución con su frase; otra vez, no (ya está).
--   3. Un pedido de Glovo de esos días, reclamado: la resolución y su
--      journal_dismissal (sale del aviso del C11b).
--   4. Sin frase o con un tipo que no es, no; B no puede resolver en A.
--   5. La vuelta atrás: sin funciones ni tabla.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V01 LIQUIDACIONES: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- El ensayo de la rama ya ha pasado la 1650 (y entra de verdad, porque solo
-- añade): primero su vuelta atrás, y desde ahí «lo de antes» es producción.
\i supabase/vuelta-atras/20261024T1650_v01_liquidaciones.down.sql

create temp table _l (clave text primary key, v text) on commit drop;
grant select, insert, update on _l to authenticated;
insert into _l values
  ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('local', 'c01a0000-0000-4000-8000-0000000000a2'), ('cierre', 'acebcda4-f03a-4f84-bfe4-062a941e60a2');
insert into _l select 'canal', channel_id::text from public.sales_day_summary where id = 'acebcda4-f03a-4f84-bfe4-062a941e60a2';
insert into _l select 'cierres', coalesce(sum(d.total), 0)::text from public.sales_day_summary d left join public.journal_entry e on e.id = d.entry_id
 where d.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and d.location_id = 'c01a0000-0000-4000-8000-0000000000a2'
   and d.channel_id = (select v::uuid from _l where clave = 'canal') and d.sales_day between '2026-09-21' and '2026-09-27' and coalesce(e.status, 'propuesto') <> 'anulado';

-- 0 · Las liquidaciones de prueba.
do $$
declare v_c uuid := (select v::uuid from _l where clave = 'canal'); v_t numeric := (select v::numeric from _l where clave = 'cierres');
begin
  if v_c is null then raise exception 'PRUEBA V01 LIQUIDACIONES · 0: el cierre de Glovo del 24/09 no tiene canal.'; end if;
  if v_t <= 0 then raise exception 'PRUEBA V01 LIQUIDACIONES · 0: Glovo en Norte Centro no tiene cierres del 21 al 27/09.'; end if;
  insert into public.channel_settlement (account_id, channel_id, location_id, period_from, period_to, settlement_date, gross_sales, commission, net_payout, source, import_key)
  values ('c01a0000-0000-4000-8000-00000000000a', v_c, 'c01a0000-0000-4000-8000-0000000000a2', '2026-09-21', '2026-09-27', '2026-09-30', v_t, -round(v_t * 0.3, 2), round(v_t * 0.6, 2), 'manual', 'prueba-v01-liq-1'),
         ('c01a0000-0000-4000-8000-00000000000a', v_c, null, '2026-09-21', '2026-09-27', '2026-09-30', 10, -3, 7, 'manual', 'prueba-v01-liq-2');
  raise notice '0 · dos liquidaciones de Glovo del 21 al 27/09: Norte Centro (% de cierres) y una sin local', v_t;
end $$;

\i supabase/migrations/20261024T1650_v01_liquidaciones.sql

-- 1 · La lista, como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_r jsonb := public.conta_plataformas((select v::uuid from _l where clave = 'empresa'), '2026-09-01', '2026-09-30'); v_g jsonb; v_s jsonb;
begin
  select x into v_g from jsonb_array_elements(v_r) x where x->>'local_id' = (select v from _l where clave = 'local') and x->>'desde' = '2026-09-21';
  select x into v_s from jsonb_array_elements(v_r) x where x->>'local_id' is null and x->>'desde' = '2026-09-21' and x->>'canal_id' = (select v from _l where clave = 'canal');
  if v_g is null then raise exception 'PRUEBA V01 LIQUIDACIONES · 1: la fila de Glovo en Norte Centro no sale: %.', v_r; end if;
  if (v_g->'cierres'->>'total')::numeric <> (select v::numeric from _l where clave = 'cierres') or jsonb_array_length(v_g->'liquidaciones') <> 1 then
    raise exception 'PRUEBA V01 LIQUIDACIONES · 1: la fila no trae sus cierres o su liquidación: %.', v_g;
  end if;
  if v_s is null or jsonb_array_length(v_s->'liquidaciones') <> 1 or (v_s->'cierres'->>'total')::numeric <> 0 then
    raise exception 'PRUEBA V01 LIQUIDACIONES · 1: la de sin local no sale aparte y sin cierres: %.', v_s;
  end if;
  raise notice '1 · la fila de Glovo en Norte Centro con sus cierres (%), y la de sin local aparte', v_g->'cierres'->>'total';
end $$;
reset role;

-- 2 · Un gasto: su asiento validado.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _l where clave = 'empresa'); v_c629 text; v_c430 text; v_r jsonb; v_entry public.journal_entry;
begin
  select code into v_c629 from public.company_account where company_id = v_e and code like '629%' and length(code) >= 8 order by code limit 1;
  if v_c629 is null then select code into v_c629 from public.company_account where company_id = v_e and code like '62%' and length(code) >= 8 order by code limit 1; end if;
  select code into v_c430 from public.company_account where company_id = v_e and code like '430%' and length(code) >= 8 order by code limit 1;
  v_r := public.conta_plataforma_resolver(v_e, (select v::uuid from _l where clave = 'canal'), (select v::uuid from _l where clave = 'local'), '2026-09-21', '2026-09-27', null,
    'gasto', 2.16, 'Glovo se queda 2,16 por un pedido devuelto', null,
    jsonb_build_array(jsonb_build_object('cuenta', v_c629, 'debe', 2.16, 'haber', 0, 'concepto', 'Diferencia', 'local_id', (select v from _l where clave = 'local')),
                      jsonb_build_object('cuenta', v_c430, 'debe', 0, 'haber', 2.16, 'concepto', 'Diferencia', 'local_id', (select v from _l where clave = 'local'))),
    'Prueba liquidaciones');
  select * into v_entry from public.journal_entry where id = (v_r->>'asiento')::uuid;
  if v_entry.status <> 'validado' then raise exception 'PRUEBA V01 LIQUIDACIONES · 2: el gasto no deja su asiento validado: %.', v_r; end if;
  if (select count(*) from public.conta_liquidacion_resolucion where entry_id = v_entry.id and kind = 'gasto' and frase like 'Glovo se queda%') <> 1 then
    raise exception 'PRUEBA V01 LIQUIDACIONES · 2: la resolución no queda con su asiento y su frase.';
  end if;
  begin
    perform public.conta_plataforma_resolver(v_e, (select v::uuid from _l where clave = 'canal'), (select v::uuid from _l where clave = 'local'), '2026-09-21', '2026-09-27', null,
      'reclamacion', 2.16, 'Otra vez', null, null, 'Prueba liquidaciones');
    raise exception 'PRUEBA V01 LIQUIDACIONES · 2: deja resolver dos veces la misma diferencia.';
  exception when unique_violation then null;
  end;
  raise notice '2 · el gasto: asiento nº % validado (% contra %), y no se resuelve dos veces', v_entry.number, v_c629, v_c430;
end $$;
reset role;

-- 3 · Un pedido reclamado.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _l where clave = 'empresa'); v_p uuid;
begin
  select s.id into v_p from public.sale s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' and s.channel_id = (select v::uuid from _l where clave = 'canal') order by s.sold_at desc limit 1;
  if v_p is null then raise exception 'PRUEBA V01 LIQUIDACIONES · 3: no hay ningún pedido de Glovo en A.'; end if;
  perform public.conta_plataforma_resolver(v_e, (select v::uuid from _l where clave = 'canal'), (select v::uuid from _l where clave = 'local'), '2026-09-21', '2026-09-27', v_p,
    'reclamacion', 12.5, 'Reclamado por el portal de Glovo', null, null, 'Prueba liquidaciones');
  if not exists (select 1 from public.journal_dismissal where company_id = v_e and source_type = 'sales_adjustment' and source_key = v_p::text and reason like 'Reclamado a %') then
    raise exception 'PRUEBA V01 LIQUIDACIONES · 3: el pedido reclamado no sale del aviso del C11b.';
  end if;
  if (select count(*) from public.conta_liquidacion_resolucion where sale_id = v_p and kind = 'reclamacion' and entry_id is null) <> 1 then
    raise exception 'PRUEBA V01 LIQUIDACIONES · 3: la reclamación no queda (y no lleva asiento).';
  end if;
  raise notice '3 · el pedido reclamado: su resolución, sin asiento, y fuera del aviso del C11b';
end $$;

-- 4 · Lo que no vale.
do $$
declare v_e uuid := (select v::uuid from _l where clave = 'empresa');
begin
  begin
    perform public.conta_plataforma_resolver(v_e, (select v::uuid from _l where clave = 'canal'), null, '2026-09-21', '2026-09-27', null, 'reclamacion', 3, '  ', null, null, null);
    raise exception 'PRUEBA V01 LIQUIDACIONES · 4: deja resolver sin frase.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.conta_plataforma_resolver(v_e, (select v::uuid from _l where clave = 'canal'), null, '2026-09-21', '2026-09-27', null, 'perdon', 3, 'x', null, null, null);
    raise exception 'PRUEBA V01 LIQUIDACIONES · 4: deja un tipo que no es gasto ni reclamación.';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_plataformas('3b34403a-a7d6-4a48-a8d7-737e8cababdc', null, null);
    raise exception 'PRUEBA V01 LIQUIDACIONES · 4: B lee las liquidaciones de A.';
  exception when no_data_found then null;
  end;
  if exists (select 1 from public.conta_liquidacion_resolucion) then raise exception 'PRUEBA V01 LIQUIDACIONES · 4: B ve lo resuelto de A.'; end if;
  begin
    perform public.conta_plataforma_resolver('3b34403a-a7d6-4a48-a8d7-737e8cababdc', (select v::uuid from _l where clave = 'canal'), null, '2026-09-21', '2026-09-27', null, 'reclamacion', 3, 'x', null, null, null);
    raise exception 'PRUEBA V01 LIQUIDACIONES · 4: B resuelve en A.';
  exception when no_data_found then null;
  end;
  raise notice '4 · sin frase o con otro tipo, no; B no ve ni resuelve nada de A';
end $$;
reset role;

-- 5 · La vuelta atrás.
\i supabase/vuelta-atras/20261024T1650_v01_liquidaciones.down.sql
do $$ begin
  if to_regclass('public.conta_liquidacion_resolucion') is not null or to_regprocedure('public.conta_plataformas(uuid,date,date)') is not null
     or to_regprocedure('public.conta_plataforma_resolver(uuid,uuid,uuid,date,date,uuid,text,numeric,text,date,jsonb,text)') is not null then
    raise exception 'PRUEBA V01 LIQUIDACIONES · 5: la vuelta atrás se deja la tabla o las funciones.';
  end if;
  raise notice '5 · la vuelta atrás: ni la tabla ni las funciones';
  raise notice 'PRUEBA V01 LIQUIDACIONES en verde: la fila con sus cierres, el gasto con su asiento, el pedido reclamado, B fuera y la vuelta atrás.';
end $$;

rollback;
