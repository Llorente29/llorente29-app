# Web de los dosieres comerciales

Rama aparte, sin código de la app. Se publica en el proyecto de Vercel `folvy-dosier`
(raíz `web/`), a mano, nunca con un push: el `vercel.json` de la raíz apaga los despliegues
automáticos de esta rama.

- `web/index.html` — dosier de Folvy · https://dosier.folvy.app
- `web/sumied.html` — dosier de Sumied · https://dosier.sumied.com (la raíz lleva a `/sumied`)
- `web/panel.html` — visitas de los dos · https://dosier.folvy.app/panel (pide la clave del panel)
- `web/api/lugar.js` — ciudad aproximada del visitante, con las cabeceras de Vercel; no guarda nada
- Seguimiento: la función `dosier-track` de Supabase. Desde `dosier.sumied.com` va por `/t`
  (reescritura de `web/vercel.json`) porque la función solo admite el origen `dosier.folvy.app`.
- Para saber quién abre un enlace, se añade `?c=nombre` al final (por ejemplo `?c=cliente-1`).
