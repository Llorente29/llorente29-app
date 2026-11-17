-- supabase/migrations/20261117T1806_n06a_carga_columnas.sql
--
-- N06a · Traer de otro programa: la carga en prueba y deshacerla (17/11). 1 de 3: LAS COLUMNAS.
-- Solo AÑADE columnas que admiten nulos; no cambia ninguna fila ni ninguna función.
--
--   1. Una carga es UNA, aunque traiga ocho ficheros (3.1 del N06): una fila madre en
--      import_run (kind «carga», que añade la 1808) y cada fichero leído, una fila hija con
--      import_run.parent_id. Todo lo que crea la carga apunta a la madre (import_run_id).
--      import_run.detail guarda lo que se enseña y no tiene otro sitio: lo que hay que mirar,
--      lo aprendido como propuesta, el inmovilizado leído y lo que hay que deshacer.
--   2. supplier.import_run_id y party.import_run_id: el proveedor y el tercero que creó una
--      carga (para deshacer solo lo suyo).
--   3. En las facturas traídas (supplier_invoice y customer_invoice):
--      · import_mark: «sin_casar» (no encontró su asiento) o «fuera» («Dejarlas fuera»: no
--        desaparece, queda marcada y no cuenta);
--      · import_pending: lo que queda pendiente según el saldo de su tercero en el otro
--        programa (decisión 3 del N01): 0 si está pagada o cobrada.

alter table public.import_run
  add column if not exists parent_id uuid references public.import_run(id) on delete cascade,
  add column if not exists detail jsonb;
comment on column public.import_run.parent_id is 'N06a: la carga (kind = carga) de la que es esta lectura de un fichero. Nulo en la carga y en las lecturas de antes.';
comment on column public.import_run.detail is 'N06a: en una carga, lo que se enseña y no tiene otro sitio (lo que hay que mirar, lo aprendido como propuesta, el inmovilizado leído) y lo que creó, para deshacerlo.';

alter table public.supplier add column if not exists import_run_id uuid references public.import_run(id) on delete set null;
alter table public.party add column if not exists import_run_id uuid references public.import_run(id) on delete set null;
comment on column public.supplier.import_run_id is 'N06a: la carga de otro programa que creó este proveedor (nulo si no lo creó una carga).';
comment on column public.party.import_run_id is 'N06a: la carga de otro programa que creó este tercero (nulo si no lo creó una carga).';

alter table public.supplier_invoice
  add column if not exists import_mark text constraint supplier_invoice_import_mark_check check (import_mark is null or import_mark in ('sin_casar', 'fuera')),
  add column if not exists import_pending numeric;
alter table public.customer_invoice
  add column if not exists import_mark text constraint customer_invoice_import_mark_check check (import_mark is null or import_mark in ('sin_casar', 'fuera')),
  add column if not exists import_pending numeric;
comment on column public.supplier_invoice.import_mark is 'N06a: en una factura traída, «sin_casar» (sin su asiento) o «fuera» (dejada fuera de su carga a propósito).';
comment on column public.supplier_invoice.import_pending is 'N06a: en una factura traída, lo que queda por pagar según el saldo del proveedor en el otro programa (0: pagada).';
comment on column public.customer_invoice.import_mark is 'N06a: en una factura traída, «sin_casar» (sin su asiento) o «fuera» (dejada fuera de su carga a propósito).';
comment on column public.customer_invoice.import_pending is 'N06a: en una factura traída, lo que queda por cobrar según el saldo del cliente en el otro programa (0: cobrada).';
