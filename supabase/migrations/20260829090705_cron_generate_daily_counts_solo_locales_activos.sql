do $do$
declare
  v_def text;
  v_old constant text := '    WHERE COALESCE(s.autoinventory_enabled, true) = true
';
  v_new constant text := '    WHERE COALESCE(s.autoinventory_enabled, true) = true
      -- 29/08/2026: SOLO LOCALES ACTIVOS. Sin esto se generaba conteo diario
      -- para Foodint Plaza Castilla (629f9154, locations.active = false), un
      -- local dado de baja: 24 lineas y personas asignadas cada dia, y un
      -- rezagado nuevo cada dia que ademas alimentaria la alerta de rezagados
      -- recien creada. La primera alerta del cron arreglado habria nacido
      -- siendo ruido.
      AND COALESCE(l.active, true) = true
';
begin
  v_def := replace(
    pg_get_functiondef('public.cron_generate_daily_counts()'::regprocedure),
    chr(13), '');

  if position(v_old in v_def) = 0 then
    raise exception 'no encuentro el WHERE literal en cron_generate_daily_counts; abortado';
  end if;

  execute replace(v_def, v_old, v_new);
end
$do$;