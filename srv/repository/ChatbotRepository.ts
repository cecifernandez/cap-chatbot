import cds from "@sap/cds";

export class ChatbotRepository {
  private db: any;
  private ConversationStates: any;

  static readonly CONVERSATION_STEPS = {
    INITIAL: "INITIAL",
    ASKING_RECLASSIFICATION_COMMAND: "ASKING_RECLASSIFICATION_COMMAND", // Bot ha preguntado y espera "reclasificar"
    RECLASSIFY_AWAITING_TYPE: "RECLASSIFY_AWAITING_TYPE", // Espera tipo de asiento (gasto, ingreso)
    RECLASSIFY_AWAITING_ACCOUNT: "RECLASSIFY_AWAITING_ACCOUNT", // Espera cuenta original
    RECLASSIFY_AWAITING_ORIGINAL_CECO: "RECLASSIFY_AWAITING_ORIGINAL_CECO", // Espera CeCo original
    RECLASSIFY_AWAITING_TARGET_CECO: "RECLASSIFY_AWAITING_TARGET_CECO", // Espera CeCo destino
    RECLASSIFY_AWAITING_AMOUNT: "RECLASSIFY_AWAITING_AMOUNT", // Espera monto
    RECLASSIFY_AWAITING_DESCRIPTION: "RECLASSIFY_AWAITING_DESCRIPTION", // Espera descripción
    RECLASSIFY_COMPLETE: "RECLASSIFY_COMPLETE", // Datos completos, listos para procesar/guardar
  };

  constructor() {}

  async init() {
    this.db = await cds.connect.to("db");
    this.ConversationStates = cds.entities("sap.asientos").ConversationStates;
  }

  async getConversationState(userId: string): Promise<any> {
    const state = await this.db.run(
      SELECT.from(this.ConversationStates).where({ userId })
    );
    if (state.length > 0) {
      return {
        userId: state[0].userId,
        currentStep: state[0].currentStep,
        contextData: JSON.parse(state[0].contextData || "{}"),
      };
    }
    // Si no hay estado para este usuario, inicializamos uno nuevo
    return {
      userId,
      currentStep: ChatbotRepository.CONVERSATION_STEPS.INITIAL,
      contextData: {},
    };
  }

  async saveConversationState(
    userId: string,
    currentStep: string,
    contextData: any
  ) {
    const existingState = await this.db.run(
      SELECT.from(this.ConversationStates).where({ userId })
    );

    if (existingState.length > 0) {
      // Actualiza el estado existente
      await this.db.run(
        UPDATE(this.ConversationStates)
          .set({
            currentStep: currentStep,
            contextData: JSON.stringify(contextData),
          })
          .where({ userId })
      );
    } else {
      // Inserta un nuevo estado
      await this.db.run(
        INSERT.into(this.ConversationStates).entries({
          userId: userId,
          currentStep: currentStep,
          contextData: JSON.stringify(contextData),
        })
      );
    }
  }

  async clearConversationState(userId: string) {
    await this.db.run(DELETE.from(this.ConversationStates).where({ userId }));
  }
}
