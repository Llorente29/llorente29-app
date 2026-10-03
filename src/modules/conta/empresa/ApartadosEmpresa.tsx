// src/modules/conta/empresa/ApartadosEmpresa.tsx
//
// «Tu empresa» (maquetas N2Empresa y M2Empresa): Quién eres, Tus impuestos y
// Detalle contable. Se cambian en la misma tarjeta, sin ventanas encima, y
// cada cambio confirma con contenido o enseña el fallo.

import { useState, type FormEvent } from 'react'
import { Chip, Dato } from '@/modules/conta/ui/piezas'
import { validarNifEs } from '@/modules/conta/lib/nif'
import { cuentaPgc } from '@/modules/conta/lib/pgc'
import { TEXTO_IVA_VENTAS } from '@/modules/conta/lib/ivaVentas'
import {
  NOMBRE_CORTO_MODELO, TERRITORIOS, direccionEnUnaLinea, revisarDigitos, revisarPorcentajeProrrata, revisarQuienEres,
  textoIva, textoRegistro, type CambiosQuienEres, type DatosEmpresa, type PerfilFiscal,
} from '@/modules/conta/empresa/datosEmpresa'
import type { Quien } from '@/modules/conta/empresa/apartados'
import { guardarPerfil, guardarQuienEres } from '@/modules/conta/services/empresaDatosService'
import { useHacer } from '@/modules/conta/empresa/useHacer'
import { Marca } from '@/modules/conta/ia/Marca'
import { CampoLista, CampoSiNo, CampoTexto, PieFormulario, Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'

interface Props { d: DatosEmpresa; quien: Quien; alCambiar: () => void; movil: boolean }

const BOTON_CAMBIAR = (abrir: () => void, nombre: string) => (
  <button type="button" className="cx-enlace" onClick={abrir} aria-label={`Cambiar ${nombre}`}>Cambiar</button>
)

// ── Quién eres ──────────────────────────────────────────────────────────────

export function QuienEres({ d, quien, alCambiar, movil }: Props) {
  const [editando, setEditando] = useState(false)
  const h = useHacer(alCambiar)
  const e = d.empresa
  const forma = d.formasJuridicas.find((f) => f.code === e.legalFormCode)?.name
    ?? (e.entityKind === 'self_employed' ? 'Autónomo' : e.entityKind === 'company' ? 'Sociedad' : null)
  const nifOk = e.taxId ? validarNifEs(e.taxId).ok : false

  if (editando) {
    return (
      <TarjetaApartado titulo="Quién eres" movil={movil}>
        <FormQuienEres d={d} guardando={h.guardando} cancelar={() => { setEditando(false); h.limpiar() }}
          guardar={async (c) => {
            if (await h.hacer(() => guardarQuienEres(quien.companyId, quien.userId, c), `Guardado: ${c.legalName.trim()}.`)) setEditando(false)
          }} />
        <Resultado hecho={null} fallo={h.fallo} />
      </TarjetaApartado>
    )
  }
  return (
    <TarjetaApartado titulo="Quién eres" movil={movil} accion={BOTON_CAMBIAR(() => { setEditando(true); h.limpiar() }, 'quién eres')}>
      <Dato etiqueta="Razón social">{e.legalName && <>{e.legalName}<Marca origenes={d.ia.origenes} tabla="company" fila={e.id} campos={[['legal_name', e.legalName]]} /></>}</Dato>
      {e.tradeName && e.tradeName !== e.legalName && (
        <Dato etiqueta="Nombre comercial">{e.tradeName}<Marca origenes={d.ia.origenes} tabla="company" fila={e.id} campos={[['trade_name', e.tradeName]]} /></Dato>
      )}
      <Dato etiqueta="Tipo">{forma && <>{forma}<Marca origenes={d.ia.origenes} tabla="company" fila={e.id} campos={[['legal_form_code', e.legalFormCode]]} /></>}</Dato>
      <Dato etiqueta="NIF">
        {e.taxId && <>
          <span className="cx-cifra" style={{ fontSize: 15 }}>{e.taxId}</span>
          {nifOk && <span className="cx-visto" role="img" aria-label="La letra de control cuadra">✓</span>}
        </>}
      </Dato>
      <Dato etiqueta="Dirección fiscal">{direccionEnUnaLinea(e) && <>{direccionEnUnaLinea(e)}<Marca origenes={d.ia.origenes} tabla="company" fila={e.id}
        campos={[['fiscal_street', e.fiscalStreet], ['fiscal_number', e.fiscalNumber], ['fiscal_city', e.fiscalCity], ['fiscal_postal_code', e.fiscalPostalCode]]} /></>}</Dato>
      {e.entityKind !== 'self_employed' && <Dato etiqueta="Registro mercantil">{textoRegistro(e)}</Dato>}
      <Resultado hecho={h.hecho} fallo={null} />
    </TarjetaApartado>
  )
}

function FormQuienEres({ d, guardando, cancelar, guardar }: {
  d: DatosEmpresa; guardando: boolean; cancelar: () => void; guardar: (c: CambiosQuienEres) => void
}) {
  const e = d.empresa
  const [c, setC] = useState<CambiosQuienEres>({
    legalName: e.legalName ?? '', tradeName: e.tradeName ?? '', legalFormCode: e.legalFormCode ?? '',
    fiscalStreetType: e.fiscalStreetType ?? '', fiscalStreet: e.fiscalStreet ?? '', fiscalNumber: e.fiscalNumber ?? '',
    fiscalExtra: e.fiscalExtra ?? '', fiscalPostalCode: e.fiscalPostalCode ?? '', fiscalCity: e.fiscalCity ?? '',
    fiscalProvince: e.fiscalProvince ?? '', registryName: e.registryName ?? '', registrySheet: e.registrySheet ?? '',
  })
  const [fallos, setFallos] = useState<Record<string, string>>({})
  const pon = (k: keyof CambiosQuienEres) => (v: string) => setC((x) => ({ ...x, [k]: v }))
  const enviar = (ev: FormEvent) => {
    ev.preventDefault()
    const f = revisarQuienEres(c, e.fiscalCountry)
    setFallos(f)
    if (Object.keys(f).length === 0) guardar(c)
  }
  return (
    <form className="cx-formulario" onSubmit={enviar} noValidate aria-label="Cambiar quién eres">
      <CampoTexto etiqueta="Razón social" valor={c.legalName} cambiar={pon('legalName')} fallo={fallos.legalName}
        ayuda="El nombre que sale en el NIF." deshabilitado={guardando} />
      <CampoTexto etiqueta="Nombre comercial (si quieres)" valor={c.tradeName} cambiar={pon('tradeName')} deshabilitado={guardando} />
      <CampoLista etiqueta="Tipo" valor={c.legalFormCode} cambiar={pon('legalFormCode')} deshabilitado={guardando}
        opciones={[{ valor: '', texto: 'Sin poner' }, ...d.formasJuridicas.map((f) => ({ valor: f.code, texto: f.name }))]} />
      <p className="cx-ayuda" style={{ margin: 0 }}>
        El NIF no se cambia aquí: {d.empresa.taxId ?? 'sin NIF'}. Otro NIF es otra empresa.
      </p>
      <div className="cx-formulario-fila">
        <CampoTexto etiqueta="Tipo de vía" valor={c.fiscalStreetType} cambiar={pon('fiscalStreetType')} ayuda="Calle, avenida, plaza…" deshabilitado={guardando} />
        <CampoTexto etiqueta="Vía" valor={c.fiscalStreet} cambiar={pon('fiscalStreet')} deshabilitado={guardando} />
        <CampoTexto etiqueta="Número" valor={c.fiscalNumber} cambiar={pon('fiscalNumber')} deshabilitado={guardando} />
        <CampoTexto etiqueta="Piso, puerta… (si quieres)" valor={c.fiscalExtra} cambiar={pon('fiscalExtra')} deshabilitado={guardando} />
        <CampoTexto etiqueta="Código postal" valor={c.fiscalPostalCode} cambiar={pon('fiscalPostalCode')} modo="numeric"
          fallo={fallos.fiscalPostalCode} deshabilitado={guardando} />
        <CampoTexto etiqueta="Población" valor={c.fiscalCity} cambiar={pon('fiscalCity')} deshabilitado={guardando} />
        <CampoTexto etiqueta="Provincia" valor={c.fiscalProvince} cambiar={pon('fiscalProvince')} deshabilitado={guardando} />
      </div>
      {d.empresa.entityKind !== 'self_employed' && (
        <div className="cx-formulario-fila">
          <CampoTexto etiqueta="Registro mercantil de" valor={c.registryName} cambiar={pon('registryName')} deshabilitado={guardando} />
          <CampoTexto etiqueta="Hoja" valor={c.registrySheet} cambiar={pon('registrySheet')} ayuda="Por ejemplo M-000000." deshabilitado={guardando} />
        </div>
      )}
      <PieFormulario guardando={guardando} cancelar={cancelar} />
    </form>
  )
}

// ── Tus impuestos ───────────────────────────────────────────────────────────

const PERFIL_VACIO: PerfilFiscal = {
  taxTerritory: 'peninsula_baleares', vatSchemeCode: null, vatCashBasis: false, vatSurcharge: false, vatPeriod: 'quarterly',
  vatProrata: false, vatProrataPct: null, sii: false, chartKind: 'pymes', accountDigits: 8, taxForms: [], salesTaxRateCode: null,
}

export function TusImpuestos({ d, quien, alCambiar, movil }: Props) {
  const [editando, setEditando] = useState(false)
  const h = useHacer(alCambiar)
  const p = d.perfil
  const nombreModelo = (code: string) => d.modelos.find((m) => m.code === code)?.name ?? `Modelo ${code}`

  if (editando) {
    return (
      <TarjetaApartado titulo="Tus impuestos" movil={movil}>
        <FormImpuestos d={d} guardando={h.guardando} cancelar={() => { setEditando(false); h.limpiar() }}
          guardar={async (nuevo) => {
            if (await h.hacer(() => guardarPerfil(quien.accountId, quien.companyId, quien.userId, nuevo),
              `Guardado: ${textoIva(nuevo, d.regimenes)}; presentas ${nuevo.taxForms.length ? nuevo.taxForms.join(', ') : 'ningún modelo'}.`)) setEditando(false)
          }} />
        <Resultado hecho={null} fallo={h.fallo} />
      </TarjetaApartado>
    )
  }
  return (
    <TarjetaApartado titulo="Tus impuestos" movil={movil} accion={BOTON_CAMBIAR(() => { setEditando(true); h.limpiar() }, 'tus impuestos')}>
      {!p ? (
        <p className="cx-vacio">Aún no están puestos tus impuestos. Con «Cambiar» los pones.</p>
      ) : (
        <>
          <Dato etiqueta={p.taxTerritory === 'canarias' ? 'IGIC' : p.taxTerritory === 'ceuta_melilla' ? 'IPSI' : 'IVA'}>
            {textoIva(p, d.regimenes)}
            <Marca origenes={d.ia.origenes} tabla="company_tax_profile" fila={d.empresa.id}
              campos={[['vat_period', p.vatPeriod], ['vat_scheme_code', p.vatSchemeCode], ['tax_territory', p.taxTerritory]]} />
          </Dato>
          {p.taxTerritory === 'peninsula_baleares' && (
            <Dato etiqueta="IVA de tus ventas">
              {p.salesTaxRateCode ? TEXTO_IVA_VENTAS[p.salesTaxRateCode] ?? p.salesTaxRateCode : <span className="cx-dato-vacio">Sin decir</span>}
              <Marca origenes={d.ia.origenes} tabla="company_tax_profile" fila={d.empresa.id} campos={[['sales_tax_rate_code', p.salesTaxRateCode]]} />
            </Dato>
          )}
          <Dato etiqueta="Criterio de caja">{p.vatCashBasis ? 'Sí' : 'No'}<Marca origenes={d.ia.origenes} tabla="company_tax_profile" fila={d.empresa.id} campos={[['vat_cash_basis', p.vatCashBasis]]} /></Dato>
          <Dato etiqueta="Recargo de equivalencia">{p.vatSurcharge ? 'Sí' : 'No'}<Marca origenes={d.ia.origenes} tabla="company_tax_profile" fila={d.empresa.id} campos={[['vat_surcharge', p.vatSurcharge]]} /></Dato>
          <div className="cx-dato" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <span className="cx-dato-etiqueta">Presentas <Marca origenes={d.ia.origenes} tabla="company_tax_profile" fila={d.empresa.id} campos={[['tax_forms', p.taxForms]]} /></span>
            {p.taxForms.length === 0 ? <span className="cx-dato-vacio">Ningún modelo puesto</span> : (
              <ul className="cx-chips" aria-label="Modelos que presentas">
                {p.taxForms.map((m) => (
                  <li key={m} title={nombreModelo(m)}><Chip>{m}{NOMBRE_CORTO_MODELO[m] ? ` ${NOMBRE_CORTO_MODELO[m]}` : ''}</Chip></li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <Resultado hecho={h.hecho} fallo={null} />
    </TarjetaApartado>
  )
}

function FormImpuestos({ d, guardando, cancelar, guardar }: {
  d: DatosEmpresa; guardando: boolean; cancelar: () => void; guardar: (p: PerfilFiscal) => void
}) {
  const [p, setP] = useState<PerfilFiscal>(d.perfil ?? PERFIL_VACIO)
  const pon = <K extends keyof PerfilFiscal>(k: K) => (v: PerfilFiscal[K]) => setP((x) => ({ ...x, [k]: v }))
  const enIva = p.taxTerritory === 'peninsula_baleares'
  const alternar = (m: string) => setP((x) => ({ ...x, taxForms: x.taxForms.includes(m) ? x.taxForms.filter((y) => y !== m) : [...x.taxForms, m].sort() }))
  return (
    <form className="cx-formulario" noValidate aria-label="Cambiar tus impuestos" onSubmit={(e) => { e.preventDefault(); guardar(p) }}>
      <CampoLista etiqueta="Dónde está tu empresa" valor={p.taxTerritory} deshabilitado={guardando}
        cambiar={(v) => pon('taxTerritory')(v as PerfilFiscal['taxTerritory'])}
        opciones={Object.entries(TERRITORIOS).map(([valor, texto]) => ({ valor, texto }))}
        ayuda={enIva ? undefined : 'Aquí no hay IVA: el régimen de tu impuesto lo confirma tu asesor.'} />
      {enIva && (
        <>
          <CampoLista etiqueta="Régimen del IVA" valor={p.vatSchemeCode ?? 'general'} deshabilitado={guardando}
            cambiar={(v) => pon('vatSchemeCode')(v)}
            opciones={d.regimenes.map((r) => ({ valor: r.code, texto: r.name }))} />
          <CampoLista etiqueta="Cada cuánto lo presentas" valor={p.vatPeriod} deshabilitado={guardando}
            cambiar={(v) => pon('vatPeriod')(v as PerfilFiscal['vatPeriod'])}
            opciones={[{ valor: 'quarterly', texto: 'Cada tres meses' }, { valor: 'monthly', texto: 'Cada mes' }]}
            ayuda="Cada mes solo por encima de 6.010.121,04 € de operaciones el año anterior (RIVA, art. 71.3)." />
          <CampoLista etiqueta="IVA de tus ventas" valor={p.salesTaxRateCode ?? ''} deshabilitado={guardando}
            cambiar={(v) => pon('salesTaxRateCode')(v === '' ? null : v)}
            opciones={[{ valor: '', texto: 'Sin decir' }, ...Object.entries(TEXTO_IVA_VENTAS).map(([valor, texto]) => ({ valor, texto }))]}
            ayuda="Comidas y bebidas para consumir en el acto, también a domicilio: 10 % (Ley 37/1992, art. 91.Uno.2.2.º)." />
          <div className="cx-formulario-fila">
            <CampoSiNo etiqueta="Criterio de caja" valor={p.vatCashBasis} cambiar={pon('vatCashBasis')} deshabilitado={guardando} />
            <CampoSiNo etiqueta="Recargo de equivalencia" valor={p.vatSurcharge} cambiar={pon('vatSurcharge')} deshabilitado={guardando} />
          </div>
        </>
      )}
      <fieldset className="cx-fieldset" disabled={guardando}>
        <legend className="cx-etiqueta">Qué modelos presentas</legend>
        <div className="cx-casillas">
          {d.modelos.map((m) => (
            <label key={m.code} className="cx-casilla">
              <input type="checkbox" checked={p.taxForms.includes(m.code)} onChange={() => alternar(m.code)} />
              <span><span className="cx-cifra">{m.code}</span> {NOMBRE_CORTO_MODELO[m.code] ?? m.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <PieFormulario guardando={guardando} cancelar={cancelar} />
    </form>
  )
}

// ── Detalle contable ────────────────────────────────────────────────────────

export function DetalleContable({ d, quien, alCambiar, movil }: Props) {
  const [abierto, setAbierto] = useState(movil)
  const [editando, setEditando] = useState(false)
  const h = useHacer(alCambiar)
  const p = d.perfil
  const resumen = p
    ? `Plan de ${p.chartKind === 'pymes' ? 'pymes' : 'grandes empresas'} · cuentas de ${p.accountDigits} dígitos · cuentas del IVA, retenciones y resultado · prorrata · SII. Viene puesto; lo normal es no tocarlo.`
    : 'Se pone con tus impuestos.'

  if (!abierto) {
    return (
      <section className="cx-tarjeta cx-apartado cx-detalle-contable" aria-labelledby="detalle-contable-titulo">
        <div>
          <h2 id="detalle-contable-titulo" className="cx-tarjeta-titulo">Detalle contable</h2>
          <p className="cx-ayuda" style={{ margin: '4px 0 0', fontSize: 15 }}>{resumen}</p>
        </div>
        <button type="button" className="cx-boton-sec" onClick={() => setAbierto(true)} aria-expanded={false}>Ver detalle</button>
      </section>
    )
  }
  return (
    <TarjetaApartado titulo="Detalle contable" movil={movil}
      accion={!movil && !editando ? <button type="button" className="cx-enlace" onClick={() => setAbierto(false)} aria-expanded>Cerrar</button> : undefined}>
      {!p ? <p className="cx-vacio">Se pone con tus impuestos.</p> : editando ? (
        <FormDetalle p={p} guardando={h.guardando} cancelar={() => { setEditando(false); h.limpiar() }}
          guardar={async (nuevo) => {
            if (await h.hacer(() => guardarPerfil(quien.accountId, quien.companyId, quien.userId, nuevo),
              `Guardado: plan de ${nuevo.chartKind === 'pymes' ? 'pymes' : 'grandes empresas'}, cuentas de ${nuevo.accountDigits} dígitos.`)) setEditando(false)
          }} />
      ) : (
        <>
          <Dato etiqueta="Plan contable">{p.chartKind === 'pymes' ? 'Plan de pymes' : 'Plan general (grandes empresas)'}<Marca origenes={d.ia.origenes} tabla="company_tax_profile" fila={d.empresa.id} campos={[['chart_kind', p.chartKind]]} /></Dato>
          <Dato etiqueta="Dígitos de las cuentas">{String(p.accountDigits)}<Marca origenes={d.ia.origenes} tabla="company_tax_profile" fila={d.empresa.id} campos={[['account_digits', p.accountDigits]]} /></Dato>
          <Dato etiqueta="IVA que pagas">{cuentaPgc('472')}</Dato>
          <Dato etiqueta="IVA que cobras">{cuentaPgc('477')}</Dato>
          <Dato etiqueta="Retenciones">{cuentaPgc('4751')}</Dato>
          <Dato etiqueta="Resultado">{cuentaPgc('129')}</Dato>
          <Dato etiqueta="Prorrata">{p.vatProrata ? `Sí · ${String(p.vatProrataPct ?? '').replace('.', ',')} %` : 'No'}</Dato>
          <Dato etiqueta="SII (libros del IVA al día)">{p.sii ? 'Sí' : 'No'}</Dato>
          <p className="cx-ayuda">Viene puesto; lo normal es no tocarlo.</p>
          <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="cx-boton-sec" onClick={() => { setEditando(true); h.limpiar() }}>Cambiar</button>
          </div>
        </>
      )}
      <Resultado hecho={h.hecho} fallo={h.fallo} />
    </TarjetaApartado>
  )
}

function FormDetalle({ p: inicial, guardando, cancelar, guardar }: {
  p: PerfilFiscal; guardando: boolean; cancelar: () => void; guardar: (p: PerfilFiscal) => void
}) {
  const [p, setP] = useState(inicial)
  const [digitos, setDigitos] = useState(String(inicial.accountDigits))
  const [prorrata, setProrrata] = useState(inicial.vatProrataPct === null ? '' : String(inicial.vatProrataPct).replace('.', ','))
  const [fallos, setFallos] = useState<Record<string, string>>({})
  return (
    <form className="cx-formulario" noValidate aria-label="Cambiar el detalle contable" onSubmit={(e) => {
      e.preventDefault()
      const f: Record<string, string> = {}
      const fd = revisarDigitos(digitos); if (fd) f.digitos = fd
      if (p.vatProrata) { const fp = revisarPorcentajeProrrata(prorrata); if (fp) f.prorrata = fp }
      setFallos(f)
      if (Object.keys(f).length === 0) {
        guardar({ ...p, accountDigits: Number(digitos), vatProrataPct: p.vatProrata ? Number(prorrata.replace(',', '.')) : null })
      }
    }}>
      <div className="cx-aviso">Viene puesto para lo normal. Cámbialo solo si tu asesor te lo dice.</div>
      <CampoLista etiqueta="Plan contable" valor={p.chartKind} deshabilitado={guardando}
        cambiar={(v) => setP((x) => ({ ...x, chartKind: v as PerfilFiscal['chartKind'] }))}
        opciones={[{ valor: 'pymes', texto: 'Plan de pymes' }, { valor: 'normal', texto: 'Plan general (grandes empresas)' }]} />
      <CampoTexto etiqueta="Dígitos de las cuentas" valor={digitos} cambiar={setDigitos} modo="numeric" fallo={fallos.digitos} deshabilitado={guardando} />
      <div className="cx-formulario-fila">
        <CampoSiNo etiqueta="Prorrata" valor={p.vatProrata} cambiar={(v) => setP((x) => ({ ...x, vatProrata: v }))} deshabilitado={guardando} />
        {p.vatProrata && <CampoTexto etiqueta="Porcentaje de prorrata" valor={prorrata} cambiar={setProrrata} modo="decimal" fallo={fallos.prorrata} deshabilitado={guardando} />}
      </div>
      <CampoSiNo etiqueta="SII (libros del IVA al día)" valor={p.sii} cambiar={(v) => setP((x) => ({ ...x, sii: v }))} deshabilitado={guardando} />
      <PieFormulario guardando={guardando} cancelar={cancelar} />
    </form>
  )
}
