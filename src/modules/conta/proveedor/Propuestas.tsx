// src/modules/conta/proveedor/Propuestas.tsx
//
// Datos «por confirmar» (C01 §5.4 y C01b §3): lo leído de una factura o un
// albarán, y la dirección que la ficha antigua tenía en una sola línea. NUNCA
// se guardan sin que la persona lo diga. Se enseñan con su origen y:
//   · «Es esta»: se guarda tal cual se ve;
//   · «Corregir»: abre los campos con el reparto propuesto para cambiarlo;
//   · «No es correcto»: se descarta.
// Lo que se guarda es lo que la persona ve, no el valor leído.

import { useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { decidirPropuesta, type Propuesta } from '@/modules/conta/services/proveedorService'
import { repartoPropuesto } from '@/modules/conta/lib/direccion'
import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'
import type { FichaProveedor } from '@/modules/conta/types'

const QUE: Record<Propuesta['field'], string> = {
  tax_id: 'NIF',
  legal_name: 'Razón social',
  fiscal_address: 'Dirección fiscal',
}

export function Propuestas({ alDecidir }: { alDecidir?: (texto: string) => void }) {
  const { datos } = useFicha()
  if (datos.propuestas.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Datos por confirmar">
      {datos.propuestas.map((p) => <UnaPropuesta key={p.id} p={p} alDecidir={alDecidir} />)}
    </div>
  )
}

function UnaPropuesta({ p, alDecidir }: { p: Propuesta; alDecidir?: (texto: string) => void }) {
  const { datos, actor, recargar } = useFicha()
  const { linea, reparto } = repartoPropuesto(p.value)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [street, setStreet] = useState(reparto.street ?? '')
  const [cp, setCp] = useState(reparto.postalCode ?? '')
  const [city, setCity] = useState(reparto.city ?? '')
  const [prov, setProv] = useState(reparto.province ?? '')
  const [texto, setTexto] = useState(typeof p.value === 'string' ? p.value : linea)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const origen = p.sourceLabel ?? (p.source === 'legacy_address' ? 'Es la dirección que tenía la ficha antigua, en una sola línea' : 'Leído de un documento suyo')

  function cambios(): Partial<FichaProveedor> {
    if (p.field === 'fiscal_address') {
      return { fiscalStreet: street.trim() || null, fiscalPostalCode: cp.trim() || null, fiscalCity: city.trim() || null, fiscalProvince: prov.trim() || null }
    }
    if (p.field === 'legal_name') return { legalName: texto.trim() || null }
    const n = normalizarNif(texto)
    const v = validarNifEs(n)
    return v.ok
      ? { taxId: v.normalizado, taxIdType: 'nif_es', taxIdVerifiedAt: new Date().toISOString(), taxIdCheckStatus: 'valid', taxIdCheckedAt: new Date().toISOString() }
      : { taxId: n || null, taxIdType: 'nif_es', taxIdVerifiedAt: null, taxIdCheckStatus: 'invalid' }
  }

  async function decidir(d: 'confirmed' | 'rejected') {
    setOcupado(true); setError(null)
    try {
      if (d === 'confirmed' && p.field === 'tax_id') {
        const n = normalizarNif(texto)
        const repe = datos.otros.find((o) => o.id !== datos.ficha.id && o.taxId && normalizarNif(o.taxId) === n)
        if (repe) throw new Error(`Ese NIF ya lo tiene otro proveedor: ${repe.name}.`)
      }
      await decidirPropuesta(datos.ficha.id, p.id, d, d === 'confirmed' ? cambios() : {}, actor)
      await recargar()
      alDecidir?.(d === 'confirmed' ? `${QUE[p.field]} confirmada y guardada en la ficha.` : `${QUE[p.field]} descartada: no se ha guardado.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
      setOcupado(false)
    }
  }

  const id = `prop-${p.id}`
  const filas: [string, string][] = p.field === 'fiscal_address'
    ? [['Calle', street || '—'], ['Código postal', cp || '— (no lo traía)'], ['Población', city || '—'], ['Provincia', prov || '—']]
    : [[QUE[p.field], texto || '—']]
  return (
    <section className="cxp-propuesta" aria-labelledby={`${id}-t`}>
      <div className="cxp-propuesta-cabeza">
        <span className="cx-chip cx-chip-ambar" style={{ alignSelf: 'flex-start' }}>Por confirmar</span>
        <strong id={`${id}-t`} style={{ fontSize: 16, marginTop: 6 }}>{QUE[p.field]}: ¿es esta?</strong>
        <span className="cx-ayuda">{origen}{p.field === 'fiscal_address' && linea ? `: «${linea}»` : ''}.</span>
      </div>
      {!corrigiendo ? (
        <dl className="cxp-propuesta-reparto">
          {filas.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      ) : p.field === 'fiscal_address' ? (
        <div className="cx-formulario">
          <div className="cx-campo"><label htmlFor={`${id}-s`}>Calle y número</label><input id={`${id}-s`} className="cx-input" value={street} onChange={(e) => setStreet(e.target.value)} /></div>
          <div className="cx-formulario-fila">
            <div className="cx-campo"><label htmlFor={`${id}-c`}>Código postal</label><input id={`${id}-c`} className="cx-input" value={cp} inputMode="numeric" onChange={(e) => setCp(e.target.value)} /></div>
            <div className="cx-campo"><label htmlFor={`${id}-p`}>Población</label><input id={`${id}-p`} className="cx-input" value={city} onChange={(e) => setCity(e.target.value)} /></div>
          </div>
          <div className="cx-campo"><label htmlFor={`${id}-v`}>Provincia</label><input id={`${id}-v`} className="cx-input" value={prov} onChange={(e) => setProv(e.target.value)} /></div>
        </div>
      ) : (
        <div className="cx-campo"><label htmlFor={`${id}-x`}>{QUE[p.field]}</label><input id={`${id}-x`} className="cx-input" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
      )}
      {error && <div className="cx-error" role="alert">{error}</div>}
      <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="cx-boton" disabled={ocupado} onClick={() => decidir('confirmed')}>
          {ocupado ? 'Guardando…' : corrigiendo ? 'Guardar así' : 'Es esta'}
        </button>
        {!corrigiendo && <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => setCorrigiendo(true)}>Corregir</button>}
        <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => decidir('rejected')}>No es correcto</button>
      </div>
    </section>
  )
}
