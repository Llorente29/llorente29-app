-- ============================================================================
-- scripts/e2e/carril/clonar.sql — copia la plantilla de prueba en el carril N.
-- SOLO STAGING. Va detrás de comun.sql, en la misma transacción:
--
--   psql -1 -c "select set_config('e2e.carril','7',true), set_config('e2e.clave',…,true)" \
--        -f comun.sql -f clonar.sql
--
-- (lo hace scripts/e2e/carril.sh clonar). Lo que hace, en este orden:
--   1. Lee la plantilla en UNA foto (REPEATABLE READ: lo que otra e2e esté
--      cambiando a la vez no entra a medias): las cuentas, todo lo que tiene su
--      columna de cuenta, lo que cuelga de ello, los siete usuarios y sus
--      identidades, y quién es administrador de plataforma.
--   2. Calcula el id nuevo de cada fila (comun.sql: el segundo grupo = N).
--   3. Inserta la copia con todo cambiado: los uuid, las listas de uuid, los
--      uuid y los correos que van dentro de textos y json, y lo que tiene que
--      ser único en toda la base (un token, una clave de importación) con «-cN».
--   4. Comprueba que no ha quedado ninguna clave ajena colgando: sin
--      disparadores no las mira la base, así que las mira esto, una a una.
--   5. Pone a los siete usuarios del carril la contraseña de un solo uso.
--
-- Si el carril ya tiene datos, para: primero se borra (borrar.sql).
-- ============================================================================

-- Un texto (o un json hecho texto) del carril: cada uuid que es de la
-- plantilla, por el suyo del carril; cada correo de la plantilla, por el suyo.
-- Lo demás, tal cual (un uuid que no es de la plantilla es de otra cosa).
create function pg_temp.mt(t text) returns text language plpgsql stable as $f$
declare r text := t; m text; nuevo uuid; e record;
begin
  if t is null then return null; end if;
  if t ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
    for m in select distinct (regexp_matches(t, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', 'g'))[1] loop
      select k.nuevo into nuevo from _k k where k.viejo = lower(m)::uuid;
      if nuevo is not null then r := replace(r, m, nuevo::text); end if;
    end loop;
  end if;
  if position('@' in r) > 0 then
    for e in select * from _correo loop r := replace(r, e.viejo, e.nuevo); end loop;
  end if;
  return r;
end $f$;

create temp table _informe (tabla text, filas bigint) on commit drop;

do $$
declare
  n int := current_setting('e2e.carril')::int;
  f record; c record; t record; cp record;
  cols text; exprs text; v text; k bigint; colgando bigint;
  sobrescribe boolean;
begin
  if exists (select 1 from public.accounts where id = pg_temp.en_carril('c01a0000-0000-4000-8000-00000000000a', n)) then
    raise exception 'Carril %: ya tiene datos. Antes, borrar.sql.', n;
  end if;
  if (select count(*) from auth.users where id in (select id from _plantilla_usuarios)) <> 7 then
    raise exception 'Carril %: faltan usuarios de la plantilla (hay % de 7). ¿Están las semillas C00, C01 y C06?', n,
      (select count(*) from auth.users where id in (select id from _plantilla_usuarios));
  end if;

  -- 1 · La foto de la plantilla ----------------------------------------------
  perform pg_temp.anadir('public.accounts', 'x.id in (select id from _plantilla_cuentas)');
  for t in select * from _tabla where col_cuenta is not null and tabla <> 'public.accounts'::regclass loop
    -- Lo que es de UN usuario (su perfil, su user_id): solo de los siete de la
    -- plantilla. No entran los dobles por frente ni el acceso de Julio a la A.
    v := null;
    select string_agg(format('(x.%I is null or x.%I in (select id from _plantilla_usuarios))', a.attname, a.attname), ' and ')
      into v
      from pg_constraint fk join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = fk.conkey[1]
     where fk.conrelid = t.tabla and fk.contype = 'f' and fk.confrelid = 'auth.users'::regclass and array_length(fk.conkey, 1) = 1
       and (a.attname = 'user_id'
            or exists (select 1 from pg_index i where i.indrelid = t.tabla and i.indisunique and i.indnatts = 1 and i.indkey[0] = a.attnum));
    perform pg_temp.anadir(t.tabla, format('x.%I in (select id from _plantilla_cuentas)%s', t.col_cuenta, coalesce(' and ' || v, '')));
  end loop;
  perform pg_temp.anadir('auth.users', 'x.id in (select id from _plantilla_usuarios)');
  perform pg_temp.anadir('auth.identities', 'x.user_id in (select id from _plantilla_usuarios)');
  -- Lo que es de un usuario sin ser de ninguna cuenta (quién administra la plataforma).
  for f in
    select fk.hija, fk.cols[1] as col from _fk fk join _tabla tb on tb.tabla = fk.hija
     where fk.madre = 'auth.users'::regclass and array_length(fk.cols, 1) = 1 and tb.col_cuenta is null
       and tb.esquema <> 'auth' and fk.hija <> 'public.accounts'::regclass
       and exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                    where i.indrelid = fk.hija and i.indisunique and i.indnatts = 1 and a.attname = fk.cols[1])
  loop
    perform pg_temp.anadir(f.hija, format('x.%I in (select id from _plantilla_usuarios)', f.col));
  end loop;
  perform pg_temp.hijas(true);

  -- 2 · Los ids nuevos ------------------------------------------------------------
  -- Cada fila con clave primaria de UNA columna uuid tiene id propio: ése cambia.
  -- (Una clave de varias columnas está hecha de ids de otras filas: cambian por ellas.)
  create temp table _k (viejo uuid primary key, nuevo uuid not null) on commit drop;
  insert into _k select id, pg_temp.en_carril(id, n) from _plantilla_cuentas;
  insert into _k select id, pg_temp.en_carril(id, n) from _plantilla_usuarios on conflict do nothing;
  for c in
    select cx.tabla, cx.temp, a.attname from _copia cx
      join pg_index i on i.indrelid = cx.tabla and i.indisprimary and i.indnatts = 1
      join pg_attribute a on a.attrelid = cx.tabla and a.attnum = i.indkey[0] and a.atttypid = 'uuid'::regtype
  loop
    execute format('insert into _k select %I, pg_temp.en_carril(%I, %s) from %I where %I is not null on conflict do nothing', c.attname, c.attname, n, c.temp, c.attname);
  end loop;
  create temp table _correo (viejo text primary key, nuevo text not null) on commit drop;
  insert into _correo select lower(u.email), pg_temp.correo_en_carril(lower(u.email), n)
    from auth.users u where u.id in (select id from _plantilla_usuarios) and u.email is not null;

  -- Una clave de número nuevo (bigserial) a la que apunta otra fila copiada
  -- quedaría apuntando a la de la plantilla: eso no se copia a ciegas.
  for f in
    select fk.* from _fk fk join _copia h on h.tabla = fk.hija join _copia m on m.tabla = fk.madre
     where exists (select 1 from pg_attribute a join pg_index i on i.indrelid = a.attrelid and i.indisprimary and i.indnatts = 1 and i.indkey[0] = a.attnum
                    where a.attrelid = fk.madre and a.attname = fk.mcols[1] and a.atttypid <> 'uuid'::regtype)
  loop
    raise exception 'Carril %: % apunta a % por una clave que no es uuid (%): el clon no sabe cambiarla.', n, f.hija, f.madre, array_to_string(f.mcols, ',');
  end loop;

  -- Lo que tiene que ser único en TODA la base y no lleva ningún uuid (un token,
  -- una clave de importación, una ruta): su última columna de texto lleva «-cN»
  -- detrás. En un índice de expresión (lower(col)), esa col.
  -- Un índice parcial (where company_id is null) solo obliga a las filas que
  -- cumplen su condición: a las demás no se les toca nada.
  create temp table _unico (tabla regclass, col name, cuando text, primary key (tabla, col)) on commit drop;
  for f in
    select i.indexrelid, i.indrelid, i.indkey, coalesce(pg_get_expr(i.indpred, i.indrelid), 'true') as cuando from pg_index i join _copia cx on cx.tabla = i.indrelid
     where i.indisunique and not i.indisprimary and cx.tabla::text not like 'auth.%'
       and not exists (select 1 from unnest(i.indkey) x join pg_attribute b on b.attrelid = i.indrelid and b.attnum = x where b.atttypid = 'uuid'::regtype)
  loop
    insert into _unico
      select f.indrelid, b.attname, f.cuando from unnest(f.indkey) with ordinality x(num, o) join pg_attribute b on b.attrelid = f.indrelid and b.attnum = x.num
       where b.atttypid in ('text'::regtype, 'varchar'::regtype) order by x.o desc limit 1
      on conflict do nothing;
    insert into _unico
      select f.indrelid, (regexp_matches(pg_get_indexdef(f.indexrelid), 'lower\(([a-z_0-9]+)\)', 'g'))[1]::name, f.cuando
      on conflict do nothing;
  end loop;

  -- 3 · La copia, con todo cambiado ---------------------------------------------
  for cp in select * from _copia order by tabla::text loop
    cols := ''; exprs := ''; sobrescribe := false;
    for c in
      select a.attname, a.atttypid, a.attidentity, a.attgenerated,
             -- La clave primaria de una columna que no es uuid y tiene valor por
             -- defecto (bigserial, identity): número nuevo.
             (exists (select 1 from pg_index i where i.indrelid = cp.tabla and i.indisprimary and i.indnatts = 1 and i.indkey[0] = a.attnum)
              and a.atttypid <> 'uuid'::regtype
              and (a.attidentity <> '' or exists (select 1 from pg_attrdef d where d.adrelid = cp.tabla and d.adnum = a.attnum))) as numero_nuevo,
             (select string_agg('(' || u.cuando || ')', ' or ') from _unico u where u.tabla = cp.tabla and u.col = a.attname) as unico
        from pg_attribute a
       where a.attrelid = cp.tabla and a.attnum > 0 and not a.attisdropped
       order by a.attnum
    loop
      continue when c.attgenerated <> '' or c.numero_nuevo;
      if c.attidentity = 'a' then sobrescribe := true; end if;
      cols := cols || ', ' || quote_ident(c.attname);
      v := 'x.' || quote_ident(c.attname);
      v := case
        when c.atttypid = 'uuid'::regtype then format('coalesce((select nuevo from _k where viejo = %s), %s)', v, v)
        when c.atttypid = 'uuid[]'::regtype then format('(select array_agg(coalesce((select nuevo from _k where viejo = e), e) order by o) from unnest(%s) with ordinality u(e, o))', v)
        when c.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype) then format('pg_temp.mt(%s)', v)
        when c.atttypid = 'jsonb'::regtype then format('pg_temp.mt(%s::text)::jsonb', v)
        when c.atttypid = 'json'::regtype then format('pg_temp.mt(%s::text)::json', v)
        when c.atttypid = 'text[]'::regtype then format('(select array_agg(pg_temp.mt(e) order by o) from unnest(%s) with ordinality u(e, o))', v)
        else v end;
      if c.unico is not null then v := format('case when %s is null or not (%s) then %s else %s || %L end', v, c.unico, v, v, '-c' || n); end if;
      -- Un usuario del carril nace sin enlaces pendientes: los tokens de
      -- confirmar, recuperar o cambiar el correo son únicos y no son suyos.
      if cp.tabla = 'auth.users'::regclass and c.attname::text like '%token%' and c.atttypid in ('text'::regtype, 'varchar'::regtype) then
        v := quote_literal('');
      end if;
      exprs := exprs || ', ' || v;
    end loop;
    execute format('insert into %s (%s) %s select %s from %I x', cp.tabla, substr(cols, 3),
                   case when sobrescribe then 'overriding system value' else '' end, substr(exprs, 3), cp.temp);
    get diagnostics k = row_count;
    insert into _informe values (cp.tabla::text, k);
  end loop;

  -- 4 · Las claves ajenas, una a una -------------------------------------------
  -- Sin disparadores la base no las ha mirado: si el clon se dejó una madre
  -- fuera (o la cambió de id sin copiarla), aquí sale y no se da por bueno.
  for f in select fk.*, cx.temp from _fk fk join _copia cx on cx.tabla = fk.hija loop
    execute format('select count(*) from %I h where %s and not exists (select 1 from %s m where %s)',
      f.temp,
      (select string_agg(format('h.%I is not null', x), ' and ') from unnest(f.cols) x),
      f.madre,
      (select string_agg(case when (select atttypid from pg_attribute where attrelid = f.hija and attname = f.cols[i]) = 'uuid'::regtype
                              then format('m.%I = coalesce((select nuevo from _k where viejo = h.%I), h.%I)', f.mcols[i], f.cols[i], f.cols[i])
                              else format('m.%I = h.%I', f.mcols[i], f.cols[i]) end, ' and ')
         from generate_subscripts(f.cols, 1) i))
      into colgando;
    if colgando > 0 then
      raise exception 'Carril %: % filas de % apuntan (%) a % que no existe. El clon está incompleto.', n, colgando, f.hija, array_to_string(f.cols, ','), f.madre;
    end if;
  end loop;

  -- 5 · La contraseña de un solo uso -------------------------------------------
  if coalesce(current_setting('e2e.clave', true), '') <> '' then
    update auth.users set encrypted_password = extensions.crypt(current_setting('e2e.clave'), extensions.gen_salt('bf'))
     where id in (select pg_temp.en_carril(id, n) from _plantilla_usuarios);
    get diagnostics k = row_count;
    if k <> 7 then raise exception 'Carril %: esperaba poner la contraseña a 7 usuarios y han sido %.', n, k; end if;
  end if;
end $$;
