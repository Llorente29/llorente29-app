-- ============================================================================
-- scripts/e2e/carril/comun.sql — lo que comparten clonar.sql y borrar.sql.
-- SOLO STAGING. Lo carga scripts/e2e/carril.sh en la MISMA transacción que el
-- clon o el borrado (psql -1 -f comun.sql -f clonar.sql).
-- ----------------------------------------------------------------------------
-- W02 (paso 1c, 16/10): cada e2e tiene sus PROPIAS cuentas. Un «carril» es una
-- copia de las cuentas de prueba (la plantilla: A, B, C, D, Diez, las dos
-- «solas» del C06, y sus ocho usuarios; D, la sin hostelería, desde el S01; la asesoría del P01 con sus tres personas y sus diez clientes), con los ids cambiados y los correos con
-- «.carril-N». Dos e2e a la vez ya no se pisan: cada una entra con lo suyo.
--
-- El id de una fila del carril N es el de la plantilla con el SEGUNDO grupo
-- «o exclusivo» N (XOR). Los ids de las semillas llevan 0000 ahí, así que
-- quedan con N, que se lee a simple vista:
--     c01a0000-0000-4000-8000-0000000000a3  →  c01a0000-0007-4000-8000-0000000000a3  (N = 7)
-- y un id al azar nunca se queda igual (con «poner N» sí: uno de cada 65.536
-- ya lo tenía, y con 18.000 filas eso le pasaba a uno de cada cuatro carriles;
-- lo encontró el ensayo del 16/10 en journal_correction, con N = 4001).
-- La misma regla está en tests/e2e/conta/sesion.ts (enCarril): una prueba que
-- busca «Hermanos Ruiz» en su carril calcula el id igual que el clon.
--
-- Nada de aquí crea objetos que duren: funciones en pg_temp y tablas
-- temporales que se van al acabar la transacción.
-- ============================================================================

-- Sin disparadores y sin comprobar claves ajenas, SOLO en esta sesión y solo
-- en esta transacción (supautils deja a postgres ponerlo). El clon copia las
-- filas tal como están: un disparador que vuelve a numerar, que crea el tercero
-- del proveedor o que no deja tocar un asiento validado no puede
-- «corregir» una copia. Por eso mismo el clon tiene que ser completo: lo
-- comprueba al final (clonar.sql, «las claves ajenas, una a una»).
set local session_replication_role = replica;

do $$
begin
  -- Guardas: al otro lado no hay producción. Producción tiene las dos siempre.
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Carril ABORTADO: al otro lado hay cuentas de producción (Foodint o Folvy Interno).';
  end if;
  if coalesce(nullif(current_setting('e2e.carril', true), ''), '0')::int not between 1 and 4095 then
    raise exception 'Carril: e2e.carril tiene que ser un número de 1 a 4095 (es «%»).', current_setting('e2e.carril', true);
  end if;
end $$;

-- El id de la plantilla en el carril n (la regla de arriba: segundo grupo XOR n).
create function pg_temp.en_carril(u uuid, n int) returns uuid language sql immutable as $f$
  select overlay(u::text placing lpad(to_hex(('x' || substr(u::text, 10, 4))::bit(16)::int # n), 4, '0') from 10 for 4)::uuid
$f$;

-- El correo de la plantilla en el carril n: parte local + «.carril-n».
create function pg_temp.correo_en_carril(c text, n int) returns text language sql immutable as $f$
  select split_part(c, '@', 1) || '.carril-' || n || '@' || split_part(c, '@', 2)
$f$;

-- La plantilla: los usuarios de prueba (ids fijos de las semillas) y sus cuentas.
-- Las cuentas «solas» del C06 tienen id al azar: salen de los perfiles.
create temp table _plantilla_usuarios (id uuid primary key) on commit drop;
insert into _plantilla_usuarios values
  ('c01a0000-0000-4000-8000-0000000000a1'),  -- a.admin@prueba.folvy.test       · cuenta A
  ('c01a0000-0000-4000-8000-0000000000a6'),  -- a.encargado@prueba.folvy.test   · cuenta A, manager
  ('c01a0000-0000-4000-8000-0000000000a7'),  -- a.trabajador@prueba.folvy.test  · cuenta A, worker con ficha (autoconteo, 21/10)
  ('c01a0000-0000-4000-8000-0000000000a8'),  -- dos.empresas@prueba.folvy.test  · cuentas A y B, administradora de las dos (DM1, 30/10)
  ('d1e00000-0000-4000-8000-0000000000e1'),  -- alta.dos@prueba.folvy.test      · una cuenta sin sociedad y la A (DM1, el alta no encierra, 31/10)
  ('c01b0000-0000-4000-8000-0000000000b1'),  -- b.admin@prueba.folvy.test       · cuenta B
  ('c01c0000-0000-4000-8000-0000000000c1'),  -- c.admin@prueba.folvy.test       · cuenta C, sin empresa
  ('c01d0000-0000-4000-8000-0000000000d1'),  -- d.admin@prueba.folvy.test       · cuenta D, sin hostelería (S01)
  ('c0600000-0000-4000-8000-0000000000a1'),  -- sola.admin@c06-prueba.test      · Empresa de Prueba Sola
  ('c0600000-0000-4000-8000-0000000000b1'),  -- sola.alta@c06-prueba.test       · Taller de Prueba Solo
  ('c0600000-0000-4000-8000-0000000000f0'),  -- c06.plataforma@c06-prueba.test  · administrador de plataforma
  ('d5ac0000-0000-4000-8000-0000000000a1'),  -- p01.laura@p01-prueba.test       · Asesoría de Prueba Centro (P01), administración
  ('d5ac0000-0000-4000-8000-0000000000a2'),  -- p01.marta@p01-prueba.test       · la asesoría, encargada que presenta
  ('d5ac0000-0000-4000-8000-0000000000a3'),  -- p01.jorge@p01-prueba.test       · la asesoría, encargado sin permiso
  ('d5ac0000-0000-4000-8000-00000000c02a'),  -- p01.talleres@p01-prueba.test    · administración de un cliente (el resumen va a ella)
  ('d5ac0000-0000-4000-8000-00000000c08a');  -- p01.bar@p01-prueba.test         · administración de otro cliente

create temp table _plantilla_cuentas (id uuid primary key) on commit drop;
insert into _plantilla_cuentas values
  ('c01a0000-0000-4000-8000-00000000000a'),  -- A · Taberna de Prueba Norte
  ('c01b0000-0000-4000-8000-00000000000b'),  -- B · Cocina de Prueba Sur
  ('c01c0000-0000-4000-8000-00000000000c'),  -- C · Obrador de Prueba Este (sin empresa)
  ('c01d0000-0000-4000-8000-00000000000d'),  -- D · Asesoría de Prueba Oeste (sin hostelería, S01)
  ('c0600000-0000-4000-8000-0000000000d0'),  -- Comercio de Prueba Diez
  -- P01 · los diez clientes de la asesoría de demo (su cuenta entra aquí para
  -- que el carril tenga sus empresas, sus permisos y sus declaraciones; dos
  -- tienen administración, arriba). La asesoría entra por sus perfiles.
  ('d5ac0000-0000-4000-8000-00000000c010'), ('d5ac0000-0000-4000-8000-00000000c020'),
  ('d5ac0000-0000-4000-8000-00000000c030'), ('d5ac0000-0000-4000-8000-00000000c040'),
  ('d5ac0000-0000-4000-8000-00000000c050'), ('d5ac0000-0000-4000-8000-00000000c060'),
  ('d5ac0000-0000-4000-8000-00000000c070'), ('d5ac0000-0000-4000-8000-00000000c080'),
  ('d5ac0000-0000-4000-8000-00000000c090'), ('d5ac0000-0000-4000-8000-00000000c100');
insert into _plantilla_cuentas
  select p.account_id from public.user_profiles p
   where p.user_id in (select id from _plantilla_usuarios) and p.account_id is not null
  on conflict do nothing;

-- Las tablas que entran en juego: las de los esquemas de la aplicación, sin
-- particiones sueltas (se copian por su madre). auth va aparte, y storage,
-- realtime, cron, net… no son de ninguna cuenta.
create temp table _tabla on commit drop as
select c.oid::regclass as tabla, n.nspname as esquema, c.relname as nombre,
       -- La columna de la cuenta: account_id o, si no, la clave ajena a accounts.
       coalesce(
         (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped and a.atttypid = 'uuid'::regtype),
         (select a.attname from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
           where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.accounts'::regclass and array_length(k.conkey, 1) = 1
           order by k.conname limit 1)) as col_cuenta
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and not c.relispartition
   and (n.nspname = 'auth' and c.relname in ('users', 'identities', 'sessions', 'refresh_tokens', 'mfa_factors', 'mfa_challenges', 'mfa_amr_claims', 'one_time_tokens')
        or n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', '_realtime', 'supabase_functions',
                             'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'net', 'cron', 'vault', 'pgsodium',
                             'pgsodium_masks', 'pgbouncer', 'pgmq', '_analytics', 'e2e')
           and n.nspname not like 'pg\_%');

-- Las claves ajenas entre esas tablas, columna a columna (también las de varias columnas).
create temp table _fk on commit drop as
select k.oid, k.conrelid::regclass as hija, k.confrelid::regclass as madre,
       array(select a.attname::text from unnest(k.conkey) with ordinality x(n, o) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.n order by x.o) as cols,
       array(select a.attname::text from unnest(k.confkey) with ordinality x(n, o) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.n order by x.o) as mcols
  from pg_constraint k
 where k.contype = 'f'
   and k.conrelid in (select tabla from _tabla) and k.confrelid in (select tabla from _tabla);

-- Una copia en memoria de cada tabla que tiene filas del juego: _filas_<oid>.
-- Lleva el ctid de la fila de verdad (para no copiarla dos veces y, al borrar,
-- para borrar justo esa) y la vuelta en la que entró (las hijas de cada vuelta
-- se buscan solo entre las filas nuevas de la anterior).
create temp table _copia (tabla regclass primary key, temp text not null, filas bigint not null default 0) on commit drop;

-- Añade a la copia de t las filas que cumplen cond y que aún no estaban. Devuelve cuántas.
-- Si no hay ninguna, ni siquiera crea la copia.
create function pg_temp.anadir(t regclass, cond text, vuelta int default 0) returns bigint language plpgsql as $f$
declare v text := '_filas_' || t::oid; hay boolean; k bigint;
begin
  if not exists (select 1 from _copia where tabla = t) then
    execute format('select exists (select 1 from %s x where %s)', t, cond) into hay;
    if not hay then return 0; end if;
    execute format('create temp table %I on commit drop as select ctid as _ctid, 0 as _vuelta, * from %s where false', v, t);
    execute format('create index on %I (_ctid)', v);
    insert into _copia (tabla, temp) values (t, v);
  end if;
  execute format('insert into %I select ctid, %s, * from %s x where (%s) and not exists (select 1 from %I c where c._ctid = x.ctid)',
                 v, vuelta, t, cond, v);
  get diagnostics k = row_count;
  update _copia set filas = filas + k where tabla = t;
  return k;
end $f$;

-- Hijas: las filas de tablas que cuelgan (clave ajena) de filas ya copiadas,
-- hasta que no aparece ninguna nueva. solo_sin_cuenta: al clonar, una tabla
-- con columna de cuenta ya entró por su cuenta (y solo la de la plantilla);
-- al borrar, entra todo lo que cuelga del carril.
create function pg_temp.hijas(solo_sin_cuenta boolean) returns bigint language plpgsql as $f$
declare f record; nuevas bigint; total bigint := 0; vuelta int := 0; hay boolean;
begin
  loop
    nuevas := 0; vuelta := vuelta + 1;
    for f in
      select fk.*, c.temp from _fk fk join _copia c on c.tabla = fk.madre
       where not solo_sin_cuenta or (select col_cuenta from _tabla where tabla = fk.hija) is null
         and fk.hija <> 'public.accounts'::regclass and fk.hija::text not like 'auth.%'
    loop
      execute format('select exists (select 1 from %I where _vuelta = %s)', f.temp, vuelta - 1) into hay;
      continue when not hay;
      nuevas := nuevas + pg_temp.anadir(f.hija, format('(%s) in (select %s from %I where _vuelta = %s)',
        (select string_agg('x.' || quote_ident(c), ', ') from unnest(f.cols) c),
        (select string_agg(quote_ident(c), ', ') from unnest(f.mcols) c), f.temp, vuelta - 1), vuelta);
    end loop;
    total := total + nuevas;
    exit when nuevas = 0;
    if vuelta > 50 then raise exception 'Carril: las hijas no acaban de salir tras 50 vueltas.'; end if;
  end loop;
  return total;
end $f$;
