# Ejemplo inventado · una empresa pequeña sacada de ERP10 (ejercicio 2026, de enero a marzo)

Ocho ficheros con la forma exacta de los Excel que saca ERP10. **Todos los datos son inventados** y se ven inventados. Sirven de fixture.

| Fichero | Qué es | Lo que tiene que salir al leerlo |
|---|---|---|
| `plan_de_cuentas.xlsx` | Plan de cuentas | 16 subcuentas de 8 cifras. Títulos en la fila 4, datos desde la 6 |
| `proveedores.xlsx` | Listado de proveedores / acreedores | 4 filas: 3 con NIF y 1 sin NIF (la 40000000, genérica) |
| `clientes.xlsx` | Listado de clientes / deudores | 1 fila, con NIF |
| `inmovilizado.xlsx` | Libro de elementos de inmovilizado | 1 elemento (21600000, 1.200,00; amortizado 30,00; valor contable 1.170,00) y una fila de totales, que no es un elemento |
| `diario.xlsx` | Libro diario | 10 asientos, 26 apuntes. Debe 11.499,00 = Haber 11.499,00. «Asiento» vale «0» en todos: se agrupan por serie, documento y fecha |
| `sumas_y_saldos.xlsx` | Balance de sumas y saldos | 15 subcuentas con movimiento y la fila «TOTALES:»: 11.499,00 · 11.499,00 · 8.231,00 · 8.231,00. Un importe llega con decimales de coma flotante |
| `libro_recibidas.xlsx` | Libro registro de recibidas (formato AEAT) | 3 facturas en 4 filas (la B-7 lleva dos tipos de IVA). Bases 1.700,00; cuotas 335,00; una con retención del 19 % (190,00) |
| `libro_expedidas.xlsx` | Libro registro de expedidas (formato AEAT) | 2 facturas. Bases 1.500,00; cuotas 150,00 |

## Lo que tiene que cuadrar entre ficheros

- El diario, sumado por subcuenta, da el sumas y saldos, cuenta a cuenta.
- La 47200000 del diario (335,00) es la cuota del libro de recibidas. La 47700000 (150,00), la del de expedidas.
- Series del diario: 1, expedidas (1.1 y 1.2); 2, recibidas (2.1, 2.2 y 2.3); 3, el resto.
- Cada factura del libro casa con su asiento por fecha, NIF y cuota.
- Saldos al 31/03: el cliente 43000001 debe 550,00 (la F-2, sin cobrar; la F-1 está cobrada). El proveedor 40000001 está a cero (la A-10, pagada). El 40000002 tiene 341,00 pendientes (la B-7) y el 41000001, 1.020,00 (la ALQ-3).
- La 40000000 está en el plan y en el listado de proveedores, sin NIF y sin movimientos.
