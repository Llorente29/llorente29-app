# Compras · capturas contra las maquetas

Capturas del e2e `tests/e2e/conta/compras/compras.spec.ts` contra staging-conta, en ordenador (1440)
y móvil (390), con la semilla `supabase/seeds/conta/seed_compras_staging.sql` (todo inventado). Las
maquetas: `docs/conta/maquetas/compras/{Main,Liquidacion,FichaProveedor,Recepcion}.dc.html`.

| Pantalla | Maqueta | Captura |
|---|---|---|
| Compras | N18 `Main` | `compras-ordenador.png`, `compras-movil.png` |
| Subir una factura (no dibujada) | — | `subir-factura-ordenador.png`, `subir-factura-movil.png` |
| La liquidación y su contraste | N19 `Liquidacion` | `liquidacion-ordenador.png`, `liquidacion-movil.png` |
| Cómo te factura (ficha) | N20 `FichaProveedor` | `como-te-factura-ordenador.png`, `como-te-factura-movil.png` |
| La frase al recibir | N21 `Recepcion` | sin captura: va en el mensaje de «Recepción … confirmada» |

## Diferencias, una a una

1. **Menú.** La maqueta pinta «Ventas» y no pinta «Documentos», «Facturas que emites» ni «Cómo va tu
   negocio». Se queda el menú del C00 y se añade solo «Compras», delante de Bancos como en la maqueta.
   «Ventas» no existe todavía (sale cuando tenga pantalla).
2. **El número del menú** («Compras 3»). El menú del módulo aún no lleva contadores. El número está en
   la cabecera de «Qué tienes que mirar», y cuenta **todo** lo que hay (regla 7: no hay umbral en una
   pantalla que se abre a propósito).
3. **«Ver el papel»** en cada fila: no está. Cada fila dice código, día, local e importe. Abrir la foto
   desde Compras queda pendiente.
4. **«Apuntarla sin descontar el IVA»** (factura a nombre de otro): no está. Solo «Pedir que la
   rehagan», que la deja anotada. Apuntarla sin IVA deducible necesita su propia propuesta de asiento.
5. **Lo que le falta a una ficha** sale también cuando es el tipo de gasto, no solo el NIF. Sin él, sus
   facturas no se pueden proponer (`facturaProveedor` exige la cuenta de gasto de cada línea).
6. **«Es un albarán: esperar su factura»** es el texto cuando el papel es un albarán. Si es una
   factura y la ficha dice albarán, el botón dice «Solo esta vez». El otro botón cambia la ficha a lo que
   sugiere el papel.
7. **N19 · el IVA de su factura**: 400,67 € más 0,01 € de redondeo, no 400,66 €. Es como va en el papel
   por líneas, y el libro no admite una cuota que no sea base × tipo (regla 5 del libro). Aprobado por
   Julio el 10/10 («el céntimo está bien»).
8. **N19 · las pestañas** «Tu factura · Su factura · La cuenta · Ventas · Inventario»: no están. Lo leído
   va en el orden de la maqueta (las tres cifras, el contraste, las dos facturas, lo que se va a
   apuntar), y el inventario se ve producto a producto en «Decirle cuál es cuál».
9. **N19 · «Ver los 26 albaranes»**: no está. La frase dice cuántos y por cuánto.
10. **N19 · los números de ventas**: los de la captura son los de la semilla. Los reales de septiembre,
    medidos en producción en solo lectura, están en el informe de la T5.
11. **N20 · «sin IVA»** en «Sus 5 últimas entregas vinieron con albarán, sin IVA»: no se dice. Lo que se
    lee del papel es su tipo (albarán o factura), no si trae IVA.
12. **N20 · dónde va.** En la pestaña «Pago» de la ficha, en lugar de las píldoras «Cada cuánto te
    factura» (la forma de facturar ya decide cada cuánto).
13. **N21 · la frase** va dentro del mensaje que ya sale al confirmar una recepción («Recepción ALB-00123
    confirmada: … Este papel es un albarán. La oficina esperará la factura.»), no en una pantalla aparte.
    Si la base no sabe decirla, no se dice nada: la confirmación no depende de ella.
