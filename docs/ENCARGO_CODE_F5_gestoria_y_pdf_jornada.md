# ENCARGO CODE — F5 · PDF de jornada + Cierre de mes / gestoría

> Motores construidos y verificados en BBDD (07/08). Esto es la CARA.
> Del encargo de 12 fases: "la pantalla que más se usa y la que hoy no existe bien".
> Un cliente de hostelería pregunta por la INSPECCIÓN y por la GESTORÍA antes que por nada.

## Reglas que este encargo NO revisa
- Paleta de marca: marino `#1E3A5F`, terracota `#D67442`, crema `#F5F4F0`. Claro por defecto.
- `show_salaries` gatea todo lo que muestre dinero por persona.
- Horas del PDF = REALES, nunca redondeadas (el redondeo no es oponible en inspección).
- Build verde con `tsc`. No tocar `App.tsx` sin permiso.

## RPCs listos
### `registro_jornada_mensual(p_employee_id, p_from, p_to)` — detalle del PDF
`dia, entrada, salida, minutos_trabajados, minutos_pausa, minutos_nocturnos, es_festivo, festivo_nombre, ausencia_tipo`
- Devuelve **todos** los días, incluidos los no trabajados (deben constar, no desaparecer).
- Una jornada **partida** aparece como **dos filas del mismo día**: pintar ambos tramos, no colapsar.

### `registro_jornada_totales(p_employee_id, p_from, p_to)` — cabecera/pie del PDF
`dias_trabajados, tramos, horas_trabajadas, horas_pausa, horas_nocturnas, dias_vacaciones, dias_baja, dias_festivo_trabajado, horas_contratadas, delta_horas`

### `export_gestoria_mensual(p_account, p_from, p_to)` — tabla del cierre de mes
Una fila por empleado + columna **`incidencias`** (lo que impide cerrar con confianza).

## F5.1 · PDF de registro de jornada (RD-ley 8/2019, art. 34.9 ET)
Por empleado y mes. Debe incluir:
- **Empresa**: `accounts.legal_name` + `cif` (verificados rellenos: "Llorente29 Food, S.L." / B56496938).
- **Trabajador**: `employees.name` + `dni` (los 6 activos tienen DNI).
- Tabla diaria: fecha, entrada, salida, descanso, total del día. Días de ausencia/festivo constan con su etiqueta.
- Totales del periodo + nota de conservación 4 años + espacio de firma.
- Botón en **Plantilla** (todos) y en **Ficha** (uno).
- Generar con jsPDF (ya se usa en el proyecto).

## F5.2 · Cierre de mes / export a gestoría
Tabla de `export_gestoria_mensual` + export **CSV y PDF**. Y arriba, **bloqueos visibles**: qué impide cerrar
el mes y quién lo resuelve. Hoy en Llorente29 (julio) saldría:
- los 6 con "sin descansos registrados" (el fichaje de pausa existe desde hoy y aún no se usa),
- Marlón con "posible fichaje de salida olvidado",
- Mirlenys con "desvío de -83,3 h sobre contrato".
**No ocultar las incidencias**: es lo que diferencia un export honesto de uno que pasa datos sucios al asesor.

## Verificación
Julio 2026, Llorente29: Johanny 24 días / 35 tramos / 175,47 h / 45,37 h nocturnas / delta -1,67.
Natacha 21 días / 160,82 h / 7 días de vacaciones / delta +23,68. Deben cuadrar con Plantilla (misma fuente).

## Avisos
- `account_gestoria_config` tiene 3 filas **vacías y desactivadas** (sin nombre ni email). El envío
  automático no puede funcionar hasta que Julio las rellene: mostrar aviso claro en la pantalla, no fallar en silencio.
- `horas_pausa` sale 0 en todos: correcto hoy (nadie ha usado el fichaje de pausa todavía). En el PDF la
  columna "descanso" saldrá vacía → refuerza la urgencia del botón de Pausa en el kiosko (F9).
