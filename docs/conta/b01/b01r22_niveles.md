# B01·22 · El nivel de cada propuesta del banco: cómo se lee

Julio, B01r_22 (12/11) y los cambios a la regla (13/11). El código está en
`supabase/functions/_shared/bancos/nivel.ts`, y sus pruebas, con casos reales, en
`tests/unit/modules/conta/nivelB01r22.test.ts`.

## Los niveles

| Clave | Etiqueta | Cuándo |
|---|---|---|
| `centimo` | Seguro · coincide al céntimo con la factura X | UNA sola factura (de tipo factura: nunca un albarán ni un abono), aprobada, por el importe exacto y sin diferencia. Si el concepto del banco nombra un número de factura, tiene que ser ésa. |
| `confirmado` | Seguro · confirmado 3 veces | Solo lo que va contra una cuenta (nunca un pago de factura). El mismo tercero, validado contra las mismas cuentas las 3 últimas veces **seguidas** y sin corrección por medio. |
| `camino` | Míralo · 2 de 3 · Míralo · son 2 facturas · Míralo · el banco dice la factura X… | Lo demás que se propone, con lo que le falta para ser seguro. |
| `nunca` | Nunca sola · nóminas / socios / impuestos o Seguridad Social / préstamos / mes cerrado / más de 1.000 € | Aunque cuadre, lo mira una persona. |
| `nose` | No lo sé | No hay propuesta: dice lo que falta. |

**Corrección:** la persona casa algo distinto de lo que propuso el motor.
- Pone el contador a cero.
- La racha se corta en la primera corrección y en la primera validación contra
  otras cuentas.

**Mes cerrado:** es el cierre del banco (`bank_month_close`). Hoy no hay ninguno
en producción.

## Dónde se guarda y cómo se lee (para «Para hoy», S01p_19)

El nivel se guarda dentro de la propuesta, en `bank_movement.proposal->'nivel'`.
Lo escribe cada pasada del motor: la de la noche, la de quien abre Bancos y la de
subir un extracto.

```json
{ "clave": "confirmado", "etiqueta": "Seguro · confirmado 3 veces",
  "porque": "Las 3 últimas veces de IBERDROLA CLIENTES las validaste contra Luz y agua · 62800000 sin cambiarlas.",
  "seguro": true, "veces": 3 }
```

- **Qué movimientos tienen nivel:** los que están en `propuesto` o `por_aclarar`.
  Una propuesta de antes del 13/11 no lo tiene (`nivel` vacío): sale en la
  siguiente pasada.
- **Qué se enseña:** `etiqueta` es lo que va en la línea, y `porque`, la frase de
  debajo. No hace falta traducir nada: no llevan códigos ni porcentajes.
- **Cómo se ordena:** primero `seguro = true` (lo que se puede confirmar de un
  vistazo), después `camino`, después `nunca` y al final `nose`.

```sql
select m.id, m.op_date, m.amount, m.proposal->'nivel'->>'etiqueta' etiqueta, m.proposal->'nivel'->>'porque' porque
  from bank_movement m
 where m.account_id = :cuenta and m.company_id = :empresa and m.status in ('propuesto', 'por_aclarar')
 order by (m.proposal->'nivel'->>'seguro')::boolean desc nulls last, m.op_date;
```

## El interruptor: apagado

`bank_settings.seguro_solo` lo enciende o lo apaga por empresa. Vacío o `false`
quiere decir apagado, y así se queda. Mientras esté apagado, el nivel no casa
nada. Lo que el motor ya casaba solo antes de la B01·22 sigue igual: los
traspasos con pareja y la factura con su referencia.

`bank_settings.seguro_limite` es el límite de «Nunca sola». Vacío quiere decir 1.000 €.

## La medida que decide encenderlo

Cada vez que una persona casa una propuesta con nivel, Bancos apunta en
`bank_nivel_veredicto` si la casó **tal cual** (`tal_cual = true`) o la cambió.
Solo cuentan los movimientos nuevos, no los 257 de octubre y noviembre:

```sql
select nivel, count(*) casados, count(*) filter (where tal_cual) tal_cual, count(*) filter (where not tal_cual) cambiados
  from bank_nivel_veredicto
 where account_id = :cuenta and company_id = :empresa and nivel in ('centimo', 'confirmado')
 group by nivel;
```

## La medida contra lo casado de octubre y noviembre (Foodint)

Son los 257 movimientos casados y validados hasta las 22:55Z del 12/11. La
consulta está en `b01r22_medida_niveles.sql`, con la regla final:

| Nivel | Movimientos | Acierta | Falla |
|---|---:|---:|---:|
| Casado solo por Folvy (sin proponer) | 71 | — | — |
| Seguro · coincide al céntimo | 6 | 6 | 0 |
| Seguro · confirmado 3 veces | 7 | 7 | 0 |
| Míralo · 2 de 3 | 16 | 16 | 0 |
| Míralo · 0 de 3 | 21 | 7 | 14 |
| Míralo · factura, liquidación o traspaso | 34 | 29 | 5 |
| Nunca sola | 5 | 1 | 4 |
| No lo sé | 97 | — | — |

## Los 97 «No lo sé», por lo que faltaba (lo siguiente que hay que atacar)

La consulta está en `b01r22_no_lo_se.sql`.

| Le faltaba | Casado como | Movimientos | Euros |
|---|---|---:|---:|
| su liquidación | cuenta | 47 | 10.993,72 |
| el ticket | cuenta | 17 | 933,70 |
| la factura | cuenta | 15 | 18.452,34 |
| de quién es | cuenta | 4 | 22.024,93 |
| de quién es | traspaso | 4 | 3.076,61 |
| la factura | traspaso | 3 | 1.002,00 |
| de quién es la tarjeta | cuenta | 2 | 200,00 |
| el modelo y el periodo | cuenta | 2 | 1.647,03 |
| que me digas si es esta factura | cuenta / factura | 2 | 58,48 |
| (una persona lo casó antes de la primera pasada) | cuenta | 1 | 100,00 |
