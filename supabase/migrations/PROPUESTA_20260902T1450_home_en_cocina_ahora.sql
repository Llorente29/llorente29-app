-- PROPUESTA — NO APLICADA. Requiere el visto bueno de Julio.
-- supabase/migrations/PROPUESTA_20260902T1450_home_en_cocina_ahora.sql
--
-- Para la tarjeta «En cocina ahora» del Inicio (§1.x de la maqueta) hace falta
-- saber quién está dentro POR LOCAL. Hoy eso se puede saber, pero solo de uno
-- en uno: `employee_clock_status(p_employee_id)`.
--
-- ── POR QUÉ UN ENVOLTORIO Y NO UNA CONSULTA NUEVA ──────────────────────────
-- La tentación es escribir en el front «último fichaje no anulado = entrada».
-- Sería una SEGUNDA definición de «estar dentro», y `employee_clock_status` ya
-- resuelve cuatro cosas que esa versión ingenua se deja:
--
--   1. `pausa_inicio` y `pausa_fin` también son «trabajando». Quien está en su
--      descanso no se ha ido a casa.
--   2. Ordena por `real_datetime` y no por `datetime`, porque 68 fichajes
--      llevan redondeo y el orden oficial no siempre es el orden real.
--   3. Distingue «fuera» de «sin fichajes»: si el último evento es de otro día,
--      la ficha no dice «Fuera» sin más.
--   4. NO usa ventana de día para decidir si está dentro. Esto es lo caro: el
--      servicio cierra pasada la medianoche —hoy hay salidas a las 00:15, 00:18
--      y 00:19— así que quien entra a las 22:00 y sigue dentro a las 00:30 NO
--      tiene ningún fichaje «de hoy». Una tarjeta con ventana de día diría
--      «0 en cocina» en mitad del cierre, con dos personas dentro.
--
-- Así que el criterio se queda donde está y esto solo lo aplica en bloque: una
-- llamada por empleado, del lado del servidor, en una sola ida y vuelta.
--
-- Solo locales ACTIVOS, por lo mismo que la tarjeta de cuadrantes: Plaza
-- Castilla está cerrado y no puede aparecer con «0 dentro» para siempre.
--
-- PENDIENTE DE DECIDIR: se agrupa por `employees.location_id`. Existe también
-- `assigned_locations`; si alguien trabaja habitualmente en dos locales, esta
-- versión lo cuenta solo en el suyo de ficha. Con la plantilla de hoy (6
-- personas, cada una en un local) no cambia nada, pero hay que decirlo.

create or replace function public.home_en_cocina_ahora(
  p_account_id uuid,
  p_location_id uuid default null
)
returns table (
  employee_id   uuid,
  nombre        text,
  location_id   uuid,
  location_name text,
  estado        text,
  abierta_desde timestamptz,
  minutos_hoy   numeric
)
language sql
stable
set search_path to 'public'
as $$
  -- SECURITY INVOKER a propósito (es el defecto): así manda la RLS de
  -- `employees`, y `employee_clock_status` hace además su propia comprobación
  -- de cuenta. Dos puertas, ninguna abierta de más.
  select e.id, e.name, l.id, l.name,
         s.j->>'estado',
         nullif(s.j->>'abierta_desde','')::timestamptz,
         nullif(s.j->>'minutos_hoy','')::numeric
  from employees e
  join locations l on l.id = e.location_id and l.active
  cross join lateral (select public.employee_clock_status(e.id) as j) s
  where e.account_id = p_account_id
    and e.active
    and (p_location_id is null or e.location_id = p_location_id)
  order by l.name, e.name;
$$;

revoke all on function public.home_en_cocina_ahora(uuid, uuid) from public, anon;
grant execute on function public.home_en_cocina_ahora(uuid, uuid) to authenticated;

-- ── Verificación con los datos de HOY (02/09, ~14:38 de Madrid) ────────────
do $verif$
declare v_dentro int; v_total int; v_plaza int;
begin
  select count(*) filter (where estado = 'trabajando'), count(*)
    into v_dentro, v_total
  from public.home_en_cocina_ahora('51ad1792-6629-4ef7-833a-b57b09a86710');

  -- Johanny (Alcalá, entrada 12:21) y Keilymar (Carabanchel, entrada 12:40).
  if v_dentro <> 2 then
    raise exception 'deberia haber 2 trabajando y hay %', v_dentro;
  end if;
  -- Seis en plantilla activa, ninguna de Plaza Castilla (cerrado).
  if v_total <> 6 then
    raise exception 'deberia devolver 6 empleados activos y devuelve %', v_total;
  end if;

  select count(*) into v_plaza
  from public.home_en_cocina_ahora('51ad1792-6629-4ef7-833a-b57b09a86710')
  where location_name = 'Foodint Plaza Castilla';
  if v_plaza <> 0 then
    raise exception 'un local cerrado no puede aparecer (% filas)', v_plaza;
  end if;

  raise notice 'VERIFICACION OK: 2 dentro de 6, sin locales cerrados';
end;
$verif$;
