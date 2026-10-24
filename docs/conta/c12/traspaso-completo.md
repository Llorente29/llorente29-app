# C12 · El traspaso completo: qué va por Excel, qué va por la API y por qué

> Propuesta (24/10, respuesta 2). No está construida: se construye cuando Julio
> diga que sí y cuando sepamos si Diez guarda copia del PDF (prueba de la URL
> corta, abajo).

## Lo que ya sabemos

| | Medido | Dónde |
|---|---|---|
| Emitidas por Excel con «Url documento» | **Entran con su PDF** las tres: normal, dos tipos de IVA y rectificativa | C0009, Julio, 24/10 |
| Recibidas por Excel con «Url documento» | Por probar: `prueba-c12-recibidas-url.xlsx` | C0009, Julio |
| Asientos por Excel | La configuración de Julio **no trae campo de documento** | Julio, 24/10 |
| PDF por la API (`facturas/upload`, `apuntes/upload`) | 500 «The specified container does not exist»: el almacén de documentos de la base no existe en el servidor de Diez | runs 8, 10 y 40091895961 |
| Asientos por la API (`apuntes/add`) | Funcionan: banco, manual y su contraasiento en la C0009; se busca antes de escribir, no se duplica | C07 |
| Lo que Diez tiene, por la API (`api/apuntes` del mes) | Trae todas las líneas, también las de las facturas importadas | run 40098732223 |

## La propuesta

**1. Emitidas y recibidas, por Excel, con su PDF por URL.**
- Al confirmar el traspaso, Sumied prepara **dos Excel del mes** (emitidas y
  recibidas) con la configuración de Julio y la columna «Url documento».
- El número de cada factura es el de Sumied: el de la factura resumen del
  cierre del día (serie del canal, desde el #321) o el de la factura a mano. Así,
  el PDF, Sumied y Diez dicen lo mismo. Hoy la API calcula otro (`UBR-…`): con el
  Excel desaparece esa diferencia.
- Julio los importa en Diez (Importaciones › Importación desde fichero ›
  Facturas, dos veces) y pulsa en Sumied «Ya lo he importado».
- Sumied lee las facturas del mes en Diez (`api/facturas`), las enlaza una a una
  con las suyas por número y fecha, y dice cuáles faltan, si falta alguna.
- Las anulaciones de facturas que ya estaban en Diez van como rectificativa en
  el mismo Excel, como la R4 de la prueba.

*Por qué Excel:* es la única forma de que el PDF llegue a Diez (la API no puede
guardar documentos en esa base). *El coste:* un paso a mano de Julio cada mes,
dos importaciones, y que Diez no confirma lo importado: lo confirma Sumied al
leerlo de vuelta.

**2. Banco, asientos a mano y liquidaciones, por la API (`apuntes/add`), sin PDF.**
- Van solos al pulsar «Traspasar», en tandas, como está hecho en el #322.
- Sin PDF, que es lo normal en estos asientos (la importación de asientos de
  Diez no trae documento, y la API tampoco puede guardarlo).

*Por qué la API y no Excel:*
- ya funciona y está probada en la C0009 (C07);
- cada asiento dice al momento si ha llegado y por qué no;
- antes de escribir se mira si ya está, así que repetir no duplica;
- y no añade otro paso a mano.

Por Excel serían una tercera importación sin confirmación y sin nada que ganar,
porque tampoco llevaría PDF.

**3. Después, el cuadre (como está en el #322).** Los apuntes del mes en Diez
contra lo que Sumied dice que tiene que estar allí. Si cuadra, se cierra el mes
(de acuerdo, Julio, 24/10).

## La pantalla, con esto

1. «Traspasar octubre a Diez» → revisar y confirmar (como hoy).
2. Se mandan banco, asientos a mano y liquidaciones (API) y se preparan los dos
   Excel: «Descargar emitidas» y «Descargar recibidas», con dos líneas de cómo
   importarlos.
3. «Ya lo he importado» → Sumied comprueba que están todas y cuadra el mes.

## La URL del PDF

**Si Diez guarda copia** (la prueba de la URL corta lo dice): URL firmada de
Supabase que caduca a las **24 horas** del Excel. Da tiempo a importar y, después,
no sirve para nada.

**Si Diez solo guarda el enlace**, la URL tiene que durar siempre. Propuesta de
cómo protegerla:
- **No** una URL firmada de diez años: no se puede retirar una sola, solo
  todas a la vez (cambiando la clave del proyecto).
- **Una dirección propia por documento**, `https://…/functions/v1/conta-pdf/<llave>`:
  - la llave es aleatoria, de 128 bits, una por documento;
  - no lleva ni cuenta, ni empresa, ni número de factura;
  - se guarda en la base junto al documento.
- **Una función** sirve el PDF solo si la llave existe y no está retirada:
  - el PDF va con `Cache-Control: private` y `X-Robots-Tag: noindex`;
  - cada acceso queda apuntado (cuándo y desde dónde);
  - tiene un tope de peticiones por llave.
- **Se puede retirar** una llave (si se anula la factura, o si alguien la filtra),
  o todas las de una empresa. Al retirarla, Diez deja de ver ese PDF: es lo que se
  quiere en esos casos.
- **Solo hay llave** para un documento que ha ido en un traspaso.

## La prueba de la URL corta

`diez-prueba-c0009.yml` con la etiqueta `[prueba-c0009:url-corta]` (a mano,
«Run workflow»):
- sube a **staging** un PDF inventado (`PRB-C12-U<n>`);
- lo firma para **10 minutos**, comprueba que contesta y deja el Excel en el
  artefacto «url-corta-excel»;
- un segundo trabajo, a los 11 minutos, comprueba que la URL **ya no
  contesta**.

Julio importa el Excel en la C0009 antes de la hora que dice el run
(`caduca_hhmm_madrid`) y, media hora después, abre el PDF de esa factura en
Diez:
- si se ve, Diez guardó copia;
- si no, solo guarda el enlace.
