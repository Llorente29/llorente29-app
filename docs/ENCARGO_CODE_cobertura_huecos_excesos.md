# ENCARGO CODE — Cobertura: huecos y excesos con coste (F7, previo a F10)

> El motor está construido y verificado (07/08). Esto es la CARA. NO toca el generador actual.
> Benchmark: es el núcleo que 7shifts vende ("coste laboral proyectado en tiempo real antes de publicar").
> Ventaja de Folvy sobre ellos: demanda en PLATOS reales (carga de trabajo) y coste de NÓMINA REAL,
> donde ellos usan euros de venta y coste estimado del contrato.

## RPC listo
`schedule_coverage_gap(p_account uuid, p_location uuid, p_week_start date)` → una fila por fecha+hora:
`fecha, hora, required_total, assigned_total, gap, assigned_cost_hour, cost_is_partial`

- `gap` **negativo = FALTA** gente · **positivo = SOBRA**. Cero = ajustado.
- `assigned_cost_hour` = € que cuesta esa hora con la gente asignada (nómina real).
- `cost_is_partial=true` → algún asignado no tiene nómina cargada (hoy Martin y Fabiola) → **marcarlo
  visiblemente, no ocultarlo**: el coste mostrado está infravalorado.

## Qué construir
Una vista semanal (rejilla día × hora) sobre el cuadrante existente, o panel lateral:
- **Rojo** donde `gap < 0` (falta) con el número. **Ámbar** donde `gap > 0` (sobra). Neutro donde 0.
  Semáforo permitido aquí: esto ES cobertura (decisión 10/07 reserva el semáforo justo para cobertura).
- Resumen por día: faltan N horas-persona · sobran M · coste del día en €.
- Resumen de semana arriba: coste total previsto, horas que faltan, horas que sobran y **€ del exceso**.
- Al pulsar una hora en rojo: quién está disponible para cubrirla (cuando exista `employee_availability`).

## El mensaje que hace esto valioso (dato real de Foodint, semana 03/08 Alcalá)
Faltan 54 horas-persona y sobran 22 **la misma semana, y a menudo el mismo día**: sobra gente a las 16:00
y falta a las 21:00. No falta plantilla — está mal colocada. La pantalla debe hacer ver eso, no solo dar
un total. Sugerencia de copy: "El jueves te faltan 11 h-persona en el pico y te sobran 4 en el valle".

## Verificación
Semana 03/08, Foodint Alcalá: coste ~1.620 €, faltan 54, sobran 22 (~268 € de exceso), domingo el día
más tenso (req 30 vs 24 asignadas). Si los números no cuadran con el RPC, es la pantalla, no el motor.

## Límites declarados (decir la verdad en la UI, no tapar)
- El desglose **por rol** no existe todavía: `shift_templates` no tiene `staff_role_id` (F7.3 pendiente).
  Hoy el hueco es TOTAL de personas, no "falta 1 de cocina". No inventarlo.
- `required` solo cuenta roles con demanda real (cocina, reparto). Servicio/otro no tienen driver.
