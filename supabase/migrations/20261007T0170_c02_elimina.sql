-- supabase/migrations/20261007T0170_c02_elimina.sql
--
-- C02 · ELIMINA supplier.ledger_account_code (respuesta 2, decisión 2). La
-- cuenta de un proveedor vive desde la 0120 en company_account_link (papel
-- principal) y se enseña desde ahí (ficha, tarea 6).
--
-- Va en su PROPIA tanda, después de la fusión del front que ya no la lee, con
-- `autorizo` (borra una columna: el analizador lo para a propósito), como la
-- 0140 del C01b.
--
-- Antes de escribirlo se comprobó que NADIE la nombra (05/10, en el PR):
--   · código: ni src/, ni supabase/functions/, ni scripts/ (el agente de
--     datos maestros dejó de leerla en el mismo commit que este fichero);
--   · base de producción: 0 funciones, 0 vistas y 0 de 56 crons la nombran;
--     0 de 42 proveedores la tienen rellena (tabla entera, todas las cuentas);
--   · edge functions desplegadas en producción: 69 leídas, 0 la nombran
--     (6 con grep; 63 leídas sin script, dicho así en el PR).
--
-- Guardas (si falla una, no se borra nada):
--   1. Ninguna función ni vista de public la nombra.
--   2. Copia: los valores se guardan en c02_columnas_eliminadas antes de
--      borrar, para la vuelta atrás; una fila por proveedor con valor.

do $$
declare v_fun int; v_vis int;
begin
  select count(*) into v_fun from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%ledger_account_code%';
  select count(*) into v_vis from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm') and pg_get_viewdef(c.oid) ilike '%ledger_account_code%';
  if v_fun + v_vis > 0 then
    raise exception 'C02 0170: % funciones y % vistas nombran supplier.ledger_account_code. No se borra nada.', v_fun, v_vis;
  end if;
end $$;

create table public.c02_columnas_eliminadas (
  supplier_id          uuid primary key,
  account_id           uuid not null,
  ledger_account_code  text not null,
  copiado_at           timestamptz not null default now()
);
comment on table public.c02_columnas_eliminadas is
  'C02 · Copia de supplier.ledger_account_code hecha justo antes de eliminarla (0170). Solo para la vuelta atrás. Solo service_role.';
alter table public.c02_columnas_eliminadas enable row level security;
revoke all on public.c02_columnas_eliminadas from anon, authenticated;

insert into public.c02_columnas_eliminadas (supplier_id, account_id, ledger_account_code)
select id, account_id, ledger_account_code from public.supplier where ledger_account_code is not null;

do $$
declare v_con int; v_copia int;
begin
  select count(*) into v_con from public.supplier where ledger_account_code is not null;
  select count(*) into v_copia from public.c02_columnas_eliminadas;
  if v_con <> v_copia then raise exception 'C02 0170: la copia tiene % filas y hay % proveedores con cuenta. No se borra nada.', v_copia, v_con; end if;
  raise notice 'C02 0170: copiados % proveedores con supplier.ledger_account_code.', v_copia;
end $$;

alter table public.supplier drop column ledger_account_code;
