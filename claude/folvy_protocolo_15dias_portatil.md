# Protocolo 15 días — Julio en portátil

**Creado:** 17/08/2026. **Vigente:** mientras Julio esté fuera de su PC habitual.

> **Nota de procedencia.** Este fichero **no existía en el repo** cuando se pidió
> actualizarlo: vivía como documento de claude.ai, que Claude Code no puede leer.
> Se crea aquí con lo único que consta verificado — la ventana de despliegue y su
> evidencia. Si el original tenía más apartados, faltan y hay que traerlos.

---

## 1. Ventana de despliegue

**Se despliega hasta las 12:15. Prohibido entre las 12:15 y las 23:45.**

Se aplica a: merges a `main` (disparan `build-apk` → bundle OTA a las tablets),
despliegues de Edge Functions, y migraciones.

### Por qué esas horas, y por qué NO son las 11:00

La ventana anterior decía «nunca entre las 11:00 y las 23:45». **Ese 11:00 era una
estimación que nadie comprobó.** El dato real de 30 días de Foodint lo desmiente:

| Hora | Ventas en 30 días |
|---|---|
| 11:00 | **0** |
| 12:00 | 3 sueltas, en 2 días de 30 |
| 13:00 | **266** — los 30 días de 30 |

Nadie usa la app antes de las **12:45**, salvo los **fichajes de las 12:30**.

Esa es la frontera dura: **12:30, por los fichajes.** La ventana se cierra a las
**12:15** para dejar quince minutos de margen — el pipeline tarda, y un despliegue
que empieza a tiempo puede terminar tarde.

### Cómo se lee esto

El límite no es «la hora a la que se puede pulsar»: es **la hora a la que tiene que
estar terminado**. Si el pipeline no acaba antes de las 12:15, **no se fuerza**: el
trabajo se queda en la rama y sale esa noche después de las 23:45.

---

## 2. Persistencia

Claude Code corre en un **contenedor efímero** que se recicla por inactividad. La
ubicación de Julio es irrelevante para eso; el riesgo es el contenedor.

- **GitHub es la única persistencia.** Todo se empuja a `origin` en cuanto existe.
  Nada se queda «para el commit final».
- Los documentos del proyecto de claude.ai **son invisibles** para Claude Code. O el
  contenido va dentro del encargo, o vive en el repo. Ha bloqueado el trabajo cuatro
  veces (regla fijada el 17/08).
- Un despliegue programado para después de las 23:45 **no puede darse por hecho**: el
  contenedor puede no seguir vivo. Se confirma explícitamente antes de contar con él.
