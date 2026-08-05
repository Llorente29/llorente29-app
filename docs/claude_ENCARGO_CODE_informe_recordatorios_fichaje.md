# ENCARGO CODE — Informe de recordatorios de olvido de fichaje (oficina)

## Contexto (backend YA vivo)

La tabla `clockout_reminder_log` registra cada recordatorio de olvido de fichaje
de salida enviado a un empleado. Columnas relevantes:
- `employee_id`, `account_id`
- `clock_entry_id` (la jornada olvidada)
- `scheduled_end` (hora teórica de salida de esa jornada, texto "HH:MM")
- `status` (`queued` / `sent` / `failed` / `skipped`)
- `skip_reason`, `error`
- `created_at` (cuándo se detectó/encoló), `sent_at` (cuándo se envió)
- `provider_message_id` (wamid de Meta si se envió)

Este encargo es SOLO la pantalla/informe de oficina. NO tocar backend.

## Por qué (valor para el gestor)

Doble propósito, dicho por el cliente:
1. **Protección legal:** demostrar cuántas veces y cuándo se avisó a cada
   empleado. Si ignora los avisos y sigue olvidando, la responsabilidad es suya
   (consta que se le ayudó).
2. **Eficiencia del aviso:** ver si el recordatorio funciona (¿ficha tras
   recibirlo?) o si a alguien hay que hablarle en persona.

## Qué construir

Una vista en el módulo **TEAM** (oficina), pestaña o sección "Recordatorios de
fichaje" (ubicar junto a Fichajes/Informes de personal — RECON de dónde encaja).

### Tabla principal: por empleado

Columnas:
- **Empleado**
- **Total avisos** (todos los `status='sent'`)
- **Este mes** / **Esta semana** (filtros de fecha sobre `created_at`)
- **Último aviso** (fecha del más reciente)
- **Recordatorio activo** (el valor de `employees.forgot_clockout_reminder`: ✅ activado / ⚠️ renunció)

Al pinchar un empleado → detalle con el **listado de cada aviso**: fecha/hora,
hora teórica de salida (`scheduled_end`), estado (enviado/falló/omitido con motivo).

### Eficiencia (opcional pero valioso)

Por cada aviso, indicar si el empleado **fichó su salida después** de recibirlo:
- Cruzar `clock_entry_id` (la entrada abierta que disparó el aviso) con si esa
  jornada acabó teniendo una salida posterior a `sent_at`.
- Mostrar: "Fichó tras el aviso" ✅ / "No fichó" ❌ (el manager lo corrigió a mano).
- Un % de eficacia por empleado ("de 8 avisos, fichó tras 6 = 75%").

### Export

Botón para exportar a Excel (patrón de los otros informes de TEAM, p.ej.
`trainingComplianceExcelService.ts` o `exportGestoriaService.ts`): un anexo con
empleado, fecha de cada aviso, estado, y si fichó después. Esto es el documento
de protección legal.

### Servicio

`src/services/clockoutReminderReportService.ts`:
```typescript
export interface ReminderRow {
  employeeId: string
  employeeName: string
  totalSent: number
  thisMonth: number
  thisWeek: number
  lastAt: string | null
  reminderActive: boolean
}
export async function getReminderSummary(accountId: string, range?: {from: string; to: string}): Promise<ReminderRow[]>
export async function getReminderDetail(employeeId: string): Promise<Array<{ createdAt: string; scheduledEnd: string; status: string; clockedOutAfter: boolean }>>
```

Lee `clockout_reminder_log` (RLS ya filtra por cuenta). Para `clockedOutAfter`,
cruzar con `clock_entries`: ¿hay una salida del mismo empleado posterior a
`sent_at` que cierre esa jornada?

## Reglas

- NO tocar backend, detección, Edge, cron. Solo lectura + UI + export.
- Aislamiento: la RLS ya filtra por cuenta; verificar que no se ven empleados de
  otras cuentas.
- Build verde. Directo a main.

## Verificación

1. La tabla lista los empleados con su recuento de avisos (hoy 0, aún no hay
   olvidos reales enviados — la tabla debe soportar el estado vacío con elegancia).
2. El detalle de un empleado muestra sus avisos individuales.
3. El export genera un Excel con el anexo de avisos.
