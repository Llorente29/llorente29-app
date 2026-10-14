# C06 · Respuesta 4 — retoques y primera tanda (preparada, sin lanzar)

Rama `conta/c06-sola`. **Nada lanzado en producción.** Los retoques están en
verde en staging; la tanda, medida y analizada contra producción, con los
valores del ensayo listos para copiar (§3).

<!-- RESULTADOS -->

## 1 · Retoques

### 1.1 · El plan, dentro del alta

- **La pregunta.** Después de «¿Prefieres el plan de pymes o el general?»,
  «**¿De qué programa vienes?**» con la lista: Cegid Diez, Holded, Sage, a3,
  ContaSol, Quipu, Otro y Empiezo de cero. «Otro» pide su nombre («Dime cuál:
  escribe su nombre abajo»); también vale escribirlo directamente. Escrito
  con sus palabras («usábamos cegid», «empiezo de cero») se entiende; si nombra
  dos de la lista, no se adivina: queda como «Otro» con lo que escribió.
- **Lo que se dice con cada respuesta** (`src/modules/conta/alta/programa.ts`):
  - Cegid Diez: «Vienes de Cegid Diez: al terminar el alta activo el plan
    general contable de pymes, y tu histórico, con tus subcuentas, lo traigo
    después. En el Inicio verás cómo va.»
  - Cualquier otro: «De momento no traigo solo los datos de Holded; empezamos
    con el plan general contable de pymes y te ayudamos a pasar los saldos.»
    Es tu frase con un cambio, y te lo digo: donde ponías «el plan general»
    pongo el que eligió en la pregunta anterior (**«el plan general contable»**
    o **«el plan general contable de pymes»**). Con «el plan general» a secas,
    a quien eligió el de pymes le diríamos una cosa que no es. Ningún botón
    promete una importación.
  - De cero: «Empezamos de cero, con el plan general contable de pymes: lo
    activo al terminar el alta.»
- **El alta no termina sin el plan activado.** Se activa al final, después del
  banco: así la 572 del banco sale ya con el plan. El último mensaje lo dice
  («Listo: … está montada. Plan activado: N cuentas de serie, M subcuentas…»).
  Si no se puede activar, el alta **no** se da por terminada y dice por qué.
  Un alta retomada no lo activa dos veces.
- **La respuesta se guarda en la cuenta, con su registro** — y para eso hacía
  falta una tabla: **una cuarta migración, la 0400** (§3). No la metí dentro
  de la 0300 para no esconderla: es otra cosa y tiene su propia vuelta atrás.
  - `conta_programa_anterior`: una fila por empresa (`account_id` siempre).
  - `conta_programa_anterior_registro`: cada respuesta y cada cambio, con quién.
  - `conta_programa_anterior_poner`: la escribe quien es de la cuenta.
  - Para saber qué importadores hacen falta:
    `select programa, otro_nombre, count(*) from conta_programa_anterior group by 1, 2 order by 3 desc;`
    (todas las cuentas: es lo que se quiere contar).
- **La tarjeta de Diez del Inicio**, solo para lo que falte: se enseña a quien
  viene de Diez (lo dijo en el alta) o ya tiene su base registrada, y solo
  mientras falte algo. A quien viene de otro programa o de cero, nunca.
- **Foodint no cambia — prueba.** Medido hoy en producción (solo lectura):
  Foodint tiene su histórico de Diez **hecho** (1 lectura, `historico/hecho`) y
  su base será la C0008 → con la tanda, su tarjeta calcula «no falta nada» y
  **no se enseña, como hoy**. Las pruebas:
  - unitaria (`programaC06.test.ts`): la tarjeta con el estado de Foodint
    medido no se enseña; con algo pendiente sí, por su base, aunque no haya
    contestado la pregunta (su alta es de antes);
  - en staging (`20261111_c06_programa_anterior_prueba.sql`): ninguna empresa
    de antes tiene fila, y `conta_diez_listo` de **todas** (9) da lo mismo
    antes y después de contestar la pregunta en otra — la misma vara a los dos
    lados.
  - Foodint no pasa por el alta (ya la hizo): la pregunta solo la ven las
    empresas nuevas.

### 1.2 · «Activa tu cuenta» con la marca

Con la marca, el estilo de N18: logo, «Activa tu cuenta», los campos y el
botón de la marca, el lado menta con su lema y sus frases, y **«Email»** como
en el resto. Sin la cabecera negra de Folvy. El estado y el envío son los
mismos (la pantalla solo cambia cómo se ve: `src/marca/BienvenidaMarca.tsx`).
**Sin marca, igual que hoy**: quité también el «Tu contabilidad» que había
puesto bajo el logo en la respuesta 3, porque ahora la marca tiene su pantalla.

### 1.3 · N19 con el nombre de pila

«Hola, Lucía.» (antes «Hola, Lucía Inventada.»). En `send-email`, desplegada
otra vez en staging y comprobada (§4). Con un solo nombre, igual; sin nombre,
«Hola.».

### 1.4 · El borde de los campos

Token propio, el compartido no se toca:
- `--cx-borde-control: #848E9E` (contabilidad) y `--mx-borde-control` (la
  entrada de la marca);
- solo en **campos**: `.cx-input` (inputs, desplegables y áreas de texto), el
  desplegable del mes del Inicio, la barra de preguntar y `.mx-input` de N18;
- `--cx-borde-campo` (`#C9D0DC`) se queda en botones blancos, píldoras,
  tarjetas y separadores.
- Contraste: 3,31:1 sobre blanco y 3,08:1 sobre el fondo de página (mínimo
  3:1).

<!-- CAPTURAS -->

### 1.5 · La carrera de «Activar cuenta», también sin marca

Prueba nueva en el recorrido: la misma invitación abierta con `?marca=folvy`
(la bienvenida de Folvy, la de Foodint), rellenada al instante. Tiene que abrir
la cuenta; si se queda en un aviso, falla y dice qué se ve.

## 2 · Lo que tocan los retoques de otros

- **El alta** (`ConversacionAlta.tsx`, `guion.ts`, `llevamos.ts`): la pregunta
  nueva y la activación al final. Las e2e del alta del C00 (frente A las usa)
  contestan la pregunta: `tests/e2e/conta/c00/alta.spec.ts`.
- **`.cx-input`** es de todo contabilidad: el borde nuevo se ve en todas las
  pantallas con campos, de A y de B también. Es lo que pediste («solo el borde
  de los campos»); lo digo para que nadie se sorprenda.
- **Lint**: 1.379 problemas antes y 1.379 después (1.077 errores, 302 avisos),
  medido igual a los dos lados con `npx eslint .`.
- **Unitarias**: 169 ficheros, 2.565 pruebas, en verde. **Build**: `npm run
  build` exacto y en limpio, en verde.

## 3 · La tanda en producción (la primera de las tres)

### 3.1 · Lo medido hoy y el analizador

Contexto de producción, **solo lectura**, el **14/10 a las 06:17 UTC** (08:17
en Madrid), con la consulta del workflow y sus `CAMINO_TABLAS` /
`CAMINO_FUNCIONES`: existen `accounts` (4 filas), `company_account` (781) y
`feature_flags`; de las funciones de la tanda existen las seis de siembra y
`conta_diez_subcuentas` (md5 `33572edaa7e05e1bab66e024168d0036`, el mismo del
13/10); **nada en el camino del pedido**; **ninguno de los cuatro en el
historial**. La salida entera: `docs/conta/c06/tanda-analisis-20261014.md`.

| Fichero | Veredicto | Qué hace sobre lo que existe |
|---|---|---|
| `20261111T0100_c06_cuenta_sola.sql` | **sigue** | dos restricciones de `accounts` quitadas y puestas; seis funciones de siembra con su firma. Declarado, con prueba. |
| `20261111T0200_c06_diez_base.sql` | **sigue** | solo crea; la fila de Foodint (C0008, 202310, 202609, 2026-09-30). |
| `20261111T0300_c06_traer_listo.sql` | **sigue** | el disparador de `company_account` y `conta_diez_subcuentas` con su firma. Declarado, con prueba. |
| `20261111T0400_c06_programa_anterior.sql` | **sigue** | **nueva**: solo crea (dos tablas, índice, disparadores, políticas, función). |

**Sin `autorizo`.** La cuenta de antes y después
(`scripts/conta/produccion/cuentas/contabilidad-sola.sql`, ampliada con la
0400) ejecutada hoy en producción: cuentas 4 · con marca «sin columna» ·
interruptores conta 1 · subcuentas 781 · `conta_diez_base` y
`conta_programa_anterior` «sin tabla» · md5 `33572eda…` · lecturas de Diez 1.
Las vueltas atrás, comprobadas el 13/10 contra lo vivo (0300 byte a byte; 0100,
6 de 6 con el mismo código); la de la 0400 solo borra lo que crea y para si ya
hay respuestas.

### 3.2 · Para Julio: el ensayo

<!-- COMMIT -->

1. GitHub → **Actions** → **«Aplicar SQL en PRODUCCIÓN (contabilidad)»** →
   **Run workflow**.
2. Los campos, tal cual:

| Campo | Valor |
|---|---|
| Use workflow from | **Branch: `conta/c06-sola`** |
| confirmo | `produccion` |
| modo | `ensayo` |
| autorizo | *(vacío)* |

3. **No entre las :05 y las :10** de ninguna hora.
4. Al terminar, el título del run lleva el commit: `ensayo · conta/c06-sola · <commit>`.
   Tiene que ser el de arriba. Si no lo es, alguien ha empujado a la rama
   entre medias: para y avísame.

Qué tiene que salir: el análisis con los cuatro «sigue», los cuatro ficheros
aplicados y deshechos dentro de la transacción, el ensayo de la vuelta atrás
en verde, y la cuenta de antes y después igual.

### 3.3 · Para Julio: el real (después del ensayo en verde)

Del **mismo commit** (el workflow lo exige: busca un ensayo en verde de ese
commit y, si no lo hay, para). **Nadie empuja a `conta/c06-sola` entre el
ensayo y el real** — yo tampoco.

| Campo | Valor |
|---|---|
| Use workflow from | **Branch: `conta/c06-sola`** (el mismo commit del ensayo) |
| confirmo | `produccion` |
| modo | `real` |
| autorizo | *(vacío)* |

Tampoco entre las :05 y las :10. Después del real el workflow comprueba solo
(D1, recuento, agentes y la salud del pedido) y, si algo falla, deshace lo que
aplicó.

### 3.4 · Después del real en verde: el PR a `main`

Lo abro yo cuando me digas que el real está en verde (el front lee
`name_pending`, `conta_diez_listo` y `conta_programa_anterior`: sin la tanda,
no se fusiona — regla 40). Lo que despliega al fusionarlo:

- **Front** (Vercel, `app.folvy.app`): la marca (sin efecto en Folvy: sin
  dominio de marca, todo el mundo ve Folvy), el alta con la pregunta nueva, la
  tarjeta de Diez, la bienvenida, el borde de los campos y lo demás de C06.
  Hecho cuando **Vercel diga READY** en producción.
- **Edge functions**, solas por el push a `main` (`deploy-edge-functions.yml`,
  las que cambian): `conta-crear-cuenta` (nueva, verify_jwt true),
  `conta-contrasena` (nueva, verify_jwt false, declarado en `config.toml`) y
  `send-email` (cambia: sin marca manda lo mismo que hoy, `correoC06.test.ts`).
- **Una que NO se despliega sola:** `conta-diez-enviar`. Usa
  `_shared/diezCliente.ts` y `_shared/diezEnviar.ts`, que cambian (una base por
  empresa, la C0001 vetada, escribir solo con `escribirEnReal` y el autorizo
  por empresa), pero el workflow se salta `_shared` y su carpeta no cambia.
  **Hay que lanzarla a mano** después de fusionar: «Desplegar edge functions» →
  Run workflow → `funciones`: `conta-diez-enviar`, `la_prohibida`: vacío. Y
  comprobar lo desplegado contra `main` (regla 1).

**Qué comprobar en `app.folvy.app` después** (con READY en Vercel):
1. **Foodint entra igual**: la entrada de Folvy de siempre (no la de la marca),
   y abre lo de siempre.
2. **Su contabilidad se ve igual**: el Inicio con sus cifras, «Lo que he hecho
   yo», «Cerrar el mes» con su aspecto de siempre, y **sin** la tarjeta «Traer
   tu contabilidad de Diez» (su histórico está traído). Libros y balance con
   sus números.
3. Lo único que verá distinto: el **borde de los campos**, más oscuro.
4. En Supabase → Edge Functions: `conta-crear-cuenta`, `conta-contrasena` y
   `send-email` con versión nueva; y `conta-diez-enviar` después de lanzarla.
