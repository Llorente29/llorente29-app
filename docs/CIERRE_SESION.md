# CIERRE DE SESIÓN — guion obligatorio

> **Por qué existe:** el 30/05/2026 se perdió casi una sesión entera de trabajo porque el cierre
> dependía de la memoria (de Julio y del asistente), no de un sistema. Esto lo arregla: el cierre
> es ahora un procedimiento fijo, versionado y verificable. **No se cierra una sesión técnica sin
> pasar por aquí.** La forma rápida y segura es ejecutar el verificador:
>
> ```
> .\scripts\cierre-sesion.ps1
> ```
>
> El script comprueba lo automatizable y te obliga a confirmar conscientemente lo demás. No
> termines la sesión hasta que el script dé **CIERRE OK** (todo verde). Si algo sale en ROJO, no
> está cerrado: arréglalo y vuelve a pasarlo.

---

## Los 7 pasos (en orden)

### 1. Working tree limpio o pendientes anotados
- **Criterio:** `git status` no muestra cambios inesperados. Lo que se deja sin commitear a
  propósito (p. ej. código de un tramo en curso) está ANOTADO en CONTEXTO §14 como "PENDIENTE".
- **Comprueba:** `git status --porcelain`
- **Hecho cuando:** o está vacío, o cada entrada es un pendiente que reconoces y está anotado.

### 2. El build pasa
- **Criterio:** `npm run build` termina sin errores (tsc + vite). Nunca se cierra con el build roto.
- **Comprueba:** `npm run build` (exit code 0)
- **Hecho cuando:** compila limpio. El warning de bundle >500KB es deuda conocida, no bloquea.

### 3. Todo commiteado y con push a origin/main
- **Criterio:** no quedan commits locales sin subir; `main` está sincronizado con `origin/main`.
- **Comprueba:** `git fetch origin main` y luego `git rev-list --left-right --count origin/main...main`
- **Hecho cuando:** ahead = 0 (nada por subir). Si behind > 0, revisa por qué antes de cerrar.

### 4. CONTEXTO_CLAUDE.md actualizado y commiteado
- **Criterio:** lo construido/decidido en la sesión está reflejado en CONTEXTO (§14 estado de
  ejecución: qué se hizo, commits de referencia) y ese cambio está commiteado y pusheado.
- **Comprueba:** `git log --oneline -5 -- CONTEXTO_CLAUDE.md` (debe haber commit de hoy) y que no
  hay cambios sin commitear en el fichero.
- **Hecho cuando:** CONTEXTO refleja la sesión y está en origin/main. **Requiere tu confirmación
  consciente** de que de verdad refleja lo de hoy (el script lo verifica a medias y te pregunta).

### 5. Cambios de BBDD reflejados en CONTEXTO
- **Criterio:** cualquier función SQL nueva/modificada o cambio de schema de la sesión está
  descrito en CONTEXTO §14.2 (firma, qué hace, y COMMIT en Supabase confirmado).
- **Comprueba:** juicio humano. ¿Hubo cambios de BBDD? ¿Están escritos? ¿Se hizo COMMIT en Supabase?
- **Hecho cuando:** o no hubo cambios de BBDD, o están todos reflejados con su COMMIT confirmado.

### 6. Sin corrupción / sobre-escapado en los .md
- **Criterio:** ningún markdown trackeado tiene sobre-escapado (`\*\*`, `\_`, `&#x20;`, cadenas de
  3+ barras invertidas). Este es el fallo que costó la sesión del 30/05.
- **Comprueba:** el script escanea todos los `git ls-files '*.md'` buscando esas firmas.
- **Hecho cuando:** 0 coincidencias, o las que haya son ejemplos legítimos que reconoces (el
  script te las muestra para que decidas).

### 7. Prompt de arranque de la próxima sesión escrito
- **Criterio:** está escrito, en CONTEXTO §14 (o donde corresponda), cuál es el PASO 1 de la
  próxima sesión, para no perder el hilo al cambiar de conversación.
- **Comprueba:** juicio humano. ¿Está escrito el siguiente paso inmediato?
- **Hecho cuando:** la próxima sesión puede arrancar leyendo CONTEXTO sin reconstruir nada.

---

## Regla de oro
Si el script dice **CIERRE OK**, la sesión está cerrada de verdad y la próxima arranca sin pérdida.
Si dice que falta algo, **no está cerrada** — da igual lo cansado que estés. El sistema existe
precisamente para los momentos de fatiga, que es cuando se pierden las cosas.
