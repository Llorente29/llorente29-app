// src/modules/conta/empresa/ApartadoHosteleria.tsx
//
// S01 · «¿Es un negocio de hostelería?», en Ajustes › Empresa, al lado de «A
// qué te dedicas». Es la marca explícita de la empresa (company.is_hospitality,
// decisión de Julio del 17/10: los datos solo sugieren): con ella salen
// Liquidaciones, plataformas y socios de marca, y la tarjeta de Catcher. Se pone
// en el alta por la actividad y aquí se cambia.
//
// Regla 8: cambiarla dice qué sale y qué deja de salir. Regla 7: lo que deja de
// salir son pestañas y tarjetas; ningún dato se borra ni se esconde de la lista.

import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { guardarHosteleria } from '@/modules/conta/services/empresaDatosService'
import { refrescarContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import type { DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import type { Quien } from '@/modules/conta/empresa/apartados'

const QUE_SALE = 'Liquidaciones en Compras y gastos, las plataformas y los socios de marca en Contactos, y la quincena de Catcher en Facturas recibidas'

export function ApartadoHosteleria({ d, quien, alCambiar, movil }: { d: DatosEmpresa; quien: Quien; alCambiar: () => void; movil: boolean }) {
  const h = useHacer(() => { alCambiar(); refrescarContextoEsqueleto() })
  const es = d.empresa.hosteleria ?? null
  const poner = (valor: boolean) => {
    let quedo = valor
    void h.hacer(async () => { quedo = await guardarHosteleria(quien.accountId, quien.companyId, quien.userId, valor) },
      () => (quedo ? `Hecho: es de hostelería. Ya salen ${QUE_SALE}.` : `Hecho: no es de hostelería. Dejan de salir ${QUE_SALE}. No se borra nada: sus contactos siguen en «Todos».`))
  }
  return (
    <TarjetaApartado titulo="¿Es un negocio de hostelería?" movil={movil}>
      <p style={{ margin: 0 }}>
        {movil && '¿Es un negocio de hostelería? '}
        <strong data-testid="es-hosteleria">{es === true ? 'Sí' : es === false ? 'No' : 'Sin decir (se trata como no)'}</strong>
      </p>
      <p className="cx-ayuda">Con «Sí» salen {QUE_SALE}.</p>
      <div className="cx-tablas-filtros" role="group" aria-label="¿Es un negocio de hostelería?">
        <button type="button" className="cx-pildora" aria-pressed={es === true} disabled={h.guardando || es === true} onClick={() => poner(true)}>Sí, es hostelería</button>
        <button type="button" className="cx-pildora" aria-pressed={es === false} disabled={h.guardando || es === false} onClick={() => poner(false)}>No</button>
      </div>
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}
