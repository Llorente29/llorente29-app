-- ============================================================================
-- scripts/e2e/carril/borrar.sql — borra TODO lo del carril N. SOLO STAGING.
-- Va detrás de comun.sql, en la misma transacción (scripts/e2e/carril.sh borrar).
-- ----------------------------------------------------------------------------
-- Qué es «del carril»: sus cuentas (las de la plantilla con el id del carril,
-- más las que hayan creado sus usuarios durante la prueba: el recorrido del
-- C06 da de alta cuentas nuevas), sus siete usuarios, y todo lo que cuelga de
-- ellos por clave ajena, hasta el final. Se borra sin disparadores (como se
-- copió): un asiento validado del carril también se va.
--
-- Guardas, antes de borrar una sola fila:
--   · ninguna cuenta a borrar es de la plantilla, de Foodint o de Folvy Interno;
--   · ninguna fila con columna de cuenta es de una cuenta que no sea del carril
--     (si algo de fuera colgara del carril, se para y se dice, no se borra);
--   · nada de la plantilla entra (sus ids no tienen el número del carril).
-- Sin datos del carril, no hace nada y lo dice.
-- ============================================================================

create temp table _informe (tabla text, filas bigint) on commit drop;

do $$
declare
  n int := current_setting('e2e.carril')::int;
  f record; k bigint; total bigint := 0; fuera bigint;
begin
  create temp table _carril_usuarios on commit drop as
    select pg_temp.en_carril(id, n) as id from _plantilla_usuarios;
  create temp table _carril_cuentas (id uuid primary key) on commit drop;
  insert into _carril_cuentas select pg_temp.en_carril(id, n) from _plantilla_cuentas;
  -- Lo que dieron de alta sus usuarios, y las cuentas de sus perfiles.
  insert into _carril_cuentas select a.id from public.accounts a where a.created_by in (select id from _carril_usuarios) on conflict do nothing;
  insert into _carril_cuentas select p.account_id from public.user_profiles p
   where p.user_id in (select id from _carril_usuarios) and p.account_id is not null on conflict do nothing;

  if exists (select 1 from _carril_cuentas where id in (select id from _plantilla_cuentas)
             or id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Carril %: entre lo que borraría hay una cuenta de la plantilla o de producción. No se borra nada.', n;
  end if;

  perform pg_temp.anadir('public.accounts', 'x.id in (select id from _carril_cuentas)');
  perform pg_temp.anadir('auth.users', 'x.id in (select id from _carril_usuarios)');
  for f in select * from _tabla where col_cuenta is not null and tabla <> 'public.accounts'::regclass loop
    perform pg_temp.anadir(f.tabla, format('x.%I in (select id from _carril_cuentas)', f.col_cuenta));
  end loop;
  perform pg_temp.hijas(false);

  if not exists (select 1 from _copia) then
    insert into _informe values ('(el carril estaba vacío)', 0);
    return;
  end if;

  -- Nada de fuera: una fila con columna de cuenta que no es del carril, o una
  -- fila con un id de la plantilla, no se borra aquí.
  for f in select c.*, t.col_cuenta from _copia c join _tabla t on t.tabla = c.tabla where t.col_cuenta is not null and c.tabla <> 'public.accounts'::regclass loop
    execute format('select count(*) from %I where %I is not null and %I not in (select id from _carril_cuentas)', f.temp, f.col_cuenta, f.col_cuenta) into fuera;
    if fuera > 0 then
      raise exception 'Carril %: % filas de % cuelgan del carril pero son de otra cuenta. No se borra nada.', n, fuera, f.tabla;
    end if;
  end loop;
  if exists (select 1 from _copia where tabla = 'auth.users'::regclass)
     and (select count(*) from auth.users where id in (select id from _plantilla_usuarios)) <> 7 then
    raise exception 'Carril %: la plantilla no está entera antes de borrar. No se borra nada.', n;
  end if;

  for f in select * from _copia loop
    execute format('delete from %s x where x.ctid in (select _ctid from %I)', f.tabla, f.temp);
    get diagnostics k = row_count;
    total := total + k;
    insert into _informe values (f.tabla::text, k);
  end loop;
  if total > 400000 then
    raise exception 'Carril %: iba a borrar % filas, más de lo que puede ser un carril. No se borra nada.', n, total;
  end if;
  if (select count(*) from auth.users where id in (select id from _plantilla_usuarios)) <> 7 then
    raise exception 'Carril %: después de borrar falta algún usuario de la plantilla. Se deshace.', n;
  end if;
end $$;
