import cds from "@sap/cds";
import axios from "axios";
import "dotenv/config";
import { AsientosRepository } from "./repository/AsientosRepository";
import { ChatbotRepository } from "./repository/ChatbotRepository";

function extractJsonFromText(text: string): string {
  const match = text.match(/{[\s\S]*}/); // Encuentra el primer bloque entre llaves
  return match ? match[0] : "{}";
}

module.exports = cds.service.impl(async function () {
  const { ReclasificacionEntries } = cds.entities("sap.asientos");

  // const asientosRepository = new AsientosRepository();
  const chatbotRepository = new ChatbotRepository();

  // await asientosRepository.init();
  await chatbotRepository.init();

  this.on("chat", async (req: any) => {
    const userMessage = req.data.message?.trim() || "";
    const userId = req.data.userId || "anonymous_user";
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return req.reject(500, "Falta la API Key de Gemini.");
    if (!userMessage)
      return req.reply({ message: "Por favor, envíame un mensaje válido." });

    try {
      // Prompt para interpretar el mensaje
      const prompt = `
Cuando el usuario te pida hacer una reclasificación o reclasificar, extrae los siguientes datos desde el mensaje del usuario si están presentes:

- intención = reclasificación, reclasificar, reclasificacion
- tipo de asiento (gasto, ingreso, activo, pasivo)
- cuenta original
- centro de costo original
- centro de costo destino
- monto
- descripción

Mensaje: "${userMessage}"

Devolvé el resultado en formato JSON plano. Si algo falta, ponelo como null.
`;

      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        },
        { headers: { "Content-Type": "application/json" } }
      );

      const extractedText =
        geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      console.log("📨 Respuesta bruta de Gemini:", extractedText);

      let parsed: any = {};
      try {
        const cleanJson = extractJsonFromText(extractedText);
        parsed = JSON.parse(cleanJson);
      } catch (e) {
        console.error("❌ Error al parsear JSON desde Gemini:", extractedText);
        return req.reject(
          500,
          "La IA no devolvió una respuesta válida. Intentá de nuevo."
        );
      }

      const {
        intencion,
        tipo,
        cuentaOriginal,
        cecoOriginal,
        cecoDestino,
        monto,
        descripcion,
      } = parsed;

      if (!intencion || !intencion.toLowerCase().includes("reclasificacion")) {
        return req.reply({
          message:
            "Por ahora solo puedo ayudarte con reclasificaciones. ¿Querés hacer una?",
        });
      }

      const missing = [];
      if (!tipo) missing.push("tipo de asiento");
      if (!cuentaOriginal) missing.push("cuenta original");
      if (!cecoOriginal) missing.push("CeCo original");
      if (!cecoDestino) missing.push("CeCo destino");
      if (!monto) missing.push("monto");
      if (!descripcion) missing.push("descripción");

      if (missing.length > 0) {
        return req.reply({
          message: `Me faltan los siguientes datos para continuar: ${missing.join(
            ", "
          )}. Por favor completalos.`,
        });
      }

      // Todos los datos están presentes -> guardamos
      await cds.run(
        INSERT.into("sap.asientos.ReclasificacionEntries").entries({
          originalAccount: cuentaOriginal,
          originalCeCo: cecoOriginal,
          targetCeCo: cecoDestino,
          amount: parseFloat(monto),
          description: descripcion,
          status: "COMPLETED",
        })
      );

      return req.reply({
        message: `Registré la reclasificación correctamente. ¿Querés que te muestre cómo quedaría el asiento contable?`,
      });
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      console.error("🔍 Detalle:", error.response?.data || error);

      return req.reject(
        500,
        "Ocurrió un error procesando tu mensaje. Reintentá o contactá a soporte."
      );
    }
  });
});
