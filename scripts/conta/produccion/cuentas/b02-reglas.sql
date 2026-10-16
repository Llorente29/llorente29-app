-- scripts/conta/produccion/cuentas/b02-reglas.sql
--
-- B02 · LO QUE CUENTA LA TANDA DE LAS REGLAS DE FOODINT (T3, 0210), antes y
-- después. SOLO LEE. Las cuatro reglas por su id (sin su texto): estado, cuenta
-- y confirmaciones; y las reglas encendidas de su empresa. La vuelta atrás
-- tiene que devolver lo mismo que antes.
select clave, valor from (
  select 1 o, 'regla ' || left(r.id::text, 8) clave, r.status || ' → ' || (r.target->>'cuenta') || ' · ' || r.confirmations || ' confirmaciones' valor
    from public.bank_rule r where r.id in ('f2afd853-b93a-43b8-bc1c-fdd5136a0c13', 'a094fd3a-c8e5-4209-a989-52ecb3c862a3',
                                           '11f54405-a466-455d-be9c-6583d9ae58be', '103ccdd6-ce74-4464-ab6a-645e43dff288') union all
  select 2, 'reglas encendidas de su empresa', (select count(*) from public.bank_rule where status = 'activa'
         and company_id = (select company_id from public.bank_rule where id = 'f2afd853-b93a-43b8-bc1c-fdd5136a0c13'))::text union all
  select 3, 'casados por esas reglas', (select count(*) from public.bank_match where rule_id in ('f2afd853-b93a-43b8-bc1c-fdd5136a0c13', 'a094fd3a-c8e5-4209-a989-52ecb3c862a3',
         '11f54405-a466-455d-be9c-6583d9ae58be', '103ccdd6-ce74-4464-ab6a-645e43dff288'))::text
) t order by o, clave;
