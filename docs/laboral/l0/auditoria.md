# L0 · Auditoría de Personal y del portal de Folvy

> Encargo L00 (Julio, 27/10/2026). Solo lectura, salvo el arreglo del punto 4,
> que va en su propio PR. Medido en producción el 27/10/2026 entre las 10:30 y
> las 11:40 UTC. Cada cifra lleva entre corchetes la consulta que la saca
> (anexo A). Números agregados: sin nombres ni DNI.

## Lo primero, en siete líneas

1. **Las nóminas y los contratos en PDF están abiertos a cualquiera.** El bucket
   `employee-documents` es público y tiene una política que deja leer, cambiar y
   borrar a todo el mundo, también sin sesión. Hay 35 ficheros [Q20]. Es lo más
   grave de la auditoría y no puede esperar a la L1.
2. **Un trabajador con sesión ve los datos de todos sus compañeros:** salario,
   DNI, PIN del kiosko, fichajes con GPS, nóminas y bajas médicas. Probado
   entrando como un trabajador real, en solo lectura [Q19].
3. **El registro de jornada no es inalterable.** Corregir y anular deja rastro
   con el antes y el después. Pero añadir una marca directamente (sin pasar por
   las funciones de corrección) no deja ninguno. Además, cualquiera de la cuenta
   puede fichar por otro y poner la hora que quiera [Q3, Q4].
4. **El aviso de olvido por WhatsApp no avisa de los olvidos.** De los 51 avisos
   enviados, 48 fueron a gente que ya había fichado la salida, 11 de ellos de
   madrugada. Y los 19 olvidos reales desde el 05/08 no recibieron ninguno
   [Q11, Q12]. Los 64 fallos de agosto y septiembre no los vio nadie, y hoy
   tampoco los vería nadie.
5. **Hay 21 olvidos en Foodint desde el 01/08** (de unas 490 jornadas). Solo 4
   pasaron por una petición del trabajador. El resto lo corrigió el encargado
   directamente, o no lo corrigió nadie: 6 jornadas de 16,8 h de media siguen en
   el registro tal cual [Q8, Q9].
6. **Las nóminas de la gestoría no entran desde el 04/08.** Solo se leyeron dos
   tandas (junio y julio, 13 nóminas, todas bien). Ninguna separa el IRPF de la
   Seguridad Social del trabajador [Q16, Q17].
7. **El origen del fichaje ya se guarda bien** con el PR del arreglo. Lo antiguo
   no se toca. De los 1.478 fichajes antiguos de Foodint, 429 son del móvil
   seguro; el resto, sin distinguir [Q14].

**Lo que no he podido leer:** `sumied_laboral_estudio.md` y
`sumied_laboral_inventario.md` no están en el repositorio (en ninguna rama) ni
en Drive. Viven en el proyecto de claude.ai, que desde esta sesión no se ve. He
trabajado con la página «Laboral y Mi portal», que resume el estudio. Por eso la
columna «Funciones del inventario» del §1 dice **la función con palabras y no su
número** (8.3, 2.38…). Con el inventario delante, casarla es media hora: va como
primera tarea de la L1.

---

## 1 · Inventario de lo que hay

**Cómo se ha medido el uso.** No hay ninguna medida de visitas. La base no las
guarda, y Vercel no tiene la analítica activada (la consulta devuelve «Web
Analytics not found»). Así que el uso de cada pieza se cuenta por **lo que
escribe** en los últimos 60 días, en todas las cuentas [Q1]. Una pantalla que
solo lee aparece como «solo lee».

**Las cuentas.** Foodint es la única con uso real. Casa Lola tiene 666 fichajes
creados todos el mismo día [Q2]: es una carga de datos, no uso, y la cuento
aparte. Folvy Interno (la plantilla) y Kitchen Grill no tienen nada.

### 1.1 · Pantallas de la empresa (`/personal`, módulo «Folvy Team»)

| Pieza | Qué hace | Uso en 60 días [Q1] | Función del inventario | Propuesta |
|---|---|---|---|---|
| **Empleados** (`StaffPage`, 2.865 líneas) | Lista y ficha con pestañas (Datos, Fichajes, Bolsa, Docs, Acceso). Desde la ficha, el encargado ficha a mano por otro, corrige «¿salida sin fichar?» y da acceso al portal | Fichas tocadas en Foodint: 0. Altas: 11 (Casa Lola, la carga) | Alta y ficha de la persona; acceso al portal; corrección de fichajes | **Se rehace** como «Equipo» y «La ficha de una persona» (maquetas 3 y 4). Se aprovechan la lógica de acceso (`manage-employee`) y la corrección vía `add_manual_clock_entry` |
| **Ahora mismo** | Quién está trabajando en cada local, contra el cuadrante publicado | Solo lee | Presencia en tiempo real | **Se aprovecha** su cálculo para la banda de «Equipo» («Trabajando ahora», «Sin fichar y les toca») |
| **Control horario** (`FichajesGlobal`) | Todas las marcas, con filtros; añadir, editar y anular con motivo; historial de cambios; resolver peticiones | 20 correcciones del administrador y 6 peticiones resueltas (Foodint) | Registro de jornada; corrección con rastro; peticiones | **Se aprovecha** el motor (las RPC con motivo y la auditoría). **Se rehace** la pantalla como «Registro de jornada» (maqueta 5) |
| **Recordatorios de fichaje** | Informe de los avisos de WhatsApp enviados, con Excel | Solo lee | Aviso de olvido; prueba de la desconexión digital | **Se rehace** dentro de «Registro de jornada»: hoy enseña avisos que en su mayoría son falsos (§3) |
| **Kiosko de fichaje** | La tablet del local: elegir persona, PIN y fichar, con GPS | No se puede saber: hasta hoy guardaba lo mismo que el móvil (§4) | Fichar en la tablet del local | **Se aprovecha**, con el origen ya arreglado. El PIN se guarda en claro y lo ven todos (§6) |
| **Solicitudes** | Aprobar o rechazar vacaciones y ausencias | 2 revisadas (1 Foodint, 1 Casa Lola). En Foodint hay 3 esperando, dos de ellas desde hace 15 días [Q18] | Ausencias: aprobar | **Se rehace** como «peticiones esperando» de «Equipo» (maqueta 3) |
| **Turnos abiertos** | Publicar un turno libre y asignarlo a quien lo pida | 0 (0 en toda su vida) | Turnos abiertos | **Sobra** como pantalla aparte: no lo ha usado nadie. La función se queda dentro del cuadrante |
| **Cambios de turno** | Aprobar cambios entre compañeros | 0 (2 en toda su vida) | Cambios de turno | **Se aprovecha** como fila de «peticiones esperando» |
| **Calendario** (2.926 líneas) | El cuadrante semanal: generar, editar y publicar, con aviso a cada persona | 16 cuadrantes publicados (10 Foodint, 6 Casa Lola) y 67 avisos de «horario publicado» | Cuadrante y publicación | **Se aprovecha**. Es lo más usado de la empresa y las maquetas no lo tocan |
| **Disponibilidad** | Qué días puede trabajar cada uno, deducido del historial | 9 filas (83 en total) | Disponibilidad | **Se aprovecha**, dentro de la ficha (pestaña «Tiempo») |
| **Plantilla** | Horas y coste por persona, y el PDF mensual del registro de jornada | Solo lee | Coste de personal; registro mensual en PDF | **Se rehace**: el PDF pasa al informe de la Inspección (§2); el coste, a la ficha |
| **Plantilla de turnos** | Qué turnos abre cada local y cuánta gente necesita | 30 turnos tocados (26 Foodint) | Necesidades de personal por turno | **Se aprovecha**, fuera de Laboral (es de operación, no de laboral) |
| **Informes** (de Team) | Panel de demanda por hora, ventas por local y horas trabajadas | Solo lee | Personal sobre ventas | **Se aprovecha** su cálculo para el KPI «Personal sobre ventas» de «Equipo» |
| **Nóminas** | Subir el PDF, leerlo con IA, casarlo por DNI y bandeja de revisión | 0 (13 en total, la última el 04/08) | Nóminas de la gestoría | **Se rehace** como «Nóminas del mes» (maqueta 7), sobre el mismo extractor (§5) |
| **Informes Gestoría** (`InformesPage`) | **No es de personal**: es el generador de informes de ventas. El menú lo llama «Informes Gestoría» | Solo lee | — | **Sobra en este menú.** La exportación a la gestoría de verdad está en «Bolsa de horas» |
| **Bolsa de horas** | Horas planificadas, fichadas y ausencias; cierres de mes; exportación a la gestoría | 0 cierres (9 en total) | Bolsa de horas; exportar a la gestoría | **Se aprovecha** el motor; la pantalla va a la ficha (pestaña «Tiempo») |
| **Formación** | Cursos, intentos, firma y diploma | 115 cursos asignados y 21 intentos | Formación obligatoria (APPCC, alérgenos…) | **Se aprovecha** tal cual. No es de la L1 |
| **Predicción de personal** (`/ventas/prediccion`) | Predice personal por semana desde un análisis de ventas guardado en el navegador | No está en el menú; guarda en `localStorage`; 0 medible | Previsión de personal | **Sobra**: no se llega desde el menú y no guarda nada en la base |

### 1.2 · El portal del trabajador (`src/pages/trabajador/*`)

| Pieza | Qué hace | Uso en 60 días [Q1] | Función del inventario | Propuesta |
|---|---|---|---|---|
| **TrabajadorApp** | El marco: navegación entre módulos, barra de abajo, actualización | 6 de los 11 accesos de trabajador entraron en 60 días [Q15] | Portal | **Se rehace** con las pestañas de la maqueta (Inicio · Fichar · Turnos/Nóminas · Más) |
| **HomeEmpleado** | Cuadrícula: APPCC, Mi Portal, Conteo, Recepciones; fichar arriba | — (es la portada) | Portada | **Se rehace**: la portada enseña el día (maquetas 1 y 2) |
| **PortalEmpleado** | Lista de 9 botones | — | Menú del portal | **Sobra**: la sustituyen las pestañas |
| **FichajeEmpleado** | Fichar desde el móvil, con GPS, radio del local, aviso de contexto y salida anticipada | 687 fichajes no manuales en Foodint (la mayoría, del móvil: §4) | Fichar | **Se aprovecha**: es lo que mejor funciona. Se le añade el olvido de ayer (maqueta 1) |
| **MisFichajes** | Marcas sueltas y «Reportar olvido / Corregir» | 6 peticiones de corrección | Ver mis fichajes; pedir corrección | **Se rehace** la vista (día a día, horas y minutos, total del mes, firma); **se aprovecha** la petición |
| **MiHorario / MisTurnos** | La semana con total y «Solicitar cambio» | Solo lee | Mi horario | **Se aprovecha** |
| **CambiosTurnoPage** | Cambios de turno del trabajador | 0 | Cambios de turno | **Se aprovecha** dentro de «Turnos» |
| **MisVacaciones** | Pedir y ver vacaciones | 7 ausencias pedidas (4 Foodint, 3 Casa Lola) | Pedir ausencias | **Se rehace** como «Ausencias» (maqueta 2: saldo, festivos descontados, quién más libra) |
| **MisDocumentos** | PDF de contrato y nóminas | 0 subidos en 60 días. 13 nóminas se llaman con el código del correo (§5) | Mis documentos | **Se rehace**: «Nóminas» explicadas y «Mi contrato» |
| **MiBolsaHoras** | Saldo de horas del trabajador | Solo lee | Bolsa de horas | **Se aprovecha** dentro de «Fichar» |
| **MiFormacion** | Cursos con firma | 21 intentos | Formación | **Se aprovecha** |
| **MisChecklistsPage / MiAutoinventario** | APPCC y conteos | De operación, no de laboral | Para hacer hoy | **Se aprovecha** en «Para hacer hoy» (maqueta 2) |
| **MisAjustes** | Renunciar al aviso de olvido por WhatsApp | 11 personas sin aviso (todas de Casa Lola, la carga) | Desconexión digital | **Se aprovecha** |
| **LoginEmpleado** | Usuario y contraseña, o enlace de acceso | — | Acceso | **Se aprovecha** |

### 1.3 · Las funciones (edge functions)

| Pieza | Qué hace | Uso en 60 días | Función del inventario | Propuesta |
|---|---|---|---|---|
| **clockout-reminder** | Cada 10 min: detecta olvidos (`enqueue_clockout_reminders`) y manda el WhatsApp | 82 avisos encolados [Q1] | Aviso de olvido | **Se rehace la detección** (§3); el envío se aprovecha |
| **manage-employee** | Crear, desactivar, reactivar y borrar el acceso; contraseña y enlace de acceso | 0 accesos creados [Q15] | Acceso al portal | **Se aprovecha** |
| **payroll-extract** | Lee la nómina con IA, la comprueba por totales y la casa por DNI | 0 (13 en total) [Q16] | Nóminas de la gestoría | **Se aprovecha**, ampliando lo que lee (§5) |
| **payroll-inbound** | Recibe el correo reenviado de la gestoría y pasa los PDF al extractor | 0 desde el 04/08 [Q16] | Nóminas de la gestoría | **Se aprovecha**; falta saber por qué dejó de recibir (§5) |

### 1.4 · Las tablas

| Tabla | Qué guarda | Filas / uso [Q1, Q2] | Propuesta |
|---|---|---|---|
| `employees` | La persona: datos, contrato, salario, PIN, horario | 22 (8 Foodint, 11 Casa Lola, 3 plantilla) | **Se rehace** en L1: persona, contrato y acceso por separado. Hoy mezcla las tres cosas y todo lo lee cualquiera de la cuenta (§6) |
| `clock_entries` | Cada marca | 2.167 (1.501 Foodint) | **Se aprovecha**, con la hora puesta por el servidor (§2) |
| `clock_entry_audit` | El antes y el después de cada cambio | ~600 | **Se aprovecha**, y pasa a recoger también las altas |
| `clock_correction_request` | Peticiones del trabajador | 8 (todas Foodint) | **Se aprovecha** |
| `clockout_reminder_log` | Los avisos de WhatsApp | 115 (Foodint) | **Se aprovecha** |
| `vacations` / `vacation_settings` | Ausencias y sus reglas | 15 en Foodint | **Se aprovecha** |
| `payroll_cost` / `payroll_inbox` / `payroll_settings` | La nómina leída y su bandeja | 13 / 13 / 1 | **Se aprovecha**; `payroll_summary` (0 filas) es de Sumied |
| `employee_availability` | Disponibilidad | 83 | **Se aprovecha** |
| `employee_notifications` | Avisos dentro del portal | 73 en 60 días | **Se aprovecha** |
| `employee_formations` | Carnés con caducidad | 0 | **Sobra** hasta que alguien la use; la caducidad del carné de manipulador sí la quiere la ficha |
| `documents` | Contratos y nóminas en PDF | 34 (11 contratos, 23 nóminas) | **Se aprovecha**, con el bucket cerrado (§6) |

---

## 2 · El registro de jornada, mirado como lo miraría la Inspección

### 2.1 · ¿Se puede borrar o cambiar la marca original sin dejar rastro?

**Respuesta corta: cambiarla o borrarla, no. Añadir una marca falsa, sí.**

Lo que escribe en `clock_entries`, y desde dónde [Q3]:

| Camino | Quién | Hora | ¿Deja rastro? |
|---|---|---|---|
| Fichar en el móvil o en la tablet (`insertClockEntry`) | Cualquier usuario de la cuenta (política `clock_entries_insert`: solo pide que la cuenta sea suya) | **La pone el cliente** (`datetime` y `real_datetime` vienen del navegador) | **No**: el disparador de auditoría no salta al insertar |
| Ficha a mano desde la ficha del empleado (`StaffPage`, insert directo con `source='manual'`) | Administrador | La de ese momento | **No**: solo el motivo en `address`. Hay 4 marcas así, todas antes de agosto [Q4] |
| `add_manual_clock_entry` (Control horario y «¿salida sin fichar?») | Administrador | La que escribe | **Sí**: `create_manual` con el motivo y el después |
| `edit_clock_entry` / `void_clock_entry` | Administrador | La que escribe | **Sí**: disparador `clock_entry_audit_aud` con antes y después |
| `resolve_clock_correction` (aprobar una petición) | Administrador | La que pidió el trabajador | **Sí**: `approve` y `create_manual` o `edit` |
| `UPDATE` o `DELETE` directo por la API | Administrador (políticas `clock_entries_modify` y `clock_entries_delete`) | — | **Sí**: el disparador lo recoge con «(sin motivo — edición directa)» o «(sin motivo — borrado físico directo)» |
| SQL de servidor (Julio o Claude) | — | — | **Sí** (mismo disparador), salvo `TRUNCATE`, que no dispara nada |

Lo que eso significa:

- **`clock_entry_audit` recoge siempre los cambios y los borrados**, también los
  hechos fuera de la app. No tiene clave ajena a `clock_entries`, así que un
  borrado no se lleva su rastro. Nadie puede escribir en ella desde la app: solo
  tiene política de lectura. Bien hecho.
- **No recoge las altas.** Una marca nueva entra sin fila de auditoría, salvo que
  venga por `add_manual_clock_entry` o por una petición aprobada.
- **El fallo grave está en la puerta de entrada.** Cualquier usuario de la cuenta,
  incluido un trabajador, puede insertar una marca **para cualquier compañero**
  con **la hora que quiera** y **el origen que quiera**. Con `source='manual'`
  se salta además el control de orden y el freno del doble toque. Y no deja
  rastro. Lo único que lo delata es `created_at` (la hora del servidor) frente a
  `real_datetime`. No lo he probado escribiendo, porque la auditoría es de solo
  lectura: lo dice la política.
- **`voided` es un borrado lógico bien hecho.** La fila se queda, el disparador
  apunta `void` con el antes y el después, y las horas (`team_worked_shifts`)
  las excluyen. Pero `edit_clock_entry` **sobrescribe** `datetime` y
  `real_datetime`: la hora original solo queda en `clock_entry_audit.before`.
  Cualquier informe tiene que leer la auditoría para enseñarla.
- **El 07/08 se saneó el histórico por SQL** (documentado en
  `docs/ENCARGO_CODE_f1_guard_fichaje_y_bolsa_horas.md`). Quedó todo en la
  auditoría: 582 «ediciones» sin cambio visible, 7 con motivo, 36 anulaciones
  con motivo y **6 borrados físicos** (2 entradas, 1 salida y 3 pausas), que hoy
  solo existen en la auditoría [Q5]. Es legal porque hay rastro. Pero el informe
  tiene que poder enseñarlo, y hoy no lo enseña.

### 2.2 · Las salidas añadidas después, en Foodint, de agosto a hoy

Desde el 01/08 hay **497 salidas** en Foodint [Q6]:

| Cómo llegó la salida | N | Quién y por qué vía | ¿Rastro con antes y después? |
|---|---|---|---|
| Fichada en su momento, sin tocar | 446 | La persona, desde el móvil o la tablet | No hace falta |
| **Añadida a mano** (`source='manual'`) | **10** | 4 por **petición del trabajador** aprobada por un administrador; 6 **directas del administrador** desde Control horario o la ficha [Q7] | **Sí**: `create_manual` con motivo y quién (`actor_user_id`, rol admin). El «antes» no existe (no había marca) |
| Fichada y **cambiada después** | 40 | **7 salidas con la hora movida por un administrador** desde la app: 8 cambios (7 directos con motivo, 1 por petición), 43 min hacia atrás de media (6 de 8 hacia atrás). **Las otras 33**, solo el saneamiento del 07/08, sin mover la hora [Q5, Q6b] | **Sí**: antes y después |
| Anuladas | 3 | Administrador o saneamiento | **Sí** |

**La diferencia que veía Julio** (pocas peticiones y bastantes salidas añadidas)
se explica así: **la mayoría de las correcciones no las pide el trabajador, las
hace el encargado directamente**. Hay 8 peticiones en toda la vida de la tabla
(6 en 60 días) y todas se aprobaron, entre 8 h y 4 días después [Q10]. Los
cambios en salidas, en cambio, son 18 (10 añadidas y 8 cambios de hora), y 13
de ellos los hizo el administrador sin petición. Todas dejaron rastro con motivo.
Lo que **no** dice nada es si el trabajador está de acuerdo: una corrección
directa del encargado no se le enseña ni se le pide conformidad.

### 2.3 · Los olvidos: entradas sin salida y cuánto tardaron en cerrarse

Jornadas de Foodint que empiezan desde el 01/08 y no se cerraron con normalidad
[Q8, Q9]:

| Cómo acabó | Jornadas | Personas | Mediana hasta que se escribió la salida | Jornada media que quedó |
|---|---|---|---|---|
| Se cerró con una salida añadida a mano | 7 | 3 | 36,7 h (máximo 105 h) | 8,9 h |
| **Se cerró fichando al día siguiente, sin corregir** | **6** | 3 | 15,8 h (máximo 28,2 h) | **16,8 h** |
| Se fichó tarde y se movió hacia atrás | 6 | 5 | 8,2 h | 4,6 h |
| Dos entradas seguidas (la primera no se cerró) | 2 | 2 | — | — |
| Abierta ahora mismo | 1 | 1 | — | — |

Son **21 olvidos en unas 490 jornadas** (4 %), de 8 personas como mucho. Lo más
delicado son **las 6 jornadas de 16,8 h de media que nadie corrigió**: en el
registro son jornadas reales de más de 12 h, que es justo lo que miraría la
Inspección. El aviso de contexto de la app (`AVISO_JORNADA_LARGA_MIN`, 12 h)
avisa al fichar, pero no crea ninguna petición y nadie lo ve después.

### 2.4 · ¿Puede salir hoy el informe para la Inspección de la maqueta 5?

**No entero.** Hoy existe un PDF mensual por persona (`registroJornadaPdfService`,
desde la pantalla Plantilla). Sale de `registro_jornada_mensual` y
`team_worked_shifts`: todos los días del mes, entrada, salida, pausas, horas
nocturnas, festivos y ausencias. Excluye bien lo anulado. Le falta:

| Le falta | Por qué es necesario | Qué hace falta |
|---|---|---|
| Cada corrección con quién, cuándo y por qué, con la marca original al lado | La maqueta lo pone en cada fila; es lo primero que pregunta un inspector | Leer `clock_entry_audit` y `clock_correction_request` y pintarlas. Los datos existen desde junio |
| «Cómo se registró» cada marca | Ídem | Llega con el arreglo del §4 para lo nuevo; lo antiguo sale «sin distinguir» |
| Las marcas añadidas sin pasar por la auditoría | Hoy son invisibles | Marcar como «añadida después» toda marca con `created_at` muy posterior a su hora, y cerrar la puerta (L1) |
| Horas ordinarias y extra según convenio | La maqueta las separa | Hoy solo hay el total y la diferencia con el contrato (`compute_employee_balance`) |
| Por local o para todos, y en hoja de cálculo | La Inspección lo pide por centro de trabajo | Hoy es una persona y un mes, solo en PDF |
| Firma del trabajador | La maqueta lo firma desde el portal | No existe |
| Enlace de solo lectura que caduca | Maqueta | No existe |
| Los datos de la empresa (CIF, centro, convenio) | Cabecera del informe | No hay convenio ni categoría en `employees` |

---

## 3 · El aviso de olvido por WhatsApp

### 3.1 · Por qué fallaron 64 envíos en silencio (05/08 – 17/09)

[Q11] Los 64 dieron el mismo error de Meta: `(#132001) Template name does not
exist in the translation`. **La plantilla `recordatorio_fichaje_salida` no
existía en el idioma pedido**. Afectó a 6 personas, del 05/08 al 18/09. Desde
el 18/09 salen bien: 51 enviados a 5 personas.

**Por qué en silencio:** `clockout-reminder` reintenta 3 veces, marca la fila
como `failed` con el error y sigue. Ninguna función, vigía ni alerta mira
`clockout_reminder_log`: la única que la nombra es la que encola [Q13]. Entre
los 16 vigías de `cron.job` no hay ninguno de los avisos.

**Qué pasaría hoy si vuelve a faltar la plantilla:** exactamente lo mismo.
Filas `failed` en la tabla y nadie se entera. Solo se vería abriendo
«Recordatorios de fichaje», y esa pantalla no la abre nadie a diario.

### 3.2 · ¿Sirve de algo el aviso?

**Hoy no.** La detección (`enqueue_clockout_reminders`) tiene tres fallos, y los
datos los confirman [Q12]:

1. **No mira si lo último fichado es una entrada.** Coge el último fichaje del
   día, sea el que sea, y si ha pasado la hora del turno más 30 minutos, avisa.
   Resultado: **de los 51 avisos enviados, 48 apuntaban a una SALIDA ya
   fichada.** Es decir, se avisó a gente que había fichado bien. De los 64
   fallidos, también 48.
2. **Mezcla la hora del servidor (UTC) con el horario del local (Madrid).**
   `now()::time` es UTC y `shift_templates.end_time` es hora local. El aviso
   sale unas 2 h tarde: la mediana es 155 min después del fin del turno, cuando
   debería ser 30. **11 de los enviados salieron entre las 00:00 y las 05:59**
   de Madrid, a gente que ya se había ido. Eso choca con la desconexión digital
   aunque haya consentimiento.
3. **«Hoy» es el día UTC** (`ce.datetime::date = now()::date`). Un turno que
   cruza la medianoche UTC deja de ser «de hoy» justo cuando tocaría avisar.

Y al revés: **los 19 olvidos reales desde el 05/08 (14 hasta el 17/09 y 5
después) no recibieron ningún aviso**, aunque todas las personas de esos
olvidos lo tenían aceptado [Q12].

¿Cuántas salidas se fichan después del aviso? Solo 3 avisos enviados
apuntaban a una entrada abierta de verdad; en 2 de ellos, la salida se fichó en
las 2 horas siguientes, a una media de 276 min de la entrada [Q12]. Con 3 casos
no se puede decir si el aviso funciona. **Lo que sí se puede decir es que hoy no
llega a quien lo necesita.**

> La página «Laboral y Mi portal» dice que «51 avisos en 40 días para 5
> personas: el olvido es diario». **No es así**: 48 de esos 51 son avisos falsos.
> El olvido es de unos 21 casos en tres meses (§2.3). Conviene corregir la
> maqueta 6.

### 3.3 · Propuesta para la L1

1. **Rehacer la detección**, en hora de Madrid: una entrada abierta (lo último
   es `entrada` o `pausa_*`, no `salida`), con un turno publicado que acabó hace
   más de 30 minutos. Un aviso por entrada. Sin turno, un tope (las 12 h de
   `c_jornada_rancia`).
2. **Ventana de envío:** si el turno acabó de madrugada, se manda a la hora del
   turno más 30 minutos, nunca más tarde de una hora máxima que decida la
   empresa. Si se pasa, no se manda WhatsApp: el trabajador lo ve al abrir su
   portal.
3. **Un toque que crea la petición de corrección.** Botones en la plantilla
   («A las 00:00» · «Otra hora» · «Sigo trabajando»). «A las 00:00» crea una
   `clock_correction_request` de tipo `add` con la hora del turno y el motivo
   «Respuesta al aviso de WhatsApp». Nunca escribe la marca: la aprueba el
   encargado. «Otra hora» abre el portal en esa petición.
4. **Aviso a la empresa el mismo día si los envíos dejan de salir:** un vigía
   cada hora. Si hay filas `failed`, o `queued` de más de 30 minutos, se encola
   un `system_alert` (con su `_queue_system_alert`) y le sale al administrador
   en «Equipo» con el error en palabras («Meta dice que la plantilla no existe:
   los avisos de olvido no están saliendo desde las 18:10»). Y un contador
   honesto en la pantalla: «enviados / fallidos / sin teléfono» de la semana.
5. **El informe de avisos sirve de prueba** («cuántas veces y cuándo se avisó»)
   solo si los avisos son verdaderos: con la detección de hoy, prueba lo
   contrario.

---

## 4 · Arreglo pequeño: la etiqueta del origen del fichaje

**Va en su propio PR** (rama `claude/wizardly-bardeen-91lb33`).

**El fallo, medido:** de los 2.167 fichajes de producción, 2.144 dicen `kiosko`
y 23 `manual`; ninguno dice `movil` [Q14]. `buildClockEntry` escribía siempre
`source: 'kiosko'`.

**El arreglo:**

- `buildClockEntry` recibe el origen y es obligatorio: el portal guarda `movil`
  y la pantalla de kiosko, `tablet`. TypeScript no deja llamarla sin decirlo.
- **Por qué la tablet estrena `tablet` en vez de quedarse con `kiosko`:** un
  móvil con la versión vieja de la app sigue escribiendo `kiosko` hasta que se
  actualiza. Si `kiosko` pasara a significar «tablet», esos fichajes del móvil
  se leerían como tablet. Así, `kiosko` se queda con lo que siempre ha
  significado: «tablet o móvil, sin distinguir».
- En Control horario, cada marca dice cómo se registró: «Móvil del
  trabajador», «Tablet del local», «Puesto a mano» o «Tablet o móvil (sin
  distinguir)».
- En la base (migración `20261027T1112_l00_origen_del_fichaje`, con su tanda):
  el CHECK admite `tablet`, y el freno del doble toque (`tg_clock_entry_debounce`,
  que solo frenaba `kiosko`) frena también `movil` y `tablet`. Sin esto, el
  móvil se habría quedado sin freno. La base va antes que el front.

**Los datos antiguos se quedan como están.** Cómo se distinguen sin reescribirlos:

| Pista | Qué dice | Cuántos (Foodint) [Q14] |
|---|---|---|
| `scheduled` (turno teórico) relleno | **Móvil seguro.** La tablet nunca pasa el calendario a `buildClockEntry`, y sin calendario `getTheoreticalShift` devuelve vacío | 429 de 1.478 |
| Puntos GPS distintos al mes | Una tablet fija daría 1 o 2 puntos por local. Hay entre 16 y 34 puntos distintos (a 100 m) cada mes: **la mayoría es del móvil** | 186 puntos a 11 m en total; el más repetido, 390 fichajes (la red del local da la misma posición a todos los móviles) |
| `address` «Sin ubicación…» | No distingue: lo ponen las dos pantallas | 49 |

Mi propuesta es que el informe diga «Tablet o móvil (sin distinguir)» para todo
lo antiguo. Se puede decir «Móvil (deducido del turno teórico)» para los 429
seguros, siempre con la palabra «deducido». No reescribiría nada.

---

## 5 · Las nóminas de hoy

### 5.1 · Cómo entran, y cuántas

**El camino:** la gestoría manda el correo y el cliente lo reenvía a su buzón
`nominas-<cliente>@in.folvy.app` (Resend Inbound). `payroll-inbound` comprueba
la firma, resuelve la cuenta por la dirección, baja cada PDF a
`employee-documents/_inbox/<cuenta>/…` y llama a `payroll-extract`. Este lee la
nómina con IA, la comprueba por totales (devengado − deducciones = líquido y la
cuota de empresa, con un 1,5 % de margen) y la casa por DNI. Escribe en
`payroll_cost`, apunta siempre en `payroll_inbox` y adjunta el PDF a la ficha.
También se puede subir a mano desde «Nóminas».

**Cuántas** [Q16]: **13 en total, todas leídas bien** (13 `matched`, 0 en
revisión, 0 errores). Fueron 7 de junio (entraron el 09/07) y 6 de julio (el
04/08). **Desde el 04/08 no ha entrado ninguna:** ni las de agosto ni las de
septiembre. `payroll_settings` de Foodint tiene buzón y remitente, pero
`connected = false` y `last_sync_at` vacío. Desde la base no se puede saber si
la gestoría dejó de mandarlas, si se dejó de reenviar o si Resend dejó de
llamar. Lo siguiente es mirar los registros de Resend y de la función; no lo he
hecho porque pide salir de la base. **Y es el mismo silencio del §3: nadie
avisa de que un mes no ha llegado.**

### 5.2 · Por qué en el portal salen con nombres raros

`payroll-extract` adjunta el PDF a la ficha con `name = fp.split('/').pop()`,
es decir, el nombre del fichero en Storage: `<id del correo en
Resend>-<nombre del adjunto>`. El id de Resend es un UUID, y por eso sale
«ce39c29d-013f…». La nota es fija: «Ingesta automática de nómina». Las 13
nóminas automáticas tienen ese nombre; las 10 subidas a mano antes, no [Q17].
**El arreglo** (para la L2, no para la L0) es poner de nombre «Nómina de
<mes> de <año>», que la función ya conoce (`period_year`, `period_month`), y de
nota el líquido.

### 5.3 · Qué falta para la L2

| Falta | Hoy | Qué hace falta |
|---|---|---|
| **IRPF separado de la SS del trabajador** | La IA lee `deductions_total` (las dos juntas). Las columnas `irpf` y `employee_ss` existen desde la N7, pero están vacías en las 13 [Q17] | Pedir a la IA las dos cifras (y el tipo de IRPF) con nombre propio, como ya hace con la cuota de empresa, y comprobar que `irpf + ss_trabajador + otras = deducciones` |
| **Las líneas de deducción** | Se guardan las de devengo (`earnings_lines`, 13 de 13), no las de deducción (0 de 13) | Pedirlas: hacen falta para «la nómina explicada» (anticipos, embargos) |
| **El asiento por local y marca** | `fuente_nominas_mes_v1` (N7) ya da el coste por local; nadie la llama | Un asiento 640/642 contra 476/4751/465 por local. **Por marca no hay de dónde**: la nómina no lo dice. Haría falta repartir por las horas fichadas en cada marca, y eso pide que el fichaje sepa la marca, cosa que hoy no sabe |
| **El 111** | No hay nada | Suma del IRPF del trimestre por empresa (sale de lo anterior) y su casilla |
| **La nómina explicada** | Solo hay el PDF | Las líneas de devengo y deducción con su explicación. El «plus de nocturnidad salen de tus fichajes del 4, 11 y 18» se puede hacer: `night_minutes_in_span` ya existe |
| **Que no se pierda un mes** | Silencio | Un aviso si el día X del mes no han llegado las nóminas del anterior |
| **El resumen de la gestoría** | `payroll_summary`, 0 filas | Leerlo para cuadrar al céntimo (maqueta 7) |

---

## 6 · Datos sensibles

### 6.1 · Dónde están y quién los ve

| Dato | Dónde | Cuántos (todas las cuentas) [Q2] | Quién lo puede leer hoy |
|---|---|---|---|
| Salario | `employees.salary`, `payroll_cost`, PDF de nóminas | 22 fichas con salario; 13 nóminas | **Cualquier usuario activo de la cuenta, también los trabajadores** [Q19] |
| DNI | `employees.dni`, `payroll_inbox.read_dni`, PDF | 22 fichas | Ídem |
| Fecha de nacimiento, teléfono | `employees` | 10 / 22 | Ídem |
| PIN del kiosko | `employees.pin`, **en claro** | 20 | Ídem: un trabajador puede leer el PIN de un compañero y fichar por él en la tablet |
| Foto del fichaje | `clock_entries.photo_data_url` | **0** (nadie la usa) | — |
| Ubicación | `clock_entries.lat/lng` | 1.429 fichajes de Foodint | Cualquier usuario de la cuenta |
| Bajas médicas (dato de salud) | `vacations.type = 'baja_medica'` | 2 en Foodint | Cualquier usuario de la cuenta |
| Contratos y nóminas en PDF | Bucket `employee-documents` | 35 ficheros [Q20] | **Cualquiera, sin sesión:** el bucket es público y la política `anon_all_employee_documents` deja leer, subir, cambiar y borrar al rol `public` |

**Probado como trabajador, no deducido** [Q19]. Entrando como un trabajador real
de Foodint, en una transacción de solo lectura con `rollback`, la base le
devuelve 8 fichas (7 de compañeros) con 8 salarios, 8 DNI y 6 PIN, 1.430
fichajes con GPS, 13 nóminas, 2 bajas médicas y 28 documentos. La pantalla
esconde el salario a quien no tiene `show_salaries`, pero eso es solo la
pantalla: la API lo da igual.

El motivo es el mismo en todas: las políticas de lectura son
`account_id = any(current_user_account_ids())`, y esa función devuelve las
cuentas de cualquier `user_profiles` activo, también los 11 de rol `worker`.

### 6.2 · Cuánto tiempo se guardan

- **Todo, para siempre.** No hay ningún cron, función ni política que borre o
  anonimice fichajes, GPS, auditoría, avisos, nóminas ni documentos.
- **El registro se protege bien al dar de baja:** la clave ajena de
  `clock_entries` a `employees` es `restrict`. No se puede borrar a una persona
  con fichajes, y su registro no se pierde. **Pero `vacations`, `payroll_cost`,
  `monthly_balance_closures` y `clockout_reminder_log` son `cascade`:** borrar
  a una persona sin fichajes se lleva sus ausencias y sus nóminas.

### 6.3 · Qué habría que cambiar (RGPD y conservación de 4 años)

1. **Ya, sin esperar a la L1:** el bucket `employee-documents`, privado; quitar
   `anon_all_employee_documents`; políticas por cuenta (administrador, y el
   trabajador solo lo suyo); y en el front, enlaces firmados que caducan en vez
   de URL públicas. Revisar si en estos meses ha habido descargas sin sesión: lo
   dirán los registros de Storage.
2. **Lectura por papel:** que un trabajador lea solo su ficha, sus fichajes, sus
   ausencias y sus nóminas. El encargado, las de sus locales (ya existe
   `current_user_manages_location`). Salario, DNI y fecha de nacimiento, solo el
   administrador. Separar contrato y salario de la ficha ayuda (L1).
3. **El PIN, cifrado** (con hash) y comprobado en el servidor, nunca leído por
   el cliente.
4. **Fichar por una función del servidor** (`fichar()`, `security definer`): la
   hora la pone el servidor; la persona solo puede fichar por sí misma (o la
   tablet, con PIN); el origen lo decide la función. Y quitar el `INSERT`
   directo de `authenticated` en `clock_entries`. La auditoría pasa a recoger
   también las altas.
5. **Conservación:** el registro de jornada (marcas, auditoría y peticiones),
   **4 años** (ET art. 34.9) y después anonimizar. **La ubicación** no hace
   falta 4 años: basta guardar «dentro o fuera del radio» y la distancia, y
   borrar las coordenadas a los pocos meses (minimización). Las nóminas y lo
   que sustenta la cotización, lo que diga la ley de la Seguridad Social y la
   tributaria (4 años como mínimo). Un cron que lo haga, con su vigía.
6. **Las bajas médicas**, como dato de salud: que el resto de la plantilla vea
   «ausente», nunca «baja médica».
7. **Registro de actividades de tratamiento y aviso al trabajador** (qué se
   guarda, para qué y cuánto tiempo), sobre todo de la ubicación. Lo debe tener
   la empresa: Folvy lo puede generar.

---

## Diseño · las pantallas de hoy

**Las capturas** las saca la prueba `tests/e2e/laboral/l0-pantallas.spec.ts`
de este PR, en staging (cuenta A, datos inventados): las 18 pantallas de la
empresa en ordenador y las 11 del portal en móvil. Van en el artefacto
`playwright-report-<trozo>` del run (carpeta `test-results`) y como adjuntos
del informe de Playwright, no en el repositorio. Laboral no es un frente con
carpeta de capturas, y la L0 no toca la infraestructura común. La línea de cada
pantalla sale de leer su código y de la tabla 0 de la maqueta. Si alguna
captura dice otra cosa, se corrige.

| Pantalla de hoy | Para un administrativo medio | La sustituye |
|---|---|---|
| Empleados (ficha con pestañas) | Mal: 2.865 líneas en una ficha con cinco pestañas y el fichaje a mano dentro; el salario no se ve si no tienes el permiso, pero no dice por qué | Maquetas 3 (Equipo) y 4 (La ficha) |
| Ahora mismo | Bien: se entiende de un vistazo | Banda de «Equipo» (maqueta 3) |
| Control horario | Regular: completa y con rastro, pero es una tabla larga de marcas sueltas, sin días ni totales | Maqueta 5 (Registro de jornada) |
| Recordatorios de fichaje | Mal: cuenta avisos que en su mayoría son falsos (§3) | Maqueta 6, con la detección nueva |
| Kiosko | Bien para la tablet: un botón por persona y PIN | Se queda (no hay maqueta) |
| Solicitudes | Bien, pero escondida: hay 3 vacaciones esperando, dos desde hace 15 días | «Peticiones esperando» (maqueta 3) |
| Turnos abiertos / Cambios de turno | Correctas, sin uso | Dentro del cuadrante; portal, maqueta 2 |
| Calendario | Potente y usada; para un administrativo es la más difícil (generador, coberturas, publicar) | **No la sustituye ninguna maqueta** (ver huecos) |
| Disponibilidad | Técnica: habla de «confianza alta» y de «inferido» | Pestaña «Tiempo» de la ficha (maqueta 4) |
| Plantilla (horas y coste) | Regular: buena tabla, pero el PDF del registro está escondido aquí | Maquetas 4 y 5 |
| Plantilla de turnos | Técnica (coberturas por día) | No es de Laboral; se queda en operación |
| Informes de Team | De analista, no de administrativo | KPI «Personal sobre ventas» (maqueta 3) |
| Nóminas | Regular: subir el PDF y revisar funciona, pero no explica nada ni cuadra con la gestoría | Maqueta 7 |
| «Informes Gestoría» | **Mal: el nombre engaña**; es el informe de ventas | Se quita del menú de personal |
| Bolsa de horas | Regular: muy completa y difícil (planificado, fichado, ausencias, cierres) | Pestaña «Tiempo» de la ficha |
| Formación | Bien | Se queda (no hay maqueta) |
| Predicción de personal | Mal: fuera del menú y guarda en el navegador | Sobra |
| Portal: inicio en cuadrícula + «Mi Portal» con 9 botones | Mal: dos niveles de menú para saber algo | Maquetas 1 y 2 |
| Portal: Fichar | Bien: GPS, radio y avisos de contexto | Maqueta 1 (Fichar, con el olvido de ayer) |
| Portal: Mis fichajes | Mal: decimales («4.2h»), sin turno, sin total ni firma | Maqueta 5 vista por el trabajador, y maqueta 1 |
| Portal: Mis documentos | Mal: nóminas con el código del correo | Maqueta 1 (La nómina explicada) |
| Portal: Mis vacaciones | Regular: sin saldo ni festivos | Maqueta 2 (Ausencias) |
| Portal: Mi horario | Bien | Se queda; el turno de hoy, en la portada |

### Huecos de las maquetas: lo que hoy se hace y las maquetas no recogen

Para que no se pierda al construir la L1:

1. **El cuadrante** (Calendario): generarlo, editarlo, publicarlo y avisar a cada
   persona. Es lo más usado de la empresa (16 publicados en 60 días) y ninguna
   maqueta lo dibuja. La maqueta 3 lo da por hecho.
2. **La plantilla de turnos y las coberturas** (cuánta gente necesita cada
   turno), y la **disponibilidad** de cada persona.
3. **La bolsa de horas con cierres de mes** y la **exportación a la gestoría**
   (`exportGestoriaService`).
4. **El kiosko de la tablet con PIN**, para locales donde no se ficha con el
   móvil.
5. **El radio y el modo del fichaje por local** (`clock_radius_m`,
   `clock_geofence_mode`: bloquear o avisar), la **salida anticipada** marcada,
   y los **avisos de contexto** al fichar (jornada muy larga, entrada a hora
   rara, volver a entrar muy pronto).
6. **Las pausas** (`pausa_inicio` / `pausa_fin`, con su control de orden). La
   maqueta 1 tiene el botón, pero el informe de la maqueta 5 solo enseña una
   pausa por día.
7. **La formación** (cursos, intentos, firma, diploma y la asignación automática
   al dar de alta).
8. **Qué ve cada trabajador en su portal** (`worker_portal_visibility`) y los
   permisos del encargado por pantalla (`managerPermissionsService`).
9. **Los festivos** (`holiday_calendar`, 14 filas) y las reglas de las ausencias
   (`vacation_settings`: mínimo de personal por local y antelación).
10. **El fichaje a mano del encargado** cuando el GPS falla. La maqueta solo
    tiene la corrección del olvido.
11. **Varias empresas o varios locales para una persona** (`assigned_locations`).
    La maqueta 2 lo dice («una persona, una ficha»), pero ninguna pantalla lo
    dibuja.

---

## Lo que bloquea la L1

1. **Cerrar el bucket de documentos** (riesgo 1, abajo). No se puede construir
   «Mi contrato» ni «La nómina explicada» encima de un bucket público.
2. **Leer el inventario** (`sumied_laboral_inventario.md`) para casar las
   funciones con su número. Desde esta sesión no se puede.
3. **Decidir el modelo de permisos** (quién lee qué): la ficha nueva no se puede
   diseñar sin saber qué ve el trabajador y qué el encargado.
4. **La función de fichar en el servidor** (`fichar()`), antes que la pantalla
   nueva de fichar: si no, la L1 construye sobre la puerta abierta del §2.1.
5. **Aplicar la tanda del arreglo del origen** (PR aparte). Sin ella, el informe
   de la Inspección no puede decir «cómo se registró».
6. **Saber por qué no entran las nóminas desde el 04/08** (registros de Resend y
   de `payroll-inbound`). No bloquea la L1, pero sí la L2.

## Lo que es un riesgo legal hoy, de más a menos grave

1. **Contratos y nóminas accesibles sin sesión** (bucket público con política
   para todos): 35 PDF con DNI y salario (y la cuenta bancaria, si la nómina la lleva; no he abierto ninguno). Es una brecha de
   seguridad (RGPD art. 32) que, si se ha llegado a usar, habría que notificar
   en 72 h (art. 33). **Arreglo inmediato, fuera de la L1.**
2. **Cualquier trabajador lee el salario, el DNI, el PIN, la ubicación, las
   nóminas y las bajas médicas de sus compañeros** (Q19). Es un acceso
   indebido (RGPD arts. 5.1.f y 32). Las bajas son dato de salud (art. 9).
3. **El registro de jornada admite marcas añadidas sin rastro**, con la hora y
   el origen que ponga el cliente, y por otra persona (§2.1). La Inspección
   exige un registro fiable e inalterable (ET art. 34.9 y su criterio técnico).
   Hoy no se puede demostrar que una marca la puso quien dice, cuando dice.
4. **Jornadas de más de 12 h en el registro sin corregir** (6 desde agosto,
   §2.3), y correcciones del encargado sin conformidad del trabajador. Eso pide
   una explicación en una inspección.
5. **WhatsApp de madrugada a gente que ya ha salido** (11 desde el 18/09, §3).
   El consentimiento cubre el aviso de un olvido, no un aviso falso a las tres de
   la mañana: choca con la desconexión digital (LOPDGDD art. 88).
6. **Conservación indefinida** de la ubicación y de todo lo demás, sin plazo ni
   anonimización (RGPD art. 5.1.e). El registro de jornada sí debe guardarse 4
   años; la ubicación, no tanto.
7. **El PIN del kiosko en claro**: permite fichar por otro en la tablet. Es un
   riesgo para la fiabilidad del registro, no una brecha por sí mismo.
8. **No hay informe para la Inspección con las correcciones a la vista** (§2.4):
   los datos existen, pero hoy habría que sacarlos a mano.

---

## Anexo A · Las consultas

Todas en solo lectura contra producción (`xzmpnchlguibclvxyynt`), el
27/10/2026. Foodint es la cuenta `51ad1792-6629-4ef7-833a-b57b09a86710`. Las
de tabla entera lo dicen.

**Q1 · Uso en los últimos 60 días, por cuenta**
```sql
with d as (select now()-interval '60 days' t0)
select a.name cuenta,
 (select count(*) from clock_entries c, d where c.account_id=a.id and c.created_at>d.t0 and c.source='kiosko') fich_kiosko_o_movil,
 (select count(*) from clock_entries c, d where c.account_id=a.id and c.created_at>d.t0 and c.source='manual') fich_manual,
 (select count(*) from clock_entry_audit x, d where x.account_id=a.id and x.created_at>d.t0 and x.action in ('create_manual','edit','void') and x.actor_user_id is not null) correcciones_admin,
 (select count(*) from clock_correction_request r, d where r.account_id=a.id and r.created_at>d.t0) peticiones_correccion,
 (select count(*) from clockout_reminder_log r, d where r.account_id=a.id and r.created_at>d.t0) avisos_olvido,
 (select count(*) from vacations v, d where v.account_id=a.id and v.created_at>d.t0) ausencias_creadas,
 (select count(*) from vacations v, d where v.account_id=a.id and v.reviewed_at>d.t0) ausencias_revisadas,
 (select count(*) from schedules s, d where s.account_id=a.id and s.published_at>d.t0) cuadrantes_publicados,
 (select count(*) from shift_templates s, d where s.account_id=a.id and s.updated_at>d.t0) plantillas_turno_tocadas,
 (select count(*) from open_shifts s, d where s.account_id=a.id and s.created_at>d.t0) turnos_abiertos,
 (select count(*) from shift_swap_requests s, d where s.account_id=a.id and s.created_at>d.t0) cambios_turno,
 (select count(*) from employee_availability s, d where s.account_id=a.id and s.created_at>d.t0) disponibilidad,
 (select count(*) from monthly_balance_closures s, d where s.account_id=a.id and s.closed_at>d.t0) cierres_bolsa,
 (select count(*) from payroll_inbox s, d where s.account_id=a.id and s.created_at>d.t0) nominas_bandeja,
 (select count(*) from payroll_cost s, d where s.account_id=a.id and s.created_at>d.t0) nominas_coste,
 (select count(*) from documents s join employees e on e.id=s.employee_id, d where e.account_id=a.id and s.created_at>d.t0) documentos,
 (select count(*) from employees e, d where e.account_id=a.id and e.created_at>d.t0) altas_empleado,
 (select count(*) from employees e, d where e.account_id=a.id and e.updated_at>d.t0) fichas_tocadas
from accounts a order by 2 desc;
-- Foodint: 687 · 9 · 20 · 6 · 82 · 4 · 1 · 10 · 26 · 0 · 0 · 9 · 0 · 0 · 0 · 0 · 0 · 0
-- Casa Lola: 666 · 0 · 0 · 0 · 0 · 3 · 1 · 6 · 4 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 11 · 11
-- Folvy Interno y Kitchen Grill LstQ: todo 0.
-- Formación (tabla entera): course_assignment creados en 60 d = 115 (209 en total);
-- course_attempt iniciados en 60 d = 21. employee_notifications en 60 d:
-- schedule_published = 67, clock_correction_resolved = 6.
```

**Q2 · Fichajes por cuenta, origen y tipo, y datos sensibles por cuenta**
```sql
select a.name, c.source, c.type, count(*) n, count(*) filter (where c.voided) anuladas,
 count(*) filter (where c.lat is not null) con_gps, count(*) filter (where c.photo_data_url is not null) con_foto,
 min(c.datetime)::date desde, max(c.datetime)::date hasta, count(distinct c.created_at::date) dias_creacion
from clock_entries c join accounts a on a.id=c.account_id group by 1,2,3 order by 1,2,3;
-- Casa Lola: kiosko entrada 335 y salida 331, sin GPS, creadas en 1 día (carga).
-- Foodint: kiosko entrada 742 (20 anuladas) y salida 736 (22 anuladas); manual entrada 5 y salida 18.

select a.name, count(*) emps, count(e.dni) con_dni, count(e.salary) con_salario, count(e.birth_date) con_nacimiento,
 count(e.phone) con_tel, count(e.pin) con_pin,
 (select count(*) from clock_entries c where c.account_id=a.id and c.lat is not null) fich_con_gps,
 (select count(*) from clock_entries c where c.account_id=a.id and c.photo_data_url is not null) fich_con_foto,
 (select count(*) from vacations v where v.account_id=a.id and v.type='baja_medica') bajas_medicas
from employees e join accounts a on a.id=e.account_id group by a.id, a.name;
-- Casa Lola 11·11·11·0·11·11·0·0·0 · Foodint 8·8·8·7·8·6·1429·0·2 · Folvy Interno 3·3·3·3·3·3·0·0·0
```

**Q3 · Quién escribe en `clock_entries`: disparadores, políticas, funciones y permisos**
```sql
select c.relname, t.tgname, p.proname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
 where not t.tgisinternal and c.relname='clock_entries';
-- clock_entry_audit_aud AFTER UPDATE/DELETE · trg_clock_debounce BEFORE INSERT · trg_clock_entry_orden BEFORE INSERT · trg_fill_acc BEFORE INSERT/UPDATE
select policyname, cmd, roles, qual, with_check from pg_policies where tablename in ('clock_entries','clock_entry_audit');
-- clock_entries_insert (authenticated): with check account_id = any(current_user_account_ids())
-- clock_entries_modify / _delete: current_user_is_admin_of(account_id) · clock_entry_audit: solo lectura
select proname, (prosrc ~* 'insert\s+into\s+(public\.)?clock_entries') ins, (prosrc ~* 'update\s+(public\.)?clock_entries') upd,
 (prosrc ~* 'clock_entry_audit') audita from pg_proc where pronamespace='public'::regnamespace and prosrc ~* 'clock_entries';
-- Escriben: add_manual_clock_entry (inserta y audita), edit_clock_entry y void_clock_entry (update; audita el disparador),
-- resolve_clock_correction (inserta o actualiza, y audita).
select conrelid::regclass, confrelid::regclass, confdeltype from pg_constraint where contype='f'
 and (confrelid='public.clock_entries'::regclass or confrelid='public.employees'::regclass);
-- clock_entry_audit: ninguna clave ajena. clock_entries → employees: restrict.
-- vacations, payroll_cost, monthly_balance_closures, clockout_reminder_log → employees: cascade.
```

**Q4 · Marcas manuales sin fila `create_manual`**
```sql
select count(*) from clock_entries c where c.source='manual'
 and not exists (select 1 from clock_entry_audit x where x.clock_entry_id=c.id and x.action='create_manual');
-- 4 (tabla entera); 0 desde el 01/08.
```

**Q5 · La auditoría de Foodint desde el 01/08: qué, quién (rol) y con qué motivo**
```sql
with au as (select x.*, (x.before->>'datetime')::timestamptz b_dt, (x.after->>'datetime')::timestamptz a_dt,
   x.before->>'type' b_type, x.after->>'type' a_type
 from clock_entry_audit x where x.account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and x.created_at >= '2026-08-01')
select au.action, coalesce(up.role,'(sin usuario: servidor/SQL)') rol_actor,
 case when au.reason like '(sin motivo%' then au.reason when au.reason like 'Solicitud del trabajador%' then 'via solicitud del trabajador'
      when au.reason like 'FORZADO%' then 'forzado' else 'con motivo escrito' end motivo,
 coalesce(au.a_type, au.b_type) tipo, count(*) n,
 round(avg(extract(epoch from (au.a_dt-au.b_dt))/60)) min_movidos_media,
 count(*) filter (where au.a_dt < au.b_dt) hacia_atras, count(*) filter (where au.a_dt > au.b_dt) hacia_delante
from au left join user_profiles up on up.user_id=au.actor_user_id group by 1,2,3,4 order by 1,2,3,4;
-- edit · admin · con motivo · salida: 7 (−43 min de media, 6 hacia atrás) · edit · admin · vía solicitud · salida: 1
-- create_manual · admin · salida: 10 · approve · admin: 8
-- Sin usuario (SQL del 07/08): edit 582 sin cambio + 7 con motivo; void 36 con motivo; void 6 «borrado físico directo».
-- (Que todo lo de sin usuario es del 07/08 sale de agruparlo por día: una sola fecha.)
```

**Q6 · Salidas de Foodint desde el 01/08, por origen y rastro**
```sql
with f as (select * from clock_entries where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and datetime >= '2026-08-01' and type='salida'),
a as (select clock_entry_id, array_agg(distinct action) acts from clock_entry_audit where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' group by 1)
select f.source, case when a.acts @> array['create_manual'] then 'create_manual' when a.acts is not null then array_to_string(a.acts,',') else 'sin auditoria' end rastro,
 (f.created_at - coalesce(f.real_datetime,f.datetime) > interval '10 minutes') creada_despues, f.voided, count(*)
from f left join a on a.clock_entry_id=f.id group by 1,2,3,4;
-- kiosko sin auditoría 446 · kiosko editadas 38 (+2 editadas y anuladas, +1 anulada) · manual con create_manual 10. Total 497.
```

**Q6b · De las 40 salidas editadas, quién movió la hora**
```sql
with f as (select id from clock_entries where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and datetime >= '2026-08-01' and type='salida'),
a as (select x.clock_entry_id, bool_or(x.actor_user_id is not null and x.action='edit') edit_admin,
  bool_or(x.actor_user_id is null and x.action='edit') edit_sql,
  bool_or((x.before->>'datetime') is distinct from (x.after->>'datetime') and x.action='edit') hora_movida
  from clock_entry_audit x where x.action='edit' group by 1)
select edit_admin, edit_sql, hora_movida, count(*) from f join a on a.clock_entry_id=f.id group by 1,2,3;
-- solo SQL, sin mover la hora: 33 · administrador, hora movida: 5 · las dos, hora movida: 2
```

**Q7 · Las salidas manuales de Foodint desde el 01/08, por vía**
```sql
select case when address like 'Aprobado ·%' then 'solicitud aprobada' when address like 'Manual · FORZADO%' then 'admin, forzada'
            when address like 'Manual ·%' then 'admin con motivo' else 'otro' end via, type, count(*)
from clock_entries where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and source='manual' and datetime>='2026-08-01' group by 1,2;
-- salida: 4 por solicitud aprobada, 6 del administrador con motivo. entrada: 2 por solicitud, 1 del administrador.
```

**Q8 / Q9 · Los olvidos de Foodint desde el 01/08 y cuánto tardaron en cerrarse**
```sql
with e as (select c.*, coalesce(c.real_datetime,c.datetime) t from clock_entries c
  where c.account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and not c.voided and c.type in ('entrada','salida')),
o as (select e.*, lead(type) over w nt, lead(t) over w nts, lead(created_at) over w ncreated, lead(source) over w nsrc
  from e window w as (partition by employee_id order by t)),
j as (select *, case when nt is null then 'sigue abierta' when nt='entrada' then 'nunca se cerró' when nsrc='manual' then 'salida manual'
  when ncreated - nts > interval '10 minutes' then 'fichada y movida atrás' when nts - t > interval '12 hours' then 'fichada >12 h después' end como
  from o where type='entrada' and t >= '2026-08-01')
select como, count(*), count(distinct employee_id) personas,
 round(percentile_cont(0.5) within group (order by extract(epoch from (ncreated - t))/3600)::numeric,1) mediana_h,
 round(max(extract(epoch from (ncreated - t))/3600)::numeric,1) max_h, round(avg(extract(epoch from (nts - t))/3600)::numeric,1) jornada_media_h
from j where como is not null group by 1 order by 2 desc;
-- salida manual 7·3·36,7·105,0·8,9 · >12 h 6·3·15,8·28,2·16,8 · movida atrás 6·5·8,2·16,5·4,6 · nunca se cerró 2·2 · abierta 1·1
-- Las cerradas con normalidad (misma consulta sin el filtro): 468, jornada media 5,1 h. Total, unas 490.
```

**Q10 · Las peticiones de corrección**
```sql
select a.name, r.kind, r.proposed_type, r.status, count(*), count(*) filter (where r.created_at > now()-interval '60 days') ult60,
 round(avg(extract(epoch from r.resolved_at - r.created_at)/3600)::numeric,1) horas_hasta_resolver
from clock_correction_request r join accounts a on a.id=r.account_id group by 1,2,3,4;
-- Foodint, todas aprobadas: add entrada 2 (94,5 h) · add salida 4 (49,5 h) · edit entrada 1 (54,4 h) · edit salida 1 (8,5 h). 8 en total, 6 en 60 d.
```

**Q11 · Los avisos de WhatsApp por estado**
```sql
select l.status, coalesce(l.skip_reason, left(l.error, 90)) motivo, count(*), min(l.created_at at time zone 'Europe/Madrid')::date,
 max(l.created_at at time zone 'Europe/Madrid')::date, count(distinct l.employee_id) personas
from clockout_reminder_log l group by 1,2;
-- failed · (#132001) Template name does not exist in the translation · 64 · 05/08 – 18/09 · 6 personas
-- sent · 51 · 18/09 – 26/10 · 5 personas
```

**Q12 · ¿A qué apuntaba cada aviso, y los olvidos tuvieron aviso?**
```sql
select l.status, c.type, count(*) n,
 count(*) filter (where coalesce(c.real_datetime,c.datetime) < coalesce(l.sent_at,l.created_at)) marca_anterior_al_aviso,
 round(avg(extract(epoch from (coalesce(l.sent_at,l.created_at) - coalesce(c.real_datetime,c.datetime)))/60)) min_desde_la_marca,
 count(*) filter (where extract(hour from (l.created_at at time zone 'Europe/Madrid')) between 0 and 5) de_madrugada
from clockout_reminder_log l join clock_entries c on c.id=l.clock_entry_id
where l.account_id='51ad1792-6629-4ef7-833a-b57b09a86710' group by 1,2;
-- sent: salida 48 (11 de madrugada), entrada 3 (276 min) · failed: salida 48, entrada 16
-- Mediana del aviso tras el fin del turno: 155 min. Tras un aviso a una entrada abierta, salida en 2 h: 2 de 3.

-- Olvidos (la definición de Q8) desde el 05/08 y si su entrada tuvo aviso:
--   antes del 18/09: 14 olvidos, 0 con aviso · desde el 18/09: 5 olvidos, 0 con aviso.
--   Entradas con aviso que no eran olvido: 16 antes y 3 después. En los 19 olvidos, la persona tenía el aviso aceptado.
```

**Q13 · Quién mira los avisos**
```sql
select string_agg(proname, ', ') from pg_proc where pronamespace='public'::regnamespace
 and prosrc ~* 'clockout_reminder_log' and proname <> 'enqueue_clockout_reminders';   -- nada
select jobname, schedule from cron.job where command ~* 'clock';                       -- solo clockout-reminder-drain, */10
```

**Q14 · El origen del fichaje y las pistas para distinguir lo antiguo**
```sql
select coalesce(source,'sin') s, count(*) from clock_entries group by 1;   -- tabla entera: kiosko 2.144, manual 23
with k as (select * from clock_entries where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and source='kiosko')
select count(*), count(*) filter (where scheduled is not null) con_turno_teorico, count(*) filter (where lat is null) sin_gps,
 count(*) filter (where address like 'Sin ubicaci%') sin_ubicacion,
 count(distinct (round(lat::numeric,4), round(lng::numeric,4))) puntos_11m,
 (select max(n) from (select count(*) n from k where lat is not null group by round(lat::numeric,4), round(lng::numeric,4)) z) mas_repetido
from k;   -- 1.478 · 429 · 50 · 49 · 186 · 390
-- Por mes, puntos distintos a 100 m (round 3): jun 19, jul 34, ago 21, sep 23, oct 16.
```

**Q15 · Accesos del portal**
```sql
select count(*) filter (where last_sign_in_at > now()-interval '60 days'), count(*) from auth.users where email like '%@empleado.folvy.app';
-- 6 de 11 · accesos creados en 60 días: 0 · user_profiles por rol: worker 11, admin 4
```

**Q16 · Nóminas: bandeja, coste y ajustes**
```sql
select source, created_at::date, period_year, period_month, status, count(*) from payroll_inbox group by 1,2,3,4,5;
-- gmail · 09/07 · 2026-6 · matched · 7   y   gmail · 04/08 · 2026-7 · matched · 6
select status, needs_review, count(*) from payroll_cost group by 1,2;    -- definitiva · false · 13
select connected, inbound_address is not null, source_email is not null, last_sync_at from payroll_settings;  -- false · sí · sí · vacío
```

**Q17 · Lo que lee la nómina, y los nombres de los documentos**
```sql
select count(*) filter (where irpf is not null), count(*) filter (where employee_ss is not null),
 count(*) filter (where (raw->'parsed'->'payslip'->>'deductions_total') is not null),
 count(*) filter (where jsonb_typeof(raw->'parsed'->'earnings_lines')='array'),
 count(*) filter (where jsonb_typeof(raw->'parsed'->'deduction_lines')='array') from payroll_cost;   -- 0 · 0 · 13 · 13 · 0
select (name ~ '^[0-9a-f]{8}-') nombre_es_uuid, notes = 'Ingesta automática de nómina' automatica, count(*) from documents where type='nomina' group by 1,2;
-- uuid y automática: 13 · el resto (subidas a mano, mayo–julio): 10
```

**Q18 · Ausencias esperando en Foodint**
```sql
select type, (now()::date - requested_at::date) dias_esperando, (start_date - now()::date) dias_hasta_inicio
from vacations where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and status='solicitada';
-- vacaciones · 15 · 13 / vacaciones · 15 · 41 / vacaciones · 3 · 55
```

**Q19 · Lo que lee un trabajador real (transacción de solo lectura, con rollback)**
```sql
begin read only;
select set_config('request.jwt.claims', (select json_build_object('sub', user_id, 'role', 'authenticated')::text
  from user_profiles where role='worker' and active and account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
  and employee_id is not null order by created_at limit 1), true);
set local role authenticated;
select count(*), count(salary), count(dni), count(pin) from employees;                        -- 8 · 8 · 8 · 6
select count(*) from employees e where not exists (select 1 from user_profiles up
  where up.user_id = auth.uid() and up.employee_id = e.id);                                    -- 7 (compañeros)
select count(*) from clock_entries where lat is not null;                                      -- 1.430
select count(*) from payroll_cost;                                                             -- 13
select count(*) from vacations where type='baja_medica';                                       -- 2
select count(*) from documents;                                                                -- 28
rollback;
```

**Q20 · El bucket de los documentos**
```sql
select id, public from storage.buckets where id='employee-documents';                              -- público: sí
select policyname, roles, cmd from pg_policies where schemaname='storage' and policyname='anon_all_employee_documents';
-- {public} · ALL · qual y with check: bucket_id = 'employee-documents'
select ((storage.foldername(name))[1] = '_inbox') de_la_bandeja, count(*), min(created_at)::date, max(created_at)::date
from storage.objects where bucket_id='employee-documents' group by 1;
-- fichas: 22 (22/05 – 19/07) · bandeja de nóminas: 13 (09/07 – 04/08)
```
