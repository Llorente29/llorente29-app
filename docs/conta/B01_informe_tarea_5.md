# B01 · Parte de la tarea 5 (pantallas), parado antes de la 6

Rama `conta/b01-bancos`. Respuesta 3 de Julio (13/10/2026): «Sigue con la tarea
5 (pantallas) y para antes de la 6 con capturas de ordenador y de móvil de la
cuenta de A en staging, comparadas con la maqueta.» Todo con datos inventados.

## 1. Lo que hay

| Pieza | Dónde | Estado |
|---|---|---|
| Tarjetas de débito (respuesta 3, punto 1) | `20261101T0140_b01_tarjetas.sql`, motor (`conciliacion.ts`), `bancosNucleo.ts` | En staging; prueba **7 de 7** (run de aplicar del 13/10, 17:33 UTC) |
| `bank_casar` con el local de la tarjeta | `20261101T0110_b01_funciones.sql` (misma firma) | En staging; prueba de bancos otra vez **13 de 13** |
| Serie de tesorería (punto 3.1) | `asientosPropuestos.ts`, `propuestasLibroService.ts` (compartidos) | Hecho; ver §3 |
| Fuentes solo las tocadas (punto 3.2) | `fuentes-oficiales-conta.yml`, `fuentes.mjs` (compartidos) | Hecho |
| Contraste con Sage y veredicto (punto 2) | `docs/conta/contraste.md` | Hecho; ver §4 |
| Pantallas N17 y las cinco sin maqueta, móvil M4 | `src/modules/conta/bancos/` | Hecho; capturas en §5 |
| Pruebas | `bancosVistaB01.test.ts` (16), `conciliacionB01.test.ts` (42), `bancosB01.test.ts` (39); e2e `tests/e2e/conta/b01/pantallas.spec.ts` | Unitarias en verde (2.860 del repositorio); e2e en §5 |

## 2. Tarjetas de débito

- **Alta en «Cuentas y extractos»**, como medio de pago de su cuenta: los 4
  últimos dígitos, quién la lleva y su local (o «común»). La base solo admite
  cuatro cifras (`CHECK last4 ~ '^[0-9]{4}$'`): el número entero no entra ni
  pegado (la prueba lo intenta con `4111 1111 1111 4821` y lo rechaza).
- **El motor** reconoce la tarjeta por sus dígitos en el concepto del Norma 43.
  Dada de alta: «Tarjeta de Ana (···4821): pídele el ticket.», y el casado lleva
  el **local de la tarjeta** en sus líneas aunque la cuenta sea común. No dada de
  alta: «Por aclarar: tarjeta acabada en 1234, ¿de quién es?», con el botón
  «Dar de alta la tarjeta» que abre el alta con esos 4 dígitos ya puestos.
- **Pruebas** (las que pidió Julio): dos tarjetas inventadas en la misma cuenta,
  cada pago a su titular (unitarias y la de staging, paso 2); una no dada de
  alta → la frase literal (unitaria y e2e en Banco B01 · Mercado).
- **Ticket por foto**: bucket privado `banco-tickets`, la ruta empieza por la
  cuenta y el movimiento; la base comprueba que el fichero existe en SU carpeta.
- Tarjetas de crédito: lo hecho se queda en la base y en el lector; **ninguna
  pantalla** las enseña.

## 3. Coordinación (respuesta 3, punto 3)

1. **Serie 3 → serie de tesorería.** «Pago a…» y el cobro de liquidación
   proponen en `bank_settings.treasury_series` de la empresa; sin ajuste, la 3
   de siempre. Cambio pequeño en **dos ficheros compartidos**
   (`asientosPropuestos.ts`: tipo `SerieTesoreria` y `serie: c.serieTesoreria ?? 3`
   en las tres propuestas; `propuestasLibroService.ts`: lee la serie y la pasa).
   **Prueba de que ventas no cambia**, con la misma vara antes y después
   (regla 31), en producción y solo leyendo:
   ```
   antes  (13/10, mañana): series 1 · sales_day · propuesto · 50 · md5 577331bd83ee711a6d6892f5d4e18d5d
   después (13/10, 18:00 UTC): series 1 · sales_day · propuesto · 50 · md5 577331bd83ee711a6d6892f5d4e18d5d
   ```
   Dicho como es: producción aún no tiene este código, así que la huella prueba
   que no se ha tocado nada allí; lo que prueba el código son las unitarias:
   `ventasDelDia` no recibe la serie de tesorería (la 1 va escrita) y su prueba
   del C04 sigue en verde (`libroC04.test.ts:113`, `serie` 1); pago y cobro van
   a la 4 con el ajuste de Foodint y a la 3 sin él (`conciliacionB01.test.ts`, P3).
2. **`fuentes.json`.** En un push, el workflow solo baja las fuentes nuevas o
   tocadas en ese push (`node scripts/conta/fuentes.mjs tocadas`); una fuente
   ya registrada que cambie en origen no se sobrescribe en la rama: la vigila el
   informe nocturno. Ficheros compartidos: `fuentes-oficiales-conta.yml` y
   `fuentes.mjs`.
3. **Pruebas de cierre a las 6:00**: no las he tocado. Siguen fallando en cada
   e2e (cuatro, ordenador y móvil), igual que antes de mi rama.
4. **e2e que se pisan.** Hasta que esté lo de C, no lanzo la mía con otra en
   marcha. **Hoy lo he incumplido una vez y lo digo:** a las 17:55 UTC empujé las
   pantallas con la e2e de `conta/c06-sola` (run 38442480331) arrancada un
   minuto antes; la comprobación estaba en el mismo comando que el push y no lo
   paré. Cancelé la mía (run 38442647403) a los 80 segundos, sin ninguna prueba
   ejecutada, pero **ya había cambiado la contraseña de los usuarios de prueba**,
   así que el run de C06 pudo fallar por mí desde ese minuto. Si falló, hay que
   repetirlo. Desde entonces, la comprobación va en un paso aparte y el push
   solo sale si devuelve vacío.
5. `tsconfig.node.json` y P2: aceptados, sin cambios.

Otros ficheros compartidos tocados en esta tanda (todos pequeños):

| Fichero | Cambio |
|---|---|
| `src/config/navegacion.ts` | rutas `bancos` y `bancos/:pestana`; Bancos con ruta en el menú y en la barra del móvil; `rutaBancos()` |
| `tests/unit/modules/conta/marcoC00.test.ts` | la lista de entradas con pantalla incluye ahora `bancos` |
| `src/modules/conta/marco/useCuentasMenu.ts` | el número de Bancos: movimientos para confirmar y por aclarar (lo que pide una decisión, regla 7) |
| `src/modules/conta/estilo/tokens.css` | dos tonos de la maqueta: `--cx-ambar-fila` (#FFFBF3) y `--cx-ambar-punto` (#F2B544) |
| `src/modules/conta/module.tsx` | las dos rutas de Bancos |
| `.github/workflows/e2e-staging-conta.yml` | entrada opcional `ruta` al lanzarlo a mano (solo rutas de `tests/e2e`): permite sacar las capturas de un frente sin esperar a que pasen las de los demás. Sin `ruta`, igual que antes |

## 4. Contraste

En `docs/conta/contraste.md` («Veredicto pieza a pieza»): Sage 50 y 200
añadidos (lo que devuelve el buscador; sus páginas no resuelven desde el
contenedor, y se dice), y una fila por pieza con «por encima / igual / por
debajo». **Por debajo: la conexión directa con el banco** (Holded, a3innuva,
Sage, Pennylane y ContaSOL la tienen). Propuesta para que la subida sea un solo
gesto, ya construida en esta tarea: soltar el fichero en cualquier pantalla de
Bancos, un fichero para varias cuentas, y el IBAN recordado. El envío por correo
queda propuesto para cuando exista el buzón (E01). El 74,9 %: nadie de los
consultados publica cifra, así que no se compara.

### El 22,1 % sin resolver (producción, solo recuentos, solo Foodint)

Los 430 apuntes de banco de 2026 en los que lo aprendido no proponía nada,
agrupados por la cuenta a la que fueron. Y cuántos resolvería una regla por
contraparte (las que propone Folvy: lo que se repite al menos dos veces con el
mismo nombre en el concepto, no el concepto entero):

| Grupo | Sin resolver | La regla acierta | La regla falla | Siguen sin nada |
|---|---:|---:|---:|---:|
| Pagos a proveedores y acreedores (400/410) | 145 | 56 | 11 | 78 |
| Compras y gastos sueltos (6xx) | 134 | 29 | 10 | 95 |
| Cobros de clientes y plataformas (430) | 79 | 44 | 0 | 35 |
| Nóminas, Seguridad Social e impuestos (465/47x) | 32 | 9 | 4 | 19 |
| Préstamos, socios y cuentas corrientes (52x/17x/55x) | 26 | 2 | 7 | 17 |
| *Anticipos (407) y resto* | *14* | *0* | *0* | *14* |
| **Total** | **430** | **140** | **32** | **258** |

Con las reglas propuestas, lo que no tiene propuesta baja de **430 (22,1 %) a
258 (13,3 %)**; a cambio, lo que se propone mal sube de 58 (3,0 %) a 90 (4,6 %).
Todo eso entra como «para confirmar», nunca como seguro, así que un fallo es un
«Otra cosa», no un asiento mal hecho.

**Las tarjetas no se pueden medir sobre esta población, y lo digo:** el concepto
que se mide es el que escribió quien llevaba la contabilidad en Diez («BBVA
AMAZON…»), no el del banco, y no trae los dígitos de la tarjeta. Además, una
tarjeta dada de alta no dice a qué cuenta va un gasto: dice **quién lo pagó y a
quién pedirle el ticket**. Lo que cambia es el «Por aclarar» de los pagos con
tarjeta (dentro de los 134 del grupo 6xx): pasan de «falta el ticket» a
«pídele el ticket a Ana». El 22,1 % no baja por eso; baja el tiempo de aclararlo.

## 5. Pantallas

### Lo construido

- **Bancos en tres niveles** como Libros (N13c): pestañas Movimientos · Reglas ·
  Cuentas y extractos · Cierre del mes; barra TUS BANCOS (cada banco con «···
  0011 · al día» o «3 dudas») · TRAER MOVIMIENTOS (Subir extracto · Norma 43 ·
  Excel; Conectar · pronto, en gris y sin pulsar) · AUTOMÁTICO (Reglas · N · M
  nuevas; Hecho por Folvy · N este mes) · TUYOS (favoritos y Ctrl K).
- **Movimientos (N17)**: migas con el banco, segmento Para confirmar · Por
  aclarar · Todo, «Subir extracto», «Sí a los N que propongo»; la banda verde
  con la frase del mes; las cinco cifras; la tabla con el punto y los botones.
  Cada botón confirma con contenido o dice el fallo (regla 8): «Casado:
  Comisión del banco (03/10 de −12,50 €). El asiento queda propuesto en
  contabilidad.»; «Deshecho: el movimiento del 03/10 de −12,50 € vuelve a estar
  sin casar…».
- **Reglas**: lo que propone Folvy con «Guardar la regla» (nace propuesta y la
  persona la acepta: la base no deja a Folvy encender una sola), las reglas en
  palabras con Apagar / Encender, y «Regla nueva».
- **Cuentas y extractos**: una tarjeta por banco con «nombre · código», IBAN,
  local, «Revisa esta cuenta» (P1, nunca solo), IBAN recordados, **tarjetas de
  débito** con alta y baja, y sus extractos con el cuadre y la continuidad.
  Abajo, las cuentas 572 del plan que aún no son un banco, con «Dar de alta».
- **Cierre del mes**: por banco, saldo del banco frente al de contabilidad a fin
  de mes y la diferencia explicada movimiento a movimiento. Sin botón de cerrar:
  es de la tarea 6.
- **Subir extracto**: soltar el fichero en cualquier pantalla de Bancos (o
  elegirlo); «He leído…»; cada cuenta del fichero con su banco (por IBAN o
  recordado; si no se sabe, se pregunta y se recuerda); «Subir las 3 cuentas»;
  y al acabar, lo que se importó y lo que Folvy casó, propuso y dejó por aclarar.
- **Lo que ha hecho Folvy**: el registro del mes con su porqué literal y
  Deshacer; «Y lo de las personas» enseña el registro entero.
- **Móvil (M4)**: portada con los bancos en píldoras, dos botones grandes,
  dos cifras, la frase verde y los apartados de 56 px; la tabla se apila en
  tarjetas, una por movimiento.

### Capturas y comparación con N17

(Se completa con el run de las capturas.)

### Diferencias con la maqueta, una a una

1. **No sale «Tarjeta ··· 1150» en TUS BANCOS** ni «Por correo · activo» en
   TRAER MOVIMIENTOS: son la tarjeta de crédito y el correo, que la respuesta 3
   manda no enseñar.
2. **«Saldo en el banco» dice «extracto hasta el 13/10/2026»**, no «extracto
   de hoy 07:02»: el Norma 43 trae el saldo de un día, no de una hora; la hora
   sería la de subida, que no es la del saldo.
3. **«Ver los 16»**: la maqueta enseña seis filas de dieciséis. Aquí «Todo»
   enseña todas hasta 50 y, si hay más, «Ver los N». Un umbral no esconde
   (regla 7).
4. **«Sí a los N que propongo» solo sale si hay alguno**: «Sí a los 0» no dice
   nada.
5. **El selector del mes** es un desplegable del estilo del módulo (como el del
   ejercicio en Libros), no el botón «Octubre 2026 ▾» de la maqueta.
6. **Las migas** dicen el nombre del banco de Folvy y los 4 últimos del IBAN
   («Banco B01 · Norte · ES·· ···· 0011»), como la maqueta pero con el nombre que
   tiene la cuenta.

## 6. Lo que queda para la tarea 6

El agente «Conciliación» (nada casado dos veces, saldo = 572 al cierre o
diferencia explicada, ninguna regla automática sin registro), la interfaz del
agregador con el proveedor simulado (el contrato ya está en `fuentesBanco.ts`),
el cierre del mes del banco y el informe final con la tanda para producción.
