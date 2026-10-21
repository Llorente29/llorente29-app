// src/modules/supply/components/ConteoMovilTerminado.tsx
//
// LA ÚLTIMA PANTALLA DE LA TABLET, con la regla nueva del autoconteo (0400,
// encargo de Julio del 21/10): al contar la última pieza, el recuento se aplica
// entero. Ya no hay «el encargado lo revisa».
//
// REGLA 8: la pantalla dice lo que ha pasado, con contenido. Hasta hoy, si el
// cierre fallaba, quien contaba no se enteraba («ya ha terminado su parte»), y
// así estuvieron dos meses los recuentos sin llegar al stock. Ahora:
//   · aplicando  → lo dice mientras espera;
//   · aplicado   → «El stock ya está al día», con la hora;
//   · faltan     → su parte está, y cuántos faltan de los compañeros;
//   · error      → lo contado está guardado, el stock no, y quién lo hará;
//   · manual     → un inventario manual sigue yendo a la oficina.
//
// LO QUE ESPERA FOLVY NO SE ENSEÑA NUNCA (cabecera de MiAutoinventario), ni
// siquiera aquí: ni cuántos productos cuadraban ni cuántos se ajustaron. Contar
// «3 ajustados» le enseñaría que 3 no cuadraban, y la próxima vez confirmaría
// en vez de contar.
//
// Solo pinta: el estado le llega por props.

import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { Marco, Cabecera, Centrado, Pie, BotonPrincipal } from '@/modules/supply/components/ConteoMovilPiezas'
import { horaMadrid } from '@/modules/supply/lib/autoconteoTexto'

export type EstadoDelFinal =
  | { tipo: 'aplicando' }
  | { tipo: 'aplicado'; a: string }
  | { tipo: 'faltan'; faltan: number }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'manual' }

export default function ConteoMovilTerminado({
  title, total, estado, onBack,
}: { title: string; total: number; estado: EstadoDelFinal; onBack: () => void }) {
  const loHecho = `Has contado ${total === 1 ? 'el producto' : `los ${total} productos`} que te tocaban. Gracias.`
  return (
    <Marco>
      <Cabecera title={title} />
      <Centrado>
        <span data-testid="conteo-terminado" data-estado={estado.tipo} hidden />
        <Check size={44} className="text-cocina-verde" />
        <p className="text-[24px] font-extrabold text-cocina-tinta mt-4">¡Listo!</p>
        <p className="text-[13px] text-cocina-tinta-2 mt-2 max-w-xs leading-[1.5]">{loHecho}</p>

        {estado.tipo === 'aplicando' && (
          <p className="text-[13px] text-cocina-tinta-3 mt-5 max-w-xs leading-[1.5] inline-flex items-center gap-2">
            <Loader2 size={15} className="animate-spin" /> Poniendo el stock al día…
          </p>
        )}
        {estado.tipo === 'aplicado' && (
          <div className="mt-5 max-w-xs rounded-cocina-md bg-cocina-verde-bg px-4 py-3 text-[13.5px] text-cocina-verde leading-[1.5]">
            <b>El stock ya está al día</b> con lo que se ha contado hoy (a las {horaMadrid(estado.a)}).
            No tienes que hacer nada más.
          </div>
        )}
        {estado.tipo === 'faltan' && (
          <p className="text-[13px] text-cocina-tinta-2 mt-5 max-w-xs leading-[1.5]">
            Quedan <b className="text-cocina-tinta">{estado.faltan} producto{estado.faltan === 1 ? '' : 's'}</b> de tus compañeros.
            Cuando los terminen, el stock se pone al día solo.
          </p>
        )}
        {estado.tipo === 'error' && (
          <div className="mt-5 max-w-xs rounded-cocina-md bg-cocina-ambar-bg px-4 py-3 text-left text-[13px] text-cocina-tinta-2 leading-[1.5]">
            <p className="inline-flex items-start gap-1.5 text-cocina-ambar font-semibold">
              <AlertTriangle size={15} className="shrink-0 mt-[2px]" />
              Lo que has contado está guardado, pero el stock no se ha podido poner al día ahora.
            </p>
            <p className="mt-1.5">Folvy lo vuelve a intentar esta noche, y si tampoco puede, avisa a la oficina. Tú no tienes que hacer nada.</p>
            <p className="mt-1.5 text-[11.5px] text-cocina-tinta-3 break-words">{estado.mensaje}</p>
          </div>
        )}
        {estado.tipo === 'manual' && (
          <p className="text-[13px] text-cocina-tinta-3 mt-5 max-w-xs leading-[1.5]">
            El encargado lo revisa y ajusta el stock. Tú no tienes que hacer nada más.
          </p>
        )}
      </Centrado>
      {/* «Cerrar» nunca se bloquea: si la red tarda, el aplicado sigue solo y quien
          cuenta no se queda atrapado en esta pantalla. */}
      <Pie><BotonPrincipal onClick={onBack}>Cerrar</BotonPrincipal></Pie>
    </Marco>
  )
}
