# ENCARGO CODE — F10 · Generador de cuadrantes (motor listo)

> Motores construidos y verificados en BBDD (07/08). Esto es la CARA.
> **No sustituye al generador actual**: convive. El encargado elige. Nada se borra (regla de NO DESTRUCCIÓN).

## Decisiones que este encargo NO revisa
- **Recomendado, no obligatorio** (Julio): la disponibilidad es preferencia BLANDA. El generador puede
  romperla si hace falta cubrir el servicio, pero SIEMPRE avisando y explicando. Nunca bloquea.
- **El LLM no asigna**: asigna un solver determinista. La IA queda para explicar y negociar, no para repartir turnos.
- `schedules.cells` usa **día 0 = LUNES** (fecha = week_start + día).
- Semáforo reservado a COBERTURA. Paleta de marca.

## RPCs listos

### `infer_employee_availability(p_account, p_location default null)` — la propuesta
`employee_id, employee_name, day_of_week, shift_period, veces_asignado, semanas_observadas, ratio,
 sugerencia, confianza ('alta'|'media'|'baja'), motivo`
- **No escribe nada. Propone.** El encargado confirma o corrige.
- `confianza='alta'` = patrón fijo o "nunca en N semanas". `'baja'` = menos de 4 semanas de historial.
- `motivo` es texto legible para enseñar tal cual: "Nunca asignado en 9 semanas".

### `apply_inferred_availability(p_account, p_location, p_overwrite default false)` — confirmar
Escribe en `employee_availability` solo lo de confianza alta, marcando `note='Inferido del historial · …'`.
**No pisa lo que el encargado haya puesto a mano** salvo `p_overwrite=true`.

### `propose_schedule(p_account, p_location, p_week_start)` — el generador
`dia, day_of_week, shift_template_id, shift_label, employee_id, employee_name, motivo, rompe_preferencia`
- `rompe_preferencia=true` → pintar en ámbar con el motivo (no en rojo: no es un error, es una decisión).
- Cada fila trae su **motivo explicable**. Enseñarlo: es lo que hace que el encargado confíe.

## Qué construir
1. **Pantalla "Disponibilidad"**: tabla empleado × día × (mañana/noche) con la propuesta inferida,
   confianza y motivo. Botón "Aplicar lo de confianza alta" (llama a `apply_inferred_availability`).
   El encargado puede editar cualquier celda a mano — y lo editado a mano NO se pisa al recalcular.
2. **Botón "Proponer cuadrante"** en Calendario: llama a `propose_schedule`, muestra el resultado como
   BORRADOR editable sobre la rejilla existente. **No guarda nada sin que el encargado acepte.**
   Avisos en ámbar donde `rompe_preferencia`. Al aceptar, escribe en `schedules.cells`.
3. **Cruce con cobertura**: tras proponer, ejecutar `schedule_coverage_gap` sobre el borrador para enseñar
   si el cuadrante propuesto cubre la demanda y cuánto cuesta. Ese es el ciclo cerrado completo.

## Por qué esto gana (benchmark 07/08)
Los líderes (7shifts, Shiftbase, ZoomShift, Shifton) resuelven dónde GUARDAR la disponibilidad, no cómo
CONSEGUIRLA. Sus propias guías admiten el fallo: "un formulario rellenado en marzo está equivocado en junio",
"la disponibilidad nunca se recogió de forma consistente: es un problema de proceso". Su solución es un
formulario en blanco que nadie rellena.
Folvy la **infiere de 564 asignaciones reales** y la puede recalcular cada mes. El dato nace lleno y no envejece.

## Verificación
Semana 24/08 Foodint Alcalá: 5 personas × 7 turnos, reparto 28,5–38,5 h (equilibrado), 4 avisos.
Johanny excluido por vacaciones (dura). Disponibilidad: 75 filas, 24 restricciones reales
(Natacha nunca martes, Pamela nunca miércoles).

## Límites declarados (decir la verdad en la UI)
- El generador reparte por **cobertura de la plantilla de turnos** (`coverage_mon..sun`), no por rol:
  `shift_templates` aún no tiene `staff_role_id` (F7.3). No prometer "1 de cocina + 1 de sala".
- No usa aún el descanso de 12 h entre jornadas como restricción dura del solver (sí lo vigila
  `team_compliance_scan` a posteriori). Declararlo como deuda, no fingir que está.
- Métrica de éxito del encargo: **≥85 % de turnos aceptados sin tocar a las 6 semanas.** Si no se alcanza,
  hay que decirlo y revisar, no maquillarlo.
