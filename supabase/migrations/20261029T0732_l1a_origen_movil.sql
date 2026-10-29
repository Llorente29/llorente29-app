-- supabase/migrations/20261029T0732_l1a_origen_movil.sql
--
-- L1a · PR 2b («Cerrar»), tercer fichero (29/10/2026). CORRECCIÓN DE DATOS,
-- con rastro: el origen de los fichajes hechos desde el móvil que el portal
-- antiguo guardó como «kiosko».
--
-- Por qué: Julio confirma (29/10) que en Foodint nadie ha fichado nunca con la
-- tablet; el portal antiguo etiquetaba «kiosko» también lo que venía del
-- móvil. Desde la L1a, fichar() guarda «movil» o «tablet» y no vuelve a
-- escribir «kiosko».
--
-- EL CRITERIO, medible fila a fila: source = 'kiosko' y la marca TUVO
-- ubicación GPS (lat guardada, o ubicacion_borrada_at puesta: la conservación
-- borró las coordenadas a los 3 meses, pero las tuvo). «Sin PIN de kiosko» no
-- se puede medir en las marcas antiguas (no guardaban si hubo PIN), así que no
-- se usa.
--
-- Medido en producción el 29/10 (solo lectura, todas las cuentas):
--   · cambian a «movil»: 1.434, todas de Foodint (42 anuladas), del 13/06 al
--     27/10 (la última, 18:22 UTC);
--   · se quedan en «kiosko»: 716 — Foodint 50 (sin ubicación, del 14/06 al
--     25/10) y Casa Lola 666 (sin ubicación, todas dadas de alta el 08/10).
--     Esas no se tocan: el criterio no puede decir de dónde vinieron.
--
-- EL RASTRO: cada cambio deja su fila «edit» en clock_entry_audit (el
-- disparador de siempre), con este motivo y quién, y el antes y el después
-- (solo cambia «source»). No toca la hora ni la anulación: la firma del mes no
-- pierde valor (su disparador mira tipo, hora y anulación) y no pide
-- conformidad (no hay sesión). El informe para la Inspección (0733) enseña
-- estas filas como «origen corregido», no como una corrección de la hora.
--
-- GUARDA: si hay alguna marca «kiosko» con GPS dada de alta después del
-- 28/10 a las 11:27 UTC (desde entonces todo entra por fichar(), que no
-- escribe «kiosko»), PARA: algo sigue escribiendo «kiosko» y hay que mirarlo.
--
-- Vuelta atrás: supabase/vuelta-atras/20261029T0732_l1a_origen_movil.down.sql
-- (vuelve a «kiosko» exactamente las que tienen este rastro).

do $$
declare
  v_tarde int;
  v_n int;
begin
  select count(*) into v_tarde
    from public.clock_entries
   where source = 'kiosko'
     and (lat is not null or ubicacion_borrada_at is not null)
     and created_at >= timestamptz '2026-10-28 11:27:00+00';
  if v_tarde > 0 then
    raise exception 'Hay % marcas «kiosko» con GPS dadas de alta después del 28/10 11:27 UTC: algo sigue escribiendo «kiosko».', v_tarde
      using errcode = 'P0001';
  end if;

  perform set_config('app.clock_edit_reason',
    'Origen corregido: fichado desde el móvil (la marca tuvo ubicación GPS). El portal antiguo lo guardaba como «kiosko». Corrección de datos del 29/10/2026 (20261029T0732_l1a_origen_movil).',
    true);
  perform set_config('app.clock_edit_actor', 'Corrección de datos (Folvy)', true);

  update public.clock_entries
     set source = 'movil'
   where source = 'kiosko'
     and (lat is not null or ubicacion_borrada_at is not null);
  get diagnostics v_n = row_count;

  perform set_config('app.clock_edit_reason', '', true);
  perform set_config('app.clock_edit_actor', '', true);

  raise notice 'Origen corregido a «movil»: % marcas. Se quedan en «kiosko»: %.', v_n,
    (select count(*) from public.clock_entries where source = 'kiosko');
end $$;
