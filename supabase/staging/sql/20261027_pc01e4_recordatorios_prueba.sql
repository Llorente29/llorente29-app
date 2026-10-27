-- supabase/staging/sql/20261027_pc01e4_recordatorios_prueba.sql
--
-- SOLO STAGING. Prueba de la 0641 del PC01 · E4 (los recordatorios de cobro que
-- se mandan solos), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. En la empresa A, con datos INVENTADOS que se siembra ella misma
-- (ocho clientes con sus facturas, cada una en un caso), por los CAMINOS de
-- verdad: lo que toca lo pide el servidor (service_role, como
-- conta-recordatorios), lo apunta el servidor, y los ajustes y el «apagar por
-- cliente» los hace el administrador.
--
--   1. Lo que toca hoy: 3 días antes, el día que vence, a los 7 días, y el de
--      ayer que no salió (el cron falló un día); el que no tiene correo también,
--      para apuntar que no salió. No tocan: domiciliada, cliente apagado,
--      cobrada, ni la que no vence en ninguno de sus días.
--   2. El correo: el de la factura o, si no lo tiene, el último del cliente.
--   3. Apuntar: una vez por factura y paso (el segundo intento no hace nada), y
--      en el historial de la factura; después ya no toca.
--   4. El resumen de la pantalla: enviados, el próximo y por qué no lleva.
--   5. Los ajustes: lo que no vale y lo que sí; apagados, no toca nada; otros días.
--   6. Una prueba a un correo: los datos de una factura, con su permiso.
--   7. El despertador: fuera de las 9 de Madrid no hace nada.
--   8. La vuelta atrás: sin tablas, funciones ni cron de la E4.
--
-- Nombra lo que toca, para el analizador: conta_cobro_ajuste,
-- conta_cobro_cliente, conta_recordatorio, customer_invoice_event,
-- customer_invoice_payment.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 E4: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- La 0641 solo añade: el ensayo de la rama puede haberla pasado ya de verdad (W05).
\i supabase/vuelta-atras/20261027T0641_pc01e4_recordatorios.down.sql
do $$ begin
  if to_regclass('public.conta_recordatorio') is not null or to_regclass('public.conta_cobro_ajuste') is not null then
    raise exception 'PRUEBA PC01 E4 · 0: la vuelta atrás no deja staging sin la E4.';
  end if;
end $$;
\i supabase/migrations/20261027T0641_pc01e4_recordatorios.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1');

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
-- Cada cliente, su factura y cuándo vence respecto a hoy:
--   antes   vence en 3 días (toca el paso -3)          transferencia, con correo
--   dia     vence hoy (toca el 0)                      transferencia, SIN correo en la factura: el de otra suya
--   siete   venció hace 7 (toca el 7)                  transferencia, con correo
--   tarde   venció hace 8 (el 7 tocó ayer y no salió)  transferencia, con correo
--   sinc    vence hoy                                  transferencia, sin correo en ninguna
--   dom     vence hoy                                  domiciliada: no hacen falta
--   apag    vence hoy                                  transferencia: el cliente, apagado
--   cobr    vence hoy                                  transferencia, ya cobrada
--   nada    vence en 10 días (ningún paso hoy)         transferencia, con correo
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        dom uuid := (select id from public.payment_method where code = 'domiciliacion' and account_id is null limit 1);
        tra uuid := (select id from public.payment_method where code = 'transferencia' and account_id is null limit 1);
        s uuid; f uuid; i int := 0; k text;
        casos text[] := array['antes', 'dia', 'siete', 'tarde', 'sinc', 'dom', 'apag', 'cobr', 'nada'];
        vence int[] := array[3, 0, -7, -8, 0, 0, 0, 0, 10];
        hoy date := public.conta_hoy();
begin
  if dom is null or tra is null then raise exception 'PRUEBA PC01 E4 · siembra: faltan las formas de cobro globales.'; end if;
  foreach k in array casos loop
    i := i + 1;
    insert into public.party (account_id, name, tax_id) values (a, 'Cliente E4 ' || k, 'B0000040' || i) returning id into s;
    insert into _p values (k, s);
    insert into public.customer_fiscal (party_id, account_id, legal_name, payment_method)
    values (s, a, 'Cliente E4 ' || k || ' SL', case when k = 'dom' then 'direct_debit' else 'transfer' end);
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                         party_id, customer, payment_method_id, email_to, base, tax, total)
    values (a, e, 'emitida', 'a_mano', 'E4R', 2026, i, 'E4R-' || i, hoy - 30, hoy + vence[i], s, jsonb_build_object('nombre', 'Cliente E4 ' || k),
            case when k = 'dom' then dom else tra end,
            case when k in ('dia', 'sinc') then null else k || '@cliente-e4.example' end,
            100.00, 21.00, 121.00)
    returning id into f;
    insert into _p values ('f_' || k, f);
  end loop;
  -- El cliente «dia» tiene otra factura (que vence lejos) con su correo: de ahí sale el del recordatorio.
  insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                       party_id, customer, payment_method_id, email_to, base, tax, total)
  values (a, e, 'emitida', 'a_mano', 'E4R', 2026, 10, 'E4R-10', hoy - 60, hoy + 40, (select v::uuid from _p where clave = 'dia'),
          jsonb_build_object('nombre', 'Cliente E4 dia'), tra, 'pagos@dia-e4.example', 100.00, 21.00, 121.00);
  -- La «cobr», cobrada entera.
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, note)
  values (a, e, (select v::uuid from _p where clave = 'f_cobr'), hoy - 1, 121.00, 'prueba E4');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- El administrador apaga los recordatorios del cliente «apag».
do $$
declare x jsonb := public.conta_recordatorios_cliente((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'apag'), true);
begin
  if x->>'frase' <> 'A Cliente E4 apag ya no se le mandan recordatorios.' then raise exception 'PRUEBA PC01 E4 · siembra: apagar dijo %.', x; end if;
end $$;
-- Y el usuario no llama a lo del servidor.
do $$
declare v_err text;
begin
  begin perform public.conta_recordatorios_por_mandar(null, 10); exception when insufficient_privilege then v_err := 'denegado'; end;
  if v_err is distinct from 'denegado' then raise exception 'PRUEBA PC01 E4 · siembra: un usuario puede pedir lo que toca mandar.'; end if;
end $$;
reset role;

-- ── 1 y 2 · Lo que toca hoy (como el servidor) ──────────────────────────────
set local role service_role;
do $$
declare x jsonb; n int; casos text;
begin
  select string_agg(p.clave || ':' || (r->>'dia') || ':' || coalesce(r->>'para', '-') || ':' || coalesce(r->>'sin', 'si'), ' ' order by p.clave), count(*)
    into casos, n
    from public.conta_recordatorios_por_mandar(null, 1000) r join _p p on p.v = r->>'factura';
  if casos is distinct from 'f_antes:-3:antes@cliente-e4.example:si f_dia:0:pagos@dia-e4.example:si f_siete:7:siete@cliente-e4.example:si f_sinc:0:-:sin_correo f_tarde:7:tarde@cliente-e4.example:si' then
    raise exception 'PRUEBA PC01 E4 · 1: lo que toca hoy es «%».', casos;
  end if;
  select r into x from public.conta_recordatorios_por_mandar(null, 1000) r where r->>'factura' = (select v from _p where clave = 'f_tarde');
  if (x->>'toca')::date <> public.conta_hoy() - 1 or (x->>'pendiente')::numeric <> 121 or x->>'numero' <> 'E4R-4' or x->>'cliente' <> 'Cliente E4 tarde' then
    raise exception 'PRUEBA PC01 E4 · 1: los datos de «tarde» son %.', x;
  end if;
  raise notice '1 · toca hoy: -3, 0, 7 y el 7 de ayer que no salió; y el sin correo, para apuntarlo. No: domiciliada, apagado, cobrada, ni la que no vence hoy';
  raise notice '2 · el correo: el de la factura o el último del cliente (pagos@dia-e4.example)';
end $$;

-- ── 3 · Apuntar (como el servidor) ──────────────────────────────────────────
do $$
declare r jsonb; ok boolean; n int := 0;
begin
  for r in select x from public.conta_recordatorios_por_mandar(null, 1000) x join _p p on p.v = x->>'factura' loop
    ok := public.conta_recordatorio_apuntar((r->>'factura')::uuid, (r->>'dia')::int, (r->>'toca')::date, r->>'sin' is null, r->>'para',
            case when r->>'sin' is null then null else 'sin_correo' end,
            case when r->>'sin' is null then format('Recordatorio mandado a %s.', r->>'para') else 'No se ha mandado el recordatorio: el cliente no tiene correo.' end,
            case when r->>'sin' is null then 'prueba-' || (r->>'numero') end);
    if not ok then raise exception 'PRUEBA PC01 E4 · 3: no se apuntó %.', r->>'numero'; end if;
    n := n + 1;
  end loop;
  if n <> 5 then raise exception 'PRUEBA PC01 E4 · 3: se apuntaron % (esperaba 5).', n; end if;
  if public.conta_recordatorio_apuntar((select v::uuid from _p where clave = 'f_antes'), -3, public.conta_hoy(), true, 'x@y.example', null, 'otra vez', null) then
    raise exception 'PRUEBA PC01 E4 · 3: el mismo paso se apuntó dos veces.';
  end if;
  if exists (select 1 from public.conta_recordatorios_por_mandar(null, 1000) x join _p p on p.v = x->>'factura') then
    raise exception 'PRUEBA PC01 E4 · 3: después de apuntar aún toca algo.';
  end if;
  if (select count(*) from public.customer_invoice_event ev join _p p on p.v = ev.invoice_id::text where ev.kind = 'recordatorio') <> 4
     or (select count(*) from public.customer_invoice_event ev where ev.invoice_id = (select v::uuid from _p where clave = 'f_sinc') and ev.kind = 'recordatorio_no_enviado') <> 1 then
    raise exception 'PRUEBA PC01 E4 · 3: el historial de las facturas no lo dice.';
  end if;
  raise notice '3 · apuntados 5 (4 mandados y 1 sin correo), en el historial de cada factura; el mismo paso no se apunta dos veces';
end $$;
reset role;

-- ── 4 · El resumen de la pantalla (como el administrador) ──────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_recordatorios_resumen((select v::uuid from _p where clave = 'empresa')); f jsonb;
        uno text;
begin
  if (x->>'activos')::boolean is not true or x->'dias' <> '[-3, 0, 7, 15]'::jsonb then raise exception 'PRUEBA PC01 E4 · 4: ajustes %.', x->'dias'; end if;
  if not exists (select 1 from jsonb_array_elements(x->'clientes_apagados') c where c->>'nombre' = 'Cliente E4 apag') then
    raise exception 'PRUEBA PC01 E4 · 4: el cliente apagado no sale.';
  end if;
  select string_agg(p.clave || ':' || (r->>'enviados') || ':' || coalesce(r->>'proximo', '-') || ':' || coalesce(r->>'sin', 'si'), ' ' order by p.clave)
    into uno from jsonb_array_elements(x->'facturas') r join _p p on p.v = r->>'id' and p.clave like 'f\_%';
  if uno is distinct from format('f_antes:1:%s:si f_apag:0:-:cliente f_dia:1:%s:si f_dom:0:-:domiciliada f_nada:0:%s:si f_siete:1:%s:si f_sinc:0:-:sin_correo f_tarde:1:%s:si',
                                 public.conta_hoy() + 3, public.conta_hoy() + 7, public.conta_hoy() + 7, public.conta_hoy() + 8, public.conta_hoy() + 7) then
    raise exception 'PRUEBA PC01 E4 · 4: el resumen dice «%».', uno;
  end if;
  if jsonb_array_length(x->'ultimos') < 5 then raise exception 'PRUEBA PC01 E4 · 4: últimos %.', x->'ultimos'; end if;
  raise notice '4 · el resumen: enviados, el próximo y por qué no lleva (domiciliada, cliente apagado, sin correo)';
end $$;

-- ── 5 · Los ajustes ─────────────────────────────────────────────────────────
do $$
declare v_err text; x jsonb; e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  begin perform public.conta_cobro_ajustes_guardar(e, true, '{}'::integer[]); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Pon al menos un día.' then raise exception 'PRUEBA PC01 E4 · 5: sin días dijo «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_cobro_ajustes_guardar(e, true, '{-3,120}'::integer[]); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Cada día, entre 30 antes de vencer y 90 después.' then raise exception 'PRUEBA PC01 E4 · 5: 120 dijo «%».', v_err; end if;
  x := public.conta_cobro_ajustes_guardar(e, false, '{-3,0,7,15}'::integer[]);
  if x->>'frase' <> 'Guardado: los recordatorios están apagados. No se manda ninguno.' then raise exception 'PRUEBA PC01 E4 · 5: apagar dijo %.', x; end if;
  x := public.conta_cobro_ajustes_guardar(e, true, '{30,-5,0,0}'::integer[]);
  if x->>'frase' <> 'Guardado: los recordatorios se mandan 5 días antes, el día que vence, a los 30 días.' then raise exception 'PRUEBA PC01 E4 · 5: otros días dijo %.', x; end if;
  if (public.conta_recordatorios_resumen(e))->'dias' <> '[-5, 0, 30]'::jsonb then raise exception 'PRUEBA PC01 E4 · 5: los días no se guardaron.'; end if;
  raise notice '5 · ajustes: sin días y fuera de rango no; apagar y otros días, con su frase';
end $$;
reset role;
set local role service_role;
do $$
begin
  -- Con -5, 0 y 30: dentro de 5 días toca el -5 de «nada» (vence en 10).
  if not exists (select 1 from public.conta_recordatorios_por_mandar(public.conta_hoy() + 5, 1000) r where r->>'factura' = (select v from _p where clave = 'f_nada') and (r->>'dia')::int = -5) then
    raise exception 'PRUEBA PC01 E4 · 5: con los días nuevos no toca el -5 de «nada».';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.conta_cobro_ajustes_guardar((select v::uuid from _p where clave = 'empresa'), false, '{-5,0,30}'::integer[]) is not null as apagados;
reset role;
set local role service_role;
do $$
begin
  if exists (select 1 from public.conta_recordatorios_por_mandar(public.conta_hoy() + 5, 1000) r join _p p on p.v = r->>'factura') then
    raise exception 'PRUEBA PC01 E4 · 5: apagados, aún toca algo.';
  end if;
  raise notice '5 · con los días nuevos toca el -5; apagados, no toca nada';
end $$;
reset role;

-- ── 6 · Una prueba a un correo ──────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x jsonb := public.conta_recordatorio_prueba_datos((select v::uuid from _p where clave = 'f_siete'));
begin
  if x->>'numero' <> 'E4R-3' or (x->>'pendiente')::numeric <> 121 or x->>'para' <> 'siete@cliente-e4.example' or x ? 'sin' and x->>'sin' is not null then
    raise exception 'PRUEBA PC01 E4 · 6: los datos de la prueba son %.', x;
  end if;
  raise notice '6 · una prueba: los datos de la factura, para el administrador';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000ff', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_err text;
begin
  begin perform public.conta_recordatorio_prueba_datos((select v::uuid from _p where clave = 'f_siete')); exception when others then v_err := sqlstate; end;
  if v_err is distinct from '42501' then raise exception 'PRUEBA PC01 E4 · 6: alguien de fuera de la cuenta lee la factura (%).', v_err; end if;
  raise notice '6 · y alguien de fuera de la cuenta, no';
end $$;
reset role;

-- ── 7 · El despertador ──────────────────────────────────────────────────────
do $$
declare v_err text;
begin
  begin perform public.conta_recordatorios_despertar(); exception when others then v_err := sqlstate; end;
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 9 and v_err is not null then
    raise exception 'PRUEBA PC01 E4 · 7: fuera de las 9 el despertador falla (%).', v_err;
  end if;
  if extract(hour from (now() at time zone 'Europe/Madrid')) = 9 and v_err is distinct from '55000' and v_err is not null then
    raise exception 'PRUEBA PC01 E4 · 7: a las 9 el despertador falla con %.', v_err;
  end if;
  raise notice '7 · el despertador: fuera de las 9 de Madrid no hace nada (y a las 9, sin cron_secret, lo dice)';
end $$;

-- ── 8 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261027T0641_pc01e4_recordatorios.down.sql
do $$ begin
  if to_regclass('public.conta_recordatorio') is not null or to_regclass('public.conta_cobro_ajuste') is not null or to_regclass('public.conta_cobro_cliente') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and (proname like '\_pc01e4\_%' or proname like 'conta\_recordatorio%' or proname = 'conta_cobro_ajustes_guardar')) then
    raise exception 'PRUEBA PC01 E4 · 8: la vuelta atrás deja algo de la E4.';
  end if;
  raise notice '8 · la vuelta atrás: sin tablas ni funciones de la E4';
end $$;
rollback;
