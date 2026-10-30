-- supabase/vuelta-atras/20261030T2210_s01e_columnas.down.sql
--
-- Vuelta atrás de la 2210: fuera las tres columnas (lo que guardan se pierde:
-- qué fila del cuadro paga cada cargo y cuándo se subió el cuadro).
alter table public.bank_match drop column if exists contract_due_date;
alter table public.bank_match drop column if exists contract_id;
alter table public.recurring_contract drop column if exists document_uploaded_at;
