# B01 · El motor en staging-conta (empresa A, datos inventados)

Generado por `tests/e2e/conta/b01/motor.spec.ts`. He leído 3 cuentas, 15 movimientos, del 02/10 al 13/10; cuadra con el saldo del banco.

Importación: Banco B01 · Norte: Este fichero ya se subió el 13/10/2026 a las 20:25: no cambia nada. · Banco B01 · Sur: Este fichero ya se subió el 13/10/2026 a las 20:25: no cambia nada. · Banco B01 · Mercado: Este fichero ya se subió el 13/10/2026 a las 20:25: no cambia nada..

| Banco | Fecha | Lo que dice el banco | Importe | Estado | Lo que Folvy cree que es | Porqué |
|---|---|---|---:|---|---|---|
| Banco B01 · Norte | 2026-10-02 | Recibo SUMINISTROS B01 DEL NORTE FRA B01-0477 | −498,88 € | casado solo | Casado solo · pago de la factura | Casado solo: mismo importe y misma referencia (B01-0477) que la factura pendiente del 28/09. |
| Banco B01 · Norte | 2026-10-03 | Comision mantenimiento | −12,50 € | para confirmar | Comisión del banco | El banco lo da como «intereses, comisiones, gastos» (concepto 17): Comisiones del banco y del datáfono · 62600000. |
| Banco B01 · Mercado | 2026-10-05 | Ingreso efectivo | 2.000,00 € | para confirmar | Ingreso de efectivo · El dinero en efectivo de la caja · 57000000 | Un ingreso de efectivo en el banco suele venir de la caja: sale de la caja y entra en el banco. |
| Banco B01 · Norte | 2026-10-06 | Traspaso a cuenta B01 SUR | −1.500,00 € | casado solo | Casado solo · traspaso entre tus cuentas | Sale de Banco B01 · Norte y entra en Banco B01 · Sur el mismo día, mismo importe. |
| Banco B01 · Sur | 2026-10-06 | Traspaso de cuenta B01 NORTE | 1.500,00 € | casado solo | Casado solo · traspaso entre tus cuentas | Sale de Banco B01 · Norte y entra en Banco B01 · Sur el mismo día, mismo importe. |
| Banco B01 · Sur | 2026-10-07 | Recibo TELEFONO | −45,30 € | por aclarar | No sé qué es | No hay factura de 45,30 €: ¿la subes o es un pago sin factura? |
| Banco B01 · Norte | 2026-10-08 | Transferencia de GLOVO liquidacion 1-7 oct | 3.412,18 € | casado solo | Casado solo · cobro de su liquidación | Casado solo: cuadra con su liquidación 01/10–07/10 (neto 3.412,18 €). |
| Banco B01 · Norte | 2026-10-09 | Adeudo TGSS cuotas septiembre | −3.104,77 € | por aclarar | Seguros sociales | Es un recibo de la Seguridad Social, pero no hay nómina asentada con 3.104,77 € a pagar: propongo Seguros sociales pendientes de pagar · 47600000. Al confirmarlo, lo aprendo. |
| Banco B01 · Norte | 2026-10-09 | Transferencia recibida ref 88213 | 1.278,17 € | por aclarar | No sé qué es | Sin factura ni liquidación de ese importe. ¿De quién es? |
| Banco B01 · Norte | 2026-10-10 | Pago con tarjeta MERCADO CENTRAL 0937 | −86,40 € | por aclarar | Tarjeta acabada en 0937 | Por aclarar: tarjeta acabada en 0937, ¿de quién es? Dala de alta en Cuentas y extractos y sabré a quién pedirle el ticket. |
| Banco B01 · Mercado | 2026-10-11 | Transferencia a HERMANOS RUIZ | −220,00 € | para confirmar | Pago en parte de la factura F-2026-0915 de Hermanos Ruiz | Paga 220,00 € de los 1.283,15 € que quedan; seguirán pendientes 1.063,15 €. |
| Banco B01 · Sur | 2026-10-12 | Comision transferencia | −3,10 € | para confirmar | Comisión del banco | El banco lo da como «intereses, comisiones, gastos» (concepto 17): Comisiones del banco y del datáfono · 62600000. |
| Banco B01 · Mercado | 2026-10-12 | Pago con tarjeta GASOLINERA | −60,00 € | por aclarar | Pago con tarjeta · ¿ticket? | Pago con tarjeta en GASOLINERA que aún no conozco: sube la foto del ticket y lo aprendo. |
| Banco B01 · Norte | 2026-10-13 | Transferencia a SUMINISTROS B01 DEL NORTE | −250,00 € | para confirmar | Pago en parte de la factura B01-0478 de Suministros B01 del Norte | Paga 250,00 € de los 600,00 € que quedan; seguirán pendientes 350,00 €. |
| Banco B01 · Mercado | 2026-10-13 | Compra tarj. 1234 FERRETERIA LOPEZ | −34,75 € | por aclarar | Tarjeta acabada en 1234 | Por aclarar: tarjeta acabada en 1234, ¿de quién es? Dala de alta en Cuentas y extractos y sabré a quién pedirle el ticket. |

Asientos de la empresa A antes: 45.
Asientos de la empresa A después de deshacer: 45 (antes 45).
