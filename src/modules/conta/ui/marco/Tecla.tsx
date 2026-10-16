// src/modules/conta/ui/marco/Tecla.tsx
//
// M01 · Una tecla dibujada (maqueta N30 §3): mono de 11 px, con borde y la
// línea de abajo más gruesa. Va al lado del botón que la usa; el lector de
// pantalla la oye por `aria-keyshortcuts` del botón, no por aquí.

export function Tecla({ children }: { children: string }) {
  return <kbd className="cxm-tecla" aria-hidden="true">{children}</kbd>
}
