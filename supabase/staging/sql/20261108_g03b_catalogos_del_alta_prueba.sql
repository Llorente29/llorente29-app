-- supabase/staging/sql/20261108_g03b_catalogos_del_alta_prueba.sql
--
-- SOLO STAGING, SOLO LEE. G03b (Julio, 08/11): ¿encuentra el alta las
-- actividades de una gestoría en staging? La misma consulta que hace
-- buscarTitulos (altaService.ts) con los términos del grupo «gestoria» de
-- actividades.ts, COMO USUARIO (set local role authenticated, con el sub del
-- administrador de A), para que valga la RLS del front:
--   1. IAE: «financieros y contables» → 1_842; «gestión administrativa» → 1_8497.
--   2. CNAE-2025, clase de cuatro cifras: «teneduría de libros» → 6920.
-- Si falta una, dice si falta la fila del catálogo (vista como postgres) o si
-- es que el usuario no la ve. Todo en una transacción que acaba en ROLLBACK.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G03b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _en_catalogo on commit drop as
select 'iae' cat, code from public.iae_heading where code in ('1_842', '1_8497')
union all
select 'cnae', code from public.cnae_code where version = '2025' and level = 4 and code = '6920';
grant select on _en_catalogo to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare falta text[] := '{}'; r record;
begin
  for r in select * from (values
      ('iae', 'financieros y contables', '1_842'),
      ('iae', 'gestión administrativa', '1_8497'),
      ('cnae', 'teneduría de libros', '6920')) v(cat, termino, codigo)
  loop
    if r.cat = 'iae' and not exists (select 1 from public.iae_heading where title ilike '%' || r.termino || '%'
        and level in ('grupo', 'epigrafe') and section in ('1', '2') and code = r.codigo) then
      falta := falta || format('%s «%s» → %s (%s)', r.cat, r.termino, r.codigo,
        case when exists (select 1 from _en_catalogo c where c.cat = r.cat and c.code = r.codigo) then 'la fila está, pero el usuario no la ve' else 'falta la fila del catálogo' end);
    elsif r.cat = 'cnae' and not exists (select 1 from public.cnae_code where version = '2025' and level = 4 and title ilike '%' || r.termino || '%' and code = r.codigo) then
      falta := falta || format('%s «%s» → %s (%s)', r.cat, r.termino, r.codigo,
        case when exists (select 1 from _en_catalogo c where c.cat = r.cat and c.code = r.codigo) then 'la fila está, pero el usuario no la ve' else 'falta la fila del catálogo' end);
    end if;
  end loop;
  if array_length(falta, 1) > 0 then
    raise exception 'PRUEBA G03b: el alta no encontraría la gestoría: %', array_to_string(falta, '; ');
  end if;
  raise notice 'G03b: como usuario, el alta encuentra 1_842, 1_8497 y 6920 con los términos del grupo «gestoria». OK';
end $$;
reset role;

rollback;
