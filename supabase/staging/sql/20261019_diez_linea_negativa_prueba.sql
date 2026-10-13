-- supabase/staging/sql/20261019_diez_linea_negativa_prueba.sql
--
-- SOLO STAGING. Prueba de 20261019T0140 (public.journal_line,
-- external_negative_side). Todo en una transacción con ROLLBACK.
--
--   1. La columna existe, admite nulos y es texto.
--   2. En una línea de un asiento PROPUESTO de la cuenta A de pruebas:
--      'debe' y 'haber' entran; null entra; cualquier otra cosa no.
--   3. Las líneas de antes siguen a null: no se ha tocado ningún dato.

begin;

do $$
declare
  v_linea uuid;
  v_ok boolean;
begin
  -- 1 · La columna
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'journal_line'
                 and column_name = 'external_negative_side' and data_type = 'text' and is_nullable = 'YES') then
    raise exception 'PRUEBA línea negativa · 1: falta journal_line.external_negative_side (texto, admite nulos).';
  end if;

  -- 2 · El CHECK, sobre una línea real de un asiento propuesto (cuenta A de pruebas)
  select jl.id into v_linea from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id
   where jl.account_id = 'c01a0000-0000-4000-8000-00000000000a' and je.status = 'propuesto' order by jl.id limit 1;
  if v_linea is null then raise exception 'PRUEBA línea negativa · 2: no hay línea de un asiento propuesto en la cuenta A para probar.'; end if;

  update public.journal_line set external_negative_side = 'debe' where id = v_linea;
  update public.journal_line set external_negative_side = 'haber' where id = v_linea;
  update public.journal_line set external_negative_side = null where id = v_linea;
  v_ok := false;
  begin
    update public.journal_line set external_negative_side = 'negativo' where id = v_linea;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA línea negativa · 2: entró un valor que no es debe ni haber.'; end if;

  -- 3 · Nada tocado
  if exists (select 1 from public.journal_line where external_negative_side is not null) then
    raise exception 'PRUEBA línea negativa · 3: hay líneas con la marca puesta sin que nadie las haya traído.';
  end if;

  raise notice 'PRUEBA línea negativa: 3 de 3 bien.';
end $$;

rollback;
