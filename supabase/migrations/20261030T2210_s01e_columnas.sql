-- supabase/migrations/20261030T2210_s01e_columnas.sql
--
-- S01e · La ficha de cada préstamo o aplazamiento (encargo del 30/10). Las
-- columnas, solas: solo añaden (admiten nulos y se pueden pasar dos veces),
-- para que staging las tenga de verdad desde la rama. Lo que las escribe va
-- en la 2211.
--
--   · bank_match.contract_id y contract_due_date: qué fila del cuadro paga
--     un cargo casado. Hoy no se guarda en ningún sitio (paso 0: 0 registros
--     de Foodint con el contrato). Las cuotas ya casadas se quedan con las dos
--     vacías: no se tocan.
--   · recurring_contract.document_uploaded_at: cuándo se subió el cuadro que
--     tiene el contrato (created_at no cambia al subir otro).
alter table public.bank_match add column if not exists contract_id uuid
  references public.recurring_contract (id) on delete set null;
alter table public.bank_match add column if not exists contract_due_date date;
comment on column public.bank_match.contract_id is
  'S01e. El contrato (préstamo o aplazamiento) cuya cuota paga este cargo. Nulo en todo lo demás y en las cuotas casadas antes del S01e.';
comment on column public.bank_match.contract_due_date is
  'S01e. La fecha de la fila del cuadro que paga este cargo (con contract_id).';
alter table public.recurring_contract add column if not exists document_uploaded_at timestamptz;
comment on column public.recurring_contract.document_uploaded_at is
  'S01e. Cuándo se subió el cuadro que tiene el contrato. Nulo en los de antes del S01e (la ficha usa created_at).';
