// src/modules/conta/gestoria/g04/CopiaGc.tsx
//
// R19 · paso 0 · «Bajar la copia de GoCardless», al lado de «Exportar» en Clientes y cuotas: el Excel de la copia que
// guarda cada lectura de GoCardless antes de tocar nada de Sumied (resumen, clientes, mandatos, suscripciones y
// cobros). Debajo, de cuándo es la última y lo que GoCardless cobrará el próximo mes según ella. Con una sola empresa
// se puede elegir una copia de antes; con «Las dos», la última de cada una, un fichero por empresa.

import { useState } from 'react'
import { useLeer } from '@/modules/conta/libros/contexto'
import { descargaXlsxLibro } from '@/lib/descargaXlsx'
import { cuandoEnMadrid, hojasDeCopia, leerCopias, leerFilasCopia, lineaDeCopia, nombreDelExcel, type Copia } from './copiaGc'

export function BotonCopiaGc({ empresas }: { empresas: { id: string; nombre: string }[] }) {
  const clave = empresas.map((e) => e.id).join(',')
  const d = useLeer(empresas.length ? async () => Promise.all(empresas.map(async (e) => ({ empresa: e, copias: await leerCopias(e.id) }))) : null, `${clave}:copias-gc`)
  const [elegida, setElegida] = useState<string | null>(null)
  const [bajando, setBajando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  if (d.error) return <div className="g4-pequeno" role="alert" data-prueba="copia-gc">No se han podido leer las copias de GoCardless: {d.error}</div>
  if (!d.datos) return null
  const una = d.datos.length === 1 ? d.datos[0] : null
  const conCopia = d.datos.filter((x) => x.copias.length > 0)

  const bajar = async () => {
    setBajando(true); setAviso(null)
    try {
      const hechas: string[] = []
      for (const x of conCopia) {
        const c: Copia = (una && elegida ? x.copias.find((k) => k.id === elegida) : null) ?? x.copias[0]
        const filas = await leerFilasCopia(c.id)
        if (descargaXlsxLibro(hojasDeCopia(x.empresa.nombre, c, filas), nombreDelExcel(x.empresa.nombre, c))) hechas.push(`${x.empresa.nombre} (${cuandoEnMadrid(c.tomadaAt)})`)
      }
      setAviso(hechas.length ? { ok: true, texto: `Bajada la copia de GoCardless de ${hechas.join(' y ')}.` } : { ok: false, texto: 'La copia está vacía: no se ha bajado nada.' })
    } catch (e) {
      setAviso({ ok: false, texto: `No se ha podido bajar la copia de GoCardless: ${e instanceof Error ? e.message : String(e)}` })
    } finally { setBajando(false) }
  }

  return (
    <div className="g4-selector" data-prueba="copia-gc">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {una && una.copias.length > 1 && (
          <select aria-label="Copia de GoCardless" className="g4-boton" value={elegida ?? una.copias[0].id} onChange={(e) => setElegida(e.target.value)}>
            {una.copias.map((c) => <option key={c.id} value={c.id}>{cuandoEnMadrid(c.tomadaAt)}</option>)}
          </select>
        )}
        <button type="button" className="g4-boton" disabled={bajando || conCopia.length === 0} onClick={() => void bajar()}>
          {bajando ? 'Bajando la copia…' : 'Bajar la copia de GoCardless'}
        </button>
      </div>
      {d.datos.map((x) => (
        <div key={x.empresa.id} className="g4-pequeno" data-prueba="copia-gc-linea">
          {d.datos!.length > 1 ? `${x.empresa.nombre}: ` : ''}{lineaDeCopia(x.copias[0] ?? null)}
        </div>
      ))}
      {aviso && <div className="g4-pequeno" role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</div>}
    </div>
  )
}
