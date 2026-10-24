// src/modules/conta/diseno/plantillas/DialogoSalir.tsx
//
// «¿Salir sin guardar?» (encargo «Ficha de la recibida completa», punto 2 y
// el recuadro del tablero 3b). Dice QUÉ cambió y dónde, y da tres salidas:
//   · «Salir sin guardar» — en rojo, como texto: lo que pierde algo;
//   · «Seguir editando» — conserva el cambio. Tiene el foco al abrir (Intro no
//     tira nada), y Esc, el fondo y la × hacen lo mismo;
//   · «Guardar y salir» — la principal: guarda y, si va bien, sale. Si no, se
//     queda aquí y dice por qué (regla 8).
// Es el Dialogo del sistema (foco atrapado, aria-modal). Lo abre useAvisoSalir.

import { Boton } from '../Boton'
import { Dialogo } from '../Dialogo'
import { textoSalir, type CambioCampo } from './cambios'

export function DialogoSalir({ cambios, donde, guardando = false, fallo, alSalir, alSeguir, alGuardar }: {
  cambios: readonly CambioCampo[]
  /** Dónde se ha cambiado («COHELDI P26 4.980»). */
  donde?: string
  guardando?: boolean
  /** Por qué no se ha podido guardar, si se intentó. */
  fallo?: string | null
  alSalir: () => void
  alSeguir: () => void
  alGuardar: () => void
}) {
  return (
    <Dialogo titulo="¿Salir sin guardar?" alCerrar={alSeguir} explicacion={textoSalir(cambios, donde)}
      acciones={<>
        <Boton variante="enlace" className="s-boton-perder" onClick={alSalir} disabled={guardando}>Salir sin guardar</Boton>
        <Boton variante="secundario" onClick={alSeguir} data-autofocus="">Seguir editando</Boton>
        <Boton variante="principal" onClick={alGuardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y salir'}</Boton>
      </>}>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha guardado: {fallo}. Tus cambios siguen aquí.</p>}
    </Dialogo>
  )
}
