// supabase/functions/webhook-wompi/index.ts
//
// Wompi llama esta función (evento transaction.updated) cada vez que
// una transacción cambia de estado. Esta es la ÚNICA fuente de verdad
// sobre si un pago se aprobó — nunca la redirección al navegador.
//
// Configuración en el dashboard de Wompi: apuntar la URL del webhook a
//   https://<tu-proyecto>.supabase.co/functions/v1/webhook-wompi
//
// Secrets requeridos (además de los que Supabase ya inyecta):
//   WOMPI_EVENTS_SECRET  -> "secreto de eventos" del dashboard de Wompi
//                           (distinto del secreto de integridad y de la llave privada)
//
// TODO cuando Emily tenga cuenta Wompi: reemplazar WOMPI_EVENTS_SECRET
// con el valor real (primero en Sandbox). No hay que tocar este código.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Lee un valor anidado a partir de una ruta tipo "transaction.id"
function leerPorRuta(objeto: any, ruta: string): unknown {
  return ruta.split(".").reduce((actual, llave) => actual?.[llave], objeto);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  try {
    const { signature, timestamp, data } = body;

    if (!signature?.properties || !signature?.checksum || !timestamp || !data) {
      console.error("Webhook Wompi: estructura inesperada", body);
      return new Response("Estructura inválida", { status: 400 });
    }

    // 1. Validar el checksum ANTES de confiar en nada del payload
    const eventsSecret = Deno.env.get("WOMPI_EVENTS_SECRET") ?? "";
    const valoresConcatenados = signature.properties
      .map((ruta: string) => leerPorRuta(data, ruta))
      .join("");
    const cadenaAFirmar = `${valoresConcatenados}${timestamp}${eventsSecret}`;
    const checksumCalculado = await sha256Hex(cadenaAFirmar);

    if (checksumCalculado.toLowerCase() !== String(signature.checksum).toLowerCase()) {
      console.error("Webhook Wompi: checksum no coincide, posible falsificación");
      return new Response("Firma inválida", { status: 401 });
    }

    const transaction = data.transaction;
    if (!transaction?.reference || !transaction?.status) {
      console.error("Webhook Wompi: falta transaction.reference o status", data);
      return new Response("Datos incompletos", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 2. Buscar la transacción pendiente que creamos en iniciar-pago-wompi
    const { data: transaccion, error: errorBuscar } = await supabase
      .from("transacciones_pago")
      .select("id, usuario_id, plan_id, monto_centavos, estado")
      .eq("referencia", transaction.reference)
      .single();

    if (errorBuscar || !transaccion) {
      // No es un error de firma, pero sí algo raro: Wompi nos avisa de
      // una referencia que no generamos nosotros. Se responde 200 para
      // que Wompi no reintente indefinidamente, pero queda logueado.
      console.error("Webhook Wompi: referencia no encontrada en transacciones_pago", transaction.reference);
      return new Response("ok (referencia no encontrada, ignorada)", { status: 200 });
    }

    // Evitar procesar dos veces el mismo evento si Wompi reintenta
    if (transaccion.estado === "APPROVED") {
      return new Response("ok (ya procesada)", { status: 200 });
    }

    // 3. Actualizar la transacción con el resultado real
    await supabase
      .from("transacciones_pago")
      .update({
        estado: transaction.status,
        wompi_transaction_id: transaction.id,
        webhook_payload: body,
      })
      .eq("id", transaccion.id);

    // 4. Si fue aprobado, activar el plan (mismo patrón que la
    //    activación manual: vencer el plan activo previo + insertar el nuevo)
    if (transaction.status === "APPROVED") {
      const { data: plan, error: errorPlan } = await supabase
        .from("planes")
        .select("id, cantidad_clases, duracion_semanas")
        .eq("id", transaccion.plan_id)
        .single();

      if (errorPlan || !plan) {
        console.error("Webhook Wompi: plan no encontrado al activar", transaccion.plan_id);
        return new Response("ok (plan no encontrado, revisar manualmente)", { status: 200 });
      }

      const hoy = new Date();
      const hoyStr = hoy.toISOString().slice(0, 10);
      const ayer = new Date(hoy);
      ayer.setDate(ayer.getDate() - 1);
      const ayerStr = ayer.toISOString().slice(0, 10);

      const fechaFin = new Date(hoy);
      fechaFin.setDate(fechaFin.getDate() + plan.duracion_semanas * 7);
      const fechaFinStr = fechaFin.toISOString().slice(0, 10);

      // Vencer cualquier plan que hoy cuente como activo (misma lógica
      // que el proceso manual: se ajusta fecha_fin al pasado)
      await supabase
        .from("compras_plan")
        .update({ fecha_fin: ayerStr })
        .eq("usuario_id", transaccion.usuario_id)
        .eq("estado", "activo")
        .gte("fecha_fin", hoyStr);

      // Insertar el plan nuevo
      const { error: errorInsertPlan } = await supabase.from("compras_plan").insert({
        usuario_id: transaccion.usuario_id,
        plan_id: plan.id,
        clases_restantes: plan.cantidad_clases,
        fecha_inicio: hoyStr,
        fecha_fin: fechaFinStr,
        estado: "activo",
        pago_referencia: transaction.reference,
        precio_pagado: transaccion.monto_centavos / 100,
      });

      if (errorInsertPlan) {
        console.error("Webhook Wompi: error activando el plan", errorInsertPlan);
        return new Response("ok (pago aprobado pero falló activación, revisar manualmente)", { status: 200 });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Error en webhook-wompi:", err);
    // 200 para que Wompi no reintente en bucle un error de nuestro lado
    // que probablemente no se resuelva solo; queda logueado para revisar.
    return new Response("ok (error interno, revisar logs)", { status: 200 });
  }
});
