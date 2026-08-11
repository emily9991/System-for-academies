// src/ComprarPlan.jsx
//
// La estudiante elige un plan y el tipo de pago (único o mensual) y
// dispara el flujo de Wompi. El pago único está completo y funcional
// en cuanto existan los secrets de Wompi en Supabase. El pago mensual
// recurrente queda deshabilitado a propósito: falta resolver en
// Sandbox el detalle del formulario de tokenización (ver notas de
// continuidad, sección 3.3) antes de ofrecerlo con dinero real.
//
// Uso: <ComprarPlan usuarioId={usuario.id} onPagoIniciado={...} />

import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const CONTENEDOR_WIDGET_ID = 'wompi-widget-contenedor'

export default function ComprarPlan({ usuarioId }) {
  const [planes, setPlanes] = useState([])
  const [planSeleccionado, setPlanSeleccionado] = useState(null)
  const [tipoPago, setTipoPago] = useState('unico')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [datosPago, setDatosPago] = useState(null) // respuesta de iniciar-pago-wompi

  useEffect(() => {
    async function cargarPlanes() {
      const { data, error } = await supabase
        .from('planes')
        .select('id, nombre, tipo, precio, duracion_semanas, cantidad_clases, incluye_semillero')
        .eq('activo', true)
        .order('precio', { ascending: true })

      if (error) {
        console.error('Error cargando planes:', error)
        setError('No se pudieron cargar los planes. Intenta de nuevo.')
        return
      }
      setPlanes(data)
    }
    cargarPlanes()
  }, [])

  // Cuando llega la respuesta de iniciar-pago-wompi, inyectamos el
  // widget oficial de Wompi (script con data-attributes, tal como lo
  // documenta docs.wompi.co). El widget dibuja su propio botón dentro
  // del contenedor; al hacer clic ahí se abre el checkout de Wompi.
  useEffect(() => {
    if (!datosPago) return

    const contenedor = document.getElementById(CONTENEDOR_WIDGET_ID)
    if (!contenedor) return
    contenedor.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://checkout.wompi.co/widget.js'
    script.setAttribute('data-render', 'button')
    script.setAttribute('data-public-key', datosPago.publicKey)
    script.setAttribute('data-currency', datosPago.currency)
    script.setAttribute('data-amount-in-cents', datosPago.amountInCents)
    script.setAttribute('data-reference', datosPago.reference)
    script.setAttribute('data-signature:integrity', datosPago.signature)
    script.setAttribute('data-redirect-url', datosPago.redirectUrl)
    contenedor.appendChild(script)
  }, [datosPago])

  async function iniciarPago() {
    if (!planSeleccionado) return
    setCargando(true)
    setError(null)
    setDatosPago(null)

    const { data, error } = await supabase.functions.invoke('iniciar-pago-wompi', {
      body: { usuarioId, planId: planSeleccionado.id },
    })

    setCargando(false)

    if (error) {
      console.error('Error iniciando pago:', error)
      setError('No se pudo iniciar el pago. Intenta de nuevo en unos minutos.')
      return
    }
    if (data?.error) {
      setError(data.error)
      return
    }

    setDatosPago(data)
  }

  return (
    <div className="comprar-plan">
      <h2>Comprar un plan</h2>

      {error && <p className="comprar-plan__error">{error}</p>}

      <div className="comprar-plan__lista">
        {planes.map((plan) => (
          <label
            key={plan.id}
            className={`comprar-plan__opcion ${planSeleccionado?.id === plan.id ? 'comprar-plan__opcion--activa' : ''}`}
          >
            <input
              type="radio"
              name="plan"
              value={plan.id}
              checked={planSeleccionado?.id === plan.id}
              onChange={() => {
                setPlanSeleccionado(plan)
                setDatosPago(null)
              }}
            />
            <div>
              <strong>{plan.nombre}</strong>
              <div>${Number(plan.precio).toLocaleString('es-CO')}</div>
              <div>
                {plan.duracion_semanas} semana{plan.duracion_semanas === 1 ? '' : 's'}
                {plan.cantidad_clases ? ` · ${plan.cantidad_clases} clases` : ' · clases ilimitadas'}
              </div>
            </div>
          </label>
        ))}
      </div>

      {planSeleccionado && (
        <>
          <div className="comprar-plan__tipo-pago">
            <label>
              <input
                type="radio"
                name="tipoPago"
                value="unico"
                checked={tipoPago === 'unico'}
                onChange={() => setTipoPago('unico')}
              />
              Pago único
            </label>

            <label className="comprar-plan__opcion--deshabilitada">
              <input type="radio" name="tipoPago" value="mensual" disabled />
              Suscripción mensual automática
              <span className="comprar-plan__proximamente"> (próximamente)</span>
            </label>
          </div>

          {tipoPago === 'unico' && !datosPago && (
            <button onClick={iniciarPago} disabled={cargando}>
              {cargando ? 'Preparando pago…' : `Pagar $${Number(planSeleccionado.precio).toLocaleString('es-CO')}`}
            </button>
          )}
        </>
      )}

      {/* Wompi inyecta aquí su propio botón de checkout una vez iniciado el pago */}
      <div id={CONTENEDOR_WIDGET_ID}></div>

      {datosPago && (
        <p className="comprar-plan__nota">
          Haz clic en el botón de Wompi que apareció arriba para completar el pago de{' '}
          <strong>{datosPago.planNombre}</strong>.
        </p>
      )}
    </div>
  )
}
