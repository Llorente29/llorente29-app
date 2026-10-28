-- supabase/vuelta-atras/20261028T0706_l1a_corregir_con_conformidad.down.sql
--
-- Deja como antes de la 0706: fuera los dos disparadores (la conformidad
-- «pendiente» y la firma sin valor al corregir) y las cuatro funciones de
-- corrección como estaban, con su huella (_restaurar_funcion la compara). Lo
-- de la 0705 se queda: lo quita su propia vuelta atrás.

set constraints all immediate;

drop trigger if exists trg_registro_firma_invalidar on public.clock_entries;
drop function if exists public._registro_firma_invalidar();
drop trigger if exists trg_clock_audit_conformidad on public.clock_entry_audit;
drop function if exists public._clock_audit_conformidad();

select public._restaurar_funcion('public.request_clock_correction(uuid,uuid,text,text,uuid,text,timestamp with time zone)', '20261028T0706_l1a_corregir_con_conformidad');
select public._restaurar_funcion('public.resolve_clock_correction(uuid,boolean,text,text)', '20261028T0706_l1a_corregir_con_conformidad');
select public._restaurar_funcion('public.void_clock_entry(uuid,text,text)', '20261028T0706_l1a_corregir_con_conformidad');
select public._restaurar_funcion('public.edit_clock_entry(uuid,timestamp with time zone,text,text,text)', '20261028T0706_l1a_corregir_con_conformidad');
