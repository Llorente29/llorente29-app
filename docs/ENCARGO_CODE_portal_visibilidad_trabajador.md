# ENCARGO CODE — Portal del trabajador: visibilidad de datos sensibles (F8)

> Complementa el arranque de F4. Aplica a CUALQUIER pantalla que vea el TRABAJADOR (portal / app del
> trabajador), no a las de gestión del manager. Los flags y el resolutor ya están en BBDD (07/08).

## Regla dura
El portal del trabajador **NO muestra ningún dato sensible sin su flag de visibilidad**. Cuatro datos:
bolsa de horas, horas nocturnas, coste laboral, avisos de convenio/cumplimiento.
Todos **invisibles por defecto**. Coherente con F8 "tono suave, nunca semáforos de culpa".

## Cómo consultarlo (una sola llamada)
RPC `worker_portal_visibility(p_employee_id uuid)` → devuelve 4 booleanos:
`show_hour_bank, show_night_hours, show_labor_cost, show_compliance`.
El portal lo llama una vez al cargar y **oculta cada bloque cuyo flag sea false**. No repartir la
comprobación por pantallas: preguntar aquí, respetar la respuesta.

- `show_hour_bank` ya combina el flag global (`app_settings.show_hour_bank_to_employee`) con el
  individual (`employees.show_hours_balance`). Basta con que uno diga no.
- Estado hoy (Llorente29): los 4 salen **false** para todos (bolsa oculta porque los 6 empleados tienen
  `show_hours_balance=false`). Es el comportamiento correcto: no enseñar nada sensible por defecto.

## Config (dónde se encienden)
`app_settings` (fila global, scope='global'): `show_night_hours_to_employee`, `show_labor_cost_to_employee`,
`show_compliance_to_employee`. La bolsa individual se activa por empleado en `employees.show_hours_balance`.
La pantalla de ajustes del manager debería exponer estos 3 nuevos junto al de la bolsa que ya existe.

## DEUDA declarada (para cliente 2)
`app_settings` es GLOBAL, no por cuenta → estos flags son iguales para todos los clientes. Cuando entre
el cliente 2 y cada cliente deba decidir su propia visibilidad, hay que mover estos flags a una tabla por
cuenta. Hoy con un cliente no molesta; anotado para no olvidarlo al escalar.

## Verificación
Con los flags en false (default), el portal NO debe pintar nocturnas/coste/cumplimiento/bolsa.
Activar `show_night_hours_to_employee=true` en la fila global → el bloque de nocturnas aparece.
