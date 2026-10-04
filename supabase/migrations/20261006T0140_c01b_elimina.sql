-- supabase/migrations/20261006T0140_c01b_elimina.sql
--
-- C01b, tarea 6 · ELIMINA las columnas viejas del proveedor: supplier.email,
-- supplier.phone, supplier.address y supplier.usual_vat_rates. notify_group se
-- queda (respuesta 1, decisión 2).
--
-- Va en su PROPIA tanda, después de la de datos (0100–0130) y de la fusión
-- del front, con `autorizo` (borra columnas: el analizador lo para a
-- propósito), como la 0200 del R02.
--
-- Antes de escribirlo se comprobó que NADIE las nombra (informe en el PR):
--   · código: ni src/ ni supabase/functions/ las leen ni escriben;
--   · base: los únicos lectores (compliance_docs_due y migrate_kitchen_core)
--     leen del contacto desde la 0120 — guarda 1, por su md5;
--   · edge functions desplegadas: ninguna las nombra (búsqueda en lo
--     desplegado, en el PR).
--
-- Guardas (si falla una, no se borra nada):
--   1. compliance_docs_due y migrate_kitchen_core son las de la 0120.
--   2. ANTES = DESPUÉS: todo email, teléfono y dirección viejos están en su
--      sitio nuevo, y todo IVA viejo tiene su referencia (la misma consulta que
--      scripts/conta/c01b_antes_despues.sql, aquí dentro).
--   3. Copia: los valores se guardan en c01b_columnas_eliminadas antes de
--      borrar, para la vuelta atrás. La copia tiene que tener una fila por cada
--      proveedor con algo en esas columnas.

do $$
declare
  v_cdd text; v_mkc text; v_faltan int;
begin
  select md5(pg_get_functiondef(p.oid)) into v_cdd from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compliance_docs_due';
  select md5(pg_get_functiondef(p.oid)) into v_mkc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'migrate_kitchen_core';
  if v_cdd is distinct from '7a8c769e98ca4ad6107d48ebde39d63a' or v_mkc is distinct from 'ab2746d61c0de5253db2916a20d24e28' then
    raise exception 'C01b 0140: los lectores no son los de la 0120 (compliance_docs_due %, migrate_kitchen_core %). No se borra nada.', v_cdd, v_mkc;
  end if;

  select count(*) into v_faltan from public.supplier s
   where (nullif(btrim(s.email), '') is not null and not exists (
            select 1 from public.supplier_contact c where c.supplier_id = s.id and lower(btrim(c.email)) = lower(btrim(s.email))))
      or (nullif(btrim(s.phone), '') is not null and not exists (
            select 1 from public.supplier_contact c where c.supplier_id = s.id and btrim(c.phone) = btrim(s.phone)))
      or (nullif(btrim(s.address), '') is not null and nullif(btrim(s.fiscal_street), '') is null and not exists (
            select 1 from public.supplier_proposal p where p.supplier_id = s.id and p.field = 'fiscal_address'))
      or (cardinality(coalesce(s.usual_vat_rates, '{}')) > cardinality(coalesce(s.usual_tax_rate_ids, '{}')));
  if v_faltan > 0 then
    raise exception 'C01b 0140: antes = después NO cuadra en % proveedores. No se borra nada.', v_faltan;
  end if;
end $$;

create table public.c01b_columnas_eliminadas (
  supplier_id     uuid primary key,
  account_id      uuid not null,
  email           text,
  phone           text,
  address         text,
  usual_vat_rates numeric[],
  copiado_at      timestamptz not null default now()
);
comment on table public.c01b_columnas_eliminadas is
  'C01b · Copia de supplier.email, phone, address y usual_vat_rates hecha justo antes de eliminarlas (0140). Solo para la vuelta atrás. Solo service_role.';
alter table public.c01b_columnas_eliminadas enable row level security;
revoke all on public.c01b_columnas_eliminadas from anon, authenticated;

insert into public.c01b_columnas_eliminadas (supplier_id, account_id, email, phone, address, usual_vat_rates)
select id, account_id, email, phone, address, usual_vat_rates
  from public.supplier
 where email is not null or phone is not null or address is not null or cardinality(coalesce(usual_vat_rates, '{}')) > 0;

do $$
declare v_con int; v_copia int;
begin
  select count(*) into v_con from public.supplier
   where email is not null or phone is not null or address is not null or cardinality(coalesce(usual_vat_rates, '{}')) > 0;
  select count(*) into v_copia from public.c01b_columnas_eliminadas;
  if v_con <> v_copia then raise exception 'C01b 0140: la copia tiene % filas y hay % proveedores con datos. No se borra nada.', v_copia, v_con; end if;
  raise notice 'C01b 0140: copiados % proveedores con datos en las columnas viejas.', v_copia;
end $$;

alter table public.supplier
  drop column email,
  drop column phone,
  drop column address,
  drop column usual_vat_rates;
