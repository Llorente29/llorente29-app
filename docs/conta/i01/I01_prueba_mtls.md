# I01 · Prueba mTLS: ¿una función de Supabase abre conexiones con certificado de cliente?

*17/10 · frente C · solo en staging-conta (`oseymswjlzplqoxrfjzi`).*

## Respuesta

**Sí.** Una función de Supabase abre la conexión con certificado de cliente
usando `Deno.createHttpClient({ cert, key })` y `fetch(url, { client })`.
Para la arquitectura, la custodia y la firma pueden vivir en una función de
Supabase. **No hace falta un servicio aparte.**

## Cómo se probó

> El script y el workflow de la prueba no están en `main`: se quedan en la rama
> `conta/i01-prueba-mtls`, que es de donde se lanzaron. A `main` solo va este informe.

- La función mínima está en `scripts/conta/i01/prueba-mtls/index.ts`. Solo
  puede llamar a `https://client.badssl.com/`. No toca la AEAT, ni `www1` ni
  `prewww1`.
- El workflow es `.github/workflows/prueba-mtls-staging.yml`. Antes de
  desplegar comprueba tres cosas: que el destino es el de staging y no el de
  producción, que la función apunta a badssl y que no lleva ningún dominio de
  la AEAT.
- El certificado de prueba es el público de badssl.com. El workflow lo
  descarga en el runner, lo enmascara en el log y lo sube como **secreto de la
  función** en base64. **No está en el repositorio.**
- Se llamó a la función cuatro veces: `con`, `sin`, `clave_rota` (la clave con
  un carácter cambiado) y otra vez `con`.
- Runs:
  - **39052213522** (17:05 UTC): se paró en la guarda antes de desplegar nada,
    porque el comentario «Nada de la AEAT» contaba como mención. Se cambió la
    guarda para que busque dominios y no la palabra.
  - **39052865448** (17:14–17:18 UTC): verde. De él salen las medidas de abajo.

## Las tres medidas

Medidas sobre los logs de staging (`function_logs` y `function_edge_logs`) del
run 39052865448.

**1. ¿Funciona con certificado y sin él?**

| modo | resultado | ms |
|---|---|---|
| `con` | **HTTP 200** | 252 |
| `sin` | **HTTP 400** | 108 |
| `clave_rota` | sin respuesta en unos 60 s (ver abajo) | — |
| `con` (otra vez) | **HTTP 200** | 147 |

**2. ¿Qué error da sin certificado?**

Ninguna excepción de TLS. La conexión se abre y `client.badssl.com` contesta
**HTTP 400**: la página de nginx que dice que no se ha enviado el certificado
SSL requerido. Para nuestro código, «sin certificado» es una respuesta HTTP
normal con un 400, no una excepción.

**3. ¿El certificado o la clave aparecen en algún log?**

**No.** Revisé los logs de 17:14 a 17:20 UTC: `function_logs` (9 filas),
`function_edge_logs` (3) y `pgbouncer_logs` (48).

- En el texto de los mensajes no hay ninguna fila con `BEGIN`, `PRIVATE KEY`,
  `CERTIFICATE` o `PRUEBA_MTLS`, ni con base64 de 60 caracteres o más.
- En los atributos de los logs tampoco hay material, ni base64 de 200
  caracteres o más (los más largos miden 1.892 y 628).
- La función solo registra
  `{"prueba":"mtls","modo":…,"status":…,"ms":…}`.
- El log de la plataforma solo guarda la línea de cada petición:
  `GET | 200 | …/prueba-mtls?modo=…`.
- El workflow también buscó fragmentos del certificado y de la clave en las
  respuestas y en los logs, y no encontró ninguno.

## Hallazgo: una clave mala cuelga la función

Con `clave_rota`, la función no contestó ni dejó ninguna línea de log, ni
siquiera en la plataforma. La llamada siguiente llegó unos 60 s después, que es
el límite que puso el curl. **No he visto el mensaje de error, porque no lo
hubo.** Lo probable es que se quedara bloqueada en
`createHttpClient`/`fetch` hasta que la plataforma la cortó.

Para la versión real, esto obliga a dos cosas:

1. **Un tiempo límite en toda llamada con certificado**
   (`AbortSignal.timeout(…)` en el `fetch`), que se registre como fallo y se
   enseñe en pantalla (regla 8).
2. **Validar el certificado y la clave al subirlos**, antes de guardarlos:
   que la clave corresponde al certificado y que este no está caducado. Así una
   clave mala se rechaza en el momento de subirla, y no aparece meses después
   en una presentación colgada.

## Limpieza

- **Función:** `prueba-mtls` borrada. `list_edge_functions` en staging ya no
  la lista.
- **Secretos:** `PRUEBA_MTLS_CERT_B64`, `PRUEBA_MTLS_KEY_B64` y
  `PRUEBA_MTLS_TOKEN` borrados. El último paso del workflow comprueba por la
  API que quedan 0 funciones `prueba-mtls` y 0 secretos `PRUEBA_MTLS_*`, y
  falla si queda alguno. Pasó.
- En el primer run no se llegó a desplegar nada y la limpieza midió 0 y 0.

## Lo que queda fuera de esta prueba

- **badssl no es la AEAT.** La prueba demuestra que el runtime hace mTLS, pero
  no que acepte la cadena de la FNMT ni un certificado de representante. Eso
  se verá en `prewww1` cuando toque construir, no ahora.
- **Respaldo, por si algún día hiciera falta:** un servicio pequeño aparte
  (Cloud Run o Fly.io), de unos 0–5 € al mes con este volumen, con la clave en
  el gestor de secretos de esa misma nube. Hoy no hace falta.
