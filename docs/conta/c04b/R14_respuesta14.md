# C04b · Respuesta 14 — el PDF del día y si Diez deja adjuntarlo (13/10)

**Sin importes**: el repositorio es público.

## 1 · La maqueta del «Resumen de ventas»

`docs/conta/maquetas/c04b/ResumenDeVentas_muestra.pdf`: datos INVENTADOS
(empresa, pedidos e importes). Lo genera
`supabase/functions/_shared/resumenVentasPdf.ts`, el mismo que usará el
envío.

- **Cabecera**: plataforma y local, fecha en palabras, empresa y NIF, número
  de factura y «Generado por Folvy el …».
- **Las cuatro cifras**: pedidos, base, IVA y total del día.
- **Pedidos**: hora, nº de pedido, marca, base, IVA y total.
- **Reembolsos**: aparte y en negativo.
- **Por marca**: son las líneas de la factura.
- **El total del día**: con el cobro de la plataforma (430).
- **Pie**: «Este documento resume las ventas registradas en Folvy para este
  día y plataforma.»

Si algo no cuadra, el PDF no se genera y dice qué falla (pruebas en
`tests/conta/diez/resumenVentasPdf.test.ts`):
- una marca contra su línea de la factura;
- el total contra la factura o contra el cobro;
- un pedido cuya base más IVA no es su total.

## 2 · ¿Deja Diez adjuntar el PDF a una factura? **No, hoy no.**

**Lo que dice el Swagger** (run 38391240303, público y sin credenciales):
- `POST /api/facturas/upload` con `DatosDocumento` (`Ejercicio`, `Serie`,
  `Documento`, `NombreArchivo` y `Archivo` en base64) → `Factura`;
- `GET /api/facturas/getfile/{ejercicio}/{serie}/{documento}` → `string`.

**La prueba**: run 38392520545, en la C0009, contra la UBR-FLO-20261001
(documento 1801). El PDF era el resumen real de ese día, con 14 pedidos;
cuadraba con la factura. Se generó en el runner y no se guardó.

| Paso | Respuesta de Diez |
|---|---|
| `getfile` antes | **500** · `Microsoft.Azure.Storage.StorageException`: «The specified container does not exist.» |
| `facturas/upload` | **500** · el mismo: «The specified container does not exist.» |
| `getfile` después | **500** · el mismo |

**Qué quiere decir**:
- La ruta existe y acepta la petición.
- Lo que falla es el almacén de documentos de Diez: el contenedor de Azure
  donde guardaría el PDF **no existe para esta base**.
- Es el mismo error que daba `getfile` en la C0008 (T2, run 10).
- No es un problema de cómo se manda. Desde la API no se arregla: lo tiene que
  crear Cegid.

**Parado, como dijo Julio.** No se sigue a la C0008.

## 3 · Lo que hay que preguntar a Cegid

> En apiCON, `POST /api/facturas/upload` y
> `GET /api/facturas/getfile/{ejercicio}/{serie}/{documento}` devuelven 500
> con `Microsoft.Azure.Storage.StorageException: The specified container does
> not exist.` en las bases C0008 y C0009. ¿Hay que activar la gestión
> documental (el contenedor de documentos) de esas bases para poder adjuntar
> PDF a las facturas por la API? ¿Quién lo activa y cuánto tarda?

Cuando lo activen, la misma prueba (`[prueba-c0009:adjunto]`) dice en un
minuto si sube, y si lo devuelve igual, con la misma huella.
