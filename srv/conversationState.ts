import cds from '@sap/cds';

export const CONVERSATION_STEPS = {
    INITIAL: 'INITIAL',
    ASKING_RECLASSIFICATION_COMMAND: 'ASKING_RECLASSIFICATION_COMMAND', // Bot ha preguntado y espera "reclasificar"
    RECLASSIFY_AWAITING_TYPE: 'RECLASSIFY_AWAITING_TYPE', // Espera tipo de asiento (gasto, ingreso)
    RECLASSIFY_AWAITING_ACCOUNT: 'RECLASSIFY_AWAITING_ACCOUNT', // Espera cuenta original
    RECLASSIFY_AWAITING_ORIGINAL_CECO: 'RECLASSIFY_AWAITING_ORIGINAL_CECO', // Espera CeCo original
    RECLASSIFY_AWAITING_TARGET_CECO: 'RECLASSIFY_AWAITING_TARGET_CECO', // Espera CeCo destino
    RECLASSIFY_AWAITING_AMOUNT: 'RECLASSIFY_AWAITING_AMOUNT', // Espera monto
    RECLASSIFY_AWAITING_DESCRIPTION: 'RECLASSIFY_AWAITING_DESCRIPTION', // Espera descripción
    RECLASSIFY_COMPLETE: 'RECLASSIFY_COMPLETE', // Datos completos, listos para procesar/guardar
};

let db: any; // Variable global para la conexión a la DB
let ConversationStates: any; // Variable global para la entidad ConversationStates

export async function getDbConnection() {
    if (!db) {
        db = await cds.connect.to('db');
        ConversationStates = cds.entities('sap.asientos').ConversationStates;
    }
    return db;
}

export async function loadConversationState(userId: string): Promise<any> {
    const db = await getDbConnection();
    const state = await db.run(SELECT.from(ConversationStates).where({ userId }));
    if (state.length > 0) {
        return {
            userId: state[0].userId,
            currentStep: state[0].currentStep,
            contextData: JSON.parse(state[0].contextData || '{}')
        };
    }
    // Si no hay estado para este usuario, inicializamos uno nuevo
    return { userId, currentStep: CONVERSATION_STEPS.INITIAL, contextData: {} };
}

export async function saveConversationState(userId: string, currentStep: string, contextData: any) {
    const db = await getDbConnection();
    const existingState = await db.run(SELECT.from(ConversationStates).where({ userId }));

    if (existingState.length > 0) {
        // Actualiza el estado existente
        await db.run(UPDATE(ConversationStates).set({
            currentStep: currentStep,
            contextData: JSON.stringify(contextData)
        }).where({ userId }));
    } else {
        // Inserta un nuevo estado
        await db.run(INSERT.into(ConversationStates).entries({
            userId: userId,
            currentStep: currentStep,
            contextData: JSON.stringify(contextData)
        }));
    }
}

export async function clearConversationState(userId: string) {
    const db = await getDbConnection();
    await db.run(DELETE.from(ConversationStates).where({ userId }));
}
