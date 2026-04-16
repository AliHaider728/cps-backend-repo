import { createModel } from "../lib/model.js";

const Federation = createModel({
  modelName: "Federation",
  refs: {
    icb: { model: "ICB" },
  },
  defaults: {
    name: "",
    type: "",
    icb: null,
    notes: "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export default Federation;
