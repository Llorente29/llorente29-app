# V03 · E1 · Paso 1: el riesgo técnico (la sonda en staging)

*25/10 · solo staging-conta (`oseymswjlzplqoxrfjzi`) · solo el entorno de pruebas de la AEAT.*

## Lo que ya está contestado

- **Una función de Supabase hace TLS con certificado de cliente.** Lo midió la
  prueba del I01, el 17/10 (`docs/conta/i01/I01_prueba_mtls.md`), contra badssl:
  `Deno.createHttpClient({ cert, key })` funciona, y hace falta un tiempo límite
  (lo tiene `_shared/certificados/mtls.ts`). Esta sonda reutiliza esas piezas
  (`leerP12.ts` y `llamarConCertificado`): no se ha escrito otra forma de hacerlo.
- **Desde staging se llega al entorno de pruebas de la AEAT.**
  [Run 40234787308](https://github.com/Llorente29/llorente29-app/actions/runs/40234787308)
  (21:17–21:19 UTC):
  - la sonda se desplegó y corrió en Supabase, con `node-forge` dentro (341 kB);
  - bajó de `prewww2.aeat.es` el **WSDL** (8.780 bytes, 602 ms) y la **lista
    oficial de errores** (25.232 bytes, 295 ms), y los guardó en
    `docs/conta/v03/aeat/`, con su fecha y su huella;
  - después borró la función y su token: no queda ninguno de los dos.
- **La lista oficial tiene 247 códigos:** 44 rechazan el envío entero, 193
  rechazan el registro (o el envío, si el error es de la cabecera) y 10 lo
  aceptan con errores que hay que subsanar.
- **Los puntos de acceso**, según el WSDL:

  | | Pruebas | Real |
  |---|---|---|
  | Con certificado (el nuestro) | `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` | `https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
  | Con certificado de sello | `https://prewww10.aeat.es/…/VerifactuSOAP` | `https://www10.agenciatributaria.gob.es/…/VerifactuSOAP` |

## Lo que falta

- **La conexión con certificado contra la AEAT.** La sonda respondió «Faltan los
  secretos AEAT_PRUEBAS_P12_B64 y AEAT_PRUEBAS_P12_CLAVE en staging». En cuanto
  estén, se relanza (un commit cuyo mensaje empiece por `[verifactu-sonda]`).
  Hará **una consulta** de los registros del NIF del certificado en el mes en
  curso, sin dar de alta nada. Lo que se mide:
  1. que la AEAT acepta la cadena del certificado (FNMT);
  2. que contesta un SOAP de consulta y no un error de certificado (4108, 4112);
  3. que ni el certificado ni la clave aparecen en los logs.
- Si falla el punto 1 o el 2, **se para** y se propone la alternativa antes de
  construirla, como dice la respuesta 1.
