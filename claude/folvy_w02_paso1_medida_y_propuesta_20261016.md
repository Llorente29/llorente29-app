# W02 · Paso 1 · Lo medido y lo que propongo (16/10)

> Entrega 1 del encargo (`claude/encargo_W02_pruebas_sin_esperas.md`): 1a y 1b.
> **No se ha construido nada.** Julio elige y, si elige algo que cuesta, dice sí
> a la cifra.

## En una pantalla

- **El cerrojo protege las cuentas A y B de staging**, no la base entera ni
  las semillas ni los usuarios. Los usuarios ya son de cada frente desde el
  13/10. Las cuentas A y B, donde viven todas las semillas del C00 al C05, el
  B01, el D01 y el escenario del reparto, siguen siendo de todos.
- **De los 33 minutos de una e2e entera, 31,5 son pruebas y 2,1 preparación.**
  La e2e no migra nada. La siembra que hace dentro dura 5 segundos. Las
  pruebas van **en fila, con 1 worker**: 266 pruebas en 33,3 min.
- **Desde que existe el cerrojo** (13/10 21:45 → 16/10 12:36, 185 e2e):
  **1.741 min esperando el cerrojo** y **630 min en la cola de GitHub**, contra
  **2.314 min de pruebas**. Es decir, por cada minuto de prueba hubo un minuto
  de espera.
- **Recomiendo la opción 2 más la 3, por 0 € al mes.** Cada carrera de pruebas
  tendría sus propias cuentas A, B y C. Una entera se partiría en 4 trozos a
  la vez. Una entera pasaría de **44 min de mediana y 78 en el p90** a
  **unos 12 min, sin esperas**; los 12 min son una estimación que se mide en
  el paso c.
- **La opción 1 (un staging por frente) cuesta unos 29–39 $/mes**, entre
  25 y 35 € (abajo, el porqué). Quita las esperas, pero **no acorta los 33
  minutos**. Además obliga a aplicar cada tanda de staging en 4 o 5 bases que
  no se pueden reconstruir solas desde las migraciones.

---

## 1a · Lo medido

### Qué es exactamente «el candado»

Son **dos cosas distintas**, y las dos hacen esperar.

**1. La cola de GitHub (`concurrency`, `e2e-staging-conta.yml:113`)**

```yaml
group: e2e-staging-conta-${{ github.ref }}-${{ inputs.frente }}
cancel-in-progress: false
```

- **No es compartida entre ramas:** es **por rama y frente**. Pone en fila los
  runs de **la misma rama**.
- **No protege nada de staging.** Solo existe para que un push no cancele una
  e2e en marcha (C05, respuesta 3).
- **Efecto que no se buscaba:** cuando la sesión empuja y en el mismo minuto
  lanza la entera **del mismo commit**, la entera espera a que acabe el run del
  push. La entera ya cubre todo lo del push, así que esa espera no protege
  nada. Medido: **24 de las 41 enteras** se lanzaron junto a un push del mismo
  commit, y esas enteras sumaron **381 min de cola**. Ejemplo: D, run
  38884931902, con **31,2 min de cola** antes de empezar.

**2. El cerrojo de staging (`e2e.cerrojo`, `scripts/e2e/cerrojo.sh`)**

- **Es compartido entre ramas y frentes.** Hay una sola fila en la base de
  staging (`e2e.cerrojo`, id = 1), y la coge cualquier e2e de cualquier
  frente.
- **Cómo se coge:** después de la preparación, antes de tocar staging. Si está
  ocupado, la e2e espera dentro de su job, reintentando cada 30 s hasta una
  hora.
- **Cómo se suelta:** al acabar, pase lo que pase. Si nadie lo suelta, caduca
  a los 50 min.
- **Ahora mismo** lo tiene `run 38894191675 · conta/b02-conciliacion · frente b`,
  con caducidad a las 12:21 UTC; consulta de solo lectura a staging.

**Qué protege**, recurso a recurso:

| Recurso | ¿Lo protege el cerrojo? | Por qué |
|---|---|---|
| Base de staging (estructura) | **No.** | Las migraciones de staging las aplica `aplicar-staging-conta.yml` (mediana 0,6 min, 81 runs desde el 13/10), y **ese workflow no coge el cerrojo**: hoy una tanda puede entrar en staging a mitad de una e2e. Es un hueco, no una protección. |
| Semillas | **Solo el escenario del reparto** (R02, unos 2 s, dentro del cerrojo). | Las demás semillas no las corre la e2e: se aplicaron una vez con `aplicar-staging-conta`. |
| Usuarios de prueba | **Ya no hace falta.** | Desde el 13/10 cada frente tiene sus cuatro dobles (`seed_e2e_frentes_staging.sql`), y su e2e solo cambia la contraseña de los suyos. |
| Cuenta C (sin empresa) | **Ya no hace falta.** | Hay una por frente. |
| **Cuentas A y B** (y el R02, que vive en la A) | **Sí. Esto es lo que protege.** | Son de todos los frentes. Las pruebas crean y borran proveedores y facturas, cierran y reabren meses, tocan el plan contable y vuelven a sembrar los pedidos vivos del R02. Medido el 13/10 (comentario del workflow): dos enteras a la vez se rompen los datos aunque cada una entre con sus usuarios. |

**Por qué hace falta hoy:** hay **24 semillas** (`supabase/seeds/conta` y
`reparto`) y **6 ficheros de prueba** (7 ids distintos) que fijan los ids de
las cuentas A y B (`c01a0000-…`, `c01b0000-…`). Mientras haya una sola A y una
sola B, dos e2e a la vez se pisan.

### Cuánto esperó y cuánto duró cada e2e (últimas 6 de cada frente)

Lo saca `scripts/e2e/medir_esperas.py`, que va en esta rama para medir el
después con la misma vara. Columnas en minutos. «Cola GitHub» es la cola
por rama del punto 1; «cerrojo», la espera por otra e2e del punto 2.

**Frente A**

| run | cuándo (Madrid) | qué | resultado | cola GitHub | cerrojo | preparación | pruebas | total |
|---|---|---|---|---:|---:|---:|---:|---:|
| 38888314188 | 16/10 12:36 | push | success | 13.2 | 32.3 | 1.8 | 2.2 | 49.7 |
| 38887485021 | 16/10 12:28 | push | success | 0.1 | 16.5 | 2.1 | 1.8 | 20.6 |
| 38878466805 | 16/10 11:08 | push | success | 0.1 | 0.5 | 2.1 | 1.8 | 4.6 |
| 38854764155 | 16/10 07:14 | push | success | 0.1 | 26.1 | 2.1 | 2.1 | 30.6 |
| 38852626997 | 16/10 06:49 | push | success | 0.1 | 21.7 | 1.6 | 1.7 | 25.2 |
| 38822783602 | 16/10 01:18 | push | success | 0.0 | 4.3 | 2.1 | 1.9 | 8.5 |

**Frente B**

| run | cuándo (Madrid) | qué | resultado | cola GitHub | cerrojo | preparación | pruebas | total |
|---|---|---|---|---:|---:|---:|---:|---:|
| 38882161539 | 16/10 11:41 | entera | success | 18.2 | 0.0 | 2.3 | 33.3 | 54.1 |
| 38882158853 | 16/10 11:41 | push | success | 0.1 | 14.2 | 1.6 | 2.2 | 18.2 |
| 38870321497 | 16/10 09:55 | entera | success | 0.1 | 0.0 | 2.1 | 33.2 | 35.7 |
| 38859266540 | 16/10 08:05 | parcial | success | 0.1 | 0.0 | 1.5 | 1.8 | 3.6 |
| 38858711242 | 16/10 07:59 | push | success | 0.1 | 0.0 | 2.1 | 2.7 | 5.2 |
| 38857733974 | 16/10 07:48 | parcial | success | 0.1 | 0.0 | 1.7 | 2.1 | 4.1 |

**Frente C**

| run | cuándo (Madrid) | qué | resultado | cola GitHub | cerrojo | preparación | pruebas | total |
|---|---|---|---|---:|---:|---:|---:|---:|
| 38884666154 | 16/10 12:03 | push | success | 0.1 | 31.2 | 2.2 | 10.2 | 43.9 |
| 38867433595 | 16/10 09:28 | entera | success | 0.1 | 61.2 | 2.0 | 31.9 | 95.5 |
| 38863742421 | 16/10 08:52 | entera | failure | 0.1 | 0.0 | 2.3 | 32.3 | 35.0 |
| 38862512436 | 16/10 08:40 | push | success | 0.1 | 0.0 | 1.7 | 10.6 | 12.6 |
| 38850605464 | 16/10 06:26 | push | success | 0.1 | 0.5 | 2.0 | 9.5 | 12.3 |
| 38831779571 | 16/10 02:50 | entera | success | 0.1 | 14.0 | 2.2 | 31.9 | 48.5 |

**Frente D**

| run | cuándo (Madrid) | qué | resultado | cola GitHub | cerrojo | preparación | pruebas | total |
|---|---|---|---|---:|---:|---:|---:|---:|
| 38884931902 | 16/10 12:05 | entera | success | 31.2 | 10.6 | 2.1 | 33.5 | 77.8 |
| 38884919416 | 16/10 12:05 | push | success | 0.1 | 27.7 | 1.8 | 1.5 | 31.3 |
| 38880143042 | 16/10 11:23 | entera | failure | 0.1 | 0.0 | 2.1 | 31.1 | 33.5 |
| 38878246279 | 16/10 11:07 | push | success | 0.1 | 0.0 | 2.1 | 1.9 | 4.3 |
| 38864311359 | 16/10 08:58 | entera | success | 0.1 | 27.3 | 2.1 | 29.4 | 59.2 |
| 38862818254 | 16/10 08:43 | push | success | 0.1 | 7.4 | 2.0 | 1.6 | 11.2 |

**Todas las e2e desde que existe el cerrojo**: 185 runs, del 13/10 21:45 al
16/10 12:36 (Madrid).

| | cerrojo | pruebas | total |
|---|---|---|---|
| **entera** (41; 40 con pruebas) | mediana 0,0 · p90 29,3 · máx 61,2 | mediana 30,6 · p90 33,5 · máx 39,5 | **mediana 44,1 · p90 77,8 · máx 130,7** |
| push (109) | mediana 1,1 · p90 30,0 · máx 58,9 | mediana 2,7 · p90 22,3 | mediana 20,6 · p90 46,8 |
| parcial a mano (36) | mediana 0,0 · p90 30,0 · máx 38,3 | mediana 2,2 · p90 9,6 | mediana 12,0 · p90 37,7 |

Sumado:

- **cerrojo, 1.741 min**; cola de GitHub, 630 min; preparación, 390 min;
  pruebas, 2.314 min;
- **88 de 185 esperaron más de 1 min al cerrojo**, de media **19,7 min** cada
  una;
- **15 de las 41 enteras salieron en rojo.** Cada una se repitió entera:
  unos 33 min más, más su espera.

### Qué parte de los 33 minutos es preparación y qué parte son pruebas

Run 38882161539, B, entera en verde, 16/10. Segundos de cada paso:

| Parte | Paso | s |
|---|---|---:|
| Preparación (fuera del cerrojo) | checkout 15 · psql 11 · node 5 · `npm ci` 13 · **build 76** · navegador 16 · el resto 1 | **137** (2,3 min) |
| Cerrojo | coger | 1 |
| **Migrar** | **la e2e no migra.** Las migraciones las aplica `aplicar-staging-conta` en otro workflow (mediana 0,6 min). | 0 |
| **Sembrar** | contraseñas + limpieza 3 · escenario R02 2 | **5** |
| **Pruebas** | `Running 266 tests using 1 worker`: 190 pasadas y 76 saltadas, en 33,3 min | **1.996** (33,3 min) |
| Después | soltar, informe, capturas | 7 |

**Las pruebas son el 94 % del run.** Con 1 worker van en fila; el tiempo de
cada una sale del log de ese run:

- ordenador, **20,3 min**; móvil, **12,7 min**;
- **`c06/contrasena.spec.ts` se lleva 264 s (el 13 %)**: es una sola prueba
  («el que existe y el que no contestan lo mismo y tardan lo mismo»), de 132 s
  en cada tamaño;
- les siguen `c01b/flujos` (226 s), `c04/libro` (138), `c00/alta` (123) y
  `c05/libros` (119). El fichero más lento es menos del 14 % del total, así
  que **la suite se puede repartir bien** (siguiente apartado).

---

## 1b · Las opciones, con tiempos y euros

Supuestos de los precios:

- **staging-conta es una rama persistente de Supabase** del proyecto de
  producción, en la organización **Pro**; la confirma `list_branches`. Es
  Micro (`max_connections` = 60), y hoy cuesta ~10 $/mes (`docs/conta/staging.md`).
- **Tarifa de Supabase hoy:** Micro, 0,01344 $/h, unos 9,81 $/mes
  (730 h); los créditos de cómputo **no** cubren las ramas. Disco: 8 GB
  incluidos por base, y staging ocupa 108 MB, así que 0 $.
- **Supabase factura en dólares.** El cambio a euros está a 0,85–0,90 €/$:
  la cifra exacta, en la factura.
- **GitHub Actions:** el repositorio es **público** (lo dice la API), y en un
  repositorio público los runners estándar de Linux son **gratis**. Partir la
  e2e en trozos no cuesta minutos de pago.

### Opción 1 · Un staging propio por frente (ramas de Supabase)

| | |
|---|---|
| **Coste** | **4 ramas nuevas Micro: 39,2 $/mes (33–35 €).** Si una de las cuatro se queda en staging-conta: 3 ramas, 29,4 $/mes (25–27 €). |
| **Dormir o borrar** | Ahorra poco. Hay e2e a todas las horas: entre el 13/10 21:45 y el 16/10 12:36, el mayor hueco sin ninguna fue de 5,2 h (15/10, de 02:15 a 07:27 de Madrid) y el siguiente de 3,4 h. Una rama Micro de Supabase no se duerme: se paga cada hora que existe, y la hora empezada cuenta entera. |
| **Entera, sin esperas** | **~34 min** (2,1 de preparación y 31,5 de pruebas): quita el cerrojo, **no acorta las pruebas**. |
| **Lo que no se ve en el precio** | **Una rama nueva no se crea sola desde las migraciones.** staging-conta nació `MIGRATIONS_FAILED` y con 0 tablas: el historial de producción empieza el 12/07 y da por hechas tablas anteriores (`docs/conta/staging.md`). Cada rama habría que montarla como staging-conta: volcado, 15 errores explicados, permisos de 45 tablas, extensiones, funciones. Después, **cada tanda de staging se aplica en 5 bases** (o 4), y cada una puede derivar de las otras. Y **un secreto nuevo por rama**, que tiene que crear Julio. |
| **Medido / estimado** | **Estimado, sin medir.** Desde el contenedor no se llega a `*.supabase.co`, y montar una rama ya es gastar. |

### Opción 2 · Mismo staging, cada carrera con sus cuentas, y el cerrojo solo para migrar

| | |
|---|---|
| **Coste** | **0 €.** |
| **Qué es** | Hoy solo se reparten los usuarios y la cuenta C. Faltan **las cuentas A y B**: la copia de cada frente se siembra con las mismas semillas cambiando el prefijo de los ids (`c01a0000-…` pasa a un prefijo por frente, como ya hace `e2e0000f-…` con los usuarios). Las 6 pruebas con ids fijos los leen de `sesion.ts`, como hoy `CUENTA_C`. El cerrojo pasa a ser de **lectura/escritura**: las e2e entran a la vez, y `aplicar-staging-conta` **sí lo coge**, en exclusiva y solo mientras aplica (mediana 0,6 min). Eso tapa además el hueco de hoy, en que una tanda puede entrar a mitad de una e2e. |
| **Entera, sin esperas** | **~34 min**, igual que la 1: quita el cerrojo, no acorta las pruebas. |
| **Riesgos que hay que medir en el paso c** | (1) Estado de staging que no va por `account_id`: catálogos, el administrador de plataforma del C06, trabajos de pg_cron. (2) 24 semillas que fijan ids: el cambio de prefijo tiene que respetar lo que sea único entre cuentas, como los NIF o los slugs. (3) Carga: 4 o más navegadores a la vez contra una Micro de 60 conexiones. (4) Límites de entrada de Auth: cada runner sale por su IP, así que en principio no se suman, pero se mide. |

### Opción 3 · La e2e entera partida en trozos que corren a la vez

| | |
|---|---|
| **Coste** | **0 €** (repositorio público). |
| **Condición** | Cada trozo es una carrera más contra staging, así que **necesita la 1 o la 2 debajo**: cuatro trozos sobre las mismas A y B se pisan igual que cuatro frentes. Por eso con la 1 haría falta una base por trozo, y salen 16 bases. |
| **Tiempo de las pruebas** | Simulado sobre los 74 bloques reales del run 38882161539 (cada fichero de prueba, en cada tamaño): 2 trozos, **16,5 min**; 3, **11,0**; **4, 8,3**; 6, 5,5; 8, 4,2. Es un reparto equilibrado: el de Playwright por defecto (`--shard`) reparte por orden y puede quedar algo peor, y se mide. |
| **Entera** | 4 trozos: 2,1 de preparación (en paralelo) + ~8,3 de pruebas + ~1 de juntar el informe, **unos 12 min**. Estimado, no medido. |
| **La entera sigue valiendo** | Un job final junta los cuatro informes. «Entera en verde» es: los 4 trozos en verde **del mismo commit**, y `e2e-entera.mjs` lo comprueba igual que hoy. |
| **Repetir solo lo que falló** | Ya existe: el campo `pruebas` del lanzamiento a mano acepta un fichero. Con trozos, el resumen da la línea exacta para relanzar solo el que falló. Los valores para producción siguen saliendo de una entera en verde. |

### Comparación

| | €/mes | Entera sin esperas | Espera por otro frente | Trabajo | Riesgo principal |
|---|---:|---:|---|---|---|
| Hoy | 0 € (además de los ~10 $ de staging-conta) | 34 min | mediana 0, **p90 29**, máx 61 | — | — |
| 1 | **25–35 €** | 34 min | 0 | alto: montar 3 o 4 bases a mano y aplicar cada tanda en todas | que las bases deriven |
| 2 | 0 € | 34 min | 0, salvo el ~0,6 min mientras se aplica una tanda | medio: semillas con prefijo, `sesion.ts`, cerrojo de lectura/escritura | estado que no va por cuenta |
| 3 sola | 0 € | — | no se puede sin 1 o 2 | — | — |
| **2 + 3** | **0 €** | **~12 min** | 0 | medio + workflow de trozos | lo de la 2, más la carga |
| 1 + 3 | ~157 $/mes (16 bases) | ~12 min | 0 | muy alto | — |

### Lo que recomiendo

**La 2 + 3, por 0 €.**

- **Por qué no la 1:** sale a 25–35 € al mes y, con las mismas pruebas, deja
  la entera en los mismos 34 minutos. Además multiplica por cuatro lo más
  delicado de hoy, que es tener staging igual que producción, en bases que no
  se pueden reconstruir solas.
- **Cómo se monta:**
  1. **Carriles en vez de frentes.** Un carril es un juego de cuentas A, B y
     C con sus usuarios, sembrado con el prefijo del carril. Propongo 16:
     4 frentes por 4 trozos, fijos, sin repartir, para que cada frente no
     dependa de nadie. Si al medir la carga la Micro no aguanta 16
     navegadores, se baja a 8 o a 2 trozos por entera, y se dice con la cifra.
  2. **El cerrojo pasa a lectura/escritura.** Las e2e lo cogen compartido
     y `aplicar-staging-conta` en exclusiva.
  3. **La entera, en 4 trozos más un job que junta los informes.**
- **Cómo se demuestra en el paso c:** dos enteras de frentes distintos a la
  vez, con la foto de las cuentas de cada carril antes y después, y
  `medir_esperas.py` antes y después.

### Dos cosas que salen de la medida y caben en el paso 2 del encargo (0 €)

1. **La entera del mismo commit espera a su propio push:** 24 de 41 enteras
   y 381 min. El arreglo: que la entera lanzada a mano no comparta cola con
   el push del mismo commit, o que lo deje sin efecto, porque lo cubre.
2. **`aplicar-staging-conta` no coge el cerrojo:** hoy una tanda puede entrar
   a mitad de una e2e. Con la opción 2 se arregla solo; con la 1 hay que
   hacerlo aparte.

### Pendiente, fuera de este encargo

- **`c06/contrasena.spec.ts` dura 264 s, el 13 % de la suite.** Es una prueba
  de tiempos, y la misma en los dos tamaños. Si basta en ordenador, son
  2,2 min menos en todas las enteras. No la toco: cambiar lo que cubre una
  prueba lo decide su frente (C).
- **15 de 41 enteras en rojo.** No he mirado por qué; no es de este paso.

## Qué tiene que decidir Julio

1. **¿2 + 3, sin coste?** Es lo que recomiendo.
2. **O la 1**, a **25–35 €/mes** según se queden 3 o 4 ramas nuevas, con el
   trabajo de montarlas. Sin tu sí no se contrata nada.

Cifras tomadas el 16/10, de 11:30 a 12:40 UTC. Los runs que estaban en marcha
no cuentan.
