// services/shared/dependencyGraph.js
// Migration Wizard — Stage E1 (MIGRATION_WIZARD_TIERED_EXTENSION_MASTER_PLAN
// 2026-07-16.md §3). Pure topological-sort utility for computing the execution
// order of migration session jobs from a dependency graph.
//
// Dependencies are declared per entity key in the target descriptors — e.g.
// "employee" depends on ["orgunit", "role", "branch"]. The graph is a Directed
// Acyclic Graph (DAG) — cycles are rejected with a clear error.
//
// Pure functions, no I/O, no dependencies beyond standard library.

/**
 * Validate that a dependency graph has no cycles.
 *
 * Uses Kahn's algorithm: if every vertex can be removed via its indegree
 * being reduced to zero, the graph is acyclic. Returns true if valid.
 *
 * @param {Map<string, Set<string>>} graph — vertex → outgoing edges
 * @returns {boolean}
 */
export function isAcyclic(graph) {
  // Build indegree map: count incoming edges per vertex.
  const indegree = new Map();
  for (const vertex of graph.keys()) {
    if (!indegree.has(vertex)) indegree.set(vertex, 0);
    for (const dep of graph.get(vertex) ?? []) {
      if (!indegree.has(dep)) indegree.set(dep, 0);
      indegree.set(dep, (indegree.get(dep) ?? 0) + 1);
    }
  }

  const queue = [];
  for (const [vertex, deg] of indegree) {
    if (deg === 0) queue.push(vertex);
  }

  let visited = 0;
  while (queue.length > 0) {
    const vertex = queue.shift();
    visited += 1;
    for (const dep of graph.get(vertex) ?? []) {
      const newDeg = (indegree.get(dep) ?? 1) - 1;
      indegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  return visited === indegree.size;
}

/**
 * Topologically sort the dependency graph using Kahn's algorithm.
 *
 * Given a map of vertex → [dependencies], returns an array in execution
 * order (dependencies first). Throws if the graph has a cycle.
 *
 * @param {Object<string, string[]>} dependenciesByEntity
 *   e.g. { "employee": ["orgunit", "role", "branch"], "orgunit": [] }
 * @returns {string[]} entities in topological order
 * @throws {Error} with statusCode 400 if a cycle is detected
 */
export function topologicalSort(dependenciesByEntity) {
  // Build the graph where an edge dep → entity means "dep must come before
  // entity in execution order" (the dependency direction).
  // e.g. employee: ["orgunit", "role"] → edges orgunit→employee, role→employee.
  const graph = new Map();
  for (const [entity, deps] of Object.entries(dependenciesByEntity)) {
    if (!graph.has(entity)) graph.set(entity, new Set());
    for (const dep of deps) {
      if (!graph.has(dep)) graph.set(dep, new Set());
      // dep must come before entity
      graph.get(dep).add(entity);
    }
  }

  // Check for cycles first
  if (!isAcyclic(graph)) {
    throw Object.assign(
      new Error(
        `Circular dependency detected in migration session graph: ` +
        `entities ${JSON.stringify([...graph.keys()])}. ` +
        `Every entity's dependencies must form a DAG.`
      ),
      { statusCode: 400 }
    );
  }

  // Kahn's algorithm: indegree = how many dependencies this entity still
  // needs before it's ready to execute. Entities with indegree 0 have no
  // unresolved dependencies and go first.
  const indegree = new Map();
  for (const vertex of graph.keys()) {
    if (!indegree.has(vertex)) indegree.set(vertex, 0);
    for (const depender of graph.get(vertex) ?? []) {
      if (!indegree.has(depender)) indegree.set(depender, 0);
      indegree.set(depender, (indegree.get(depender) ?? 0) + 1);
    }
  }

  const queue = [];
  for (const [vertex, deg] of indegree) {
    if (deg === 0) queue.push(vertex);
  }

  const sorted = [];
  while (queue.length > 0) {
    const vertex = queue.shift();
    sorted.push(vertex);

    // Decrease indegree of every entity that depends on this vertex
    for (const depender of graph.get(vertex) ?? []) {
      const newDeg = (indegree.get(depender) ?? 1) - 1;
      indegree.set(depender, newDeg);
      if (newDeg === 0) queue.push(depender);
    }
  }

  // If not all vertices were visited, there's a cycle (should be caught above
  // by the isAcyclic check, but guard defensively).
  if (sorted.length !== graph.size) {
    throw Object.assign(
      new Error(
        `Topological sort incomplete: ${graph.size - sorted.length} entity(ies) ` +
        `unresolved due to a circular dependency.`
      ),
      { statusCode: 400 }
    );
  }

  return sorted;
}

/**
 * Build an execution-order array from a session's job list and entity
 * dependency declarations.
 *
 * @param {Array<{importJobId: string, entityKey: string}>} jobs
 * @param {Object<string, string[]>} dependenciesByEntity
 *   entityKey -> [dependent entityKeys]
 * @returns {{ orderedIds: string[], orderedEntityKeys: string[] }}
 *   Jobs in execution order. Jobs whose entityKey has no dependency
 *   declaration are ordered last (no constraints).
 */
export function computeSessionExecutionOrder(jobs, dependenciesByEntity) {
  // Build the dependency graph from the entity keys present in this session
  const presentEntities = [...new Set(jobs.map((j) => j.entityKey))];
  const localDeps = {};
  for (const entity of presentEntities) {
    const declared = dependenciesByEntity[entity] ?? [];
    // Only include dependencies that are actually present in this session
    localDeps[entity] = declared.filter((d) => presentEntities.includes(d));
  }

  // Topological sort
  const orderedEntities = topologicalSort(localDeps);

  // Map entity order to job order. For entity keys that appear multiple times
  // (e.g. two party_seller jobs), preserve their relative input order within
  // the same entity group.
  const jobsByEntity = new Map();
  for (const job of jobs) {
    if (!jobsByEntity.has(job.entityKey)) jobsByEntity.set(job.entityKey, []);
    jobsByEntity.get(job.entityKey).push(job.importJobId);
  }

  // Build the final ordered id list
  const orderedIds = [];
  const orderedEntityKeys = [];
  const added = new Set();

  for (const entity of orderedEntities) {
    const entityJobs = jobsByEntity.get(entity) ?? [];
    for (const jobId of entityJobs) {
      if (!added.has(jobId)) {
        orderedIds.push(jobId);
        orderedEntityKeys.push(entity);
        added.add(jobId);
      }
    }
  }

  // Add any jobs whose entity key wasn't in the graph (no declared dependencies)
  for (const job of jobs) {
    if (!added.has(job.importJobId)) {
      orderedIds.push(job.importJobId);
      orderedEntityKeys.push(job.entityKey);
      added.add(job.importJobId);
    }
  }

  return { orderedIds, orderedEntityKeys };
}
