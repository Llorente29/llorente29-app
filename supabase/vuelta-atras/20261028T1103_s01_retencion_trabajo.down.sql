-- supabase/vuelta-atras/20261028T1103_s01_retencion_trabajo.down.sql
--
-- Vuelta atrás de la 1103: quita la retención de serie del trabajo, si nadie la
-- usa. Si ya hay asientos con ella, para: quitarla dejaría líneas sin su tipo.
do $$ begin
  if exists (select 1 from public.journal_line l join public.withholding_rate w on w.id = l.withholding_rate_id
              where w.is_system and w.code = 'trabajo' and w.valid_from = '2007-04-01') then
    raise exception 'Vuelta atrás 1103: hay asientos con la retención del trabajo; no se quita.';
  end if;
end $$;
delete from public.withholding_rate where is_system and code = 'trabajo' and valid_from = '2007-04-01';
