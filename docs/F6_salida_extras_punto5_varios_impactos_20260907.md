# F6 · Extras, punto 5 — una opción puede llevar varias cosas

**07/09/2026 · primer trozo del encargo «Extras» · NO publicado (banda)**

El punto 5 de tus decisiones, que va delante de todo lo demás: antes de que la
sección escriba el segundo impacto, el sitio donde se lee tiene que aguantarlo.

---

## 1 · Eran DOS supuestos, no uno, y fallaban distinto

El RECON decía «`upsertImpact` hace `maybeSingle()`». Al abrirlo había otro, y
es el peor de los dos:

| camino | qué hacía con dos impactos | |
|---|---|---|
| escritura · `upsertImpact` | **revienta** — `.maybeSingle()` con dos filas lanza | ruidoso |
| lectura · `listOptionsWithImpacts` | **miente** — se quedaba con uno (ranking `confirmed > proposed > rejected`) y los demás no llegaban a la pantalla | **silencioso** |

El de lectura es el caro. Una opción que lleve pan, carne y salsa enseñaba
**una de las tres**, sin una nota que lo dijera. Es la familia de la regla 7
—esconder filas que existen— y es peor que reventar, porque nadie se entera.

Ninguno de los dos había mordido nunca: en producción hay **40 impactos y cero
opciones con más de uno**. Suerte, no diseño — la base no tiene índice único por
`modifier_option_id`, sólo la primaria.

---

## 2 · La decisión de verdad: qué cuesta una opción con tres cosas

No es «la suma». `resuelveOpcion` (en `lib/`, lógica pura y probada) impone la
regla que importa:

> **Una sola parte que no se puede calcular tumba el total.**

Si de tres cosas dos suman 0,40 € y de la tercera no se sabe, el total **no** es
0,40 €: es que no se sabe. Devolver la suma parcial sería afirmar que la tercera
vale cero — que es exactamente el error de B73a un piso más arriba, el que costó
los diez impactos sin unidad pintados en verde.

Y el estado, en `estadoDeLaOpcion`: **una parte por revisar deja la opción por
revisar**, aunque las otras estén confirmadas. Antes el ranking se quedaba con la
confirmada y la opción salía verde teniendo una a medias. Los `rejected` no
cuentan para nada: son una respuesta dada y descartada, no una parte de lo que la
opción lleva.

La cobertura del plato sigue la misma regla: una opción cuenta como resuelta sólo
si **todo** lo que lleva está dicho.

---

## 3 · Lo que se ve en la pantalla

La pestaña «Modificadores» del plato pinta ahora **una línea por cosa**, cada una
con lo que aporta y su propio «Ajustar» —porque para corregir una hay que decir
cuál—, y debajo **«Añadir otra cosa»**. Con la opción vacía sigue diciendo
«Definir», igual que antes.

En `ModifierEditorSection` (el editor de grupos, que sólo resume) se pinta
**«Lleva N cosas ·»** cuando hay más de una, y el resumen elige la que está por
revisar, que es sobre la que hay que actuar. Enseñar una de tres sin avisar era
justo lo que había que quitar.

---

## 4 · Un error mío, y por qué el `key` en vez del efecto

Escribí primero un `useEffect` que reiniciaba el formulario al cambiar de cosa a
editar. **Metía un error de lint nuevo** (`react-hooks/set-state-in-effect`) y
además estaba mal: hasta el siguiente render, «Ajustar» sobre la segunda abría
con los datos de la primera. Se arregla con `key`, no con un efecto — el
formulario salió a `EditorDeUnaCosa`, montado con `key={editingKey}`, y arranca
solo de lo que se está corrigiendo.

El otro error nuevo estaba en la prueba: copié el coste de «La Triple» tal cual
lo guarda producción —`4,0017680447597865154660209208467177250000`— y eso **pierde
precisión** en un número de JavaScript. Recortado a los decimales que sí caben,
y dicho en la prueba: fingir la precisión es peor que perderla.

Los dos salieron de medir el lint a los dos lados, no de leer el diff.

---

## 5 · Verificación, con la misma vara

| | `HEAD` limpio | con el punto 5 |
|---|---|---|
| pruebas | 6 fallan · 830 pasan · 836 | 6 fallan · **843 pasan** · 849 |
| lint | 1357 · 1057 errores · 300 avisos | **1357 · 1057 errores · 300 avisos** |
| `npm run build` | verde | verde |

+13 pruebas. Lint idéntico: cero nuevos. Los 6 fallos rojos son los de `main`,
en tres ficheros que no toco (declarados en el F6 de B83).

**Las piezas de la prueba son reales**, sacadas de producción el 07/09 con
`_impact_cost` delante (regla 31):

- «Tarta 3 Leches 🤤» · `add_item` 1 ud · ficha 3,1580 €/ud → **3,1580 €**
- «La Triple» · `bundle` 1 ud · ficha 4,0018 €/ud → **4,0018 €**
- « Sweet Chili T» · `add_item` 50 g · ficha 0,0051 €/**ml** → **no calculable**

La que importa: Tarta + Sweet Chili **no** da 3,158 €. Da «no se sabe», y la
prueba comprueba explícitamente que no devuelve el importe.

---

## 6 · NO PUBLICADO, y por qué

Terminado a las 14:2x de Madrid, **dentro de la banda**. Y esta vez no me he
fiado sólo del reloj —que es lo que me falló anoche—: pregunté a
`station_update_window`, que es la que sabe.

| | impresión | pedidos en curso | min desde la última venta |
|---|---|---|---|
| Foodint Alcalá | 0 | 2 | **1** |
| Foodint Carabanchel | 0 | 1 | **5** |

Las dos en pleno servicio, `safe = false` en ambas. El commit está hecho y **no
se ha empujado**. Sale después de las 23:45, comprobando la ventana otra vez.

---

## 7 · Lo que queda, y una deuda que dejo escrita

Esto es sólo el punto 5. Falta la sección entera, que **espera tu maqueta**.

**Deuda:** la base sigue **sin índice único** por `modifier_option_id`, y ahora
es a propósito — varios impactos por opción es el modelo bueno. Pero conviene
decidir si hace falta alguna guarda: hoy nada impide dos impactos idénticos
apuntando a la misma ficha, que sumarían el coste dos veces. No lo he puesto
porque no me lo has pedido y porque una restricción mal elegida es peor que
ninguna; lo dejo dicho para que sea una decisión y no un olvido.
