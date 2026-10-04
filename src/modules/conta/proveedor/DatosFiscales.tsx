// src/modules/conta/proveedor/DatosFiscales.tsx
//
// Pestaña «Datos fiscales» (C01b). Una columna, etiqueta encima, validación al
// momento y «Se guarda al salir del campo». Los IVA y las retenciones salen
// de las tablas del C00 en PÍLDORAS (nunca texto libre), con los más usados
// en la cuenta primero. El registro sanitario está aquí y en Contabilidad
// (respuesta 1, decisión 1).
//
//   · NIF español: algoritmo oficial al escribir; al guardar uno válido queda
//     «✓ comprobado».
//   · NIF-IVA europeo: forma al escribir; al guardar se pregunta a VIES en el
//     servidor. Mientras no contesta: «Comprobando con la UE…», sin bloquear.
//   · Extranjero (fuera de la UE): se guarda tal cual.
//   · Código postal: la provincia y la población salen de la tabla de códigos
//     postales del C00; nunca pisan lo escrito.

import { useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Campo, Pildoras, SeGuarda, type OpcionPildora } from '@/modules/conta/proveedor/piezas'
import { Propuestas } from '@/modules/conta/proveedor/Propuestas'
import { useGuardarAlSalir } from '@/modules/conta/proveedor/useGuardarAlSalir'
import { Guardado } from '@/modules/conta/ui/piezas'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { normalizarNif, tipoEntidadPorNif, validarNifEs } from '@/modules/conta/lib/nif'
import { validarFormatoVatEu } from '@/modules/conta/lib/vatEu'
import { provinciaPorCp } from '@/modules/conta/lib/direccion'
import { proponerPoblacion } from '@/modules/conta/lib/codigoPostal'
import { lugaresPorCp } from '@/modules/conta/services/codigoPostalService'
import { IMPUESTO_DEL_TERRITORIO, casillasIva } from '@/modules/conta/lib/opcionesFicha'
import { porUso } from '@/modules/conta/lib/masUsados'
import { porcentaje } from '@/modules/conta/lib/formato'
import { VAT_REGIME_LABEL, type EntityKind, type FichaProveedor, type TaxIdType, type VatRegime } from '@/modules/conta/types'

const NOMBRE_IMPUESTO = { iva: 'IVA', igic: 'IGIC', ipsi: 'IPSI' } as const
const TIPO_ID: OpcionPildora<TaxIdType>[] = [
  { valor: 'nif_es', texto: 'NIF español' },
  { valor: 'vat_eu', texto: 'De otro país de la UE' },
  { valor: 'foreign', texto: 'De fuera de la UE' },
]
const SIN_RETENCION = 'sin'

/** El mensaje del NIF al momento, en lenguaje normal. null = nada que decir. */
function mensajeNif(tipo: TaxIdType, valor: string): string | null {
  const v = valor.trim()
  if (!v) return null
  if (tipo === 'nif_es') { const r = validarNifEs(v); return r.ok ? null : r.motivo }
  if (tipo === 'vat_eu') { const r = validarFormatoVatEu(v); return r.ok ? null : r.motivo }
  return null
}

/**
 * Al confirmar un dato leído se vuelve a montar el formulario (`key`) con lo
 * que ya hay en la ficha: si no, un campo se quedaba con el valor de antes y
 * al salir de él pisaba lo recién confirmado (lo cazó el e2e del C01, 02/10).
 */
export default function DatosFiscales() {
  const [vuelta, setVuelta] = useState(0)
  const [aviso, avisar] = useAvisoGuardado()
  return (
    <>
      <Propuestas alDecidir={(t) => { setVuelta((v) => v + 1); avisar(t) }} />
      <Guardado texto={aviso} />
      <Formulario key={vuelta} />
    </>
  )
}

function Formulario() {
  const { datos, comprobandoVies } = useFicha()
  const f = datos.ficha
  const g = useGuardarAlSalir()
  const [name, setName] = useState(f.name)
  const [legalName, setLegalName] = useState(f.legalName ?? '')
  const [tipoId, setTipoId] = useState<TaxIdType>(f.taxIdType ?? 'nif_es')
  const [taxId, setTaxId] = useState(f.taxId ?? '')
  const [countryCode, setCountryCode] = useState(f.countryCode)
  const [street, setStreet] = useState(f.fiscalStreet ?? '')
  const [cp, setCp] = useState(f.fiscalPostalCode ?? '')
  const [city, setCity] = useState(f.fiscalCity ?? '')
  const [prov, setProv] = useState(f.fiscalProvince ?? '')
  const [rgseaa, setRgseaa] = useState(f.healthRegistryNo ?? '')
  const [website, setWebsite] = useState(f.website ?? '')
  const [tags, setTags] = useState(f.tags.join(', '))
  const [porqueCiudad, setPorqueCiudad] = useState<string | null>(null)

  const nifAlMomento = mensajeNif(tipoId, taxId)

  async function guardarNif(tipo: TaxIdType = tipoId) {
    const msg = mensajeNif(tipo, taxId)
    g.marcar('taxId', msg)
    if (msg) return
    const ahora = new Date().toISOString()
    const nuevo = taxId.trim() ? (tipo === 'foreign' ? taxId.trim().toUpperCase() : normalizarNif(taxId)) : null
    if (nuevo === f.taxId && (tipo === f.taxIdType || !nuevo)) return
    const c: Partial<FichaProveedor> = { taxId: nuevo, taxIdType: nuevo ? tipo : null, taxIdCheckedAt: nuevo ? ahora : null }
    if (!nuevo) { c.taxIdVerifiedAt = null; c.taxIdCheckStatus = null }
    else if (tipo === 'nif_es') {
      c.taxIdVerifiedAt = ahora; c.taxIdCheckStatus = 'valid'; c.countryCode = 'ES'
      if (!f.entityKind) c.entityKind = tipoEntidadPorNif(nuevo)
    } else if (tipo === 'vat_eu') {
      c.taxIdVerifiedAt = null; c.taxIdCheckStatus = 'pending'
      c.countryCode = nuevo.slice(0, 2) === 'EL' ? 'GR' : nuevo.slice(0, 2)
    } else { c.taxIdVerifiedAt = null; c.taxIdCheckStatus = null }
    if (nuevo) setTaxId(nuevo)
    await g.guardar(c, tipo === 'nif_es' && nuevo ? 'NIF comprobado' : 'NIF')
  }

  async function salirDeCp() {
    const v = cp.trim()
    const c: Partial<FichaProveedor> = { fiscalPostalCode: v || null }
    // El CP dice la provincia y la población: se rellenan si están vacías, nunca se pisan.
    if (!prov.trim()) { const p = provinciaPorCp(v); if (p) { setProv(p); c.fiscalProvince = p } }
    if (!city.trim() && /^\d{5}$/.test(v)) {
      try {
        const pob = proponerPoblacion(v, await lugaresPorCp(v))
        if (pob) { setCity(pob.valor); c.fiscalCity = pob.valor; setPorqueCiudad(pob.porque) }
      } catch { /* sin población propuesta: se escribe a mano */ }
    }
    await g.guardar(c, 'código postal')
  }

  // IVA: las filas de la tabla, las más usadas en la cuenta primero, y las
  // guardadas aunque ya no se ofrezcan (regla 30).
  const usosIva = datos.otros.flatMap((o) => o.usualTaxRateIds)
  const casillas = porUso(casillasIva(datos.opciones, f.usualTaxRateIds), (c) => c.id, usosIva)
  const opcionesIva: OpcionPildora<string>[] = casillas.map((c) => ({
    valor: c.id,
    texto: c.rate === null ? 'Un IVA que ya no está en tus tablas' : porcentaje(c.rate),
    nota: c.ofrecida ? undefined : 'ya no está en tus tablas; sigue apuntado hasta que lo quites',
  }))

  // Retención: «Sin retención» y las vigentes de las tablas; la guardada, aunque ya no esté.
  const ret = f.irpfWithholdingPct
  const retOfrecidas = porUso(datos.opciones.retenciones, (r) => String(r.valor), datos.otros.map((o) => o.irpfWithholdingPct === null ? null : String(o.irpfWithholdingPct)))
  const opcionesRet: OpcionPildora<string>[] = [
    { valor: SIN_RETENCION, texto: 'Sin retención' },
    ...retOfrecidas.map((r) => ({ valor: String(r.valor), texto: porcentaje(r.valor) })),
    ...(ret !== null && !datos.opciones.retenciones.some((r) => Math.abs(r.valor - ret) < 0.005)
      ? [{ valor: String(ret), texto: porcentaje(ret), nota: 'ya no está en tus tablas' }] : []),
  ]
  const impuesto = NOMBRE_IMPUESTO[IMPUESTO_DEL_TERRITORIO[datos.opciones.territorio]]
  const estadoUe = f.taxIdType === 'vat_eu' && f.taxId
    ? (comprobandoVies || f.taxIdCheckStatus === 'pending' ? 'Comprobando con la UE…'
      : f.taxIdCheckStatus === 'valid' ? 'Comprobado en VIES (registro europeo)'
      : f.taxIdCheckStatus === 'invalid' ? 'VIES dice que este NIF-IVA no está dado de alta' : null)
    : null

  return (
    <div className="cx-formulario">
      {g.fallo && <div className="cx-error" role="alert">{g.fallo}</div>}
      <Campo campo="name" etiqueta="Nombre con el que lo conocéis" error={g.error('name')}>
        {(p) => <input {...p} className="cx-input" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (!name.trim()) { g.marcar('name', 'Pon el nombre con el que lo conocéis.'); return } void g.guardar({ name: name.trim() }, 'nombre') }} />}
      </Campo>
      <Campo campo="legalName" etiqueta="Razón social" ayuda="Tal como sale en sus facturas: «Hermanos Ruiz Distribución, S.L.»" error={g.error('legalName')}>
        {(p) => <input {...p} className="cx-input" value={legalName} onChange={(e) => setLegalName(e.target.value)}
          onBlur={() => void g.guardar({ legalName: legalName.trim() || null }, 'razón social')} />}
      </Campo>
      <Pildoras campo="taxIdType" etiqueta="Tipo de NIF" opciones={TIPO_ID} elegidas={[tipoId]}
        alCambiar={(v) => { const t = v[0] ?? tipoId; setTipoId(t); if (taxId.trim()) void guardarNif(t) }} />
      <Campo campo="taxId" etiqueta={tipoId === 'vat_eu' ? 'NIF-IVA (con las letras del país delante)' : 'NIF'}
        error={g.error('taxId') ?? nifAlMomento} aviso={!g.error('taxId') && !nifAlMomento ? estadoUe : null}
        ayuda={tipoId === 'nif_es' ? 'Lo comprobamos al momento con su letra o dígito de control.' : undefined}>
        {(p) => <input {...p} className="cx-input" value={taxId} autoComplete="off" autoCapitalize="characters"
          placeholder={tipoId === 'vat_eu' ? 'FR40303265045' : 'B12345678'}
          onChange={(e) => setTaxId(e.target.value)} onBlur={() => void guardarNif()} />}
      </Campo>
      {tipoId === 'foreign' && (
        <Campo campo="countryCode" etiqueta="País (código de dos letras)" ayuda="Por ejemplo: GB, US, CH.">
          {(p) => <input {...p} className="cx-input" value={countryCode} maxLength={2} onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            onBlur={() => void g.guardar({ countryCode: countryCode.trim().toUpperCase() || 'ES' }, 'país')} />}
        </Campo>
      )}
      <Pildoras<EntityKind> campo="entityKind" etiqueta="¿Sociedad o autónomo?" ayuda="Con un NIF español lo deducimos de su primera letra; puedes cambiarlo."
        opciones={[{ valor: 'company', texto: 'Sociedad' }, { valor: 'self_employed', texto: 'Autónomo' }]}
        elegidas={f.entityKind ? [f.entityKind] : []}
        alCambiar={(v) => void g.guardar({ entityKind: v[0] ?? null }, 'sociedad o autónomo')} />

      <fieldset className="cx-fieldset">
        <legend className="cx-tarjeta-titulo" style={{ fontSize: 16, marginBottom: 6 }}>Dirección fiscal</legend>
        <Campo campo="fiscalStreet" etiqueta="Calle y número">
          {(p) => <input {...p} className="cx-input" value={street} autoComplete="street-address" onChange={(e) => setStreet(e.target.value)}
            onBlur={() => void g.guardar({ fiscalStreet: street.trim() || null }, 'calle')} />}
        </Campo>
        <div className="cx-formulario-fila">
          <Campo campo="fiscalPostalCode" etiqueta="Código postal">
            {(p) => <input {...p} className="cx-input" value={cp} inputMode="numeric" autoComplete="postal-code" onChange={(e) => setCp(e.target.value)} onBlur={() => void salirDeCp()} />}
          </Campo>
          <Campo campo="fiscalCity" etiqueta="Población" ayuda={porqueCiudad ?? undefined}>
            {(p) => <input {...p} className="cx-input" value={city} onChange={(e) => { setCity(e.target.value); setPorqueCiudad(null) }}
              onBlur={() => void g.guardar({ fiscalCity: city.trim() || null }, 'población')} />}
          </Campo>
        </div>
        <Campo campo="fiscalProvince" etiqueta="Provincia">
          {(p) => <input {...p} className="cx-input" value={prov} onChange={(e) => setProv(e.target.value)}
            onBlur={() => void g.guardar({ fiscalProvince: prov.trim() || null }, 'provincia')} />}
        </Campo>
      </fieldset>

      <Campo campo="vatRegime" etiqueta="Régimen de IVA" error={g.error('vatRegime')}>
        {(p) => (
          <select {...p} className="cx-input" value={f.vatRegime ?? ''}
            onChange={(e) => void g.guardar({ vatRegime: (e.target.value || null) as VatRegime | null }, 'régimen de IVA')}>
            <option value="">Sin decir</option>
            {(Object.keys(VAT_REGIME_LABEL) as VatRegime[]).map((r) => <option key={r} value={r}>{VAT_REGIME_LABEL[r]}</option>)}
          </select>
        )}
      </Campo>
      <Pildoras campo="usualTaxRateIds" etiqueta={`${impuesto} habitual en sus facturas`} varias opciones={opcionesIva} elegidas={f.usualTaxRateIds}
        ayuda="Puedes marcar varios. Salen de tus tablas generales; los que más usas, primero."
        error={g.error('usualTaxRateIds')}
        alCambiar={(ids) => void g.guardar({ usualTaxRateIds: ids }, `${impuesto} habitual`)} />
      <Pildoras campo="irpfWithholdingPct" etiqueta="Retención de IRPF" opciones={opcionesRet}
        elegidas={[ret === null ? SIN_RETENCION : String(ret)]} error={g.error('irpfWithholdingPct')} aviso={g.aviso('irpfWithholdingPct')}
        ayuda="Solo si te factura con retención: autónomos y alquileres."
        alCambiar={(v) => void g.guardar({ irpfWithholdingPct: !v[0] || v[0] === SIN_RETENCION ? null : Number(v[0]) }, 'retención')} />
      <Campo campo="healthRegistryNo" etiqueta="Registro sanitario (RGSEAA)" ayuda="Lo encuentras en sus facturas o albaranes. Sirve para el control de proveedores del APPCC.">
        {(p) => <input {...p} className="cx-input" value={rgseaa} placeholder="10.00000/M" onChange={(e) => setRgseaa(e.target.value)}
          onBlur={() => void g.guardar({ healthRegistryNo: rgseaa.trim() || null }, 'registro sanitario')} />}
      </Campo>
      <Campo campo="website" etiqueta="Web">
        {(p) => <input {...p} className="cx-input" value={website} inputMode="url" placeholder="https://" onChange={(e) => setWebsite(e.target.value)}
          onBlur={() => void g.guardar({ website: website.trim() || null }, 'web')} />}
      </Campo>
      <Campo campo="tags" etiqueta="Etiquetas" ayuda="Separadas por comas. Sirven para buscar en la lista: «bebidas, local Centro».">
        {(p) => <input {...p} className="cx-input" value={tags} onChange={(e) => setTags(e.target.value)}
          onBlur={() => void g.guardar({ tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }, 'etiquetas')} />}
      </Campo>
      <SeGuarda texto={g.texto} ocupado={g.ocupado} />
    </div>
  )
}
