-- ENCARGO fix/limpieza-kds-viejo-y-prevencion · Tarea D — la ventana de
-- actualizacion no puede bloquearse para siempre.
--
-- Los `sent` YA caducaban (60 min) pero los `pending` NO tenian filtro de
-- antiguedad: un solo print_job atascado cerraba la ventana de esa tablet DE
-- FORMA PERMANENTE. Es lo que dejo a camichi4 sin actualizar 3 dias, y casi con
-- certeza lo del 31/07 con C2/C3.
--
-- Umbral de 2h justificado con datos propios (verificado por Claude, coincide
-- con el RECON de Code): mediana 1,04s · p95 2,75s · n=1.812 (14 dias).
-- Solo el 0,549% de 2.730 trabajos tardo mas de 2h en enviarse (tablets
-- apagadas que al encender reclaman lo pendiente) — y en ese caso el peor
-- efecto es un reload que retrasa unos segundos la impresion, porque los
-- trabajos siguen en la cola.
--
-- APLICADA EN VERSION GENERATIVA: sustitucion quirurgica sobre la definicion
-- VIVA, no transcripcion. Aborta si el fragmento no aparece exactamente 1 vez.
do $mig$
declare
  v_oid  oid;
  v_def  text;
  v_new  text;
  c_old  constant text := 'j.status = ''pending''';
  c_new  constant text := '(j.status = ''pending'' and j.created_at > now() - interval ''2 hours'')';
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'station_update_window';

  if v_oid is null then
    raise exception 'station_update_window: no existe — RECON desactualizado, parar';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'station_update_window: el fragmento no aparece exactamente 1 vez — parar sin tocar nada';
  end if;

  v_new := replace(v_def, c_old, c_new);
  execute v_new;
end;
$mig$;

-- Verificacion embebida
do $ver$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'station_update_window'
      and p.prosrc ~ 'created_at > now\(\) - interval ''2 hours'''
  ) then
    raise exception 'station_update_window: la ventana de 2h NO quedo aplicada';
  end if;
end;
$ver$;

notify pgrst, 'reload schema';