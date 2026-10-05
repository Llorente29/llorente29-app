-- supabase/staging/sql/20261007_c02_prueba_elimina.sql
--
-- C02 · Prueba de la 0170 en staging-conta: la columna ya no está, la copia sí,
-- y la vuelta atrás la devuelve igual (tipo, nulos y valores). Termina en ROLLBACK.

begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'ledger_account_code') then
    raise exception 'PRUEBA C02 0170: supplier.ledger_account_code sigue ahí';
  end if;
  if to_regclass('public.c02_columnas_eliminadas') is null then raise exception 'PRUEBA C02 0170: no está la copia'; end if;
  raise notice 'PRUEBA C02 0170 · aplicada: columna fuera, copia dentro (% filas)', (select count(*) from public.c02_columnas_eliminadas);
end $$;

\echo '>>> Vuelta atrás de la 0170'
\ir ../../vuelta-atras/20261007T0170_c02_elimina.down.sql
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier'
                  and column_name = 'ledger_account_code' and data_type = 'text' and is_nullable = 'YES' and column_default is null) then
    raise exception 'PRUEBA C02 0170: la vuelta atrás no la devuelve como era (text, nulos, sin defecto)';
  end if;
  if to_regclass('public.c02_columnas_eliminadas') is not null then raise exception 'PRUEBA C02 0170: la vuelta atrás no quita la copia'; end if;
  raise notice 'PRUEBA C02 0170 · vuelta atrás en verde';
end $$;

rollback;
