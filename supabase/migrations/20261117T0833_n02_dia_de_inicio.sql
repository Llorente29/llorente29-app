-- supabase/migrations/20261117T0833_n02_dia_de_inicio.sql
--
-- N02 · Lo que traiga una carga queda marcado con ella, y el día en que la
-- empresa empezó en Sumied, de una sola forma (encargo N02, 17/11).
--
-- Solo AÑADE: tres columnas que admiten nulos y una función nueva que solo lee.
-- No cambia ninguna fila ni ninguna función que exista; conta_dia_de_inicio no
-- la llama nadie todavía (la usará la regla del N03).
--
--   1. import_run_id en supplier_invoice, customer_invoice y vat_book_entry: la
--      carga de la que vino la fila (nulo en todo lo que nace en Sumied y en lo
--      traído antes del N02). Como las que ya hay en journal_entry,
--      external_document o external_entry_snapshot: con su clave ajena y «on
--      delete set null». Sin índice: lo pondrá quien lo lea (N06), con el
--      tamaño de cada tabla delante.
--   2. conta_dia_de_inicio(p_company): el primer día que la empresa lleva en
--      Sumied. Junta las dos fuentes de _conta_corte (que no se toca):
--        · bank_settings.cutover_date, si lo puso un administrador; manda, como
--          en _conta_corte;
--        · si no, el día siguiente a lo traído según sus ejercicios: el mayor
--          de imported_until + 1 (ejercicio mixto, o traído de Diez con su
--          imported_until = ends_on) y de ends_on + 1 de los ejercicios
--          traídos enteros. Esto último cierra el hueco: conta_fijar_corte con
--          el corte en el último día de un ejercicio lo deja «migrated» con
--          imported_until nulo, y _conta_corte devuelve nulo.
--      Nulo solo si la empresa no tiene corte del banco ni ningún ejercicio
--      traído (de verdad no viene de otro programa).
--      Siempre que _conta_corte no es nulo, da lo mismo (lo comprueba
--      supabase/staging/sql/20261117_n02_carga_prueba.sql).

alter table public.supplier_invoice
  add column if not exists import_run_id uuid references public.import_run(id) on delete set null;
alter table public.customer_invoice
  add column if not exists import_run_id uuid references public.import_run(id) on delete set null;
alter table public.vat_book_entry
  add column if not exists import_run_id uuid references public.import_run(id) on delete set null;

comment on column public.supplier_invoice.import_run_id is 'N02: la carga de otro programa de la que vino esta factura (source = traida). Nulo si nació en Sumied.';
comment on column public.customer_invoice.import_run_id is 'N02: la carga de otro programa de la que vino esta factura (origin = traida). Nulo si nació en Sumied.';
comment on column public.vat_book_entry.import_run_id is 'N02: la carga de otro programa de la que vino esta anotación. Nulo si nació en Sumied o se trajo antes del N02.';

create or replace function public.conta_dia_de_inicio(p_company uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.cutover_date from public.bank_settings s where s.company_id = p_company),
    (select greatest(max(y.imported_until) + 1,
                     max(y.ends_on) filter (where y.origin = 'migrated' and y.imported_until is null) + 1)
       from public.fiscal_year y
      where y.company_id = p_company and y.origin in ('migrated', 'mixed')))
$$;

comment on function public.conta_dia_de_inicio(uuid) is
  'N02: el primer día que la empresa lleva la contabilidad en Sumied (el corte del banco o el día después de lo traído, también si el corte cae el último día de un ejercicio). Nulo si no viene de otro programa ni tiene corte. Solo lee.';

-- Como _conta_corte: la llaman otras funciones (y el servidor), no el navegador.
revoke all on function public.conta_dia_de_inicio(uuid) from public, anon, authenticated;
grant execute on function public.conta_dia_de_inicio(uuid) to service_role;
