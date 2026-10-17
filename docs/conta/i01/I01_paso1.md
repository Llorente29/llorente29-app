# I01 · Impuestos · Paso 1: lo que hay que saber antes de construir

> Encargo de Julio, 17/10/2026. **Solo lectura**: sin código, sin migraciones y sin e2e.
>
> **Base leída:**
> - el código de `origin/main` @ `46d01527`;
> - la producción, solo con `begin read only … rollback`: estructura y recuentos, filtrados por la cuenta de Foodint (regla 9), sin NIF, IBAN ni CSV;
> - los textos oficiales que el repositorio ya guarda en `docs/conta/fuentes/textos/` (BOE consolidado);
> - y, **desde el 17/10 por la tarde**, los documentos de la AEAT y del BOE del §1.1, leídos enteros. Julio abrió en el entorno `sede.agenciatributaria.gob.es`, `www.agenciatributaria.es`, `www3.agenciatributaria.gob.es`, `preportal.aeat.es` y `www.boe.es`.
>
> **Nota técnica sobre `www.agenciatributaria.es`.** Su cadena de certificados lleva una firma SHA-1 que OpenSSL rechaza por defecto («CA signature digest algorithm too weak»). Se ha leído con la cadena **verificada** contra el almacén de CA, rebajando solo el nivel de algoritmos admitidos para esas descargas (`SECLEVEL=0`). **No se ha desactivado la verificación TLS.**
>
> **No se ha hecho ninguna llamada** a los servidores de presentación (`www1`, `www2`, `www10`, `prewww1`, `prewww2`, `prewww10`).
>
> **Marcas:**
> - **[T]**: leído entero en el documento oficial. Se cita documento y apartado.
> - **[F]**: solo fragmento de buscador. Queda poco; se dice por qué.
> - **[I]**: deducido de lo leído.
> - **[?]**: sin verificar.

---

## 0. En diez líneas

1. **Todos los modelos del encargo se pueden presentar desde un programa, con certificado de cliente en TLS** [T]:
   - **303, 390, 111, 115, 202 y también el 200** por **Presentación Directa** (`PresBasicaDos`): un POST con JSON que lleva el fichero del diseño de registro. Responde CSV, número de justificante, quién presentó y en calidad de qué, y la URL del PDF justificante [T, Especificaciones v3.0 §1 y §4].
   - **190, 180, 347 y 349** por **TGVI Online**: primero se valida, luego se presenta [T, TGVI v2.8].
   - **El 200 tiene envío directo** «destinado a empresas desarrolladoras de software» [T, coordinación del 200 §3 y §6.3]. Es el canal de Diez y ERP10.
2. **Validar sin presentar existe, pero solo en el entorno de pruebas, y no se puede usar dentro de la presentación real** [T].
   - El portal de pruebas dice que no es para «validaciones integradas en procesos de presentación en producción».
   - En producción, **la propia presentación valida**: si hay errores no se graba nada y no hay CSV.
3. **El justificante se recupera a partir del CSV** con una URL de la AEAT que devuelve el PDF de ese CSV [T, TGVI v2.8 §3.5.2].
   - El servicio de **consulta de declaraciones presentadas** devuelve CSV, justificante y fecha de lo presentado por NIF, modelo, ejercicio y periodo [T, v3.0 §2 y `consultas.xsd`].
   - Con los dos, «Ya lo presenté fuera · pegar CSV» se puede hacer entero: se comprueba el CSV contra la consulta y se trae el PDF.
4. **Certificado** (decisión del 17/10):
   - **Vault para Foodint; KMS antes de cualquier otro cliente**, y lo impide el código.
   - Sigue **sin confirmar** que las funciones de Supabase abran conexiones con certificado de cliente (§2).
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
8. **Domiciliación (§6.2), leída en la Orden EHA/1658/2009 consolidada, art. 3.2 y anexo II, con la HAC/241/2025** [T]:
   - la regla de «3 días hábiles hasta el último día de presentación, contando inhábiles los nacionales y los de la Comunidad de Madrid» **reproduce las 14 fechas** del calendario oficial de 2026;
   - por ejemplo, el 303 del 4T/2025 hasta el **27/01**;
   - y el 111/115 del 4T hasta el **15/01**.
9. **Modelo de datos (§7):**
   - una tabla de **declaraciones** con su estado, enlazada al asiento, al movimiento del banco y al justificante;
   - sus **casillas**;
   - sus **comprobaciones**;
   - las **obligaciones** con su porqué;
   - y tres tablas del **certificado**: custodia, permisos y registro de usos.
   - Más el enlace **asesoría–empresa con consentimiento**.
10. **De los tableros (§8):**
    - hay que cambiar tres textos: los plazos del 190/180, «5 días» y la promesa de custodia mientras haya Vault;
    - «Antes de enviar, Hacienda lo valida» hay que reformularlo, porque la validación de pruebas no vale para eso;
    - lo demás se puede hacer.

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
   - **Encontrado (17/10, leído):** el 200 está en la lista de modelos de Presentación Directa (`PresBasicaDos`) de las Especificaciones v3.0, §4, y la coordinación del 200 lo describe como «envío directo al servidor de la AEAT, opción destinada a empresas desarrolladoras de software» (§3 y §6.3). Detalle en §1.2.

---

## 1. El canal técnico de la AEAT, modelo a modelo

### 1.1 Documentos leídos

| Documento | Versión | Qué se ha usado |
|---|---|---|
| «Especificaciones de los servicios de Presentación Directa, Consulta de Declaraciones Presentadas y Validación de Impresión» (`EspecificacionesServiciosDeclaracionesAEAT_ES.pdf`) | **Versión 30** (el índice de desarrolladores la llama v3.0; antes la citaba como v2.9) | Todo: §1 presentación, §2 consulta, §3 validación, §4–5 modelos admitidos, §6 caracteres |
| `consultas.xsd` | — | La respuesta de la consulta |
| «303 – IVA. Servicios de Ayuda a la Declaración. Ejercicio 2019 y siguientes» (`IVA303-CoordColabora_7.02.pdf`) | 7.02, 27/12/2019 | §1.2, §2.3, §6, §7 |
| «Servicios de Ayuda a la Declaración I. Sociedades 2021 y siguientes» (`Sociedades2021-CoordColabor-1.0.pdf`) | 1.0, 13/05/2022 | §3, §4, §6 |
| «Datos Fiscales de Sociedades 2025 en programas de ayuda» (`Autenticacion_datos_fiscales_IS2025.pdf`) | 1.0, 04/06/2026 | §1–3 |
| «Especificaciones … TGVI Online» (`Especificaciones_TGVI_Online.pdf`) | 2.8, actualizado 03/10/2024 | Todo |
| Páginas de la Sede: colaboradores sociales, errores en nombre de terceros, 200 en nombre de terceros, cotejo por CSV, calendario 2026 y su domiciliación, PRE-Exteriores | Las de hoy | Lo citado en cada punto |
| BOE: Orden EHA/1658/2009 consolidada, Orden HAC/241/2025, Orden HAC/529/2026 | Las de hoy | Art. 3.2 y anexo II; plazos y domiciliación del 200 |

### 1.2 Tabla

| Modelo | Canal desde programa | Validar antes | Respuesta |
|---|---|---|---|
| **303** | **Presentación Directa**: POST `application/json;charset=UTF-8` a `…/wlpl/PFTW-PICW/PresBasicaDos` con `MODELO`, `EJERCICIO`, `PERIODO`, `NRC` (si es pago con NRC), `IDI`, `F01` (el fichero del diseño de registro, sin CRLF ni tabuladores), `FIR="FirmaBasica"`, `FIRNIF` y `FIRNOMBRE` del titular del certificado [T, v3.0 §1.2]. La AEAT comprueba que `FIRNIF` es el titular del certificado | Solo en pruebas (§1.4) | JSON. **Correcta:** `CodigoSeguroVerificacion`, `Fecha`, `Hora`, `Expediente`, `NIFPresentador`, `TipoRepresentacion` («Nombre propio», «Apoderado», «Colaborador»), `NIFDeclarante`, `Justificante` (13 dígitos), `NRCPago`, `ImporteAIngresar`, **`urlPdf`**, `avisos`, `advertencias`. **Error:** hasta 100 errores `E00…`, nunca CSV. «El justificante de la presentación no es la respuesta devuelta sino el **PDF**». «**No es posible anular declaraciones ya grabadas**» [T, v3.0 §1.3] |
| **390** | Presentación Directa [T, v3.0 §4] | Igual | Igual |
| **111**, **115** | Presentación Directa [T, v3.0 §4; el ejemplo del §1.2 es un 111] | Igual | Igual |
| **202** | Presentación Directa [T, v3.0 §4] | Igual | Igual |
| **200** | **Presentación Directa** [T, v3.0 §4]. La coordinación del 200 lo dice así: «Igualmente puede realizarse un **envío directo al servidor de la AEAT**, opción destinada a empresas desarrolladoras de software» [T, §3], con firma no criptográfica y certificado [T, §6.3]. El fichero es de datos etiquetados (`<T200020XX0A0000>` …) según el diseño de registro del ejercicio [T, §6.3.1.1.2]. La información contable puede ir en XML (`mod2002025.xsd`) [T, §4.1]. **Los datos fiscales de Sociedades** se pueden bajar desde un programa con certificado o con apoderamiento [T, Datos Fiscales IS2025 §2–3] | En pruebas y en producción, según la coordinación del 200 [T, §4.2]. El único servicio de validación documentado está en el dominio de pruebas [T, v3.0 §3] | Igual que el 303 |
| **190**, **180**, **347**, **349** | **TGVI Online**: `InicializarEnvio` → `EnviarDatos` (bloques de registros tipo 2) → `RecuperarEnvio` (estado) → `PresentarEnvio` con `firnif`, `firnombre`, `fir=FirmaBasica`. Hay también `RecuperarErroneos`, `RecuperarErrores`, `BajaDeclaracion`, `RecuperarAvisos` y vista previa [T, TGVI §3]. Rechazo selectivo: se presentan los registros buenos y los malos van después en una complementaria [T, §1]. «En ningún momento la generación de un envío equivale a la presentación» [T, §1] | La validación es el propio primer paso [T] | `csv`; el PDF en `https://www2.agenciatributaria.gob.es/wlpl/inwinvoc/es.aeat.dit.adu.eeca.catalogo.VisualizaSc?COMPLETA=SI&ORIGEN=C&CSV=<csv>` [T, §3.5.2] |
| **036** | Presentación Directa [T, v3.0 §4] (aquí solo como aviso) | — | — |

**No admite Presentación Directa:** las declaraciones informativas (van por TGVI) [T, v3.0 §4].

### 1.3 Autenticación y quién puede presentar

- **Certificado de cliente en la conexión** («Firma No Criptográfica»). **No se acepta firma criptográfica del fichero** [T, v3.0 §1].
  - El titular del certificado es el «presentador».
  - El programa tiene que **enseñar los datos de la declaración y pedir conformidad** antes de enviar: «el propio envío de la declaración supone la aceptación de los datos» [T, v3.0, «Obtención de datos y autorización»].
  - Es la confirmación de cada uso que pide el tablero 9.
- **El presentador puede ser** [T, Sede, «El titular del certificado no es colaborador social y no está apoderado»]:
  - el **titular** de la declaración;
  - un **colaborador social o delegado** suyo, y el tipo de acuerdo tiene que cubrir el trámite;
  - un **apoderado** (Registro de apoderamientos). Si el apoderamiento es para notificaciones, tiene que estar «Confirmado».
- **Certificados admitidos para colaborador social** [T, Sede, «Presentación de declaraciones por colaboradores sociales»]:
  - **persona física**;
  - **representante de persona jurídica**;
  - **sello de entidad, «únicamente para comunicaciones máquina a máquina»**. Los delegados, con certificado de persona física o de empleado.
- **Sello de entidad en TGVI:** sus llamadas van por el dominio `www10` en lugar de `www1` [T, TGVI §3.2].
- **Pago en nombre de terceros** [T, misma página]:
  - el colaborador **puede domiciliar** el pago de su cliente;
  - **pero para pagar con NRC** desde la cuenta del cliente hace falta el apoderamiento **`PAGOAPODECC`**; si no, la cuenta tiene que ser del titular del certificado.
- **303 de una S.A. o S.L.: obligatorio con certificado electrónico** (también los mensuales) [T, coordinación 303 §1.2].
- **Consecuencia para Sumied** [I]:
  - **empresa con su certificado:** presenta en nombre propio;
  - **asesoría:** su certificado, o su sello de entidad si es colaboradora social, que es lo natural en un servidor. Tiene que ser colaboradora social con acuerdo que cubra cada modelo, o tener poder de cada cliente.
  - La domiciliación en la cuenta del cliente funciona en los dos casos.

### 1.4 Validación y entorno de pruebas

- **Validación sin presentar.**
  - `ServValiDos` (JSON; devuelve el PDF «Borrador NO VÁLIDO» en base64 o los errores) en `https://prewww2.aeat.es/wlpl/PFTW-PICW/ServValiDos` [T, v3.0 §3.2]. `ServVali` ya no vale para ejercicios 2025 y siguientes [T, §3.1].
  - **No necesita certificado** [T, coordinación 303 §2.3 y §6.1.1] y está «**sólo disponible en el entorno de Pruebas de Externos**» [T, coordinación 303 §6.1].
  - Para el 200, la coordinación dice que está en pruebas **y en producción** [T, §4.2], pero no da otra URL que la de pruebas [?].
  - **No se puede usar dentro de la presentación real:** el portal de pruebas dice que no es para «pruebas masivas, **validaciones integradas en procesos de presentación en producción**» y que puede cortar los usos abusivos [T, `preportal.aeat.es`].
  - Para el 303 de Sumied: **la presentación real es la validación**. Si la AEAT da errores, no graba nada y no hay CSV [T, v3.0 §1.3]. Antes, Sumied valida contra el diseño de registro.
- **Entorno de pruebas para externos**, en `prewww1` (presentación), `prewww2` (validación y PDF) y `prewww10` (sello) [T, TGVI §4]:
  - laborables de **8:00 a 15:00** [T, v3.0 §1.4];
  - con **certificado electrónico de usuario** [T, v3.0 §1.4; portal: «con la única condición de autenticarse mediante un certificado electrónico»]. No hay certificados de prueba: se usa uno real;
  - «sin que en ningún caso tengan trascendencia tributaria» [T, portal];
  - en TGVI, «deben utilizarse datos de prueba y **nunca datos reales**» [T, TGVI §4];
  - la CA del servidor de pruebas es **distinta** de la de producción [T];
  - tras una presentación correcta, las siguientes del mismo periodo van como **complementarias** [T, v3.0 §1.4];
  - los logs se borran cada día [T].
- **Presentar en nombre de terceros en pruebas:** el fragmento que lo negaba no lo he encontrado en los documentos leídos. Queda [F]. Si es así, el camino de la asesoría no se puede ensayar en pruebas.

### 1.5 Justificante, consulta y «pegar el CSV»

- **Justificante de lo presentado desde Sumied:** el PDF de `urlPdf` [T, v3.0 §1.3]. Se descarga en el momento y se guarda.
- **Consulta de declaraciones presentadas:**
  - `https://www1.agenciatributaria.gob.es/wlpl/SCEJ-MANT/ConsultaExt`, con certificado;
  - POST de formulario con `NIF`, `ANR`, `MOD`, `EJF`, `PER` y rango de fechas y horas [T, v3.0 §2];
  - responde XML con hasta 100 declaraciones: `ejercicio`, `modelo`, `periodo`, `nif`, **`csv`**, `expediente`, **`justificante`**, `just_anterior` y `fechaYHoraPresentacion` [T, `consultas.xsd`].
  - **No busca por CSV y no trae el PDF.**
- **PDF a partir del CSV:** `…/VisualizaSc?COMPLETA=SI&ORIGEN=C&CSV=<csv>` [T, TGVI §3.5.2]. La página de cotejo de la Sede hace lo mismo para personas: «Si el CSV se corresponde con una declaración que genera PDF, obtienes en pantalla el PDF» [T, Sede, cotejo].
  - Si esa URL pide certificado o la sesión de la Sede desde un programa: [?] (no se ha llamado).
- **«Ya lo presenté fuera · pegar CSV»** [I]:
  1. Sumied pide el CSV, el modelo y el periodo.
  2. La **consulta** confirma que existe una declaración de ese NIF, modelo y periodo con ese CSV, y da justificante y fecha.
  3. El **PDF** se trae con la URL del CSV.
  4. Si alguna de las dos no responde desde el programa, se pide subir el PDF.
- **«Probar con Hacienda»** [I]: la **consulta de declaraciones presentadas** es una llamada **con certificado que no presenta nada**. Si contesta (aunque sea con 0 declaraciones), el certificado está vivo y la AEAT lo acepta para ese NIF. Es la «prueba» del tablero 8.

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

**Decisión del 17/10:**
- **Foodint empieza con el Vault.**
- **El KMS es obligatorio antes de cualquier otro cliente**, y el código lo impide: con el almacén «vault», guardar un certificado solo se admite si la cuenta es la de Foodint.
- El almacén es una pieza aparte (guardar · abrir para usar · quitar), con dos implementaciones, y `tax_certificate.storage` dice en cuál está cada certificado.
- El texto del tablero 8 depende del almacén (§8).

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
| 190 / 180 | 1–31 de enero | RIRPF art. 108.2. Calendario AEAT 2026: «Hasta el 2 de febrero · Resumen anual 2025: 180, … 190» | [T] |
| 347 | Mes de febrero | Orden EHA/3012/2008. Calendario AEAT 2026: «Hasta el 2 de marzo · Año 2025: 347» | [T] |
| 349 trimestral | 1–20 del mes siguiente al trimestre; 4T: 1–30 de enero (mensual si pasa de 50.000 €) | RIVA art. 81; Orden EHA/769/2010 | [T] |
| 202 | 1–20 de abril, octubre y diciembre | Ley 27/2014 (LIS), art. 40.1 | [T] |
| 200 | Los 25 días naturales siguientes a los 6 meses del cierre (año natural: 1–25 de julio) | LIS art. 124.1; para el de 2025, Orden HAC/529/2026 | [T] |
| Día inhábil | Si el último día es sábado, domingo o festivo, el plazo acaba el primer día hábil siguiente. **También si coincide con un festivo autonómico o local** (del obligado), según el calendario AEAT 2026 («Vencimientos en días inhábiles, sábados y festivos») | La AEAT lo aplica así en su calendario | [T]. La base legal citada por la doctrina (Ley 39/2015, art. 30.5) no la he leído: [F] |

**Consecuencia:** el último día de presentación **depende de dónde está la empresa**, por los festivos autonómicos y locales. Hace falta una tabla de festivos por año, comunidad y municipio.

### 6.2 Domiciliación: la regla, leída

**Orden EHA/1658/2009, art. 3.2, en la redacción de la Orden HAC/241/2025** [T, BOE consolidado]:
> a) Con carácter general, en el plazo que a tal efecto se recoge en el anexo II, de la presente orden.
>
> b) No obstante, cuando el último día del plazo para la presentación de una autoliquidación […] sea inhábil, el plazo de domiciliación establecido en el anexo II se ampliará el mismo número de días que resulte ampliado el plazo de presentación […].
>
> Entre la finalización del plazo de presentación de una autoliquidación con domiciliación del pago y la finalización del plazo genérico de presentación e ingreso voluntario de esa misma autoliquidación, deberá existir un mínimo de tres días hábiles o cinco naturales.
>
> A los efectos de lo establecido en la presente letra, se considerarán días inhábiles los sábados, los domingos, las festividades nacionales y las festividades autonómicas o locales que afecten al municipio en el que radique el Departamento de Informática de la Agencia Tributaria.

**Anexo II** [T]:

| Modelo | Domiciliación |
|---|---|
| 303 trimestral | 1–15 de abril, julio y octubre; 1–25 de enero |
| 303 mensual | 1–25; el de enero, 1–23 de febrero (24 en bisiesto) |
| 111 / 115 trimestral | 1–15 de abril, julio, octubre **y enero** |
| 111 / 115 mensual | 1–15 de cada mes |
| 202 | 1–15 de abril, octubre y diciembre |
| 200 | 1–20 de julio |
| 390, 190, 180, 347, 349 | No están: no tienen ingreso |

**Lo que publica la AEAT para 2026** [T, calendario 2026, «Plazos de presentación de autoliquidaciones con domiciliación bancaria»]:
- 303 4T/2025: domiciliación del 1 al **27** de enero (presentación hasta el 30);
- 111/115 4T/2025: 1–15 de enero;
- 111/115 mensuales: hasta el 15/01, **17/02**, **16/03**, 15/04, 15/05, **17/06**, 15/07, **17/08**, **16/09**, 15/10, **17/11** y **16/12**;
- 200 de 2025: 1–**22** de julio (presentación hasta el 27);
- 202: 15/04, 15/10 y **16/12**.
- El 22/07 del 200 lo fija también la Orden HAC/529/2026, art. 2: «desde el día 1 de julio hasta el 22 de julio de 2026, ambos inclusive» [T].

**La regla que reproduce todas esas fechas** [I, comprobado]:
- **la domiciliación acaba el último día hábil que deja exactamente 3 días hábiles hasta el último día de presentación (incluido), ya trasladado si caía en inhábil**;
- inhábiles: sábados, domingos, festivos nacionales y de la Comunidad de Madrid.
- Aplicada a los 14 casos publicados de 2026: **14 de 14**.
- Contando además los festivos de la ciudad de Madrid (San Isidro, 15/05) falla uno: la AEAT da el 15/05 como último día de domiciliación del 111 de abril. **La AEAT no cuenta los festivos locales de la ciudad** aunque la orden los nombre.
- Es la regla que decidió Julio el 17/10.

**Propuesta:**
- la fecha de domiciliación **se calcula** con esa regla y una tabla de festivos (nacionales y de la Comunidad de Madrid) por año;
- se **guarda en cada declaración**;
- y **una prueba la compara con el calendario oficial de la AEAT** de cada año en cuanto se publica. Para 2026 están las 14 fechas de arriba.

### 6.3 Tabla 2026

Fechas del calendario oficial de la AEAT de 2026 [T]. Los festivos autonómicos o locales de la empresa pueden mover el último día de presentación (§6.1).

| Obligación | Sin domiciliar (último día) | Domiciliado (último día) |
|---|---|---|
| 303 4T/2025 | vie 30/01/2026 | **mar 27/01/2026** |
| 349 4T/2025 · 390 de 2025 | vie 30/01/2026 | — (sin ingreso) |
| 111 / 115 4T/2025 | mar 20/01/2026 | jue 15/01/2026 |
| 190 / 180 de 2025 | **lun 02/02/2026** (el 31 es sábado) | — |
| 347 de 2025 | **lun 02/03/2026** (el 28/02 es sábado) | — |
| 303/111/115/349 1T · 202 1P | lun 20/04/2026 | mié 15/04/2026 |
| 303/111/115/349 2T | lun 20/07/2026 | mié 15/07/2026 |
| 200 de 2025 (año natural) | **lun 27/07/2026** (el 25 es sábado) | **mié 22/07/2026** |
| 303/111/115/349 3T · 202 2P | mar 20/10/2026 | jue 15/10/2026 |
| 202 3P | **lun 21/12/2026** (el 20 es domingo) | **mié 16/12/2026** |

### 6.4 Tabla 2027

El calendario oficial de 2027 aún no está publicado: todo es **calculado** [I] con las reglas del §6.1 y del §6.2.
- Festivos usados: nacionales y de la Comunidad de Madrid de 2027 (1/1, 6/1, 25/3, 26/3, 1/5, 3/5, 16/8, 12/10, 1/11, 6/12, 8/12 y 25/12).
- Es una lista **provisional**: hay que cargar la oficial (BOE y BOCM) cuando se publique.
- Con ella, la domiciliación sale igual que con la regla de los 3 hábiles.

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
  - `storage` (`vault` · `kms`): en qué almacén está. Con `vault` solo se admite la cuenta de Foodint (decisión del 17/10);
  - `ciphertext` (bytea o ruta de Storage), `wrapped_key`, `kms_key_ref` (solo `kms`), `vault_secret_id` (solo `vault`);
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
| 10 · Calendario | «Resúmenes del año: IVA (390), retenciones (190) y alquiler (180) · hasta el 25/01 o el 30/01» | El 25/01 es el plazo domiciliado del 303, no de estos. El 390, 190 y 180 **no se pagan** y no tienen domiciliación (no están en el anexo II) [T]. El 190 y el 180 son hasta el **31/01** (02/02 en 2026; 01/02 en 2027) [T] | «390 hasta el 30/01; 190 y 180 hasta el 31/01», con la fecha trasladada |
| 10 · Calendario | «Si se domicilia, el plazo acaba 5 días antes» | Son 3 días hábiles (Madrid). El 4T del 303 de 2025 fue el **27/01**, no el 25 [T] | Enseñar la **fecha** de la declaración, no «5 días antes» |
| 10 · Calendario | «hasta el 28/02 · Clientes y proveedores… (347)» | En 2026 fue el 02/03 y en 2027 será el 01/03 [T][I] | Fecha calculada |
| 9 · 303 | «Antes de enviar, Hacienda lo valida. Si devuelve un error, no se presenta nada y te dice qué casilla falla» | La validación sin presentar solo está en el entorno de pruebas y **no se puede usar en la presentación real** [T, portal de pruebas]. Pero la presentación real devuelve hasta 100 errores y, con error, no graba nada [T, v3.0 §1.3] | Mantener «Si Hacienda devuelve un error, no se presenta nada y te dice qué falla», sin «antes de enviar lo valida». Sumied valida el fichero contra el diseño de registro antes de enviar. «Qué casilla» solo si el texto del error la nombra |
| 9 · 303 | Botón «Presentar 6.360,00 €» | La AEAT exige que el programa **enseñe los datos y pida conformidad** antes del envío [T, v3.0] | Ya está en el diseño (confirmación); el texto de la confirmación debe decir que el envío supone aceptar los datos |
| 9 · 303 | «Ya lo presenté fuera · pegar CSV» | Se puede: la consulta confirma el CSV y da justificante y fecha [T]; el PDF se trae con la URL del CSV [T, TGVI §3.5.2] | Mantener. Si la URL del PDF no responde a un programa, se pide subir el PDF [?] |
| 8 · Certificados | «Queda cifrado. Nadie puede verlo ni descargarlo, tampoco en Sumied» | **Con el Vault es falso** (§2.2) | Decisión del 17/10: mientras esté en el Vault (solo Foodint), el texto **no** dice «nadie puede verlo, tampoco en Sumied». Con KMS, se puede decir |
| 8 · Certificados | «Probar con Hacienda» · «Funciona · probado con Hacienda el 09/10» | Se puede con la **consulta de declaraciones presentadas**: lleva certificado y no presenta nada [T, v3.0 §2] | Mantener |
| 8 · Certificados | «Mi asesoría, con su certificado… tú no ves nada de él» | Se puede: la asesoría usa su certificado o su **sello de entidad** (máquina a máquina) si es colaboradora social [T]. Tiene que estar en el censo con un acuerdo que cubra cada modelo, o tener poder [T]. Para pagar con NRC desde la cuenta del cliente hace falta `PAGOAPODECC`; domiciliar sí se puede sin él [T] | Mantener, con el enlace asesoría–empresa con consentimiento (decisión del 17/10). Si se paga sin domiciliar, avisar de `PAGOAPODECC` |
| Impuesto de sociedades | Presentar el 200 desde Sumied | **Hay envío directo** (`PresBasicaDos`) [T, v3.0 §4; coordinación del 200 §3] | Mantener. El fichero del 200 es grande: páginas etiquetadas, datos contables y datos fiscales que se pueden bajar de la AEAT con certificado [T] |
| 9 · 303 | «1 factura de un proveedor con fecha del 30/09 llegó el 03/10: va en este trimestre» | Se puede: es `received_date` frente a `issue_date`, y ya están en el libro | — |
| 9 · 303 | «Hacienda lo carga el 20/10 y Sumied lo casa con el banco» | Se puede, con `bank_match_item.tax_return_id` (§7.4) | — |

El resto de los tres tableros se puede hacer con lo descrito arriba.

---

## 9. Qué queda por decidir, medir o leer antes de construir

**Decisiones:** tomadas el 17/10, en «Decisiones del 17/10». Queda abierto **qué KMS y cuándo**, antes del primer cliente que no sea Foodint.

**Lo que se prueba en el paso 2, en staging:**
1. `Deno.createHttpClient` con certificado de cliente en el Edge Runtime de Supabase, contra un servidor **público** de pruebas de mTLS. Nunca contra la AEAT.
2. Con autorización de Julio, y solo en el **entorno de pruebas de la AEAT**:
   - la consulta de declaraciones presentadas (para «Probar con Hacienda»);
   - una presentación de prueba del 303 de Foodint con su certificado, en horario de 8:00 a 15:00;
   - la URL del PDF a partir del CSV.
   - El entorno de pruebas pide **certificado real**; lo presentado allí no tiene trascendencia tributaria [T]. Hoy Julio ha dicho que no se llame a `prewww1`: no se hace sin su permiso.

**Lo que queda por leer:**
- Los **diseños de registro** de cada modelo, para generar los ficheros:
  - 303 de 2026: `DR303e26v101.xlsx`, ya descargado;
  - 390, 347, 349, 111, 115, 180, 190, 202 y 200 de 2025.
  - Es trabajo del paso de construcción, modelo a modelo.
- «Nueva Firma No Criptográfica»: la v3.0 la cita como publicada en los portales de entidades colaboradoras y desarrolladoras. **No está en el índice público de desarrolladores**; puede pedir registro.
- Si en pruebas se puede presentar en nombre de terceros: solo lo dice un fragmento [F].

**Lo que depende de otros frentes:**
- las recibidas por correo (D01), para «no falta ninguna factura recibida por correo»;
- el S01 de D en `main`, para las pantallas.

---

## 10. Documentos

**Leídos enteros (17/10):** los del §1.1. Copias de trabajo fuera del repositorio (no se suben PDF de terceros).

**Antes, sin acceso:** el informe de la mañana citaba fragmentos de buscador. Lo que ha cambiado al leer los originales:

| Antes [F]/[?] | Ahora [T] |
|---|---|
| El 200 solo por Sociedades WEB | **Envío directo** (`PresBasicaDos`) |
| La validación, ¿en producción? | **Solo en pruebas**, sin certificado, y **prohibido** integrarla en la presentación real |
| No hay API para el PDF a partir del CSV | **Hay URL** que devuelve el PDF del CSV (TGVI §3.5.2) |
| ¿El JSON trae número de justificante? | **Sí**: `Justificante`, 13 dígitos |
| ¿Sello de entidad? | **Sí** para colaborador social, máquina a máquina; en TGVI por `www10` |
| Domiciliación «3 hábiles» de segunda mano | Art. 3.2 y anexo II leídos; la regla reproduce las 14 fechas de 2026 |
| Domiciliación del 200 de 2025 | 1–22 de julio (Orden HAC/529/2026) |
| Pruebas con certificado real | Sí: «certificado electrónico de usuario», sin certificados de prueba |

---

## 11. Cómo se ha medido

**Producción:** una docena de consultas (tres fallaron por nombres de tabla o de expresión y se repitieron), todas `begin read only … rollback`, filtradas por la cuenta de Foodint o leyendo catálogos globales (`tax_form`, restricciones):
- columnas y restricciones de `vat_book_entry`, `company_tax_profile`, `tax_rate`, `withholding_rate`, `tax_form`;
- recuentos del libro de Foodint por libro, tipo, recargo, ISP, inversión, retención, país, clave y fechas;
- el perfil fiscal de su única empresa, sin NIF;
- extensiones y número de secretos del Vault;
- y el texto de `conta_vat_book_desde_asiento` y `conta_motivos_para_validar`.

**Código:** `origin/main` @ `46d01527`.

**Textos oficiales:**
- los de `docs/conta/fuentes/textos/` (RIVA, RIRPF, LIS, RGAT, PGC y las órdenes de cada modelo), en la versión vigente de cada artículo;
- y los documentos de la AEAT y del BOE del §1.1, descargados el 17/10.

**Domiciliación:** la regla del §6.2 se ha comprobado con un cálculo contra las 14 fechas publicadas de 2026: 14 de 14 con festivos nacionales y de la Comunidad de Madrid.

**Ninguna llamada** a los servidores de presentación, ni de producción ni de pruebas.
