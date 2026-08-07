-- Aplicada: 2026-08-07 por MCP. Probado con 4 escenarios (rollback): normal PASA, doble<60s RECHAZA,
-- manual cercano PASA, kiosko lejos PASA. 0 datos de prueba residuales.
-- F1.1c · Guard anti-doble-fichaje: impide dos fichajes de kiosko del mismo empleado a <60s (doble-toque).
-- Solo source='kiosko' (o null); NO bloquea altas/correcciones manuales. Lanza DOBLE_FICHAJE_MUY_RAPIDO.
create or replace function public.tg_clock_entry_debounce()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if coalesce(new.source,'kiosko') = 'kiosko' then
    if exists (
      select 1 from public.clock_entries c
      where c.employee_id = new.employee_id
        and coalesce(c.voided,false) = false
        and abs(extract(epoch from (
              coalesce(c.real_datetime,c.datetime) - coalesce(new.real_datetime,new.datetime)
            ))) < 60
    ) then
      raise exception 'DOBLE_FICHAJE_MUY_RAPIDO'
        using hint = 'Ya se registró un fichaje hace unos segundos.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_clock_entry_debounce() from public, anon, authenticated;
create trigger trg_clock_debounce before insert on public.clock_entries
  for each row execute function public.tg_clock_entry_debounce();
