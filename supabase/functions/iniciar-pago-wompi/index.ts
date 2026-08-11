// supabase/functions/iniciar-pago-wompi/index.ts
//
// Recibe { usuarioId, planId } desde el frontend cuando la estudiante
// elige pagar un plan de forma ÚNICA (no recurrente).
// Crea la fila 'pendiente' en transacciones_pago y calcula la firma de
// integridad en el servidor (nunca en el frontend, para no exponer el
// secreto de integridad). Devuelve todo lo que necesita el widget de
// Wompi para abrirse.
//
// Secrets que debe tener este proyecto en Supabase (Project Settings >
// Edge Functions > Secrets), además de los que ya inyecta Supabase
// automáticamente (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
//   WOMPI_PUBLIC_KEY        -> llave pública de Wompi (pub_test_... o pub_prod_...)
//   WOMPI_INTEGRITY_SECRET  -> secreto de integridad (dashboard Wompi)
//   SITE_URL                -> dominio real de Netlify, ej: https://academiacoquin.netlify.app
//                              (usado para armar el redirect-url a /pago-completado)
//
// TODO cuando Emily tenga cuenta Wompi: reemplazar estos 3 secrets con
// los valores reales (primero en Sandbox). No hay que tocar este código.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { usuarioId, planId } = await req.json();

    if (!usuarioId || !planId) {
      return new Response(
        JSON.stringify({ error: "Falta usuarioId o planId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Traer el plan real (nunca confiar en un precio que mande el frontend)
    const { data: plan, error: errorPlan } = await supabase
      .from("planes")
      .select("id, nombre, precio, activo")
      .eq("id", planId)
      .single();

    if (errorPlan || !plan) {
      return new Response(
        JSON.stringify({ error: "Plan no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!plan.activo) {
      return new Response(
        JSON.stringify({ error: "Este plan ya no está disponible" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const montoCentavos = Math.round(Number(plan.precio) * 100);
    const moneda = "COP";

    // 2. Referencia única para esta transacción (la generamos nosotros,
    //    Wompi solo la recibe y la devuelve tal cual en el webhook)
    const referencia = `coquin-${planId.slice(0, 8)}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // 3. Firma de integridad, calculada en servidor:
    //    SHA256(referencia + monto_en_centavos + moneda + secreto_integridad)
    const integritySecret = Deno.env.get("WOMPI_INTEGRITY_SECRET") ?? "";
    const signature = await sha256Hex(`${referencia}${montoCentavos}${moneda}${integritySecret}`);

    // 4. Guardar el intento como 'pendiente'. El webhook es la única
    //    fuente de verdad que lo va a actualizar después.
    const { error: errorInsert } = await supabase.from("transacciones_pago").insert({
      usuario_id: usuarioId,
      plan_id: planId,
      tipo_pago: "unico",
      referencia,
      monto_centavos: montoCentavos,
      moneda,
      estado: "pendiente",
    });

    if (errorInsert) {
      console.error("Error creando transacciones_pago:", errorInsert);
      return new Response(
        JSON.stringify({ error: "No se pudo iniciar el pago" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const siteUrl = Deno.env.get("SITE_URL") ?? "https://REEMPLAZAR-CON-DOMINIO-REAL.netlify.app";

    return new Response(
      JSON.stringify({
        publicKey: Deno.env.get("WOMPI_PUBLIC_KEY") ?? "",
        amountInCents: montoCentavos,
        currency: moneda,
        reference: referencia,
        signature,
        redirectUrl: `${siteUrl}/pago-completado`,
        planNombre: plan.nombre,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error en iniciar-pago-wompi:", err);
    return new Response(
      JSON.stringify({ error: "Error inesperado iniciando el pago" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
