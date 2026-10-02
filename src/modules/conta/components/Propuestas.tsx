// src/modules/conta/components/Propuestas.tsx
//
// Datos leídos que esperan a que la persona los confirme (§5.4 y §4.3).
// NUNCA se guardan sin confirmación: se enseñan con su origen («Leído de su
// factura F-…») y dos botones. La dirección se enseña ya repartida en calle,
// CP, población y provincia por el núcleo (proponerDireccion), y se puede
// corregir antes de confirmar: lo que se guarda es lo que la persona ve.

import { useState } from 'react'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { decidirPropuesta, type Propuesta } from '@/modules/conta/services/proveedorService'
import { proponerDireccion } from '@/modules/conta/lib/direccion'
import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'
import type { FichaProveedor } from '@/modules/conta/types'

const QUE: Record<Propuesta['field'], string> = {
  tax_id: 'NIF',
  legal_name: 'Razón social',
  fiscal_address: 'Dirección fiscal',
}

export function Propuestas() {
  const { datos } = useFicha()
  if (datos.propuestas.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Datos leídos por confirmar">
      {datos.propuestas.map((p) => <UnaPropuesta key={p.id} p={p} />)}
    </div>
  )
}

function textoDe(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'line' in v) return String((v as { line: unknown }).line ?? '')
  return ''
}

function UnaPropuesta({ p }: { p: Propuesta }) {
  const { datos, actor, recargar } = useFicha()
  const linea = textoDe(p.value)
  const reparto = p.field === 'fiscal_address' ? proponerDireccion(linea) : null
  const [street, setStreet] = useState(reparto?.street ?? '')
  const [cp, setCp] = useState(reparto?.postalCode ?? '')
  const [city, setCity] = useState(reparto?.city ?? '')
  const [prov, setProv] = useState(reparto?.province ?? '')
  const [texto, setTexto] = useState(linea)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const origen = p.sourceLabel ?? (p.source === 'legacy_address' ? 'De la dirección que tenía la ficha' : 'Leído de un documento suyo')

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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
      setOcupado(false)
    }
  }

  const id = `prop-${p.id}`
  return (
    <section className="cf-propuesta" aria-labelledby={`${id}-t`}>
      <div className="cf-propuesta-cabeza">
        <strong id={`${id}-t`}>{QUE[p.field]}: ¿es correcto?</strong>
        <span className="cf-nota">{origen}</span>
      </div>
      {p.field === 'fiscal_address' ? (
        <div className="cf-fila" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="cf-campo"><label htmlFor={`${id}-s`}>Calle y número</label><input id={`${id}-s`} className="cf-input" value={street} onChange={(e) => setStreet(e.target.value)} /></div>
          <div className="cf-campo"><label htmlFor={`${id}-c`}>Código postal</label><input id={`${id}-c`} className="cf-input" value={cp} inputMode="numeric" onChange={(e) => setCp(e.target.value)} /></div>
          <div className="cf-campo"><label htmlFor={`${id}-p`}>Población</label><input id={`${id}-p`} className="cf-input" value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div className="cf-campo"><label htmlFor={`${id}-v`}>Provincia</label><input id={`${id}-v`} className="cf-input" value={prov} onChange={(e) => setProv(e.target.value)} /></div>
          <span className="cf-ayuda" style={{ gridColumn: '1 / -1' }}>Leído así: «{linea}». Revisa el reparto antes de confirmarlo.</span>
        </div>
      ) : (
        <div className="cf-campo"><label htmlFor={`${id}-x`}>{QUE[p.field]}</label><input id={`${id}-x`} className="cf-input" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
      )}
      {error && <div className="cf-campo-error" role="alert">{error}</div>}
      <div className="cf-pie-form">
        <button type="button" className="cf-boton cf-boton-peq" disabled={ocupado} onClick={() => decidir('confirmed')}>Confirmar</button>
        <button type="button" className="cf-boton-texto" disabled={ocupado} onClick={() => decidir('rejected')}>No es correcto</button>
      </div>
    </section>
  )
}
