-- F10/F7.4 · Aplicar la disponibilidad inferida a employee_availability, previa CONFIRMACIÓN del encargado.
-- Regla de Julio: recomendado, no obligatorio. Por eso:
--  · solo aplica lo de confianza ALTA (nunca las corazonadas con poca muestra),
--  · deja rastro en `note` de que es inferido y de su motivo (auditable, reversible),
--  · NO borra lo que el encargado haya puesto a mano: p_overwrite=false por defecto respeta lo humano.
-- El solver tratará esto como preferencia BLANDA: se respeta si se puede, se rompe avisando si hace falta.
create or replace function public.apply_inferred_availability(
  p_account uuid, p_location uuid default null, p_overwrite boolean default false
) returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_count int := 0; r record;
begin
  for r in
    select * from public.infer_employee_availability(p_account, p_location)
    where confianza = 'alta'
  loop
    if not p_overwrite and exists (
      select 1 from public.employee_availability a
      where a.employee_id = r.employee_id and a.day_of_week = r.day_of_week
        and a.shift_period = r.shift_period
        and (a.note is null or a.note not like 'Inferido%')   -- puesto a mano: no tocar
    ) then
      continue;
    end if;

    insert into public.employee_availability (
      employee_id, account_id, day_of_week, shift_period, available, note)
    values (r.employee_id, p_account, r.day_of_week, r.shift_period, r.sugerencia,
            'Inferido del historial · '||r.motivo)
    on conflict (employee_id, day_of_week, shift_period) do update
      set available = excluded.available,
          note = excluded.note;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$;

revoke execute on function public.apply_inferred_availability(uuid,uuid,boolean) from public, anon;
grant execute on function public.apply_inferred_availability(uuid,uuid,boolean) to authenticated, service_role;