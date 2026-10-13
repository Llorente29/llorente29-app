# B01 · Parte de la tarea 6, parado antes de la 7

Rama `conta/b01-bancos`. Respuesta 4 de Julio (13/10/2026): «Sigue con la tarea
6 después de los retoques… Para antes de la 7 con capturas de ordenador y móvil
del cierre del mes, de la banda del agente y de los retoques del punto 2.»
Todo con datos inventados.

## 0. `main` traído

C fusionó los usuarios de prueba por frente (#179), y la respuesta 3 pedía traer
`main` entonces. Fusionado en la rama (86 commits). Cuatro conflictos, resueltos así:

| Fichero | Cómo |
|---|---|
| `.github/workflows/e2e-staging-conta.yml` | el de `main` entero. Trae su propia entrada `pruebas` (lo mismo que mi `ruta`, más el frente y el cerrojo de staging): **mi `ruta` desaparece** |
| `src/modules/conta/services/propuestasLibroService.ts` | los dos: la serie de tesorería (B01) y la regla de ventas por plataforma (C04b) |
| `docs/conta/contraste.md` | las dos secciones (Bancos y el anexo de Diez) |
| `supabase/staging/aplicar.txt` | el de `main` (lo reescribe la tanda siguiente) |

Con los usuarios por frente, mi rama entra como `a.admin.frente-b@…` (la misma
cuenta A): mis e2e no tocan la contraseña de nadie más.

## 1. Retoques de la respuesta 4

| Punto | Hecho |
|---|---|
| 1 · Barra en una fila | Nombre corto de cada banco (`treasury_account.short_name`, editable en Cuentas y extractos con `bank_cuenta_alias`; la semilla pone «B01 Norte», «B01 Sur», «B01 Mercado»). Hasta cuatro bancos, todos; desde cinco, tres a la vista —el de más dudas y el elegido siempre— y «y N más», que abre la lista. La e2e mide que los cuatro grupos están en la misma fila. Libros, sin tocar |
| 2.1 · La barra de la IA tapaba una fila | En Bancos no se enseña: `MarcoConta` tiene `sinPregunta` (y en el móvil quita el botón central de la IA, no la barra de navegación). Fichero compartido del C00, cambio pequeño. El hueco del final ya estaba (`.cx-principal`, 104 px) |
| 2.2 · «Conectar · pronto» | Fuera. Vuelve cuando exista el contrato del agregador |
| 2.3 · Un solo botón principal | Ámbar: «Sí» (o «Subir foto» si falta el ticket). Gris: «Decirlo yo». Verde: ninguno, «Ver» y «Deshacer» en secundario. Lo decide el núcleo (`filaDe().principal`) y lo prueba la e2e |
| 2.4 · Migas | «Bancos › Banco B01 · Norte · ···0011» |
| 2.5 · El «difiere» de staging | La semilla lleva el asiento de apertura de cada banco a 30/09 (propuesto, origen `opening`, que el cierre ya no cuenta como «en contabilidad y no en el banco»). Ahora la diferencia de Norte es **exactamente** lo que queda sin casar (−2.175,50 €) y la pantalla lo dice |
| 2.6 · Móvil al lado del ordenador | En §5 |

## 2. Las reglas (respuesta 4, punto 3)

1. **Lo que sale de una regla o de lo aprendido es siempre probable.** Ya lo
   era: el motor no da «seguro» por una regla ni por lo aprendido en ningún
   caso, ni con la regla confirmada (seguro solo sale de los casos con
   pareja exacta: factura con referencia, traspaso, liquidación, cuota,
   asiento ya apuntado). Es más estricto que lo pedido; lo dejo así y lo
   prueba `agregadorB01.test.ts` («una regla propone, nunca casa sola»).
2. **Dos correcciones la apagan.** En la base: cuando la persona casa con otra
   cosa lo que proponía una regla (`bank_casar`), es una corrección
   (`bank_rule.corrections`); a la segunda, la regla pasa a «apagada», queda en
   su registro y en «Lo que ha hecho Folvy»: «He apagado la regla «…»: la has
   corregido dos veces. Puedes volver a encenderla en Reglas.». Un «Sí» a lo
   que propone no cuenta. Probado en staging (paso 2 de la prueba nueva).

## 3. Tarea 6

### 3.1 Agente «Conciliación»

Tiene dos partes, porque una casa y la otra vigila:

- **La que casa** es el motor de siempre, con sus guardas: nada se valida fuera
  de «validar solo lo seguro» de la empresa. Corre **después de cada extracto**
  (Subir extracto) y **una vez al día**: si hoy no ha pasado, la primera vez que
  alguien abre Bancos. Cada pasada queda en `bank_agent_run` con su resumen, y
  ese resumen sale en la banda verde («Mi última pasada, hoy a las 09:12 (al
  subir un extracto): He casado yo 3; te propongo 2 y quedan 4 por aclarar.») y
  en «Lo que ha hecho Folvy».
- **La que vigila** corre cada noche con los demás agentes, en solo lectura
  (`scripts/conta/agente-conciliacion.sql`, `lib/conciliacion.mjs`; en staging
  y en producción). Mira lo del encargo: nada casado dos veces, ningún asiento de
  Bancos sin movimiento, los meses cerrados siguen cuadrando, reglas con su
  registro, extractos que cuadran; y lo nuevo: permisos del agregador caducados o
  por caducar, y movimientos sin mirar sin pasada del agente en 48 h. Sobre el
  volcado real de staging dice, con razón, una sola cosa en ámbar: 15
  movimientos sin mirar y ninguna pasada (las e2e lo deshacen todo al acabar).

**Lo que no es exactamente lo pedido, y lo digo:** «una vez al día» depende de
que alguien abra Bancos ese día, porque el motor corre en la app con los
permisos de la persona (las funciones comprueban que es administrador o
encargado de la cuenta). Si nadie entra, no pasa; y lo caza el agente de la
noche («sin pasada», en ámbar). Hacerlo sin nadie delante pide una función del
servidor con identidad propia (una edge function con su cron) y que las
funciones del banco acepten esa identidad: es un cambio de seguridad y lo
decides tú. **¿Lo quieres para la tarea 7?**

### 3.2 Cierre del mes del banco

- `bank_mes_cerrar(banco, mes, a_sabiendas, porqué)`: el mes en curso no se
  cierra; con movimientos sin casar, sin el saldo de fin de mes o con
  diferencia, **no**, salvo a sabiendas y con su porqué, que queda escrito con el
  nombre de quien cerró; el mismo mes dos veces, no. `bank_mes_reabrir` pide
  porqué. Cada cosa, en «Lo que ha hecho Folvy».
- La pantalla enseña lo que calcula la base (`bank_meses_estado`), el mismo
  estado que comprueba el cierre: saldo del banco, de contabilidad, la
  diferencia y la lista que la explica (en el banco sin casar · en contabilidad
  y no en el banco). Botones: «Cerrar octubre» cuando cuadra, «Cerrar a
  sabiendas…» cuando no, «Reabrir…» si está cerrado.
- Staging no tiene un mes terminado con datos (todo es de octubre): la captura
  enseña octubre «aún no ha terminado». El cierre de un mes terminado lo prueba
  la prueba de staging (paso 3): septiembre de Mercado con un recibo sin casar →
  no; a sabiendas sin porqué → no; con porqué → sí (2.400 / 2.500 / −100 y 1
  suelto); dos veces → no; reabrir; casado el recibo → cierra igual al céntimo.

### 3.3 Agregador (sin pantalla)

- **Enable Banking**: `proveedorEnableBanking(transporte)` cumple la interfaz de
  siempre (`ProveedorAgregador`). La llamada firmada (la clave de la aplicación)
  se inyecta: aquí no hay claves ni red. Su transacción se pasa a nuestro modelo
  en **una sola función** (`movimientoDeEnableBanking`): si al firmar algún campo
  cambia, se cambia solo ahí. Páginas con `continuation_key`, solo lo
  contabilizado. Los nombres de campo salen de su esquema publicado
  ([referencia](https://api.enablebanking.com/), [esquema](https://apis.io/schemas/enable-banking/enable-banking-transaction/)); no he podido leer su documentación entera desde el contenedor.
- **El mismo movimiento por dos caminos**: el agregador no trae las referencias
  del Norma 43, así que la huella entera difiere; la **huella suave** (día,
  importe y orden en el día) coincide. `bank_importar` lo aplica: entre una
  fuente y otra, la suave basta y no entra dos veces; entre dos ficheros, sigue
  preguntando «¿es el mismo?». Probado en staging (paso 5) y con los
  movimientos de la demostración en las unitarias.
- **Consentimiento**: dura 180 días (`caducaElConsentimiento`); 7 días antes
  avisa con cuándo caduca y el clic que lo renueva («Renovar el permiso» y
  confirmas en tu banco). Las conexiones van en `bank_aggregator_link`; el
  agente de la noche avisa en ámbar a 7 días y en rojo si caducó y sigue activo.
  **Nada de esto se ve en pantalla** hasta el contrato.

## 4. Pruebas

(Se completa con los runs.)

## 5. Capturas

(Se completa con el run de las capturas.)

## 6. Ficheros compartidos tocados en esta tanda

| Fichero | Cambio |
|---|---|
| `src/modules/conta/marco/MarcoConta.tsx`, `MenuConta.tsx`, `module.tsx` | `sinPregunta`: una pantalla puede no enseñar la barra «Pregunta o pide algo» ni el botón central de la IA (solo Bancos la usa) |
| `.github/workflows/cumplimiento-nocturno-conta.yml`, `cumplimiento-produccion-conta.yml` | el paso del agente «Conciliación», igual que el del libro |
| `supabase/migrations/20261101T0110_b01_funciones.sql` | (mía, misma tanda) `bank_casar` cuenta la corrección de una regla; `bank_importar` reconoce el mismo movimiento entre fuentes |
