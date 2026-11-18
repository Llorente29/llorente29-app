# Ficheros inventados de Revo para la e2e del R06

Todo es inventado (T11): sale del ejemplo del R04 (`tests/conta/r04/revo_ejemplo`), con «Cliente de ejemplo N» y NIF B00000000, copiado a tres días y con los nombres que da una descarga cualquiera (`orders (3).csv`, `invoices_nov.csv`…), para que se reconozcan por sus columnas y no por el nombre.

- **09/11**: el ejemplo tal cual (órdenes 700001…, facturas 5001 a 5048, 1.100,00 €). En la e2e, «Ya estaba, igual».
- **10/11**: órdenes 701001…, facturas 5049 a 5096, 1.100,00 €. Cuadra; el primer pago en efectivo es de «Too Good To Go», una forma de pago sin cuenta.
- **11/11**: órdenes 702001…, facturas 5097 a 5144. No cuadra: falta el pago de la orden 702002 (19,93 €).
