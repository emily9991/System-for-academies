import { useEffect, useState } from 'react';
// Ajusta esta ruta al lugar real donde tienes tu cliente de Supabase
import { supabase } from './supabaseClient';

const PLAN_VACIO = {
  id: null,
  nombre: '',
  tipo: 'grupal',        // 'personalizado' | 'grupal' | 'semillero' | 'ilimitado'
  cantidad_clases: '',   // vacío = ilimitado (se guarda como null)
  precio: '',
  duracion_semanas: '',
  incluye_semillero: false,
  activo: true,
};

function formatearPrecio(valor) {
  if (valor === null || valor === undefined) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(valor);
}

export default function PanelPlanes() {
  const [planes, setPlanes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [planEditando, setPlanEditando] = useState(PLAN_VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargarPlanes();
  }, []);

  async function cargarPlanes() {
    setCargando(true);
    setError(null);
    const { data, error } = await supabase
      .from('planes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setError('No se pudieron cargar los planes: ' + error.message);
    } else {
      setPlanes(data);
    }
    setCargando(false);
  }

  function abrirFormNuevo() {
    setPlanEditando(PLAN_VACIO);
    setMostrarForm(true);
  }

  function abrirFormEditar(plan) {
    setPlanEditando({
      ...plan,
      cantidad_clases: plan.cantidad_clases ?? '',
      duracion_semanas: plan.duracion_semanas ?? '',
    });
    setMostrarForm(true);
  }

  async function guardarPlan(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const payload = {
      nombre: planEditando.nombre.trim(),
      tipo: planEditando.tipo,
      cantidad_clases:
        planEditando.cantidad_clases === '' ? null : Number(planEditando.cantidad_clases),
      precio: Number(planEditando.precio),
      duracion_semanas:
        planEditando.duracion_semanas === '' ? null : Number(planEditando.duracion_semanas),
      incluye_semillero: planEditando.incluye_semillero,
      activo: planEditando.activo,
    };

    let resultado;
    if (planEditando.id) {
      resultado = await supabase.from('planes').update(payload).eq('id', planEditando.id);
    } else {
      resultado = await supabase.from('planes').insert(payload);
    }

    if (resultado.error) {
      setError('No se pudo guardar el plan: ' + resultado.error.message);
    } else {
      setMostrarForm(false);
      await cargarPlanes();
    }
    setGuardando(false);
  }

  async function alternarActivo(plan) {
    const { error } = await supabase
      .from('planes')
      .update({ activo: !plan.activo })
      .eq('id', plan.id);

    if (error) {
      setError('No se pudo actualizar el estado: ' + error.message);
    } else {
      await cargarPlanes();
    }
  }

  return (
    <div className="panel-planes">
      <div className="panel-planes-header">
        <h2>Planes</h2>
        <button className="btn-primario" onClick={abrirFormNuevo}>
          + Crear plan
        </button>
      </div>

      {error && <p className="mensaje-error">{error}</p>}

      {cargando ? (
        <p>Cargando planes...</p>
      ) : (
        <div className="tabla-planes-wrap">
          <table className="tabla-planes">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Clases</th>
                <th>Duración</th>
                <th>Semillero</th>
                <th>Precio</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {planes.map((plan) => (
                <tr key={plan.id} className={!plan.activo ? 'fila-inactiva' : ''}>
                  <td>{plan.nombre}</td>
                  <td>{plan.tipo}</td>
                  <td>{plan.cantidad_clases ?? 'Ilimitado'}</td>
                  <td>{plan.duracion_semanas ? `${plan.duracion_semanas} sem.` : '—'}</td>
                  <td>{plan.incluye_semillero ? 'Sí' : 'No'}</td>
                  <td>{formatearPrecio(plan.precio)}</td>
                  <td>
                    <span className={plan.activo ? 'badge-activo' : 'badge-inactivo'}>
                      {plan.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="acciones-planes">
                    <button onClick={() => abrirFormEditar(plan)}>Editar</button>
                    <button onClick={() => alternarActivo(plan)}>
                      {plan.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mostrarForm && (
        <div className="modal-overlay" onClick={() => setMostrarForm(false)}>
          <form
            className="modal-form"
            onClick={(e) => e.stopPropagation()}
            onSubmit={guardarPlan}
          >
            <h3>{planEditando.id ? 'Editar plan' : 'Crear plan'}</h3>

            <label>
              Nombre
              <input
                type="text"
                required
                value={planEditando.nombre}
                onChange={(e) =>
                  setPlanEditando({ ...planEditando, nombre: e.target.value })
                }
              />
            </label>

            <label>
              Tipo
              <select
                value={planEditando.tipo}
                onChange={(e) =>
                  setPlanEditando({ ...planEditando, tipo: e.target.value })
                }
              >
                <option value="personalizado">Personalizado</option>
                <option value="grupal">Grupal</option>
                <option value="semillero">Semillero</option>
                <option value="ilimitado">Ilimitado</option>
              </select>
            </label>

            <label>
              Cantidad de clases (vacío = ilimitado)
              <input
                type="number"
                min="0"
                value={planEditando.cantidad_clases}
                onChange={(e) =>
                  setPlanEditando({ ...planEditando, cantidad_clases: e.target.value })
                }
              />
            </label>

            <label>
              Precio (COP)
              <input
                type="number"
                min="0"
                required
                value={planEditando.precio}
                onChange={(e) =>
                  setPlanEditando({ ...planEditando, precio: e.target.value })
                }
              />
            </label>

            <label>
              Duración (semanas)
              <input
                type="number"
                min="0"
                value={planEditando.duracion_semanas}
                onChange={(e) =>
                  setPlanEditando({ ...planEditando, duracion_semanas: e.target.value })
                }
              />
            </label>

            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={planEditando.incluye_semillero}
                onChange={(e) =>
                  setPlanEditando({
                    ...planEditando,
                    incluye_semillero: e.target.checked,
                  })
                }
              />
              Incluye semillero
            </label>

            <div className="modal-acciones">
              <button type="button" onClick={() => setMostrarForm(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primario" disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
