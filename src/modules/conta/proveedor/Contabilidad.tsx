// src/modules/conta/proveedor/Contabilidad.tsx
//
// Pestaña «Contabilidad» (nunca «gestor»): SOLO la maqueta N7 (respuesta 3 del
// C02): «Sus cuentas» y «Saldo y movimientos» a todo el ancho, con «Ver
// extracto». Nada de formulario: cada línea se cambia desde su tarjeta.
//   · «Sus facturas se apuntan en» (su tipo de gasto o una cuenta para él):
//     «Cambiar» en la tarjeta, con buscador.
//   · El registro sanitario se edita en Datos fiscales; aquí solo se enseña.
//   · «Local habitual» no es contabilidad: va en el bloque de Cocina.
//   · Qué tipos de gasto usa el negocio, en Ajustes › Tablas generales (enlace
//     al pie de «Sus cuentas»).
// Sin el interruptor `conta` (cuenta B) la pestaña sale PLEGADA y todo lo
// demás de la ficha funciona igual (encargo §7 del C01).

import { useFicha } from '@/modules/conta/proveedor/contexto'
import { SusCuentas } from '@/modules/conta/proveedor/SusCuentas'

export default function Contabilidad() {
  const { datos } = useFicha()
  if (!datos.conta) {
    return (
      <details className="cxp-plegable cxp-cuentas">
        <summary><span className="cx-tarjeta-titulo">Contabilidad</span><span className="cx-ayuda">Tu cuenta no lleva la contabilidad en Folvy</span></summary>
        <SusCuentas />
      </details>
    )
  }
  return <div className="cxp-cuentas"><SusCuentas /></div>
}
