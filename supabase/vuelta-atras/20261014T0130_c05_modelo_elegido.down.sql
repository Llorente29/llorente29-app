-- Vuelta atrás de C05 · 4 · el modelo elegido. PARA si alguna empresa ya lo eligió.
do $$ begin
  if to_regclass('public.annual_accounts_choice') is not null and exists (select 1 from public.annual_accounts_choice) then
    raise exception 'Vuelta atrás C05 · modelo elegido: hay ejercicios con su modelo elegido; se perdería quién eligió qué.';
  end if;
end $$;
drop table if exists public.annual_accounts_choice;
