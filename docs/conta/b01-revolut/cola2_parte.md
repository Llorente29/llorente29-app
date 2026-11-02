B01 · Cola 2 · **Olimpo: cada pago con su factura, y Bancos ya no casa con una factura anulada.** Visto bueno de Julio a la lista (02/11). Lo medido antes: `docs/conta/b01-revolut/cola2_olimpo_casados.md`.

## Las cifras de Foodint, hoy (02/11, 12:00Z)

La consulta, en solo lectura y con `account_id` (regla 9):

```sql
select 'con factura anulada o descartada' que, count(distinct b.id) casados, coalesce(sum(it.amount), 0) importe
  from bank_match b join bank_match_item it on it.match_id = b.id join supplier_invoice si on si.id = it.supplier_invoice_id
 where b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and b.status = 'vivo'
   and (si.status in ('anulada', 'descartada') or si.discarded_at is not null)
union all
select 'con «la referencia no coincide»', count(*), coalesce(sum(abs(b.amount)), 0)
  from bank_match b
 where b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and b.status = 'vivo' and b.reason ilike '%referencia no coincide%';
```

| | Casados vivos | Importe |
|---|---:|---:|
| Con una factura anulada o descartada | **1** | 363,67 (el de Olimpo) |
| Con «la referencia no coincide» | **7** | 1.384,79 |

- De los 7, solo el de Olimpo trae en el concepto el número de **otra** factura.
- Los otros 6 no traen número («FACTURA PENDIENTE» o nada): no hay nada que los contradiga.
- Después del primer real, la primera cifra pasa a 0 (es uno de sus «esperado:»).

## Un solo real, con vuelta atrás: la 1310 y la 1300

Julio (02/11, respuestas B01·6 y B01·8): los asientos de pago mal casados **se borran**, no se anulan con contraasiento. Se borran con la función de borrado de Sumied de S (`_conta_asientos_borrar`, la 1837 del #449, ya en producción). Así la tanda tiene vuelta atrás, deja de ir sola y va en un solo real.

**1310 · el arreglo de fondo** (va primero):
1. **Bancos no casa con una factura anulada o descartada.** `_bank_casar_nucleo`, el texto de producción (246d303a, con guarda), lleva una comprobación más. Misma firma. La de antes, al respaldo.
2. **`_bank_casado_soltar`** (nueva): suelta un casado para borrar su asiento sin contraasiento.
   - Lo marca deshecho, con su motivo.
   - Le quita el asiento y quita el asiento de pago de la factura. Su pago lo quita el disparador de siempre.
   - Deja el movimiento por casar.
   - La función de borrado de S no borra un asiento que algún casado nombre, aunque esté deshecho: por eso hace falta soltarlo antes.
3. **Anular o descartar una factura la descasa:**
   - con el asiento propuesto, `bank_deshacer` lo quita;
   - con el asiento validado, se suelta y **se borra** con la función de S, con su regla de fechas: nunca antes del corte, ni lo enviado a Diez, ni lo declarado. Si no se puede, la anulación para con su motivo («No se borra nada. …»);
   - el movimiento queda «Por aclarar» con «Su factura X se anuló el dd/mm/aaaa…».
4. Una propuesta de otro motor se recalcula antes de aceptarla (front, `MOTOR_BANCOS`).

**1300 · los datos de Olimpo** (va después; usa `_bank_casado_soltar`):

| | Antes | Después |
|---|---|---|
| −363,67 del 26/10 | casado con la 26/13028 (anulada) | casado con la **26A/10966** |
| −170,10 del 26/10 | «a cuenta» de Olimpo | casado con la **26A/10965** |
| Asientos 4/3312 y 4/3310 | validados | **borrados** con la función de S: respaldo, la serie 4 renumerada y la cadena recalculada |
| 26A/10966 y 26A/10965 | aprobadas, sin pagar | **pagadas el 26/10** |
| 26/13028 | anulada, con asiento y pago | anulada, sin asiento ni pago |

- **El orden:** suelta los dos casados, borra los dos asientos y casa cada pago con su factura (`bank_casar`).
- **Quién:** la persona que aceptó las propuestas (su id se lee del casado), solo dentro de la transacción. Los asientos de pago nuevos, «Por validar».
- **Las anclas:** si algo no es como se midió, o la 26A/10965 no está aprobada, para. Si ya está hecho, no hace nada.
- **La vuelta atrás** (`…1300….down.sql`):
  1. deshace los casados nuevos;
  2. devuelve los dos asientos desde el respaldo de la función de S, con su número y su huella;
  3. deja los casados, los movimientos y el pago de la 26/13028 como estaban, desde `conta_b01o_antes`.
- **Lo que cuenta** (`scripts/conta/produccion/cuentas/b01o-olimpo.sql`): siete medidas de lo que falta por arreglar. Antes: 1, 1, 1, 1, 2, 1 y 1. Con la tanda, 0. Con la vuelta atrás, como antes.

**Contexto:** medido el 02/11 a las 18:59Z.
- El núcleo con su huella (246d303a); `supplier_invoice` con 297 filas.
- Nada de lo nuevo existe todavía.
- Nada en el camino del pedido; nada en el historial.
- Las dos facturas, aprobadas y sin pagar; los dos casados, vivos.
- **El analizador dice «sigue» para las dos**, sin `autorizo`. La 1300 mueve filas solo a través de funciones, dentro de un DO.

## Pruebas

- **Staging** (`supabase/staging/sql/20261102_b01o_olimpo_prueba.sql`, ROLLBACK, cuenta D, IBAN del banco 9999), en verde en la base local del W09 (que no tiene la 2030: la carga dentro):
  - la 1300 en una base sin Foodint;
  - **antes = después** de casar un pago con su factura, con el núcleo de antes y con la 1310: lo que devuelve, la factura pagada, el casado y el asiento con sus líneas;
  - con una anulada o una descartada, para y lo dice;
  - anular facturas casadas: con el asiento propuesto (se quita) y con el validado (**se borra** con la función de S: sin contraasiento, en el respaldo y con la cadena íntegra), y el pago a «Por aclarar» con su motivo;
  - descartar, igual;
  - nadie de fuera llama al disparador ni al núcleo;
  - la vuelta atrás deja el núcleo byte a byte (246d303a) y quita el disparador.
- **La prueba no es un espejo:** quitando a propósito la comprobación nueva del núcleo, sale en rojo («se ha casado un pago con una factura anulada»).
- **La 1300 solo se puede ensayar contra Foodint:** la prueba es el ensayo de producción (ROLLBACK), con sus anclas y sus «esperado:».
- **Unitarias:** `motorBancosVersion.test.ts`.
- `scripts/conta/antes-de-subir.sh`: los 10 pasos en verde.
- **e2e:** la de la zona en cada push.

## Mientras tanto

**No pagues la 26A/10966 ni la 26A/10965 en Pagos:** las dos están ya pagadas en el banco. Después del primer real salen pagadas y dejan de aparecer.

## Funciones a desplegar a mano

### Sumied

ninguna

### Folvy

ninguna

## Producto

- Sumied
