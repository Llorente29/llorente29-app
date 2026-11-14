-- supabase/migrations/20261113T2005_b01r26_ensayo_c0009.sql
--
-- B01r·26 (Julio, 13/11, decisión 2: «la A») · EL ENSAYO GENERAL DEL TRASPASO DE
-- OCTUBRE EN LA C0009, POR EL CAMINO DE VERDAD. Con esto aplicado, Julio pulsa
-- «Traspasar a Diez» en octubre en Sumied (producción) y todo va a la C0009, la
-- copia de pruebas de Diez, no a la C0008:
--   1. Guarda los 242 envíos de Foodint a Diez tal como están (conta_b01r26_ensayo).
--   2. Los 215 de octubre que la C0008 ya tiene (213 «enviado» y 2 «enlazado»)
--      pasan a «rechazado», para que viajen en el ensayo como viajarán después
--      del borrado (lo que hace la 1745).
--   3. La conexión de Foodint con Diez apunta a la C0009.
-- Foodint está en modo «mensual»: nada sale solo; sale cuando Julio confirma.
--
-- LA LIMPIEZA ES SU VUELTA ATRÁS (supabase/vuelta-atras/20261113T2005_b01r26_ensayo_c0009.down.sql),
-- que Julio lanza en modo «vuelta_atras» después del ensayo: quita lo que el
-- ensayo dejó en Sumied (traspasos, enlaces de PDF, subcuentas apuntadas,
-- envíos nuevos), reabre octubre si el ensayo lo cerró, devuelve los 242 envíos
-- a como estaban y la conexión a la C0008. Lo que queda en la C0009 se queda
-- allí: es la de pruebas.
--
-- Guardas: Foodint con su conexión en la C0008, sin ningún traspaso, y los 242
-- envíos como se midieron (213, 2 y 27). Si no, no cambia nada.
-- Nada en el camino del pedido.

create table if not exists public.conta_b01r26_ensayo (
  clave text primary key,
  valor jsonb not null,
  creado_en timestamptz not null default now()
);
comment on table public.conta_b01r26_ensayo is
  'B01r26 · Lo que guarda el ensayo del traspaso en la C0009 para deshacerlo (20261113T2005 y su vuelta atrás): cuándo empezó y los envíos a Diez de Foodint de antes. La vuelta atrás la vacía y la quita.';
alter table public.conta_b01r26_ensayo enable row level security;
revoke all on table public.conta_b01r26_ensayo from public, anon, authenticated;
grant all on table public.conta_b01r26_ensayo to service_role;

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_con constant uuid := '860fcb61-9b95-46da-bc1a-ad73d665f19b';
  v_env int; v_enl int; v_pen int; v_otros int; v_n int;
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'B01r26 ensayo: sin la empresa de Foodint (staging), no hay nada que apuntar.';
    return;
  end if;
  if not exists (select 1 from public.account_connector where id = v_con and company_id = v_e and account_id = v_acc
                  and external_account_id = 'C0008' and config->>'nombre_bd' = 'C0008' and status = 'connected') then
    raise exception 'B01r26 ensayo: la conexión de Foodint con Diez no está en la C0008 (¿ya hay un ensayo en marcha?). No se cambia nada.';
  end if;
  if exists (select 1 from public.conta_diez_traspaso where company_id = v_e) then
    raise exception 'B01r26 ensayo: Foodint ya tiene algún traspaso. No se cambia nada.';
  end if;
  if exists (select 1 from public.conta_b01r26_ensayo) then
    raise exception 'B01r26 ensayo: ya hay un ensayo guardado sin limpiar. No se cambia nada.';
  end if;
  select count(*) filter (where status = 'enviado'), count(*) filter (where status = 'enlazado'), count(*) filter (where status = 'pendiente'),
         count(*) filter (where status not in ('enviado', 'enlazado', 'pendiente'))
    into v_env, v_enl, v_pen, v_otros
    from public.external_send where company_id = v_e and account_id = v_acc;
  if (v_env, v_enl, v_pen, v_otros) <> (213, 2, 27, 0) then
    raise exception 'B01r26 ensayo: los envíos de Foodint no son los medidos (213, 2, 27, 0): son %, %, %, %. No se cambia nada.', v_env, v_enl, v_pen, v_otros;
  end if;

  -- 1. Lo de antes.
  insert into public.conta_b01r26_ensayo (clave, valor) values
    ('marca', to_jsonb(now())),
    ('envios', (select jsonb_agg(to_jsonb(s) order by s.id) from public.external_send s where s.company_id = v_e and s.account_id = v_acc)),
    ('conexion', (select to_jsonb(c) - 'updated_at' from public.account_connector c where c.id = v_con));

  -- 2. Los 215 de octubre, a viajar.
  update public.external_send s
     set status = 'rechazado', next_try_at = null, updated_at = now(),
         last_error = format('Ensayo del traspaso en la C0009 (B01r26): fuera mientras dura. Antes: %s %s/%s/%s', s.status, s.ext_year, s.ext_series, s.ext_number)
   where s.company_id = v_e and s.account_id = v_acc and s.status in ('enviado', 'enlazado');
  get diagnostics v_n = row_count;
  if v_n <> 215 then raise exception 'B01r26 ensayo: se han apartado % envíos y tenían que ser 215.', v_n; end if;

  -- 3. La conexión, a la C0009.
  update public.account_connector
     set external_account_id = 'C0009', config = config || jsonb_build_object('nombre_bd', 'C0009', 'ensayo_b01r26', true)
   where id = v_con;
  raise notice 'B01r26 ensayo: Foodint apunta a la C0009; 215 envíos de octubre fuera mientras dura; lo de antes, guardado.';
end $$;
