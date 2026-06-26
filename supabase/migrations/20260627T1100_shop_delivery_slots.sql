create or replace function public.shop_delivery_slots(
  p_slug text,
  p_location_id uuid,
  p_eta_min integer default 40,
  p_step_min integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_now timestamptz := now();
  v_tz text := 'Europe/Madrid';
  v_start timestamptz;
  v_end_of_day timestamptz;
  v_slot timestamptz;
  v_slots jsonb := '[]'::jsonb;
  v_epoch_step int;
begin
  select id into v_account_id from accounts where slug = p_slug;
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'slots', '[]'::jsonb);
  end if;

  -- Inicio: ahora + eta, redondeado hacia arriba al siguiente múltiplo de step.
  v_start := v_now + (p_eta_min || ' minutes')::interval;
  v_epoch_step := p_step_min * 60;
  v_start := to_timestamp(ceil(extract(epoch from v_start) / v_epoch_step) * v_epoch_step);

  -- Fin del día de hoy en zona local.
  v_end_of_day := (date_trunc('day', v_now at time zone v_tz) + interval '1 day') at time zone v_tz;

  v_slot := v_start;
  while v_slot < v_end_of_day loop
    -- Solo franjas en las que el LOCAL está abierto (horario general, brand_id NULL).
    if is_brand_open(p_location_id, null, v_slot) then
      v_slots := v_slots || jsonb_build_object(
        'ts', v_slot,
        'label', to_char(v_slot at time zone v_tz, 'HH24:MI')
      );
    end if;
    v_slot := v_slot + (p_step_min || ' minutes')::interval;
  end loop;

  return jsonb_build_object('ok', true, 'slots', v_slots);
end;
$function$;
