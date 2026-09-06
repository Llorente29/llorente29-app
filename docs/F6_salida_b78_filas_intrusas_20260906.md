# F6 · Consecuencia esperada — B78: filas que no eran de la consulta, y el idioma

Escrito **ANTES** del push. **06/09/2026, 08:10 Madrid — fuera de la banda 12:15 → 23:45.**

> ## ⚠️ ESTE FRENTE NO SE CIERRA CON ESTE PUSH
>
> **El síntoma queda cerrado por guardas. La causa está entendida A MEDIAS.**
> No es lo mismo y no se va a escribir como si lo fuera.

---

## 1 · Qué está probado, y con qué

**Reproducido al céntimo contra la base.** La fila `Uber` que la tabla pintaba
bajo un informe de `marca × propiedad` es **la respuesta de otra pregunta**:

| | pedidos | bruto | descuentos | neto |
|---|---|---|---|---|
| lo que pintaba | 96 | 3.436,37 | 1.418,96 | 2.017,41 |
| **eje `canal` · Alcalá · propias · semana en curso** | **96** | **3.436,37** | **1.418,96** | **2.017,41** |

Los cuatro números. Por eso sus `dims` eran `{canal: "Uber"}` y no traían marca
ni propiedad.

**Y el motor está limpio en las dos ventanas.** La consulta de la captura
devuelve **7 filas, todas con `marca` y `propiedad`**, sumando 51 pedidos y
1.079,94 €. El espejo devuelve otras 7, entre ellas `The Urban Kebab` a 22,05 €
— que es la 8ª fila, la que ya no vende, saliendo a cero con su −100 %.
**Eso es `cruzaConEspejo` funcionando bien y no se toca.**
**No existe ninguna marca llamada «Uber» ni «Foodint Alcalá».**

## 2 · El defecto de código, probado y arreglado

**`ejecuta()` no cancelaba ni ordenaba.** Siete dependencias disparan el efecto;
con dos consultas en vuelo ganaba **la que RESPONDÍA la última, no la que se
PEDÍA la última**, porque `setInforme(r)` escribía sin comprobar nada. Es el
único mecanismo del código que puede poner en pantalla el resultado de otra
pregunta, y encaja con el *«siempre está»*.

Arreglado con un número de petición: **una respuesta que llega tarde se
descarta**.

**Y un segundo defecto que apareció de paso:** al elegir en filas el eje que ya
estaba en columnas, el chip desaparecía de la lista **pero el estado se quedaba**,
y se pedía el mismo eje dos veces. Ahora al elegirlo en filas se limpia el de
columnas.

## 3 · 🔴 Lo que NO he conseguido explicar

**Con este código, una pantalla mezclada no debería ser posible.** El pie sale de
las mismas filas que pinta la tabla, así que una fila pintada tiene que entrar en
el total.

**La mitad de la mecánica sí está explicada:** una fila que sólo existe en el
espejo se construye con `bruto`, `descuentos`, `neto` y `pedidos` **a cero** — se
pinta y **suma cero al total**. Por eso el pie puede ver 8 filas mientras el
cuerpo pinta 10 sin que el total se mueva. La medición de Julio lo confirma: el
`Neto anterior` del pie, **823,22 €**, es la suma exacta de los 7 valores del
espejo de esas marcas.

**Lo que sigue sin explicación es por qué esas dos filas mostraban cifras en las
columnas del periodo** (96 pedidos, 2.017,41 €) **en vez de ceros**, que es lo que
esa vía produce. Y la segunda fila, `Foodint Alcalá · 44 · 890,25 · 0,00`, **no la
he podido casar con ninguna consulta**: probé eje local con y sin filtros,
cedidas, y las tres ventanas. Ninguna da 44 pedidos con **cero descuentos**, y
Alcalá descuenta el 20,7 %. **No la fuerzo a encajar.**

⇒ **Pista que dejo escrita para quien lo cierre**, y es de Julio: bruto igual a
neto y descuento cero es **la firma de una fila construida sin esos dos campos**.
Hay que buscar **qué forma de respuesta no los trae**, no qué consulta da 890,25
con cero descuentos — esa consulta probablemente no existe.

## 4 · Las guardas, que cierran el síntoma sin depender de la causa

1. **Una fila cuyas `dims` no traigan EXACTAMENTE los ejes pedidos no se pinta.**
   Ni le pueden faltar ni le pueden sobrar. Por construcción, no por acordarse.
2. **Y no filtra en silencio: la tabla DICE qué ha descartado**, con sus `dims`.
   Mientras la causa siga abierta, esa línea es lo que la va a identificar. Un
   filtro callado nos dejaría sin saber nunca de dónde salían.
3. **Si las filas no suman el total, la tabla lo dice**, con las dos cifras y un
   «no te fíes de esta tabla hasta que cuadre». Hasta hoy el fallo sólo se veía
   sumando a mano — y lo hizo Julio.

## 5 · El idioma (§3.bis), en el mismo push para no gastar dos OTA

**La cabecera ya no enseña SQL ni identificadores.** Antes:
`{"locales":["38158159-cd71-4056-950b-53425afac1ce"]}` y
`account_id = la cuenta · is_active · status <> cancelled`.
Ahora, dos líneas:

> **Del 24 al 30 de agosto · Alcalá · marcas propias · todos los canales**
> *Ventas cobradas, sin pedidos cancelados. Horario de Madrid. Comparado con
> del 17 al 23 de agosto, completo.*

**La banda se queda** — es lo que protege de medir una cosa creyendo que se mide
otra, y lo que permite cuadrar la pantalla con el correo. Lo que cambia es que se
dice con palabras.

Y el resto del vocabulario: *espejo* → **periodo anterior** · *agrupar por ·
columnas* → **separado por…** · *cedidas* → **de terceros** · *sin espejo* →
**sin comparación**.

**Detalle que importa:** el intervalo se dice **«al 30», no «al 31»**. El límite
superior es exclusivo —la semana acaba el lunes a las 00:00— y nombrar el 31
sería nombrar un día que no entra en la cifra.

## 6 · Verificación

| | |
|---|---|
| Las 8 filas de marca pasan la guarda y las 2 intrusas no | ✅ probado con sus cifras reales |
| Lo que queda suma **1.079,94 € y 51 pedidos** | ✅ igual que el pie |
| La fila que ya no vende **sigue pasando** | ✅ |
| Guarda al revés: fila de otro eje → **no se pinta** | ✅ |
| Cuadre al revés: quitando o sobrando una fila → **lo dice** | ✅ |
| Un céntimo de redondeo no es descuadre; dos sí | ✅ |
| La cabecera no saca `account_id`, `is_active`, `status`, `sale.total` ni UUID | ✅ probado con `grep` en la prueba |
| Ningún Δ dice «vs ayer» | ✅ `grep` → 0 |
| `npm run build` | ✅ verde |
| Suite | ✅ **703 de 709**; las 6 rojas son las preexistentes |
| Lint | ✅ **cero** en los cuatro ficheros |

**Lo que NO puedo verificar: la captura.** No tengo sesión en la app. Las guardas
están probadas con las cifras reales de la pantalla de Julio, pero **el render lo
tiene que mirar él**.

## 7 · Riesgo residual

1. **La causa de la mezcla sigue abierta.** Si vuelve a pasar, la tabla lo dirá
   sola: saldrá el aviso con las `dims` de la fila intrusa, y eso es lo que
   faltaba para identificarla. **B78 no se cierra hasta entonces.**
2. **Este push publica OTA** a las tres estaciones. `mandatory = false`.
3. **El §4 del encargo —la vista simple— NO se ha tocado.** Cambiar una pantalla
   recién aprobada sin que Julio lo confirme es el principio 6 al revés.
