# El traspaso del mes a Diez, con los PDF (B01r·26)

> Lo decidido por Julio el 24/10 (`docs/conta/c12/traspaso-completo.md`) y el
> 13/11. Este documento es el diseño de lo que se construye en la B01r·26 y lo
> que Julio tiene que preparar en Diez. Se va completando con cada PR.

## Lo decidido

| Qué | Cómo | PDF |
|---|---|---|
| Facturas de ventas del día (`sales_day`) y expedidas a mano | **Excel de emitidas**, con «Url documento» | Sí: Diez lo descarga del enlace de Sumied (`conta-pdf/<llave>`, #662) |
| Facturas recibidas | **Excel de recibidas**, como se probó el 24/10 | Sí, igual |
| Las recibidas con **3 tipos de IVA** (4 en octubre y noviembre) | **API**, como hasta hoy | No (Diez no lo admite por la API) |
| Banco, asientos a mano y liquidaciones | **API** (`apuntes/add`) | No |

- **Las facturas no cambian** (Julio, 13/11): el número, la fecha y los importes son los del PDF de Sumied.
- **En el Excel de emitidas, como mucho 3 líneas de ingresos por factura:**
  1. **Ventas:** todas las cuentas de ventas por marca (70000001…70000011) **sumadas en una sola línea, a la 70000000**. Es la cuenta de ventas que usaba Diez hasta septiembre (1.971 apuntes en la foto del 12/10).
  2. **Envíos cobrados:** la 70500001, si la hay.
  3. **Promociones:** la 70009001, la 70009002 o la 70009003, si la hay.
- **Analítica: una por factura,** con el **local** (Grupo: FLO, CAM o CAN) y la **plataforma** (Nivel3). **La marca no va.** Lo común (sin local) va sin código.
- **El «Cuadra»** compara **las ventas sumadas, el grupo 700** (todas las 700xxxxx, promociones incluidas), **el IVA soportado sumado (472) y el repercutido sumado (477)** (Julio, 13/11: Diez lleva el IVA a sus subcuentas por su tabla de tipos), y **el resto, cuenta a cuenta**. Así, que la marca vaya junta en Diez, o el IVA en otras subcuentas, no descuadra.

### Cuántas caben (producción, 13/11, solo lectura)

| Mes | Facturas de ventas del día | Con 4 cuentas de ventas o menos | Con una sola marca |
|---|---:|---:|---:|
| Octubre | 134 | 92 | 36 |
| Noviembre (hasta el 13) | 43 | 29 | 15 |

Con la regla de arriba (las ventas de marca, agrupadas) caben **todas** (177): 51 con una línea, 61 con dos y 65 con tres. Ninguna lleva devoluciones (708) ni otra cuenta de ingresos. Si un mes trae una que no cabe en 3 líneas, el generador no la mete en el Excel: va por la API y la pantalla lo dice.

### Las recibidas (producción, 13/11, solo lectura)

| Mes | Recibidas validadas | Caben en el Excel | 3 tipos de IVA | Exentas (sin IVA) | Con otra cuenta | Con retención | Sin PDF en Sumied |
|---|---:|---:|---:|---:|---:|---:|---:|
| Octubre | 197 | 193 | 2 | 4 | 2 (una 47700021, autoliquidada; una 76900000) | 1 | 8 |
| Noviembre | 62 | 59 | 2 | 1 | 1 (76900000) | 1 | 5 |

- **Las que no caben** (3 tipos de IVA, autoliquidada o con la 76900000) **van por la API**, sin PDF.
- **Las exentas caben** (una línea de IVA al 0 %), pero **no se ha probado** cómo las guarda Diez: va en el ensayo de la C0009.
- **Los abonos de proveedor** (12 en octubre y noviembre, de −2,99 € a −420,46 €) van en el Excel **en negativo**, como la rectificativa de emitidas que entró en la C0009 el 24/10. **No se ha probado en recibidas:** va en el ensayo de la C0009. (Por la API tampoco irían: no está medido cómo los guarda Diez.)
- **Las que no tienen PDF en Sumied no pueden ir con «Url documento»:** o llega su PDF antes del traspaso (las de Just Eat las arregla S), o van por la API sin PDF y la pantalla lo dice.

### La fecha de las recibidas

En la configuración de recibidas del 24/10, **«Fecha expedición» y «Fecha operación» van a la misma columna**, la B: Diez solo recibe la fecha de la factura. **En noviembre, 38 de las 62 recibidas tienen la factura de otro mes que su asiento** (en octubre, 6). Si Diez fecha el asiento con la de la factura, esas caen en otro mes y ni el libro ni el «Cuadra» salen iguales que en Sumied.
- **Propuesta:** la **fecha del asiento** de Sumied en una columna nueva, **la Y**, y que Julio la mapee en la configuración de recibidas como la fecha del asiento (o de registro), si Diez la admite.
- **Se comprueba en la C0009** con una recibida de septiembre apuntada en octubre.

## El Excel de emitidas: las columnas

Las columnas A–X son las de la configuración definitiva del 24/10
(`docs/conta/c12/prueba-excel/ConfiguracionExpedidas-c12.XML`, probada en la
C0009). **Se añaden cuatro, a la derecha, sin mover nada:**

| Col. | Qué | Ejemplo |
|---|---|---|
| A | Subcuenta del cliente (la 430 de la plataforma) | 43000002 |
| B | Concepto del asiento | Ventas Uber Eats · Foodint Alcalá · 01/10/2026 |
| C | Nombre del cliente (el de su subcuenta en Diez) | |
| D | NIF del cliente (el de su subcuenta en Diez) | |
| E | Subcuenta de ingresos 1: **ventas, 70000000** | 70000000 |
| F | Nº de factura (el del PDF) | UBR-FLO-20261001 |
| G | Importe de ingresos 1 | |
| H | Subcuenta de ingresos 2: **envíos** o, si no hay, **promociones** | 70500001 |
| I | Importe de ingresos 2 | |
| J | (vacía: era «Ruta documento») | |
| K | **Url documento**: `https://…/functions/v1/conta-pdf/<llave>` | |
| L | (vacía) | |
| M, N, O | Base, % y cuota del IVA 1 | |
| P | Total de la factura | |
| Q | Fecha | |
| R, S, T | Base, % y cuota del IVA 2 | |
| U, V, W, X | Rectificativa: tipo, tipo de rectificación, nº y fecha de la rectificada | |
| **Y** | **Subcuenta de ingresos 3: promociones** (cuando hay envíos y promociones) | 70009001 |
| **Z** | **Importe de ingresos 3** | |
| **AA** | **Analítica · Grupo: el local** | FLO |
| **AB** | **Analítica · Nivel3: la plataforma** | |

**Lo que tiene que hacer Julio en Diez, en la C0009** (la configuración se guarda por base):
1. En la configuración del Excel de emitidas: que lea **Y y Z como la subcuenta y el importe de ingresos 3**, **AA como Grupo** y **AB como Nivel3** de la analítica.
2. En la de recibidas: que lea **la Y como la fecha del asiento** (si Diez tiene ese campo).
3. Exportar las dos (los XML) y pasármelas: el generador lee cada columna del XML, como el de recibidas (si el XML no dice dónde va algo, el Excel no se genera).
4. Después, en el ensayo general, importar en la C0009 los dos Excel que prepare Sumied.

## La pantalla «Traspasar a Diez» (Libros › Cierre del mes)

1. **Revisar y confirmar** (como hoy). Confirmar vale como la autorización de Julio para escribir en Diez real todo el mes.
2. **Lo que va por la API** (banco, asientos a mano, liquidaciones y las recibidas de 3 tipos de IVA) se manda solo, en tandas, como hoy.
3. **«2 · Descarga los dos Excel e impórtalos en Diez (Importaciones › Importación desde fichero › Facturas)».**
   - Antes de prepararlos, Sumied comprueba que **todas las subcuentas** que usan existen en Diez. Si falta alguna, **no se genera nada**: dice cuáles (código y nombre) y ofrece **«Crearlas en Diez»**, con el nombre de Sumied, solo cuando Julio lo confirma. Queda apuntado quién y cuándo.
   - Después, «Descargar emitidas» y «Descargar recibidas».
4. **«3 · Ya lo he importado».** Sumied lee las facturas del mes en Diez, enlaza cada una con la suya (número y fecha), dice cuáles faltan y comprueba si **«Cuadra»**.

## Lo que queda para el día del traspaso

Ver `plan_del_dia_del_traspaso.md` (en el PR del plan).
