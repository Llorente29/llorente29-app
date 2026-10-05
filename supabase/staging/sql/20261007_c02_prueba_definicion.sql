-- supabase/staging/sql/20261007_c02_prueba_definicion.sql
--
-- C02 · Prueba de la 0115: las definiciones de la quinta parte están (450 en
-- pymes, 492 en el general, las de serie.json), plain_name no se ha tocado, y
-- toda hoja de pymes tiene texto propio, heredado o del BOE por arriba;
-- vuelta atrás. Termina en ROLLBACK.

begin;

do $$
declare n_p int; n_g int; n_calle int; sin_nada int; v text;
begin
  select count(*) filter (where plan = 'pymes'), count(*) filter (where plan = 'general')
    into n_p, n_g from public.pgc_account where boe_definition is not null and valid_to is null;
  if n_p <> 450 or n_g <> 492 then
    raise exception 'PRUEBA C02 0115: definiciones pymes % (esperaba 450), general % (esperaba 492)', n_p, n_g;
  end if;
  -- plain_name sigue siendo el de en-la-calle.json: 116 filas en serie.json, ninguna igual a la definición.
  select count(*) into n_calle from public.pgc_account where plain_name is not null and valid_to is null;
  if n_calle <> 116 or exists (select 1 from public.pgc_account where plain_name = boe_definition) then
    raise exception 'PRUEBA C02 0115: plain_name ha cambiado (% filas, esperaba 116)', n_calle;
  end if;
  select boe_definition into v from public.pgc_account where plan = 'pymes' and code = '400' and valid_to is null;
  if v is distinct from 'Deudas con suministradores de mercancías y de los demás bienes definidos en el grupo 3.' then
    raise exception 'PRUEBA C02 0115: la 400 dice «%»', v;
  end if;
  -- Toda hoja de pymes: algo propio o de un antepasado (calle o BOE).
  with recursive sube as (
    select h.code as hoja, h.code, h.parent_code, h.plain_name, h.boe_definition
      from public.pgc_account h where h.plan = 'pymes' and h.is_leaf and h.valid_to is null
    union all
    select s.hoja, p.code, p.parent_code, p.plain_name, p.boe_definition
      from sube s join public.pgc_account p on p.plan = 'pymes' and p.code = s.parent_code and p.valid_to is null
  )
  select count(*) into sin_nada from (
    select hoja from sube group by hoja having bool_and(plain_name is null and boe_definition is null)
  ) x;
  if sin_nada <> 0 then raise exception 'PRUEBA C02 0115: % hojas de pymes sin ningún texto', sin_nada; end if;
  raise notice 'PRUEBA C02 0115 · % + % definiciones; las 615 hojas de pymes con texto', n_p, n_g;
end $$;

\ir ../../vuelta-atras/20261007T0115_c02_pgc_definicion.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pgc_account' and column_name = 'boe_definition') then
    raise exception 'PRUEBA C02 0115: la vuelta atrás deja la columna';
  end if;
  raise notice 'PRUEBA C02 0115 · vuelta atrás en verde';
end $$;

rollback;
