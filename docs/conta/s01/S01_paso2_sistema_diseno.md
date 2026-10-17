# S01 · Paso 2.1 · El sistema de diseño

> Rama `conta/s01-esqueleto`. Primer trozo del S01: tokens y componentes
> compartidos. **No se ha movido ninguna pantalla.** El esqueleto (barra,
> cabecera, cinta y favoritos) es el paso 2.2.

## Qué hay

**`src/modules/conta/diseno/`** es el único sitio del sistema.

- `tokens.css`: un solo juego `--s-*`.
  - Color, letra (escala de 12 a 28), pesos, espacios en base 4, radios,
    medidas del esqueleto (cabecera 48 px, barra 88 px) y densidad.
  - Los valores de serie son los de N30, así que Folvy no cambia.
- `temas.ts`: cómo pinta cada marca.
  - La identidad (tinta, apoyo, acción, acento, letra) sigue en `marcas.ts`.
  - Aquí van superficies, barra, estados y radio. Los valores de Sumied se
    midieron píxel a píxel en las maquetas.
  - Vive en el front a propósito: en `_shared`, cada cambio de pintura
    obligaría a desplegar a mano las tres funciones que importan `marcas.ts`.
- `src/marca/tema.ts` escribe los `--s-*` de Sumied.
- Los `--cxm-*` del marco son ahora alias de los `--s-*`, con los mismos valores
  de serie.
- Componentes: `Boton` y `BotonEnlace` (principal, secundario, enlace y
  fantasma; con tecla, contador e icono) · `Campo` con `Texto`, `Importe`,
  `Fecha`, `Selector` y `Subcuenta` · `Chip` (seguro, duda, falta, neutro,
  acción y oscuro) · `Cifra` · `Tarjeta` y `TarjetaCifra` · `Cinta` y
  `GrupoCinta` · `Dialogo` · `Icono` (lucide, 16 px, trazo 1,75, por nombre).
- `Tabla`, `Formulario` y `Documento` son las piezas del M01, que se exportan
  desde `diseno/`. Se mudarán a la carpeta cuando sus pantallas pasen.
- **La página del sistema**: `ajustes/sistema-diseno`, solo fuera de
  producción. Con `?marca=sumied` se ve en Sumied.

## Reglas que se comprueban solas

`tests/unit/modules/conta/s01/diseno-reglas.test.ts`, en la batería de antes
de subir:

- ningún color escrito a mano en `diseno/` fuera de `tokens.css` y `temas.ts`;
- ningún tamaño de letra ni radio a mano en su CSS;
- nada de tablas tipo pijama en todo el CSS de contabilidad;
- los componentes solo importan lo permitido, y las pantallas del esqueleto
  solo cogen piezas de `diseno/`.

Cada regla lleva su «la prueba puede fallar».

## Dos cosas de las maquetas que no van igual (para Julio)

1. **El borde de los campos.**
   - Maqueta: `#DCE5F0`, que da 1,27:1 sobre blanco.
   - Tu decisión del C06 (R4) pide ≥ 3:1 (WCAG 1.4.11).
   - Va `#7F8FA6` en Sumied (3,29:1 sobre blanco y 3,06:1 sobre el fondo).
   - Es un solo valor en `temas.ts`: si prefieres el de la maqueta, se cambia
     ahí, pero entonces la prueba de contraste tiene que cambiar contigo.
2. **El azul de acción y el gris de apoyo.**
   - Maquetas: `#0A5BF0` y `#5B6B82`.
   - Identidad aprobada el 14/10 en `marcas.ts`: `#1E63C9` y `#4A5B73`.
   - Todos pasan AA.
   - He dejado los de la identidad porque son el único sitio de la marca y los
     usan también la entrada y los correos. Si mandan las maquetas, se cambia en
     `marcas.ts`: un valor cada uno.

## Y una de herramientas

El frente D (el del marco) ahora cubre también `conta/s<n>-…` y la carpeta de
capturas `s01/`.

- Cambian `scripts/conta/capturas.mjs` y el paso «Frente» del workflow.
- Una prueba compara los dos.
- Sin esto, las capturas del S01 no se podrían fijar.
- Un push de esta rama corre `tests/e2e/conta/s01` y el juego común (`area.mjs`,
  sin cambios).
