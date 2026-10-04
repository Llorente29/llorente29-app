-- ============================================================================
-- scripts/conta/crear-usuario-lectura.sql
-- USUARIO DE SOLO LECTURA PARA LOS AGENTES DE CUMPLIMIENTO EN PRODUCCIÓN
-- ----------------------------------------------------------------------------
-- C00, respuestas 6 y 7. LO EJECUTA JULIO, en producción (editor SQL de
-- Supabase). Claude Code no lanza nada contra producción.
--
-- Crea el rol `conta_lectura`: puede entrar, solo lee, y solo las tablas que
-- leen los agentes (scripts/conta/agente-datos-maestros.sql). Nada más:
--   · SELECT sobre esa lista, y ningún otro permiso (ni insert, ni update, ni
--     delete, ni ejecutar funciones propias);
--   · toda sesión suya es de solo lectura (default_transaction_read_only);
--   · ve todas las cuentas (BYPASSRLS): el agente revisa filas de serie y la
--     coherencia de cada empresa, y cada fila del informe lleva su account_id
--     (regla 9). Sin esto, la RLS le escondería todo y el informe diría «todo
--     cuadra» sin haber mirado nada.
--   · consultas de 60 s como mucho y 5 conexiones.
--
-- SIN CONTRASEÑA AQUÍ. Después de ejecutarlo, Julio le pone la suya con:
--
--     alter role conta_lectura password '<la que elija Julio>';
--
-- y crea el secreto PROD_CONTA_RO_DB_URL con la cadena del Session pooler,
-- cambiando el usuario por `conta_lectura.xzmpnchlguibclvxyynt` (el pooler
-- de Supabase pide el usuario con el ref del proyecto detrás).
--
-- SE PUEDE EJECUTAR MÁS DE UNA VEZ. Las tablas del C00 (company, tax_rate…) no
-- existen en producción hasta que entren las migraciones: la primera vez dice
-- cuáles faltan y no les da permiso; después de las migraciones se vuelve a
-- ejecutar y ya las tiene todas. Al final dice qué tiene y qué falta.
--
-- Sin begin/commit: el editor de Supabase va sentencia a sentencia.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    create role conta_lectura login bypassrls connection limit 5;
    raise notice 'Creado el rol conta_lectura (sin contraseña: ponla con alter role … password).';
  else
    alter role conta_lectura login bypassrls connection limit 5;
    raise notice 'El rol conta_lectura ya existía: se dejan sus atributos como deben estar.';
  end if;
end $$;

alter role conta_lectura set default_transaction_read_only = on;
alter role conta_lectura set statement_timeout = '60s';

grant usage on schema public to conta_lectura;

-- Solo lo que leen los agentes. Si una tabla no existe aún, se dice y se sigue.
do $$
declare
  t text;
  tablas constant text[] := array[
    -- Filas de serie y catálogos (C00).
    'tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text', 'expense_category',
    'vat_scheme', 'tax_form', 'legal_form', 'vat_category_tax', 'country', 'currency', 'iae_heading', 'cnae_code',
    -- Coherencia de cada empresa (C00).
    'company', 'company_tax_profile', 'company_activity', 'company_person', 'fiscal_year',
    -- Lo que ya existe y el agente cruza: categorías de IVA de Cocina y plazos/cuentas de proveedor.
    'vat_category', 'supplier'];
  faltan text := '';
begin
  foreach t in array tablas loop
    if to_regclass('public.' || t) is null then
      faltan := faltan || ' ' || t;
    else
      execute format('grant select on table public.%I to conta_lectura', t);
    end if;
  end loop;
  if faltan <> '' then
    raise notice 'Aún no existen (vuelve a ejecutar esto después de las migraciones):%', faltan;
  else
    raise notice 'conta_lectura puede leer las 21 tablas de los agentes, y nada más.';
  end if;
end $$;

-- Lo que tiene, para pegarlo en el parte: debe salir SOLO «SELECT» y solo en esas tablas.
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as permisos
  from information_schema.role_table_grants
 where grantee = 'conta_lectura'
 group by table_name
 order by table_name;
