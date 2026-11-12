-- supabase/staging/sql/20261112_gbd_red_cuota_prueba.sql
--
-- SOLO STAGING. Prueba de la 0955 del GBd (el plan B, en pruebas: la red de la
-- «Cuota mensual» de Bitrix24). Todo en ROLLBACK, datos inventados (T11), en la
-- cuenta A de staging.
--
--   1. La 0955, dos veces.
--   2. Solo el servidor: ni con sesión ni sin ella se pueden llamar.
--   3. Con la conexión en entorno «real», la red no lee nada (no_es_pruebas).
--   4. En «pruebas»: el campo de la cuota del mapa, el cliente y lo de Clientes;
--      una ficha sin enlazar, sin_enlazar.
--   5. Apuntar una devolución: queda, y cuenta en «recientes» (el freno del bucle).
--   6. La vuelta atrás lo quita todo.
--
-- sin usuario: la red la llama solo el servidor; lee como una administradora de la cuenta, y eso se prueba aquí.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GBd-0955: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 0955, dos veces.
\i supabase/migrations/20261112T0955_gbd_red_cuota.sql
\i supabase/migrations/20261112T0955_gbd_red_cuota.sql

-- 2 · Solo el servidor.
do $$ begin
  if has_function_privilege('authenticated', 'public.conta_bitrix_red_leer(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_red_leer(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_bitrix_red_apuntar(uuid,jsonb)', 'execute')
     or has_table_privilege('authenticated', 'public.conta_bitrix_red', 'select') then
    raise exception 'PRUEBA GBd-0955 · 2: la red se puede llamar o leer con sesión.';
  end if;
  if not has_function_privilege('service_role', 'public.conta_bitrix_red_leer(uuid,text)', 'execute') then
    raise exception 'PRUEBA GBd-0955 · 2: el servidor no la puede llamar.';
  end if;
  raise notice 'GBd-0955 · 1 y 2: carga dos veces y solo la llama el servidor. OK';
end $$;

-- 3 a 5 · En la cuenta A, con una conexión inventada.
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; x uuid; r jsonb;
begin
  delete from public.conta_crm where account_id = a and crm = 'bitrix24';
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa)
  values (a, 'bitrix24', 'real', 'portal-prueba-0955.bitrix24.invalid',
          '{"campos":[{"campo":"cuota_referencia","codigo":"UF_CRM_TARIFA","etiqueta":"Tarifa recurrente"},{"campo":"cuota_referencia","codigo":"UF_CRM_CUOTA_MENSUAL","etiqueta":"Cuota mensual"}]}');
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Red Prueba, S.L.', 'B00000955') returning id into x;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, crm, tipo_ficha, id_externo, ficha)
  values (a, x, 'activo', 'bitrix24', 'empresa', '955', '{"nombre":"Cliente Red Prueba, S.L."}');

  r := public.conta_bitrix_red_leer(a, '955');
  if r->>'estado' <> 'no_es_pruebas' then raise exception 'PRUEBA GBd-0955 · 3: en «real» la red no tenía que leer (%).', r->>'estado'; end if;

  update public.conta_crm set entorno = 'pruebas' where account_id = a and crm = 'bitrix24';
  r := public.conta_bitrix_red_leer(a, '955');
  if r->>'estado' <> 'ok' or r->>'campo' <> 'UF_CRM_CUOTA_MENSUAL' or (r->>'cliente')::uuid <> x
     or jsonb_typeof(r->'clientes') <> 'object' or (r->>'recientes')::int <> 0 then
    raise exception 'PRUEBA GBd-0955 · 4: lo leído no es lo esperado (estado %, campo %, recientes %).', r->>'estado', r->>'campo', r->>'recientes';
  end if;
  if public.conta_bitrix_red_leer(a, '956')->>'estado' <> 'sin_enlazar' or public.conta_bitrix_red_leer(a, 'x')->>'estado' <> 'ficha_rara' then
    raise exception 'PRUEBA GBd-0955 · 4: una ficha sin enlazar o rara no da lo esperado.';
  end if;
  raise notice 'GBd-0955 · 3 y 4: en «real» no lee; en «pruebas», el campo de la cuota, el cliente y Clientes. OK';

  perform public.conta_bitrix_red_apuntar(a, '{"id_externo":"955","campo":"UF_CRM_CUOTA_MENSUAL","antes":"999,00","despues":"200,00","quien_id":"7","quien":"Equipo Prueba","correo":"cupo","correo_a":["equipo.prueba@ejemplo.invalid"],"correo_porque":"Resend no deja mandar más correos ahora (429).","nota":"escrita"}');
  if (select count(*) from public.conta_bitrix_red where account_id = a and correo = 'cupo' and correo_a = array['equipo.prueba@ejemplo.invalid'] and nota = 'escrita') <> 1 then
    raise exception 'PRUEBA GBd-0955 · 5: la devolución no ha quedado apuntada como se mandó.';
  end if;
  if (public.conta_bitrix_red_leer(a, '955')->>'recientes')::int <> 1 then raise exception 'PRUEBA GBd-0955 · 5: no cuenta en «recientes».'; end if;
  raise notice 'GBd-0955 · 5: la devolución queda apuntada, con el correo sin cupo, y cuenta para el freno. OK';
end $$;

-- 6 · La vuelta atrás.
\i supabase/vuelta-atras/20261112T0955_gbd_red_cuota.down.sql
do $$ begin
  if to_regclass('public.conta_bitrix_red') is not null or to_regprocedure('public.conta_bitrix_red_leer(uuid,text)') is not null
     or to_regprocedure('public.conta_bitrix_red_apuntar(uuid,jsonb)') is not null then
    raise exception 'PRUEBA GBd-0955 · 6: la vuelta atrás no lo quita todo.';
  end if;
  raise notice 'GBd-0955 · 6: la vuelta atrás lo quita todo. OK';
end $$;

rollback;
