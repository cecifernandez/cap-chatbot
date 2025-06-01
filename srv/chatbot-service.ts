import cds from "@sap/cds";
import axios from "axios";
import "dotenv/config";
import { AsientosRepository } from "./repository/AsientosRepository";
import { ChatbotRepository } from "./repository/ChatbotRepository";

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

    if (!apiKey)
      return req.reject(500, "❌ No se encontró la API KEY de Gemini.");
    if (!userMessage)
      return req.reply({ error: "Por favor, envía un mensaje válido." });

    try {
      let state = await chatbotRepository.getConversationState(userId);
      let replyMessage = "";
      let currentContextData = state.contextData;
      const STEP = ChatbotRepository.CONVERSATION_STEPS;

      switch (state.currentStep) {
        case STEP.INITIAL:
        case STEP.ASKING_RECLASSIFICATION_COMMAND:
          if (
            ["reclasificación", "reclasificar", "reclasificacion"].some((k) =>
              userMessage.toLowerCase().includes(k)
            )
          ) {
            replyMessage =
              "Perfecto, iniciemos una reclasificación. ¿Qué tipo de asiento es (gasto, ingreso, etc)?";
            await chatbotRepository.saveConversationState(
              userId,
              STEP.RECLASSIFY_AWAITING_TYPE,
              {}
            );
          } else {
            replyMessage =
              "Hola, soy tu asistente para asientos contables en SAP FI. Puedes pedirme que 'reclasifique' algo.";
            await chatbotRepository.saveConversationState(
              userId,
              STEP.ASKING_RECLASSIFICATION_COMMAND,
              {}
            );
          }
          break;

        case STEP.RECLASSIFY_AWAITING_TYPE:
          currentContextData.type = userMessage;
          replyMessage = `Entendido, un asiento de ${userMessage}. ¿Cuál es la cuenta contable original (ej. 400000)?;`;
          await chatbotRepository.saveConversationState(
            userId,
            STEP.RECLASSIFY_AWAITING_ACCOUNT,
            currentContextData
          );
          break;

        case STEP.RECLASSIFY_AWAITING_ACCOUNT:
          currentContextData.originalAccount = userMessage;
          replyMessage = `Ok, cuenta ${userMessage}. ¿Cuál es el centro de costo (CeCo) original?;`;
          await chatbotRepository.saveConversationState(
            userId,
            STEP.RECLASSIFY_AWAITING_ORIGINAL_CECO,
            currentContextData
          );
          break;

        case STEP.RECLASSIFY_AWAITING_ORIGINAL_CECO:
          currentContextData.originalCeCo = userMessage;
          replyMessage = `Recibido, CeCo original ${userMessage}. ¿Y cuál es el centro de costo (CeCo) destino?;`;
          await chatbotRepository.saveConversationState(
            userId,
            STEP.RECLASSIFY_AWAITING_TARGET_CECO,
            currentContextData
          );
          break;

        case STEP.RECLASSIFY_AWAITING_TARGET_CECO:
          currentContextData.targetCeCo = userMessage;
          replyMessage = `Ok, CeCo destino ${userMessage}. ¿Cuál es el monto de la reclasificación? (ej. 1234.50);`;
          await chatbotRepository.saveConversationState(
            userId,
            STEP.RECLASSIFY_AWAITING_AMOUNT,
            currentContextData
          );
          break;

        case STEP.RECLASSIFY_AWAITING_AMOUNT:
          const amount = parseFloat(userMessage.replace(",", "."));
          if (isNaN(amount) || amount <= 0) {
            replyMessage =
              "El monto no es válido. Ingresá un número mayor a cero (ej. 1234.50)";
            await chatbotRepository.saveConversationState(
              userId,
              STEP.RECLASSIFY_AWAITING_AMOUNT,
              currentContextData
            );
          } else {
            currentContextData.amount = amount;
            replyMessage = `Monto ${amount} recibido. Finalmente, ¿cuál es la descripción o concepto de esta reclasificación?;`;
            await chatbotRepository.saveConversationState(
              userId,
              STEP.RECLASSIFY_AWAITING_DESCRIPTION,
              currentContextData
            );
          }
          break;

        case STEP.RECLASSIFY_AWAITING_DESCRIPTION:
          currentContextData.description = userMessage;

          const prompt = `
Genera una sugerencia de asiento contable para una reclasificación en SAP FI con los siguientes detalles:
- Tipo de Asiento: ${currentContextData.type}
- Cuenta Original: ${currentContextData.originalAccount}
- CeCo Original: ${currentContextData.originalCeCo}
- CeCo Destino: ${currentContextData.targetCeCo}
- Monto: ${currentContextData.amount}
- Descripción: ${currentContextData.description}

Incluye las cuentas de Debe y Haber, los montos y los centros de costo involucrados.
Sin introducciones ni conclusiones.
`;

          const geminiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
              contents: [{ role: "user", parts: [{ text: prompt }] }],
            },
            { headers: { "Content-Type": "application/json" } }
          );

          const suggestion =
            geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            "Sin sugerencia generada.";
          currentContextData.geminiSuggestion = suggestion;

          if (!ReclasificacionEntries) {
            throw new Error("Entidad ReclasificacionEntries no encontrada.");
          }

          await cds.run(
            INSERT.into(ReclasificacionEntries).entries({
              originalAccount: currentContextData.originalAccount || "",
              originalCeCo: currentContextData.originalCeCo || "",
              targetCeCo: currentContextData.targetCeCo || "",
              amount: currentContextData.amount || 0,
              description: currentContextData.description || "",
              geminiSuggestion: currentContextData.geminiSuggestion || "",
              status: "COMPLETED",
            })
          );

          await chatbotRepository.clearConversationState(userId);
          replyMessage = `¡Listo! Registré tu reclasificación. Sugerencia:\n\n${suggestion}\n\n¿Necesitás algo más?`;
          break;

        default:
          replyMessage =
            "No entendí en qué estábamos. Reiniciemos. ¿Querés hacer una reclasificación?";
          await chatbotRepository.clearConversationState(userId);
          break;
      }

      req.reply({ message: replyMessage });
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      console.error("🔍 Detalle:", error.response?.data || error);
      await chatbotRepository.clearConversationState(userId);

      let msg = "Fallo interno del chatbot. Reintentá más tarde.";
      if (
        error?.response?.data?.error?.message?.includes("API key not valid")
      ) {
        msg = "API Key de Gemini inválida o vencida.";
      }
      req.reject(500, msg);
    }
  });
});
