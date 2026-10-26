// src/modules/conta/verifactu/BandaPruebas.tsx
//
// V03 · Entrega 2 · La banda morada de PRUEBAS (tableros 26 y 27): fija arriba
// mientras la empresa está en pruebas. Dice que Hacienda comprueba las
// facturas pero no cuentan, y lleva a «Pasar a real». Apagado o en real, nada.

import { Link } from 'react-router-dom'
import { rutaAjustes } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { modoVerifactu } from '@/modules/conta/services/verifactuService'

export function BandaPruebas() {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const modo = useLeer(accountId && activa ? () => modoVerifactu(accountId, activa.id) : null, `${accountId}:${activa?.id}:verifactu-modo`)
  if (modo.datos !== 'pruebas') return null
  return (
    <div className="cxvf-banda" role="status" data-prueba="banda-pruebas">
      <span className="cxvf-banda-chip">Pruebas</span>
      <span className="cxvf-banda-texto">Estás en pruebas: Hacienda comprueba tus facturas, pero no cuentan. Llevan la marca «PRUEBA».</span>
      <Link to={rutaAjustes('verifactu')} className="cxvf-banda-enlace">Pasar a real</Link>
    </div>
  )
}
