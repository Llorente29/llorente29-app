// src/shell/version/FranjaEntorno.tsx
//
// «PREVIEW · rama X · NO ES PRODUCCIÓN», y no se puede quitar.
//
// EL 01/09 PASÓ ESTO: Julio llevaba tiempo operando el negocio desde una
// PREVIEW de rama (feat-hubrise-fase3-ui, con el service worker registrado el
// 16/08) — contra la BASE DE DATOS REAL. Los pedidos, los fichajes y el stock
// eran de verdad; el código, de hace dos semanas. Y no había absolutamente
// nada que lo distinguiera de producción: mismo aspecto, mismos datos.
//
// Que un despliegue de prueba sea indistinguible del real es cómo se pierden
// dos semanas de arreglos y cómo alguien acaba operando con código viejo.
//
// POR QUÉ ES PERMANENTE Y NO SE PUEDE CERRAR
// Un aviso que se cierra se cierra el primer día y ya no vuelve. Esto no es
// una notificación: es una etiqueta de lo que estás mirando, como el sello de
// un documento. Ocupa poco y está siempre.
//
// EN PRODUCCIÓN NO SE PINTA NADA. Lo normal no lleva etiqueta; si la llevara,
// se aprendería a ignorarla y volveríamos al punto de partida.

import { entornoDeBuild, ramaDeBuild, esProduccion } from '@/services/versionApp'

export default function FranjaEntorno() {
  if (esProduccion()) return null

  const entorno = entornoDeBuild()
  const rama = ramaDeBuild()

  // 'local' es un build de alguien en su portátil servido en algún sitio.
  // Tampoco es producción, y también tiene que decirlo.
  const etiqueta = entorno === 'preview' ? 'PREVIEW' : 'BUILD LOCAL'

  return (
    <div
      role="status"
      className="fixed top-0 left-0 right-0 z-[100] bg-warning text-black text-[11px] font-semibold tracking-wide
                 px-3 py-1 flex items-center justify-center gap-2 shadow-md pointer-events-none select-none"
    >
      <span className="uppercase">{etiqueta}</span>
      {rama && <span className="font-normal opacity-80">· rama {rama}</span>}
      <span className="font-normal">· NO ES PRODUCCIÓN — los datos que ves SÍ son reales</span>
    </div>
  )
}
