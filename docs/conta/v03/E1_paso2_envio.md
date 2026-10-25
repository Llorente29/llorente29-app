# V03 · E1 · Paso 2: el motor en la base y el envío a Hacienda

*25/10 · rama `conta/v03-e1`.*

## Lo que está hecho y probado

- **El motor en la base** (2140 añade, 2141 engancha la emisión, 2249 el cron
  y el aviso del certificado). Ensayo de staging
  [572](https://github.com/Llorente29/llorente29-app/actions/runs/40243407628)
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
  6 · sin nada de real, despertar no llama
  6 · A en real: su primera factura (V03R) abre la cadena de real
  6 · el aviso del certificado sale (1); con real pendiente despertar llamaría: «Falta cron_secret en el Vault: no se puede despertar a conta-verifactu.»
  ```

  Y la guarda de la vuelta atrás de la 2140 se niega a deshacer con registros
  de real ([571](https://github.com/Llorente29/llorente29-app/actions/runs/40242477242)):
  «Hay registros de Verifactu en real: no se deshace la 2140.»

  La 2140 y la 2249 solo añaden y ya están de verdad en staging (W05; staging
  no tiene cron_secret, así que allí no hay cron); la 2141, no.
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

## Lo que decidió Julio (respuesta 2, 26/10)

1. **Ventas sin IVA (exentas y no sujetas): a la E2.** La V01 tiene que dejar
   guardar líneas exentas o no sujetas con su causa (exportación, art. 21; no
   sujeta por localización, N2; las del art. 20), su asiento no puede fallar
   con una 477 a cero, y la regla «fuera de la UE: dime qué le has vendido» se
   tiene que alcanzar emitiendo de verdad, con su e2e. Hoy, en la E1, está
   probada en la comprobación previa.
2. **El certificado sin una persona delante: hecho en la E1 (2341).** La
   empresa autoriza una vez, escribiendo AUTORIZO, «usar mi certificado solo
   para enviar Verifactu»: quien puede presentar con ese certificado, que tiene
   que ser del NIF de la empresa. Queda quién y cuándo (`verifactu_autorizacion`,
   no se edita), se retira cuando se quiera (quién, cuándo y por qué) y cada
   envío apunta con qué autorización salió (`verifactu_envio.autorizacion_id`).
   La función de envío lo abre con `verifactu_cert_abrir`: solo con la clave de
   servicio, solo en real, solo por la vía del certificado y con la
   autorización y el certificado en vigor. Presentar impuestos sigue pidiendo
   confirmación cada vez (no se ha tocado nada del I01). La vía por defecto es
   la de colaborador social, preparada y apagada.
3. **El productor de la declaración responsable: un dato que se rellena**
   (`VERIFACTU_SIF_NOMBRE` y `VERIFACTU_SIF_NIF`), sin nombres en el código. En
   pruebas, si no está, el titular del certificado de pruebas; en real, sin él
   la función no envía y dice por qué. Se decide antes de pasar a real.

Sigue en pie: **en pruebas, la empresa que emite lleva el NIF del
certificado** (la AEAT solo acepta registros del obligado o de quien le
representa). La prepara la función en su propia cuenta de staging; el NIF no se
escribe en el repositorio.

## Lo que falta en la E1

- La conexión con certificado: esperando los secretos de staging.
- Las 25 facturas contra la AEAT de pruebas (`pruebasAeat.ts`: 24 altas con
  una R4 y una a Suiza, y una anulación) y su workflow
  (`verifactu-pruebas-staging.yml`): hechos y sin lanzar, esperando el
  certificado.
- «No se envía» en las pantallas (es de la E2: la vista ya lo da).
- Por confirmar con la primera respuesta real: el texto exacto de un Fault (el
  lector busca «Codigo[4xxx]» y, si no, cualquier 4xxx).
