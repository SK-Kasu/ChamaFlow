const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let scenario;
const pool = {
  async query(sql) {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    scenario.statements.push(normalizedSql);
    if (normalizedSql.startsWith('SELECT g.id FROM chama_groups')) {
      return { rows: scenario.groupExists ? [{ id: 1 }] : [] };
    }
    if (normalizedSql.startsWith('SELECT 1 FROM members WHERE group_id = $1 AND user_id = $2')) {
      return { rows: scenario.applicantAlreadyMember ? [{ '?column?': 1 }] : [] };
    }
    if (normalizedSql.startsWith('INSERT INTO group_join_requests')) {
      return { rows: scenario.insertedRequest ? [scenario.insertedRequest] : [] };
    }
    if (normalizedSql.startsWith('SELECT id, status, effective_cycle AS "effectiveCycle"')) {
      return { rows: [{ id: 9, status: 'pending', effectiveCycle: null }] };
    }
    throw new Error(`Unexpected pool query: ${normalizedSql}`);
  },
  async connect() {
    return {
      async query(sql) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        scenario.statements.push(normalizedSql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalizedSql)) return { rows: [] };
        if (normalizedSql.startsWith('SELECT g.id, g.cycle_number AS')) {
          return {
            rows: [{
              id: 1,
              cycleNumber: scenario.cycleNumber,
              status: 'active',
              saccoId: null,
              saccoStatus: null,
            }],
          };
        }
        if (normalizedSql.startsWith('SELECT id, name, role, user_id AS "userId" FROM members')) {
          return {
            rows: [{
              id: 3,
              name: 'Group chairperson',
              role: scenario.reviewerRole,
              userId: 5,
            }],
          };
        }
        if (normalizedSql.startsWith('SELECT r.id, r.user_id AS "userId"')) {
          return {
            rows: [{
              id: 9,
              userId: 22,
              status: 'pending',
              applicantEmail: 'applicant@example.test',
            }],
          };
        }
        if (normalizedSql.startsWith('SELECT id, user_id AS "userId", contact_email AS "contactEmail"')) {
          return {
            rows: [{
              id: 14,
              userId: null,
              contactEmail: 'applicant@example.test',
              role: 'Member',
            }],
          };
        }
        if (normalizedSql.startsWith('SELECT EXISTS')) {
          return { rows: [{ started: scenario.groupHasActivity }] };
        }
        if (
          normalizedSql.startsWith('UPDATE group_join_requests')
          || normalizedSql.startsWith('INSERT INTO administration_audit')
        ) return { rows: [] };
        throw new Error(`Unexpected client query: ${normalizedSql}`);
      },
      release() {},
    };
  },
};

const poolPath = require.resolve('./pool');
const authMiddlewarePath = require.resolve('./auth-middleware');
const adminAccessPath = require.resolve('./admin-access');
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: { pool },
};
require.cache[authMiddlewarePath] = {
  id: authMiddlewarePath,
  filename: authMiddlewarePath,
  loaded: true,
  exports: {
    requireAuth(req, res, next) {
      req.user = { id: 5, email: 'chairperson@example.test' };
      next();
    },
  },
};
require.cache[adminAccessPath] = {
  id: adminAccessPath,
  filename: adminAccessPath,
  loaded: true,
  exports: {
    getSaccoIds: async () => [],
    isPlatformAdmin: () => false,
    requireActiveSacco(req, res, next) {
      next();
    },
  },
};

const groupRoutes = require('./group-routes');

async function request(method, path, body, currentScenario) {
  scenario = { statements: [], ...currentScenario };
  const app = express();
  app.use(express.json(), groupRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, payload: await response.json(), statements: scenario.statements };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('a verified account can request membership in a public active group', async () => {
  const { response, payload, statements } = await request(
    'POST',
    '/1/join-requests',
    { message: 'I am already on the roster.' },
    {
      groupExists: true,
      applicantAlreadyMember: false,
      insertedRequest: { id: 9, groupId: 1, status: 'pending', requestedAt: '2026-03-01T00:00:00.000Z' },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(payload.request.status, 'pending');
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO group_join_requests')));
});

test('an account already linked to the group cannot submit another request', async () => {
  const { response, payload, statements } = await request(
    'POST',
    '/1/join-requests',
    {},
    { groupExists: true, applicantAlreadyMember: true, insertedRequest: null },
  );

  assert.equal(response.status, 409);
  assert.match(payload.error, /already linked/);
  assert.ok(!statements.some((sql) => sql.startsWith('INSERT INTO group_join_requests')));
});

test('only the group administrator can approve an applicant', async () => {
  const { response, payload, statements } = await request(
    'PATCH',
    '/1/join-requests/9',
    { decision: 'approve', memberId: 14 },
    { cycleNumber: 3, reviewerRole: 'Member', groupHasActivity: true },
  );

  assert.equal(response.status, 404);
  assert.match(payload.error, /not found/);
  assert.ok(!statements.some((sql) => sql.startsWith('UPDATE group_join_requests')));
});

test('approvals after group activity reserve the roster link for the next cycle', async () => {
  const { response, payload, statements } = await request(
    'PATCH',
    '/1/join-requests/9',
    { decision: 'approve', memberId: 14 },
    { cycleNumber: 3, reviewerRole: 'Administrator', groupHasActivity: true },
  );

  assert.equal(response.status, 200);
  assert.equal(payload.request.effectiveCycle, 4);
  assert.ok(statements.some((sql) => sql.includes('SET status = \'approved\'')));
  assert.ok(!statements.some((sql) => sql.startsWith('UPDATE members SET user_id')));
});
