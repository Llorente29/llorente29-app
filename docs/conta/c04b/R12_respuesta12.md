# C04b · Respuesta 12 — la comprobación de después del real #59 (13/10)

**Sin importes**: el repositorio es público. Los importes están en el chat.
Todo en producción y solo leyendo.

## 0 · Justo después del real (10:05–10:10 UTC del 13/10)

| Medida | Resultado |
|---|---|
| Historial | los seis (0100–0140), «real 38380236640 · Llorente29» |
| Asientos de ventas de octubre (01–12/10) | **50**, todos propuestos, creados a las 10:00:07 UTC (dentro de la 0130) |
| Por plataforma | Glovo 21, Uber 24, Just Eat 5 |
| Del día entero / con marca en la unidad | 0 / 0 |
| Repetidos (local, día, unidad) / descuadrados | 0 / 0 |
| `conta_dias_por_asentar(01/10–12/10)` | 0 |
| `_copia_ventas_dia_entero` / `_retirado_ventas_por_plataforma` (07:52) | 24 / 24 |
| Cierre de las 10:07 UTC, ya con las funciones nuevas | `succeeded`; no propone nada (siguen 50 resúmenes y 50 asientos, sin registro nuevo) |

**Agente «Libro diario»** en producción, el fichero entero
(`scripts/conta/agente-libro.sql` con las directivas de psql resueltas), y su
juez (`agente-libro.mjs`): **en verde las doce comprobaciones**, con 14.933
asientos validados, 39.447 apuntes y 50 propuestos esperando. Es la foto de
partida para la de mañana.

**Un hueco del agente, apuntado y no arreglado aquí.** `dia_sin_asiento` da
un día por asentado si tiene algún resumen. Con la regla nueva, a un día le
podría faltar una plataforma (Uber sin su 430, por ejemplo) y el agente
seguiría en verde. Hoy no esconde nada: `conta_dias_por_asentar`, que sí va
por plataforma, da 0 del 01 al 12/10. Es para un arreglo aparte.

## 1 · El cierre de las 02:07 del 13/10 (00:07 UTC del 14/10)

_Pendiente: se mira a las 00:20 UTC._

## 2 · Los agentes al amanecer

_Pendiente: se mira a las 07:00 UTC del 14/10, con la misma vara que §0._
