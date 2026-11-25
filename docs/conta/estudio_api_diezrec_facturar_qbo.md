# API DiezREC (facturación de Cegid) · Cómo facturar QBO desde Sumied con el Verifactu de Cegid (25/11/2026)

> Copia en el repositorio del estudio que pasó Julio el 25/11 (respuesta 2 al Q10), sin datos de personas (T11).

**Por qué:** QBO factura con VERI*FACTU desde ERP10. La barra de ERP10 lo dice («VERI*FACTU: B56236938») y sus facturas llevan el QR. Tiene que seguir en Verifactu hasta el 31/12/2026. Sumied todavía no envía a Hacienda (ver encargo_V05). Por eso las facturas de noviembre tienen que nacer en Cegid.

**Fuente:** la documentación «API DiezREC», actualizada el 06/11/2026 (copia en `api_diezrec.md`). URL base: `https://apirec.diezsoftware.com`.

## Qué deja hacer la API
| | Leer | Crear | Cambiar | Borrar |
|---|---|---|---|---|
| Clientes (`/api/Customers`, con sus conceptos asignados) | Sí | No | No | No |
| Conceptos de facturación (`/api/Concepts`) | Sí | Sí | Sí | Sí |
| Series (`/api/Sets`) | Sí | No | No | No |
| **Facturas emitidas** (`/api/Invoices`, con sus líneas) | **Sí** | **No** | No | No |
| **Incidencias de cada cliente** (`/api/Incidences`) | Sí | **Sí** | Sí | Sí |

- **No se pueden crear ni emitir facturas por la API.** Tampoco devuelve el PDF ni el QR.
- **Sí se pueden añadir incidencias:** líneas que se facturan a un cliente en un mes (concepto, texto, unidades, importe, IVA, retención…).
  - Al facturarse, la incidencia guarda `estaFacturado`, `numeroFactura`, `serieFactura` y `anoFactura`.
  - Con eso se sabe exactamente en qué factura acabó cada cobro.
- **Acceso:**
  - `clientId` y `clientSecret` de la aplicación integradora: QBO ya los tiene;
  - usuario y contraseña de QBO;
  - el token dura 2 horas;
  - las llamadas solo desde el servidor.
  - El 25/11 las claves quedaron a la vista en el chat y QBO ha pedido otras nuevas.
- **Login:** la colección de Postman manda `codigoEmpresa` y la documentación dice `empresa`.
- **Listados:** de 200 en 200, con `$filter`, `$orderby` y `$skip` (`$skip` es el número de página). Las fechas vienen como número entero.

## Lo comprobado en Cegid (25/11, capturas de Julio)
- **«Facturación automática»:**
  - **sí factura los conceptos fijos** de la ficha de cada cliente, cada uno con su periodo;
  - deja elegir el mes y el año, la fecha de factura, la serie, el tipo de cliente (001 «Recurrente mensual», 002 «Cuotas especiales») y el cliente;
  - genera «Facturas» o «Borradores»;
  - tiene «Precalcular facturación», que no emite nada;
  - tiene la casilla «Imprimir/Enviar facturas».
- **La ficha del cliente** tiene, en Emisión de facturas, «Enviar por email» y «Verifactu». En cada concepto lleva «Facturar desde / hasta (mes/año)».
- **Ejemplo, Churuata Creativa (167):**
  - concepto fijo: 0008 GESTIÓN LABORAL, 5 × 20 €;
  - GoCardless le cobró 6 recibos, que suman 333,09 €;
  - hay facturas anteriores de 333,09 €, así que la cuota de gestoría (175,28 € de base) se añadía a mano.
- **Precálculo de noviembre:**
  - 183 facturas, de la 2750 a la 2932;
  - base 16.372,23 €, IVA 3.438,17 € y total 19.810,40 €;
  - GoCardless cobró 19.992,24 € a 179 clientes (273 cobros).
- **Informe de GoCardless de noviembre** (Excel del 24/11):
  - 270 cobros cobrados, por 19.871,24 €, igual que Sumied;
  - Sumied tiene además 3 confirmados después del informe, por 121 €;
  - 6 cobros sueltos sin suscripción, por 586,85 € (renta, trámites, fiscalización…).
- **Una factura por cliente y mes**, sumando todos sus cobros. Lo decidió Julio el 25/11.

## La autónoma (25/11)
- **Factura en el mismo Cegid, en la empresa 1.**
- **También está en VERI*FACTU:** su factura 2026/3/16, del 16/10/2026, lleva el QR y la leyenda.
- **Emisor de su factura:** su nombre, «· QBO ASESORES» y su NIF, con la misma dirección, teléfono y correo que QBO (T11: ni el nombre ni el NIF de una persona en el repositorio).
- **Lleva al menos dos series:**
  - la 1 (última conocida, 2026/1/573);
  - y la **3**: la 2026/3/16 es SOFTWARE CONTASIMPLE, 30 € + IVA, sin retención aunque el cliente es una S.L.
- **La retención del 15 %:** no se aplica en todo. En el software, no. Hay que medirla por concepto, con sus facturas reales.

## El camino decidido (respuesta_Q10_1)
1. Sumied suma lo cobrado en el mes por cliente: solo lo cobrado.
2. Lo compara con lo que Cegid ya factura solo, que son los conceptos fijos.
3. La diferencia va como incidencias, con el texto del concepto de GoCardless y el concepto de Cegid de la tabla de equivalencias que confirma Julio.
4. QBO comprueba el precálculo y pulsa «Facturación automática»: Cegid numera, envía a Hacienda y manda el email.
5. Sumied lee las facturas emitidas, ata los cobros a cada factura y comprueba que coinciden al céntimo.
