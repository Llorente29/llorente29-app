# novedades/

NV1 (Julio, 03/11). Lo que enseña el cartel de versión nueva y Ayuda › Novedades.

- **Un fichero por PR fusionado**, `pr-<número>.json`, que escribe
  `.github/workflows/novedades-al-fusionar.yml` con la sección `## Novedades`
  de su descripción (`scripts/pr/novedades.mjs`). Dos PR no tocan nunca el
  mismo fichero, como los tiempos de la e2e (T12).
- **No se escriben a mano.** Para corregir una frase ya publicada, se edita su
  fichero en un PR (que lleva su propia sección `## Novedades`, «ninguna» si
  solo es eso).
- **El build los junta** en `/novedades.json` (`build/novedadesPlugin.ts`) y
  sella en el bundle cuáles conoce: el cartel enseña las que trae la versión
  publicada y no la que tienes.
