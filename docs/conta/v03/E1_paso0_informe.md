# V03 · Verifactu · E1 · Paso 0: lo que hay y lo que dice la norma

> Informe previo al código (encargo V03, 25/10/2026). **No se ha tocado nada**:
> solo se ha leído el repositorio, producción (solo lectura, por cuenta) y las
> fuentes oficiales. Rama `conta/v03-e1`.

## 0 · Lo que conviene saber antes de leer

- **Fechas que obligan hoy, en el BOE:** RDL 15/2025 (BOE de 3/12/2025), art. 3, que
  cambia la disposición final cuarta del RD 1007/2023: **1/1/2027** para los
  contribuyentes del Impuesto sobre Sociedades (Foodint) y **1/7/2027** para el resto.
  El aplazamiento a 2028 no está en el BOE. La Orden HAC/1028/2026 (BOE de 5/10/2026)
  es la de la **factura electrónica entre empresas**, no la del aplazamiento.
- **Una corrección al benchmark (ya hecha allí, 25/10):** el control de flujo va en **segundos**, no en
  minutos: `TiempoEsperaEnvio`, que empieza en **60 s** (Orden HAC/1177/2024,
  art. 16.2). El límite son **1.000 registros por envío**.
- **Tres cosas que no he podido hacer desde aquí,** porque el entorno de trabajo no
  resuelve los dominios de servicio de la AEAT (`prewww2.aeat.es`,
  `www2.agenciatributaria.gob.es`):
  1. bajar la **lista oficial de códigos de error** (`errores.properties`);
  2. bajar el **WSDL y los XSD**, que son la fuente de los puntos de acceso exactos;
  3. probar la **conexión con certificado**.

  Es lo primero que haría la E1, desde staging (Supabase), y ahí se ve también si
  las funciones de Supabase pueden hacer TLS con certificado de cliente (ver §5).

## 1 · La huella de hoy: no vale, hay que rehacerla

**Lo que hace hoy** (`20261024T0835_v01_facturas_venta.sql`, líneas 535–538, en
`conta_venta_emitir`; y lo mismo en los cierres de `20261024T1440_v01_cierres.sql`):

```sql
select hash into v_prev from customer_invoice
 where company_id = … and status <> 'borrador' and hash is not null
 order by issued_at desc, id desc limit 1;
v_hash := encode(sha256(convert_to(concat_ws('|', v_emisor, v_texto,
          v_f.issue_date::text, total::text, coalesce(v_prev, '')), 'UTF8')), 'hex');
```

**Lo que pide la AEAT** («Detalle de las especificaciones técnicas para generación
de la huella o hash», v0.1.2, 27/08/2024, §3 y §5, que desarrolla el art. 13 de la
Orden HAC/1177/2024):

| | Hoy (V01) | Oficial (alta) |
|---|---|---|
| Algoritmo | SHA-256 | SHA-256 (lista L12) |
| Campos | emisor, número, fecha, total, anterior | `IDEmisorFactura`, `NumSerieFactura`, `FechaExpedicionFactura`, **`TipoFactura`**, **`CuotaTotal`**, `ImporteTotal`, `Huella` (la anterior), **`FechaHoraHusoGenRegistro`** |
| Formato | `valor\|valor\|…` | `nombre=valor&nombre=valor…`, sin espacios al principio ni al final, UTF-8 |
| Fecha | `2026-10-24` | `24-10-2026` |
| Fecha y hora con huso | no está | `2026-10-24T18:01:12+02:00` |
| Importes | `numeric::text` | como en el XML; `123.1` y `123.10` valen igual |
| Salida | hexadecimal en minúsculas | **hexadecimal en MAYÚSCULAS**, 64 caracteres |
| Primer registro | `''` al final | `Huella=` vacío y `PrimerRegistro=S` en el XML |
| Anulación | no existe | `IDEmisorFacturaAnulada`, `NumSerieFacturaAnulada`, `FechaExpedicionFacturaAnulada`, `Huella`, `FechaHoraHusoGenRegistro` |

**Comprobado:** los tres ejemplos oficiales (§6 del documento) dan exactamente la
huella publicada (`3C464DAF…8F12F60`, `F7B94CFD…802A2B97` y `177547C0…88F90C68`).
Irán como pruebas unitarias.

**Dos defectos más de hoy, aparte del formato:**

1. **La cadena no aguanta dos emisiones a la vez.** La anterior se lee con
   `order by … limit 1` sin bloquear nada: dos facturas emitidas en el mismo instante
   pueden coger la misma anterior. Hace falta un cerrojo por cadena, es decir, por
   obligado y por sistema.
2. **La cadena es por empresa (`company_id`).** La AEAT la lleva por obligado (NIF) y
   sistema, y encadena altas y anulaciones de **todas las series** en orden de
   generación (Descripción de servicios web v1.0.3, §9.1.2.1). Si dos empresas
   compartieran NIF, la cadena sería una. Hoy no pasa, pero el registro tiene que
   anclar por NIF.

**Conclusión:** se rehace. La cadena oficial empieza el día que la empresa pasa a
«real», con su serie nueva, y lo de antes no se toca. Las 5 emitidas con la huella
de la V01 (las del 24/10 en GLV, JUS y UBR) se quedan con la suya, que **no es la de
Verifactu**, y salen «No se envía».

## 2 · La norma, en sus fuentes

| Pregunta | Respuesta | Fuente |
|---|---|---|
| ¿Quien elige VERI*FACTU tiene que mantenerlo hasta final de año? | **Sí.** «Deberá mantenerse siempre al menos hasta el final del último año en que haya funcionado como tal». La renuncia se marca en un campo del envío, que tiene que llegar antes de que acabe el año en que se quiere hacer efectiva. | Orden HAC/1177/2024, art. 17.2 y 17.3; RD 1007/2023, art. 16.5 |
| Campos del registro de alta | NIF y nombre del emisor; destinatarios (NIF o id. extranjero); si lo expide el destinatario o un tercero; serie y número; fecha de expedición y de operación; tipo (F1, F2, F3, R1–R5); rectificadas o sustituidas; descripción; desglose (impuesto, clave de régimen, calificación S1/S2/N1/N2 o exenta E1–E8, base, tipo, cuota, recargo); cuota total; importe total; encadenamiento (serie, número, fecha y huella del anterior, o primer registro); sistema informático; fecha y hora con huso; tipo de huella y huella. | RD 1007/2023, art. 10; Orden, anexo §2; XSD `SuministroInformacion.xsd` |
| Campos del registro de anulación | NIF y nombre del obligado; quién lo genera; serie, número y fecha de la factura anulada; encadenamiento; sistema informático; fecha y hora; huella. Más `SinRegistroPrevio` y `RechazoPrevio` según el caso. | RD 1007/2023, art. 11.2; Orden, anexo §3; Validaciones v1.2.2, §3.1.4 |
| Control de flujo | Empieza en **60 segundos** entre envíos. Cada respuesta trae `TiempoEsperaEnvio` actualizado. Se envía cuando pasan «t» segundos **o** cuando se juntan **1.000** registros, lo primero que ocurra. | Orden, art. 16.2; Servicios web v1.0.3, §6.4.4.1 |
| Sin conexión | Hay que reintentar los pendientes «al menos una vez cada hora». | Orden, art. 16.4 |
| QR · URL | Pruebas: `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=…&numserie=…&fecha=DD-MM-AAAA&importe=…`. Real: `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?…`. Solo esos 4 parámetros (más `Idioma`, opcional; **nunca** `formato` en el QR). Se codifican en URL y UTF-8. `numserie`, como mucho 60 caracteres ASCII imprimibles; `importe` con punto y 2 decimales. | QR v0.5.0 (10/12/2025), §4–§6 |
| QR · tamaño y leyenda | Entre **30×30 y 40×40 mm**, ISO/IEC 18004:2015, corrección **M**, al menos 2 mm en blanco (mejor 6). Va arriba y solo en la primera página. Encima, «**QR tributario:**»; debajo, «**Factura verificable en la sede electrónica de la AEAT**» o «**VERI*FACTU**», con una letra igual o mayor que el resto. | Orden, art. 20.1 y 21; QR v0.5.0, §2–§3 |
| Simplificadas | Clave **F2**, salvo las cualificadas (art. 7.2 y 7.3 del RD 1619/2012), que van como F1. Su rectificación es siempre **R5**. Llevan su QR. En F2, base más cuota no puede pasar de 3.000 € (±10 €). | Orden, anexo lista L2; FAQ de la sede «Registros de facturación: alta»; Validaciones v1.2.2, §3.1.3.15.8 |
| Recapitulativas | En VERI*FACTU **los tiques se envían igual**. El resumen de final de día es para la contabilidad y **no sustituye** ese envío. | FAQ de la sede «Cuestiones generales: ámbitos de aplicación» (actualizada el 21/10/2026), la de la tienda que emite simplificadas y al final del día saca una «factura recapitulativa» |
| Subsanación | Nuevo registro de alta con la **misma clave** y `Subsanacion=S`, cuando no haga falta rectificativa ni anulación. El original no se toca. Se encadena con el inmediatamente anterior. Si lo rechazado no llegó a constar, `RechazoPrevio`. | Servicios web v1.0.3, §9.1.2; Validaciones v1.2.2, §4.3.1 y anexo §6 |
| Rechazo | Cada registro sale **Correcto**, **AceptadoConErrores** (el error es «admisible»: queda registrado pero hay que subsanarlo) o **Incorrecto** (no consta: corregir y volver a enviar). El envío sale Correcto, ParcialmenteCorrecto o Incorrecto. Si falla la estructura o la cabecera, se rechaza entero con un SoapFault. | Validaciones v1.2.2, §4; Servicios web v1.0.3, §6 |
| Conservación | Todos los registros, durante el plazo de la Ley General Tributaria (4 años, art. 66 LGT), y con exportación segura. Los libros contables, 6 años (art. 30 del Código de Comercio). | RD 1007/2023, art. 8.2.c; Orden, art. 8.2 y 8.3 |
| Declaración responsable | Nombre del sistema; código identificador; versión; componentes y funciones; si solo funciona como VERI*FACTU (S/N); si sirve a varios obligados (S/N); tipos de firma; razón social, NIF y dirección del productor; la mención de que cumple el art. 29.2.j LGT, el RD 1007/2023 y la Orden HAC/1177/2024; fecha y lugar. Tiene que verse en el programa en cada versión, se entrega al cliente y se conserva. | RD 1007/2023, art. 13; AEAT, «Ejemplos de declaraciones responsables» (16/06/2025), ejemplo 1 |

**Para la declaración de Sumied** valen el ejemplo 1 de la AEAT y estos valores:
`TipoUsoPosibleSoloVerifactu = S` y `TipoUsoPosibleMultiOT = S`, porque Sumied sirve
a varios obligados. Por ser solo VERI*FACTU, no lleva firma de los registros: se
consideran firmados al enviarlos con certificado. El código identificador
(`IdSistemaInformatico`) son **dos caracteres**, letra mayúscula sin Ñ o cifra
(Validaciones §3.1.5). **Lo elige Julio.**

## 3 · Todo lo que emite facturas hoy

Medido el 25/10 en producción, solo leyendo y por cuenta (regla 9; la plantilla
excluida).

| Qué | Dónde | Hoy en Foodint | ¿Pasa por Verifactu? |
|---|---|---|---|
| **Factura a mano** (serie F-) y su rectificativa | `conta_venta_emitir` y `conta_venta_corregir` | 0 emitidas | **Sí**, F1 y su R. |
| **Cierre del día** (factura resumen por plataforma y local) | `conta_cierre_validar` | 85 en octubre (series GLV-CAM, UBR-FLO…) + 5 del 24/10 en GLV, JUS y UBR | **Pregunta para el asesor** (abajo). |
| **Traídas de Diez** e histórico de cierres | `conta_v01_historico_traidos` y `conta_v01_historico_cierres` | 1.196 (serie DIEZ, ene–sep) | **No**: anteriores a pasar a real. «No se envía». |
| Recurrentes | — | No existen | — |
| API | — | Ninguna función crea facturas | — |
| **TPV de Folvy** (`src/modules/pos`) | Comandas y cobros (`posSaleService`) | Parado; no numera facturas | **Sí, cuando se retome**: F2 por cada tique, por el mismo motor. |
| **Shop** | `src/modules/shop` | No emite facturas | Si un día las emite, por el mismo motor. |
| **Tique de bolsa impreso** («Factura Simplificada») | `printWorker.ts`, `ticketImage.ts` y `fiscal_for_print` | **4.078 en 30 días** (25/09–25/10): **3.012** de Last.app con su número (`raw_tab.bills[0].number`), **1.047** de HubRise (plataformas) **sin número fiscal** (sale la referencia del pedido) y 19 sin canal | **Pregunta para el asesor** (abajo). Es lo más urgente. |

### Preguntas para el asesor de Julio (no las decido yo)

1. **Los tiques de bolsa que imprime Folvy pone «Factura Simplificada».**
   - En los pedidos de **Last.app**, el número es el de Last: ¿quién los expide, Last
     (y entonces Last es el sistema que tiene que cumplir) o Folvy al imprimirlos?
   - En los de **plataformas** (HubRise: Glovo, Uber Eats y Just Eat), se imprime
     «Factura Simplificada» **sin número fiscal**. ¿Quién expide la simplificada al
     cliente final? ¿La plataforma, el local o nadie? ¿El tique de Folvy tiene que
     decir «Factura Simplificada»?
2. **El cierre del día** (una factura por plataforma y local con las ventas del día):
   ¿es una **factura recapitulativa** de esos tiques (art. 13 del RD 1619/2012) o una
   factura completa a la plataforma? Si es recapitulativa, la AEAT dice que los tiques
   se envían igual. Entonces hace falta saber quién expide cada tique (pregunta 1),
   y quizá la factura resumen no se envíe como alta nueva.
3. **Un servicio a una empresa de fuera de la UE** (el caso del tablero 27): ¿va como
   **no sujeto por reglas de localización** (calificación **N2**) y no como
   exportación exenta (E2)? Una mercancía que sale de España iría como E2 con la clave
   02. La maqueta usa eso.
4. **Las series por plataforma y local** (GLV-CAM, UBR-FLO…) y la serie nueva del día
   que se pasa a real: ¿se mantienen así o se juntan?

## 4 · Los errores de la AEAT: qué puede comprobar Sumied antes de emitir

La lista oficial de códigos no la he podido bajar (§0): está en `errores.properties`.
Las **reglas** que dan esos códigos sí están en el documento oficial «Validaciones y
errores» v1.2.2, y casi todas se pueden comprobar en local. Por grupos:

| Regla de la AEAT (v1.2.2, §3.1.3) | ¿Se comprueba en local? | En palabras de la calle |
|---|---|---|
| Fecha de expedición no futura y no anterior al 28/10/2024 | Sí | «La fecha no puede ser de mañana». |
| `NumSerieFactura`: ASCII 32–126, sin `" ' < > =`, como mucho 60 caracteres | Sí, nuestras series lo cumplen | — |
| F1, F3 y R1–R4 **tienen que llevar destinatario**; F2 y R5 no pueden llevarlo (el ejemplo es el error 1189) | Sí | «Falta el cliente: una factura completa lo necesita». |
| Destinatario: NIF español válido, o `IDOtro` con tipo y país; NIF-IVA con la estructura de su país (nota 1) | Formato: sí. Que esté censado: no, solo la AEAT (si no lo está, lo acepta «con errores»; tipo 07) | «El NIF no tiene el formato de un NIF». |
| Tipo de IVA (S1): solo 0, 2, 4, 5, 7,5, 10 o 21, con sus fechas | Sí | «Ese tipo de IVA no existe en España». |
| Recargo de equivalencia que case con su tipo | Sí | — |
| S2 (inversión del sujeto pasivo): tipo 0 y cuota 0; solo F1, F3 y R1–R4 | Sí | — |
| N1 y N2 (no sujeta): sin tipo ni cuota | Sí | — |
| Exenta: causa de la lista L10 (E1–E6); E2 y E3 no con la clave 01 | Sí | «Dime por qué va sin IVA». |
| **Clave de régimen obligatoria con IVA** y de la lista L8A (el ejemplo es el error 1245, el de Sage) | Sí | «Es un cliente de Suiza: dime qué le has vendido» (tablero 27). |
| Clave 02 (exportación): solo exenta | Sí | — |
| Cuota igual a base × tipo, ±10 € y con el mismo signo | Sí | — |
| Cuota total e importe total iguales a la suma del desglose, ±10 € (si no, se acepta «con errores») | Sí | — |
| Simplificada (F2): no más de 3.000 € (±10 €) | Sí | «Un tique no puede pasar de 3.000 €: haz una factura». |
| Rectificativa: `TipoRectificativa` obligatorio en R1–R5; `ImporteRectificacion` si va por sustitución | Sí | — |
| Huella: 64 caracteres hexadecimales en mayúsculas, y como la calcula la AEAT (si no, «con errores») | Sí, con los ejemplos oficiales | — |
| Fecha y hora de generación no posterior a la de la AEAT | Sí: reloj de la base, con huso de Madrid | — |
| Duplicado (ya existe un alta de esa factura) | Sí: la clave es única en Sumied | — |
| Que el NIF del destinatario esté **censado** | **No** | Se dice cuando responde Hacienda: «Hacienda no encuentra este NIF». |
| Que el NIF del emisor sea el del certificado o el del apoderamiento | Solo en parte (se compara con el certificado) | — |

**Lo que haría la E1:** bajar `errores.properties` desde staging, guardarlo en el
repositorio con su fecha, y que una prueba compare cada código con su regla local y
su frase. Ningún código sin frase, y ninguna frase sin código.

## 5 · Lo que queda abierto y cómo lo propongo

- **El certificado de pruebas.** Que no me lo pase por el chat ni por el repositorio.
  Propongo dos secretos en el proyecto de **staging** de Supabase (Edge Functions ›
  Secrets), puestos por Julio desde el panel:
  - `AEAT_PRUEBAS_P12_B64`: el `.p12` en base64;
  - `AEAT_PRUEBAS_P12_CLAVE`: su contraseña.

  La función de envío los lee y nunca los escribe en el registro. Para los
  certificados de los clientes (en real), cifrado en la base con Vault, una fila por
  empresa con la fecha de caducidad, y el aviso 30 días antes.
- **El riesgo técnico mayor.** El servicio de la AEAT pide **TLS con certificado de
  cliente**. Antes de construir la cola, hay que probar que una función de Supabase
  puede hacerlo (`Deno.createHttpClient` con certificado y clave). Si no puede, el
  envío va en un servicio pequeño aparte. Es lo primero de la E1, y si falla lo digo
  antes de seguir.
- **Los puntos de acceso del servicio** (alta y anulación, consulta) salen del WSDL,
  que se baja en el mismo paso. Con certificado de sello hay otro dominio de pruebas,
  que no hace falta.
- **El código identificador del sistema** (2 caracteres) y el nombre del sistema para
  la declaración responsable: los elige Julio.
- **Las cuatro preguntas del §3** son para el asesor. La E1 se puede construir sin sus
  respuestas, para la factura a mano y el cierre del día en pruebas. Pero el
  interruptor no debería pasar a «real» en Foodint hasta tenerlas.

## Fuentes

- RD 1007/2023, consolidado: <https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840> (art. 8, 10, 11, 13 y 16; disposición final cuarta).
- RDL 15/2025, de 2 de diciembre (BOE de 3/12/2025), art. 3: <https://www.boe.es/boe/dias/2025/12/03/pdfs/BOE-A-2025-24446.pdf>.
- Orden HAC/1177/2024, consolidada: <https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138> (art. 8, 13, 16, 17, 20 y 21; anexo).
- Orden HAC/1028/2026 (factura electrónica entre empresas): <https://www.boe.es/boe/dias/2026/10/05/pdfs/BOE-A-2026-20587.pdf>.
- AEAT, portal de desarrolladores: <https://www.agenciatributaria.es/AEAT.desarrolladores/Desarrolladores/_menu_/Documentacion/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU.html>
  - Huella v0.1.2 (27/08/2024): `…/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf`
  - QR v0.5.0 (10/12/2025): `…/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf`
  - Servicios web v1.0.3: `…/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf`
  - Validaciones y errores v1.2.2: `…/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf`
  - Aclaraciones a desarrolladores v1.3 (4/12/2025): `…/VERI-FACTU/FAQs-Desarrolladores.pdf`
  - Ejemplos de declaraciones responsables (16/06/2025): `…/VERI-FACTU/EjemplosDeclaracionResponsable.pdf`
- AEAT, preguntas frecuentes de la sede: «Registros de facturación: alta» y «Procedimientos de facturación» (tipos F2, F3 y R5), «Cuestiones generales: ámbitos de aplicación» (recapitulativas) y «Colaboración social» (`sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/…`).
