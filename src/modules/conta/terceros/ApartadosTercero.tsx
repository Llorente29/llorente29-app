// src/modules/conta/terceros/ApartadosTercero.tsx
//
// C03 · Las pestañas de la ficha de un tercero (encargo §6): Datos fiscales ·
// Contactos · Cobro · Liquidaciones · Contabilidad · Documentos · Historial.
// Los datos fiscales son los del proveedor del C01b (los mismos campos y las
// mismas reglas del núcleo); el cobro, espejo de «Pago»; la contabilidad, la
// N7 con sus cuentas. Guardar dice qué se ha guardado (regla 8).

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaFichaProveedor } from '@/config/navegacion'
import { ExtractoCuenta, type EjercicioExtracto } from '@/modules/conta/plan/ExtractoCuenta'
import { apuntesDeCuentas } from '@/modules/conta/services/libroService'
import { leerEjercicios } from '@/modules/conta/services/diarioService'
import type { Apunte } from '@/modules/conta/lib/cuentasProveedor'
import { Campo, Pildoras } from '@/modules/conta/proveedor/piezas'
import { Chip, Vacio } from '@/modules/conta/ui/piezas'
import { useTercero, papelesDe } from '@/modules/conta/terceros/contextoTercero'
import { ConQuienHablas, LiquidacionesAnteriores, SusCuentas, TarjetaLiquidaciones } from '@/modules/conta/terceros/piezasTercero'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'
import { validarIban, normalizarIban, formatearIban } from '@/modules/conta/lib/iban'
import { avisoPlazo } from '@/modules/conta/lib/morosidad'
import { diaMes, eurosExactos } from '@/modules/conta/lib/formato'
import { periodo } from '@/modules/conta/lib/liquidaciones'
import {
  anadirPapel, borrarAportacion, guardarCliente, registrarAportacion, terceroDelMismoNif, type DatosFiscalesCliente,
} from '@/modules/conta/services/tercerosService'

function useGuardar() {
  const { recargar, avisar } = useTercero()
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function guardar(fn: () => Promise<unknown>, texto: string) {
    setOcupado(true); setFallo(null)
    try { await fn(); avisar(texto); recargar() } catch (e) {
      setFallo(terceroDelMismoNif(e) ? 'Ese NIF ya es de otro tercero. Un NIF, un tercero: añade el papel a esa ficha en vez de repetirlo.' : e instanceof Error ? e.message : 'No se pudo guardar.')
    }
    setOcupado(false)
  }
  return { guardar, fallo, ocupado }
}

// ── Datos fiscales ──────────────────────────────────────────────────────────

export function DatosFiscalesTercero() {
  const { ficha, accountId } = useTercero()
  const { userName } = useCuentaConta()
  const { guardar, fallo, ocupado } = useGuardar()
  const f = ficha.fiscal
  const conProveedor = !!ficha.tercero.supplierId
  const [nombre, setNombre] = useState(ficha.tercero.nombre)
  const [nif, setNif] = useState(ficha.tercero.nif ?? '')
  const [d, setD] = useState<Partial<DatosFiscalesCliente>>(() => ({
    legalName: f?.legalName ?? null, taxIdType: f?.taxIdType ?? 'nif_es', countryCode: f?.countryCode ?? 'ES', entityKind: f?.entityKind ?? null,
    fiscalStreet: f?.fiscalStreet ?? null, fiscalPostalCode: f?.fiscalPostalCode ?? null, fiscalCity: f?.fiscalCity ?? null, fiscalProvince: f?.fiscalProvince ?? null,
    equivalenceSurcharge: f?.equivalenceSurcharge ?? false, withholdingRateId: f?.withholdingRateId ?? null, operationScope: f?.operationScope ?? 'domestic',
    exclude347: f?.exclude347 ?? false, exclude347Reason: f?.exclude347Reason ?? null,
  }))
  const pon = <K extends keyof DatosFiscalesCliente>(k: K, v: DatosFiscalesCliente[K]) => setD((x) => ({ ...x, [k]: v }))
  const nifMal = useMemo(() => {
    if (!nif.trim() || d.taxIdType !== 'nif_es') return null
    const r = validarNifEs(nif)
    return r.ok ? null : r.motivo
  }, [nif, d.taxIdType])
  const sinMotivo = d.exclude347 && !d.exclude347Reason?.trim()

  if (!f && !ficha.papeles.some((p) => p.role === 'customer')) {
    return <Vacio titulo="Aún no es cliente." explicacion="Sus datos fiscales de cliente aparecen al darle el papel de cliente (menú «···» de la cabecera)." />
  }
  return (
    <form className="cx-formulario" onSubmit={(e) => {
      e.preventDefault()
      if (nifMal || sinMotivo) return
      const nifN = nif.trim() ? (d.taxIdType === 'nif_es' ? normalizarNif(nif) : nif.trim().toUpperCase()) : null
      void guardar(() => guardarCliente(accountId, ficha.tercero.id, nombre.trim(), nifN, {
        ...d, ...(nifN && d.taxIdType === 'nif_es' ? { taxIdCheckStatus: 'valid' as const } : {}),
      }, userName), `Guardados los datos fiscales de ${nombre.trim()}.`)
    }}>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <Campo campo="nombre" etiqueta="Nombre con el que lo conocéis" ayuda={conProveedor ? 'Es también proveedor: el nombre se cambia en su ficha de proveedor.' : undefined}>
        {(p) => <input {...p} className="cx-input" value={nombre} disabled={conProveedor} onChange={(e) => setNombre(e.target.value)} />}
      </Campo>
      <Campo campo="razon" etiqueta="Razón social">
        {(p) => <input {...p} className="cx-input" value={d.legalName ?? ''} onChange={(e) => pon('legalName', e.target.value || null)} placeholder="Plataforma Norte Spain, S.L." />}
      </Campo>
      <Pildoras campo="tipo-nif" etiqueta="Tipo de identificación" elegidas={d.taxIdType ? [d.taxIdType] : []}
        opciones={[{ valor: 'nif_es', texto: 'NIF español' }, { valor: 'vat_eu', texto: 'NIF-IVA de la UE' }, { valor: 'foreign', texto: 'Pasaporte u otro' }]}
        alCambiar={(v) => pon('taxIdType', (v[0] ?? null) as DatosFiscalesCliente['taxIdType'])} />
      <Campo campo="nif" etiqueta="NIF" error={nifMal} ayuda={d.taxIdType === 'nif_es' ? 'Se comprueba la letra de control al momento. Un NIF, un tercero.' : 'El NIF-IVA europeo se comprueba con la UE (VIES) cuando esté conectada para clientes.'}>
        {(p) => <input {...p} className="cx-input" value={nif} onChange={(e) => setNif(e.target.value)} autoCapitalize="characters" />}
      </Campo>
      <Pildoras campo="entidad" etiqueta="Qué es" elegidas={d.entityKind ? [d.entityKind] : []}
        opciones={[{ valor: 'company', texto: 'Empresa' }, { valor: 'self_employed', texto: 'Autónomo' }, { valor: 'person', texto: 'Particular' }]}
        alCambiar={(v) => pon('entityKind', (v[0] ?? null) as DatosFiscalesCliente['entityKind'])} />
      <div className="cxt-dos">
        <Campo campo="calle" etiqueta="Dirección fiscal">{(p) => <input {...p} className="cx-input" value={d.fiscalStreet ?? ''} onChange={(e) => pon('fiscalStreet', e.target.value || null)} />}</Campo>
        <Campo campo="cp" etiqueta="Código postal">{(p) => <input {...p} className="cx-input" inputMode="numeric" value={d.fiscalPostalCode ?? ''} onChange={(e) => pon('fiscalPostalCode', e.target.value || null)} />}</Campo>
        <Campo campo="poblacion" etiqueta="Población">{(p) => <input {...p} className="cx-input" value={d.fiscalCity ?? ''} onChange={(e) => pon('fiscalCity', e.target.value || null)} />}</Campo>
        <Campo campo="provincia" etiqueta="Provincia">{(p) => <input {...p} className="cx-input" value={d.fiscalProvince ?? ''} onChange={(e) => pon('fiscalProvince', e.target.value || null)} />}</Campo>
      </div>
      <Pildoras campo="operacion" etiqueta="Tipo de operación" elegidas={d.operationScope ? [d.operationScope] : []}
        opciones={[{ valor: 'domestic', texto: 'España' }, { valor: 'eu', texto: 'Unión Europea' }, { valor: 'export', texto: 'Fuera de la UE' }]}
        alCambiar={(v) => pon('operationScope', (v[0] ?? 'domestic') as DatosFiscalesCliente['operationScope'])} />
      <Pildoras campo="recargo" etiqueta="Recargo de equivalencia" elegidas={[d.equivalenceSurcharge ? 'si' : 'no']}
        opciones={[{ valor: 'no', texto: 'No' }, { valor: 'si', texto: 'Sí, le aplico recargo' }]}
        alCambiar={(v) => pon('equivalenceSurcharge', v[0] === 'si')} />
      <Pildoras campo="retencion" etiqueta="Retención que te practica" elegidas={d.withholdingRateId ? [d.withholdingRateId] : ['ninguna']}
        opciones={[{ valor: 'ninguna', texto: 'Ninguna' }, ...ficha.retenciones.map((r) => ({ valor: r.id, texto: `${r.name} · ${String(r.rate).replace('.', ',')} %` }))]}
        alCambiar={(v) => pon('withholdingRateId', v[0] && v[0] !== 'ninguna' ? v[0] : null)} />
      <Pildoras campo="excluir-347" etiqueta="347" elegidas={[d.exclude347 ? 'si' : 'no']}
        opciones={[{ valor: 'no', texto: 'Entra si pasa de 3.005,06 €' }, { valor: 'si', texto: 'Excluir del 347' }]}
        alCambiar={(v) => pon('exclude347', v[0] === 'si')} />
      {d.exclude347 && (
        <Campo campo="motivo-347" etiqueta="Por qué se excluye" error={sinMotivo ? 'Di por qué: el 347 se presenta y alguien lo preguntará.' : null}>
          {(p) => <input {...p} className="cx-input" value={d.exclude347Reason ?? ''} onChange={(e) => pon('exclude347Reason', e.target.value || null)} placeholder="Operaciones con retención ya declaradas" />}
        </Campo>
      )}
      <div className="cx-pie"><button type="submit" className="cx-boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar datos fiscales'}</button></div>
    </form>
  )
}

// ── Cobro ───────────────────────────────────────────────────────────────────

const FORMAS = [{ valor: 'transfer', texto: 'Transferencia' }, { valor: 'direct_debit', texto: 'Domiciliación' }, { valor: 'card', texto: 'Tarjeta' }, { valor: 'cash', texto: 'Efectivo' }] as const
const PLAZOS = [0, 15, 30, 45, 60, 90]

export function CobroTercero() {
  const { ficha, accountId } = useTercero()
  const { userName } = useCuentaConta()
  const { guardar, fallo, ocupado } = useGuardar()
  const { cliente, plataforma, socio, rolPlataforma, rolSocio } = papelesDe(ficha)
  const f = ficha.fiscal
  const [forma, setForma] = useState<string | null>(f?.paymentMethod ?? null)
  const [plazo, setPlazo] = useState<string>(f?.paymentTermsDays != null ? String(f.paymentTermsDays) : '')
  const [banco, setBanco] = useState<string | null>(f?.collectionTreasuryId ?? null)
  const [iban, setIban] = useState(f?.iban ? formatearIban(f.iban) : '')
  const [mandato, setMandato] = useState(f?.sepaMandateRef ?? '')
  const [canal, setCanal] = useState<string | null>(rolPlataforma?.channelId ?? null)
  const [cada, setCada] = useState<string | null>(rolPlataforma?.settlementEvery ?? null)
  const [pct, setPct] = useState(rolPlataforma?.commissionPct != null ? String(rolPlataforma.commissionPct).replace('.', ',') : '')
  const [aportes, setAportes] = useState<string[]>(rolSocio?.contributionKinds ?? ['marketing', 'packaging'])
  const plazoN = plazo.trim() === '' ? null : Number(plazo)
  const ibanMal = iban.trim() && forma === 'direct_debit' ? (validarIban(iban).ok ? null : 'Ese IBAN no es válido: revisa los dígitos.') : null

  return (
    <div className="cx-formulario">
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {(cliente || socio) && (
        <form className="cx-formulario" onSubmit={(e) => {
          e.preventDefault()
          if (ibanMal) return
          void guardar(() => guardarCliente(accountId, ficha.tercero.id, ficha.tercero.nombre, ficha.tercero.nif, {
            paymentMethod: forma as DatosFiscalesCliente['paymentMethod'], paymentTermsDays: plazoN, collectionTreasuryId: banco,
            iban: forma === 'direct_debit' && iban.trim() ? normalizarIban(iban) : null, sepaMandateRef: forma === 'direct_debit' ? mandato.trim() || null : null,
          }, userName), `Guardado cómo te paga ${ficha.tercero.nombre}.`)
        }}>
          <h2 className="cx-tarjeta-titulo">Cómo te paga</h2>
          <Pildoras campo="forma" etiqueta="Forma de cobro" elegidas={forma ? [forma] : []} opciones={[...FORMAS]} alCambiar={(v) => setForma(v[0] ?? null)} />
          <Pildoras campo="plazo" etiqueta="Plazo de cobro (días desde la factura)" elegidas={plazo ? [plazo] : []}
            opciones={PLAZOS.map((p) => ({ valor: String(p), texto: p === 0 ? 'Al contado' : `${p} días` }))}
            alCambiar={(v) => setPlazo(v[0] ?? '')} aviso={plazoN != null ? avisoPlazo([plazoN]) : null}
            ayuda="Más de 60 días se puede guardar, pero entre empresas lo limita la ley de morosidad." />
          <Pildoras campo="banco" etiqueta="Cuenta donde cobras" elegidas={banco ? [banco] : []}
            opciones={ficha.bancos.map((b) => ({ valor: b.id, texto: `${b.name}${b.iban ? ` ···${b.iban.slice(-4)}` : ''}` }))}
            alCambiar={(v) => setBanco(v[0] ?? null)} ayuda={ficha.bancos.length ? undefined : 'Da de alta tus bancos en Ajustes › Tablas generales › Bancos y cajas.'} />
          {forma === 'direct_debit' && <>
            <Campo campo="iban" etiqueta="IBAN del cliente (para domiciliar)" error={ibanMal}>{(p) => <input {...p} className="cx-input" value={iban} onChange={(e) => setIban(e.target.value)} />}</Campo>
            <Campo campo="mandato" etiqueta="Referencia del mandato SEPA">{(p) => <input {...p} className="cx-input" value={mandato} onChange={(e) => setMandato(e.target.value)} />}</Campo>
          </>}
          <div className="cx-pie"><button type="submit" className="cx-boton" disabled={ocupado}>Guardar el cobro</button></div>
        </form>
      )}
      {plataforma && (
        <form className="cx-formulario" onSubmit={(e) => {
          e.preventDefault()
          const n = pct.trim() ? Number(pct.replace(',', '.')) : null
          void guardar(async () => {
            const r = await anadirPapel(ficha.tercero.id, 'platform', { channelId: canal, settlementEvery: cada, commissionPct: n })
            if (r.liquidaciones_enlazadas) return r
            return r
          }, `Guardado lo de la plataforma${canal ? `: sus liquidaciones de ${ficha.canales.find((c) => c.id === canal)?.name} van a su ficha` : ''}.`)
        }}>
          <h2 className="cx-tarjeta-titulo">Como plataforma de reparto</h2>
          <Pildoras campo="canal" etiqueta="Su canal de venta" elegidas={canal ? [canal] : []} opciones={ficha.canales.map((c) => ({ valor: c.id, texto: c.name }))} alCambiar={(v) => setCanal(v[0] ?? null)} />
          <Pildoras campo="cada" etiqueta="Liquida" elegidas={cada ? [cada] : []}
            opciones={[{ valor: 'weekly', texto: 'Cada semana' }, { valor: 'fortnightly', texto: 'Cada 15 días' }, { valor: 'monthly', texto: 'Cada mes' }]} alCambiar={(v) => setCada(v[0] ?? null)} />
          <Campo campo="comision" etiqueta="Comisión pactada (%)" ayuda="Lo que dice tu contrato. Si las liquidaciones dicen otra cosa, te aviso.">
            {(p) => <input {...p} className="cx-input" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="21" />}
          </Campo>
          <div className="cx-pie"><button type="submit" className="cx-boton" disabled={ocupado}>Guardar la plataforma</button></div>
        </form>
      )}
      {socio && (
        <form className="cx-formulario" onSubmit={(e) => {
          e.preventDefault()
          void guardar(() => anadirPapel(ficha.tercero.id, 'brand_partner', { contributionKinds: aportes }), 'Guardado lo que aporta el socio.')
        }}>
          <h2 className="cx-tarjeta-titulo">Como socio de marca</h2>
          <Pildoras campo="aportes" etiqueta="Qué aporta" varias elegidas={aportes}
            opciones={[{ valor: 'marketing', texto: 'Marketing' }, { valor: 'packaging', texto: 'Packaging' }, { valor: 'other', texto: 'Otras' }]} alCambiar={setAportes} />
          <div className="cx-campo">
            <span className="cx-etiqueta">Sus marcas y la comisión pactada</span>
            {ficha.acuerdos.length === 0 && <span className="cx-ayuda">Ningún acuerdo de cesión enlazado: se enlazan en «Clientes y proveedores» (revisión de acuerdos).</span>}
            {ficha.acuerdos.map((a) => <span key={a.id}>{a.marca} · {String(a.pct).replace('.', ',')} % sobre las ventas sin IVA de la marca{a.desde ? ` · desde el ${diaMes(a.desde)}` : ''}</span>)}
          </div>
          <div className="cx-pie"><button type="submit" className="cx-boton" disabled={ocupado}>Guardar el socio</button></div>
        </form>
      )}
    </div>
  )
}

// ── Liquidaciones ───────────────────────────────────────────────────────────

export function LiquidacionesTercero() {
  const { ficha } = useTercero()
  const { plataforma, socio } = papelesDe(ficha)
  const porConfirmar = ficha.liquidaciones.filter((l) => periodo(l).porConfirmar).length
  return (
    <div className="cx-formulario">
      {plataforma && porConfirmar > 0 && (
        <div className="cx-aviso" role="status">{porConfirmar === 1 ? '1 liquidación tiene' : `${porConfirmar} liquidaciones tienen`} el periodo propuesto desde sus pedidos, por confirmar. Hasta que lo confirmes no cuentan por periodo en Ventas.</div>
      )}
      {plataforma && <TarjetaLiquidaciones todas />}
      {socio && <LiquidacionesAnteriores todas />}
      {socio && <Aportaciones />}
    </div>
  )
}

function Aportaciones() {
  const { ficha, accountId, hoy } = useTercero()
  const { userName } = useCuentaConta()
  const { guardar, fallo, ocupado } = useGuardar()
  const tipos = papelesDe(ficha).rolSocio?.contributionKinds ?? ['marketing', 'packaging', 'other']
  const NOMBRE: Record<string, string> = { marketing: 'Marketing', packaging: 'Packaging', other: 'Otras' }
  const [local, setLocal] = useState<string | null>(ficha.locales[0]?.id ?? null)
  const [tipo, setTipo] = useState<string>(tipos[0] ?? 'marketing')
  const [fecha, setFecha] = useState(hoy)
  const [importe, setImporte] = useState('')
  const [nota, setNota] = useState('')
  const valor = Number(importe.replace(/\./g, '').replace(',', '.'))
  return (
    <section className="cx-tarjeta" aria-label="Aportaciones del socio">
      <h2 className="cx-tarjeta-titulo">Aportaciones del socio</h2>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {ficha.aportaciones.length === 0 && <p className="cx-ayuda">Aún no hay ninguna. Restan en la liquidación del local y el mes en que las apuntes.</p>}
      {ficha.aportaciones.map((a) => (
        <div key={a.id} className="cxt-linea">
          <span>{diaMes(a.fecha)} · {ficha.locales.find((l) => l.id === a.localId)?.name ?? 'Local'} · {NOMBRE[a.tipo] ?? a.tipo}{a.nota ? ` · ${a.nota}` : ''}</span>
          <span className="cxt-anterior-derecha"><span className="cx-cifra">{eurosExactos(a.importe)}</span>
            <button type="button" className="cx-enlace" disabled={ocupado} onClick={() => void guardar(() => borrarAportacion(a.id), `Quitada la aportación de ${eurosExactos(a.importe)} del ${diaMes(a.fecha)}.`)}>Quitar</button></span>
        </div>
      ))}
      <form className="cxt-aportar" onSubmit={(e) => {
        e.preventDefault()
        if (!local || !Number.isFinite(valor) || valor <= 0) return
        void guardar(() => registrarAportacion(accountId, ficha.tercero.id, { localId: local, fecha, tipo, importe: valor, nota: nota.trim() || null }, userName),
          `Apuntada una aportación de ${eurosExactos(valor)} (${NOMBRE[tipo]}) en ${ficha.locales.find((l) => l.id === local)?.name}: resta en su liquidación de ese mes.`)
          .then(() => { setImporte(''); setNota('') })
      }}>
        <Pildoras campo="aporte-local" etiqueta="Local" elegidas={local ? [local] : []} opciones={ficha.locales.map((l) => ({ valor: l.id, texto: l.name }))} alCambiar={(v) => setLocal(v[0] ?? null)} />
        <Pildoras campo="aporte-tipo" etiqueta="Qué aporta" elegidas={[tipo]} opciones={tipos.map((t) => ({ valor: t, texto: NOMBRE[t] ?? t }))} alCambiar={(v) => setTipo(v[0] ?? tipo)} />
        <div className="cxt-dos">
          <div className="cx-campo"><label htmlFor="aporte-fecha">Fecha</label><input id="aporte-fecha" className="cx-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="cx-campo"><label htmlFor="aporte-importe">Importe (€)</label><input id="aporte-importe" className="cx-input" inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} /></div>
        </div>
        <div className="cx-campo"><label htmlFor="aporte-nota">Nota (opcional)</label><input id="aporte-nota" className="cx-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Campaña de octubre" /></div>
        <div className="cx-pie"><button type="submit" className="cx-boton" disabled={ocupado || !importe}>Apuntar aportación</button></div>
      </form>
    </section>
  )
}

// ── Contabilidad, contactos, documentos, historial ─────────────────────────

/**
 * Movimientos: el extracto de sus cuentas en el libro diario (C04). Son sus
 * subcuentas (430 de la plataforma o del cliente, 4300 del socio), así que no
 * hace falta filtrar por tercero. Naturaleza deudora: te debe lo que queda.
 */
function useMovimientos(accountId: string | null, companyId: string | null, cuentas: string[]) {
  const [r, setR] = useState<{ clave: string; apuntes: Apunte[]; ejercicios: EjercicioExtracto[]; error: string | null } | null>(null)
  const clave = `${accountId}:${companyId}:${cuentas.join(',')}`
  useEffect(() => {
    if (!accountId || !companyId) return
    let vivo = true
    Promise.all([apuntesDeCuentas(accountId, companyId, cuentas), leerEjercicios(accountId, companyId)])
      .then(([apuntes, ejs]) => { if (vivo) setR({ clave, apuntes, ejercicios: ejs.map((e) => ({ code: e.code, inicio: e.inicio, fin: e.fin })), error: null }) },
        (e: unknown) => { if (vivo) setR({ clave, apuntes: [], ejercicios: [], error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clave` resume las cuentas
  }, [accountId, companyId, clave])
  return r?.clave === clave ? r : null
}

export function ContabilidadTercero() {
  const { ficha, companyId } = useTercero()
  const { accountId } = useCuentaConta()
  // Su cuenta como cliente (y la de pago). La de liquidación tiene su propio Mayor: mezclarla aquí lo haría ilegible.
  const cuentas = ficha.cuentas.filter((c) => c.papel === 'cliente' || c.papel === 'pago').map((c) => c.id)
  const m = useMovimientos(accountId, companyId, cuentas)
  return (
    <div className="cx-formulario">
      <SusCuentas completa />
      {cuentas.length === 0 || !m ? (
        <section className="cx-tarjeta" aria-label="Movimientos">
          <h2 className="cx-tarjeta-titulo">Movimientos</h2>
          {cuentas.length === 0
            ? <Vacio titulo="Sin cuenta, no hay apuntes." explicacion="Cuando tenga su cuenta de cliente, aquí verás sus liquidaciones y sus cobros tal como están en el libro diario." />
            : <p className="cx-ayuda">Leyendo el libro…</p>}
        </section>
      ) : m.error ? <div className="cx-error" role="alert">{m.error}</div> : (
        <ExtractoCuenta titulo="Movimientos" ejercicios={m.ejercicios} apuntes={m.apuntes} naturaleza="deudora"
          vacio={(ej) => ({ titulo: `Aún no hay apuntes suyos en ${ej}.`, explicacion: 'Sus liquidaciones y sus cobros entran en el libro diario al validar sus asientos; entonces salen aquí, cada uno con su saldo.' })}
          documento={(a) => (a.enlace?.tipo === 'asiento' ? <Link to={rutaAsiento(a.enlace.id)} aria-label={`Ver el asiento ${a.documento}`}>{a.documento}</Link> : a.documento)} />
      )}
    </div>
  )
}

export function ContactosTercero() { return <ConQuienHablas /> }

export function DocumentosTercero() {
  const { ficha } = useTercero()
  return ficha.tercero.supplierId
    ? <Vacio titulo="Sus documentos están en su ficha de proveedor." explicacion="Contratos, certificados y fichas técnicas se guardan allí y valen para los dos papeles."
        accion={<Link className="cx-boton-sec" to={rutaFichaProveedor(ficha.tercero.supplierId, 'documentos')}>Abrir sus documentos</Link>} />
    : <Vacio titulo="Aún no hay documentos suyos." explicacion="Los documentos de un cliente que no es proveedor (contratos, mandatos SEPA) llegan con los contactos de cliente (pendiente en el PR)." />
}

export function HistorialTercero() {
  const { ficha } = useTercero()
  const eventos = [
    ...ficha.liquidaciones.filter((l) => l.cobradoEn).map((l) => ({ fecha: l.cobradoEn!, texto: `Cobro de la liquidación del ${periodo(l).texto}: ${eurosExactos(l.cobrado ?? 0)}` })),
    ...ficha.liquidacionesSocio.filter((l) => l.formula !== 'anterior' && l.estado !== 'borrador').map((l) => ({
      fecha: l.hasta, texto: `Liquidación de ${ficha.locales.find((x) => x.id === l.localId)?.name ?? 'un local'} confirmada${l.confirmadaPor ? ` por ${l.confirmadaPor}` : ''}: ${eurosExactos(Math.abs(l.importe ?? 0))}`,
    })),
    ...ficha.aportaciones.map((a) => ({ fecha: a.fecha, texto: `Aportación de ${eurosExactos(a.importe)}` })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha))
  if (eventos.length === 0) return <Vacio titulo="Aún no hay nada en su historial." explicacion="Aquí salen sus cobros, sus liquidaciones confirmadas y sus aportaciones, con quién lo hizo." />
  return (
    <section className="cx-tarjeta" aria-label="Historial">
      {eventos.map((e, i) => <div key={i} className="cxt-linea"><span>{e.texto}</span><span className="cx-ayuda">{diaMes(e.fecha)}</span></div>)}
      <p className="cx-ayuda"><Chip>Lo que cambia en su ficha</Chip> (datos fiscales, cobro) llega al historial con el registro de cambios de terceros (pendiente en el PR).</p>
    </section>
  )
}
