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

## Primer real: los datos (la 1300, sola)

**Lo que cambia, en el orden en que pasa:**

| | Antes | Después |
|---|---|---|
| El −363,67 del 26/10 | casado con la 26/13028 (anulada, era el albarán) | casado con la **26A/10966** |
| El −170,10 del 26/10 | casado «a cuenta» de Olimpo (saldo del libro) | casado con la **26A/10965** |
| Asiento 4/3312 | validado | anulado, con su contraasiento |
| Asiento 4/3310 (sin tercero) | validado | anulado, con su contraasiento |
| La 26A/10966 | aprobada, sin pagar | **pagada el 26/10**, por transferencia |
| La 26A/10965 | aprobada desde las 12:07, sin pagar | **pagada el 26/10**, por transferencia |
| La 26/13028 | anulada, con asiento de pago | anulada, sin asiento de pago |

**Cómo se hace:**
- Por `bank_deshacer` y `bank_casar`, como la persona que aceptó las dos propuestas el 30/10. Su id se lee del casado, no se escribe; los permisos (`request.jwt.claims`) solo valen dentro de la transacción, como la S01c.
- Si esa persona ya no es administradora de Foodint, para: solo un administrador anula asientos.
- **Los asientos de pago nuevos quedan «Por validar»**, como cualquier casado.
- **Las anclas:** cada movimiento, cada casado, cada asiento y cada factura se comprueban antes de tocar nada (importe, día, concepto, tipo, estado). Si algo no está como se midió el 02/11, para.
  - Si la 26A/10965 no está aprobada, para sin tocar nada.
  - Si ya está hecho, no hace nada. En staging no está Foodint: no hace nada.
- **Sin vuelta atrás, a propósito, y sola en su tanda**, como la 1013 de la S01c: un contraasiento no se borra.
  - El ensayo comprueba las 7 medidas de `scripts/conta/produccion/cuentas/b01o-olimpo.sql` contra sus «esperado:»: las dos facturas «pagada 2026-10-26», cada pago con su factura, los dos asientos «anulado», 0 casados con anuladas y la 26/13028 sin asiento de pago.
  - El workflow pide `autorizo`.
- **Contexto:** medido el 02/11 a las 12:00Z. La 1300 no crea ni altera objetos (todo va dentro de un DO); nada en el camino del pedido; nada en el historial. El analizador dice «sigue» porque no entra en las llamadas a funciones.

## Segundo real: el arreglo de fondo (la 1310, con vuelta atrás)

Después del primero, la carpeta de la tanda pasa a llevar la 1310.

1. **Bancos no casa con una factura anulada.**
   - `_bank_casar_nucleo` (el texto de producción, md5 `246d303a`, con una guarda que para si no es ese) con una comprobación más: con una factura anulada o descartada, para con «La factura X está anulada: no se casa un pago con ella. Vuelve a calcular la propuesta de este movimiento».
   - Misma firma. La de antes, al respaldo.
2. **Al anular o descartar una factura, lo que tenía casado vuelve a «Por aclarar».**
   - Un disparador sobre `supplier_invoice` deshace cada pago casado con ella (`bank_deshacer`): el asiento propuesto se quita; el validado se anula con su contraasiento.
   - El movimiento queda «Por aclarar» con «Su factura X se anuló el dd/mm/aaaa: este pago vuelve a estar por casar. Cásalo con la factura buena».
   - Anular un asiento validado solo lo puede un administrador: si anula un encargado, la anulación para y lo dice.
3. **Una propuesta guardada se vuelve a calcular antes de aceptarla, si el motor ha cambiado** (front, sin base):
   - el motor lleva versión (`MOTOR_BANCOS`, `conciliacion.ts`) y cada propuesta guarda la suya;
   - «Sí», «Confirmar los N» o el ticket, con una propuesta de otra versión (o de antes de hoy, sin versión): no casa, vuelve a pasar el motor por lo pendiente y dice «Esta propuesta se calculó con una versión anterior de Sumied y se ha vuelto a calcular con la de hoy. Mírala otra vez antes de confirmarla»;
   - **la versión sube con cada cambio del motor:** `motorBancosVersion.test.ts` fija la huella de `conciliacion.ts` con su versión y sale en rojo si el fichero cambia y la versión no.

**La 1310 en el analizador**, con el contexto medido el 02/11 a las 12:04Z:
- **sigue**, sin `autorizo`;
- cambia `_bank_casar_nucleo` y el disparador sobre `supplier_invoice` (297 filas), los dos declarados en la cabecera con su prueba;
- nada en el camino del pedido.

## Pruebas

- **Staging** (`supabase/staging/sql/20261102_b01o_olimpo_prueba.sql`, ROLLBACK, cuenta D, IBAN del banco 9999), en verde en la base local del W09 (que no tiene la 2030: la carga dentro):
  - la 1300 en una base sin Foodint;
  - **antes = después** de casar un pago con su factura, con el núcleo de antes y con la 1310: lo que devuelve, la factura pagada, el casado y el asiento con sus líneas;
  - con una anulada o una descartada, para y lo dice;
  - anular facturas casadas: con el asiento propuesto (se quita) y con el validado (contraasiento), y el pago a «Por aclarar» con su motivo;
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
