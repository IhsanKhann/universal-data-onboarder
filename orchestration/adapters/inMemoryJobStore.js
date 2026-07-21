/**
 * InMemoryJobStore — a JobStore implementation backed by plain JavaScript Maps.
 *
 * ALL data lives in process memory and is LOST on restart. This adapter is
 * intended ONLY for:
 *   - The testbed (universal-data-onboarder-testbed)
 *   - Contract tests (core/__contract-tests__/JobStore.contract.test.js)
 *   - Development environments where setting up MongoDB is undesirable
 *
 * DO NOT use in production. Every write is O(1) amortised but there is no
 * persistence, no indexing, and no replica-set transaction support.
 *
 * Interface: see orchestration/jobStore.js for the full contract.
 */

export function createInMemoryJobStore() {
  // In-memory stores: Map<importJobId, object>
  const jobs = new Map();
  const stagedRecords = new Map(); // Map<importJobId, Array<object>>
  const mappingProfiles = new Map();
  const sessions = new Map();
  let sequence = 0n;

  function nextId() {
    sequence += 1n;
    return `mem-${sequence}`;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  return {
    // ── Job CRUD ──────────────────────────────────────────────────────────

    async getJob(tenantId, importJobId, _conn) {
      const key = `${tenantId}:${importJobId}`;
      const job = jobs.get(key);
      if (!job) {
        const err = new Error("Import job not found");
        err.statusCode = 404;
        throw err;
      }
      return clone(job);
    },

    async updateJob(tenantId, importJobId, updates, _conn) {
      const key = `${tenantId}:${importJobId}`;
      const job = jobs.get(key);
      if (!job) throw Object.assign(new Error("Import job not found"), { statusCode: 404 });
      Object.assign(job, updates);
      return clone(job);
    },

    async saveJob(job) {
      const key = `${job.tenantId}:${String(job._id ?? job.id)}`;
      jobs.set(key, job);
      return job;
    },

    // ── Staged Record CRUD ────────────────────────────────────────────────

    async insertRows(tenantId, importJobId, records, _conn) {
      if (!records.length) return 0;
      const key = `${tenantId}:${importJobId}`;
      if (!stagedRecords.has(key)) stagedRecords.set(key, []);
      const list = stagedRecords.get(key);
      records.forEach((row, index) => {
        list.push({
          _id: nextId(),
          tenantId,
          importJobId,
          rowIndex: list.length,
          rawRow: row,
          customFields: { ...row },
          mappedFields: null,
          validationStatus: null,
          validationErrors: [],
          commitStatus: "pending",
        });
      });
      return records.length;
    },

    async findOneStaged(filter, _conn) {
      for (const [, list] of stagedRecords) {
        const match = list.find((r) => {
          for (const [k, v] of Object.entries(filter)) {
            if (r[k]?.toString() !== v?.toString()) return false;
          }
          return true;
        });
        if (match) return clone(match);
      }
      return null;
    },

    async saveRow(record) {
      // Find and update in-place
      for (const [, list] of stagedRecords) {
        const idx = list.findIndex((r) => r._id === record._id);
        if (idx !== -1) {
          list[idx] = record;
          return record;
        }
      }
      return record;
    },

    // ── Batch / Advanced ───────────────────────────────────────────────────

    async bulkWriteStaged(_conn, ops) {
      for (const op of ops) {
        if (op.updateOne) {
          const { filter, update } = op.updateOne;
          // Apply $set updates to matching records
          for (const [, list] of stagedRecords) {
            for (const record of list) {
              let matches = true;
              for (const [k, v] of Object.entries(filter)) {
                if (record[k]?.toString() !== v?.toString()) { matches = false; break; }
              }
              if (matches && update.$set) {
                Object.assign(record, update.$set);
              }
            }
          }
        }
      }
      return { ok: 1, nInserted: 0, nUpserted: 0, nModified: ops.length };
    },

    async aggregateStaged(_conn, pipeline) {
      // Run a simplified aggregation. Supports $match, $group, $sort, $limit.
      let records = [];
      for (const [, list] of stagedRecords) {
        records.push(...list.map(clone));
      }

      for (const stage of pipeline) {
        if (stage.$match) {
          records = records.filter((r) => {
            for (const [k, v] of Object.entries(stage.$match)) {
              if (r[k]?.toString() !== v?.toString()) return false;
            }
            return true;
          });
        }
        if (stage.$group) {
          const groups = new Map();
          for (const r of records) {
            const key = typeof stage.$group._id === "string"
              ? r[stage.$group._id.replace(/^\$/, "")]
              : JSON.stringify(r);
            if (!groups.has(key)) {
              groups.set(key, { _id: key, count: 0 });
            }
            groups.get(key).count += 1;
          }
          records = Array.from(groups.values());
        }
        if (stage.$sort) {
          const key = Object.keys(stage.$sort)[0];
          records.sort((a, b) => {
            return (a[key] < b[key] ? -1 : 1) * stage.$sort[key];
          });
        }
        if (stage.$limit) {
          records = records.slice(0, stage.$limit);
        }
      }
      return records;
    },

    async distinctStaged(_conn, field, filter) {
      const values = new Set();
      for (const [, list] of stagedRecords) {
        for (const record of list) {
          let matches = true;
          for (const [k, v] of Object.entries(filter)) {
            if (record[k]?.toString() !== v?.toString()) { matches = false; break; }
          }
          if (matches) {
            const path = field.replace(/^mappedFields\./, "");
            const val = record.mappedFields?.[path] ?? record[path];
            if (val != null) values.add(val);
          }
        }
      }
      return Array.from(values);
    },

    cursorStaged(_conn, filter, { sort, limit } = {}) {
      let records = [];
      for (const [, list] of stagedRecords) {
        records.push(...list.map(clone));
      }

      // Apply filter
      if (filter) {
        records = records.filter((r) => {
          for (const [k, v] of Object.entries(filter)) {
            // Handle $in operator
            if (v && typeof v === "object" && v.$in) {
              if (!v.$in.includes(r[k])) return false;
            } else if (r[k]?.toString() !== v?.toString()) {
              return false;
            }
          }
          return true;
        });
      }

      // Apply sort
      if (sort) {
        const key = Object.keys(sort)[0];
        records.sort((a, b) => {
          const aVal = a[key], bVal = b[key];
          if (aVal < bVal) return -1 * sort[key];
          if (aVal > bVal) return 1 * sort[key];
          return 0;
        });
      }

      if (limit) records = records.slice(0, limit);

      // Return an async iterable (simulating a MongoDB cursor)
      let idx = 0;
      return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (idx >= records.length) return { done: true, value: undefined };
          return { done: false, value: records[idx++] };
        },
      };
    },

    async updateOneStaged(filter, update, _conn, _options = {}) {
      for (const [, list] of stagedRecords) {
        for (const record of list) {
          let matches = true;
          for (const [k, v] of Object.entries(filter)) {
            if (record[k]?.toString() !== v?.toString()) { matches = false; break; }
          }
          if (matches && update.$set) {
            Object.assign(record, update.$set);
          }
        }
      }
      return { modifiedCount: 1 };
    },

    async updateJobModel(_conn, filter, updates, _options = {}) {
      for (const [, job] of jobs) {
        let matches = true;
        for (const [k, v] of Object.entries(filter)) {
          if (job[k]?.toString() !== v?.toString()) { matches = false; break; }
        }
        if (matches) {
          Object.assign(job, updates);
          return clone(job);
        }
      }
      return null;
    },

    // ── Mapping Profiles ──────────────────────────────────────────────────

    async listMappingProfiles(tenantId, filter = {}, _conn) {
      const results = [];
      for (const [, profile] of mappingProfiles) {
        if (profile.tenantId.toString() !== tenantId.toString()) continue;
        if (filter.module && profile.module !== filter.module) continue;
        if (filter.entityKey && profile.entityKey !== filter.entityKey) continue;
        results.push(clone(profile));
      }
      return results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    async upsertMappingProfile(tenantId, moduleName, entityKey, fieldMap, profileLabel, createdBy, _conn) {
      const id = `${tenantId}:${moduleName}:${entityKey}:${profileLabel?.trim() || "default"}`;
      const existing = mappingProfiles.get(id);
      const profile = {
        _id: id,
        tenantId,
        module: moduleName,
        entityKey,
        fieldMap,
        label: profileLabel?.trim() || "default",
        createdBy,
        updatedAt: new Date(),
      };
      mappingProfiles.set(id, profile);
      return clone(profile);
    },

    // ── Sample Errors ──────────────────────────────────────────────────────

    async findSampleErrors(tenantId, importJobId, limit = 10, _conn) {
      const key = `${tenantId}:${importJobId}`;
      const list = stagedRecords.get(key) || [];
      return list
        .filter((r) => r.validationStatus === "invalid")
        .slice(0, limit)
        .map((r) => ({ rowIndex: r.rowIndex, validationErrors: r.validationErrors }));
    },

    // ── Sessions ──────────────────────────────────────────────────────────

    async getSession(tenantId, sessionId, _conn) {
      const key = `${tenantId}:${sessionId}`;
      const session = sessions.get(key);
      if (!session) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
      return clone(session);
    },

    // ── Test-only: reset all state ────────────────────────────────────────

    _reset() {
      jobs.clear();
      stagedRecords.clear();
      mappingProfiles.clear();
      sessions.clear();
      sequence = 0n;
    },
  };
}
