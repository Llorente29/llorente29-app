-- Esquema mínimo, con los nombres de columna medidos en producción (18/10), para
-- ejecutar libros-iva-importar.sql entero en un Postgres local. Datos inventados.
create table public.company (id uuid primary key, account_id uuid not null);
create table public.company_account (id uuid primary key, template_code text not null);
create table public.journal_entry (id uuid primary key, account_id uuid, company_id uuid, entry_date date, source_type text,
  external_program text, external_year text, external_series text, external_number text);
create table public.journal_line (id uuid primary key, entry_id uuid references public.journal_entry, position int, company_account_id uuid references public.company_account, debit numeric, credit numeric);
create table public.vat_book_entry (id uuid primary key default gen_random_uuid(), account_id uuid not null, company_id uuid not null,
  entry_id uuid not null references public.journal_entry, line_id uuid references public.journal_line,
  book text not null check (book in ('issued','received','investment','not_subject')),
  invoice_type text not null check (invoice_type in ('F1','F2','F3','F4','R1','R2','R3','R4','R5')), series text, number text, number_to text,
  documents_count int not null check (documents_count > 0), issue_date date not null, operation_date date, received_date date, received_number text,
  party_id uuid, counterpart_tax_id text, counterpart_id_type text check (counterpart_id_type is null or counterpart_id_type in ('02','03','04','05','06')),
  counterpart_country text, counterpart_name text, operation_key text not null,
  qualification text check (qualification is null or qualification in ('S1','S2','N1','N2')),
  exempt_cause text, tax_base numeric not null, tax_rate numeric, tax_amount numeric not null, surcharge_rate numeric, surcharge_amount numeric,
  total numeric, deductible_amount numeric, deductible_later boolean not null, reverse_charge boolean not null, investment_good boolean not null,
  withholding_rate numeric, withholding_amount numeric, activity_code text, activity_type text, activity_iae text, corrects_ref text,
  source_type text not null, source_id uuid, voided_at timestamptz, voided_by_entry_id uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), updated_by_name text);
-- Como en producción (medido el 18/10, después del 23505 del primer ensayo): una fila del libro por línea del diario.
create unique index uq_vat_book_entry_linea on public.vat_book_entry (line_id) where line_id is not null;
-- Empresa E, cuentas 477, 472, 430, 400, 700, 600.
insert into public.company values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.company_account values
  ('c0000000-0000-4000-8000-000000000477', '477'), ('c0000000-0000-4000-8000-000000000472', '472'),
  ('c0000000-0000-4000-8000-000000000430', '430'), ('c0000000-0000-4000-8000-000000000400', '400'),
  ('c0000000-0000-4000-8000-000000000700', '700'), ('c0000000-0000-4000-8000-000000000600', '600');
-- Asientos traídos: venta 1T (serie 1, doc 1: 1000 + 100), compra 1T (serie 2, doc 1: 500 + 105, a 21 %),
-- compra intracomunitaria 1T (serie 2, doc 2: 477 y 472 de 21), venta 2T (serie 1, doc 2: 2000 + 200),
-- compra 2T con dos tipos (serie 2, doc 3: 100 al 10 % + 100 al 21 % = 31).
create function pg_temp.a(id text, f date, s text, n text) returns void language sql as $$
  insert into public.journal_entry values (id::uuid, 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', f, 'migrated', 'diez', '2026', s, n) $$;
create function pg_temp.l(id text, e text, p int, cta text, d numeric, h numeric) returns void language sql as $$
  insert into public.journal_line values (id::uuid, e::uuid, p, ('c0000000-0000-4000-8000-000000000' || cta)::uuid, d, h) $$;
select pg_temp.a('10000000-0000-4000-8000-000000000001', '2026-02-10', '1', '1');
select pg_temp.l('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, '430', 1100, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 2, '700', 0, 1000),
       pg_temp.l('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 3, '477', 0, 100);
select pg_temp.a('10000000-0000-4000-8000-000000000002', '2026-03-20', '2', '1');
select pg_temp.l('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 1, '600', 500, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 2, '472', 105, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000002', 3, '400', 0, 605);
select pg_temp.a('10000000-0000-4000-8000-000000000003', '2026-03-25', '2', '2');
select pg_temp.l('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', 1, '600', 100, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000003', 2, '472', 21, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000003', 3, '477', 0, 21),
       pg_temp.l('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000003', 4, '400', 0, 100);
select pg_temp.a('10000000-0000-4000-8000-000000000004', '2026-05-05', '1', '2');
select pg_temp.l('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000004', 1, '430', 2200, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000004', 2, '700', 0, 2000),
       pg_temp.l('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000004', 3, '477', 0, 200);
select pg_temp.a('10000000-0000-4000-8000-000000000005', '2026-06-30', '2', '3');
select pg_temp.l('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000005', 1, '600', 200, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000005', 2, '472', 31, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000005', 3, '400', 0, 231);
-- Compra 2T con dos tipos y UNA 472 POR TIPO (serie 2, doc 4: 100 al 10 % + 100 al 21 %), como 240
-- asientos reales de la serie 2: cada tramo se casa con la línea de su importe.
select pg_temp.a('10000000-0000-4000-8000-000000000006', '2026-06-30', '2', '4');
select pg_temp.l('20000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000006', 1, '600', 200, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000006', 2, '472', 21, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000006', 3, '472', 10, 0),
       pg_temp.l('20000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000006', 4, '400', 0, 231);
