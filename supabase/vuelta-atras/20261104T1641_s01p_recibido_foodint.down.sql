-- supabase/vuelta-atras/20261104T1641_s01p_recibido_foodint.down.sql
-- Vuelta atrás de la 1641: lo recibido sin factura de octubre de Foodint como
-- estaba (la periodificación, sus dos asientos propuestos y sus apuntes, desde
-- su copia), y fuera la copia. Si ya están (no se quitó nada), no se duplican.
insert into public.purchase_accrual
select (jsonb_populate_record(null::public.purchase_accrual, a.fila)).*
  from public.conta_s01p_recibido_antes a where a.tabla = 'purchase_accrual'
on conflict do nothing;
insert into public.journal_entry
select (jsonb_populate_record(null::public.journal_entry, a.fila)).*
  from public.conta_s01p_recibido_antes a where a.tabla = 'journal_entry'
on conflict do nothing;
insert into public.journal_line
select (jsonb_populate_record(null::public.journal_line, a.fila)).*
  from public.conta_s01p_recibido_antes a where a.tabla = 'journal_line'
on conflict do nothing;
drop table if exists public.conta_s01p_recibido_antes;
