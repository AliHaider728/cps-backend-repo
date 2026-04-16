import bcrypt from "bcryptjs";
import { query } from "../config/db.js";
import { createId, normalizeId } from "./ids.js";

const modelRegistry = new Map();

function clone(value) {
  if (value == null) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = clone(child);
    }
    return next;
  }
  return value;
}

function stripInternalFields(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const next = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("__")) continue;
    next[key] = value;
  }
  return next;
}

function getNested(source, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc == null ? undefined : acc[part]), source);
}

function setNested(target, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (keys.length === 0) return;
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (cursor[key] == null || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

function deleteNestedValue(target, path, matcher) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (keys.length === 0) return;
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    cursor = cursor?.[keys[i]];
    if (cursor == null) return;
  }
  const key = keys[keys.length - 1];
  if (!Array.isArray(cursor?.[key])) return;
  cursor[key] = cursor[key].filter((item) => !matcher(item));
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function normalizeDateLike(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDateLike);
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = normalizeDateLike(child);
    }
    return next;
  }
  return value;
}

function applyUpdateOperators(record, update) {
  const next = clone(record);
  const operators = ["$set", "$push", "$pull"];
  const hasOperator = Object.keys(update || {}).some((key) => operators.includes(key));

  if (!hasOperator) {
    return deepMerge(next, clone(update || {}));
  }

  if (update.$set) {
    for (const [path, value] of Object.entries(update.$set)) {
      setNested(next, path, clone(value));
    }
  }

  if (update.$push) {
    for (const [path, value] of Object.entries(update.$push)) {
      const current = getNested(next, path);
      const nextArray = Array.isArray(current) ? [...current] : [];
      nextArray.push(clone(value));
      setNested(next, path, nextArray);
    }
  }

  if (update.$pull) {
    for (const [path, value] of Object.entries(update.$pull)) {
      deleteNestedValue(next, path, (item) => JSON.stringify(item) === JSON.stringify(value));
    }
  }

  return next;
}

function matchesCondition(actual, expected) {
  if (expected instanceof RegExp) {
    return expected.test(String(actual || ""));
  }

  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("$regex" in expected) {
      const regex = new RegExp(expected.$regex, expected.$options || "");
      return regex.test(String(actual || ""));
    }
    if ("$ne" in expected) {
      return actual !== expected.$ne;
    }
  }

  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.some((item) => String(item) === String(expected));
  }

  if (Array.isArray(expected)) {
    return expected.some((item) => String(item) === String(actual));
  }

  return String(actual) === String(expected);
}

function matchesFilter(record, filter = {}) {
  if (!filter || Object.keys(filter).length === 0) return true;

  if (Array.isArray(filter.$or) && filter.$or.length > 0) {
    const { $or, ...rest } = filter;
    return matchesFilter(record, rest) && $or.some((item) => matchesFilter(record, item));
  }

  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return true;
    const actual = getNested(record, key);
    return matchesCondition(actual, expected);
  });
}

function applySort(records, sortSpec = {}) {
  const entries = Object.entries(sortSpec || {});
  if (entries.length === 0) return records;
  return [...records].sort((left, right) => {
    for (const [field, direction] of entries) {
      const a = getNested(left, field);
      const b = getNested(right, field);
      if (a == null && b == null) continue;
      if (a == null) return direction < 0 ? 1 : -1;
      if (b == null) return direction < 0 ? -1 : 1;
      if (a > b) return direction < 0 ? -1 : 1;
      if (a < b) return direction < 0 ? 1 : -1;
    }
    return 0;
  });
}

function parseSelect(select) {
  const tokens = String(select || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const include = new Set();
  const forceInclude = new Set();
  for (const token of tokens) {
    if (token.startsWith("+")) forceInclude.add(token.slice(1));
    else if (!token.startsWith("-")) include.add(token);
  }

  return { include, forceInclude };
}

function applySelect(record, select, hiddenFields = []) {
  if (!select) {
    const next = clone(record);
    for (const hidden of hiddenFields) delete next[hidden];
    return next;
  }

  const { include, forceInclude } = parseSelect(select);
  if (include.size === 0 && forceInclude.size > 0) {
    const next = clone(record);
    for (const hidden of hiddenFields) {
      if (!forceInclude.has(hidden)) delete next[hidden];
    }
    return next;
  }

  const picked = { _id: record._id };
  for (const field of include) {
    const value = getNested(record, field);
    if (value !== undefined) setNested(picked, field, clone(value));
  }
  for (const field of forceInclude) {
    const value = getNested(record, field);
    if (value !== undefined) setNested(picked, field, clone(value));
  }
  return picked;
}

async function fetchModelRows(modelName) {
  const result = await query(
    "SELECT id, data, created_at, updated_at FROM app_records WHERE model = $1",
    [modelName]
  );

  return result.rows.map((row) => ({
    _id: row.id,
    ...(row.data || {}),
    _idMeta: row.id,
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || row.updated_at,
  }));
}

async function fetchModelRecord(modelName, id) {
  const result = await query(
    "SELECT id, data, created_at, updated_at FROM app_records WHERE model = $1 AND id = $2 LIMIT 1",
    [modelName, id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    _id: row.id,
    ...(row.data || {}),
    _idMeta: row.id,
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || row.updated_at,
  };
}

async function persistModelRecord(modelName, record) {
  const normalized = normalizeDateLike({
    ...stripInternalFields(clone(record)),
    _id: normalizeId(record._id) || createId(),
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const { _id, ...data } = normalized;
  await query(
    `
      INSERT INTO app_records (model, id, data, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, COALESCE(($3::jsonb->>'createdAt')::timestamptz, NOW()), NOW())
      ON CONFLICT (model, id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `,
    [modelName, _id, JSON.stringify(data)]
  );

  return normalized;
}

async function deleteModelRecord(modelName, id) {
  await query("DELETE FROM app_records WHERE model = $1 AND id = $2", [modelName, id]);
}

class BaseDocument {
  constructor(model, data, options = {}) {
    this.__model = model;
    this.__select = options.select || null;
    Object.assign(this, clone(data));
  }

  async save() {
    if (typeof this.__model.beforeSave === "function") {
      await this.__model.beforeSave(this);
    }
    const saved = await persistModelRecord(this.__model.modelName, this);
    Object.assign(this, saved);
    return this;
  }

  async populate(pathOrSpec, select, nestedPopulate) {
    const plain = stripInternalFields(clone(this));
    const populated = await this.__model.populateRecord(
      plain,
      normalizePopulateArg(pathOrSpec, select, nestedPopulate)
    );
    Object.assign(this, populated);
    return this;
  }

  toJSON() {
    return applySelect(stripInternalFields(clone(this)), this.__select, this.__model.hiddenFields);
  }
}

function normalizePopulateArg(pathOrSpec, select, nestedPopulate) {
  if (typeof pathOrSpec === "string") {
    return { path: pathOrSpec, select, populate: nestedPopulate };
  }
  return pathOrSpec;
}

class QueryBuilder {
  constructor(model, resolver, { single = false } = {}) {
    this.model = model;
    this.resolver = resolver;
    this.single = single;
    this.populateSpecs = [];
    this.sortSpec = null;
    this.selectSpec = null;
    this.limitValue = null;
    this.skipValue = 0;
    this.returnLean = false;
  }

  populate(pathOrSpec, select, nestedPopulate) {
    this.populateSpecs.push(normalizePopulateArg(pathOrSpec, select, nestedPopulate));
    return this;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  select(spec) {
    this.selectSpec = spec;
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  skip(value) {
    this.skipValue = value;
    return this;
  }

  lean() {
    this.returnLean = true;
    return this;
  }

  async exec() {
    let result = await this.resolver();
    const isArray = Array.isArray(result);
    const list = isArray ? result : (result ? [result] : []);

    let next = list.map((item) => clone(item));

    if (this.sortSpec) next = applySort(next, this.sortSpec);
    if (this.skipValue) next = next.slice(this.skipValue);
    if (this.limitValue != null) next = next.slice(0, this.limitValue);

    for (const spec of this.populateSpecs) {
      next = await Promise.all(next.map((item) => this.model.populateRecord(item, spec)));
    }

    if (this.returnLean) {
      const mapped = next.map((item) => applySelect(item, this.selectSpec, this.model.hiddenFields));
      return this.single ? (mapped[0] || null) : mapped;
    }

    const mapped = next.map((item) => new this.model.DocumentClass(this.model, applySelect(item, this.selectSpec, this.model.hiddenFields), {
      select: this.selectSpec,
    }));
    return this.single ? (mapped[0] || null) : mapped;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(handler) {
    return this.exec().finally(handler);
  }
}

export function createModel(config) {
  class ModelDocument extends BaseDocument {}

  class Model {
    static modelName = config.modelName;
    static hiddenFields = config.hiddenFields || [];
    static defaults = config.defaults || {};
    static refs = config.refs || {};
    static beforeSave = config.beforeSave;
    static DocumentClass = ModelDocument;

    static async instantiate(record) {
      if (!record) return null;
      return new this.DocumentClass(this, record);
    }

    static applyDefaults(payload = {}) {
      return deepMerge(clone(this.defaults), clone(payload));
    }

    static async create(payload = {}) {
      const record = this.applyDefaults(payload);
      record._id = normalizeId(record._id) || createId();
      record.createdAt = record.createdAt || new Date().toISOString();
      record.updatedAt = new Date().toISOString();
      const document = new this.DocumentClass(this, record);
      await document.save();
      return document;
    }

    static find(filter = {}) {
      return new QueryBuilder(this, async () => {
        const rows = await fetchModelRows(this.modelName);
        return rows.filter((row) => matchesFilter(row, filter));
      });
    }

    static findOne(filter = {}) {
      return new QueryBuilder(this, async () => {
        const rows = await fetchModelRows(this.modelName);
        return rows.find((row) => matchesFilter(row, filter)) || null;
      }, { single: true });
    }

    static findById(id) {
      return new QueryBuilder(this, async () => {
        const normalizedId = normalizeId(id);
        if (!normalizedId) return null;
        return fetchModelRecord(this.modelName, normalizedId);
      }, { single: true });
    }

    static async countDocuments(filter = {}) {
      const rows = await fetchModelRows(this.modelName);
      return rows.filter((row) => matchesFilter(row, filter)).length;
    }

    static async findByIdAndDelete(id) {
      const existing = await fetchModelRecord(this.modelName, normalizeId(id));
      if (!existing) return null;
      await deleteModelRecord(this.modelName, existing._id);
      return new this.DocumentClass(this, applySelect(existing, null, this.hiddenFields));
    }

    static findByIdAndUpdate(id, update = {}, options = {}) {
      return new QueryBuilder(this, async () => {
        const existing = await fetchModelRecord(this.modelName, normalizeId(id));
        if (!existing) return null;
        const next = applyUpdateOperators(existing, update);
        next._id = existing._id;
        next.createdAt = existing.createdAt || next.createdAt;
        next.updatedAt = new Date().toISOString();
        if (typeof this.beforeSave === "function") {
          const draft = new this.DocumentClass(this, next);
          await this.beforeSave(draft);
          Object.assign(next, clone(draft));
        }
        const saved = await persistModelRecord(this.modelName, next);
        return options.new === false ? existing : saved;
      }, { single: true });
    }

    static async findOneAndUpdate(filter = {}, update = {}, options = {}) {
      const rows = await fetchModelRows(this.modelName);
      const existing = rows.find((row) => matchesFilter(row, filter));

      if (!existing) {
        if (!options.upsert) return null;
        const created = this.applyDefaults({
          ...filter,
          ...(update.$set || update),
        });
        const document = await this.create(created);
        return options.new === false ? null : document;
      }

      const next = applyUpdateOperators(existing, update);
      next._id = existing._id;
      next.createdAt = existing.createdAt || next.createdAt;
      const saved = await persistModelRecord(this.modelName, next);
      return new this.DocumentClass(this, options.new === false ? existing : saved);
    }

    static async updateMany(filter = {}, update = {}) {
      const rows = await fetchModelRows(this.modelName);
      let count = 0;
      for (const row of rows) {
        if (!matchesFilter(row, filter)) continue;
        count += 1;
        const next = applyUpdateOperators(row, update);
        next._id = row._id;
        next.createdAt = row.createdAt || next.createdAt;
        await persistModelRecord(this.modelName, next);
      }
      return { modifiedCount: count };
    }

    static async deleteMany(filter = {}) {
      const rows = await fetchModelRows(this.modelName);
      let count = 0;
      for (const row of rows) {
        if (!matchesFilter(row, filter)) continue;
        count += 1;
        await deleteModelRecord(this.modelName, row._id);
      }
      return { deletedCount: count };
    }

    static async aggregate(pipeline = []) {
      let rows = await fetchModelRows(this.modelName);
      for (const stage of pipeline) {
        if (stage.$group) {
          const field = String(stage.$group._id || "").replace(/^\$/, "");
          const grouped = new Map();
          for (const row of rows) {
            const key = getNested(row, field);
            grouped.set(key, (grouped.get(key) || 0) + 1);
          }
          rows = Array.from(grouped.entries()).map(([key, count]) => ({ _id: key, count }));
        } else if (stage.$sort) {
          rows = applySort(rows, stage.$sort);
        }
      }
      return rows;
    }

    static async populateRecord(record, spec) {
      if (!record || !spec?.path) return record;
      const next = clone(record);
      const ref = this.refs[spec.path];
      if (!ref) return next;

      const targetModel = modelRegistry.get(ref.model);
      if (!targetModel) return next;

      const current = getNested(next, spec.path);
      if (current == null) return next;

      const populateOne = async (value) => {
        const id = typeof value === "object" && value !== null ? value._id : value;
        if (!id) return null;
        let populated = await targetModel.findById(id).lean();
        if (!populated) return null;
        if (spec.select) {
          populated = applySelect(populated, spec.select, targetModel.hiddenFields);
        }
        if (spec.populate) {
          populated = await targetModel.populateRecord(populated, spec.populate);
        }
        return populated;
      };

      if (Array.isArray(current)) {
        const populated = (await Promise.all(current.map(populateOne))).filter(Boolean);
        setNested(next, spec.path, populated);
      } else {
        const populated = await populateOne(current);
        setNested(next, spec.path, populated);
      }

      return next;
    }
  }

  if (config.documentMethods) {
    Object.assign(ModelDocument.prototype, config.documentMethods);
  }

  modelRegistry.set(config.modelName, Model);
  return Model;
}

export async function hashPasswordIfNeeded(document) {
  if (!document.password) return;
  if (String(document.password).startsWith("$2")) return;
  document.password = await bcrypt.hash(String(document.password), 10);
}
