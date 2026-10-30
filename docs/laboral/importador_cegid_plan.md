# Importador del historial de personal desde Cegid · diseño de tablas y plan

> 29/10/2026. Encargo de Julio: preparar, mientras llega la maqueta de la ficha,
> el importador del paquete de Cegid `lab_paquete_personal.xlsx`. El paquete
> trae trabajadores, contratos, conceptos, tablas salariales y nóminas. Este
> encargo es solo el diseño y el plan: sin código, sin migraciones y sin un
> solo dato real en el repositorio. El fichero lo sube Julio a producción con
> el importador.

## 0 · Lo que hay hoy y lo que no

Medido en producción el 29/10, solo lectura y solo el catálogo:

- **`employees`**: la ficha. Lleva DNI, puesto, tipo de contrato (texto libre), alta y baja, salario, horas y tipo de baja.
- **`payroll_cost`**: una fila por persona y mes, con bruto, SS de empresa, coste, base, neto, IRPF y SS del trabajador. Hoy la llena el lector de PDF (`payroll-extract`).
- **`payroll_inbox`**: la bandeja de PDF de nómina.
- **`documents`**: los PDF adjuntos a la ficha.
- **No existe** nada para contratos con fechas, convenios, conceptos de nómina, tablas salariales ni líneas de una nómina. Todo eso entra nuevo.

**Lo que no sé todavía, y es lo primero (paso 1):** las columnas reales de las cinco hojas. El fichero no está en el repositorio ni en el Drive. El diseño de abajo es el destino. La traducción de cada columna de Cegid a ese destino se cierra al ver las cabeceras, nunca de memoria.

## 1 · Principios

- **Nada se pierde.** Cada fila del Excel se guarda tal cual, con su hoja, su número de fila y su huella. De ahí sale todo lo demás, y desde ahí se explica cualquier número.
- **Ensayo antes que real.** Primero se valida y se enseña lo que haría. Aplica solo cuando Julio lo confirma, en una transacción.
- **Se puede repetir.** Volver a subir el mismo fichero no duplica nada: cada cosa se ancla por su código de Cegid y su cuenta.
- **Se puede deshacer.** Todo lo que crea un lote lleva el `lote_id`. «Deshacer el lote» lo quita mientras nadie lo haya tocado después.
- **Regla 9.** Todo lleva `account_id`, y cada búsqueda por DNI o por código filtra primero por cuenta.
- **Regla 7.** La pantalla del importador enseña todas las filas: las buenas, las dudosas y las malas. El aviso dice «avisos», no «error».
- **Regla 8.** Cada botón dice lo que ha hecho, con números. Por ejemplo: «Aplicado: 22 personas (4 nuevas, de baja), 31 contratos, 312 nóminas, 0 errores».
- **Datos privados.** Salarios, DNI y nóminas los ven solo los administradores de la cuenta, como `empleados_datos_privados`. El encargado no.

## 2 · Las tablas

Todas son nuevas, así que el analizador las clasifica como «añade». Todas llevan RLS «solo administrador de la cuenta» (`current_user_is_admin_of(account_id)`). El prefijo `lab_` es el de Laboral de Sumied.

### 2.1 · El lote y lo crudo

**`lab_import_lote`**: una subida.

| columna | tipo | qué es |
|---|---|---|
| id | uuid pk | |
| account_id | uuid not null | |
| company_id | uuid | la empresa de Sumied (CIF), si la cuenta tiene varias |
| origen | text | `'cegid'` (después, a3, Sage…) |
| fichero_nombre | text | el nombre tal como llegó |
| fichero_huella | text | SHA-256 del fichero (la da el navegador): el mismo fichero dos veces se reconoce |
| fichero_ruta | text | en el bucket privado `laboral-import/<cuenta>/<lote>.xlsx` |
| estado | text check | `leido` → `validado` → `aplicado` / `deshecho` / `descartado` |
| resumen | jsonb | filas por hoja; ok, avisos y errores; qué crea y qué cambia |
| subido_por, subido_at, aplicado_por, aplicado_at | | quién y cuándo |

**`lab_import_fila`**: cada fila de cada hoja, tal cual.

| columna | tipo | qué es |
|---|---|---|
| id | uuid pk | |
| lote_id | uuid fk → lote (on delete cascade) | |
| account_id | uuid not null | duplicado a propósito, para la RLS y la regla 9 |
| hoja | text check | las nueve: `empresa`, `convenio`, `tablas_salariales`, `conceptos`, `trabajadores`, `contratos`, `nominas`, `nominas_conceptos`, `cuadre_contable` |
| fila_n | int | la fila del Excel, para decir «fila 37 de Contratos» |
| datos | jsonb | la fila cruda, con las cabeceras de Cegid como claves |
| huella | text | md5 de `datos`: si la fila cambia entre dos subidas, se ve |
| estado | text check | `ok`, `aviso`, `error`, `ignorada` |
| mensajes | text[] | en palabras de oficina |
| destino_tabla, destino_id | text, uuid | en qué se convirtió |

### 2.2 · El historial, ya normalizado

**`lab_persona_origen`**: el puente entre el código de trabajador de Cegid y nuestra ficha.

- Columnas: `account_id`, `origen`, `codigo_externo`, `employee_id` (fk → employees), `lote_id`.
- Único: `(account_id, origen, codigo_externo)`.
- Se casa por DNI normalizado dentro de la cuenta. Si no hay ficha, se crea una: de baja si en Cegid tiene fecha de baja.
- No se toca nada de una ficha que ya existe salvo los campos vacíos, y cada cambio queda en el resumen del lote.

**`lab_convenio`**: los convenios que usa la empresa.

- Columnas: `account_id`, `codigo` (el del REGCON, 14 cifras, si viene), `nombre`, `ambito`, `vigente_desde`, `vigente_hasta`, `codigo_externo`, `lote_id`.
- Único: `(account_id, origen, codigo_externo)`.
- Va por cuenta y no global: lo que trae Cegid es la versión que usa esa empresa. El núcleo decidirá si se comparte (pregunta 4).

**`lab_tabla_salarial`**: lo que paga el convenio por categoría y año.

- Columnas: `account_id`, `convenio_id`, `anio` (o `vigente_desde` / `vigente_hasta`), `categoria`, `grupo_cotizacion` (1–11), `concepto_id`, `importe`, `periodicidad` (`mes`, `anio`, `hora`, `dia`), `pagas`, `lote_id`.

**`lab_concepto`**: los conceptos de nómina de la empresa.

- Columnas: `account_id`, `codigo_externo`, `nombre`, `tipo` (`devengo`, `deduccion`, `aportacion_empresa`), `salarial` (bool), `cotiza_ss` (bool), `tributa_irpf` (bool), `cra` (código de concepto retributivo, si viene), `lote_id`.
- Único: `(account_id, origen, codigo_externo)`.

**`lab_contrato`**: cada contrato con sus fechas. Una persona puede tener varios.

- Columnas: `account_id`, `company_id`, `employee_id`, `codigo_externo`, `tipo` (código de contrato de 3 cifras), `descripcion`, `fecha_inicio`, `fecha_fin`, `fecha_fin_prevista`, `jornada_pct`, `horas_semana`, `categoria`, `grupo_cotizacion`, `convenio_id`, `location_id` (el centro), `ccc` (código de cuenta de cotización), `motivo_baja`, `lote_id`.
- Único: `(account_id, origen, codigo_externo)`.
- Aviso, no error, si dos contratos de la misma persona se pisan en fechas.

**`lab_nomina`**: la cabecera de cada recibo.

- Columnas: `account_id`, `company_id`, `employee_id`, `contrato_id`, `anio`, `mes`, `tipo` (`mensual`, `extra`, `atrasos`, `finiquito`), `fecha_pago`, `devengos`, `deducciones`, `liquido`, `base_cc`, `base_cp`, `base_irpf`, `pct_irpf`, `ss_trabajador`, `ss_empresa`, `coste_total`, `document_id` (el PDF, si lo hay), `lote_id`.
- Único: `(account_id, employee_id, anio, mes, tipo, origen)`.
- Comprobación al validar: devengos − deducciones = líquido, a ±0,01 €. Si no cuadra, aviso con la diferencia.

**`lab_nomina_linea`**: cada línea del recibo.

- Columnas: `nomina_id` (fk, on delete cascade), `account_id`, `concepto_id`, `orden`, `unidades`, `precio`, `importe`.
- Comprobación: la suma de las líneas de devengo es igual a `devengos`.

### 2.3 · Con lo que ya existe

- **`payroll_cost`** no se toca. El coste mensual que leen las pantallas de hoy sale de ahí.
  - Al aplicar, cada `lab_nomina` de un mes sin fila en `payroll_cost` crea la suya con `source = 'cegid'`.
  - Si ya hay una del PDF, gana el PDF y el lote lo apunta como diferencia (pregunta 3).
- **`employees`**: solo se rellenan los campos vacíos (DNI, alta, baja, puesto); nunca se pisa lo que ya hay.
- **`documents`**: si el paquete trae los PDF, van adjuntos a la ficha como hoy (tipo `nomina`).

## 3 · El importador, paso a paso

Las direcciones van todas por Sumied › Laboral › Importar historial.

1. **Las cabeceras primero.** Julio sube el fichero con «solo leer las cabeceras».
   - Se guarda el lote y se enseñan las hojas, sus columnas y cuántas filas tiene cada una. No se lee ningún valor.
   - Con eso cierro la traducción de columnas (`cegid.mjs`: «cabecera de Cegid → campo»).
   - No hace falta mandarme el fichero, solo las cabeceras.
2. **Leer.** El navegador lee el Excel con `xlsx` (ya está en el proyecto, como en bancos y recetas).
   - Manda las filas crudas a `lab_import_cargar(lote, hoja, filas jsonb)`, por trozos.
   - El fichero entero queda en el bucket privado, para poder releerlo.
3. **Validar** (`lab_import_validar(lote)`), sin escribir fuera del lote:
   - el DNI y el NIE con su letra (la misma comprobación que el alta corta);
   - fechas y periodos, y contratos que se pisan;
   - códigos que no existen (un contrato con un convenio que no está, una línea con un concepto que no está);
   - cuadres de cada nómina;
   - a quién casa cada trabajador: por DNI y por nombre, y cuántos serán fichas nuevas de baja.
   - Cada fila queda en `ok`, `aviso` o `error`, con su mensaje.
4. **Ver.** La pantalla enseña el resumen y todas las filas, filtrables por hoja y por estado. Por ejemplo: «Se crearán 31 contratos, 4 fichas de baja y 312 nóminas. Cambian 2 fichas: Ana (alta 01/03/2024, estaba vacía)».
5. **Aplicar** (`lab_import_aplicar(lote)`), todo en una transacción. Inserta o actualiza por la clave `(cuenta, origen, código)` y anota en cada fila del lote en qué se convirtió. Termina con el mensaje del principio 8.
6. **Deshacer** (`lab_import_deshacer(lote)`): quita lo que creó el lote. Se para si algo se ha tocado después y dice qué.

## 4 · El plan de trabajo

Por tandas pequeñas, cada una con su PR y la e2e primero en local (W09 + Playwright):

| tanda | qué | pruebas |
|---|---|---|
| 1 | **Hecha (#398, 0850).** Cabeceras: `lab_import_lote`, `lab_import_fila` y la pantalla «solo leer cabeceras» | unitarias; staging en ROLLBACK; e2e con un Excel **inventado** |
| 2 | **Hecha (LAB2, 0950).** Las filas de las nueve hojas, tal cual, en `lab_import_fila`: por trozos, sin duplicar al releer, y lo que sobra se quita | unitarias contra **las cabeceras reales** con filas inventadas; staging en ROLLBACK; e2e que carga, relee y cuenta por la API |
| 3 | **Pasa al N1 (PR 1, 30/10):** de las filas a fichas, contratos y conceptos del modelo nuevo de la ficha, con su resultado en pantalla y sin volver a subir el Excel | lo dice el encargo del N1 |
| 4 | Julio sube el paquete real en producción (las cabeceras y después las filas) | el resultado de la pantalla, pegado en el parte: filas por hoja |

**Sin datos reales en el repositorio:**
- Las pruebas usan un Excel inventado que se genera dentro de la prueba, con nombres y DNI de mentira con su letra bien puesta.
- Contra la población real (regla 31) se mide en producción, con el lote de Julio, y el parte pega recuentos, nunca filas.

## 5 · Lo que decidió Julio (29/10)

1. **Las cabeceras** las dio Julio, solo nombres. Son **nueve hojas**, no cinco, y están en `src/modules/conta/laboral/importar/cegidCabeceras.ts`:
   - **Empresa** y **Convenio**, de «campo · valor». De ellas solo se leen los nombres de la columna A.
   - Siete tablas: **Tablas_salariales**, **Conceptos**, **Trabajadores**, **Contratos**, **Nominas** (los importes del recibo, una columna cada uno), **Nominas_conceptos** (las líneas) y **Cuadre_contable** (nómina contra contabilidad, por mes).
2. **Las personas que ya no están** entran como fichas de baja.
3. **Nómina en el PDF y en Cegid:** gana el PDF de la gestoría, y la diferencia se enseña.
4. **Convenio** por cuenta, hasta el núcleo.
5. **Desde cuándo:** todo lo que traiga el paquete, desde 12/2023.
6. **Los PDF van aparte:**
   - un `lab_recibos_AAAA_MM.pdf` por mes con todos los trabajadores, de 12/2023 a 09/2026;
   - y los PDF de las fichas.
   - El importador parte cada PDF por persona y lo deja en su ficha (tanda propia, después de la 3).

**Cambio respecto a §4:** el fichero no se sube nunca. Se lee en el navegador: en la tanda 1 van a la base solo las cabeceras y cuántas filas tiene cada hoja; en la tanda 2, las filas tal cual. Sin el fichero guardado no hace falta el bucket privado: el que quiera releerlo, lo vuelve a elegir.

## 6 · Cómo encaja con lo que viene

- La **ficha nueva** (paso 2, con la maqueta de hoy) leerá `lab_contrato` y `lab_nomina`: el historial de contratos y de nóminas de cada persona.
- El **núcleo** (contrato, convenio, nómina, SS y SEPE) puede adoptar estas tablas tal cual o cambiarlas antes de que haya datos. Por eso las tandas 2 y 3 esperan al plan del núcleo, y la tanda 1 no.
- Las **nóminas por correo** (entrada.sumied.com) llegarán a `payroll_inbox` como hoy. Este importador es para el historial, una vez por empresa.
