# I01 · Impuestos · Paso 1: lo que hay que saber antes de construir

> Encargo de Julio, 17/10/2026. **Solo lectura**: sin código, sin migraciones, sin push y sin e2e.
>
> **Base leída:**
> - el código de `origin/main` @ `46d01527`;
> - la producción, solo con `begin read only … rollback`: estructura y recuentos, filtrados por la cuenta de Foodint (regla 9), sin NIF, IBAN ni CSV;
> - los textos oficiales que el repositorio ya guarda en `docs/conta/fuentes/textos/` (BOE consolidado).
>
> **Lo que NO he podido leer.** Desde este entorno la AEAT y el BOE no responden:
> - `sede.agenciatributaria.gob.es`, `www.agenciatributaria.es`, `www3.agenciatributaria.gob.es`, `prewww1.aeat.es` y `www.boe.es`;
> - la política de red del entorno los deniega, y la herramienta de páginas web no los resuelve.
>
> Lo que viene de la AEAT sale de **fragmentos de buscador** que citan sus páginas y PDF. Va marcado así:
> - **[F]**: lo dice un fragmento de la fuente citada; leído de segunda mano.
> - **[T]**: lo dice un texto oficial guardado en el repositorio; leído entero.
> - **[I]**: deducido de datos [F] o [T].
> - **[?]**: sin verificar; hay que leerlo en el PDF oficial antes de programar.
>
> En el §10 está la lista de lo que Julio tiene que descargar a mano, o los dominios que hay que permitir en el entorno para leerlo desde aquí.

---

## 0. En diez líneas

1. **Se puede presentar desde un programa la mayoría de los modelos.**
   - Las autoliquidaciones (303, 111, 115, 202, 390) van por **«Presentación Directa»**: un POST HTTPS con el fichero del diseño de registro y autenticación por **certificado de cliente en TLS**. Responde CSV y la dirección del PDF justificante [F].
   - Las informativas (190, 180, 347, 349) van por **TGVI Online**: primero se valida y después se presenta [F].
   - El **200** solo lo he visto confirmado por **Sociedades WEB**, el formulario con importación de fichero. Que vaya por servicio directo está sin confirmar [?].
2. **Hay validación sin presentar y hay entorno de pruebas** (`prewww1.aeat.es`, sin trascendencia tributaria) [F].
   - En pruebas **no se puede presentar en nombre de terceros** [F], así que el camino de la asesoría no se puede ensayar allí.
3. **No he encontrado ninguna API que devuelva el justificante a partir de un CSV.**
   - El cotejo por CSV es una página para personas [F].
   - Lo que sí hay es un servicio de **consulta de declaraciones presentadas** [F].
   - «Pegar el CSV y que se traiga solo el justificante» está por confirmar (§8).
4. **El certificado se guarda con un KMS externo, no en el Vault de Supabase.**
   - Con el Vault, cualquiera con acceso SQL de servicio lo descifra. Eso contradice lo que promete el tablero 8.
   - Además está **sin confirmar** que las funciones de Supabase sepan abrir una conexión con certificado de cliente (§2).
5. **Los libros de IVA de hoy dan el 303 de una empresa «normal»** (régimen general, tipos 21/10/4, sin recargo ni intracomunitarias). Para el resto falta:
   - el recargo de equivalencia en el libro (está a 0 siempre);
   - la autorrepercusión de la ISP y de las adquisiciones intracomunitarias;
   - las importaciones;
   - la prorrata aplicada;
   - el periodo mensual;
   - **un asiento de liquidación que el validador acepte**: hoy lo rechaza, comprobado en producción (§3).
6. **Los modelos de cada empresa ya se deducen y se guardan** (`company_tax_profile.tax_forms`; la regla está en `lib/modelos.ts`).
   - Falta guardar el **porqué** de cada uno y los datos de los que sale: empleados, alquiler con retención, ROI y volumen del año anterior. Hoy se preguntan en el alta y se tiran (§4).
7. **Los asientos de liquidación están en el PGC, cuentas 470–477 y 630** [T] (§5). Solo generan asiento el 303 y el 200/202; el 111 y el 115 solo el pago; las informativas, ninguno.
8. **Plazos (§6).** Con una diferencia respecto a lo que decidió Julio:
   - desde la **Orden HAC/241/2025** la domiciliación acaba **3 días hábiles** antes del último día, no «5 días» fijos [F];
   - casi siempre cae el 15, pero el 303 del 4T/2025 se pudo domiciliar **hasta el 27/01/2026**, no el 25;
   - y el **111 y el 115 del 4T se domicilian hasta el 15/01**, no el 25/01 [T].
9. **Modelo de datos (§7):**
   - una tabla de **declaraciones** con su estado, enlazada al asiento, al movimiento del banco y al justificante;
   - sus **casillas**;
   - sus **comprobaciones**;
   - las **obligaciones** con su porqué;
   - y tres tablas del **certificado**: custodia, permisos y registro de usos.
10. **De los tableros aprobados (§8)**, hay que cambiar dos textos (plazos de 190/180 y «5 días») y dejar condicionadas cuatro cosas a lo que digan los PDF:
    - «Probar con Hacienda»;
    - traer el justificante con el CSV;
    - presentar el 200;
    - «nadie puede verlo, tampoco en Sumied».

---

## Decisiones del 17/10 (Julio, sobre este informe)

1. **Domiciliación.** La fecha se calcula con la regla de los **3 días hábiles** de la Orden HAC/241/2025 y **se guarda en cada declaración** (`tax_return.due_date_direct_debit`, §7.2), como se propone en §6.2.
2. **Custodia del certificado.**
   - **Foodint empieza con el Vault de Supabase.**
   - **El KMS externo es obligatorio antes de dar de alta a cualquier cliente nuevo**, y **lo impide el código**:
     - mientras el almacén sea el Vault, solo se admite el certificado de la cuenta de Foodint;
     - para cualquier otra cuenta, subir un certificado falla con un mensaje que lo explica.
   - **Diseñado para pasar de Vault a KMS sin tocar el resto.** Una sola pieza, «almacén de certificados», con tres operaciones: guardar, abrir para usar y quitar. Hay dos implementaciones (Vault y KMS), y `tax_certificate.storage` dice en cuál está cada uno. Pasar a KMS es:
     - añadir la implementación;
     - cambiar el almacén por defecto;
     - volver a subir el certificado de Foodint, o migrarlo: abrirlo con el Vault y guardarlo con el KMS, dentro de la función.
     - Ni las declaraciones, ni los permisos, ni el registro de usos, ni la pantalla cambian.
   - **Mientras no haya KMS, la pantalla no dice «nadie puede verlo, tampoco en Sumied».** El texto del tablero 8 sale según el almacén: con el Vault dice lo que es verdad (cifrado, solo lo usa el servidor, cada uso queda apuntado) sin esa frase.
3. **Enlace asesoría–empresa con consentimiento: obligatorio y dentro del encargo.** Es `company_tax_presenter` con `consented_by` / `consented_at` (§7.3), más el permiso entre cuentas (RLS) que hoy no existe.
4. **Modelo 200: hay canal directo.** Diez y ERP10 lo presentan directamente. Hay que encontrarlo en la documentación (`PresBasicaDos` u otro). **No vale** «se prepara el fichero y se sube a mano». Lo que encuentre va en §1.

---

## 1. El canal técnico de la AEAT, modelo a modelo

### 1.1 Tabla

| Modelo | Cómo se presenta desde un programa | Documento técnico | Validación previa | Respuesta | Estado |
|---|---|---|---|---|---|
| **303** IVA | **Presentación Directa**: POST JSON al servicio `PresBasicaDos` con el fichero del diseño de registro en el campo `F01` y `FIR="FirmaBasica"`. Alternativa: formulario Pre303 importando el `.303` | «Especificaciones de Servicios Comunes Declaraciones AEAT (Presentación Directa, Validación e Impresión y Consulta de Declaraciones Presentadas) v2.9». «IVA303-CoordColabora 7.02». Diseño de registro «303 – Ejercicio 2026 y siguientes» (28/01/26) | Servicio de validación e impresión: devuelve el PDF «Borrador NO VÁLIDO» o la lista de errores [F]. Si está en producción o solo en pruebas, los fragmentos se contradicen [?] | JSON con **CSV** (`CEL`) y **`urlPdf`**. El justificante a efectos de la AEAT es el **PDF**, no el JSON [F]. Con errores: sin CSV y hasta 100 errores `E00…` | Canal [F]; diseño 2026 nuevo por la Orden HAC/27/2026 [F][T] |
| **390** | Presentación Directa / formulario con importación | v2.9 + página del 390 en desarrolladores | Igual que el 303 | Igual | [I] |
| **111** | Presentación Directa / formulario | v2.9 + «retenciones» en desarrolladores | Igual | Igual | [I] |
| **115** | Presentación Directa / formulario | Igual | Igual | Igual | [I] |
| **202** | Presentación Directa / formulario | — | — | — | [?] |
| **200** | **Sociedades WEB**: formulario de la Sede que importa el `.200` del diseño del ejercicio; hay «presentación por lotes» | Desarrolladores › Impuesto sobre Sociedades › Modelo 200 › Ejercicio N: diseño, XSD contable, «Controles y especificaciones de Sociedades Web» | El botón «Validar» del formulario [F] | Justificante del formulario | Formulario [F]. **Servicio directo sin confirmar** [?] |
| **190**, **180**, **347**, **349** | **TGVI Online**: 1) validación del fichero con certificado; 2) presentación con firma no criptográfica. Rechaza selectivamente los registros tipo 2 erróneos | «Especificaciones … TGVI Online (v 2.8)» | Sí, es un paso obligatorio aparte [F] | CSV + justificante | [F]. Una vez se usa una vía en un ejercicio, las siguientes del mismo ejercicio van por esa [F] |
| **036** | Solo formulario (aquí solo como aviso) | — | — | — | [?] |

Direcciones de Presentación Directa según la v2.9 [F]:
- producción: `https://www1.agenciatributaria.gob.es/wlpl/PFTW-PICW/PresBasicaDos`;
- pruebas: el mismo camino en `https://prewww1.aeat.es/…`.

### 1.2 Autenticación

- **Certificado de cliente en la conexión TLS** (mTLS, la «firma no criptográfica»). La AEAT toma el NIF del presentador del certificado (`FIRNIF`). Desde el ejercicio 2018 **no se acepta la firma criptográfica del fichero** [F].
- **El titular del certificado tiene que ser** [F]:
  - el propio **declarante**: certificado de representante de la persona jurídica. No necesita ni censo ni poder [I];
  - un **colaborador social** o un **delegado** suyo, en el censo y con un acuerdo que cubra ese modelo (art. 92 LGT; Orden HAC/1398/2003, modificada por la HFP/534/2022) [F];
  - o un **apoderado** en el Registro de apoderamientos.
- Si no es ninguno de los tres, la AEAT contesta «el titular del certificado no es colaborador social ni apoderado» [F].
- **Sello de entidad: no he encontrado nada que diga que sirve para presentar declaraciones** [?]. No conviene contar con él.
- **Domiciliar en una cuenta que no es del presentador** pide un apoderamiento específico (citado como `PAGOAPODECC`) [F, fuente comercial; ?].
  - Afecta al camino «asesoría»: el colaborador social presenta, pero la domiciliación en la cuenta del cliente puede necesitar ese poder.

### 1.3 Entorno de pruebas

- **Portal de Pruebas Externas («PRE-Exteriores»)**, en `preportal.aeat.es` / `prewww1.aeat.es`, **de lunes a viernes de 8:00 a 15:00**. Lo presentado allí se guarda «sin que en ningún caso tenga trascendencia tributaria» [F].
- **No permite presentar en nombre de terceros** [F]. Se prueba con el certificado del propio titular.
- Una vez presentado un NIF y periodo, lo siguiente del mismo periodo tiene que ir como complementaria [F].
  - Para repetir pruebas hacen falta periodos distintos o declarar «complementaria».
- Si acepta un certificado real o da certificados de prueba: [?]. Creo, sin confirmarlo, que se usa el certificado real.
- **Regla para el paso 2: ninguna prueba sale hacia `www1.agenciatributaria.gob.es`.**
  - La dirección de producción no estará en el código de pruebas.
  - Sigue el patrón del freno de Diez (`_shared/diezCliente.ts`: lista blanca, `escribirEnReal`, sin redirecciones).

### 1.4 Traer el justificante a partir de un CSV

- **Cotejo de documentos mediante CSV**: solo lo he encontrado como página para personas y en la app de la AEAT [F]. **No he encontrado ninguna API.**
- **Servicio de consulta de declaraciones presentadas** (en la v2.9, esquema `consultas.xsd`, hasta 100 por consulta) [F]. Puede ser la vía para traer lo presentado fuera, pero:
  - sus parámetros están por leer (modelo, ejercicio, periodo… ¿o CSV?) [?];
  - y no sé si un colaborador o apoderado puede consultar lo de su cliente [?].
  - Desde la web, el colaborador social ve lo presentado por él y sus delegados, en ventanas de 15 días [F].

---

## 2. Custodia del certificado

### 2.1 Lo que hay hoy

- **Producción** tiene `supabase_vault 0.3.1` y `pgcrypto`, con 17 secretos en el Vault. No tiene pgsodium ni ningún KMS externo.
- **En el código** no aparece nada de mTLS, `Deno.createHttpClient`, PKCS#12/.p12/.pfx ni KMS.
- **Patrón de los secretos de conectores:**
  - `connector_secret_save` / `connector_secret_read` (`security definer`, solo `service_role`);
  - la referencia se guarda en `account_connector.credentials_ref`;
  - lo usa, entre otras, `conta-diez-enviar`.

### 2.2 Vault de Supabase o KMS

| | Vault de Supabase | KMS externo con cifrado envolvente (AWS KMS o Google Cloud KMS) |
|---|---|---|
| Quién puede descifrar | Cualquiera con SQL de `service_role` o de `postgres`: `vault.decrypted_secrets` lo devuelve en claro. Eso incluye las consultas de mantenimiento y el MCP | Solo quien tenga permiso `Decrypt` sobre esa clave en el KMS. Se da **a una única identidad**: la de la función que presenta |
| Copia de la base, volcado o réplica | Se lleva el certificado descifrable con la misma clave del proyecto | Se lleva un texto cifrado inútil sin el KMS |
| Registro de cada uso | Ninguno propio | El KMS apunta cada `Decrypt` (CloudTrail / Cloud Audit Logs), además de nuestro registro |
| Quitar ya | Borrar el secreto | Borrar el texto cifrado **y**, si se quiere, desactivar la versión de la clave |
| Coste y piezas nuevas | Ninguna | Una cuenta de KMS, una clave por entorno, la credencial de la función y una dependencia más |
| ¿Cumple «Nadie puede verlo ni descargarlo, tampoco en Sumied» (tablero 8)? | **No** | **Casi**: nadie con acceso a la base lo puede abrir. Un administrador del KMS que se dé permiso a sí mismo sí podría, y queda registrado |

**Propuesta: KMS externo con cifrado envolvente.** El Vault solo guarda la credencial de acceso al KMS de la función.

### 2.3 Cómo se usa sin que salga de la función

**Al subirlo** («Añadir un certificado»):
1. El navegador manda el `.p12`/`.pfx` y su contraseña a la función por HTTPS, sin pasar por Storage.
2. La función lo abre en memoria y extrae:
   - el certificado (para enseñar titular, NIF, emisor y caducidad);
   - la clave privada en PEM.
3. Genera una clave de datos de un solo uso (AES-256-GCM), cifra con ella la clave privada y el certificado, y **cifra esa clave de datos con el KMS**.
4. Guarda en la tabla los dos textos cifrados y los datos visibles: titular, emisor, número de serie, válido desde/hasta y huella SHA-256 del certificado.
5. **La contraseña del `.p12` y el `.p12` no se guardan nunca.**

**Al usarlo** (probar, validar, presentar, consultar):
1. La función comprueba el permiso de esa persona («puede presentar»).
2. Comprueba la **confirmación de ese uso**: un token de un solo uso emitido al pulsar «Presentar» y confirmar, válido unos minutos.
3. Apunta el uso.
4. Pide `Decrypt` al KMS, descifra en memoria y abre la conexión con `Deno.createHttpClient({ cert, key })`.
5. Hace la llamada, cierra el cliente y descarta los valores.

En ningún momento:
- se escribe la clave en disco ni en el registro;
- se devuelve al navegador;
- existe un RPC que la lea.

**Por confirmar antes de nada (paso 2, en staging):** que el **Edge Runtime de Supabase respete `cert`/`key` de `Deno.createHttpClient`**.
- Deno lo documenta, y exige PEM [F].
- Supabase no dice nada [?]. Hay un paquete de terceros (`@layerbase/deno-mtls`) que abre TLS a mano para Postgres, lo que hace sospechar.
- **Se prueba contra un servidor público de pruebas de mTLS**, no contra la AEAT.
- **Si no funciona**, hace falta un pequeño servicio aparte que tenga la credencial del KMS, por ejemplo en Cloud Run o Fly. Es la decisión de arquitectura más gorda del encargo.

### 2.4 Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Fuga de la base (copia, volcado, consulta con service_role) | Solo hay texto cifrado; la clave de datos solo la abre el KMS |
| Alguien con acceso a la función o a su credencial del KMS | Credencial solo en la función que presenta; permiso `Decrypt` sobre una sola clave; alertas del KMS por usos fuera de horario o en ráfaga; nuestro registro de usos cruzado con el del KMS |
| Uso no autorizado desde la aplicación | Permiso «puede presentar» por persona y certificado; confirmación de cada uso con token de un solo uso; registro con quién, qué, cuándo y resultado |
| Que una prueba presente algo real | La dirección de producción no está en el código de pruebas; freno tipo `escribirEnReal`; las pruebas solo usan `prewww1.aeat.es` |
| Certificado caducado o revocado | Caducidad leída al subirlo; avisos a 30 y 7 días; «Probar con Hacienda» (§8) |
| Contraseña del `.p12` | No se guarda; se pide solo al subirlo |
| Logs | La función no imprime cabeceras, cuerpos ni el certificado; solo la huella, el CSV enmascarado y el resultado |
| «Quitar ahora» | Borra los textos cifrados y deja la fila «retirado» con fecha y quién (el registro de usos se queda) |
| Certificado de la asesoría usado para una empresa que no la ha autorizado | La relación asesoría ↔ empresa cliente con consentimiento de la empresa es un dato (§7); hoy no existe |

---

## 3. Los libros de IVA de hoy y el 303

### 3.1 Qué hay

- **`vat_book_entry`**: una fila por apunte de IVA de un asiento validado.
  - La crea `conta_vat_book_desde_asiento` al validar y la marca anulada al anular (`20261014T0100_c05_libros.sql`, `20261014T0120_c05_cambia.sql`).
  - Lleva lo que pide el formato de libros de la AEAT: libro, tipo de factura F1–F4/R1–R5, serie y número, fechas, contraparte, clave de operación, calificación S1/S2/N1/N2, causa de exención, base, tipo, cuota, recargo, deducible, ISP, bien de inversión, retención y actividad.
- **Producción (Foodint, cuenta filtrada):**
  - 63 filas vivas, todas desde el **01/10/2026**: es el corte con Diez; lo anterior está en Diez;
  - 62 expedidas (10 F2 y 52 F4 de resumen de tiques) y 1 recibida (F1);
  - todas al **10 %**, calificación S1 y clave 01;
  - **0** con recargo, ISP, bien de inversión, retención o contraparte extranjera.
  - Es decir, lo raro todavía no se ha probado con datos reales (regla 31).

### 3.2 Lo que pide el 303 frente a lo que hay

| Bloque del 303 | ¿Se saca hoy? | Qué falta |
|---|---|---|
| Régimen general, devengado a 21/10/4 % | **Sí**: base y cuota por tipo, de `vat_book_entry` | Tipos 5 % y 2 %: no están sembrados. Hay que cotejarlos con el diseño 2026 |
| Recargo de equivalencia (repercutido) | **No** | `surcharge_amount` no se rellena nunca: comprobado en la función de producción. `journal_line` no separa la cuota del recargo |
| Adquisiciones intracomunitarias (devengo y deducción) | A medias: tipo `ue_compra` y clave 09 | No se genera la **autorrepercusión** (la 477 espejo). Sin ella no cuadra ni el 303 ni la 477/472 |
| Inversión del sujeto pasivo | A medias: `reverse_charge` y S2 | Igual: falta la autorrepercusión |
| Importaciones (DUA) | **No** | Ni tipo, ni clave, ni campo |
| Entregas intracomunitarias (casilla de exentas y 349) | A medias: E5 | No hay tipo de serie de entrega UE |
| Exentas / no sujetas | Sí, E1 y N1 | Las demás causas (E2–E6) no se asignan solas |
| Bienes de inversión | Sí: libro `investment` y regularización | — |
| Prorrata | **No** | `deductible_amount` es 100 % o 0; no aplica `vat_prorata_pct` |
| Rectificativas | Solo recibidas (R1) | Rectificativas expedidas y modificaciones de base |
| Criterio de caja | **No** | Fechas de cobro y pago por factura |
| Periodo | Solo trimestral, calculado en pantalla | No hay periodo guardado; el mensual (`vat_period = 'monthly'`) no se usa en ningún sitio |
| Fecha de operación | **No** | `operation_date` siempre NULL; se usa la de expedición |
| Cuotas a compensar de periodos anteriores | **No** | Saldo de la 4700 por periodo |
| **Asiento de liquidación** | **No valida** | Comprobado en producción: `conta_motivos_para_validar` exige tipo en todo apunte de 472/477 y tipo de retención en todo apunte de 4751, salvo en el cierre del ejercicio. El 477/472/4750 de la liquidación y el pago de la 4751 quedan «por aclarar». El origen `vat_settlement` ya existe en `journal_entry.source_type` y nada lo usa |

**Lo que sí está y sirve tal cual:**
- el cuadre libro ↔ diario (`lib/libroRegistro.ts`, `cuadreConDiario`);
- la agrupación por NIF con el umbral de 3.005,06 € del 347 (`UMBRAL_347`);
- el bloqueo de mes `fiscal_period_lock.kind = 'tax_filed'`, previsto «para Impuestos» y que nada escribe aún.

**Conclusión:**
- Para el 303 de una empresa como Foodint basta con añadir el periodo y el asiento de liquidación.
- Para venderlo «a cualquier empresa» hacen falta antes:
  - el recargo;
  - la autorrepercusión (ISP y UE);
  - la prorrata;
  - el periodo mensual;
  - las importaciones.

---

## 4. Qué modelos le tocan a cada empresa

Hoy:
- `lib/modelos.ts` propone la lista en el alta a partir de las preguntas del paso «impuestos»: periodo, «¿retienes?», «¿alquilas?» y «¿te retienen el 70 %?».
- La lista se guarda en `company_tax_profile.tax_forms`, sin el porqué.
- **Las respuestas se tiran.** «No lo sé» deja «sí» en retiene y alquiler.
- El 349 queda fuera a propósito.

Propuesta: cada modelo sale de una regla con nombre. Se guarda la regla que lo hizo salir y los datos en que se basó, y quitarlo o añadirlo pide motivo.

| Modelo | Sale si… | Dato en que se basa | ¿Existe hoy? | Dónde pedirlo si falta |
|---|---|---|---|---|
| 303 | Es empresario o profesional en territorio común y no hace solo operaciones exentas (art. 71.1 RIVA [T]) ni está solo en recargo de equivalencia | `company_tax_profile.tax_territory`, `vat_scheme_code` | Sí | — |
| 303 mensual | Volumen del año anterior > 6.010.121,04 €, REDEME, grupo de entidades (art. 71.3 RIVA [T]) o SII | `vat_period`, `sii` | Solo `vat_period` y `sii`; **el volumen del año anterior no se guarda** | Ajustes › Tus impuestos (ya muestra la ayuda de 6.010.121,04 €) |
| 390 | Presenta 303. **No** lo presentan los del SII ni quienes solo tributan por arrendamiento o simplificado con 303 trimestral (estos completan casillas del 4T) [?: leer la Orden HAC/27/2026 y la del 390] | `sii`, `vat_scheme_code`, actividad | En parte | — |
| 111 | Paga nóminas, a profesionales o a administradores con retención | Nóminas (`payroll_summary`), facturas recibidas con `withholding_model = '111'` | El dato del alta (`retiene`) **se tira**. Foodint: 0 apuntes con modelo de retención hoy | Alta y Ajustes: «¿Tienes empleados? ¿Pagas a profesionales?» guardado como dato, contrastado cada trimestre con los apuntes |
| 190 | Presentó algún 111 en el año | Los 111 del año | — (sale de los 111) | — |
| 115 | Paga alquiler de un inmueble urbano con retención | Facturas con `withholding_model = '115'`; `recurring_contract.kind = 'alquiler'` | La respuesta `alquiler` **se tira**; el contrato no lleva retención | Alta y Ajustes: «¿Alquilas el local?», guardado |
| 180 | Presentó algún 115 en el año | Los 115 | — | Del arrendador: NIF, referencia catastral y situación del inmueble (para el 180) |
| 202 | Sociedad (`entity_kind = 'company'`) con cuota del último 200 positiva, u obligada por volumen > 6 M€ (art. 40 LIS [T]) | El 200 anterior | **No**: no hay nada del IS anterior | Del 200 presentado en Sumied; si es el primer año, pregunta «¿cuánto salió el IS del año pasado?» o pegar su CSV |
| 200 | Toda sociedad | `entity_kind`, `legal_form_code` | Sí | — (la ficha del 200 ya se pide: `C00_ficha_vs_modelos.md`) |
| 347 | No lleva SII (`tax_form.default_for = 'company_not_sii'`, art. 32 RGAT [T]) **y** tiene algún tercero de más de 3.005,06 € en el año (art. 31) | `sii`; agrupación por NIF | Sí | — |
| 349 | Hace entregas o adquisiciones intracomunitarias, o servicios con la UE | Libro con clave 09/E5; `customer_fiscal.operation_scope = 'eu'`; VIES | En parte | **ROI** (alta en el Registro de Operadores Intracomunitarios): no existe; en Ajustes › Tus impuestos |
| 036 (aviso) | Cambia algo censal: empieza a retener, a alquilar o a operar con la UE, domicilio, periodo | Los cambios en los datos de arriba | — | Aviso, no modelo |

Además, **por empresa**:
- **cómo se paga cada modelo**: domiciliado o no y en qué cuenta. Hoy solo existe `treasury_account.iban`;
- y **quién presenta**: la empresa o la asesoría.

---

## 5. El asiento de cada modelo (PGC)

**Fuente:** PGC, RD 1514/2007, quinta parte, «Definiciones y relaciones contables», cuentas 470–477 y 630 [T, `rd-1514-2007.txt`]. El de pymes (RD 1515/2007), que usa Foodint, tiene las mismas cuentas.

| Modelo | Asiento al presentar | Al pagar o cobrar | Qué dice el PGC |
|---|---|---|---|
| **303 a ingresar** | Debe **477** (todo el repercutido del periodo) / Haber **472** (todo el soportado deducible) / Haber **4750** (la diferencia) | Debe 4750 / Haber 57x (cargo de la domiciliación, que se casa con el banco) | 477.b: «Se cargará por el importe del IVA soportado deducible que se compense… con abono a la cuenta 472. Si… subsistiera saldo en la cuenta 477, el importe del mismo se abonará a la cuenta 4750». 4750.b: «Se cargará… cuando se efectúe su pago, con abono a cuentas del subgrupo 57» |
| **303 a compensar o devolver** | Debe 477 / Debe **4700** (el exceso) / Haber 472 | Compensación: la 4700 se abona en el 303 siguiente contra la 477. Devolución: Debe 57x / Haber 4700 | 472.b1 y 4700.a/b |
| **303 sin actividad / resultado cero** | Ninguno, o 477 contra 472 si hay saldos iguales | — | — |
| **111** | **Ninguno**: la 4751 ya se abonó al contabilizar la nómina o la factura | Debe **4751** / Haber 57x | 4751.a/b |
| **115** | Ninguno, igual | Debe 4751 / Haber 57x | 4751 |
| **202** | Ninguno al presentar | Debe **473** / Haber 57x | 473.a: «Se cargará por el importe de la retención o pago a cuenta» |
| **200** | Debe **6300** (cuota) / Haber **473** (retenciones y pagos a cuenta hasta la cuota líquida) / Haber **4752** (a ingresar); o Debe **4709** si sale a devolver | Debe 4752 / Haber 57x; o Debe 57x / Haber 4709 | 6300.a1–a2, 473.b1–b2, 4752, 4709.a1. El impuesto diferido (6301, 4740, 479) va en el cierre del ejercicio, no aquí |
| **390, 190, 180, 347, 349** | Ninguno: son informativas o resúmenes | — | — |

**Para que estos asientos validen:**
- el validador tiene que aceptar los apuntes de 472/477/4700/4750 sin tipo **cuando el origen es la liquidación** (`vat_settlement`, enlazado a la declaración);
- y los de 4751 sin tipo de retención **cuando el origen es el pago de un 111/115**.
- Es lo mismo que ya hace con el cierre del ejercicio (`v_cierre`).

---

## 6. Plazos 2026 y 2027

### 6.1 Fuentes

| Modelo | Plazo general | Norma | |
|---|---|---|---|
| 303 trimestral | 1–20 de abril, julio y octubre; 4T: 1–30 de enero | RIVA (RD 1624/1992), art. 71.4, redacción vigente desde 22/12/2024 | [T] |
| 303 mensual | Los 30 primeros días del mes siguiente; enero, hasta el último día de febrero | RIVA art. 71.4, tercer párrafo | [T] |
| 390 | 1–30 de enero | Orden EHA/3111/2009 | [T] |
| 111 / 115 trimestral | 1–20 de abril, julio, octubre y enero | RIRPF (RD 439/2007), art. 108.1 | [T] |
| 111 / 115 mensual | 1–20 del mes siguiente | RIRPF art. 108.1, segundo párrafo | [T] |
| 190 / 180 | 1–31 de enero | RIRPF art. 108.2 (por vía electrónica, 1–31 de enero). Las órdenes guardadas del 190 y 180 dicen «20 primeros días»; el 31 lo confirma el calendario AEAT 2026 | [T]+[F] |
| 347 | Mes de febrero | Orden EHA/3012/2008, en la redacción guardada (línea 174) | [T] |
| 349 trimestral | 1–20 del mes siguiente al trimestre; 4T: 1–30 de enero (mensual si pasa de 50.000 €) | RIVA art. 81; Orden EHA/769/2010 | [T] |
| 202 | 1–20 de abril, octubre y diciembre | Ley 27/2014 (LIS), art. 40.1 | [T] |
| 200 | Los 25 días naturales siguientes a los 6 meses del cierre (año natural: 1–25 de julio) | LIS art. 124.1 | [T] |
| Día inhábil | Si el último día es sábado, domingo o festivo nacional, pasa al siguiente hábil | Ley 39/2015, art. 30.5, según la doctrina; la AEAT lo aplica en su calendario | [F]; no está en las fuentes del repositorio |

### 6.2 Domiciliación: aquí hay que corregir la regla de los 5 días

**Lo que dicen las órdenes guardadas en el repositorio** [T]:
- 303: «Desde el día 1 hasta el 15 de los meses de abril, julio y octubre, y desde el día 1 hasta el 25 del mes de enero» (Orden EHA/3786/2008, disposición final tercera).
- 111: «Desde el día 1 hasta el 15 de los meses de abril, julio, octubre **y enero**» (Orden EHA/586/2011). **El 4T del 111, y del 115, se domicilia hasta el 15 de enero, no el 25.**
- 202: «desde el día 1 hasta el 15 de los meses de abril, octubre y diciembre» (Orden HFP/227/2017).
- 200: lo fija la orden de cada año. La guardada es la del ejercicio 2019 (1–22 de julio de 2020). La del ejercicio 2025 es la **Orden HAC/529/2026** [F].

**Lo que cambió después** [F]: la **Orden HAC/241/2025** (BOE 14/03/2025) modificó la Orden EHA/1658/2009, art. 3.2:
- tiene que haber **al menos 3 días hábiles** entre el fin de la domiciliación y el fin del plazo general;
- para contarlos son inhábiles los sábados, domingos y festivos nacionales y **de Madrid**;
- y si el plazo de presentación se alarga por un inhábil, **el de domiciliación se alarga igual**.

**Datos oficiales de la AEAT que cuadran con esa regla y no con «5 días»** [F]:
- 303 4T/2025: presentación hasta el 30/01/2026, domiciliación **hasta el 27/01/2026**, no el 25;
- 303 2T/2025: hasta el 21/07, domiciliado hasta el 16/07;
- 200 de 2025: hasta el 27/07/2026, domiciliado **hasta el 22/07/2026**;
- 202 de diciembre de 2026: hasta el 21/12, domiciliado **hasta el 16/12**.

**Propuesta:**
- el plazo de domiciliación **se calcula** con la regla de los 3 días hábiles sobre el plazo ya trasladado;
- y se guarda **por declaración** como fecha, no «5 días antes».
- En los trimestres normales sale el 15, como dijo Julio; en enero, diciembre y julio a veces no.
- **Hay que confirmarlo con el texto literal del anexo II de la Orden EHA/1658/2009 consolidada** (§10).

### 6.3 Tabla 2026

Festivos nacionales usados: 1/1, 6/1, 3/4 (Viernes Santo), 1/5, 15/8, 12/10, 1/11, 8/12 y 25/12. Ninguno cae en una fecha de la tabla. Los de Madrid no los he comprobado uno a uno [?].

| Obligación | Sin domiciliar (último día) | Domiciliado (último día) | |
|---|---|---|---|
| 303 4T/2025 | vie 30/01/2026 | **mar 27/01/2026** | [F] |
| 349 4T/2025 · 390 de 2025 | vie 30/01/2026 | — (sin ingreso) | [T] |
| 111 / 115 4T/2025 | mar 20/01/2026 | jue 15/01/2026 | [T] |
| 190 / 180 de 2025 | **lun 02/02/2026** (el 31 es sábado) | — | [F] |
| 347 de 2025 | **lun 02/03/2026** (el 28/02 es sábado) | — | [F] |
| 303/111/115/349 1T · 202 1P | lun 20/04/2026 | mié 15/04/2026 | [T]+[F] |
| 303/111/115/349 2T | lun 20/07/2026 | mié 15/07/2026 | [T]+[F] |
| 200 de 2025 (año natural) | **lun 27/07/2026** (el 25 es sábado) | **mié 22/07/2026** | [F] |
| 303/111/115/349 3T · 202 2P | mar 20/10/2026 | jue 15/10/2026 | [T]+[F] |
| 202 3P | **lun 21/12/2026** (el 20 es domingo) | **mié 16/12/2026** | [F] |

### 6.4 Tabla 2027

El calendario oficial de 2027 aún no está publicado: todo es **calculado** [I]. Festivos nacionales usados: 1/1, 6/1, 26/3 (Viernes Santo), 1/5, 15/8, 12/10, 1/11, 6/12, 8/12 y 25/12.

| Obligación | Sin domiciliar | Domiciliado |
|---|---|---|
| 111 / 115 4T/2026 | mié 20/01/2027 | vie 15/01/2027 |
| 303 4T/2026 | **lun 01/02/2027** (el 30 es sábado) | **mié 27/01/2027** (3 hábiles) |
| 349 4T/2026 · 390 de 2026 | lun 01/02/2027 | — |
| 190 / 180 de 2026 | **lun 01/02/2027** (el 31 es domingo) | — |
| 347 de 2026 | **lun 01/03/2027** (el 28/02 es domingo) | — |
| 303/111/115/349 1T · 202 1P | mar 20/04/2027 | jue 15/04/2027 |
| 303/111/115/349 2T | mar 20/07/2027 | jue 15/07/2027 |
| 200 de 2026 (año natural) | **lun 26/07/2027** (el 25 es domingo) | **mié 21/07/2027** |
| 303/111/115/349 3T · 202 2P | mié 20/10/2027 | vie 15/10/2027 |
| 202 3P | lun 20/12/2027 | mié 15/12/2027 |

**Mensuales** (303 SII/REDEME/gran empresa, 111/115 mensual, 349 de más de 50.000 €):
- 303: hasta el 30 del mes siguiente (enero, hasta fin de febrero; diciembre, hasta el 30 de enero).
- 111 / 115 / 349: hasta el 20.
- En todos, domiciliación con la misma regla de 3 hábiles.
- **Los plazos no se escriben a mano**: los calcula una función a partir de la regla y de la tabla de festivos, y una prueba los compara con el calendario oficial de cada año en cuanto se publica.

---

## 7. Modelo de datos propuesto

Nombres en inglés y snake_case, como el resto de la contabilidad. Todo con `account_id` y `company_id` (regla 9). **No es una migración**: es la forma, para discutirla.

### 7.1 Obligaciones (qué modelos le tocan y por qué)

- **`tax_obligation`**:
  - `company_id`, `form_code` (FK `tax_form`);
  - `cadence` (`monthly` · `quarterly` · `annual` · `instalments_202`);
  - `active`, `valid_from` / `valid_to`;
  - `origin` (`rule` · `added` · `removed`);
  - `rule_key` (qué regla del §4 lo hizo salir);
  - `rule_facts jsonb` (los datos en que se basó: «tienes 6 personas en nómina»);
  - `reason`, obligatorio si se añade o se quita;
  - `decided_by`, `decided_at`;
  - `payment_mode` por defecto (`direct_debit` · `nrc` · `none`) y `payment_treasury_account_id`.
- Sustituye a `company_tax_profile.tax_forms`. La lista se puede dejar como vista para lo que ya la lee: `cuentasProveedorService`, `tablasService`, `lib/presentar`.
- **`company_tax_facts`**: los datos que hoy se tiran o no existen:
  - `has_employees`, `pays_professionals`, `rents_premises_with_withholding`;
  - `roi_registered`, `previous_year_turnover`, `redeme`.
  - Cada uno con quién y cuándo lo dijo.
  - Pueden ser columnas de `company_tax_profile`.

### 7.2 La declaración

**`tax_return`**: una por modelo, empresa, ejercicio, periodo y número de orden (las complementarias y sustitutivas llevan otro número de orden).

- **Identidad:**
  - `form_code`, `fiscal_year`;
  - `period` (`1T`…`4T`, `01`…`12`, `0A` anual, `1P`/`2P`/`3P` del 202);
  - `sequence`, `kind` (`normal` · `complementary` · `substitutive`), `replaces_return_id`.
- **Plazos:**
  - `due_date` y `due_date_direct_debit`, calculados y guardados (§6);
  - `alert_on` (= el de domiciliación si se domicilia).
- **Estado** (columna `status` con CHECK, más un registro de cambios en `tax_return_event`):
  - `pending` (por calcular) → `draft` (borrador) → `reviewed` (revisado) → `filed` (presentado) → `booked` (contabilizado) → `paid` (pagado) / `offset` (compensado) / `refunded` (devuelto);
  - y `not_required` (no hay que presentarlo), con `not_required_reason` obligatorio, como el 202 de las capturas.
  - Los modelos sin asiento ni pago (informativas) acaban en `filed`.
- **Resultado:**
  - `result_kind` (`to_pay` · `to_refund` · `to_offset` · `zero` · `no_activity`), `amount`;
  - `previous_period_amount` (para «+449,60 € (+7,6 %)»).
- **Pago:**
  - `payment_mode` (`direct_debit` · `nrc` · `debt_recognition` · `offset` · `refund`);
  - `payment_treasury_account_id` (la cuenta: en pantalla, solo los 4 últimos dígitos);
  - `nrc` (si se paga sin domiciliar).
- **Presentación:**
  - `filed_at`, `filed_by`;
  - `filed_via` (`sumied` · `outside`);
  - `presenter_kind` (`company` · `advisor`), `certificate_id`;
  - `aeat_csv`, `aeat_receipt_number`;
  - `receipt_document_id` (el PDF justificante, en `conta-documentos`).
  - Para lo de fuera: `outside_csv_pasted_at`, más el PDF subido o traído (§8).
- **Enlaces:**
  - `liquidation_entry_id` (FK `journal_entry`, con `source_type = 'vat_settlement'` / `'tax_return'` y `source_id` = esta declaración: el índice único de `journal_entry` ya garantiza un asiento vivo por origen);
  - `payment_entry_id`;
  - `bank_match_id` (el cargo de Hacienda casado).
- **Revisión:** `calculated_at`, `reviewed_at`, `reviewed_by`.

**`tax_return_box`** («Modelo oficial»):
- `tax_return_id`, `box` (`'01'`, `'03'`…), `value numeric`/`value_text`;
- `origin` (`calculated` · `manual`), `manual_reason`;
- `source jsonb` (de qué filas sale).
- El fichero oficial se genera de aquí.

**`tax_return_line`**: qué filas del libro entran.
- `tax_return_id` + `vat_book_entry_id` / `journal_line_id` / `supplier_invoice_id`.
- Congela lo declarado: si después se toca una factura de un periodo presentado, se ve la diferencia y pide complementaria.

**`tax_return_check`** («Lo que ha comprobado Sumied»):
- `check_key`:
  - `book_vs_303`: factura a factura;
  - `ledger_477_472`;
  - `sum_303_vs_390`, `sum_111_vs_190`, `sum_115_vs_180`;
  - `third_parties_347`;
  - `mail_invoices_missing`: las recibidas por correo (D01) sin apuntar;
  - `out_of_period`: facturas de otro periodo.
- `result` (`ok` · `warning` · `error`), `detail jsonb`;
- `accepted_by`, `accepted_at`, `accepted_reason` (como «Julio la dio por buena el 09/10»).

**`tax_return_event`**: cada cambio de estado y cada llamada a la AEAT (validar, presentar), con quién, cuándo, resultado y los códigos de error.

### 7.3 Certificados y accesos

- **`tax_certificate`**:
  - `owner_account_id` (la cuenta dueña: la de la empresa o la de la asesoría);
  - `subject_name`, `subject_tax_id_hash` (para buscar sin enseñar el NIF entero);
  - `issuer`, `serial`, `valid_from`, `valid_to`, `fingerprint_sha256`;
  - `kind` (`legal_representative` · `natural_person` · `other`);
  - `ciphertext` (bytea o ruta de Storage), `wrapped_key`, `kms_key_ref`;
  - `status` (`active` · `expired` · `removed`), `removed_at`, `removed_by`;
  - `last_test_at`, `last_test_result`.
- **`tax_certificate_grant`**: `certificate_id`, `user_id`, `permission` (`file` = puede presentar · `view` = solo ver).
- **`tax_certificate_use`** («Cada vez que se ha usado»):
  - `certificate_id`, `tax_return_id`, `user_id`;
  - `action` (`upload` · `test` · `validate` · `file` · `query`);
  - `confirmation_id` (el token de un solo uso);
  - `result`, `aeat_ref` (CSV enmascarado), `at`.
- **`company_tax_presenter`** («Quién presenta los impuestos de esta empresa»):
  - `company_id`, `mode` (`company` · `advisor`), `certificate_id`;
  - `advisor_account_id`, `advisor_basis` (`social_collaborator` · `power_of_attorney`);
  - `consented_by`, `consented_at` (la empresa autoriza a su asesoría), `since`.
  - **Hoy no existe ningún enlace entre una cuenta de asesoría y la empresa de un cliente en otra cuenta.** Es pieza nueva, y toca permisos (RLS) entre cuentas.

### 7.4 Enlaces con lo que ya hay

| Con | Cómo |
|---|---|
| Asiento | `journal_entry.source_type` ∈ {`vat_settlement`, `tax_return`} y `source_id` = `tax_return.id`. El validador acepta 472/477/4750/4751 sin tipo **solo** con ese origen (§5) |
| Justificante | `journal_entry_document.kind`: añadir `justificante_aeat`. O la ruta en `tax_return.receipt_document_id` si no hay asiento (informativas) |
| Banco | `bank_match_item.tax_return_id` (nuevo). La regla «8 · Impuestos» de `lib/conciliacion.ts` deja de adivinar el modelo: busca la `tax_return` en `filed`/`booked` con ese importe y vencimiento. Hoy toda 475 que no es 4750 la trata como 111, y el 115 nunca se distingue |
| Mes cerrado | Al presentar un 303 se escribe `fiscal_period_lock.kind = 'tax_filed'` en sus meses (previsto y sin usar) |
| Folvy / Sumied | Nada de esto depende de hostelería: todo cuelga de `company`. En Folvy los datos vienen de las ventas del día y las compras; en Sumied suelto, de las facturas y el banco. El modelo es el mismo |

---

## 8. Los tableros aprobados (8, 9 y 10): qué no se puede hacer tal cual

| Tablero | Lo que dice | Problema | Propuesta |
|---|---|---|---|
| 10 · Calendario | «Resúmenes del año: IVA (390), retenciones (190) y alquiler (180) · hasta el 25/01 o el 30/01» | El 25/01 es el plazo domiciliado del 303, no de estos. El 390, 190 y 180 **no se pagan** y no tienen domiciliación. El 190 y el 180 son hasta el **31/01** (01/02 en 2027) [T][F] | «390 hasta el 30/01; 190 y 180 hasta el 31/01», con la fecha trasladada si cae en inhábil |
| 10 · Calendario | «Si se domicilia, el plazo acaba 5 días antes» | Desde la Orden HAC/241/2025 son 3 días hábiles; el 4T del 303 fue el 27/01, no el 25 [F] | Enseñar la **fecha** calculada, no «5 días antes» |
| 10 · Calendario | «hasta el 28/02 · Clientes y proveedores… (347)» | En 2027 el 28/02 es domingo: 01/03 | Fecha calculada |
| 9 · 303 | «Antes de enviar, Hacienda lo valida. Si devuelve un error, no se presenta nada y te dice qué casilla falla» | Se puede de dos formas: el servicio de validación (si está en producción [?]) o el propio envío, que con errores no presenta nada y no da CSV [F]. «Qué casilla falla» depende de que el código de error la nombre [?] | Se mantiene; el detalle de la casilla, cuando lo dé la AEAT |
| 9 · 303 | «Ya lo presenté fuera · pegar CSV» | No he encontrado una API que devuelva el justificante con el CSV [F] | Pegar el CSV **y** subir el PDF; o, si el servicio de consulta lo permite, traerlo por modelo y periodo [?] |
| 8 · Certificados | «Queda cifrado. Nadie puede verlo ni descargarlo, tampoco en Sumied» | Solo es verdad con KMS externo y descifrado solo en la función (§2). Con el Vault de Supabase es falso | KMS. El texto puede quedarse si se cumple el §2; si no, cambiarlo |
| 8 · Certificados | «Probar con Hacienda» · «Funciona · probado con Hacienda el 09/10» | Hace falta una llamada a la AEAT que use el certificado y **no presente nada**: la validación (si pide certificado) o una consulta de declaraciones presentadas [?] | Elegirla con la v2.9 delante. Si no hay ninguna inocua, «probar» comprueba caducidad y cadena, y dice que la prueba de verdad es la primera presentación |
| 8 · Certificados | «Mi asesoría, con su certificado… tú no ves nada de él» | Se puede: el certificado es de la cuenta de la asesoría y la empresa solo ve que existe. Pero **no se puede probar en el entorno de pruebas de la AEAT** (no hay presentación en nombre de terceros) [F], y la asesoría debe estar en el censo con un acuerdo que cubra cada modelo, o tener poder | Mantener; avisar de que la primera presentación por asesoría es la prueba |
| Impuesto de sociedades | Presentar el 200 desde Sumied | Solo está confirmado por Sociedades WEB (formulario con importación de fichero) [F]; el servicio directo está sin confirmar [?] | Si no hay servicio directo: Sumied genera el `.200`, se presenta en Sociedades WEB y se trae el CSV |
| 9 · 303 | «1 factura de un proveedor con fecha del 30/09 llegó el 03/10: va en este trimestre» | Se puede: es `received_date` frente a `issue_date`, y ya están en el libro | — |
| 9 · 303 | «Hacienda lo carga el 20/10 y Sumied lo casa con el banco» | Se puede, con `bank_match_item.tax_return_id` (§7.4) | — |

El resto de los tres tableros se puede hacer con lo descrito arriba.

---

## 9. Qué hace falta medir o decidir antes de construir

**Decisiones de Julio:** tomadas el 17/10; están en «Decisiones del 17/10», al principio. Queda abierto:
- **cuándo y qué KMS** (AWS o Google), antes del primer cliente que no sea Foodint;
- y **encontrar el canal directo del 200** en la documentación.

**Lo que se prueba en el paso 2, en staging:**
1. `Deno.createHttpClient` con certificado de cliente en el Edge Runtime de Supabase, contra un servidor público de pruebas de mTLS. Nunca contra la AEAT.
2. Con los PDF delante:
   - el servicio de validación en pruebas;
   - el formato de respuesta;
   - qué llamada sirve para «Probar con Hacienda».

**Lo que depende de otros frentes:**
- las recibidas por correo (D01) para la comprobación «no falta ninguna factura recibida por correo»;
- el S01 de D en `main` para las pantallas.

---

## 10. Lo que Julio tiene que descargar (o dejar leer desde aquí)

**Dominios para permitir en el entorno** (Ajustes del entorno › Acceso a red › Dominios permitidos), si se quiere que lo lea yo:
- `sede.agenciatributaria.gob.es`
- `www.agenciatributaria.es`
- `www1.agenciatributaria.gob.es`
- `www3.agenciatributaria.gob.es`
- `preportal.aeat.es`
- `www.boe.es`

**Ojo:** `prewww1.aeat.es` y `www1.agenciatributaria.gob.es` son los servidores de presentación. Para leer documentación no hacen falta, y es mejor no abrirlos hasta el paso de pruebas.

**Documentos**, en orden de importancia (URL tal como salieron en el buscador):

1. «Especificaciones de Servicios Comunes Declaraciones AEAT (Presentación Directa, Validación e Impresión y Consulta de Declaraciones Presentadas) **v2.9**», y su `consultas.xsd`
   https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/General/EspecificacionesServiciosDeclaracionesAEAT_ES.pdf
2. «**IVA303-CoordColabora 7.02**», coordinación con colaboradores del 303 (comprobar si hay una versión posterior)
   https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/Mod_303/IVA303-CoordColabora_7.02.pdf
3. Diseños de registro: «303 – Ejercicio 2026 y siguientes» (xlsx, 28/01/26), 390, 349 y 347 (modelos 300–399), 111/115/180/190 (100–199) y 200/202 (200–299)
   https://sede.agenciatributaria.gob.es/Sede/ayuda/disenos-registro/modelos-300-399.html
4. «Informativas: Especificaciones … **TGVI Online** (v 2.8)»
   https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/Informativas/General/Especificaciones_TGVI_Online.pdf
5. Portal de desarrolladores › Documentación (índice; incluye «Nueva Firma No Criptográfica»)
   https://www.agenciatributaria.es/AEAT.desarrolladores/Desarrolladores/_menu_/Documentacion/Documentacion.html
6. Modelo 200, ejercicio 2025, en desarrolladores (diseño, XSD contable, «Controles y especificaciones de Sociedades Web»), para confirmar si hay presentación directa.
7. Portal de pruebas PRE-Exteriores (303 e informativas)
   https://preportal.aeat.es/PRE-Exteriores/Inicio/_menu_/IVA/Modelo_303/Modelo_303.html
8. **Orden EHA/1658/2009 consolidada** (art. 3.2 y anexo II), y la **Orden HAC/241/2025**
   https://www.boe.es/buscar/act.php?id=BOE-A-2009-10326
   https://www.boe.es/buscar/doc.php?id=BOE-A-2025-5048
9. **Orden HAC/529/2026** (modelo 200 del ejercicio 2025)
   https://www.boe.es/buscar/doc.php?id=BOE-A-2026-11583
10. **Orden HAC/27/2026** (cambios en el 303 y el 390 de 2026). No está entre las fuentes del repositorio; `fuentes.mjs` la traería al refrescar la orden del 303.
11. Calendario del contribuyente 2026 y su tabla de domiciliación (y el de 2027 cuando salga)
    https://sede.agenciatributaria.gob.es/Sede/ayuda/calendario-contribuyente/calendario-contribuyente-2026.html
12. Colaboración social: «Presentación de declaraciones por colaboradores sociales» y la página de errores en nombre de terceros, en la ayuda técnica de la Sede.

**Preguntas que tienen que contestar esos documentos:**
- ¿El servicio de validación está en producción y pide certificado?
- ¿Para qué modelos vale `PresBasicaDos` (en especial 202 y 200)?
- ¿Qué parámetros tiene la consulta de declaraciones presentadas, y puede un colaborador o apoderado consultar lo de su cliente?
- ¿El JSON de respuesta trae el número de justificante además del CSV?
- ¿El entorno de pruebas acepta el certificado real?
- ¿Cuál es el texto literal del anexo II de la Orden EHA/1658/2009 tras la HAC/241/2025?

---

## 11. Cómo se ha medido

**Producción**: una docena de consultas (tres fallaron por nombres de tabla o de expresión y se repitieron), todas `begin read only … rollback`, filtradas por la cuenta de Foodint o leyendo catálogos globales (`tax_form`, restricciones):
- columnas y restricciones de `vat_book_entry`, `company_tax_profile`, `tax_rate`, `withholding_rate`, `tax_form`;
- recuentos del libro de Foodint por libro, tipo, recargo, ISP, inversión, retención, país, clave y fechas;
- el perfil fiscal de su única empresa, sin NIF;
- extensiones y número de secretos del Vault;
- y el texto de `conta_vat_book_desde_asiento` y `conta_motivos_para_validar`, para comprobar si rellenan el recargo y cómo tratan 472/477/4751.

**Código:** `origin/main` @ `46d01527`. Las referencias de fichero y línea de §3, §4 y §7 son de esa versión.

**Textos oficiales:** los de `docs/conta/fuentes/textos/` (RIVA, RIRPF, LIS, RGAT, PGC y las órdenes de cada modelo), en la versión vigente de cada artículo.

**AEAT y BOE en línea:** solo fragmentos de buscador, marcados [F]; no se ha podido abrir ninguna página.
