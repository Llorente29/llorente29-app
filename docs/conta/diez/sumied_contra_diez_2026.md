# Sumied contra Diez · 2026 de Llorente29 (Foodint), C0008

> B01r·25, segunda versión (13/11, 12:50). **Solo lectura:** no se ha escrito nada ni en la C0008 ni en producción.
> Decisión de Julio (13/11): en Diez se borra todo lo que hay desde el 01/10, y octubre y noviembre entran limpios desde Sumied. El borrado lo hace Julio.
> Sin nombres de personas ni NIF (T11). Las subcuentas de terceros van solo con su código.

## Cómo se ha medido

- **Sumied:** producción, en solo lectura, con la vara única: `status in ('validado','anulado') and (voided_at is null or voided_by_entry_id is not null)`. Solo la empresa de Foodint (`658728c0…`).
- **Diez, lectura de hoy:** run [43444676030](https://github.com/Llorente29/llorente29-app/actions/runs/43444676030) del 13/11 a las 15:38 de Madrid. Es el modo `sumied-contra-diez` de «Diez · lectura», que entró con el [#655](https://github.com/Llorente29/llorente29-app/pull/655), lanzado desde `main` con el entorno «lectura».
  - Lee la C0008 **solo con GET**: 256 peticiones, ninguna escritura. Sumied lo lee con `conta_lectura`, en una sesión de solo lectura.
  - Por la puerta de salida solo salieron claves y enteros: 0 líneas retenidas.
  - Los importes de lo que no viene de Sumied van **cifrados** en el artefacto [`fuera-de-sumied-cifrado`](https://github.com/Llorente29/llorente29-app/actions/runs/43444676030/artifacts/14047468861) (14 días). Solo lo abre Julio, con la clave privada del testigo.
- **Diez, la foto del 12/10:** `external_entry_snapshot`. Son 7.223 asientos de enero a septiembre, leídos el 12/10 a las 21:04Z. Sirve para ver qué ha cambiado en Diez desde entonces.

## 0. Lo que hay en Diez desde el 01/10, antes de borrarlo (1b)

> **PARA: hay un asiento en Diez que Sumied no tiene (4/3155 del 05/10, subcuenta 55100001).** Si se borra octubre tal cual, se pierde. Julio tiene que decidir qué es antes de borrar: ver «Lo que no viene de Sumied».

### Cuántos hay, y de dónde vienen

| | Asientos |
|---|---:|
| **En la C0008 con fecha desde el 01/10** | **217** |
| Serie 1 (facturas emitidas) | 109 |
| Serie 2 (facturas recibidas) | 94 |
| Serie 4 (asientos generales) | 14 |
| Con fecha de noviembre | 0 |
| **Vienen de Sumied** (su referencia está en `external_send`) | **215** |
| **No vienen de Sumied** | **2** |

- **Los 215 que Sumied dice que mandó** (213 «enviado» y 2 «enlazado») **están todos en Diez**: no falta ninguna referencia.
- Lo que Sumied guarda de ellos:

| Estado en Sumied | Tipo | Asientos | Fechas | PDF según Sumied |
|---|---|---:|---|---|
| enviado | factura | 83 | 01/10–22/10 | adjunto |
| enviado | factura | 105 | 23/10–24/10 | `pendiente_diez` |
| enviado | factura | 12 | hasta el 24/10 | sin estado |
| enviado | asiento | 13 | 01/10–14/10 | — |
| enlazado | factura | 2 | 07/10 y 09/10 | `pendiente_diez` |
| pendiente | asiento | 26 | 01/10–15/10 | nunca salieron |
| pendiente | factura | 1 | 05/10 | nunca salió |

- **Los 13 asientos de la serie 4 están en Diez igual que en Sumied:** mismas subcuentas y mismos importes.
- **Las 202 facturas no salen iguales** en el apunte que guarda Diez. La causa probable es que Diez lleva el IVA a sus subcuentas genéricas (47200000 y 47700000), porque no tiene las 47200004, 47200010, 47200021 ni 47700021 de Sumied (punto 3). Con el borrado da igual, pero **no se ha comprobado línea a línea**, porque por la puerta no salen importes.
- **De esos 215, a 13 Sumied los anuló después.** Siguen en Diez sin su contraasiento. Con el borrado da igual.
- Los 2 «enlazado» los metió Julio y Sumied los casó por su referencia: **Sumied tiene el mismo hecho.**

### Lo que no viene de Sumied: 2 asientos

| Diez | Fecha | Tipo | Subcuenta principal | Qué tiene Sumied | Qué hacer |
|---|---|---|---|---|---|
| **4/3155** | 05/10 | asiento general | **55100001** | **Nada.** Ningún asiento de Sumied desde el 01/10 tiene el mismo día y total, ni las mismas subcuentas y total a ±31 días. | **No borrar sin decidir.** Julio mira en Diez qué es (el importe está en el artefacto cifrado). Si es un hecho real, se apunta en Sumied antes del borrado; si no lo es, se borra sabiéndolo. |
| 2/2521 | 06/10 | factura recibida | 40000006 | El asiento **2/3264** de Sumied tiene el mismo día y el mismo total, con otras subcuentas. | Parece la misma factura metida a mano, además de la que mandó Sumied: **se puede borrar**. Julio lo confirma con el artefacto. |

### Los PDF en Diez desde el 01/10

| | Facturas |
|---|---:|
| Facturas de Diez desde el 01/10 | 203 |
| **Con PDF en Diez** (`getfile`) | **0** |
| Sin PDF («container does not exist», las 203) | 203 |
| **Con PDF solo en Diez** (hay que descargarlo antes de borrar) | **0** |
| De Sumied, con PDF en Sumied y sin PDF en Diez | 190 |

- **Ninguna factura tiene PDF en Diez**, tampoco las 83 que Sumied da por «adjunto». Hoy Diez contesta «container does not exist» a todas.
- **No hay nada que descargar antes de borrar.** Los PDF que hay están en Sumied.
- Las 83 de Sumied en «adjunto» mienten sobre Diez. Hoy, en Sumied, «adjunto» no garantiza que Diez tenga el documento: la próxima tanda tiene que tenerlo en cuenta.

### Lo que tiene que cambiar en Sumied después del borrado (otra tanda, sin hacer)

El freno «nunca dos veces» son dos índices únicos de `external_send` (`20261019T0110_diez_libro.sql`):
- `external_send_entry_uq (entry_id) where status <> 'rechazado'`: un asiento no se manda dos veces.
- `external_send_ext_uq (company_id, ext_year, ext_series, ext_number) where … status <> 'rechazado'`: una referencia de Diez no se usa dos veces.

Con los 215 en «enviado» o «enlazado», la cola no volvería a mandar ni un asiento de octubre. Lo que haría falta, en una tanda **después** de que Julio borre:

1. **La prueba de que está borrado, antes de tocar nada.** El mismo modo del #655, lanzado otra vez:
   - `desde_octubre.asientos = 0`;
   - `enviados_que_no_estan_en_diez = 215`, es decir, que no queda ninguna de sus referencias en Diez.

   Sin eso, la tanda para.
2. **Los 215 pasan a `rechazado`**, con `last_error = 'Borrado en Diez por Julio el <fecha>: octubre entra limpio desde Sumied (B01r25)'`. Así:
   - se conservan las filas, con su referencia de entonces, como historia;
   - los dos índices dejan sitio a los envíos nuevos;
   - el CHECK de estados no cambia.

   Si se prefiere un estado propio («borrado_en_diez»), el CHECK se amplía y los dos índices cambian. Es más claro, pero es un «cambia en caliente» con más piezas.
3. **Los 27 «pendiente» se quedan como están:** nunca salieron y la cola los recoge. Antes hay que quitar lo que los paró (punto 2, al final).
4. La prueba de staging en ROLLBACK: un asiento «enviado» que pasa a «rechazado» deja que la cola cree otro envío del mismo asiento, y uno que sigue en «enviado» no.

## 1. Enero a septiembre: la tabla de diferencias

Saldo del mes (debe − haber) de cada subcuenta. **Solo las filas que no cuadran.** «Diez» es la foto del 12/10.

**Los 7.223 asientos que vinieron de Diez están en Sumied igual, al céntimo.** La tabla entera se explica con los 13 asientos que Sumied creó en noviembre (punto 2): restados de Sumied, las diferencias dan 0 en todas las filas. **Julio y agosto cuadran enteros.**

**Diez hoy (lectura del 13/11) contra la foto del 12/10:**
- Enero a agosto, Diez no ha cambiado: el mismo número de asientos por mes y los mismos saldos por subcuenta.
- **Septiembre tiene un asiento más en Diez** (1.419 contra 1.418) que mueve tres subcuentas: **47000000, 47200000 y 47700000**. Por las cuentas, parece la regularización del IVA del 3T, apuntada en Diez después del 12/10. **Sumied no lo tiene.**
- Así que, contra Diez de hoy, las diferencias son **30 subcuenta×mes**: las 27 de la tabla y esas 3 de septiembre. Los importes de esas 3 no salen por la puerta de salida.

| Mes | Subcuenta | Sumied | Diez | Diferencia |
|---|---|---:|---:|---:|
| 2026-01 | 11300000 Reservas voluntarias | −969,54 | 0,00 | −969,54 |
| 2026-01 | 41000008 (tercero) | 0,00 | −145,20 | 145,20 |
| 2026-01 | 43000001 (tercero) | 1.253,18 | 2.137,92 | −884,74 |
| 2026-01 | 43000002 (tercero) | 3.913,32 | 15.666,21 | −11.752,89 |
| 2026-01 | 43000006 (tercero) | 4.690,46 | 1.946,55 | 2.743,91 |
| 2026-01 | 43000101 (tercero) | 0,00 | −884,74 | 884,74 |
| 2026-01 | 57000000 Caja | 2.310,00 | 6.308,88 | −3.998,88 |
| 2026-01 | 57200002 Banco | 4.398,94 | 4.688,94 | −290,00 |
| 2026-01 | 63400000 Ajustes negativos en la imposición indirecta | 1.283,84 | 0,00 | 1.283,84 |
| 2026-01 | 70009001 Promociones Uber Eats | 12.838,36 | 0,00 | 12.838,36 |
| 2026-02 | 43000002 (tercero) | −1.479,14 | 6.778,57 | −8.257,71 |
| 2026-02 | 63400000 | 750,70 | 0,00 | 750,70 |
| 2026-02 | 70009001 | 7.507,01 | 0,00 | 7.507,01 |
| 2026-03 | 43000002 (tercero) | −1.414,63 | 2.058,32 | −3.472,95 |
| 2026-03 | 43000004 (tercero) | −6.705,60 | −7.423,74 | 718,14 |
| 2026-03 | 63400000 | 315,72 | 0,00 | 315,72 |
| 2026-03 | 67800000 Gastos excepcionales | 0,00 | 718,14 | −718,14 |
| 2026-03 | 70009001 | 3.157,23 | 0,00 | 3.157,23 |
| 2026-04 | 43000002 (tercero) | 1.226,37 | 2.308,68 | −1.082,31 |
| 2026-04 | 63400000 | 98,39 | 0,00 | 98,39 |
| 2026-04 | 70009001 | 983,92 | 0,00 | 983,92 |
| 2026-05 | 43000002 (tercero) | 670,27 | 6.973,97 | −6.303,70 |
| 2026-05 | 63400000 | 573,06 | 0,00 | 573,06 |
| 2026-05 | 70009001 | 5.730,64 | 0,00 | 5.730,64 |
| 2026-06 | 43000002 (tercero) | −2.540,29 | 676,68 | −3.216,97 |
| 2026-06 | 63400000 | 292,45 | 0,00 | 292,45 |
| 2026-06 | 70009001 | 2.924,52 | 0,00 | 2.924,52 |

Cada mes suma 0 (debe = haber). La consulta, para repetirla, está en el anexo A.

## 2. Los asientos que explican cada diferencia, por clase

### Falta en Diez (hay que enviarlos): 13 asientos, todos manuales, creados en Sumied del 06/11 al 13/11

| Asiento Sumied | Fecha | Qué es | Debe | Haber | Importe |
|---|---|---|---|---|---:|
| 1/1964 | 01/01 | Autofactura de diciembre de 2025 (16–31), cobrada el 19/01, contra la 113 | 43000006 | 11300000 | 2.743,91 |
| 4/3354 | 01/01 | Corrección de la apertura: lo que Uber debía a 31/12/2025 | 43000002 | 11300000 | 2.369,31 |
| 4/3395 | 01/01 | Caja: saldo de años anteriores a reservas (incidencia 2.1) | 11300000 | 57000000 | 3.998,88 |
| 4/3396 | 01/01 | Banco ···4525: 290,00 de más en la apertura, a reservas (incidencia 4.9) | 11300000 | 57200002 | 290,00 |
| 4/3397 | 01/01 | 43000101, apuntes de 2024, a la cuenta de Glovo (incidencia 4.11) | 43000101 | 43000001 | 884,74 |
| 4/3526 | 01/01 | QBO: saldo de apertura sin respaldo; su mayor empieza 2026 a 0,00 | 41000008 | 11300000 | 145,20 |
| 4/3355 | 31/01 | Promociones de Uber apuntadas como venta, enero (incidencia 1.1) | 70009001 12.838,36 · 63400000 1.283,84 | 43000002 | 14.122,20 |
| 4/3356 | 28/02 | Ídem, febrero | 70009001 7.507,01 · 63400000 750,70 | 43000002 | 8.257,71 |
| 4/3393 | 09/03 | Cloudtown: la parte del anterior titular de la liquidación de enero (01–08/01) | 43000004 | 67800000 | 718,14 |
| 4/3357 | 31/03 | Promociones de Uber, marzo | 70009001 3.157,23 · 63400000 315,72 | 43000002 | 3.472,95 |
| 4/3358 | 30/04 | Ídem, abril | 70009001 983,92 · 63400000 98,39 | 43000002 | 1.082,31 |
| 4/3359 | 31/05 | Ídem, mayo | 70009001 5.730,64 · 63400000 573,06 | 43000002 | 6.303,70 |
| 4/3360 | 30/06 | Ídem, junio | 70009001 2.924,52 · 63400000 292,45 | 43000002 | 3.216,97 |

- **El 1/1964 va como asiento general, no como factura.** Está en la serie 1 de Sumied, pero no lleva IVA ni número de factura: es un apunte entre 43000006 y 11300000. En la serie 1 de Diez, la de facturas emitidas, no entra tal cual. Hay que decidir si va a la serie 4.
- **Ninguno anula nada en Diez:** todos son asientos nuevos. La corrección va en el propio asiento; el original de Diez no se toca.

### En Diez pero cambiado en Sumied

**Ninguno de enero a septiembre.** En esos meses no hay ningún asiento anulado en Sumied, y los 7.223 traídos de Diez siguen igual en Diez (lectura del 13/11). Desde el 01/10 no hace falta ninguno: lo de octubre se borra entero en Diez.

### En Diez y no en Sumied

- **Un asiento de septiembre**, apuntado en Diez después del 12/10, que mueve 47000000, 47200000 y 47700000; parece la regularización del IVA del 3T. **No se toca en Diez.** Para Julio: si es la liquidación del 3T, Sumied debería tenerla también, porque si no, el 2026 no acaba igual. Es un asiento para traer de Diez a Sumied, no para mandar.
- **Desde el 01/10, el 4/3155 (55100001)**, que Sumied no tiene (punto 0). Con el borrado desaparece: lo decide Julio antes.

### Toca el IVA de un trimestre presentado (1T a 3T)

- **Ninguno de los 13 toca una subcuenta de IVA** (472 o 477), así que no cambian los libros de IVA presentados.
- **Las promociones de Uber ya están decididas** (Julio, 13/11): los seis asientos 4/3355–4/3360 bajan la venta a la 70009001 y apuntan **3.314,16 €** en la 63400000. Ese IVA se da por perdido, como se acordó en su migración. No tocan ninguna subcuenta de IVA ni el libro presentado, y van a Diez tal cual. Comprobado sumando los seis: 1.283,84 + 750,70 + 315,72 + 98,39 + 573,06 + 292,45 = 3.314,16. *(La primera versión de este informe decía 4.313,16: era un error.)*

### Por qué se pararon los 27 «pendiente» desde el 24/10

- **26 asientos** (25 de banco y 1 pago de proveedor, del 01 al 15/10) se pararon por un freno escrito en la cola: «Diez real está cerrado para asientos de banco, manuales y liquidaciones (C0008): no se escribe nada hasta que Julio los autorice». No fue un fallo: **la C0008 solo estaba abierta a facturas.** Cuando se reenvíe octubre pasará lo mismo con **todo** lo que no es factura (356 asientos de octubre y noviembre, punto 5), salvo que Julio abra ese freno antes.
- **1 factura recibida** (05/10) se paró por «sin IVA soportado: no se ha medido cómo guarda Diez una recibida exenta; no se envía». Antes de reenviar hace falta la prueba de una recibida exenta en la C0009.

## 3. Lo que tiene que existir en Diez antes de enviar

### Subcuentas

Contra el plan de cuentas de la C0008, leído hoy: Diez tiene 788 subcuentas y Sumied usa 174 en 2026. **Faltan 11 en Diez:**

| Subcuenta | Nombre en Sumied |
|---|---|
| 40000019 | (proveedor) |
| 41000042 | (acreedor) |
| 41000043 | (acreedor) |
| 41000044 | (acreedor) |
| 41000046 | (acreedor) |
| 41000047 | (acreedor) |
| 47200004 | IVA soportado 4 % |
| 47200010 | IVA soportado 10 % |
| 47200021 | IVA soportado 21 % |
| 47700021 | IVA repercutido 21 % |
| 62300004 | Servicios de profesionales independientes (Catcher) |

- **Las demás ya existen**, también las que en la primera versión parecían faltar por no tener movimiento: 17100000, 40090000, 57200004, 60100000, 60800000, 63400000 y 66230000. Y las que nombraba el encargo: 47700010, las 70009001–70009003, la 70500001 y la 41000023.
- **Ojo con las 472 por tipo:** Diez no las tiene, y aun así aceptó en octubre facturas recibidas de Sumied. Lo más probable es que el IVA vaya a la 47200000 (punto 0). Hay que decidir si se crean en Diez o si Sumied manda a la 47200000; si no, los libros no acaban igual subcuenta a subcuenta.

### Clientes y proveedores

En Diez, un cliente o proveedor es su subcuenta 40/41 con sus datos fiscales. **Faltan los seis de la tabla:** 40000019 y 41000042, 41000043, 41000044, 41000046 y 41000047. Sus datos (nombre y NIF) están en Sumied y no se copian aquí (T11). Se dan de alta en Diez con el mismo código.

### Analítica por local

La tabla está en `supabase/functions/_shared/diezAnalitica.ts` (`CORRESPONDENCIA_LLORENTE29`, confirmada por Julio el 12/10). Las líneas de gasto e ingreso (6 y 7) de Sumied desde el 01/10, por local:

| Local en Sumied | Código en Diez (Grupo) | Líneas desde el 01/10 |
|---|---|---:|
| Foodint Alcalá | FLO | 690 |
| Foodint Carabanchel | CAM (BAR solo se lee, nunca se envía) | 363 |
| Foodint Plaza Castilla | CAN | 10 |
| **Común (sin local)** | **ninguno** | **88** |

- **Los tres locales tienen código.**
- **Lo común no tiene código de local:** 88 líneas, por ejemplo Revolut, que no tiene local. **Decisión de Julio (13/11): un código «Común» en Diez si no cuesta; si cuesta, sin código.**
  - Hoy, una línea sin local va a Diez **sin código de local**: `analiticaParaEnviar` lo apunta como «sin local» y no pone Grupo.
  - Un «Común» cuesta dos cosas:
    1. **Que exista ese grupo en la C0008.** La correspondencia de Sumied solo conoce CAM, BAR, FLO, CAN y JDH; si Diez tiene otro grupo, no se ha medido. Crearlo es escribir en la C0008, así que lo hace Julio en Diez.
    2. **Un cambio pequeño en `diezAnalitica.ts`:** que «sin local» se envíe con ese código y se lea igual (la correspondencia y su revisión), con su prueba.
  - **No es gratis, así que se queda sin código** mientras Julio no cree el grupo en Diez. Si lo crea, el cambio de Sumied es de una tanda pequeña.
- JDH, en Diez, no es un local abierto: no se usa.
- Las marcas (Subgrupo) tienen su tabla en el mismo fichero (`marcaAlEnviar`, 9 marcas).

## 4. Los PDF

### De lo ya enviado (se borra con octubre)

- **Según Diez (lectura del 13/11), 0 de las 203 facturas desde el 01/10 tienen PDF.** Las 203 contestan «container does not exist».
- Según Sumied: 83 en «adjunto», 107 en `pendiente_diez` (la lista «Pendientes de adjuntar en Diez») y 12 sin estado. **Las 83 en «adjunto» no lo tienen en Diez.**
- `external_document`, la tabla de los PDF que se traen de Diez a Sumied: **0 filas.**

### De lo que habría que enviar

| | Facturas | Con PDF en Sumied | Sin PDF |
|---|---:|---:|---:|
| Octubre | 337 | 323 | 14 |
| Noviembre (hasta hoy) | 109 | 103 | 6 |
| **Total** | **446** | **426** | **20** |

Las 20 sin PDF:
- **10 recibidas** de proveedor sin documento (5 de octubre y 5 de noviembre);
- **9 manuales** (6 de la serie 1 y 3 de la serie 2);
- **1 ajuste de ventas** de la serie 1.

Los asientos que no son factura (banco, liquidaciones, nóminas, manuales) no llevan PDF por la API: Diez solo adjunta a facturas (`facturas/upload`).

### ¿La API ya deja subir un adjunto? (prueba en la C0009) — **No, sigue igual**

Run [43444680789](https://github.com/Llorente29/llorente29-app/actions/runs/43444680789), del 13/11 a las 15:48. Es `[prueba-c0009:adjunto]`, lanzada desde `main` con los pasos que añadió el #655. Llega a la factura UBR-FLO-20261001 de la C0009 (1 factura con ese número, de 18 de octubre en la C0009) y:

| Paso | Respuesta de Diez |
|---|---|
| `getfile` antes de subir | **500**, «container does not exist» |
| `facturas/upload` con el PDF | **500**, «container does not exist» |
| `getfile` después | **500**, «container does not exist» |

- **La API de Diez sigue sin dejar adjuntar documentos**, igual que el 14/10. El fallo es del almacén de Diez («container»), no de lo que se le manda.
- **Qué quedó en la C0009: nada nuevo.** La factura de prueba ya estaba (R13) y el upload no guardó ningún documento, como dice el `getfile` de después.
- La lectura de la C0008 dice lo mismo (punto 0): ninguna de sus 203 facturas desde el 01/10 tiene PDF.
- **Para Julio:** mientras Diez no lo arregle, los PDF solo se pueden poner en Diez a mano, desde su pantalla, o pidiéndoselo a Diez (es su almacén). Antes del reenvío de octubre conviene preguntarles.

## 5. Cuántos asientos habría que enviar, y en cuántos envíos

| Qué | Asientos |
|---|---:|
| Enero a junio: los 13 que faltan (punto 2) | 13 |
| Octubre, limpio: facturas (serie 1: 141, serie 2: 196) | 337 |
| Octubre, limpio: asientos (banco 203, liquidaciones 21, pagos 3, manuales 14, nómina 1) | 242 |
| Noviembre hasta hoy: facturas (serie 1: 46, serie 2: 63) | 109 |
| Noviembre hasta hoy: asientos (banco 95, liquidaciones 13, pagos 2, manuales 4) | 114 |
| **Total** | **815** |

- **No se envían los 15 pares anulados** (14 de octubre y 1 de noviembre, cada uno con su contraasiento): con Diez limpio desde el 01/10, mandar el anulado y su contraasiento es mandar cero. Si Julio prefiere que Diez tenga también la historia, son 30 asientos más: 845.
- Noviembre crece cada día: la cifra es la de hoy, 13/11.

**En cuántos envíos, propuesta: 5**, uno por tipo de freno, para poder parar entre uno y otro:
1. Los 13 de enero a junio (asientos generales, serie 4).
2. Octubre, facturas (337), con su PDF.
3. Octubre, asientos (242). Necesita que Julio abra antes el freno de banco, manuales y liquidaciones de la C0008.
4. Noviembre, facturas (109).
5. Noviembre, asientos (114).

Antes del primero:
- las subcuentas del punto 3;
- la tanda de Sumied del punto 0;
- la prueba de la recibida exenta en la C0009.

## Decidido por Julio (13/11)

1. **Las 88 líneas sin local:** con un código «Común» en Diez si no cuesta; si cuesta, sin código. Cuesta un poco (punto 3, analítica), así que de momento van **sin código**.
2. **Las promociones de Uber en la 63400000** (3.314,16 €): ese IVA se da por perdido, como en su migración. No es una pregunta para la gestoría: los seis asientos van a Diez tal cual.

## Para la pantalla «Sumied y Diez, mes a mes» (Libros › Con Diez): qué datos le faltan

1. **Una foto de Diez que se renueve.** Hoy la única es la del 12/10 (`external_entry_snapshot`) y acaba en septiembre. La pantalla necesita leer Diez por mes y subcuenta **guardándolo**; `external_balance_witness` y `external_compare_day` existen y están vacías. Eso es escribir en producción desde una lectura de Diez: una función programada, con su permiso, no un workflow de una sesión.
2. **La referencia de Diez de cada asiento, en los dos sentidos.**
   - Los traídos la tienen (`journal_entry.external_*`) y los mandados también (`external_send`).
   - Lo que Julio mete a mano en Diez no tiene dónde guardarse: hace falta guardar los asientos de Diez sin pareja para poder pintarlos «solo en Diez».
3. **El estado «borrado en Diez»** para los envíos de octubre (punto 0), para que la pantalla no los cuente como «en Diez».
4. **Los documentos de Diez:** si cada factura tiene PDF en Diez (`getfile`). Hoy solo se sabe de lo que Sumied adjuntó.
5. **Qué asiento explica cada diferencia.** Con 1 y 2, el clic de la fila sale de cruzar la subcuenta y el mes con los asientos de los dos lados. Sin la foto de Diez guardada, ese cruce no tiene lado derecho.

## Anexo A · La consulta de la tabla del punto 1 (producción, solo lectura)

```sql
with s as (
 select a.code cuenta, to_char(e.entry_date,'YYYY-MM') mes, round(sum(l.debit-l.credit)*100)::bigint c
 from journal_entry e join journal_line l on l.entry_id=e.id join company_account a on a.id=l.company_account_id
 where e.company_id='658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.entry_date between '2026-01-01' and '2026-09-30'
  and e.status in ('validado','anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
 group by 1,2),
d as (
 select x->>'cuenta' cuenta, to_char(x0.entry_date,'YYYY-MM') mes, sum((x->>'debe')::bigint-(x->>'haber')::bigint) c
 from external_entry_snapshot x0, jsonb_array_elements(x0.lines) x
 where x0.company_id='658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x0.entry_date between '2026-01-01' and '2026-09-30'
 group by 1,2)
select coalesce(s.cuenta,d.cuenta) cuenta, coalesce(s.mes,d.mes) mes, coalesce(s.c,0) sumied, coalesce(d.c,0) diez, coalesce(s.c,0)-coalesce(d.c,0) dif
from s full join d on s.cuenta=d.cuenta and s.mes=d.mes
where coalesce(s.c,0)<>coalesce(d.c,0) order by 2,1;
```

Resultado: las 27 filas de la tabla, en céntimos. Los 7.223 asientos traídos de Diez son 525, 818, 835, 683, 653, 512, 955, 824 y 1.418 de enero a septiembre, los mismos por mes en Sumied y en la foto.
