# El día se cierra a las 6:00, y lo que sigue abierto no es venta — informe final

Encargo de Julio del 09/10. Rama `conta/cierre-del-dia`, PR #171.

## Lo que queda hecho

| Regla de Julio | Dónde | Cómo se prueba |
|---|---|---|
| 1. Cada día se cierra a una hora fija de la madrugada siguiente: 6:00 de serie, ajuste de cada empresa | `company_tax_profile.sales_day_close_time`; `conta_ultimo_dia_cerrado` / `conta_cerrado_hasta` (base) y `cierreDelDia.ts` (front), la misma cuenta | Unitarias y paso 9 de staging: los mismos 13 instantes, con los cambios de hora de octubre y marzo |
| 2. No se propone el asiento de un día antes de su cierre | `conta_dias_por_asentar` (0120) y `rangoAProponer` (hasta el último día cerrado, no hasta hoy) | Paso 3 de staging: ningún día sin cerrar. Unitarias: el 09/10 a las 17:15 propone hasta el 08/10; a las 5:59, hasta el 07/10 |
| 3. Al cierre, un pedido propio abierto se cierra como «no confirmado»: no es venta y se ve con su código y su importe | `conta_cerrar_dias` + `conta_cierre_del_dia_todas` (cron a los :07); `sale.unconfirmed_at`; rastro en `sales_day_close_log` | Paso 3: cierra exactamente lo que dice `conta_por_cerrar`, escribe solo en `sale` y en su rastro, y es idempotente. El cron real de staging a las 16:07 UTC: `succeeded` |
| 4. La liquidación tiene la última palabra | `conta_no_confirmados_pagados` (0150) + `noConfirmadoPagado`: propuesta aparte (`sales_adjustment`) con su porqué | Paso 12 de staging. Unitarias con el pedido 234 real |
| 5. El stock no vuelve | 0110: el disparador no anula un no confirmado, y en el motor cambia una línea (`v_void`) | Pasos 3, 6 y 7 (huellas iguales, regenerar no borra, cuatro caminos). Paso 8: con lo de antes, sí vuelve, y la prueba lo distingue |

## Las cifras

- **El atraso de producción** (consulta en solo lectura, 09/10): 20 pedidos, 500,79 €.
  - Por meses: agosto 5 (144,86 €), septiembre 6 (167,10 €) y octubre 9 (188,83 €).
  - 12 tienen consumo: 134 movimientos, que se quedan.
  - Lo cierra la primera pasada del cron. La lista, en el PR.
- **El asiento que se retira**: `b4eb11ca`, del 09/10 en Carabanchel, propuesto a las 17:15 de ese mismo día. No deja descarte, así que el día se volverá a proponer entero cuando cierre.
- **`conta_dias_por_asentar` de un mes**: 157,3 ms y 155,9 ms en los dos últimos runs de staging (el límite es 1 s).

## Pruebas

**Unitarias**: 965 pruebas en verde: 675 del módulo (`tests/unit/modules/conta`) y 290 de cumplimiento y producción (`tests/conta`). Entre ellas:
- el núcleo del cierre, con los cambios de hora;
- «cómo acabó» contra las 19 parejas de estado reales de producción;
- los no confirmados en las ventas del día, con los tres reales del 02/10 (71,70 €);
- la liquidación, con el 234 real;
- el agente;
- el analizador, con la tanda.

**Staging** (`20261016_cierre_del_dia_prueba.sql`, transacción con ROLLBACK): 12 pasos.
- La forma de los 20 de producción, con lo que se toca y lo que no (por tabla, con `pg_stat_xact_user_tables`).
- La frontera de las 6:00, la cuenta A y la B, regenerar el consumo y los cuatro caminos de la regla 10.
- La versión rota a propósito, los cambios de hora, menos de 1 s, retirar lo propuesto y la liquidación.

**e2e A y B, en ordenador y en móvil** (`tests/e2e/conta/cierre/cierre.spec.ts`):
- el asiento con sus no confirmados y «Ver»;
- «Hoy se cierra mañana a las 6:00» en el libro;
- la hora de cierre en Ajustes, cambiada y devuelta;
- RLS: B no ve nada de A.

Verde en la ejecución **164** (sobre `2ae0219`), las cuatro en los dos tamaños.
La 163 se quedó en rojo por una: en el móvil, la tarjeta de Ajustes no decía de
qué era la hora («6:00 (la de serie)» a secas). Ahora dice «Hora de cierre del
día: 6:00 (la de serie)». Capturas en `docs/conta/capturas/cierre/` (las subió
el e2e en `813ecee`), comparadas una a una con el encargo en su
`COMPARACION.md`.

**Agente «Libro diario»**: pone en rojo cualquier pedido de marca propia que siga abierto en un día ya cerrado. Lo da por empresa: cuántos, el día más antiguo y las horas desde que acabó.

## Lo que decidí yo y hay que mirar

1. **Lo pagado después va siempre aparte**, también si el día aún no está validado. Así se acepta o se descarta por separado, y no se puede contar dos veces. El encargo decía «complementario» solo con el día validado.
2. **La tolerancia de redondeo de la cuota**.
   - Antes era `floor(n/2)` céntimos, que con un ticket es 0, así que un día de un ticket de 20,40 € con la base calculada no se proponía.
   - Ahora es `floor(0,55·n + 0,5)`, que es el error real de redondeo. Un pedido al 21 % sigue sin pasar.
   - Toca a todos los días de ventas, no solo a este encargo.
3. **Una cuenta con dos empresas** (en staging, la A): el cierre va por la cuenta, y lo hace la primera empresa que llega a su hora. En producción, Foodint tiene una sola empresa.
4. **Entre las 6:00 y las 6:07** un día ya está cerrado pero el cron aún no ha pasado. Si alguien propone justo en ese rato, la línea lo dice («el cierre del día aún no ha pasado por este día…»). El agente corre a las 3:40 y no lo ve.

## La tanda

Va en `supabase/produccion/aplicar.txt`: siete ficheros, de la 0100 a la 0160.
- Piden `autorizo` la **0110** (el disparador de consumo está en el camino del pedido) y la **0130** (borra en `journal_entry`).
- Las otras cinco pasan solas, contra el contexto real de producción.
- La vuelta atrás, al revés, está en `supabase/produccion/vuelta-atras.txt`.

Orden de entrega:
1. Ensayo del workflow, y después el real.
2. Comprobar en producción, en solo lectura, que la primera pasada del cron ha cerrado los 20.
3. «fusiona».
4. Vercel en READY.
5. Proponer octubre día a día.

## Fuera de alcance

Marcas cedidas y las de Last, las facturas de proveedor de octubre, el tramo 2 de las políticas y Diez.
