// src/modules/conta/proveedor/Pago.tsx
//
// Pestaña «Pago» (en el móvil, «Cómo le pagas»). Forma y plazo en PÍLDORAS de
// las tablas del C00 (nunca texto libre; los más usados, primero), días fijos,
// IBAN comprobado al momento (ISO 13616, módulo 97), BIC, banco, mandato SEPA
// (solo con domiciliación), moneda y pronto pago. «Cómo te factura» (compras,
// N20: con cada entrega, albarán y factura después o liquidación mensual, que
// manda también cada cuánto factura) y si trae el IVA dentro de cada línea.
//
// Un plazo de más de 60 días se guarda, pero avisa (Ley 3/2004, art. 4.3).

import { useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import ComoTeFactura from '@/modules/conta/proveedor/ComoTeFactura'
import { Campo, Pildoras, SeGuarda, type OpcionPildora } from '@/modules/conta/proveedor/piezas'
import { useGuardarAlSalir } from '@/modules/conta/proveedor/useGuardarAlSalir'
import { formatearIban, normalizarIban, validarIban } from '@/modules/conta/lib/iban'
import { formasDelDesplegable } from '@/modules/conta/lib/opcionesFicha'
import { avisoPlazo } from '@/modules/conta/lib/morosidad'
import { porUso } from '@/modules/conta/lib/masUsados'
import {
  PAYMENT_METHOD_LABEL, type FichaProveedor, type PaymentMethod,
} from '@/modules/conta/types'

const MONEDAS = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN', 'CZK', 'HUF', 'RON']

function leerDias(t: string): number[] | null {
  if (!t.trim()) return []
  const ds = t.split(/[\s,;y]+/).filter(Boolean).map(Number)
  if (ds.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return null
  return Array.from(new Set(ds)).sort((a, b) => a - b)
}

export default function Pago() {
  const { datos } = useFicha()
  const f = datos.ficha
  const g = useGuardarAlSalir()
  const [dias, setDias] = useState(f.paymentFixedDays.join(', '))
  const [iban, setIban] = useState(f.iban ? formatearIban(f.iban) : '')
  const [bic, setBic] = useState(f.bic ?? '')
  const [banco, setBanco] = useState(f.bankName ?? '')
  const [mandRef, setMandRef] = useState(f.sepaMandateRef ?? '')
  const [pronto, setPronto] = useState(f.earlyPaymentDiscountPct !== null ? String(f.earlyPaymentDiscountPct).replace('.', ',') : '')

  const ibanAlMomento = iban.trim() ? (() => { const r = validarIban(iban); return r.ok ? null : r.motivo })() : null
  const ibanNorm = iban.trim() ? normalizarIban(iban) : ''
  const extranjero = ibanNorm !== '' && !ibanNorm.startsWith('ES')

  const formas: OpcionPildora<PaymentMethod>[] = formasDelDesplegable(datos.opciones, f.paymentMethod, PAYMENT_METHOD_LABEL)
    .map((m) => ({ valor: m.valor, texto: m.nombre, nota: m.ofrecida ? undefined : 'ya no está en tus tablas' }))

  // Plazos: los de las tablas (los más usados en la cuenta, primero) y el guardado aunque ya no esté.
  const plazos = porUso(datos.opciones.plazos, (p) => String(p.valor), datos.otros.map((o) => o.paymentTermsDays === null ? null : String(o.paymentTermsDays)))
  const opcionesPlazo: OpcionPildora<string>[] = [
    ...plazos.map((p) => ({ valor: String(p.valor), texto: p.nombre })),
    ...(f.paymentTermsDays !== null && !plazos.some((p) => p.valor === f.paymentTermsDays)
      ? [{ valor: String(f.paymentTermsDays), texto: f.paymentTermsDays === 0 ? 'Al contado' : `${f.paymentTermsDays} días`, nota: 'ya no está en tus tablas' }] : []),
  ]

  async function salirDeIban() {
    g.marcar('iban', ibanAlMomento)
    if (ibanAlMomento) return
    const nuevo = ibanNorm || null
    const c: Partial<FichaProveedor> = { iban: nuevo }
    if (nuevo !== f.iban) c.ibanVerifiedAt = nuevo ? new Date().toISOString() : null
    if (await g.guardar(c, nuevo ? 'IBAN comprobado' : 'IBAN quitado') && nuevo) setIban(formatearIban(nuevo))
  }

  return (
    <div className="cx-formulario">
      {g.fallo && <div className="cx-error" role="alert">{g.fallo}</div>}
      <Pildoras campo="paymentMethod" etiqueta="Forma de pago" opciones={formas} elegidas={f.paymentMethod ? [f.paymentMethod] : []}
        alCambiar={(v) => void g.guardar({ paymentMethod: v[0] ?? null }, 'forma de pago')} />
      <Pildoras campo="paymentTermsDays" etiqueta="Plazo" opciones={opcionesPlazo}
        elegidas={f.paymentTermsDays === null ? [] : [String(f.paymentTermsDays)]}
        ayuda="Los plazos de tus tablas generales. Si falta uno, se añade allí."
        aviso={f.paymentTermsDays !== null ? avisoPlazo([f.paymentTermsDays]) : null}
        alCambiar={(v) => void g.guardar({ paymentTermsDays: v[0] === undefined ? null : Number(v[0]) }, 'plazo de pago')} />
      <Campo campo="paymentFixedDays" etiqueta="Días fijos de pago" error={g.error('paymentFixedDays')} ayuda="Si paga solo ciertos días del mes: «5, 20». Opcional.">
        {(p) => <input {...p} className="cx-input" value={dias} inputMode="numeric" onChange={(e) => setDias(e.target.value)}
          onBlur={() => {
            const d = leerDias(dias)
            if (d === null) { g.marcar('paymentFixedDays', 'Escribe los días del mes separados por comas, del 1 al 31: «5, 20».'); return }
            void g.guardar({ paymentFixedDays: d }, 'días fijos de pago')
          }} />}
      </Campo>
      <Campo campo="iban" etiqueta="IBAN" error={g.error('iban') ?? ibanAlMomento}
        ayuda={ibanNorm && !ibanAlMomento ? 'IBAN correcto.' : 'Lo comprobamos al momento con sus dígitos de control.'}>
        {(p) => <input {...p} className="cx-input cx-cifra" value={iban} autoComplete="off" placeholder="ES12 3456 7890 1234 5678 9012"
          onChange={(e) => setIban(e.target.value.toUpperCase())} onBlur={() => void salirDeIban()} />}
      </Campo>
      <Campo campo="bic" etiqueta={extranjero ? 'BIC / SWIFT (obligatorio con un IBAN de fuera de España)' : 'BIC / SWIFT (opcional)'} error={g.error('bic')}>
        {(p) => <input {...p} className="cx-input" value={bic} autoComplete="off" placeholder="CAIXESBBXXX" onChange={(e) => setBic(e.target.value.toUpperCase())}
          onBlur={() => void g.guardar({ bic: bic.trim().toUpperCase() || null }, 'BIC')} />}
      </Campo>
      <Campo campo="bankName" etiqueta="Banco">
        {(p) => <input {...p} className="cx-input" value={banco} onChange={(e) => setBanco(e.target.value)}
          onBlur={() => void g.guardar({ bankName: banco.trim() || null }, 'banco')} />}
      </Campo>
      {f.paymentMethod === 'direct_debit' && (
        <div className="cx-formulario-fila">
          <Campo campo="sepaMandateRef" etiqueta="Referencia del mandato de domiciliación">
            {(p) => <input {...p} className="cx-input" value={mandRef} onChange={(e) => setMandRef(e.target.value)}
              onBlur={() => void g.guardar({ sepaMandateRef: mandRef.trim() || null }, 'mandato de domiciliación')} />}
          </Campo>
          <Campo campo="sepaMandateDate" etiqueta="Fecha de firma del mandato">
            {(p) => <input {...p} className="cx-input" type="date" defaultValue={f.sepaMandateDate ?? ''}
              onBlur={(e) => void g.guardar({ sepaMandateDate: e.target.value || null }, 'fecha del mandato')} />}
          </Campo>
        </div>
      )}
      <div className="cx-formulario-fila">
        <Campo campo="currency" etiqueta="Moneda">
          {(p) => <select {...p} className="cx-input" value={f.currency} onChange={(e) => void g.guardar({ currency: e.target.value }, 'moneda')}>
            {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>}
        </Campo>
        <Campo campo="earlyPaymentDiscountPct" etiqueta="Descuento por pronto pago (%)" error={g.error('earlyPaymentDiscountPct')}>
          {(p) => <input {...p} className="cx-input" value={pronto} inputMode="decimal" onChange={(e) => setPronto(e.target.value)}
            onBlur={() => {
              const n = pronto.trim() === '' ? null : Number(pronto.replace(',', '.'))
              if (n !== null && (Number.isNaN(n) || n < 0 || n > 100)) { g.marcar('earlyPaymentDiscountPct', 'El descuento por pronto pago va de 0 a 100 %.'); return }
              void g.guardar({ earlyPaymentDiscountPct: n }, 'descuento por pronto pago')
            }} />}
        </Campo>
      </div>

      <ComoTeFactura />
      <fieldset className="cx-fieldset">
        <legend className="cx-tarjeta-titulo" style={{ fontSize: 16, marginBottom: 6 }}>Sus importes</legend>
        <Pildoras campo="ivaIncluidoEnLinea" etiqueta="¿El importe de cada línea lleva el IVA dentro?"
          opciones={[{ valor: 'no', texto: 'No, el IVA va aparte' }, { valor: 'si', texto: 'Sí, lleva el IVA dentro' }]}
          elegidas={[f.ivaIncluidoEnLinea ? 'si' : 'no']}
          ayuda="Si lo lleva, al recibir un albarán suyo la pantalla propone quitárselo y enseña el neto antes de guardar."
          alCambiar={(v) => void g.guardar({ ivaIncluidoEnLinea: v[0] === 'si' }, 'cómo factura el IVA')} />
      </fieldset>
      <SeGuarda texto={g.texto} ocupado={g.ocupado} />
    </div>
  )
}
