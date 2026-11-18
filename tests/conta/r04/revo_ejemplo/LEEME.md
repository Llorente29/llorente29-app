# Ejemplo inventado de las exportaciones de Revo XEF (un día)

Todo es inventado: nombres «de ejemplo», NIF B00000000, importes generados. Tiene la misma forma que los ficheros reales (16/11/2026): CSV separado por punto y coma, coma decimal, la primera columna de órdenes con espacios delante, fechas «AAAA-MM-DD hh:mm:ss».

Lo que tiene que salir al leerlos:

- Órdenes: 48 · Documentos: del 5001 al 5048, sin saltos · Pagos: 49 (una orden se paga en dos veces).
- Total del día: 1100 · Base: 999,99 · IVA 10 %: 100,01.
- Por forma de pago: Deliverect 500, Efectivo 180, Tarjeta 420.
- Por canal (columna «Entrega» de Órdenes): en el local 600, Glovo 300, UberEats 200.
- «Deliverect» (500) es la suma de Glovo y UberEats.
- Hay una orden en negativo (−11,00, Glovo, comensales −1): es una devolución y resta.
- Dos documentos llevan NIF (B00000000): son facturas completas y van solas al libro.
