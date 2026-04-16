import { createModel } from "../lib/model.js";

const ICB = createModel({
  modelName: "ICB",
  defaults: {
    name: "",
    code: "",
    region: "",
    notes: "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export default ICB;
