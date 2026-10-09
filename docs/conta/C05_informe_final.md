# C05 · Libros y balances — informe final

Rama `conta/c05-libros-y-balances`, PR #169. Todo probado en staging-conta;
**nada en producción** hasta el visto bueno de Julio.

## Qué hay

**Pantallas (Libros, en tres niveles, N13c)**
- Áreas, barra de acciones con su estado, favoritos y «Buscar» (Ctrl K).
- En el móvil, por niveles. El libro diario del C04 sigue en su ruta, ahora dentro del marco.

**Diario y mayor**
- Libro diario y diario resumido.
- Libro mayor: saldo inicial con la apertura, arrastre, filtros de local y marca.
- Sumas y saldos: las siete opciones de Diez y el rango de cuentas.
- Acumulados.

**Libros registro del IVA (N15)**
- Expedidas, recibidas e intracomunitarias, con cuatro cifras arriba: base, cuota, cuadre con la 477/472 y anotaciones por completar.
- El resumen de tiques sale como **«F4 · resumen · art. 63.4 · primero–último · n tiques»**.
- Lo que no vale para un requerimiento sale en ámbar, con «Completar».
- El listado de facturación de Diez son filtros del libro:
  - subcuenta, NIF, «importe superior a» y tipo de factura;
  - «agrupar por NIF» y «solo las del 347».
  - Con filtros puestos, la cabecera dice «N de M» (regla 7).
- Formato AEAT: el Excel con las hojas y columnas del diseño, acumulado del 1 de enero al final del trimestre, y el zip de documentos con su índice.
- Bienes de inversión (con alta), retenciones por modelo y trimestre, y suplidos.

**Balances y cuentas anuales (N14)**
- Balance, PyG (oficial, detallada y por local) y ECPN, con la columna del año anterior y la barra de la IA.
- Cuentas anuales: el modelo propuesto, con sus cifras y su cita (LSC 257.1/258.1), y la elección.
- Mapeo: cambiar, dejar fuera, volver al estándar e historial.

**Cierre**
- Ejercicios y cerrar el mes.
- Regularización, cierre y apertura: Folvy los calcula y los propone; se validan en el libro diario. Después se cierra el ejercicio, y se puede reabrir con motivo.

**Agente «Libro diario» (C05)**
- Rojos:
  - el balance cuadra a cada fin de mes;
  - ninguna cuenta con saldo sin línea (la 774 en pymes, con su porqué);
  - 6/7 a cero tras regularizar;
  - libro registro = 477/472 por trimestre;
  - ningún ejercicio cerrado con asientos nuevos.
- Avisos: cuentas que el mapeo propio deja fuera con saldo, cuentas colocadas por defecto y «Otros resultados» (la memoria tiene que explicarlos; va al C05b).

## Migraciones (orden para producción)

| Fichero | Qué hace | W01 |
|---|---|---|
| `20261014T0100_c05_libros.sql` | Tablas nuevas (modelos y mapeo, libro registro, bienes de inversión, cierre) y sus funciones. | añade |
| `20261014T0110_c05_modelos_serie.sql` | La serie de los tres modelos, GENERADA desde el BOE. | añade |
| `20261014T0120_c05_cambia.sql` | El disparador del libro registro en `journal_entry`, y `conta_resultado_por_local` sin la regularización. | **cambia** (cabecera y prueba) |
| `20261014T0130_c05_modelo_elegido.sql` | El modelo que elige cada empresa por ejercicio. | añade |
| `20261014T0140_c05_validar_cierre.sql` | `journal_entry_validar`: el cierre y la apertura del generador, enlazados, y su contraasiento, sin la regla de IVA. | **cambia** (cabecera y prueba) |
| `20261014T0150_c05_lectura.sql` | `conta_lectura` lee las 9 tablas del agente. | añade |

Cada una lleva su `.down.sql` en `supabase/vuelta-atras/`. Las dos «cambia» devuelven el texto anterior tal cual. El de `journal_entry_validar` coincide con producción: md5 del cuerpo `a391885c…` en producción y en staging antes del C05.

## Probado en staging (run 37856173465, verde)

```
PRUEBA C05 · 0 en verde: 510 en «Otras deudas a corto plazo», 2935 en V, ninguna cuenta con dos líneas.
PRUEBA C05 · 1 en verde: 15 cuentas, Debe = Haber = 8377.05.
PRUEBA C05 · 2 en verde: 6290 de «7» a «OR», fuera, y de vuelta al estándar; 3 filas de historial.
PRUEBA C05 · 2e en verde: un ajeno recibe 42501.
PRUEBA C05 · 3 en verde: elegido «abreviado»; con la empresa de otra cuenta, rechazado (Esa empresa no es de esta cuenta).
PRUEBA C05 · 4a2 en verde: closing suelto rechazado (No se valida: apunte 1 (47510000): una retención lleva su tipo, su base y su modelo; …).
PRUEBA C05 · 4 en verde: resultado -6754.19 a la 129; cierre con 10 apuntes; cerrar rechaza sin validar y con propuestas; cerrado no admite asientos (El ejercicio 2026 está cerrado.); reabierto con 2 anulados.
PRUEBA agente C05 · 1 en verde: 17 cuentas con saldo, 3 anotaciones del libro registro, nada en rojo.
PRUEBA agente C05 · 3 en verde: ve las siete (cuadre 2, sin sitio 1, fuera 1, otros resultados 1, pyg 1, libro 1, cerrado 1).
```

Y el paso 5, añadido después (run 37863100931, verde):

```
PRUEBA C05 · 5 en verde: el expedidor sale del tercero (NIF B91000026, «Bebidas Sol»).
```

(Un tercero inventado de la semilla del C01.)

La prueba del cierre destapó **tres fallos de verdad**; los tres están arreglados y probados:
1. **No se podía cerrar.** El validador del C04 exigía IVA a los apuntes de 472/477/4751 del cierre y de la apertura. Lo arregla la 0140 (respuesta 3).
2. **No se podía reabrir.** El contraasiento del cierre chocaba con la misma regla. La 0140 también lo cubre, mirando el asiento original enlazado.
3. **Tras reabrir, la pantalla habría regularizado dos veces.** Ahora reutiliza la regularización validada y, si queda saldo, para y explica por qué.

Y la semilla destapó un cuarto: en el libro registro, una rectificativa salía con la base en positivo y la cuota en negativo. Ahora las dos van en negativo (0100).

## Pruebas

- Unitarias de conta: 648 en verde. Las nuevas:
  - el núcleo C05 contra el cuadro real;
  - las columnas de la AEAT sacadas del diseño bajado;
  - las correctoras (59 parejas en tres modelos);
  - la 510;
  - el zip, comprobado con `unzip`.
- Cada prueba nueva se rompió a propósito al menos una vez para ver que falla (la del zip, la de las correctoras, la tolerancia de la serie).
- Agente: el juez puro con el volcado real de staging. Además, la prueba de staging que rompe una cosa por comprobación.
- e2e A/B, ordenador y móvil: `tests/e2e/conta/c05/libros.spec.ts` (10 pruebas) y `rls.spec.ts` (B no ve ni toca nada de A: 7 tablas, 2 altas, 5 funciones y los saldos).
  - **e2e 153 en verde** (sobre `09426b8`): 135 pasan, 51 se saltan (las de un solo tamaño de pantalla y las que solo tienen sentido una vez), 0 fallan. Las capturas, comparadas con N13c, N14 y N15 una a una, en `docs/conta/capturas/c05/COMPARACION.md`.
  - **La 152 salió en rojo** por tres pruebas, las tres mías:
    1. `c02/ficha` y `c02/plan` esperaban 1.283,15 € de Hermanos Ruiz. La rectificativa de la semilla C05 (−55 €) lo deja en 1.228,15 €: medido en staging; se cambió la cifra esperada.
    2. `c05/rls` filtraba `investment_good_regularization` por `company_id`, que no existe en esa tabla (cuelga de la cuenta). Regla 40: el nombre iba dentro de una cadena; el resto de nombres del fichero se comprobó contra staging.
  - **Las capturas de la 153 enseñaron cinco fallos de pantalla**, arreglados después (detalle en `COMPARACION.md`):
    - «1 anotaciones.»;
    - la PyG por local escondía el local sin apuntes (regla 7);
    - la barra de acciones de Cuentas anuales no cabía a 1440;
    - subtítulos a 32 px;
    - en el mapeo, «700cambiardejar fuera».
  - La e2e vigila los dos primeros. **e2e 154 en verde** (sobre `686e7b7`): las capturas nuevas los enseñan arreglados.
  - En la 154 quedaba uno: en Libros registro de IVA, «Tuyos» bajaba sola a una segunda fila. Cerrado tras el visto bueno: «Tuyos» ya no puede bajar sola y la barra cabe en una fila, como en N13c (detalle y medida en `COMPARACION.md`).
- Prueba de staging, paso 5 nuevo: el expedidor del libro registro sale del tercero del asiento (NIF y nombre). No lo probaba nada; las semillas proponen sin tercero.

## Lo que cambió algo que ya existía (aviso, según la respuesta 3)

- La **0120** (aceptada en la respuesta 3) y la **0140**.
- La 0140 cubre también el contraasiento de un cierre o una apertura del generador. Sin eso no se puede reabrir; es la misma familia que Julio aprobó.
- `scripts/conta/serie.mjs`: tolera que solo cambie la **procedencia** de una fuente (huella y fechas) sin regenerar la migración del C00, que ya está aplicada en producción con su huella. Hacía falta tras el #168: `main` también fallaba ese paso. Un valor distinto sigue fallando.
- Los workflows nocturnos (staging y producción) corren la parte C05 del agente solo si la base la tiene.
- `e2e-staging-conta.yml` pasa a `cancel-in-progress: false` (respuesta 3). La regla queda en `CLAUDE.md`.
- `c02/ficha.spec.ts` y `c02/plan.spec.ts`: la cifra esperada de Hermanos Ruiz pasa a 1.228,15 € por la rectificativa de la semilla C05.
- La 0100 y la 0110 se tocaron después de aplicarse en staging. **No están en producción**, así que allí entran ya buenas; en staging se volvieron a pasar.

## Decisiones de la respuesta 3, hechas

- **2935 (y la 5935) van con la cuenta que corrigen**, en inversiones financieras. La regla de las correctoras está escrita en `contraste.md` y la prueba recorre todas.
- **La 510 va a «Otras deudas a corto plazo»**, colocada por defecto y con «Completar». La misma regla mueve la 160, la 162 y la 512.
  - La regla se probó primero en general, a toda cuenta de 3 cifras, y daba disparates: 103, 630, 552.
  - Se queda solo para deudas con partes vinculadas.

## Para el C05b

- Memoria y certificación, legalización (Legalia) y depósito (Orden JUS/616/2022): las pantallas dicen que llegan en el C05b.
- «Otros resultados» con saldo: el agente lo apunta para la memoria.
- La numeración de la PyG de Diez parece la del modelo de depósito. Se cruza casilla a casilla en el C05b.
- Sumas y saldos por correo: no está; queda apuntado.

## Para producción (lo lanza Julio)

1. Tanda de `aplicar-produccion-conta.yml` con los seis ficheros, en el orden de la tabla. **Preparada** en esta rama:
   - `supabase/produccion/aplicar.txt` y `vuelta-atras.txt`, este con los `.down.sql` al revés.
   - Analizador pasado en local contra el contexto de producción, leído en solo lectura: los seis «sigue», ninguno pide `autorizo`.
   - La 0120 y la 0140 son «cambia»: pasan con su cabecera y su prueba de staging.
   - Ninguna toca el camino del pedido, así que no piden `autorizo`. Lo que diga el analizador en el ensayo manda.
2. Fusión de #169 y Vercel READY en producción.
3. El nocturno de producción corre ya la parte C05 la noche siguiente. Si `vat_book_entry` aún no existe, no la corre y lo dice.
