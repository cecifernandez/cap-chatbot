using {sap.asientos} from '../db/schema';

service AsientosService {
  entity Asientos               as projection on asientos.Asientos;
  entity ReclasificacionEntries as projection on asientos.ReclasificacionEntries;
}
