-- supabase/vuelta-atras/20261117T2224_n06b_programa_erp10.down.sql
--
-- N06b · la vuelta atrás del 3.3: el CHECK sin «erp10». Si alguna empresa ya dijo que viene de
-- ERP10, para: esa respuesta no se borra a escondidas.
do $$ begin
  if exists (select 1 from public.conta_programa_anterior where programa = 'erp10') then
    raise exception 'N06b: hay empresas que vienen de ERP10; la vuelta atrás del CHECK no se hace con ellas dentro.';
  end if;
end $$;
alter table public.conta_programa_anterior drop constraint if exists conta_programa_anterior_programa;
alter table public.conta_programa_anterior add constraint conta_programa_anterior_programa
  check (programa = any (array['diez', 'holded', 'sage', 'a3', 'contasol', 'quipu', 'otro', 'ninguno']));
