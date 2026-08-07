-- Aplicada 2026-08-07. Verificado: 4 tipos admitidos, 0 fichajes existentes rotos.
-- F1.5 · Pausa explicita. Por que NO salida+entrada: grabar la pausa como "salida" dice que el trabajador
-- termino su jornada y se fue, lo cual es falso. Ante Inspeccion el registro debe reflejar la jornada REAL:
-- una jornada con descanso, no dos jornadas cortas.
alter table public.clock_entries drop constraint if exists clock_entries_type_check;
alter table public.clock_entries add constraint clock_entries_type_check
  check (type in ('entrada','salida','pausa_inicio','pausa_fin'));
-- Atestacion (mejor idea de 7shifts): defensa documental frente a "nunca me dieron mi descanso".
alter table public.clock_entries add column if not exists break_attested boolean;
alter table public.clock_entries add column if not exists break_attest_reason text;
comment on column public.clock_entries.break_attested is
  'F1.5 Atestacion: el trabajador confirma al fichar salida si disfruto su descanso. NULL = no preguntado.';
-- Bug latente detectado en RECON: training_is_clocked_in miraba solo type='entrada', asi que un trabajador
-- EN PAUSA pasaria a "no fichado" y perderia el acceso a formacion.
create or replace function public.training_is_clocked_in(p_employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  SELECT COALESCE(
    (SELECT ce.type in ('entrada','pausa_inicio','pausa_fin')
     FROM clock_entries ce
     WHERE ce.employee_id = p_employee_id AND NOT ce.voided
     ORDER BY ce.datetime DESC LIMIT 1),
    false);
$function$;
