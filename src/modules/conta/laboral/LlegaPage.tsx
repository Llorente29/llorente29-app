// src/modules/conta/laboral/LlegaPage.tsx
//
// LS1 (28/10/2026) · Lo que aún no existe en Laboral no se esconde: sale en
// el menú con «Llega en …» y aquí dice qué será y cuándo (Julio, 28/10).
// Las fechas salen de productos.ts: un solo sitio.

import { useParams } from 'react-router-dom'
import { Tarjeta } from '@/modules/conta/diseno'
import { PRODUCTOS } from '@/modules/conta/esqueleto/productos'
import { SUMIED, conProductoLaboral } from '@/modules/personal/laboral/productoLaboral'

const QUE_SERA: Record<string, string> = {
  contrato: 'El contrato de cada persona con lo importante a la vista (tipo, jornada, categoría, salario, periodo de prueba) y su convenio, para que el registro de jornada y las nóminas sepan qué le toca.',
  nominasSumied: 'Sumied calculará las nóminas de cada mes a partir del contrato, el convenio y los fichajes. Mientras tanto, las nóminas que manda la gestoría se ven en «Nóminas de la gestoría».',
  seguros: 'Los seguros sociales de cada mes, cuadrados con las nóminas, listos para presentar.',
  sepe: 'Las comunicaciones al SEPE (contratos y altas) desde la ficha de cada persona.',
}

export default function LlegaPage() {
  const { que = '' } = useParams<{ que?: string }>()
  const pagina = PRODUCTOS.find((p) => p.id === 'laboral')?.pestanas.find((t) => t.id === que && t.llega)
  return conProductoLaboral(SUMIED, (
    <div className="s-laboral-llega" data-prueba="laboral-llega">
      <Tarjeta titulo={pagina ? `${pagina.etiqueta} · ${pagina.llega}` : 'Esto llega más adelante'}
        apoyo={QUE_SERA[que] ?? 'Esta parte de Laboral aún no está hecha.'} />
    </div>
  ))
}
