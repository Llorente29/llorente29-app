// src/shell/home/informes/PanelInformes.tsx
//
// PANEL «MIS INFORMES», debajo de «Mis agentes».
//
// DOS CHIPS, no cuatro. Los otros dos de la maqueta no se pintan y se dice en
// una línea que están en camino: «Registro de jornada» promete un PDF que no
// existe y «Liquidación CTB» no tiene decidido de cuál de las tres tablas de
// settlement sale. Un chip que descarga vacío —o que baja otra cosa de la que
// promete— es peor que un chip que no está.
//
// Y SIN COLETILLA DE PROGRAMACIÓN. La maqueta decía «lunes 8:00» y «mensual»;
// el envío programado no existe: ni cola, ni horario, ni correo. Escribirlo
// sería una promesa con aspecto de función.

import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { descargaCsv, nombreConFecha } from '@/lib/descargaCsv'
import { diaNatural } from '@/lib/fechas'
import { ventasDeLaSemana, stockNegativo, type FilaInforme } from './informesService'

interface Chip {
  key: string
  etiqueta: string
  base: string
  cargar: (accountId: string, locationId: string | null) => Promise<FilaInforme[]>
  /** Qué se lleva el que lo pulsa, para el aviso con contenido. */
  cuenta: (n: number) => string
}

const CHIPS: Chip[] = [
  {
    key: 'ventas_semana', etiqueta: 'Ventas de la semana · CSV', base: 'ventas-semana',
    cargar: ventasDeLaSemana,
    cuenta: n => `${n} ${n === 1 ? 'venta' : 'ventas'}`,
  },
  {
    key: 'stock_negativo', etiqueta: 'Stock negativo · CSV', base: 'stock-negativo',
    cargar: stockNegativo,
    cuenta: n => `${n} ${n === 1 ? 'artículo' : 'artículos'}`,
  },
]

export default function PanelInformes({ accountId, locationId }: {
  accountId: string | null
  locationId: string | null
}) {
  const [bajando, setBajando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  async function baja(chip: Chip) {
    if (!accountId) {
      setFallo('No se ha descargado: no hay cuenta activa.')
      return
    }
    setBajando(chip.key); setFallo(null); setAviso(null)
    try {
      const filas = await chip.cargar(accountId, locationId)
      const hubo = descargaCsv(filas, nombreConFecha(chip.base, diaNatural(new Date())))
      // Confirma CON CONTENIDO —cuántas filas— o dice que no había ninguna. Un
      // fichero vacío que se abre y no dice nada parece que el dato no existe.
      setAviso(hubo
        ? `Descargado: ${chip.cuenta(filas.length)}.`
        : 'No hay nada que descargar ahora mismo: el informe habría salido vacío.')
    } catch (e) {
      setFallo(e instanceof Error ? `No se ha descargado: ${e.message}` : 'No se ha descargado.')
    } finally {
      setBajando(null)
    }
  }

  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <FileDown size={17} /> Mis informes
      </h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '2px 0 10px' }}>
        Con tus filtros guardados. Un clic para descargar.
      </p>

      {aviso && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-success)', margin: '0 0 8px' }}>{aviso}</p>
      )}
      {fallo && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', margin: '0 0 8px' }}>{fallo}</p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CHIPS.map(c => (
          <button key={c.key} type="button" disabled={bajando != null}
            onClick={() => void baja(c)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50">
            {bajando === c.key ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {c.etiqueta}
          </button>
        ))}
      </div>

      {/* Los que no están, dichos. No se ocultan: se dice que vienen. */}
      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
        Registro de jornada y Liquidación CTB, en camino.
      </p>
    </section>
  )
}
