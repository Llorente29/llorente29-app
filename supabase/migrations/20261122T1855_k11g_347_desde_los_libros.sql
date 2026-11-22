-- supabase/migrations/20261122T1855_k11g_347_desde_los_libros.sql
--
-- K11g · El 347 entero, compras y ventas, desde los libros de IVA (Julio, 22/11: «calcula el 347 entero, compras y
-- ventas, desde los libros de recibidas y expedidas, y salta lo marcado»; antes del 31/01: el de 2026 se presenta en
-- febrero). Solo AÑADE: conta_347_desde_los_libros(empresa, año). El de ventas por cliente de antes
-- (conta_347_ventas_por_cliente) no cambia.
--
-- La norma (docs/conta/fuentes/textos/rd-1065-2007.txt):
--   · art. 33.1: cada tercero con quien las operaciones del año pasan de 3.005,06 €, desglosado por trimestres, y las
--     entregas (clave B, ventas: libro de expedidas) separadas de las adquisiciones (clave A, compras: libro de
--     recibidas y de bienes de inversión);
--   · art. 34.2.a: el importe total, con el IVA (vat_book_entry.total). Las rectificativas y los abonos restan;
--   · art. 33.2.a: fuera lo que no lleva identificado al destinatario (sin NIF: los tickets, el día del TPV);
--   · art. 33.2.g e i: fuera las importaciones y exportaciones y lo que se declara en el 349 (intracomunitarias:
--     clave 09 o contraparte de fuera de España);
--   · y fuera lo MARCADO: la recibida con «No incluir en modelo 347» (supplier_invoice.exclude_from_347, K11a) y el
--     cliente con «No incluir en el 347» en su ficha (customer_fiscal.exclude_347, C03).
-- El trimestre: el de la fecha de expedición en las ventas y el de la de recepción (la fiscal, K11f1) en las compras.
-- Lo que no hace todavía (lo dice «aparte»): separar los arrendamientos de local (art. 34.1.d) y el metálico de más de
-- 6.000 € (art. 34.1.h); se cuentan en el total, sin desglose.
--
-- Nada en el camino del pedido. Vuelta atrás: quita la función.

create or replace function public.conta_347_desde_los_libros(p_company uuid, p_anio integer)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_acc uuid; v_r jsonb; v_fuera jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if p_anio is null or p_anio < 2000 or p_anio > extract(year from now())::int + 1 then
    raise exception 'El ejercicio «%» no es un año que se pueda mirar.', p_anio using errcode = '22023';
  end if;

  with l as (
    select v.*,
           case when v.book = 'issued' then 'B' else 'A' end as clave,
           case when v.book = 'issued' then v.issue_date else coalesce(v.received_date, v.issue_date) end as dia,
           upper(nullif(btrim(coalesce(v.counterpart_tax_id, '')), '')) as nif,
           case
             when nullif(btrim(coalesce(v.counterpart_tax_id, '')), '') is null then 'sin_nif'
             when v.operation_key = '09' or coalesce(v.counterpart_country, 'ES') <> 'ES' then 'fuera_de_espana'
             when v.book in ('received', 'investment') and exists (
                    select 1 from public.supplier_invoice si
                     where v.source_type = 'supplier_invoice' and si.id = v.source_id and si.account_id = v.account_id and si.exclude_from_347) then 'marcada'
             when v.book = 'issued' and v.party_id is not null and exists (
                    select 1 from public.customer_fiscal cf where cf.party_id = v.party_id and cf.account_id = v.account_id and cf.exclude_347) then 'cliente_marcado'
             end as fuera
      from public.vat_book_entry v
     where v.account_id = v_acc and v.company_id = p_company and v.voided_at is null
       and v.book in ('issued', 'received', 'investment')
  ), a as (
    select * from l where extract(year from dia) = p_anio
  ), t as (
    select clave, nif, max(counterpart_name) as nombre, count(*) as facturas, round(sum(total), 2) as total,
           round(coalesce(sum(total) filter (where extract(quarter from dia) = 1), 0), 2) as t1,
           round(coalesce(sum(total) filter (where extract(quarter from dia) = 2), 0), 2) as t2,
           round(coalesce(sum(total) filter (where extract(quarter from dia) = 3), 0), 2) as t3,
           round(coalesce(sum(total) filter (where extract(quarter from dia) = 4), 0), 2) as t4
      from a where fuera is null group by clave, nif
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'nif', nif, 'nombre', nombre, 'facturas', facturas, 'total', total,
                                                       't1', t1, 't2', t2, 't3', t3, 't4', t4) order by clave, total desc, nif), '[]')
            from t where abs(total) > 3005.06),
         (select coalesce(jsonb_object_agg(fuera, n), '{}') from (select fuera, count(*) n from a where fuera is not null group by fuera) q)
    into v_r, v_fuera;

  return jsonb_build_object('empresa', p_company, 'anio', p_anio, 'limite', 3005.06, 'terceros', v_r, 'fuera', v_fuera,
                            'aparte', jsonb_build_array('arrendamientos de local (art. 34.1.d)', 'metálico de más de 6.000 € (art. 34.1.h)'));
end $function$;
comment on function public.conta_347_desde_los_libros(uuid, integer) is
  'K11g · El 347 del año desde los libros de IVA: por tercero (NIF) y clave (A compras, B ventas), el total con IVA y por trimestres, de más de 3.005,06 €. Fuera: sin NIF, intracomunitarias o de fuera de España, y lo marcado («No incluir en modelo 347» de la recibida o del cliente). «fuera»: cuántos apuntes salta y por qué.';
revoke all on function public.conta_347_desde_los_libros(uuid, integer) from public, anon;
grant execute on function public.conta_347_desde_los_libros(uuid, integer) to authenticated, service_role;
