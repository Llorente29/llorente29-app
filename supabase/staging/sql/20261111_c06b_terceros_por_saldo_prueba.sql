-- supabase/staging/sql/20261111_c06b_terceros_por_saldo_prueba.sql
--
-- SOLO STAGING. Prueba de «C06b · no compensación en los terceros»
-- (20261111T0600), después de aplicarla. Todo en una transacción con
-- ROLLBACK: no cambia staging.
--
--   1. Cada prefijo de tercero (40x, 41, 43x, 44) tiene en la serie
--      exactamente dos filas por modelo, una deudora y otra acreedora, una en
--      el activo y otra en el pasivo: 14 por modelo, 42 en total.
--   2. No queda ninguna fila de serie de esos prefijos sin signo.
--   3. La vuelta atrás, dentro de la transacción, deja la serie como la C05
--      (cero filas por signo en esos prefijos) y se puede volver a aplicar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b terceros por saldo: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table terceros(prefijo text) on commit drop;
insert into terceros values ('400'), ('401'), ('403'), ('404'), ('405'), ('41'), ('430'), ('431'), ('432'), ('433'), ('434'), ('435'), ('436'), ('44');

do $$
declare n int; malos int;
begin
  select count(*) into n from public.annual_accounts_mapping m join terceros t on t.prefijo = m.account_prefix
   where m.company_id is null and m.statement = 'balance' and m.by_balance is not null;
  if n <> 84 then raise exception '1: esperaba 84 filas por signo (42 de cada lado) y hay %.', n; end if;
  select count(*) into malos from (
    select m.model, m.account_prefix
      from public.annual_accounts_mapping m join terceros t on t.prefijo = m.account_prefix
      join public.annual_accounts_line l on l.model = m.model and l.statement = m.statement and l.code = m.line_code
     where m.company_id is null and m.statement = 'balance' and m.by_balance is not null
     group by 1, 2
    having count(*) <> 2 or count(*) filter (where m.by_balance = 'deudor' and l.side = 'activo') <> 1
        or count(*) filter (where m.by_balance = 'acreedor' and l.side = 'pn_pasivo') <> 1) x;
  if malos <> 0 then raise exception '1: % prefijos no tienen su deudora en el activo y su acreedora en el pasivo.', malos; end if;
  select count(*) into n from public.annual_accounts_mapping m join terceros t on t.prefijo = m.account_prefix
   where m.company_id is null and m.statement = 'balance' and m.by_balance is null;
  if n <> 0 then raise exception '2: quedan % filas de serie de terceros sin signo.', n; end if;
  raise notice '1 y 2 OK: los 14 prefijos de terceros, en los tres modelos, con su deudora en el activo y su acreedora en el pasivo.';
end $$;

\ir ../../vuelta-atras/20261111T0600_c06b_terceros_por_saldo.down.sql

do $$
declare n int;
begin
  select count(*) into n from public.annual_accounts_mapping m join terceros t on t.prefijo = m.account_prefix
   where m.company_id is null and m.statement = 'balance' and m.by_balance is not null;
  if n <> 0 then raise exception '3: después de la vuelta atrás quedan % filas por signo.', n; end if;
  select count(*) into n from public.annual_accounts_mapping m join terceros t on t.prefijo = m.account_prefix
   where m.company_id is null and m.statement = 'balance';
  if n <> 42 then raise exception '3: después de la vuelta atrás esperaba las 42 filas de la C05 y hay %.', n; end if;
  raise notice '3 OK: la vuelta atrás deja las 42 filas de la C05, sin signo.';
end $$;

rollback;
