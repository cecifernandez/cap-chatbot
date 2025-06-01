using { cuid } from '@sap/cds/common';
namespace sap.asientos;

entity Asientos {
  key ID : UUID;
  cuenta : String;
  monto  : Decimal(15,2);
  ceCo   : String;
  fecha  : Date;
  descripcion : String;
}

entity ReclasificacionEntries : cuid { 
  originalAccount  : String;
  originalCeCo     : String;
  targetCeCo       : String;
  amount           : Decimal;
  description      : String;
  status              : String; // Ej: 'COMPLETED', 'PENDING_REVIEW', 'FAILED'
  createdAt           : Timestamp @cds.on.insert : $now; 
}

entity ConversationStates : cuid {
  userId        : String @unique; 
  currentStep   : String; 
  contextData   : String; 
  updatedAt     : Timestamp @cds.on.insert : $now @cds.on.update : $now; 
}