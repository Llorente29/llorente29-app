// src/modules/conta/apartados/DatosFiscales.tsx
//
// Nombre, razón social, NIF, dirección fiscal, IVA y retención. Formulario en
// una sola columna, etiqueta encima y validación al momento (§6.6).
//
//   · NIF español: algoritmo oficial al escribir; al guardar uno válido queda
//     «NIF comprobado».
//   · NIF-IVA europeo: forma al escribir; al guardar se pregunta a VIES en el
//     servidor. Mientras no contesta: «Comprobando con la UE…», sin bloquear.
//   · Extranjero (fuera de la UE): se guarda tal cual.
// Web y etiquetas: comparación con Holded (respuesta 2). No cuentan para el %.

import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { Campo, Dialogo, Guardado } from '@/modules/conta/components/ui'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { Propuestas } from '@/modules/conta/components/Propuestas'
import { normalizarNif, tipoEntidadPorNif, validarNifEs } from '@/modules/conta/lib/nif'
import { validarFormatoVatEu } from '@/modules/conta/lib/vatEu'
import { provinciaPorCp } from '@/modules/conta/lib/direccion'
import { rutaListaProveedores } from '@/config/navegacion'
import { VAT_REGIME_LABEL, type EntityKind, type FichaProveedor, type TaxIdType, type VatRegime } from '@/modules/conta/types'
import type { ProblemaFicha } from '@/modules/conta/lib/validacionesFicha'
import { IMPUESTO_DEL_TERRITORIO, casillasIva } from '@/modules/conta/lib/opcionesFicha'
import { porcentaje } from '@/modules/conta/lib/formato'

// Los tipos de IVA y las retenciones salen de las tablas generales del C00
// (tarea 7), no de una lista escrita aquí: ver lib/opcionesFicha.ts.
const NOMBRE_IMPUESTO = { iva: 'IVA', igic: 'IGIC', ipsi: 'IPSI' } as const
const TIPO_ID: Record<TaxIdType, string> = { nif_es: 'NIF español', vat_eu: 'NIF-IVA de otro país de la UE', foreign: 'De fuera de la UE' }

/** El mensaje del NIF al momento, en lenguaje normal. null = nada que decir. */
function mensajeNif(tipo: TaxIdType, valor: string): string | null {
  const v = valor.trim()
  if (!v) return null
  if (tipo === 'nif_es') { const r = validarNifEs(v); return r.ok ? null : r.motivo }
  if (tipo === 'vat_eu') { const r = validarFormatoVatEu(v); return r.ok ? null : r.motivo }
  return null
}

/**
 * El formulario va aparte y con `key`: al confirmar un dato leído, se vuelve
 * a montar con lo que hay ya en la ficha. Sin eso, el campo se quedaba con el
 * valor de antes y «Guardar» pisaba lo recién confirmado (lo cazó la prueba
 * e2e de propuestas, 02/10).
 */
export default function DatosFiscales() {
  const [vuelta, setVuelta] = useState(0)
  return (
    <>
      <Propuestas alDecidir={() => setVuelta((v) => v + 1)} />
      <FormularioFiscal key={vuelta} />
    </>
  )
}

function FormularioFiscal() {
  const { datos, guardar, comprobandoVies } = useFicha()
  const f = datos.ficha
  const [name, setName] = useState(f.name)
  const [legalName, setLegalName] = useState(f.legalName ?? '')
  const [tipoId, setTipoId] = useState<TaxIdType>(f.taxIdType ?? 'nif_es')
  const [taxId, setTaxId] = useState(f.taxId ?? '')
  const [countryCode, setCountryCode] = useState(f.countryCode)
  const [entityKind, setEntityKind] = useState<EntityKind | ''>(f.entityKind ?? '')
  const [street, setStreet] = useState(f.fiscalStreet ?? '')
  const [cp, setCp] = useState(f.fiscalPostalCode ?? '')
  const [city, setCity] = useState(f.fiscalCity ?? '')
  const [prov, setProv] = useState(f.fiscalProvince ?? '')
  const [vatRegime, setVatRegime] = useState<VatRegime | ''>(f.vatRegime ?? '')
  const [rates, setRates] = useState<number[]>(f.usualVatRates)
  const [irpf, setIrpf] = useState(f.irpfWithholdingPct !== null ? String(f.irpfWithholdingPct) : '')
  const listaRet = useId()
  const [ivaLinea, setIvaLinea] = useState(f.ivaIncluidoEnLinea)
  const [website, setWebsite] = useState(f.website ?? '')
  const [tags, setTags] = useState(f.tags.join(', '))
  const [notes, setNotes] = useState(f.notes ?? '')
  const [errores, setErrores] = useState<ProblemaFicha[]>([])
  const [avisos, setAvisos] = useState<ProblemaFicha[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  const [archivar, setArchivar] = useState(false)

  const nifAlMomento = useMemo(() => mensajeNif(tipoId, taxId), [tipoId, taxId])
  const err = (campo: keyof FichaProveedor) => errores.find((e) => e.campo === campo)?.mensaje ?? null
  const av = (campo: keyof FichaProveedor) => avisos.find((e) => e.campo === campo)?.mensaje ?? null

  function cambiarCp(v: string) {
    setCp(v)
    // El CP dice la provincia: se rellena si está vacía, nunca se pisa.
    if (!prov.trim()) { const p = provinciaPorCp(v.trim()); if (p) setProv(p) }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setFallo(null)
    if (!name.trim()) { setErrores([{ campo: 'name', mensaje: 'Pon el nombre con el que lo conocéis.' }]); return }
    if (nifAlMomento) { setErrores([{ campo: 'taxId', mensaje: nifAlMomento }]); return }
    const irpfNum = irpf.trim() === '' ? null : Number(irpf.replace(',', '.'))
    if (irpfNum !== null && (Number.isNaN(irpfNum) || irpfNum < 0 || irpfNum > 100)) {
      setErrores([{ campo: 'irpfWithholdingPct', mensaje: 'La retención es un porcentaje de 0 a 100.' }]); return
    }
    const ahora = new Date().toISOString()
    const nifNuevo = taxId.trim() ? (tipoId === 'foreign' ? taxId.trim().toUpperCase() : normalizarNif(taxId)) : null
    const cambiaNif = nifNuevo !== f.taxId || tipoId !== f.taxIdType
    const cambios: Partial<FichaProveedor> = {
      name: name.trim(),
      legalName: legalName.trim() || null,
      countryCode: tipoId === 'nif_es' ? 'ES' : (countryCode.trim().toUpperCase() || 'ES'),
      entityKind: entityKind || null,
      fiscalStreet: street.trim() || null,
      fiscalPostalCode: cp.trim() || null,
      fiscalCity: city.trim() || null,
      fiscalProvince: prov.trim() || null,
      vatRegime: vatRegime || null,
      usualVatRates: [...rates].sort((a, b) => a - b),
      irpfWithholdingPct: irpfNum,
      ivaIncluidoEnLinea: ivaLinea,
      website: website.trim() || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: notes.trim() || null,
    }
    if (cambiaNif) {
      cambios.taxId = nifNuevo
      cambios.taxIdType = nifNuevo ? tipoId : null
      cambios.taxIdCheckedAt = nifNuevo ? ahora : null
      if (!nifNuevo) { cambios.taxIdVerifiedAt = null; cambios.taxIdCheckStatus = null }
      else if (tipoId === 'nif_es') {
        cambios.taxIdVerifiedAt = ahora; cambios.taxIdCheckStatus = 'valid'
        if (!entityKind) cambios.entityKind = tipoEntidadPorNif(nifNuevo)
      } else if (tipoId === 'vat_eu') {
        cambios.taxIdVerifiedAt = null; cambios.taxIdCheckStatus = 'pending'
        cambios.countryCode = nifNuevo.slice(0, 2) === 'EL' ? 'GR' : nifNuevo.slice(0, 2)
      } else { cambios.taxIdVerifiedAt = null; cambios.taxIdCheckStatus = null }
    }
    setOcupado(true)
    try {
      const r = await guardar(cambios)
      setErrores(r.errores); setAvisos(r.avisos)
      if (r.errores.length === 0) {
        if (cambios.entityKind && !entityKind) setEntityKind(cambios.entityKind)
        avisar(cambiaNif && nifNuevo && tipoId === 'nif_es' ? 'Guardado. NIF comprobado.' : 'Datos fiscales guardados.')
      }
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo guardar.')
    } finally {
      setOcupado(false)
    }
  }

  const estadoUe = f.taxIdType === 'vat_eu' && f.taxId
    ? (comprobandoVies || f.taxIdCheckStatus === 'pending' ? 'Comprobando con la UE…'
      : f.taxIdCheckStatus === 'valid' ? 'Comprobado en VIES (registro europeo)'
      : f.taxIdCheckStatus === 'invalid' ? 'VIES dice que este NIF-IVA no está dado de alta' : null)
    : null

  return (
    <>
      <form className="cf-form" onSubmit={enviar} noValidate>
        {fallo && <div className="cf-error" role="alert">{fallo}</div>}
        <Campo campo="name" etiqueta="Nombre con el que lo conocéis" error={err('name')}>
          {(p) => <input {...p} className="cf-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
        </Campo>
        <Campo campo="legalName" etiqueta="Razón social" ayuda="Tal como sale en sus facturas: «Hermanos Ruiz Distribución, S.L.»" error={err('legalName')}>
          {(p) => <input {...p} className="cf-input" value={legalName} onChange={(e) => setLegalName(e.target.value)} />}
        </Campo>
        <Campo campo="taxIdType" etiqueta="Tipo de NIF">
          {(p) => (
            <select {...p} className="cf-select" value={tipoId} onChange={(e) => setTipoId(e.target.value as TaxIdType)}>
              {(Object.keys(TIPO_ID) as TaxIdType[]).map((t) => <option key={t} value={t}>{TIPO_ID[t]}</option>)}
            </select>
          )}
        </Campo>
        <Campo
          campo="taxId" etiqueta={tipoId === 'vat_eu' ? 'NIF-IVA (con las letras del país delante)' : 'NIF'}
          error={err('taxId') ?? nifAlMomento}
          aviso={!err('taxId') && !nifAlMomento ? estadoUe : null}
          ayuda={tipoId === 'nif_es' ? 'Lo comprobamos al momento con su letra o dígito de control.' : undefined}
        >
          {(p) => <input {...p} className="cf-input" value={taxId} onChange={(e) => setTaxId(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={tipoId === 'vat_eu' ? 'FR40303265045' : 'B12345678'} />}
        </Campo>
        {tipoId === 'foreign' && (
          <Campo campo="countryCode" etiqueta="País (código de dos letras)" ayuda="Por ejemplo: GB, US, CH.">
            {(p) => <input {...p} className="cf-input" value={countryCode} maxLength={2} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} />}
          </Campo>
        )}
        <Campo campo="entityKind" etiqueta="¿Sociedad o autónomo?" ayuda="Con un NIF español lo deducimos de su primera letra; puedes cambiarlo.">
          {(p) => (
            <select {...p} className="cf-select" value={entityKind} onChange={(e) => setEntityKind(e.target.value as EntityKind | '')}>
              <option value="">Sin decir</option>
              <option value="company">Sociedad</option>
              <option value="self_employed">Autónomo</option>
            </select>
          )}
        </Campo>
        <fieldset className="cf-form" style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className="cf-label" style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf-ink)', marginBottom: 8 }}>Dirección fiscal</legend>
          <Campo campo="fiscalStreet" etiqueta="Calle y número">
            {(p) => <input {...p} className="cf-input" value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="street-address" />}
          </Campo>
          <div className="cf-fila">
            <Campo campo="fiscalPostalCode" etiqueta="Código postal">
              {(p) => <input {...p} className="cf-input" value={cp} inputMode="numeric" onChange={(e) => cambiarCp(e.target.value)} autoComplete="postal-code" />}
            </Campo>
            <Campo campo="fiscalCity" etiqueta="Población">
              {(p) => <input {...p} className="cf-input" value={city} onChange={(e) => setCity(e.target.value)} />}
            </Campo>
          </div>
          <Campo campo="fiscalProvince" etiqueta="Provincia">
            {(p) => <input {...p} className="cf-input" value={prov} onChange={(e) => setProv(e.target.value)} />}
          </Campo>
        </fieldset>
        <Campo campo="vatRegime" etiqueta="Régimen de IVA" error={err('vatRegime')}>
          {(p) => (
            <select {...p} className="cf-select" value={vatRegime} onChange={(e) => setVatRegime(e.target.value as VatRegime | '')}>
              <option value="">Sin decir</option>
              {(Object.keys(VAT_REGIME_LABEL) as VatRegime[]).map((r) => <option key={r} value={r}>{VAT_REGIME_LABEL[r]}</option>)}
            </select>
          )}
        </Campo>
        <div className="cf-campo" role="group" aria-labelledby="iva-hab">
          <span className="cf-label" id="iva-hab">{NOMBRE_IMPUESTO[IMPUESTO_DEL_TERRITORIO[datos.opciones.territorio]]} habitual en sus facturas</span>
          <div className="cf-casillas">
            {casillasIva(datos.opciones, f.usualVatRates).map((c) => (
              <label key={c.valor} className="cf-casilla" title={c.nombre ?? undefined}>
                <input type="checkbox" checked={rates.includes(c.valor)} onChange={(e) => setRates((r) => e.target.checked ? [...r, c.valor] : r.filter((x) => x !== c.valor))} />
                {porcentaje(c.valor)}
                {/* Lo guardado sale aunque las tablas ya no lo ofrezcan (regla 30), y lo dice. */}
                {!c.ofrecida && <span className="cf-nota">· ya no está en tus tablas</span>}
              </label>
            ))}
          </div>
        </div>
        <Campo campo="irpfWithholdingPct" etiqueta="Retención de IRPF (%)" error={err('irpfWithholdingPct')} aviso={av('irpfWithholdingPct')}
          ayuda="Solo si te factura con retención: autónomos y alquileres. Vacío = no aplica.">
          {(p) => (
            <>
              <input {...p} className="cf-input" value={irpf} inputMode="decimal" list={listaRet} onChange={(e) => setIrpf(e.target.value)} />
              {/* Las retenciones vigentes de las tablas, como sugerencia: se puede escribir otra. */}
              <datalist id={listaRet}>
                {datos.opciones.retenciones.map((r) => <option key={r.valor} value={String(r.valor).replace('.', ',')}>{r.nombre}</option>)}
              </datalist>
            </>
          )}
        </Campo>
        <label className="cf-casilla" style={{ alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={ivaLinea} onChange={(e) => setIvaLinea(e.target.checked)} />
          Factura con el IVA incluido en el importe de cada línea
        </label>
        <span className="cf-ayuda" style={{ marginTop: -10 }}>Al recibir un albarán suyo, la pantalla propone quitarle el IVA y enseña el neto antes de guardar.</span>
        <Campo campo="website" etiqueta="Web">
          {(p) => <input {...p} className="cf-input" value={website} onChange={(e) => setWebsite(e.target.value)} inputMode="url" placeholder="https://" />}
        </Campo>
        <Campo campo="tags" etiqueta="Etiquetas" ayuda="Separadas por comas. Sirven para filtrar la lista: «bebidas, local Centro».">
          {(p) => <input {...p} className="cf-input" value={tags} onChange={(e) => setTags(e.target.value)} />}
        </Campo>
        <Campo campo="notes" etiqueta="Notas">
          {(p) => <textarea {...p} className="cf-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Campo>
        <div className="cf-pie-form">
          <button type="submit" className="cf-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
          <Guardado texto={aviso} />
        </div>
      </form>
      <div style={{ borderTop: '1px solid var(--cf-borde)', paddingTop: 12 }}>
        <button type="button" className="cf-boton-texto cf-boton-peligro" onClick={() => setArchivar(true)}>Archivar proveedor</button>
      </div>
      {archivar && <DialogoArchivar alCerrar={() => setArchivar(false)} />}
    </>
  )
}

function DialogoArchivar({ alCerrar }: { alCerrar: () => void }) {
  const { datos, guardar } = useFicha()
  const navigate = useNavigate()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function hacer() {
    setOcupado(true); setError(null)
    try {
      await guardar({ isActive: false, archivedAt: new Date().toISOString() })
      navigate(rutaListaProveedores(), { state: { aviso: `${datos.ficha.name} archivado. Ya no sale en la lista; sus facturas siguen ahí.` } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar.')
      setOcupado(false)
    }
  }
  return (
    <Dialogo titulo={`¿Archivar ${datos.ficha.name}?`} alCerrar={alCerrar}>
      <p style={{ margin: 0, fontSize: 15 }}>Dejará de salir en la lista de proveedores. No se borra nada: sus facturas, contactos y documentos se quedan.</p>
      {error && <div className="cf-error" role="alert">{error}</div>}
      <div className="cf-pie-form">
        <button type="button" className="cf-boton" disabled={ocupado} onClick={hacer}>{ocupado ? 'Archivando…' : 'Archivar'}</button>
        <button type="button" className="cf-boton-texto" onClick={alCerrar}>Cancelar</button>
      </div>
    </Dialogo>
  )
}
