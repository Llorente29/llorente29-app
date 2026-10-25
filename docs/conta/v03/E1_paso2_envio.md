# V03 · E1 · Paso 2: el motor en la base y el envío a Hacienda

*25/10 · rama `conta/v03-e1`.*

## Lo que está hecho y probado

- **El motor en la base** (2140 añade, 2141 engancha la emisión). Ensayo de
  staging [568](https://github.com/Llorente29/llorente29-app/actions/runs/40240640363)
  en verde, sus líneas tal cual:

  ```
  0 · los tres ejemplos oficiales dan su huella; conta_venta_emitir, la misma
  1 · apagado: emitir no escribe registro
  2 · F-2026/000002 y F-2026/000003: dos altas F1 encadenadas, con su huella, en la cola
  3a · Suiza con IVA: S1, IDOtro 04 con CH, encadenada
  4 · el registro no se edita
  3b · Suiza sin IVA y sin motivo: «Es un cliente de CH, fuera de la UE: dime qué le has vendido (un servicio a una empresa o mercancía que sale de España).»; con N2, nada que falte y el desglose N2 sin tipo
  3b · NIF mal: «El NIF del cliente (12345678A) no es un NIF español válido: revísalo en su ficha.», y la factura sigue en borrador
  3b · el contador no se ha movido (4)
  5 · las vueltas atrás: ni el disparador ni las tablas ni las funciones; conta_venta_emitir, la misma
  ```

  La 2140 solo añade y ya está de verdad en staging (W05); la 2141, no.
- **La concurrencia** (en el Postgres local): 20 emisiones a la vez dan una sola
  cadena (1 primero, 0 anteriores repetidos, horas crecientes); sin el cerrojo,
  la misma prueba da 9 «primeros» y 2 anteriores repetidos.
- **El mensaje** (`_shared/verifactu/xml.ts`) valida con `xmllint` contra los
  XSD oficiales que bajó la sonda (`docs/conta/v03/aeat/`), con los seis casos:
  primero, F1 encadenada, Suiza con `IDOtro` 04, N2, R4 y anulación. Y un
  elemento fuera de su sitio no valida.
- **La respuesta** (`respuesta.ts`): cada línea casada con su registro por
  operación, número y fecha; el 3000 (duplicado) vale lo que diga Hacienda que
  tiene; el envío entero rechazado (Fault) vuelve a la cola sin marcar las
  facturas. El ejemplo de la prueba valida contra `RespuestaSuministro.xsd`.
- **El QR en el PDF** (32 mm, nivel M, «QR tributario:» encima y «VERI\*FACTU»
  debajo; en pruebas, «PRUEBA» y una nota al pie). Lo pinta `guardarPdf` con la
  URL de su registro (`verifactu_factura_estado.url_qr`); sin registro, sin QR.
  Descodificado una vez con un lector de verdad (jsQR 1.4.0, fuera del
  repositorio, 25/10):

  ```
  URL:   https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B28000016&numserie=F-2026%2F000002%26X&fecha=25-10-2026&importe=121.00
  LEÍDO: https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B28000016&numserie=F-2026%2F000002%26X&fecha=25-10-2026&importe=121.00
  módulos: 45
  ```

  La prueba del repositorio lee del propio QR sus tres esquinas y los bits de
  formato (nivel M), y cae con un QR de nivel L.
- **La función** `conta-verifactu`: cerrada si no se pone `CONTA_VERIFACTU`;
  «pruebas» solo desde staging, «real» solo desde producción.

## Lo que queda abierto, para Julio

1. **La V01 no emite líneas exentas ni al 0 %.** `conta_venta_guardar` solo
   admite IVA general, reducido o superreducido, y el asiento de
   `conta_venta_emitir` no cuadra una 477 a 0. La regla «fuera de la UE: dime qué
   le has vendido» y la N2 están hechas y probadas en la comprobación previa,
   pero hoy no se llega a ellas emitiendo. Lo que sí se puede: un cliente de
   fuera de la UE **con IVA** (lo de un restaurante: el servicio se consume en
   España), que va S1 con `IDOtro` 04. No lo he tocado: es la V01.
2. **El envío en real con el certificado de la empresa.** El almacén del I01
   solo abre un certificado con la confirmación de una persona en cada uso
   (pensado para presentar un 303). Verifactu envía solo, cada pocos minutos.
   Hace falta decidir cómo se autoriza ese uso desatendido (por ejemplo: al
   pasar una empresa a real, quien puede presentar lo autoriza una vez, y se
   revoca al cambiar el certificado). Hasta entonces, lo de real vuelve a la
   cola diciendo por qué. No hay ningún registro en real: ninguna empresa lo está.
3. **Quién produce el sistema** (la declaración responsable): nombre y NIF que
   van en `SistemaInformatico`. Hoy salen del entorno (`VERIFACTU_SIF_NOMBRE`,
   `VERIFACTU_SIF_NIF`); en pruebas, el titular del certificado.
4. **En pruebas, la empresa que emite lleva el NIF del certificado** (el de
   Llorente29): la AEAT solo acepta registros del obligado o de quien le
   representa. Lo cojo del certificado al preparar las facturas de prueba; no
   se escribe en el repositorio.

## Lo que falta en la E1

- La conexión con certificado: esperando los secretos de staging.
- El cron que la despierta, y las ~25 facturas contra la AEAT de pruebas (con
  una rectificativa y una a un cliente de fuera de la UE).
- «No se envía» en las pantallas (es de la E2: la vista ya lo da).
- Por confirmar con la primera respuesta real: el texto exacto de un Fault (el
  lector busca «Codigo[4xxx]» y, si no, cualquier 4xxx).
