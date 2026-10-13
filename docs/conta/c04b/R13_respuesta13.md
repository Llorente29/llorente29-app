# C04b · Respuesta 13 — la primera venta de Folvy en Diez, en C0009 (13/10)

**Sin importes**: el repositorio es público. Los importes están en el chat.

## 1 · El molde (solo lectura)

Runs 38385457119 y 38386303530, `prueba-c0009-emitida-molde.ts`: las 97
facturas emitidas de Uber de la serie 1 de septiembre en la C0009.

- Serie 1, `TipoAsiento` 1, `TipoFactura` 1, IVA al 10 %, sin claves de IVA
  ni analítica.
- Cliente: la 430 de Uber, con su nombre y sin NIF.
- `NumeroFactura` `UBR-<local>-<AAAAMMDD>` y `Descripcion`
  `UBER EATS <local> dd/mm`: 97 de 97.
- Una línea por marca a su 7000000x. El reembolso va en la misma factura, en
  negativo, a la 7080000x (20 de 97).
- La suma de las líneas es la base, y también lo es `TotalGastosIngresos`
  (97 de 97).
- `FechaIntroduccionFactura` es el día en que se metió: de 9 a 38 días
  después.
- El listado de facturas de Diez devuelve casi todas dos veces (97 filas, 49
  documentos). Al buscar se cuenta por documento.

## 2 · El envío (visto bueno de Julio, con analítica)

Run 38388173592, `prueba-c0009-emitida.ts`. El asiento propuesto de Uber ·
Alcalá del 01/10 se leyó en producción con `conta_lectura`, en solo lectura,
y se montó con `diezFactura.ts`. Se buscó antes en Diez (no estaba) y se
envió. En Folvy no se marcó nada.

| Qué | Resultado |
|---|---|
| `facturas/add` | **200**, serie 1, documento **1801** (2026) |
| La factura leída de vuelta | igual en los 15 campos y en las 5 líneas (cuenta e importe) |
| El asiento que hace Diez | 7 líneas (las cinco 700, 477 y 430), cuadrado; 430 = el total, 477 = la cuota, cada 700 = su línea |
| **La 477 que pone Diez** | **`47700000`**, no la `47700010` (la factura no tiene campo para ella: la elige Diez por el tipo) |
| La analítica (`analitica/asiento`) | 5 de 5 iguales: Local `FLO`, Marca 1, 2, 5, 6 y 11, Plataforma `UBR` |
| En el listado de octubre | sí, y una sola `UBR-FLO-20261001` |

Por el camino: el canal de Uber se llama `uber` en Folvy, y la
correspondencia solo tenía `ubereats`; ya va con `UBR`.

## 3 · Pendiente

- Que Julio la mire en la pantalla de Diez (C0009).
- Decidir la 477: o se cambia en Diez la subcuenta del IVA del 10 % a
  47700010, o Diez se queda con la 47700000. La comparación diaria lo trata
  como cambio decidido de subcuenta, con el total igual, así que no da
  diferencia.
