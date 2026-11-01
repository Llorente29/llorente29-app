# N1 · Paso 0 · Informe de solo lectura (01/11/2026)

La ficha de la persona de Laboral, antes de escribir nada. Lo de producción está
medido hoy con consultas de solo lectura, y aquí van **solo cifras y nombres de
columna**, ningún dato de nadie. Las capturas son de staging, de la cuenta A, con
datos inventados.

**Lo que más pesa de este informe:**

1. **En producción no hay todavía ningún lote de Cegid:** 0 lotes y 0 filas. El
   volcado del PR 1 no tiene nada que volcar hasta que se suba el fichero con
   el importador.
2. **Foodint tiene hoy 8 personas en Folvy, y el encargo espera 19 personas y
   31 contratos** desde Cegid. El volcado tendrá que crear unas 11 fichas
   nuevas, casi seguro bajas, y cada una necesita su local.
3. **El paquete de Cegid no trae todo lo que pide el contrato:** faltan el
   periodo de prueba, la ocupación (CNO), las bonificaciones, la cuenta de
   cotización de cada contrato, el salario pactado como dato propio y el 145
   entero. Hay que decir de dónde sale cada uno, o que la ficha lo enseñe como
   «Falta», nunca escondido (regla 7).
4. **Hoy no existe un «permiso de Laboral»:** el salario, el DNI y el
   nacimiento los ve solo el administrador. Hay una casilla
   `manager_permissions.show_salaries`, pero no la usa ninguna cuenta y
   `empleados_datos_privados` no la mira.

Al final van las seis preguntas que necesito que contestes antes del PR 1.

---

## 1 · Inventario de la ficha de hoy

La ficha de hoy es el modal de `src/pages/StaffPage.tsx`, con 8 pestañas. Se
abre al pulsar una tarjeta de Personal › Empleados. Lee y guarda por
`src/services/supabaseSync.ts`:

- `rowToEmployee` y `filaDeEmpleado`;
- `COLUMNAS_DE_LA_FICHA`: las columnas que ve cualquiera que vea la ficha;
- `empleados_datos_privados`: el salario, el DNI, el nacimiento y la SS de la
  empresa, solo para el administrador.

Las pantallas de destino son las de la maqueta:

- **Resumen** (pantalla 1)
- **Contrato y salario** (pantalla 2)
- **Impuestos (IRPF)** (pantalla 3)
- **Seguridad Social**
- **Tiempo y turnos**
- **Vacaciones**
- **Nóminas**
- **Documentos** (pantalla 6)
- **Historial**
- **Más acciones**
- **Portal** (pantalla 7)

### Datos

| Campo | De dónde sale | Va a |
|---|---|---|
| Foto | `employees.photo` (texto: la imagen en base64, reducida a 800 px) | Resumen, cabecera (la cambia ella desde el portal: PR 3) |
| Nombre completo | `employees.name` | Resumen, cabecera; Quién es |
| DNI / NIE | `employees.dni` (privada: solo el administrador) | Resumen › Quién es |
| Fecha de nacimiento | `employees.birth_date` (privada) | Resumen › Quién es, con la edad |
| Teléfono | `employees.phone` | Resumen › Quién es (móvil); botones Llamar y WhatsApp del encargado |
| Email | `employees.email` | Resumen › Quién es |
| Puesto | `employees.position` (Folvy: lista `POSITIONS`; Sumied: texto con sugerencias) | Resumen, la frase; Contrato › puesto y funciones |
| Área | `employees.department`, de `staff_role` | Tiempo y turnos (es de cuadrante) |
| Local principal | `employees.location_id` | Resumen, la frase («en Alcalá»); Contrato › centro |
| Locales asignados | `employees.assigned_locations` | Tiempo y turnos |
| PIN del kiosko | `employees.pin` al guardar; un disparador de la 1215 lo pasa a `employee_kiosk_pin` y deja la columna vacía (0 PIN en `employees` en producción) | Tiempo y turnos, o Más acciones |
| En activo / de baja, tipo y motivo, comunicada a la gestoría | `employees.active`, `termination_type`, `termination_reason`, `termination_communicated_to_gestoria` | Resumen, la etiqueta «De alta»; la baja, en Más acciones (como pide el encargo, hasta el N3) |
| Avisos de caducidad | `EmployeeExpiryBanners` (fin de contrato y de prueba, calculados) | Resumen › los avisos con su botón |
| Notas | `employees.notes` | Resumen (o Historial, si se prefiere: pregunta abierta, no la hago) |

### Fichajes

- **De dónde sale:** `clock_entries`, por `fetchEmployeeDailyDetail`, y el registro de jornada mensual con sus totales (`fetchRegistroJornadaMensual` / `Totales`). Se pueden descargar, corregir y añadir un fichaje a mano, con su motivo.
- **Va a:** Tiempo y turnos, tal cual.

### Bolsa

- **De dónde sale:** `fetchEmployeeBalance` (`hoursBalanceService`) y, para quien ve salarios, `fetchTeamHoursSummary`.
- **Va a:** Tiempo y turnos, y «Este mes» del Resumen.

### Docs

- **De dónde sale:** `DocumentosTab` → `documentsService`, la tabla `documents` y el almacén `employee-documents`.
- **Va a:** Documentos (punto 3).

### Ausencias

- **De dónde sale:** `VacacionesTab`: `vacations` y `vacation_settings`.
- **Va a:** Vacaciones, y «Este mes» del Resumen (las que le quedan).

### Formaciones

- **De dónde sale:** `FormacionesTab` → `trainingComplianceService`, la función `training_compliance_matrix` (punto 3).
- **Va a:** Documentos › Formación obligatoria.

### Contrato

| Campo | De dónde sale | Va a |
|---|---|---|
| Tipo de contrato | `employees.contract_type` (texto libre) | Contrato y salario › El contrato, ya con clave (punto 5) |
| Fecha de alta | `employees.start_date` | Contrato › inicio; la frase |
| Fecha fin contrato | `employees.end_date` | Contrato; aviso de fin de contrato |
| Periodo de prueba (días) | `employees.trial_period_days` | Contrato; aviso de fin de prueba |
| Salario bruto anual | `employees.salary` (privada) | Contrato y salario › Lo que cobra, como suma de conceptos (punto 5) |
| Coste SS empresa (anual) | `employees.employer_ss_annual` (privada) | Resumen › Lo que cobra › coste para la empresa |
| Horas semanales | `employees.weekly_hours` (y `contracted_hours_week`, que la ficha no enseña) | Contrato › Convenio y jornada |
| Saldo inicial de la bolsa | `employees.initial_hours_balance`, `show_hours_balance` | Tiempo y turnos |
| Código en el cuadrante, franja, patrón de descanso, horario por días | `shift_code`, `shift_period`, `rest_pattern`, `weekly_schedule` | Tiempo y turnos («el horario sale del cuadrante») |

### Disponibilidad

| Campo | De dónde sale | Va a |
|---|---|---|
| Disponibilidad por días | `employees.availability` (y `employee_availability`, 75 filas) | Tiempo y turnos |
| Acceso al portal y tipo de acceso (trabajador o encargado) | `AccesoTrabajadorPanel` (`user_profiles`) | Resumen, la etiqueta «Entra en su portal»; Más acciones |
| Mandar un mensaje | `SendMessageModal` | Más acciones |
| Dar de baja | `TerminationModal` | Más acciones |
| Corregir un fichaje | `CorregirFichajeModal` | Tiempo y turnos |
| Borrar la persona | `deleteEmployee` | Más acciones, con confirmación |

**Dos columnas que la ficha no enseña y no se pueden perder:**

- **`employees.schedule`**: texto. Se arrastra, pero no se pinta.
- **`employees.forgot_clockout_reminder`**: el recordatorio de fichaje. Se edita en otra pantalla. Va a Tiempo y turnos.

`employees.username` es del acceso: va a Más acciones.

---

## 2 · Datos privados

**Lo que hay hoy** (producción, 01/11):

**Permisos de `employees`:**

- `salary`, `dni`, `birth_date` y `employer_ss_annual` **no tienen `select`** para `authenticated` ni `anon` (la 0731).
- Las otras 34 columnas, sí, como dice `employees-columnas.mjs`.
- La RLS sobre esas 34:
  - `employees_read`: `current_user_ve_persona`, que deja ver al administrador, a la propia persona y al encargado de su local;
  - `employees_write`: solo el administrador.

**`empleados_datos_privados(p_account_id)`:**

- devuelve `id, salary, dni, birth_date, employer_ss_annual`, solo si `current_user_is_admin_of(account)`;
- desde el DM1, eso solo vale en la cuenta abierta.

**El encargado:** no ve el salario, el DNI ni el nacimiento. `upsertEmployee` no los manda cuando no los ha leído (`datosPrivados: 'ocultos'`), para no borrarlos.

**No existe un «permiso de Laboral»:**

- Hoy, «ver datos privados» es exactamente «ser administrador».
- `manager_permissions.show_salaries` existe, pero la única fila de toda la base es de Folvy Interno y la tiene en `false`. Ninguna función la mira.

**Propuesta: salario, IBAN, NAF, 145 y conceptos, fuera de `employees`, en tablas propias de Laboral.**

1. **Ninguna columna nueva en `employees`.** Lo nuevo va en tablas `lab_*` (punto 5) con su RLS. Así la regla de la 0731 se cumple sin excepciones: no hay columna nueva que pueda nacer abierta.
2. **Una función de permiso, `current_user_ve_laboral(account)`:**
   - el administrador, sí;
   - y quien tenga el permiso de Laboral, si quieres que exista además del administrador (pregunta 1);
   - el encargado, nunca.
   - La usan las políticas de las tablas nuevas y la función de datos privados.
3. **Lo que va en esas tablas:**
   - **NAF, IBAN, domicilio, nacionalidad, sexo, estudios y discapacidad:** en `lab_persona`, una fila por persona, solo para Laboral. El portal la cambia por solicitud (PR 3), y el IBAN nunca se aplica sin aprobación.
   - **El salario:** sale de los conceptos (`lab_persona_concepto`).
     - `employees.salary` se queda como está mientras lo lean Plantilla, la predicción y los costes.
     - El volcado la rellena con el bruto anual de los conceptos, para que esas pantallas sigan dando lo mismo.
     - Retirarla es otra tanda, en dos pasos (front primero).
   - **El 145 y los conceptos:** `lab_modelo_145` y `lab_persona_concepto`, solo para Laboral.
   - **`dni` y `birth_date`:** se quedan en `employees`, cerradas como hoy. El kiosko, Formación y otras pantallas ya los esperan ahí.

---

## 3 · Documentos y formación

**`documentsService`:**

- **La tabla `documents`:** `id, employee_id, type, name, file_path, file_size_kb, uploaded_by, uploaded_role, notes, created_at`.
- **Los ficheros:** en el almacén privado `employee-documents`, en `{persona}/{fecha}-{nombre}`.
- **Al abrir:** enlace firmado que caduca en `MINUTOS_ENLACE_DOCUMENTO` minutos.
- **Hoy en producción:** 34 documentos, todos `uploaded_role = gestor`.

| Cuenta | `contrato` | `nomina` |
|---|---|---|
| Foodint | 8 | 20 |
| Folvy Interno | 3 | 3 |

- **Quién los ve** (RLS `documents_read`): el administrador y la propia persona.
- **Quién los escribe** (`documents_write`): solo el administrador.
  - Ojo: la política llega a la cuenta por `employees.location_id → locations`. Una persona sin local no tendría documentos que escribir. Lo arreglo cuando toque documentos: que mire `employees.account_id`.

**Lo que ve el trabajador en su portal** (`src/pages/trabajador/MisDocumentos.tsx`):

- solo lectura: sus documentos, con su tipo y su enlace que caduca;
- no sube ni borra;
- no hay carpetas, ni caducidad, ni firma, ni «lo ve ella»: hoy lo ve todo lo suyo.

**Formación** (`trainingComplianceService.getTrainingComplianceMatrix`, la función `training_compliance_matrix(account, local, solo obligatorios)`):

- **Una fila por persona:** `employee_id`, `employee_name`, `doc_id`, `role`, `location_name`.
- **Y `courses`, un mapa por curso** con:
  - `state`: vigente, caducado, pendiente, en curso, pendiente de práctica o no aplica;
  - `completed_at`, `expires_at`, `score_pct` (la nota) y `signed`.
- **Hoy:** `FormacionesTab` ya la lee para una persona.
- **Para la ficha:** Documentos › Formación obligatoria lee esto mismo, filtrado a la persona. El certificado está en los almacenes `course-certificates` y `course-signatures`.
- **Con «solo Sumied»** no hay matriz: se pide el certificado y entra en `documents` con carpeta Formación.

---

## 4 · Foto

- **Dónde vive:** en `employees.photo`, como texto, con la imagen en base64. `PhotoUploader` (dentro de `StaffPage.tsx`) la reduce a 800 px con `compressImageToBase64`.
- **Quién la puede leer:** cualquiera que vea la ficha. También los compañeros, por `companeros_de_trabajo`.
- **En producción:** 0 de 22 personas tienen foto, en las tres cuentas.
- **¿La cambia el trabajador desde su portal?** No. El portal solo la lee, en los cambios de turno: `SolicitarCambioModal`, `MisCambiosView` y `TablonCambiosView`. Además, `employees_write` solo deja escribir al administrador.

**Propuesta para el PR 3:**

- **Dónde va la foto:** a un almacén privado (`employee-photos`), y en `employees.photo` solo su ruta. Ahora que no hay ninguna, no hay nada que mover.
- **Cómo la cambia ella:** con una función de servidor que solo deje a la propia persona cambiar la suya, sin abrirle `employees`.

---

## 5 · Modelo de datos propuesto (sin escribirlo todavía)

Todas las tablas nuevas cumplen esto:

- llevan `account_id` (regla 9) y RLS con `current_user_ve_laboral`;
- nadie escribe directo en ellas: se escriben por funciones de servidor que apuntan el historial;
- son tablas nuevas o columnas que admiten nulos, así que el analizador las clasifica como «añade» y pasan en la misma tanda.

**`lab_contrato` · El contrato laboral, con su historia**

- Una fila por contrato, que no se pisa:
  - `employee_id`, `numero` (el `contrato_n` de Cegid);
  - `clave` (la del SEPE, 3 cifras: 100, 189, 200, 289, 401, 402, 501…, con su nombre al lado en pantalla) y `descripcion`;
  - `fecha_alta`, `fecha_fin_prevista`, `fecha_baja`, `motivo_baja`;
  - `periodo_prueba_dias`, `antiguedad_reconocida` (la fecha de los trienios);
  - `origen` (`cegid` o `sumied`) y su rastro (`lote_id`, `fila_n`).
- **Lo que cambia sin ser otro contrato va en versiones, `lab_contrato_condicion`.** Cada cambio es una fila nueva con `vigente_desde`, y la de antes se cierra con `vigente_hasta`, nunca se edita. Lleva:
  - grupo de cotización, CNO, categoría (código y nombre) y convenio;
  - centro (`location_id`) y cuenta de cotización;
  - jornada (completa o parcial), coeficiente y horas a la semana;
  - bonificaciones (código, desde y hasta);
  - y el motivo.
  - Así funciona «Lo que va a cambiar, con sus fechas».

**`lab_convenio` y `lab_convenio_tabla` · El convenio y sus tablas**

- Por cuenta. De las hojas Convenio y Tablas_salariales:
  - del convenio: código, nombre, código oficial, horas anuales y por día, vacaciones y pagas;
  - de cada tabla: categoría, concepto, importe y modo de pago, con `vigente_desde`.
- Con esto sale «Cobra por encima del mínimo del convenio (+…)».

**`lab_concepto` y `lab_persona_concepto` · Los conceptos salariales**

- **`lab_concepto`:** el catálogo de la cuenta, de la hoja Conceptos:
  - código, nombre, tipo y código RED;
  - si cotiza, si tributa y si es devengo o deducción, derivado del tipo.
- **`lab_persona_concepto`:** lo que cobra cada persona:
  - persona, contrato, concepto, importe y periodicidad (mes o paga);
  - **origen: `convenio` o `pactado`**;
  - `vigente_desde` y `vigente_hasta`.
- El bruto de la frase y de «Lo que cobra cada mes» es la suma de lo vigente.

**`lab_modelo_145` · El 145**

- Una fila por comunicación, con su fecha de efecto. La nueva no borra la anterior.
- Lleva:
  - la situación familiar (1, 2 o 3) y el NIF del cónyuge si es la 2;
  - la discapacidad y si necesita ayuda;
  - la movilidad geográfica;
  - los hijos (año de nacimiento o de adopción, discapacidad, cómputo por entero);
  - los ascendientes;
  - la pensión compensatoria y las anualidades por alimentos;
  - el préstamo de vivienda de antes de 2011;
  - el tipo voluntario pedido;
  - el documento firmado (`document_id`) y cuándo se firmó en el portal.

**`documents`, ampliada · Los documentos**

- Solo columnas nuevas que admiten nulos, así los 34 de hoy siguen igual:
  - `carpeta` (identidad, contrato, ss_sepe, impuestos, formacion, nominas, otros);
  - `origen` (`ella`, `sumied`, `llego_solo`, `formacion`, `empresa`);
  - `caduca_el`, `visible_trabajador` (por defecto `true`, que es lo de hoy);
  - `firmado_at`, `firmado_por` y `firma` (cómo se firmó);
  - `archivado_at`;
  - `peticion_id`, para «Pedirle un documento».
- **`lab_documento_peticion`:** lo que se le pide (tipo, carpeta, fecha, recordatorios) y su estado. Va en el PR 3.
- **Recomiendo ampliar `documents`** en vez de hacer una tabla nueva: el portal, el almacén y los 28 de Foodint ya viven ahí. Pregunta 4.

**`lab_cambio` · El historial de cambios**

- Cada cambio en una fila:
  - persona, qué (tabla y campo) y su registro;
  - antes y después;
  - **fecha de efecto**, quién, cuándo y **por qué**.
- La escriben las mismas funciones que guardan. Solo la ve Laboral, porque lleva salarios.

---

## 6 · El importador LAB1: qué hay cargado y cómo se vuelca

**Qué hay hoy:**

- **En producción:** **0 lotes y 0 filas** en `lab_import_lote` y `lab_import_fila`. La 0850 y la 0950 están en el historial y las funciones existen, pero nadie ha subido el fichero todavía.
- **En staging:** solo los paquetes inventados de la e2e.

**Lo que hace falta antes del caso real del PR 1:** que subas el paquete de Cegid de Foodint en producción, en Sumied › Laboral › Importar historial, primero las cabeceras y después «Cargar las filas». El fichero no entra en el repositorio.

**Cómo pasa de las filas al modelo, sin volver a subir el Excel.** Una función de servidor, `lab_volcar_lote(lote)`, solo para Laboral y con el lote «leido»:

1. **Empresa y Convenio** (`{campo, valor}`):
   - el convenio va a `lab_convenio`;
   - de Empresa, el CCC es la cuenta de cotización por defecto, y «centros de trabajo» sirve para el mapeo de centros (pregunta 3).
2. **Tablas_salariales y Conceptos:** a `lab_convenio_tabla` y `lab_concepto`.
3. **Trabajadores:** cada fila busca su persona por **NIF**, normalizado, dentro de la cuenta (regla 9).
   - **Si existe:** completa lo que falte, sin pisar lo que ya tenga Folvy, y lo que difiera se apunta como aviso.
   - **Si no existe:** crea la ficha, de baja si `en_alta_hoy` es «no» (pregunta 6).
   - NAF, IBAN, domicilio y lo demás privado van a `lab_persona`.
   - El volcado no saca ningún valor fuera de la base.
4. **Contratos:** cada fila, por (trabajador, `contrato_n`), a `lab_contrato` y su primera `lab_contrato_condicion`. Repetirlo no duplica nada: se reconoce por el número y por el rastro (`lote_id`, `fila_n`).
5. **El salario:** Cegid no lo trae en Contratos. Sale de dos sitios:
   - **lo de convenio:** de `Tablas_salariales` (convenio y categoría);
   - **lo pactado:** de los conceptos de la última nómina de esa persona, en Nominas_conceptos, con origen `pactado` cuando no está en las tablas.
   - Pregunta 2.
6. **Cada fila queda marcada en `lab_import_fila`:**
   - `estado`: ok, aviso o error;
   - `mensajes`: el porqué, en palabras;
   - `destino_tabla` y `destino_id`.
   - Ya existen desde la 0850.
   - La pantalla lo cuenta: «19 personas y 31 contratos al día desde Cegid»; y si algo no entra, «Contrato 2 de [persona]: el centro "X" no es ningún local de la cuenta».

**Lo que Cegid no trae, y cómo sale en la ficha:**

| Dato | En el paquete | En la ficha |
|---|---|---|
| Periodo de prueba | No | Vacío, con «Falta: ponlo desde Cambiar algo del contrato» |
| Ocupación (CNO) | No | Igual; en el PR 4, Sumied lo propone por el puesto |
| Bonificaciones | No | «Ninguna apuntada», con «Ver si le correspondería alguna» |
| Cuenta de cotización por contrato | Solo la de la empresa (CCC) | La de la empresa, salvo que digas otra cosa |
| Horas a la semana | Solo `coef_parcial` | Horas del convenio × coeficiente |
| Clave del contrato | `tipo_contrato` (a confirmar si viene la clave de 3 cifras o un texto) | Si es texto, se busca su clave y lo que no case se enseña como aviso |
| 145 | No | «Falta su 145: pídeselo en el portal» (PR 3) |
| Tipo de IRPF | Solo en Nominas (`Retención` y `Base I.R.P.F.` del último mes) | El tipo de la última nómina, como «el de su última nómina en Cegid» |

---

## 7 · Capturas de ahora

Son de la ficha de hoy en Folvy, staging, cuenta A (datos inventados):

- la lista, y cada una de las 8 pestañas;
- en ordenador (1440) y en móvil (390);
- las saca `tests/e2e/laboral/n1-ficha-de-hoy.spec.ts` y van en el artefacto del run, como adjuntos del informe de Playwright.

El enlace va en el mensaje del paso 0.

---

## Preguntas antes del PR 1

1. **¿Quién, además del administrador, ve salario, IRPF, IBAN y conceptos?** ¿Un permiso de Laboral nuevo, que se da por persona, o solo el administrador por ahora?
2. **¿Qué salario comparas con Cegid en el caso real?** ¿El bruto mensual de los conceptos de la última nómina, o el de las tablas del convenio más lo pactado?
3. **¿Cada «centro» de Cegid a qué local de Foodint va?** Foodint tiene 3 locales en Folvy. Lo propongo por el nombre en la pantalla del volcado, y lo confirmas tú.
4. **¿Los documentos van en `documents` ampliada (recomendado) o en una tabla nueva?**
5. **¿Subes ya el paquete de Cegid en producción**, cabeceras y filas, para que el PR 1 tenga su caso real?
6. **¿Las personas de Cegid que no están en Folvy (unas 11) se crean como bajas** (`active = false`) con su contrato cerrado? Así salen en el historial y en las cuentas, y no en el cuadrante.
