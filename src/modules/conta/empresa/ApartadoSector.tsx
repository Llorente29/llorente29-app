// src/modules/conta/empresa/ApartadoSector.tsx
//
// G03 · «¿De qué sector es tu negocio?», en Ajustes › Tu empresa, al lado de
// «A qué te dedicas». Sustituye a «¿Es un negocio de hostelería?» (S01). Es de
// la EMPRESA (company.sector): se propone en el alta por la actividad y aquí
// se cambia. Lo que enciende cada sector lo dice su paquete
// (sectores/sectores.ts), y aquí solo se enseña.
//
// Regla 8: antes de cambiar, qué saldrá y qué dejará de salir; después, lo
// mismo, con lo que ha quedado en la base. Regla 7: lo que deja de salir son
// páginas y tarjetas; ningún dato se borra ni se esconde de la lista.

import { useState } from 'react'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { guardarSector } from '@/modules/conta/services/empresaDatosService'
import { refrescarContextoEsqueleto } from '@/modules/conta/esqueleto/useEsqueleto'
import { PAQUETES, SECTORES, type Sector } from '@/modules/conta/sectores/sectores'
import { cambioDeSector, fraseDelCambio, fraseDespuesDelCambio } from '@/modules/conta/sectores/cambio'
import type { DatosEmpresa } from '@/modules/conta/empresa/datosEmpresa'
import type { Quien } from '@/modules/conta/empresa/apartados'

const TITULO = '¿De qué sector es tu negocio?'

export function ApartadoSector({ d, quien, alCambiar, movil }: { d: DatosEmpresa; quien: Quien; alCambiar: () => void; movil: boolean }) {
  const h = useHacer(() => { alCambiar(); refrescarContextoEsqueleto() })
  // Sin la columna (antes de la tanda del G03), lo de hoy: la marca de hostelería.
  const actual: Sector = d.empresa.sector ?? (d.empresa.hosteleria ? 'hosteleria' : 'general')
  const [elegido, setElegido] = useState<Sector | null>(null)

  const cambiar = (a: Sector) => {
    let quedo: Sector = a
    void h.hacer(async () => { quedo = await guardarSector(quien.accountId, quien.companyId, quien.userId, a) },
      () => fraseDespuesDelCambio(actual, quedo))
      .then((ok) => { if (ok) setElegido(null) })
  }

  return (
    <TarjetaApartado titulo={TITULO} movil={movil}>
      <p style={{ margin: 0 }}>
        {movil && `${TITULO} `}
        <strong data-testid="sector-empresa">{PAQUETES[actual].etiqueta}</strong>
      </p>
      <div className="cx-columna" role="group" aria-label={TITULO} style={{ gap: 8 }}>
        {SECTORES.map((s) => (
          <button key={s} type="button" className="cx-pildora" aria-pressed={s === actual} disabled={h.guardando || s === actual}
            onClick={() => { h.limpiar(); setElegido(s) }}
            style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', height: 'auto', minHeight: 44, padding: '8px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
            <span style={{ fontWeight: 600 }}>{PAQUETES[s].etiqueta}</span>
            {/* La explicación, en letra normal y gris (la del botón es negrita y se lo comía). */}
            <span className="cx-ayuda" style={{ margin: 0, fontWeight: 400 }}>{PAQUETES[s].linea}</span>
          </button>
        ))}
      </div>
      {elegido && elegido !== actual && (
        <div className="cx-tarjeta" role="region" aria-label="¿Cambiar el sector?" style={{ marginTop: 12, padding: 12 }}>
          <p style={{ margin: 0 }}><strong>Pasar a {PAQUETES[elegido].etiqueta}.</strong> {fraseDelCambio(cambioDeSector(actual, elegido))}</p>
          <div className="cx-tablas-filtros" style={{ marginTop: 8 }}>
            <button type="button" className="cx-boton" disabled={h.guardando} onClick={() => cambiar(elegido)}>
              {h.guardando ? 'Cambiando…' : `Cambiar a ${PAQUETES[elegido].etiqueta}`}
            </button>
            <button type="button" className="cx-boton-sec" disabled={h.guardando} onClick={() => setElegido(null)}>Dejarlo como está</button>
          </div>
        </div>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}
