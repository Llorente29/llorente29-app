# ENCARGO CODE — Toggle de opt-out del recordatorio de olvido de fichaje

## Contexto (backend YA vivo)

Existe un sistema que avisa por WhatsApp al empleado si olvida fichar su salida
(lleva >30 min pasada su hora teórica sin fichar salida). Es opt-in con derecho
a renuncia (desconexión digital: ayuda consentida).

- Campo `employees.forgot_clockout_reminder` (boolean, default `true`) controla si
  el empleado recibe el recordatorio. Si es `false`, no se le avisa nunca.
- La detección (función SQL `enqueue_clockout_reminders`) ya respeta este campo.

Este encargo es SOLO la UI para que el empleado active/desactive su recordatorio.

## Qué construir

En el **portal del trabajador** (`src/pages/trabajador/`), en una pantalla de
ajustes/perfil del empleado (probablemente `PortalEmpleado.tsx` o una sección de
`HomeEmpleado.tsx` — verificar dónde encaja mejor un ajuste personal), añadir un
toggle:

**"Recordarme si olvido fichar mi salida"** (ON por defecto)
- Subtexto: "Si un día olvidas fichar tu salida, te avisamos por WhatsApp. Puedes
  desactivarlo cuando quieras; entonces será tu responsabilidad recordarlo."
- Al cambiar, actualiza `employees.forgot_clockout_reminder` del empleado actual.

### Servicio

El empleado NO puede hacer un UPDATE directo a `employees` (RLS). Crear una RPC
`set_my_clockout_reminder(p_enabled boolean)` SECURITY DEFINER que:
- Resuelve el empleado del usuario actual (patrón `current_user_is_employee` o el
  que use el portal para saber qué empleado es el que ha iniciado sesión).
- Actualiza solo SU propio `forgot_clockout_reminder`.
- `GRANT EXECUTE` a `authenticated`.

(RECON antes: mirar cómo el portal del trabajador resuelve "quién soy" — hay un
patrón de sesión de empleado por magic link. La RPC debe usar ese mismo criterio
para no dejar que un empleado cambie el ajuste de otro.)

Front: `src/services/employeeSelfService.ts` (o el servicio del portal que ya
exista) con `getMyReminderPref()` y `setMyReminderPref(enabled)`.

## Reglas

- NO tocar la detección ni el Edge ni el cron. Solo el toggle + su RPC.
- El toggle refleja el valor real de `forgot_clockout_reminder` al cargar.
- Build verde. Directo a main.
- Copy respetuoso con la desconexión digital (el subtexto de arriba ya lo cumple).

## Verificación

1. Empleado entra a su portal → ve el toggle en ON.
2. Lo desactiva → `forgot_clockout_reminder` pasa a `false` en BD (verificar por SQL).
3. Un empleado no puede cambiar el ajuste de otro (la RPC solo toca el suyo).
