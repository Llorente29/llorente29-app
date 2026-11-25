# Pendiente · un solo modelo de negativos

**Deuda declarada (Julio, 25/11, X14 · 2):** un solo modelo de negativos en el diario.

- **Desde el X14 · 2**, `journal_line` admite importes negativos (un solo lado distinto de 0, con cualquier signo). Lo
  traído de ERP10 entra tal cual, en negativo, como en ERP10, y Sumied los usa también al contabilizar.
- **Lo traído de Diez (Foodint) sigue con el modelo de antes:** el negativo se pasó al otro lado en positivo
  (`diezMapeo.ts`: debe −10 = haber 10) y la línea guarda en qué lado de Diez iba (`journal_line.external_negative_side`,
  'debe' o 'haber'; Libros la marca «En Diez iba en negativo»).
- **Hoy conviven los dos.** Lo de Diez está marcado en `external_negative_side` y se puede convertir: una línea con
  `external_negative_side = 'debe'` y su importe en el haber pasa a −importe en el debe (y al revés), sin cambiar el saldo de
  ninguna cuenta. Convertirlo es otra tanda (rehace lo ya traído de Foodint) y su testigo de Diez (`diezTestigo.ts`) dejaría
  de necesitar «la diferencia es lo pasado de lado».

## La salida a ERP10 de asientos con negativos (a K, después del X33)

`erp10Escribir.ts` y `erp10Ficheros.ts` no mandan un asiento con un importe negativo («Lleva un importe en negativo, y ERP10
los quiere en positivo. Métela a mano en ERP10.»). Lo deja escrito una unitaria
(`tests/conta/x14/negativosSalidaErp10.test.ts`). Hay que medir si la API de ERP10 los admite: lo que se lee de ERP10 (el 2024
de QBO) los trae en negativo.
