-- F1.5 · Guard de orden de pausa. El fichaje se inserta DIRECTO en clock_entries (no hay RPC de kiosko),
-- así que la validación va en trigger, igual que el debounce anti-doble-fichaje de F1.1.
-- Reglas: no se puede iniciar pausa si no se está dentro; no se puede cerrar una pausa no iniciada;
-- no se encadenan dos pausa_inicio. Solo aplica a fichajes de kiosko/app (el manual lo corrige el gestor).
create or replace function public.tg_clock_entry_pause_order()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_last text;
begin
  if new.type not in ('pausa_inicio','pausa_fin') then
    return new;
  end if;
  if coalesce(new.source,'') = 'manual' then
    return new;  -- correcciones del gestor: no se bloquean
  end if;

  select ce.type into v_last
  from clock_entries ce
  where ce.employee_id = new.employee_id
    and coalesce(ce.voided,false) = false
    and ce.real_datetime <= coalesce(new.real_datetime, new.datetime, now())
  order by ce.real_datetime desc
  limit 1;

  if new.type = 'pausa_inicio' then
    if v_last is null or v_last in ('salida','pausa_inicio') then
      raise exception 'PAUSA_FUERA_DE_ORDEN: no se puede iniciar una pausa sin estar fichado dentro'
        using hint = 'Ficha la entrada antes de iniciar la pausa.';
    end if;
  else -- pausa_fin
    if v_last is distinct from 'pausa_inicio' then
      raise exception 'PAUSA_FUERA_DE_ORDEN: no hay ninguna pausa iniciada que cerrar'
        using hint = 'Solo se puede volver de pausa si antes se inicio una.';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_clock_entry_pause_order on public.clock_entries;
create trigger trg_clock_entry_pause_order
  before insert on public.clock_entries
  for each row execute function public.tg_clock_entry_pause_order();