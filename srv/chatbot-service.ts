import cds from "@sap/cds";
import axios from "axios";
import "dotenv/config";
import { AsientosRepository } from "./repository/AsientosRepository";
import {
  CONVERSATION_STEPS,
  getDbConnection,
  loadConversationState,
  saveConversationState,
  clearConversationState,
} from "./conversationState";

module.exports = cds.service.impl(function () {
  const { ReclasificacionEntries } = cds.entities("sap.asientos");
  const asientosRepository = new AsientosRepository();
  asientosRepository.init().catch((err) => {
    console.error(err.message);
  });

  getDbConnection().catch((err) => {
    console.error(err.message);
  });

  this.on("chat", async (req: any) => {
    const userMessage = req.data.message ? req.data.message.trim() : ""; // Limpia espacios y maneja mensajes vacíos
    const userId = req.data.userId || "anonymous_user";

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("No se encontró la API KEY de Gemini.");
      return;
    }

    if (!userMessage) {
      req.reply({ error: "Por favor, envía un mensaje válido." });
      return;
    }

    try {
      let state = await loadConversationState(userId); // Carga el estado de la conversación para este usuario
      let replyMessage = "";
      let currentContextData = state.contextData; // Datos recopilados hasta ahora

      console.log(
        `DEBUG: userId: ${userId}, currentStep: ${
          state.currentStep
        }, contextData: ${JSON.stringify(currentContextData)}`
      );

      switch (state.currentStep) {
        case CONVERSATION_STEPS.INITIAL:
        case CONVERSATION_STEPS.ASKING_RECLASSIFICATION_COMMAND:
          if (
            userMessage.toLowerCase().includes("reclasificación") ||
            userMessage.toLowerCase().includes("reclasificar") ||
            userMessage.toLowerCase().includes("reclasificacion")
          ) {
            replyMessage =
              "Perfecto, iniciemos una reclasificación. ¿Qué tipo de asiento es (por ejemplo: gasto, ingreso, activo, pasivo)?";
            await saveConversationState(
              userId,
              CONVERSATION_STEPS.RECLASSIFY_AWAITING_TYPE,
              {}
            );
          } else {
            replyMessage =
              "Hola, soy tu asistente para asientos contables en SAP FI. Puedes pedirme que 'reclasifique' algo.";
            await saveConversationState(
              userId,
              CONVERSATION_STEPS.ASKING_RECLASSIFICATION_COMMAND,
              {}
            );
          }
          break;

        case CONVERSATION_STEPS.RECLASSIFY_AWAITING_TYPE:
          currentContextData.type = userMessage;
          replyMessage = `Entendido, un asiento de ${userMessage}. Ahora, ¿cuál es la cuenta contable original (ej. 400000)?`;
          await saveConversationState(
            userId,
            CONVERSATION_STEPS.RECLASSIFY_AWAITING_ACCOUNT,
            currentContextData
          );
          break;

        case CONVERSATION_STEPS.RECLASSIFY_AWAITING_ACCOUNT:
          currentContextData.originalAccount = userMessage;
          replyMessage = `Ok, cuenta ${userMessage}. ¿Cuál es el centro de costo (CeCo) original?`;
          await saveConversationState(
            userId,
            CONVERSATION_STEPS.RECLASSIFY_AWAITING_ORIGINAL_CECO,
            currentContextData
          );
          break;

        case CONVERSATION_STEPS.RECLASSIFY_AWAITING_ORIGINAL_CECO:
          currentContextData.originalCeCo = userMessage;
          replyMessage = `Recibido, CeCo original ${userMessage}. ¿Y cuál es el centro de costo (CeCo) destino?`;
          await saveConversationState(
            userId,
            CONVERSATION_STEPS.RECLASSIFY_AWAITING_TARGET_CECO,
            currentContextData
          );
          break;

        case CONVERSATION_STEPS.RECLASSIFY_AWAITING_TARGET_CECO:
          currentContextData.targetCeCo = userMessage;
          replyMessage = `Ok, CeCo destino ${userMessage}. ¿Cuál es el monto de la reclasificación? (solo números, ej. 1234.50)`;
          await saveConversationState(
            userId,
            CONVERSATION_STEPS.RECLASSIFY_AWAITING_AMOUNT,
            currentContextData
          );
          break;

        case CONVERSATION_STEPS.RECLASSIFY_AWAITING_AMOUNT:
          const amount = parseFloat(userMessage.replace(",", ".")); // Soporta coma decimal
          if (isNaN(amount) || amount <= 0) {
            replyMessage =
              "El monto no es válido. Por favor, ingresa solo números (ej. 1234.50) y que sea mayor a cero.";
            // Permanece en el mismo paso si el monto es inválido para que el usuario corrija
            await saveConversationState(
              userId,
              CONVERSATION_STEPS.RECLASSIFY_AWAITING_AMOUNT,
              currentContextData
            );
          } else {
            currentContextData.amount = amount;
            replyMessage = `Monto ${amount} recibido. Finalmente, ¿cuál es una breve descripción o concepto de esta reclasificación?`;
            await saveConversationState(
              userId,
              CONVERSATION_STEPS.RECLASSIFY_AWAITING_DESCRIPTION,
              currentContextData
            );
          }
          break;

        case CONVERSATION_STEPS.RECLASSIFY_AWAITING_DESCRIPTION:
          currentContextData.description = userMessage;
          const reclassificationPrompt = `
Genera una sugerencia de asiento contable para una reclasificación en SAP FI con los siguientes detalles:
- Tipo de Asiento: ${currentContextData.type || "no especificado"}
- Cuenta Original: ${currentContextData.originalAccount || "no especificada"}
- Centro de Costo Original: ${
            currentContextData.originalCeCo || "no especificado"
          }
- Centro de Costo Destino: ${currentContextData.targetCeCo || "no especificado"}
- Monto: ${currentContextData.amount || "no especificado"}
- Descripción: ${currentContextData.description || "no especificada"}

Incluye las cuentas de Debe y Haber, los montos y los centros de costo involucrados.
Sé conciso y directo, sin introducciones ni conclusiones.
`;

          const reclassificationResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
              contents: [
                { role: "user", parts: [{ text: reclassificationPrompt }] },
              ],
            },
            { headers: { "Content-Type": "application/json" } }
          );

          const geminiSuggestion =
            reclassificationResponse.data?.candidates?.[0]?.content?.parts?.[0]
              ?.text || "Sin sugerencia de reclasificación de Gemini.";
          // --- GUARDAR EN LA BASE DE DATOS CDS (ReclasificacionEntries) ---
          const dbForInsert = await getDbConnection();

          if (!ReclasificacionEntries) {
            throw new Error(
              "La entidad ReclasificacionEntries no está disponible. Verifica tu schema.cds y namespace."
            );
          }

          await dbForInsert.run(
            INSERT.into(ReclasificacionEntries).entries({
              originalAccount: currentContextData.originalAccount || "",
              originalCeCo: currentContextData.originalCeCo || "",
              targetCeCo: currentContextData.targetCeCo || "",
              amount: currentContextData.amount || 0,
              description: currentContextData.description || "",
              status: "COMPLETED",
            })
          );
          // Limpiar el estado de la conversación para este usuario
          await clearConversationState(userId);
          replyMessage = `¡Excelente! He registrado tu reclasificación. Aquí tienes la sugerencia:\n\n${geminiSuggestion}\n\n¿Hay algo más en lo que pueda ayudarte?`;
          break;

        default:
          // En caso de un paso desconocido o si el usuario interrumpe un flujo, reiniciamos.
          replyMessage =
            "Lo siento, no pude seguir el hilo de la conversación. Reiniciemos. ¿En qué puedo ayudarte hoy? Puedes pedirme que 'reclasifique' algo.";
          await clearConversationState(userId);
          break;
      }

      req.reply({
        message: replyMessage,
        botResponse: replyMessage,
      });
    } catch (error: any) {
      console.error(
        "❌ ERROR: Proceso de reclasificación falló:",
        error.message
      );
      console.error(
        "🔍 Detalle del error (si disponible):",
        error.response?.data || error
      );
      console.error("📦 Full error JSON:", JSON.stringify(error, null, 2));

      let userErrorMessage =
        "Fallo interno del chatbot. Por favor, intenta de nuevo o contacta a soporte.";
      if (
        error.response &&
        error.response.status === 400 &&
        error.response.data.error.message.includes("API key not valid")
      ) {
        userErrorMessage =
          "La API Key de Gemini no es válida o está expirada. Revisa tu archivo .env";
      } else if (
        error.message.includes("Cannot read properties of undefined")
      ) {
        userErrorMessage =
          "Hubo un problema al cargar la configuración de la base de datos o las entidades. Asegúrate de haber ejecutado 'cds deploy' y de que tus namespaces y nombres de entidades sean correctos.";
      } else if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        userErrorMessage =
          "No pude conectar con los servicios necesarios (Gemini o Base de Datos). Asegúrate de que estén corriendo y configurados correctamente.";
      }

      // Si hay un error, limpiar el estado de la conversación para evitar ciclos de error
      await clearConversationState(userId);
      req.reject(500, userErrorMessage);
    }
  });
});
