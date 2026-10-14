const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bcrypt = require('bcrypt');

function loadModel(query) {
    const module = {exports: {}};
    const dependencies = {
        '../services/database.js': {config: {query}},
        fs, uuid: require('uuid'), bcrypt, 'body-parser': {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../models/userModel.js'), 'utf8'), {
        module, console,
        require(name) {
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    });
    return module.exports;
}

test('schema initialization is shared by concurrent lookups, defaults to disabled and only promotes detschn', async () => {
    const queries = [];
    const model = loadModel(async (sql, args) => {
        queries.push({sql, args});
        if (sql.includes('ALTER TABLE')) return {};
        return {rows: [{uuid: 'fixture', username: 'streamer', login_enabled: false}]};
    });
    await Promise.all([model.getUsers(), model.getUserByUuid('fixture'), model.getLoginAccessUsers()]);
    const schema = queries.filter(query => query.sql.includes('ALTER TABLE'));
    assert.equal(schema.length, 1);
    assert.match(schema[0].sql, /ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
    assert.match(schema[0].sql, /UPDATE users SET user_role = 'admin', login_enabled = TRUE WHERE username = 'detschn'/);
    assert.doesNotMatch(schema[0].sql, /UPDATE users SET login_enabled = FALSE/);
    const lookup = queries.find(query => query.sql.includes('WHERE uuid = $1'));
    assert.deepEqual(Array.from(lookup.args), ['fixture']);
    const listing = queries.find(query => query.sql.includes('ORDER BY username'));
    assert.doesNotMatch(listing.sql, /password_hash|SELECT \*/);
});

test('failed migration rejects account access and can retry on a later request', async () => {
    let attempts = 0;
    const model = loadModel(async sql => {
        if (sql.includes('ALTER TABLE') && ++attempts === 1) throw new Error('schema unavailable');
        return {rows: []};
    });
    await assert.rejects(model.getUsers(), /schema unavailable/);
    assert.equal((await model.getUsers()).length, 0);
    assert.equal(attempts, 2);
});

test('login updates use parameters, reject non-booleans and protect detschn in the database query', async () => {
    const queries = [];
    const model = loadModel(async (sql, args) => {
        queries.push({sql, args});
        return {rowCount: args?.[1] === 'owner' ? 0 : 1};
    });
    await assert.rejects(model.setLoginEnabled('fixture', 'false'), /must be a boolean/);
    assert.equal(queries.length, 0);
    assert.equal(await model.setLoginEnabled('fixture', true), true);
    assert.equal(await model.setLoginEnabled('owner', false), false);
    for (const query of queries.filter(query => query.sql.includes('RETURNING uuid'))) {
        assert.match(query.sql, /login_enabled = \$1/);
        assert.match(query.sql, /uuid = \$2 AND username <> 'detschn'/);
    }
});

test('registration validates roles and reserved name, hashes at cost 10 and leaves login disabled by default', async () => {
    const queries = [];
    const model = loadModel(async (sql, args) => {queries.push({sql, args}); return {};});
    for (const username of ['detschn', ' DETSCHN ', '']) {
        await assert.rejects(model.createUser({username, role: 'admin', password: 'fixture'}), /reserved owner/);
    }
    await assert.rejects(model.createUser({username: 'new-user', role: 'owner', password: 'fixture'}), /Unknown user role/);
    assert.equal(queries.length, 0);
    const data = {username: 'new-user', role: 'streamer', password: 'fixture', login_enabled: true};
    const uuid = await model.createUser(data);
    const insert = queries.find(query => query.sql.startsWith('INSERT'));
    assert.equal(insert.args[0], uuid);
    assert.equal(bcrypt.getRounds(insert.args[2]), 10);
    assert.equal(await bcrypt.compare('fixture', insert.args[2]), true);
    assert.equal(data.password, 'fixture');
    assert.doesNotMatch(insert.sql, /login_enabled/);
    assert.equal(insert.args[3], 'streamer');
});
