const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let scenario;
const pool = {
  async query() {
    throw new Error('Unexpected pool query.');
  },
  async connect() {
    return {
      async query(sql) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        scenario.statements.push(normalizedSql);
        if (normalizedSql === 'BEGIN' || normalizedSql === 'ROLLBACK') return { rows: [] };
        if (normalizedSql.includes('FROM members') && normalizedSql.includes('user_id = $2')) {
          return { rows: [{ id: 1, name: 'Group admin', role: 'Administrator', userId: 1 }] };
        }
        if (normalizedSql.includes('FROM chama_groups WHERE id = $1 FOR UPDATE')) {
          return { rows: [scenario.group] };
        }
        if (normalizedSql.includes('FROM payout_slots WHERE group_id = $1 AND status = \'paid\'')) {
          return { rows: [] };
        }
        if (normalizedSql.includes('COALESCE(MAX(position), 0)')) {
          return { rows: [{ position: scenario.position, member_count: scenario.memberCount }] };
        }
        if (normalizedSql.startsWith('INSERT INTO members')) {
          return {
            rows: [{
              id: 2,
              name: 'New member',
              role: 'Member',
              registrationNumber: null,
              phoneNumber: null,
              location: null,
            }],
          };
        }
        if (
          normalizedSql.startsWith('INSERT INTO payout_slots')
          || normalizedSql.startsWith('INSERT INTO contributions')
          || normalizedSql.startsWith('UPDATE payout_slots')
          || normalizedSql.startsWith('INSERT INTO activity')
          || normalizedSql === 'COMMIT'
        ) return { rows: [] };
        throw new Error(`Unexpected client query: ${normalizedSql}`);
      },
      release() {},
    };
  },
};

require.cache[require.resolve('./pool')] = {
  id: require.resolve('./pool'),
  filename: require.resolve('./pool'),
  loaded: true,
  exports: { pool },
};
require.cache[require.resolve('./auth-middleware')] = {
  id: require.resolve('./auth-middleware'),
  filename: require.resolve('./auth-middleware'),
  loaded: true,
  exports: {
    requireAuth(req, res, next) {
      req.user = { id: 1, email: 'admin@example.com' };
      next();
    },
  },
};
require.cache[require.resolve('./admin-access')] = {
  id: require.resolve('./admin-access'),
  filename: require.resolve('./admin-access'),
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

async function postMember(currentScenario) {
  currentScenario.statements ||= [];
  scenario = currentScenario;
  const app = express();
  app.use(express.json(), groupRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/1/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New member' }),
    });
    return { response, payload: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('group administrators cannot add members to inactive groups', async () => {
  const { response, payload } = await postMember({
    group: { id: 1, contributionAmount: '100', frequency: 'monthly', startDate: '2026-01-01', cycleNumber: 1, groupStatus: 'completed' },
  });

  assert.equal(response.status, 409);
  assert.match(payload.error, /active group/);
});

test('member additions enforce the 100-member group limit', async () => {
  const { response, payload } = await postMember({
    group: { id: 1, contributionAmount: '100', frequency: 'monthly', startDate: '2026-01-01', cycleNumber: 1, groupStatus: 'active' },
    position: 100,
    memberCount: 100,
  });

  assert.equal(response.status, 409);
  assert.match(payload.error, /100-member limit/);
});

test('member additions reject payout totals beyond the database amount limit', async () => {
  const { response, payload } = await postMember({
    group: { id: 1, contributionAmount: '5000000000', frequency: 'monthly', startDate: '2026-01-01', cycleNumber: 1, groupStatus: 'active' },
    position: 2,
    memberCount: 2,
  });

  assert.equal(response.status, 400);
  assert.match(payload.error, /payout is too large/);
});

test('adding a member creates their payout slot and current-cycle contribution', async () => {
  const { response, payload } = await postMember({
    group: { id: 1, contributionAmount: '100', frequency: 'monthly', startDate: '2026-01-01', cycleNumber: 1, groupStatus: 'active' },
    position: 1,
    memberCount: 1,
    statements: [],
  });

  assert.equal(response.status, 201);
  assert.equal(payload.member.id, 2);
  assert.equal(payload.member.name, 'New member');
  assert.ok(scenario.statements.some((sql) => sql.startsWith('INSERT INTO payout_slots')));
  assert.ok(scenario.statements.some((sql) => sql.startsWith('INSERT INTO contributions')));
});
