-- K14b · vuelta atrás de 20261126T1606: las fechas de la empresa dc43e21d como estaban (2026-11-MM vuelve a 2026-MM-11), su
-- extracto como estaba y sus cobros del K14 con esa fecha. Solo si no ha entrado nada más en su banco (si se volvió a
-- subir el extracto, para: hay que mirarlo a mano).
do $$
declare emp constant uuid := 'dc43e21d-2992-4eb3-a378-c867f86d6644'; ext constant uuid := '301d51b6-f1bb-45f9-a39f-cb7ddc1709f5';
begin
  if not exists (select 1 from public.company where id = emp) then return; end if;
  if (select count(*) from public.bank_movement where company_id = emp) <> 40 then
    raise exception 'K14b · vuelta atrás: en el banco de la empresa dc43e21d ya hay más que los 40; se mira a mano.';
  end if;
  update public.bank_movement m
     set op_date = make_date(2026, extract(day from m.op_date)::int, 11), value_date = make_date(2026, extract(day from m.value_date)::int, 11),
         fingerprint = '2026-' || substr(m.fingerprint, 9, 2) || '-11' || substr(m.fingerprint, 11),
         soft_fingerprint = '2026-' || substr(m.soft_fingerprint, 9, 2) || '-11' || substr(m.soft_fingerprint, 11), updated_at = now()
   where m.company_id = emp;
  update public.bank_statement
     set period_from = date '2026-01-11', period_to = date '2026-12-11',
         opening_balance = (regexp_match(unchecked_reason, 'saldos ([0-9.-]+) → '))[1]::numeric,
         closing_balance = (regexp_match(unchecked_reason, ' → ([0-9.-]+), huella'))[1]::numeric,
         balanced = true, continuity = 'primero', file_sha256 = (regexp_match(unchecked_reason, 'huella ([0-9a-f]{64})'))[1], unchecked_reason = null
   where id = ext and unchecked_reason like 'K14b:%';
  update public.conta_banco_cobro c set fecha = m.op_date, mes = date_trunc('month', m.op_date)::date
    from public.bank_movement m where m.id = c.movement_id and c.company_id = emp;
  perform public._bank_antes_del_inicio_recalcular(emp);
end $$;
