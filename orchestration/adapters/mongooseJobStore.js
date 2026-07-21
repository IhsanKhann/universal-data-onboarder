/**
 * MongooseJobStore — the default (and reference) implementation of the
 * JobStore interface backed by Mongoose + the orchestration schemas.
 *
 * Lazy-initialises model getters on the connection object on first call so
 * that dynamic import paths are resolved only when the store is actually
 * used, not at module load time.
 *
 * Adheres to the JobStore interface contract defined in
 * ../jobStore.js — swapable via the JOB_STORE_ADAPTER env var.
 */

export function createMongooseJobStore() {
  /**
   * Lazy-init model getters, cached on the connection after first dynamic import.
   * The synchronous `.model()` variants read from this cache so cursor creation
   * and other synchronous patterns work without a dynamic import call site.
   */
  async function ensureModels(conn) {
    if (!conn.__stagedRecordModel) {
      const { getImportStagedRecordModel } = await import("./mongoose/schemas/ImportStagedRecord.model.js");
      conn.__stagedRecordModel = getImportStagedRecordModel(conn);
    }
    if (!conn.__jobModel) {
      const { getImportJobModel } = await import("./mongoose/schemas/ImportJob.model.js");
      conn.__jobModel = getImportJobModel(conn);
    }
    if (!conn.__mappingProfileModel) {
      const { getImportMappingProfileModel } = await import("./mongoose/schemas/ImportMappingProfile.model.js");
      conn.__mappingProfileModel = getImportMappingProfileModel(conn);
    }
  }

  return {
    // ── Job CRUD ──────────────────────────────────────────────────────────

    async getJob(tenantId, importJobId, conn) {
      await ensureModels(conn);
      const job = await conn.__jobModel.findOne({ _id: importJobId, tenantId });
      if (!job) {
        const err = new Error("Import job not found");
        err.statusCode = 404;
        throw err;
      }
      return job;
    },

    async updateJob(tenantId, importJobId, updates, conn) {
      await ensureModels(conn);
      return conn.__jobModel.findOneAndUpdate(
        { _id: importJobId, tenantId },
        { $set: updates },
        { new: true }
      );
    },

    async saveJob(job) {
      return job.save();
    },

    // ── Staged Record CRUD ────────────────────────────────────────────────

    async insertRows(tenantId, importJobId, records, conn) {
      if (!records.length) return 0;
      await ensureModels(conn);
      const docs = records.map((row, rowIndex) => ({
        tenantId, importJobId, rowIndex,
        rawRow: row, customFields: { ...row },
      }));
      await conn.__stagedRecordModel.insertMany(docs, { ordered: false });
      return docs.length;
    },

    async findOneStaged(filter, conn) {
      await ensureModels(conn);
      return conn.__stagedRecordModel.findOne(filter).lean();
    },

    async saveRow(record) {
      return record.save();
    },

    // ── Batch / Advanced Operations ───────────────────────────────────────

    async bulkWriteStaged(conn, ops) {
      await ensureModels(conn);
      return conn.__stagedRecordModel.bulkWrite(ops, { ordered: false });
    },

    async aggregateStaged(conn, pipeline) {
      await ensureModels(conn);
      return conn.__stagedRecordModel.aggregate(pipeline);
    },

    async distinctStaged(conn, field, filter) {
      await ensureModels(conn);
      return conn.__stagedRecordModel.distinct(field, filter);
    },

    cursorStaged(conn, filter, { sort, limit } = {}) {
      // Synchronous — ensureModels must have been called before this.
      if (!conn.__stagedRecordModel) {
        throw new Error("cursorStaged called before ensureModels — call getJob or another async method first");
      }
      let query = conn.__stagedRecordModel.find(filter);
      if (sort) query = query.sort(sort);
      if (limit) query = query.limit(limit);
      return query.cursor();
    },

    async updateOneStaged(filter, update, conn, options = {}) {
      await ensureModels(conn);
      const { session } = options;
      return session
        ? conn.__stagedRecordModel.updateOne(filter, update, { session })
        : conn.__stagedRecordModel.updateOne(filter, update);
    },

    async updateJobModel(conn, filter, updates, options = {}) {
      await ensureModels(conn);
      const { session } = options;
      const opts = { new: true };
      if (session) opts.session = session;
      return conn.__jobModel.findOneAndUpdate(filter, { $set: updates }, opts);
    },

    // ── Mapping Profiles ──────────────────────────────────────────────────

    async listMappingProfiles(tenantId, filter = {}, conn) {
      await ensureModels(conn);
      const query = { tenantId };
      if (filter.module) query.module = filter.module;
      if (filter.entityKey) query.entityKey = filter.entityKey;
      return conn.__mappingProfileModel.find(query).sort({ updatedAt: -1 });
    },

    async upsertMappingProfile(tenantId, moduleName, entityKey, fieldMap, profileLabel, createdBy, conn) {
      await ensureModels(conn);
      return conn.__mappingProfileModel.findOneAndUpdate(
        { tenantId, module: moduleName, entityKey, label: profileLabel?.trim() },
        { $set: { fieldMap, createdBy } },
        { upsert: true, new: true },
      );
    },

    // ── Sample Errors ──────────────────────────────────────────────────────

    async findSampleErrors(tenantId, importJobId, limit = 10, conn) {
      await ensureModels(conn);
      return conn.__stagedRecordModel.find({
        tenantId, importJobId, validationStatus: "invalid",
      })
        .select("rowIndex validationErrors")
        .sort({ rowIndex: 1 })
        .limit(limit)
        .lean();
    },

    // ── Sessions ──────────────────────────────────────────────────────────

    async getSession(tenantId, sessionId, conn) {
      await ensureModels(conn);
      if (!conn.__sessionModel) {
        const { getMigrationSessionModel } = await import("./mongoose/schemas/MigrationSession.model.js");
        conn.__sessionModel = getMigrationSessionModel(conn);
      }
      const session = await conn.__sessionModel.findOne({ _id: sessionId, tenantId }).lean();
      if (!session) {
        const err = new Error("Session not found");
        err.statusCode = 404;
        throw err;
      }
      return session;
    },
  };
}
