# ERP10 por la conexión · Qué hay que medir para sacar las recibidas que hoy van por el Excel

X10c (19/11/2026). Por la conexión con ERP10 salen las recibidas de **operación interior**, **sin retención** y con **hasta tres tipos de IVA**, y las emitidas de operación interior con hasta tres tipos de IVA. Lo demás sigue por el Excel, sin cambios, hasta medirlo.

Medir quiere decir **leer, sin escribir**, facturas que ya estén en el ERP10 del despacho y que la gestoría metió bien. Así se sabe qué campos de `FacturaData` (`POST /api/facturas/add`) pone ERP10 en cada caso y qué asiento sale. Después, **una factura de prueba por caso**, que saca Julio, comprobada en el paso 3.

## 1. Recibidas con retención (profesionales, modelo 111; alquileres, modelo 115)

`FacturaData` tiene `BaseRetencion`, `PorcentajeRetencion`, `CuotaRetencion` y `TipoRetencion`, este último un código del 1 al 6 sin documentar. En Diez, 12 de 1.432 recibidas llevaban retención y su `TipoRetencion` quedó sin descifrar (D01).

Falta medir:
- **Qué `TipoRetencion` corresponde a cada caso:** profesional (111) y alquiler (115).
- **Qué cuenta usa ERP10 para la retención** (4751…) y si la elige él por el tipo o hay que mandarla.
- **Cómo cuadra:** si `TotalFactura` es la base más el IVA menos la retención, o la base más el IVA.

Cómo medirlo: en cada sociedad, las recibidas con `CuotaRetencion` distinta de cero (`GET /api/facturas`). De cada una, su `TipoRetencion`, `PorcentajeRetencion` y `TotalFactura` frente a sus bases y cuotas, y las cuentas de su asiento (`GET /api/apuntes`, con su serie y documento). Solo códigos y recuentos, sin nombres ni NIF.

## 2. Recibidas con inversión del sujeto pasivo

En Diez está medida la de **fuera de la UE** (I01f, C0009):
- `TipoFactura` 6.
- Un solo tipo de IVA.
- `TotalFactura` y `TotalGastosIngresos` son la base.
- La 472 y la 477 por la misma cuota las pone Diez.
- `FechaOperacion` es la fecha de la factura.

Falta medir:
- **Que en el ERP10 de QBO sea igual.** Una recibida suya con `TipoFactura` 6, con su asiento.
- **La de un proveedor de España** (inversión nacional: obras, chatarra…). Diez no tenía ninguna. Hay que ver qué `TipoFactura` y qué claves del SII (`ClaveRegimenIva1`, `ClaveTipoFactura`) lleva en ERP10.

## 3. Recibidas intracomunitarias

En Diez está medida la **de servicios**: `TipoFactura` 7, con la misma forma que la del punto 2 (I01f).

Falta medir:
- **La de bienes.** Hoy no sale ni por el Excel, porque ERP10 no la admite al importar. Por la conexión puede que sí: hay que ver cómo la guarda ERP10, si con otro `TipoFactura`, `EsPrestacionDeServicios` a falso o una clave del SII.
- **Que la de servicios del ERP10 de QBO sea igual que la de Diez.**

## 4. Lo que vale para todas

- **La serie de recibidas y la de emitidas del ERP10 de QBO.** Hoy van la «2» y la «1», como en Diez. Lo dirá la primera factura de prueba de cada clase.
- **La cuenta de IVA.** ERP10 pone su propia 472 o 477. Si Sumied usa otra (una por tipo), el paso 3 lo enseña factura a factura como «en otras cuentas», no como diferencia de importe.
- **Más de tres tipos de IVA** en una factura: hay que medir la cuarta en adelante (`BaseImponible4…8`). Hoy salen por el Excel.

## Lo que no se puede deshacer

La API no tiene ningún DELETE de facturas ni de apuntes. Lo que entra en ERP10 se corrige a mano allí. Por eso cada caso nuevo empieza por **una factura para probar**, que se comprueba en el paso 3 antes de sacar las demás.
