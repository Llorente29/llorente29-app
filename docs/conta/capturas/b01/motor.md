# B01 · El motor en staging-conta (empresa A, datos inventados)

Run 190 de «Pruebas e2e en staging-conta» (`tests/e2e/conta/b01/motor.spec.ts`, commit 9528ec7), 13/10/2026 16:42 UTC: **pasó**.
Las capturas no las subió el workflow porque fallaron otras 6 pruebas ajenas a B01 (§ del parte). Esta tabla sale de lo que la
demostración dejó escrito en staging (`bank_activity_log`), con el estado final de cada movimiento y el porqué LITERAL que se
escribió (con dos fallos que se ven y ya están corregidos: el punto que arrastra el nombre de la cuenta, y la tarjeta y el
efectivo con la frase genérica). La imagen se renderiza con el mismo HTML que la prueba.

He leído 3 cuentas, 14 movimientos, del 02/10 al 13/10; cuadra con el saldo del banco.

| Banco | Fecha | Lo que dice el banco | Importe | Estado | Lo que Folvy cree que es | Porqué |
|---|---|---|---:|---|---|---|
| Banco B01 · Norte | 02/10 | Recibo SUMINISTROS B01 DEL NORTE FRA B01-0477 | −498,88 € | casado solo | Casado solo · pago de la factura | Casado solo: mismo importe y misma referencia (B01-0477) que la factura pendiente del 28/09. |
| Banco B01 · Norte | 03/10 | Comision mantenimiento | −12,50 € | para confirmar | Comisión del banco | El banco lo da como «intereses, comisiones, gastos» (concepto 17): Comisiones del banco y del datáfono. · 62600000. |
| Banco B01 · Norte | 06/10 | Traspaso a cuenta B01 SUR | −1.500,00 € | casado solo | Casado solo · traspaso entre tus cuentas | Sale de Banco B01 · Norte y entra en Banco B01 · Sur el mismo día, mismo importe. |
| Banco B01 · Norte | 08/10 | Transferencia de GLOVO liquidacion 1-7 oct | +3.412,18 € | casado solo | Casado solo · cobro de su liquidación | Casado solo: cuadra con su liquidación 01/10–07/10 (neto 3.412,18 €). |
| Banco B01 · Norte | 09/10 | Adeudo TGSS cuotas septiembre | −3.104,77 € | por aclarar | Seguros sociales | Es un recibo de la Seguridad Social, pero no hay nómina asentada con 3.104,77 € a pagar: propongo Seguros sociales pendientes de pagar. · 47600000. Al confirmarlo, lo aprendo. |
| Banco B01 · Norte | 09/10 | Transferencia recibida ref 88213 | +1.278,17 € | por aclarar | No sé qué es | Sin factura ni liquidación de ese importe. ¿De quién es? |
| Banco B01 · Norte | 10/10 | Pago con tarjeta MERCADO CENTRAL 0937 | −86,40 € | por aclarar | No sé qué es | No hay factura de 86,40 €: ¿la subes o es un pago sin factura? |
| Banco B01 · Norte | 13/10 | Transferencia a SUMINISTROS B01 DEL NORTE | −250,00 € | para confirmar | Pago en parte de la factura B01-0478 de Suministros B01 del Norte | Paga 250,00 € de los 600,00 € que quedan; seguirán pendientes 350,00 €. |
| Banco B01 · Sur | 06/10 | Traspaso de cuenta B01 NORTE | +1.500,00 € | casado solo | Casado solo · traspaso entre tus cuentas | Sale de Banco B01 · Norte y entra en Banco B01 · Sur el mismo día, mismo importe. |
| Banco B01 · Sur | 07/10 | Recibo TELEFONO | −45,30 € | por aclarar | No sé qué es | No hay factura de 45,30 €: ¿la subes o es un pago sin factura? |
| Banco B01 · Sur | 12/10 | Comision transferencia | −3,10 € | para confirmar | Comisión del banco | El banco lo da como «intereses, comisiones, gastos» (concepto 17): Comisiones del banco y del datáfono. · 62600000. |
| Banco B01 · Mercado | 05/10 | Ingreso efectivo | +2.000,00 € | por aclarar | No sé qué es | Sin factura ni liquidación de ese importe. ¿De quién es? |
| Banco B01 · Mercado | 11/10 | Transferencia a HERMANOS RUIZ | −220,00 € | para confirmar | Pago en parte de la factura F-2026-0915 de Hermanos Ruiz | Paga 220,00 € de los 1.283,15 € que quedan; seguirán pendientes 1.063,15 €. |
| Banco B01 · Mercado | 12/10 | Pago con tarjeta GASOLINERA | −60,00 € | por aclarar | No sé qué es | No hay factura de 60,00 €: ¿la subes o es un pago sin factura? |

Al terminar, la prueba lo deshizo todo y comprobó que la empresa A tenía los mismos asientos que antes.
