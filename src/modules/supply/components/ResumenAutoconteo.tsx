// src/modules/supply/components/ResumenAutoconteo.tsx
//
// UN AUTOCONTEO APLICADO SOLO (0400, encargo de Julio del 21/10).
//
// Nadie lo aprueba: se aplica entero al terminarlo en la tablet o, si nadie lo
// terminó, de madrugada. Así que esta pieza no enseña «lo que se revisó» (no
// se revisó nada) sino lo que pasó: CUÁNDO se aplicó, a la hora real, y QUÉ
// cambió en el stock, en palabras de oficina.
//
// REGLA 7: están todas las líneas. Las que cambiaron el stock, arriba y por
// valor; las apartadas, con su motivo; las que cuadran, a un clic, con su número
// en el botón.
//
// Solo pinta: los datos le llegan por props. Así la captura que va al informe
// se saca con esta misma pieza (tests/inventario/capturas).

import { useState } from 'react'
import { Check } from 'lucide-react'
import {
  PanelCocina, RotuloDePanel, CifraCocina, PastillaCocina, BotonCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import {
  fraseDelAplicado, repartirDiferencias, euros,
  type ViaAutoconteo, type LineaParaDiferencia,
} from '@/modules/supply/lib/autoconteoTexto'

export interface LineaDelResumen extends LineaParaDiferencia {
  id: string
  itemName: string
}

export interface HechosDelAplicado {
  ajustes: number
  valorNeto: number | null
  sinCoste: number
}

export default function ResumenAutoconteo({
  via, approvedAt, createdAt, approvedByName, lineas, hechos,
}: {
  via: ViaAutoconteo
  approvedAt: string
  createdAt: string
  approvedByName: string | null
  lineas: LineaDelResumen[]
  /** Lo aplicado, leído del libro. Null mientras se carga o si no se pudo leer. */
  hechos: HechosDelAplicado | null
}) {
  const [verCuadran, setVerCuadran] = useState(false)
  const r = repartirDiferencias(lineas)
  const frase = fraseDelAplicado({ via, approvedAt, createdAt, approvedByName })

  const n = hechos ? `${hechos.ajustes} producto${hechos.ajustes === 1 ? '' : 's'} ajustado${hechos.ajustes === 1 ? '' : 's'}` : null
  const val = hechos == null ? null
    : hechos.valorNeto == null ? 'sin coste fiable para valorarlo'
    : `${euros(hechos.valorNeto)} a coste medio`
  const fuera = hechos && hechos.sinCoste > 0 ? ` (${hechos.sinCoste} sin coste, fuera de esa suma)` : ''

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[14px] text-cocina-verde font-semibold inline-flex items-start gap-1.5">
          <Check size={16} className="shrink-0 mt-[2px]" />
          <span>{frase}{n && <> · {n}</>}{val && <> · {val}{fuera}</>}</span>
        </p>
        <p className="text-[12.5px] text-cocina-tinta-3 mt-1 leading-[1.5]">
          Nadie lo tiene que aprobar: un autoconteo se aplica entero, con cualquier diferencia.
          Lo que cambió queda aquí para consultarlo.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-cocina-linea-suave border border-cocina-linea rounded-cocina-md overflow-hidden shadow-cocina">
        <CifraCocina titulo="Cambiaron el stock" valor={String(r.cambian.length)}
                     tono={r.cambian.length > 0 ? 'aviso' : undefined} pie="Faltaba o sobraba algo" />
        <CifraCocina titulo="Cuadran" valor={String(r.cuadran.length)} tono="bueno" pie="Se quedan como estaban" />
        <CifraCocina titulo="Apartadas" valor={String(r.apartadas.length)}
                     pie={r.sinContar > 0 ? <>A mano, no se aplican · <b>{r.sinContar}</b> sin contar</> : 'A mano: no se aplican'} />
        <CifraCocina
          titulo="Valor ajustado"
          valor={hechos?.valorNeto == null ? '—' : `${hechos.valorNeto < 0 ? '−' : '+'}${Math.abs(Math.round(hechos.valorNeto))}`}
          sufijo={hechos?.valorNeto == null ? undefined : '€'}
          tono={(hechos?.valorNeto ?? 0) < 0 ? 'malo' : undefined}
          pie={hechos && hechos.sinCoste > 0 ? <>A coste medio · <b>{hechos.sinCoste}</b> sin coste, fuera</> : 'A coste medio del local'}
        />
      </div>

      <PanelCocina>
        <RotuloDePanel derecha={r.cambian.length > 1 ? 'Ordenado por valor' : undefined}>
          Lo que ha cambiado en el stock · {r.cambian.length}
        </RotuloDePanel>
        {r.cambian.length === 0 ? (
          <div className="px-4 py-7 text-center">
            <Check size={24} className="text-cocina-verde mx-auto" />
            <p className="text-[14px] font-bold text-cocina-tinta mt-2">Todo cuadraba: el stock no ha cambiado</p>
          </div>
        ) : (
          <ul>
            {r.cambian.map(({ linea, d }) => (
              <li key={linea.id} className="px-4 py-3 border-b border-cocina-linea-suave last:border-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-cocina-tinta">{linea.itemName}</div>
                  <div className={`text-[13px] mt-0.5 ${d.tono === 'falta' ? 'text-cocina-rojo' : 'text-cocina-tinta-2'}`}>{d.texto}</div>
                </div>
                <div className="sm:text-right shrink-0">
                  {d.tono === 'saneado'
                    ? <PastillaCocina tono="apagado">No es merma</PastillaCocina>
                    : d.valor
                      ? <span className={`num text-[14px] font-bold ${d.tono === 'falta' ? 'text-cocina-rojo' : 'text-cocina-tinta'}`}>{d.valor}</span>
                      : <PastillaCocina tono="apagado">Sin coste</PastillaCocina>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelCocina>

      {r.apartadas.length > 0 && (
        <PanelCocina>
          <RotuloDePanel>Apartadas · {r.apartadas.length}</RotuloDePanel>
          <ul>
            {r.apartadas.map(({ linea, d }) => (
              <li key={linea.id} className="px-4 py-3 border-b border-cocina-linea-suave last:border-0">
                <div className="text-[13.5px] font-semibold text-cocina-tinta">{linea.itemName}</div>
                <div className="text-[13px] mt-0.5 text-cocina-tinta-2">{d.texto}</div>
              </li>
            ))}
          </ul>
        </PanelCocina>
      )}

      {r.cuadran.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <BotonCocina peso="borde" onClick={() => setVerCuadran(v => !v)}>
              {verCuadran ? 'Ocultar' : 'Ver'} los {r.cuadran.length} que cuadran
            </BotonCocina>
          </div>
          {verCuadran && (
            <PanelCocina>
              <RotuloDePanel>Cuadran · {r.cuadran.length}</RotuloDePanel>
              <ul>
                {r.cuadran.map(({ linea, d }) => (
                  <li key={linea.id} className="px-4 py-2.5 border-b border-cocina-linea-suave last:border-0 flex justify-between gap-3">
                    <span className="text-[13px] font-semibold text-cocina-tinta">{linea.itemName}</span>
                    <span className="text-[12.5px] text-cocina-tinta-2">{d.texto}</span>
                  </li>
                ))}
              </ul>
            </PanelCocina>
          )}
        </div>
      )}
    </div>
  )
}
