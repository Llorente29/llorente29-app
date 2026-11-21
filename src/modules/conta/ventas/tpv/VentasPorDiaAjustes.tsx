// src/modules/conta/ventas/tpv/VentasPorDiaAjustes.tsx
//
// R06 · Ajustes › Ventas por día: desde aquí se abre siempre «A qué cuenta va
// cada forma de pago» (la misma ventana que sale desde Cierres del día), con
// lo que hay en una frase. Al guardar, la lista se vuelve a leer sin quitar la ventana de en medio.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CONTA, rutaConta } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeerConservando } from '@/modules/conta/libros/contexto'
import { Boton } from '@/modules/conta/diseno'
import { TarjetaApartado } from '@/modules/conta/empresa/campos'
import { TarjetaCargando } from '@/modules/conta/ui/piezas'
import { leerFormas } from '@/modules/conta/services/tpvSubirService'
import { useIsMobile } from '@/shell/useIsMobile'
import { FormasDePago } from './FormasDePago'

export function VentasPorDiaAjustes() {
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const [vuelta, setVuelta] = useState(0)
  const [abierta, setAbierta] = useState(false)
  // R07 · Al guardar, se vuelve a leer sin vaciar la página: con useLeer, la página volvía a «cargando», la
  // ventana se desmontaba y su confirmación se perdía («Guardar» callaba; e2e 44707061711, regla 8).
  const datos = useLeerConservando(accountId && activa ? () => leerFormas(activa.id) : null, `${activa?.id}:${vuelta}:formas-tpv`, `${activa?.id}:formas-tpv`)
  if (!activa) return null
  if (!datos.datos && !datos.error) return <TarjetaCargando />
  const formas = datos.datos?.formas ?? []
  const sin = formas.filter((f) => !f.cuenta_id).length
  const frase = formas.length === 0
    ? 'Todavía no hay ninguna forma de pago: salen aquí cuando subes las ventas de un día del TPV desde Cierres del día.'
    : `${formas.length} ${formas.length === 1 ? 'forma de pago' : 'formas de pago'} del TPV${sin ? `, ${sin === 1 ? 'una' : sin} sin cuenta todavía` : ', todas con su cuenta'}.`
  return (
    <TarjetaApartado titulo="Ventas por día" movil={movil}>
      <p className="cx-ayuda" data-prueba="formas-resumen">{frase}</p>
      <p className="cx-ayuda">Cada forma de pago del TPV va a una cuenta al debe del asiento del día (la caja, el banco, la de cada plataforma). Lo que cambies vale para los días que aún no están validados. Las ventas se suben en <Link to={rutaConta(CONTA.rutas.cierres)}>Cierres del día</Link>.</p>
      {datos.error && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer las formas de pago: {datos.error}</p>}
      <div><Boton variante="secundario" onClick={() => setAbierta(true)}>A qué cuenta va cada forma de pago</Boton></div>
      {abierta && <FormasDePago companyId={activa.id} quien={userName ?? null} alCerrar={() => setAbierta(false)} alGuardar={() => setVuelta((v) => v + 1)} />}
    </TarjetaApartado>
  )
}
