import cds from "@sap/cds";

export class AsientosRepository {
  private db: any;
  private Asientos: any;

  constructor() {}

  async init() {
    this.db = await cds.connect.to("db");
    this.Asientos = cds.entities("your.namespace").Asientos;
  }

  async getSome(limit = 3) {
    return this.db.run(cds.ql.SELECT.from(this.Asientos).limit(limit));
  }

  async updateReclasificacion(id: string, reclasificacion: string) {
    return this.db.run(
      UPDATE(this.Asientos).set({ reclasificacion }).where({ ID: id })
    );
  }
}
