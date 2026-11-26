-- supabase/migrations/20261126T0654_q10d_conceptos_noviembre.sql
--
-- Q10 · respuesta 4 (26/11) · LOS CONCEPTOS QUE APROBÓ JULIO PARA LO DE NOVIEMBRE QUE NO ESTÁ EN LA TABLA:
--   · los 8 cobros sueltos (sin suscripción), por su id de cobro: dos de gestión laboral (0008), dos de renta (0017),
--     una fiscalización del IVA (00016), un trámite de ayuda (00007) y dos al concepto global 0039 «OTROS TRÁMITES Y
--     GESTIONES» (una licencia y un alta en el VAT intracomunitario);
--   · las 3 suscripciones con nombre propio, por su id: dos «Gestion …» al 0021 (vigilancia de notificaciones: el 630
--     tiene en Cegid 2 × 30 € de 0021) y un «Mantenimiento de …» al 0039.
-- Sin nombres (T11): solo ids de GoCardless y códigos de concepto. Los dos sueltos de 121 € se casaron con la tabla por
-- su cliente; cuando la lectura traiga su texto, se ve en la pantalla.
-- Solo en la empresa de QBO; en otra base no hace nada. Para si algún cobro o suscripción no está en lo leído.
-- Vuelta atrás: supabase/vuelta-atras/20261126T0654_q10d_conceptos_noviembre.down.sql.

do $conceptos$
declare
  v_empresa constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
  v_quien constant text := 'Julio (respuesta Q10 · 4, 26/11)';
  v_l constant jsonb := '[
    {"que": "cobro", "gc": "PM01XXP2WZKEQ6YDGZ27BW5VQP05", "c": "0008"}, {"que": "cobro", "gc": "PM01Y05DW59BXCZ78X6S43KEGFWE", "c": "0008"},
    {"que": "cobro", "gc": "PM01XXRQ9KBFVBAQAZ37SJ39C7JS", "c": "0017"}, {"que": "cobro", "gc": "PM01XYC330ZR0EDJR0J58B92GYAD", "c": "0017"},
    {"que": "cobro", "gc": "PM01XYW12VSTP8C5SR6KDEA85Q3K", "c": "00016"}, {"que": "cobro", "gc": "PM01XY6XK4JJJ60Q0HJRGEHV5SP5", "c": "00007"},
    {"que": "cobro", "gc": "PM01XXRPEAS0BTEV93CWNW2HEWYA", "c": "0039"}, {"que": "cobro", "gc": "PM01Y04QG9VEFQSJDN5KEVAQDANR", "c": "0039"},
    {"que": "suscripcion", "gc": "SB001DRW93Z34Z", "c": "0021"}, {"que": "suscripcion", "gc": "SB001DRW8Y3P6M", "c": "0021"},
    {"que": "suscripcion", "gc": "SB01KXK9N5WRSK9M1545X5PRP7TV", "c": "0039"}
  ]';
  v_cuenta uuid; v_faltan text[];
begin
  select account_id into v_cuenta from public.company where id = v_empresa;
  if v_cuenta is null then
    raise notice 'Q10 · 0654: esta base no tiene la empresa de QBO; no se elige nada.';
    return;
  end if;
  v_faltan := array(select x.gc from jsonb_to_recordset(v_l) x(que text, gc text, c text)
    where (x.que = 'cobro' and not exists (select 1 from public.conta_gc_cobro where company_id = v_empresa and gc_id = x.gc))
       or (x.que = 'suscripcion' and not exists (select 1 from public.conta_gc_suscripcion where company_id = v_empresa and gc_id = x.gc)));
  if cardinality(v_faltan) > 0 then
    raise exception 'Q10 · 0654: no están en lo leído de GoCardless: %. No se elige nada.', array_to_string(v_faltan, ', ');
  end if;
  insert into public.conta_cegid_concepto_elegido (company_id, account_id, que, gc_id, concepto, quien)
  select v_empresa, v_cuenta, x.que, x.gc, x.c, v_quien from jsonb_to_recordset(v_l) x(que text, gc text, c text)
  on conflict (company_id, que, gc_id) do nothing;
  raise notice 'Q10 · 0654: % conceptos elegidos.', (select count(*) from public.conta_cegid_concepto_elegido where company_id = v_empresa and quien = v_quien);
end $conceptos$;
