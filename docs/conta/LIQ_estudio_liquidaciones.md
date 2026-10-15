# Estudio · Traer solas las liquidaciones de Uber Eats, Glovo y Just Eat

> Solo leer y proponer: no se ha construido nada. 15/10/2026.
>
> **De dónde sale cada cosa:**
> - **Producción**, en solo lectura y con `account_id` de Foodint (regla 9).
> - **El buzón de Julio** conectado (Gmail), del que solo se ha mirado quién envía cada correo, cuándo, el asunto y qué trae: tipo de adjunto, enlace o tabla en el cuerpo. Aquí no va ningún importe, ni nombres de marcas o locales, ni direcciones de personas.
> - **Las fuentes públicas de cada plataforma**, con su enlace. Desde el contenedor no se abrían sus dominios (DNS o 403 del proxy), así que lo citado sale de los extractos del buscador. Va marcado «no confirmado» cuando no se pudo leer la página entera.

## 1. Lo que hay hoy

### 1.1 `channel_settlement` en Foodint

| Origen (`source`) | Plataforma | Filas | Grano | Primera / última liquidación | Cargadas el | Por revisar | Con asiento | Cobradas |
|---|---|---|---|---|---|---|---|---|
| `import_csv_glovo` | Glovo | 96 | quincena | 15/04 – 30/06 | 12/07 | 39 | 0 | 0 |
| `import_csv_je` | Just Eat | 53 | quincena | 15/04 – 30/06 | 12/07 | 53 | 0 | 0 |
| `import_csv_uber` | Uber Eats | 50 | mes por local | 30/04 – 30/06 | 12/07 | 0 | 0 | 0 |
| `ctb_sales_detail` | las tres (marcas cedidas, `flow_type = licensed`) | 48 | mes | junio | 12/07 | 0 | 0 | 0 |

- **Ni una fila después del 30/06**, y todo entró el mismo día, el 12/07.
- **`raw` está vacío en las 247 filas**: del fichero original no se guardó nada. Las columnas que siguen salen del importador.

### 1.2 Desde dónde y con qué columnas

El importador es `scripts/import-channel-settlements.mjs`. El de la ficha de la plataforma (C03), `src/modules/conta/lib/lectorLiquidaciones.ts`, lee lo mismo con las mismas `import_key`.

- **El formato**: «;», decimales con coma y fechas dd/mm/aaaa.
- **Los ficheros** se llaman `folvy_glovo.csv`, `folvy_justeat.csv` y `folvy_uber.csv`, y sus columnas tienen nombres de mano (`venta_neta`, `base_10`…). **No son lo que exporta ninguna plataforma**: alguien los preparó a partir de sus informes.

| Fichero | Columnas que se leen | Lo que falta para casar en Bancos |
|---|---|---|
| Glovo | `numero`, `local`, `fecha`, `venta_neta`, `base_10`, `iva_10`, `comision_base`, `entrega`, `promo_producto`, `promo_flash`, `oferta_flash`, `tasa_acceso`, `glovo_prime`, `tarifa_recurrente`, `coste_incidencias`, `devol_incidencias`, `liquidacion`, `deuda_acumulada` | nada: trae el neto (`liquidacion`) y la deuda |
| Just Eat | `numero`, `local`, `fecha`, `venta_neta`, `base_10`, `iva_10` | **el neto**, la comisión y la fecha de pago |
| Uber Eats | `mes`, `local`, `pedidos`, `venta_con_iva`, `base_10`, `iva_10` | **el neto** y el periodo de pago: es un mes por local, y Uber paga cada semana |

**Lo que necesita Bancos.** `bancosNucleo.ts` solo propone casar una liquidación con:
- `net_payout` no nulo, su canal y una fecha;
- sin `collected_on` todavía.

Por eso, aunque hubiera ficheros nuevos, **Uber y Just Eat no casarían nunca con el formato de antes**: no traen neto.

### 1.3 Lo que espera en el banco

Bancos tiene extractos desde octubre. Desde entonces hay 4 cobros de plataforma y ninguno casado:
- Glovo: 1, propuesto;
- Uber Eats: 3, por aclarar;
- Just Eat: 0 con ese nombre en el concepto. Puede llevar otro texto; está por ver.

### 1.4 La entrada por correo que ya existe (`conta-facturas-entrada`, D01)

- **Cómo funciona**: un webhook de Resend (`email.received`) para `facturas-<empresa>@entrada.folvy.app`, con firma de svix.
  - Baja los adjuntos por la API de Resend y los guarda en `receipt-uploads`.
  - Los lee con `ocr-albaran` en modo factura.
  - No repite nada: se fija en `email_id` y en el sha256 de cada adjunto.
- **Qué tiene hoy en producción**:
  - `company_inbound_address.kind` solo admite `'facturas'`: es un `CHECK`.
  - `inbound_email_log` tiene **0 filas**, porque el dominio aún no está dado de alta en Resend.
  - Solo toma **PDF y fotos**. Un XLSX o un CSV adjunto se apunta en `dejados` («no es un PDF ni una foto») y no se lee.
  - El cuerpo del correo (`text`/`html`) ya llega a la función, pero hoy solo se usa para buscar enlaces de descarga.

**¿Se puede reutilizar? Sí, casi entera.** La firma, los adjuntos, el bucket, el registro, el «no dos veces» y la pantalla de lo recibido valen igual. Hay que añadir:
1. **Otra clase de dirección**: `liquidaciones-<empresa>@…`. Es ampliar el `CHECK` de `kind` (cambia en caliente, declarado y con su prueba) y que `recibirCorreo` reparta por `kind`.
2. **Admitir XLSX y CSV**, solo en la clase de liquidaciones.
3. **Un lector por plataforma**, que reconozca el correo por su remitente y su asunto. Sale de una fila de `channel_settlement` con `source` nuevo y la misma `import_key`, para que lo que ya entró no se duplique.
4. **El PDF de factura de Glovo es además una factura recibida** (la comisión, con IVA). Puede seguir el camino de D01 a la vez.

## 2. Lo que ofrece cada plataforma

### 2.1 Glovo

- **API**: la Partners API es para el TPV (tiendas, carta, pedidos). No tiene facturas ni liquidaciones: **no hay API financiera documentada**. https://api-docs.glovoapp.com/partners/index.html
- **Correo**, medido en el buzón:
  - Remitente `partners@glovoapp.com`, asunto «Glovoapp Spain Platform S.L. - Factura <número>».
  - Llega uno por factura y quincena, a los 2–5 días de cerrar el periodo: el 16–30/09 llegó el 05/10; el 01–15/09, el 17/09.
  - **Trae dos adjuntos: el PDF de la factura y un XLSX** («invoice-<número>.XLSX»).
  - Desde el 01/07 han llegado 15. Uno de ellos fue una ráfaga de 7 el 11/07 con periodo «01.06–01.06». Falta el de la quincena 16–31/07.
- **Portal**: el Manager Portal guarda todas las facturas. https://glovoapp.com/docs/es/legal/terms-partners/
- **Pago**: quincenal según las condiciones españolas. Glovo cobra las ventas y paga el «Importe a pagar»: las ventas menos su tarifa (con IVA) y menos lo que se le deba. Mismo enlace.
- **Lo que no se sabe**: las columnas del XLSX. Hay que abrir uno real; el `folvy_glovo.csv` de antes da una pista de lo que debería traer.

### 2.2 Uber Eats

- **API**: existe la Reporting API (`POST /v1/eats/report`, asíncrona, CSV).
  - Entre sus informes están «Payment Details» (hasta 32 días) y «Finance Summary». https://developer.uber.com/docs/eats/guides/reporting · https://developer.uber.com/docs/eats/references/api/v1/post-eats-report
  - **Es para integradores aprobados**, con autorización de cada comerciante. Que un restaurante la pida para sí mismo no está documentado. https://developer.uber.com/docs/eats/guides/going-live
  - El scope (`eats.report`) y la entrega por webhook: **no confirmados**.
- **Correo**, medido en el buzón: hay dos.
  1. **«Resumen de pagos de Uber Eats correspondiente a <tienda> del <periodo>»**, de `noreply@uber.com`.
     - Uno por tienda y semana (lunes a domingo). Llega el domingo hacia las 22:30 UTC.
     - **Sin adjunto, y con todo en el cuerpo**: periodo de pago, ID de referencia del pago, pedidos, pago neto, el resumen diario (ventas, impuesto, ventas con impuesto), ganancias, tasas de Uber, marketing (promociones, anuncios), contracargos y ajustes.
     - Si una semana no llega al mínimo, el periodo se alarga: hay resúmenes de 2, 3 y hasta 13 semanas.
     - Desde el 01/07 han llegado 33. No hay ninguno de julio antes del 02/08.
  2. **«Your Uber Eats report is ready to download»**, el aviso de un informe pedido en el portal («Detalles del pago»). Trae un **enlace que caduca a las 48 h** y no adjunto. Uber dejó de adjuntar el Payment Details por seguridad. https://help.uber.com/en/merchants-and-restaurants/article/download-comprehensive-payment-details-reports?nodeId=9b436c1f-485a-46d9-9361-12fec294c368
- **Portal**: Informes → Payment Details en CSV (hasta 31 días), con la opción de fechas «Pay Period» para que cuadre con los pagos. https://help.uber.com/en/merchants-and-restaurants/article/understanding-customer-and-order-data-in-uber-eats-manager?nodeId=49fc4e14-cd2e-4224-99e5-3b922cf78dc8
- **Pago**: semanal. El saldo negativo pasa a la semana siguiente. https://merchants.ubereats.com/us/en/faq/ (no hay página de España).

### 2.3 Just Eat

- **API**: solo JET Connect, la integración con el TPV para pedidos y carta. **No hay API de facturas ni liquidaciones documentada.** https://developers.just-eat.com/docs/pos-how-pos-integration-works
- **Correo**:
  - En Irlanda y Reino Unido la factura se manda por correo cada semana, y está en Partner Hub → Management → Invoices. https://partnerinfo.just-eat.ie/en/your-business/partner-invoicing
  - **Para España no está documentado**.
  - **En el buzón de Julio no hay ninguna factura de Just Eat en los dos últimos años**: deben de ir a otra dirección, la que tenga cada local en Partner Hub.
- **Pago**: quincenal según una página antigua de socios de España; hoy no se ha podido confirmar. http://partnerblog.just-eat.es/noticias/emision-de-facturas-a-usuarios/

### 2.4 Una cuarta fuente: las marcas cedidas

- Lo de `ctb_sales_detail` (`flow_type = licensed`) llega por un correo mensual del licenciador: «Cierre del mes de <mes>», con la autofactura y su detalle adjuntos.
- Llegan 1–3 al mes desde 2023, y Julio los reenvía a otra cuenta.
- Tampoco hay nada cargado después de junio.

## 3. Propuesta por plataforma

Una sola dirección por empresa, **`liquidaciones-<empresa>@entrada.folvy.app`**, y en ella un lector por remitente. Lo que Julio hace, una vez:

| Plataforma | Qué se lee | Lo que Julio hace una vez | Qué gana Bancos |
|---|---|---|---|
| **Glovo** | El XLSX adjunto (cada quincena), y el PDF como factura recibida | En Gmail, un filtro `from:partners@glovoapp.com` que **reenvía** a la dirección de liquidaciones. Mejor aún, si el Manager Portal deja cambiar el correo de facturación, poner esa dirección directamente | La quincena con su neto y la deuda, como antes, pero sola |
| **Uber Eats** | **El cuerpo del «Resumen de pagos»**, uno por tienda y semana | Un filtro `from:noreply@uber.com subject:"Resumen de pagos"` que reenvía. Y preguntar a su TPV (Last) si tiene la Reporting API y la puede abrir para sus tiendas, por si se quiere el detalle por pedido | **El neto por tienda y semana**, con el ID de referencia del pago: lo que el CSV de antes no traía |
| **Just Eat** | Lo que traiga su correo, cuando se sepa | Ver en Partner Hub, local por local, a qué correo van las facturas, y poner ahí la dirección de liquidaciones. Pedir por escrito al account manager si el correo trae adjunto (PDF / CSV) o solo un enlace, y cada cuánto pagan hoy | Si trae adjunto con el neto, lo mismo que Glovo. Si solo trae enlace, el correo sirve de aviso y la subida sigue siendo a mano |
| **Marcas cedidas** | Los adjuntos del «Cierre del mes» | Un filtro del remitente del licenciador que reenvía | El mes cedido sin esperar al CSV |

**Dos cosas que cuesta saber antes:**
- **Gmail confirma un reenvío con un código** que manda a la dirección nueva. Ese correo llegará a nuestro buzón, así que la pantalla tiene que enseñarlo, con el código, y no tragárselo como «no es una liquidación».
- **Antes de cualquier lector hace falta un ejemplar real de cada uno**: el XLSX de Glovo, el cuerpo del resumen de Uber y lo que mande Just Eat. Van en `docs/conta/fuentes`, anonimizados, o se describen con la misma forma e inventados (RGPD y «nada real en el repositorio»). El lector se escribe contra ese ejemplar y lee por cabecera, no por posición: Uber avisa de que añade columnas.

**Lo que no se propone:**
- **Entrar al portal con usuario y contraseña** para bajar los informes con un navegador automático. Se rompe sin avisar, nadie lo garantiza y obliga a guardar credenciales.
- **Leer el Gmail de Julio desde producción.** La entrada es la de D01, con su firma y su registro.

**Orden propuesto:**
1. Uber, porque el cuerpo del correo ya trae el neto y hoy no casa nada.
2. Glovo, porque es un XLSX adjunto: lo más sencillo.
3. Las cedidas.
4. Just Eat, cuando se sepa qué manda.

Antes de todo eso: dar de alta el dominio de entrada en Resend, que hoy tiene 0 correos.

## 4. La pantalla: lo que ha llegado y lo que falta

En **Bancos → Plataformas**, una rejilla por plataforma. Cada fila es un local (o una tienda de Uber) y cada columna un periodo de pago: quincena en Glovo y Just Eat, semana en Uber, mes en las cedidas.

Cada celda dice una sola cosa, con su nombre:

| Estado | Cuándo |
|---|---|
| **Cobrada** (verde) | La liquidación ha llegado y está casada con su cobro del banco |
| **Llegó · sin cobrar** | La liquidación está, y su cobro no ha aparecido todavía en el banco |
| **Llegó sin neto** | El correo ha llegado, pero no trae el neto, y no se puede casar: dice por qué |
| **Falta** (ámbar) | El periodo ya debería haber llegado (su retraso habitual: 5 días en Glovo, 1 en Uber) y no ha llegado nada |
| **Por llegar** | El periodo aún no ha cerrado, o está dentro de su retraso |

- **Regla 7: no se esconde ninguna celda.** El ámbar ordena: lo que falta va arriba, con un contador «3 periodos sin liquidación».
- **Pulsar una celda** abre el correo de origen, sus adjuntos, lo leído (ventas, comisión, neto) y el cobro con el que casa, o por qué no casa.
- **Debajo, «Lo que ha llegado al buzón»**: cada correo, de quién, cuándo y qué se hizo con él («leída: 1 liquidación», «no es una liquidación: queda apuntado», «es la confirmación de un reenvío de Gmail: el código es …»).
- **Y «Subir a mano»**, la subida de ahora (C03), para lo que no llegue solo.

## 5. Lo que queda por saber, y quién lo sabe

1. **Las columnas del XLSX de Glovo.** Lo sabe un correo real: abrir uno.
2. **Si Uber paga por tienda o todo junto.** Hay 3 cobros de Uber en el banco desde octubre, y los resúmenes semanales son de 8 a 9 tiendas: puede ser un pago por grupo. El «ID de referencia del pago» del resumen debería decirlo.
3. **Adónde van las facturas de Just Eat y qué traen.** Lo saben Partner Hub y el account manager.
4. **Si Last tiene la Reporting API de Uber** para estas tiendas. Lo sabe Last.
5. **Si Just Eat paga hoy por quincena o por semana en España.** Lo sabe el account manager.
