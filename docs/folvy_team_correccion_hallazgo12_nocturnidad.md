# Nocturnidad — medición correcta (07/08/2026)

> ⚠️ Este doc tuvo una versión intermedia ERRÓNEA (decía 1,9% de horas nocturnas). Salió de una función
> de cálculo con un bug. Los números buenos son los de abajo, verificados con la función ya corregida y
> validada contra 7 casos de frontera.

## Hallazgo 12 original (06/08)
> "194 de 207 jornadas (94%) terminan entre 22:00 y 06:00 → toda la plantilla es legalmente nocturna."

## Medición correcta (120 días, cuenta Llorente29, solapamiento real con franja 22:00–06:00 Madrid)
| Medida | Resultado |
|---|---|
| Jornadas totales | 259 |
| Jornadas **con horas nocturnas** | **195 (75%)** |
| **Horas nocturnas reales** | **422,8 h** |
| **% de horas nocturnas sobre el total** | **28,97%** |
| Jornadas que superan 1/3 en franja (criterio ET trabajador nocturno) | **142** |

## Veredicto
El hallazgo 12 **apuntaba a algo real**. Su formulación ("termina entre 22:00 y 06:00 → 94%") es una
aproximación floja —salir a las 22:10 son 10 minutos nocturnos, no una jornada nocturna— pero la conclusión
de fondo se sostiene: **la nocturnidad en Foodint es material, no marginal**.

Cifra defendible a partir de ahora: **29% de las horas trabajadas son nocturnas** y **142 jornadas cumplen
el criterio del art. 36.1 ET** (más de 1/3 de la jornada en franja).

## Consecuencias reales
1. **Plus de nocturnidad**: 422,8 h en 120 días que hoy el sistema no identifica ni valora. Es dinero que
   se paga (o se debería pagar) sin trazabilidad.
2. **Trabajador nocturno (art. 36 ET)**: 142 jornadas superan el umbral. Para quien califique: jornada
   máxima de 8 h de media en 15 días y **horas extra prohibidas**. Cruzar con el hallazgo 13
   (Johanny +60,9 h sobre contrato) — si es nocturno, el problema es mayor de lo que parecía.
3. **Producto**: confirma que la nocturnidad es núcleo, no accesorio. Sesame la cobra como **add-on desde
   13 €/empleado/mes**; Folvy nativa. El argumento comercial se mantiene íntegro.

## Regla de cálculo (no negociable)
La nocturnidad se computa por **solapamiento real** de la jornada con la franja (configurable por convenio,
por defecto 22:00–06:00), **nunca** por la hora de salida. Implementado en `night_minutes_in_span()`,
validado contra 7 casos incluidas las fronteras (salida exacta a las 22:00 → 0 min; salida 22:10 → 10 min;
jornada que cruza dos noches → 480 min).

## Lección de método (dos, y ambas caras)
1. Un porcentaje llamativo con definición aproximada puede invertir una prioridad. Medir con la definición
   legal exacta antes de usarlo.
2. **Y al revés: no desmentir un hallazgo con un cálculo sin validar.** La primera medición "corrigió" el
   hallazgo 12 a la baja usando una función con bug, y estuvo a punto de despriorizar algo real. Toda
   función de cálculo nueva se valida contra casos con resultado conocido a mano ANTES de usar su salida
   para decidir.
