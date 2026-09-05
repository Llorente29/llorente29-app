-- La regla de las dos ventanas, en su propia funcion.
--
-- POR QUE SALE DE `report_sales`. Estaba dentro, detras de la guarda de cuenta,
-- y eso la hacia IMPOSIBLE DE PROBAR: cualquier intento de comprobarla choca
-- antes con «sin acceso a la cuenta». Una regla que no se puede ejecutar solo
-- se puede verificar razonando, y razonar no es verificar (regla 5).
--
-- Aqui es pura y no toca datos, asi que la prueba de la V5 es la regla de
-- verdad, no una copia suya.
create or replace function public._report_ventanas_validas(
  p_from       timestamptz,
  p_to         timestamptz,
  p_prev_from  timestamptz,
  p_prev_to    timestamptz,
  p_calendario boolean default false
)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $fn$
declare
  v_dur   interval;
  v_dur_p interval;
begin
  if p_from is null or p_to is null or p_prev_from is null or p_prev_to is null then
    raise exception 'report_sales: las dos ventanas son obligatorias (actual y espejo)';
  end if;
  if p_to <= p_from or p_prev_to <= p_prev_from then
    raise exception 'report_sales: una ventana no puede acabar antes de empezar';
  end if;
  if p_prev_to > p_from then
    raise exception 'report_sales: el espejo (% -> %) se solapa con la ventana actual (%)',
      p_prev_from, p_prev_to, p_from;
  end if;

  v_dur   := p_to - p_from;
  v_dur_p := p_prev_to - p_prev_from;
  -- Margen de una hora: la semana del cambio de hora dura 167 h o 169 h y eso
  -- es correcto. Cualquier otra diferencia es comparar un trozo con un entero.
  if not p_calendario and abs(extract(epoch from (v_dur - v_dur_p))) > 3600 then
    raise exception
      'report_sales: las ventanas no duran lo mismo (% vs %). Un periodo parcial no se compara con uno completo.',
      v_dur, v_dur_p;
  end if;
  return true;
end;
$fn$;

comment on function public._report_ventanas_validas(timestamptz, timestamptz, timestamptz, timestamptz, boolean) is
  'Regla de las dos ventanas del generador de informes. Vive fuera de report_sales para que se pueda PROBAR: dentro quedaba detras de la guarda de cuenta y era inalcanzable.';
