# W02 · Paso 1c · Construido y medido (16/10)

> Entrega 2 del encargo (`claude/encargo_W02_pruebas_sin_esperas.md`): la
> opción 2 + 3 que eligió Julio, construida en la rama `conta/w02-sin-esperas`.
> **No hay nada en `main` ni en producción.** Entra con el PR cuando Julio diga.

## En una pantalla

- **Cada e2e tiene sus propias cuentas (un «carril»), y ya no espera a nadie.**
  - Antes: 1.741 min esperando el cerrojo en 185 e2e (13/10–16/10).
  - Después: **0 min** en 5 e2e con carriles; la espera más larga, 2 s.
- **El cerrojo queda solo para migrar.**
  - `aplicar-staging-conta` lo coge en exclusiva: espera a las e2e en marcha y,
    mientras aplica, no deja empezar ninguna.
  - Una tanda ya no puede entrar a mitad de una e2e.
- **La entera, en trozos a la vez.**
  - **Con 4 trozos, la Micro de staging no aguanta.** Las mismas pruebas
    tardan **×1,20**, y en cada run caen 6–8 pruebas porque la pantalla no
    pinta en 15 s, más algún 504 al entrar. **Antes de subir de plan, la cifra:**
    pasar staging de Micro a Small son **unos 5 $ al mes (4–5 €)**, y no está
    medido que con Small aguante 4.
  - **Con 2 trozos, aguanta.** Las mismas pruebas tardan ×0,98, sin timeouts ni
    504. La entera tarda **22,8 min** de principio a fin, sin esperas. Antes
    eran 35,7 min sin esperas, y con ellas una mediana de 44 y un p90 de 78.
    **2 trozos es lo que queda por defecto.**
- **La entera del push ya no retiene a la del mismo commit.** Antes pasó en
  24 de 41 enteras; ahora cada una tiene su cola.
- **Las 15 enteras en rojo:**
  - 9 por datos de staging que cambió otro frente;
  - 5 por fallos de la propia rama;
  - 3 por pruebas inestables, arregladas aquí;
  - 2 sin determinar.

  Detalle abajo.

## 1 · Cada e2e con sus propias cuentas

**Lo que no se pudo hacer como se pidió, y por qué.** Se pidió quitar los ids
fijos de las 24 semillas para que cada carrera **sembrara** sus cuentas.
Medido: **volver a pasar las semillas no reproduce A y B.**

- Las propias semillas nombran filas que no crea ninguna semilla. La empresa
  de A, `3b34403a…`, la crea `seed_c00_empresas_prueba.sql` con un id al azar,
  y `seed_c03`, `seed_c04` y `seed_c05` la nombran por ese id.
- Además, A y B llevan encima **106 ficheros** de `supabase/staging/sql` y
  todo lo que han hecho las pruebas.

Así que el carril **copia** la plantilla tal como está, y **no hubo que tocar
ninguna de las 24 semillas**.

**El carril** (`scripts/e2e/carril.sh` y `scripts/e2e/carril/*.sql`; detalle
en `docs/conta/staging.md`):

- **Qué se copia.** Las cuentas A, B, C, Diez y las dos «solas» del C06, y sus
  siete usuarios, con todo lo suyo. Son 18.000 filas en 102 tablas.
- **Cómo se copia.**
  - En **una transacción** y con una foto fija.
  - **Sin disparadores ni claves ajenas, solo en esa sesión**
    (`session_replication_role = replica`): sin DDL y sin bloquear tablas de
    nadie.
  - Comprobando al final **cada clave ajena**: si una cuelga, no se da por
    bueno.
- **Cómo se llaman sus cosas.**
  - Ids: el segundo grupo XOR N.
  - Correos: `.carril-N`.
  - Lo único en toda la base: `-cN`.
- **Cuánto tarda.**

| Lo medido | |
|---|---|
| Clonar | 4–8 s solo; 13–21 s con 4 a la vez |
| Borrar | 4–10 s |
| Los siete usuarios entran y cada uno ve solo su cuenta | `carril-entrar.mjs`, en cada trozo |
| El de la plantilla no entra con la clave del carril | sí |
| Restos tras las pruebas | 0 cuentas, 0 usuarios y 0 cerrojos de carril en staging |

**Lo que la medida obligó a cambiar por el camino** (cada uno, con su commit):

| Encontrado | Qué pasaba | Arreglo |
|---|---|---|
| Un id al azar de la plantilla ya tenía `0fa1` (= 4001) en el segundo grupo | Con «poner N», la copia caía encima del original. Con 18.000 filas, le pasaría a 1 de cada 4 carriles | Regla XOR: nunca deja un id igual |
| La huella encadenada de los asientos lleva ids | «Comprobar la cadena» fallaba en el carril (`c04/libro.spec.ts:231`) | El clon rehace la cadena con `journal_huella` y `journal_entry_canonico` |
| El borrado recorría las 981 claves ajenas | Tardaba 50–97 s con otras e2e en marcha, y les tumbaba consultas (57014) y un inicio de sesión (504) | Busca como el clon: por cuenta, por usuario y las hijas solo en tablas sin cuenta. Ahora tarda 4–10 s |
| Con el pooler, un psql muerto deja su consulta viva | Un `pg_sleep(7200)` huérfano con los cerrojos cogidos dos horas | El guardián duerme a tramos de 20 s y se termina al soltar. Medido: si el runner muere, los cerrojos se sueltan solos a los **20 s** |
| Supavisor no pasa el `application_name` | No se sabía de quién era un cerrojo | El guardián lo pone él |
| La Micro tiene 30 de 60 conexiones ocupadas sin hacer nada | Cada carril en uso es una conexión más | Carriles: como mucho 16 |

**Pruebas tocadas: 20 ficheros de otros frentes** (eran 6 con solo A y B;
con los demás ids de la plantilla, 20). Solo pasan los literales por
`enCarril(…)` o `correoDelCarril(…)`, sin cambiar lo que prueban. `sola` y
`recorrido` (C06) siguen corriendo solo en el frente C.

- A: `d01/catcher`, `d01/documentos`.
- B: `b01/datos.ts`, `b01/motor`.
- C: `c00/rls`, `c01b/capturas`, `c01b/flujos`, `c02/rls`, `c03/terceros`,
  `c04/libro`, `c04/rls`, `c05/rls`, `c06/contrasena`, `c06/pendientesDiez`,
  `c06/promociones`, `c06/recorrido`, `c06/sola`, `cierre/cierre`,
  `compras/compras`.
- D: `m01/marco`.
- Reparto: `reparto/quien-reparte`.

`sesion.ts` sabe del carril. Sin carril (las ramas que aún llevan el workflow
de antes) todo sigue como antes.

## 2 · El cerrojo, solo mientras se migra

- Cerrojo consultivo `(4202, 0)`, que mantiene un psql en segundo plano.
- **Cada e2e lo coge compartido**: entran todas a la vez.
- **`aplicar-staging-conta` lo coge exclusivo**, antes de aplicar, y lo suelta
  pase lo que pase. Postgres pone en cola a las e2e que llegan mientras
  espera, así que no se cuela ninguna.
- Mientras queden ramas con la e2e de antes, `aplicar-staging-conta` coge
  **también** `e2e.cerrojo`, para no entrar a mitad de una de ellas.

## 3 · La entera en trozos

- `scripts/e2e/trozos.mjs` reparte fichero a fichero, del más lento al más
  rápido, con los tiempos medidos (`tests/e2e/tiempos.json`).
- El job **«entera»** comprueba dos cosas, y solo con ellas el run sale en
  verde:
  - que entre los trozos están **todos los ficheros, una vez cada uno**:
    «Los 4 trozos han pasado los 38 ficheros, una vez cada uno»;
  - que **todos los trozos** salieron en verde.
- `e2e-entera.mjs` solo da la entera por buena en el **primer intento**:
  relanzar el trozo que falló sirve para diagnosticar, no para dar valores.
- Se puede pedir a mano en 1 a 4 trozos (campo `trozos`). Por defecto, 2.

**Tiempos reales.** Todas en esta rama, el 16/10; se lee de los runs, no de
una estimación.

| Run | Trozos | El trozo más largo | Total, de principio a fin | Mismas pruebas que en serie | En rojo |
|---|---:|---:|---:|---:|---:|
| 38906045875 | 4 | 11,9 min | 15,5 min | (sin medir: el borrado de entonces cargaba staging) | 11 |
| 38908813148 | 4 | 11,4 min | 15,0 min | ×1,20 | 8 |
| **38913947037** | **2** | **19,1 min** | **22,8 min** | **×0,98** | **1** |
| Antes (serie) | 1 | 33,3 min | 35,7 min sin esperas; mediana 44,1 y p90 77,8 con ellas | — | — |

**Carga de staging (Micro), medida desde el trozo 1:**

| | 4 trozos (run 38906045875) | 2 trozos (run 38913947037) |
|---|---|---|
| Consultas trabajando a la vez (mediana · p95 · máx) | 0 · 4 · 16 | 0 · 2 · 6 |
| Conexiones (de 60) | 37 · 41 · 41 | 34 · 35 · 35 |
| Ocupación (ms de consulta por s) | 285 · 1.873 · 18.026 | 134 · 578 · 2.988 |
| Transacciones por s | 39 · 67 · 74 | 24 · 42 · 60 |

**La que queda en rojo con 2 trozos.** `compras.spec.ts:166`, en móvil: «Cómo
te factura» no llega a pintar el grupo de opciones en 15 s. En ordenador, con
el mismo carril, pasó. Sin 500, 504 ni timeouts cerca. Queda **apuntada**, no
tapada.

**Los dos trozos salieron desparejos** (19,1 y 13,8 min con una estimación de
16,8 cada uno): los tiempos de `tiempos.json` son de una sola entera. Se
afinan con `node scripts/e2e/inflacion.mjs <informe> --tiempos`. Pendiente.

## 4 · La cola del propio push

El grupo de concurrencia lleva el tipo de evento: la entera lanzada a mano ya
no espera a la e2e del push del mismo commit. Cada una va en su carril.

## 5 · Las 15 enteras en rojo (13/10–16/10)

| Causa | Enteras | Qué pasó |
|---|---:|---|
| Staging cambiado por otro frente | 9 | **7:** D01 aplicó a staging `…repetidas_con_total.sql` (409 a una factura repetida) y el test que lo esperaba no llegó a `main` hasta el #188 (`c01b/flujos.spec.ts:161`). **2:** D01 cambió el NIF de Catcher en staging y `tests/conta/e05/ejemplo.ts` llevaba el viejo (`d01/catcher.spec.ts:134`). **El carril no lo arregla**, porque copia la plantilla tal cual: lo arregla que el cambio de la prueba entre en `main` antes que el de staging. Para el frente A: que `catcher` lea el NIF de la ficha sembrada. |
| De la propia rama | 5 | Cada una arreglada en su rama (m01, c04/conDiez…). |
| Inestables | 3 | **Arregladas aquí.** «networkidle» sin tope (Playwright no le pone ninguno: hasta 120 s) en `c06/recorrido` (×2); C ya lo había arreglado en `main`. Quedaban 4 más sin tope: `c06/sola` ×2, `c06/recorrido:301` y `m01/marco:146`, ahora con `tests/e2e/conta/red.ts` (tope de 10 s y log de qué sigue pidiendo). Y `c01b/flujos`: el aviso de guardado es uno solo y gana el último; sin esperar «Guardado: calle.», el de la calle tapaba el del CP. |
| Sin determinar | 2 | Sin traza descargable. Hipótesis apuntadas: `c00/marco:58`, el interruptor de «Folvy Conta» no aparece (`featureGateService.load()` no mira el error); `c03/terceros:134`. |

## Lo que pide Julio para dar el paso por bueno

| Pedido | Medido |
|---|---|
| `medir_esperas.py`, antes y después, igual | **Antes** (185 e2e, 13/10–16/10): cerrojo 1.741 min, cola 630, pruebas 2.314; 88 esperaron, 19,7 min de media. **Después** (5 e2e de carril, 16/10 13:10–14:44): cerrojo **0 min**, cola 1 min, pruebas 48; **0** esperaron más de 1 min. El script es el mismo y las cifras de antes salen idénticas con él. |
| Dos e2e de frentes distintos a la vez, sin esperarse y sin pisarse | B (run 38917117280) y D (run 38917122220), lanzadas en el mismo minuto: esperaron 1 y 2 s, y sus pruebas se solaparon de 14:39:16 a 14:41:03. **B entró en el carril 1** (`a.admin.carril-1@…` ve `c01a0000-0001-…`) **y D en el 2** (`c01a0000-0002-…`); los siete usuarios de cada uno entraron y vieron solo lo suyo. D vio el cerrojo compartido de B y entró igual: «Nadie migra staging (esperado 2 s)». Cada uno borró lo suyo al acabar: 18.304 y 18.119 filas. **D salió en verde. B, en rojo:** `bank_deshacer` agotó su tiempo (`statement timeout`) al limpiar al final de `b01/conciliar`, y lo que no deshizo hizo que `b01/motor` contara 18 movimientos en vez de 15. No es un frente pisando a otro, pero **está sin resolver**: no sé si es carga o que el clon arrastra 1.400 conciliaciones viejas de la plantilla. Queda abierto. |
| Datos de cada uno intactos | Al acabar: 0 cuentas, 0 usuarios y 0 cerrojos de carril. **La plantilla sí cambió entre las 14:36 y las 14:44**, y fue la entera de D relanzada a las 14:27, que escribe en ella con el doble `frente-d` (`created_by = e2e0000d…a1`), no un carril. La huella de la plantilla no sirve como prueba mientras haya e2e de las de antes. |
| La entera en 4 trozos, con su tiempo real | 15,0–15,5 min de principio a fin. **La Micro no aguanta**: ver arriba, con la cifra. |
| `antes-de-subir.sh` entero en verde | Sí, en cada push de esta rama. Unitarias: 240 ficheros, 3.879 pruebas. |

## Lo que he podido estropear a otros, dicho

- **La entera de D de las 13:27 falló en `c04/libro` por esperas agotadas**
  mientras corrían mis cuatro trozos (13:34–13:48). Es **probable** que mi
  carga contribuyera; no lo puedo separar. Desde entonces no he lanzado nada
  pesado con otra entera en marcha.
- No he tocado el cerrojo, las cuentas A y B ni la base: los carriles se crean
  y se borran solos, y no hay DDL.

## Pendientes (fuera de este paso)

1. **Julio:** ¿staging en Small (+5 $/mes, 4–5 €) para probar 4 trozos? Sin
   eso, se queda en 2.
2. `bank_deshacer` agotando su tiempo en un carril. Lo mira B, o yo con su
   permiso.
3. `compras.spec.ts:166` en móvil, una vez en 2 trozos.
4. Rehacer `tests/e2e/tiempos.json` con una entera en trozos, para que salgan
   parejos.
5. Quitar `e2e.cerrojo`, los dobles por frente y `e2e_limpieza.sql` cuando
   ninguna rama use ya la e2e de antes.
6. `sales_day_summary.detail_hash` lleva ids de pedidos y el clon no lo rehace.
   Nada lo compara hoy; si algún día se compara, hay que rehacerlo como la
   cadena.
7. A y B tienen basura acumulada de pruebas (7.400 filas de
   `bank_activity_log`, 1.400 conciliaciones), y el carril la copia. Limpiarla
   aligeraría cada clon.
