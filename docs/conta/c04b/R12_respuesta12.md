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

Medido a las 00:21 UTC del 14/10, solo leyendo, en Foodint (cuenta 51ad1792…,
empresa 658728c0…).

| Medida | Resultado |
|---|---|
| Cierre (job 71) de las 00:07 UTC | `succeeded` (runid 971018, 00:07:00) |
| Resúmenes de ventas del 13/10 | **5**, todos con su asiento, creados a las 00:07:00 UTC |
| Por plataforma | Glovo 2, Uber 2, Just Eat 1 (2 locales) |
| Del día entero / con marca en la unidad (`unit_key` con «:») | 0 / 0 |
| Repetidos (local, día, unidad) / descuadrados | 0 / 0 |
| Estado de los 5 asientos | todos «propuesto» |
| Cobro 430 de cada local contra la suma de sus pedidos propios cerrados del 13/10 (`conta_pedidos_del_dia`) | local 1: diferencia 0,00 · local 2: diferencia 0,00 |
| `conta_dias_por_asentar(13/10, 13/10)` | 0 |
| `sales_day_proposal_log` del 13/10 | 2 filas (una por local), «propuesto», 00:07:00 |
| Asientos de ventas de octubre (vivos) | **55** = los 50 del 01 al 12/10 + 5 del 13/10 |
| Los 50 de antes | los 50 siguen siendo los creados por la 0130 (10:00:00–10:00:30 UTC del 13/10), los 50 «propuesto», 0 tocados después de las 10:05; huella de sus ids `c1d5944e863e40679702ada582cb4e43` (para compararla en §2) |

Lo que no se puede decir con esta vara: §0 no guardó la huella de los ids, así
que «mismos ids» se prueba por su ventana de creación y por no haberse tocado
después. La huella de arriba es la de partida para §2.

## 2 · Los agentes al amanecer

_Pendiente: se mira a las 07:00 UTC del 14/10, con la misma vara que §0._
