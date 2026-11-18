-- supabase/migrations/20261117T2224_n06b_programa_erp10.sql
-- cambia: public.conta_programa_anterior · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
--
-- N06b · 3.3: «¿De qué programa vienes?» admite ERP10. El CHECK de conta_programa_anterior.programa
-- solo AMPLÍA (añade «erp10»): todas las filas de hoy siguen valiendo. No cambia ninguna fila ni
-- ninguna función (conta_programa_anterior_poner ya guarda lo que le llega, en minúsculas). Nada en
-- el camino del pedido.
alter table public.conta_programa_anterior drop constraint if exists conta_programa_anterior_programa;
alter table public.conta_programa_anterior add constraint conta_programa_anterior_programa
  check (programa = any (array['diez', 'erp10', 'holded', 'sage', 'a3', 'contasol', 'quipu', 'otro', 'ninguno']));
