# Cierre del día · 2 — el cierre también propone

Encargo de Julio del 11/10. Medido en producción **en solo lectura** el 11/10;
la empresa es una (Foodint, `658728c0…`), y cada cifra lleva de qué cuenta es.

## El porqué, en una frase

**El cron horario solo cierra pedidos: los resúmenes y los asientos de ventas
del día los crea únicamente `journal_entry_proponer`, a la que solo llama el
botón «Proponer» del Libro diario, y nadie lo ha pulsado desde el 09/10 a las
15:16 UTC.**

### La prueba

1. Lo que corre el cron (`cron.job`):

   | jobname | schedule | command |
   |---|---|---|
   | conta-cierre-del-dia | `7 * * * *` | `call public.conta_cierre_del_dia_todas()` |

   `conta_cierre_del_dia_todas` llama, por empresa, a `conta_cerrar_dias`, que
   **solo** pasa a `cancelled` los pedidos de marca propia que siguen abiertos
   en un día cerrado y apunta cada uno en `sales_day_close_log`. Por eso el
   registro tiene el 07, el 08, el 09 y el 10, y el cron sale `succeeded`.

2. Quién escribe `sales_day_summary`: en `pg_proc` solo
   `journal_entry_proponer` lo inserta, y no hay ningún disparador que lo haga.
   En el código solo la llaman `propuestasLibroService.proponerPendientes` (el
   botón «Proponer» de `LibroDiarioPage`) y `librosService`. Además exige
   `current_user_is_admin_or_manager_of`: sin una persona, no propone.

3. Los 12 resúmenes de octubre son **un solo clic**, de Julio
   (`created_by 673fca49…`), el **09/10 entre las 15:15:56 y las 15:16:01 UTC**:

   | día | local | tickets | total | asiento |
   |---|---|---:|---:|---|
   | 01 | Alcalá | 20 | 385,60 | propuesto |
   | 01 | Carabanchel | 1 | 15,80 | propuesto |
   | 02 | Carabanchel | 9 | 256,78 | propuesto |
   | 03 | Alcalá / Carabanchel | 42 / 6 | 1.042,55 / 167,74 | propuesto |
   | 04 | Alcalá / Carabanchel | 35 / 20 | 911,23 / 515,84 | propuesto |
   | 05 | Alcalá / Carabanchel | 21 / 5 | 547,66 / 105,47 | propuesto |
   | 06 | Alcalá | 25 | 535,00 | propuesto |
   | 08 | Alcalá | 17 | 424,46 | propuesto |
   | 09 | Carabanchel | 1 | 16,90 | **ninguno** |

4. Por qué falta el 07, y el 06 y el 08 de Carabanchel: a las 15:15 del 09/10
   esos días tenían pedidos de marca propia todavía abiertos (no confirmados).
   El cierre del día los cerró a las **22:07 UTC del 09/10** (su primera pasada,
   `cancel_reason` «No confirmado por la plataforma al cierre del día (6:00)»),
   y el núcleo no propone un día con pedidos abiertos («El cierre del día aún
   no ha pasado por este día…»). El 02 de Alcalá no salió porque el botón
   propone un mes cada vez, del más reciente hacia atrás.

5. El «día 09 con 1 tique»: el botón de antes del cierre del día propuso el 09
   a media jornada. La 0130 del 09/10 (`20261016T0130_cierre_del_dia_retirar`)
   **retiró ese asiento** (`b4eb11ca…`, copia en `_retirado_cierre_del_dia`,
   `retirado_at` 21:14 UTC) y dejó el resumen sin asiento, para que el día se
   propusiera entero a su hora. Pero nadie lo volvió a proponer.

6. La 0130 **no apagó nada**: `_backup_cierre_del_dia_proponer` guarda las
   versiones anteriores de `conta_pedidos_del_dia` y `conta_dias_por_asentar`,
   que cambió la 0120 (no proponer un día sin cerrar). En el servidor no había
   ningún paso de proponer que apagar: nunca lo hubo.

Lo que falta hoy, según la propia `conta_dias_por_asentar` (01–11/10): **9
días×local** — Alcalá 02, 07, 09, 10; Carabanchel 06, 07, 08, 09, 10.

## El arreglo

Julio eligió (11/10) que proponga el cron. Tanda `20261018T01xx`:

| fichero | qué | analizador (contra producción) |
|---|---|---|
| `0100_cierre_proponer_solo` | `conta_propuesta_ventas_dia` (la regla del botón, en SQL, solo lee); `_journal_entry_proponer` (proponer sin usuario, con un cerrojo por día y local); `journal_entry_proponer` llamándola, misma firma; `sales_day_proposal_log` (qué pasó con cada día, y por qué no se propuso); `conta_proponer_dias`; el procedimiento horario **cierra y después propone** | **sigue** (cambia en caliente, declarado, con prueba) |
| `0110_cierre_proponer_dias_datos` | copia y borra el resumen a medias del 09/10 de Carabanchel y hace la primera pasada; **para** si un día falla, si el 09 no queda con un resumen entero y su asiento, o si queda un día de octubre cerrado sin asiento y sin porqué | **autorizo** (borra una fila de `sales_day_summary`) |

- **Sin duplicar** (punto 3 del encargo): el 09/10 se sustituye por el día
  entero (7 tickets, 150,50 €). El índice único (empresa, local, día) no deja
  dos, y el cerrojo impide que el botón y el cron choquen.
- **No valida nada.** «Validar solos los Seguros de ventas» lo sigue haciendo
  solo el botón (en producción está apagado: `journal_autovalidate_sales_day =
  false`).
- **El botón sigue igual**: misma función, mismo permiso. Si el cron ya lo
  propuso, dice «ya estaba».
- Sin corte y con ventas de antes del ejercicio, el botón pregunta desde
  cuándo asienta Folvy. Eso es de una persona: el cron no propone ese
  ejercicio (no es el caso de Foodint, con corte el 30/09).

### Que la base proponga lo mismo que el botón (regla 31)

Se mide en producción, en solo lectura: el cuerpo de
`conta_propuesta_ventas_dia` se ejecuta como un `SELECT`, y su resultado se
compara de dos maneras:

1. **Contra los 11 asientos que propuso el botón el 09/10**: líneas (cuenta,
   debe, haber, concepto, marca, base y facturas del IVA), porqué, razones (el
   JSON exacto), confianza, concepto, tickets, total, huella y pedidos.
   **11 de 11 iguales.**
2. **Contra el núcleo TS (`ventasDelDia`) sobre los mismos pedidos**, en los
   20 días×local del 01 al 10/10, incluidos los 9 que no tienen asiento:
   **20 de 20 iguales**, con los apuntes en el mismo orden
   (`scripts/conta/paridad-ventas-dia.ts`; el volcado de producción se guarda
   fuera del repositorio).

   La primera pasada dio 20 «distintos» en las razones. No era la regla: el
   `jsonb` ordena las claves de cada objeto y `JSON.stringify` las deja como
   vienen. Con las claves ordenadas a los dos lados, 20 de 20.

Lo que propondría la tanda para los 9 que faltan (del mismo `SELECT`):

| día | local | tickets | total | confianza |
|---|---|---:|---:|---|
| 02 | Alcalá | 28 | 608,09 | probable |
| 06 | Carabanchel | 6 | 156,20 | probable |
| 07 | Alcalá | 25 | 522,09 | probable |
| 07 | Carabanchel | 15 | 327,86 | probable |
| 08 | Carabanchel | 3 | 60,60 | probable |
| 09 | Alcalá | 35 | 825,74 | probable |
| 09 | Carabanchel | 7 | 150,50 | probable |
| 10 | Alcalá | 35 | 985,62 | probable |
| 10 | Carabanchel | 13 | 322,80 | probable |

«probable» porque algún pedido de cada día no trae la base y se calcula al
10 %, igual que en los 11 que ya están.

### La prueba de staging (`20261018_cierre_proponer_prueba.sql`)

Ramas hechas a mano, cada una con su cuenta: base traída y calculada, cedida,
cancelado, sin 430, abierto, resumen a medias, descartado; otra pasada sin
duplicar; el botón (B no propone en A; A recibe «ya estaba»); las puertas (sin
usuario nadie llama a las funciones del servidor; B no lee el registro de A); y
el procedimiento cerrando antes de proponer. El procedimiento tiene COMMIT y
no se puede llamar dentro de la transacción de la prueba: su pasada de verdad
se comprueba en staging a los :07, en `cron.job_run_details` y en
`sales_day_proposal_log`.

## El agente (punto 4 del encargo)

`agente-libro.sql`, comprobación 12, **`dia_sin_asiento`**, en rojo: un día
cerrado de un ejercicio abierto, después del corte y de un mes sin cerrar, sin
descartar, de una empresa con su plan (con su 700), que **24 h después de su
hora de cierre** no tiene resumen con asiento vivo. Dice, por día y local,
cuántos pedidos tiene, las horas desde el cierre y si al menos hay resumen.

Medido en producción el 11/10 (solo lectura, antes de la tanda): **7 en rojo**.
Son 02 Alcalá (206 h), 06 Carabanchel (110 h), 07 Alcalá y Carabanchel (86 h),
08 Carabanchel (62 h), 09 Alcalá (38 h) y 09 Carabanchel (38 h, «con resumen
pero sin asiento»). El 10/10 aún no ha cumplido sus 24 h. Con este agente el
hueco del 09 al 11/10 habría salido en rojo la primera noche.
