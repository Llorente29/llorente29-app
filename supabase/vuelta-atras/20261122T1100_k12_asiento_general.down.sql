-- supabase/vuelta-atras/20261122T1100_k12_asiento_general.down.sql
--
-- K12 · Vuelta atrás de la 1100: quita las dos funciones y la tabla del historial. Lo cambiado con ellas se queda como
-- está (los asientos, con su cadena íntegra); su respaldo se va con la tabla. Las dos columnas, solo si nadie las ha
-- usado: si hay observaciones o anchos guardados, se quedan y se dice (no se borra lo que alguien escribió).
drop function if exists public.conta_asiento_modificar(uuid, jsonb, jsonb, text);
drop function if exists public.conta_asiento_se_puede_modificar(uuid);
drop table if exists public.conta_asiento_modificado;
do $$ begin
  if exists (select 1 from public.journal_entry where notes is not null) then
    raise notice 'K12 · vuelta atrás: journal_entry.notes tiene observaciones escritas; la columna se queda.';
  else
    alter table public.journal_entry drop column if exists notes;
  end if;
  if exists (select 1 from public.conta_user_pref where reparto_documento is not null) then
    raise notice 'K12 · vuelta atrás: conta_user_pref.reparto_documento tiene anchos guardados; la columna se queda.';
  else
    alter table public.conta_user_pref drop column if exists reparto_documento;
  end if;
end $$;
