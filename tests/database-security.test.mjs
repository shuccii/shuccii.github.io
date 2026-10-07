import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const sql = (name) => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
async function database(t) {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated;
    create schema extensions; create extension pgcrypto with schema extensions;
    grant usage on schema public to anon, authenticated;`);
  for (const file of ['write-limits.sql', 'comments.sql', 'private-feedback.sql', 'visits.sql']) {
    await db.exec(await sql(file));
  }
  return db;
}
async function rpc(db, role, query, params = []) {
  await db.exec(`set role ${role}`);
  try { return await db.query(query, params); }
  finally { await db.exec('reset role'); }
}
const comment = (db, page = 'blog/test', parent = null, role = 'anon') =>
  rpc(db, role, 'select submit_site_comment($1, $2, $3, $4) as id', [page, '読者', '感想です', parent]);
const feedback = (db, key = randomUUID()) =>
  rpc(db, 'anon', 'select submit_private_feedback($1, $2, $3, $4)', ['other', '', '良いサイトです', key]);
const visit = (db, key = randomUUID(), page = '/') =>
  rpc(db, 'anon', 'select record_site_visit($1, $2, $3, $4, $5, $6, $7)', [page, 'Japan', 'JP', 'Nara', '29', 'Ikoma', key]);
const count = async (db, table) => Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
const reset = (db) => db.exec('truncate site_private.write_events, site_feedback_rate_limits, site_visit_rate_limits');

test('normal anonymous comment/reply/like, private feedback and protected visit report remain usable', async (t) => {
  const db = await database(t);
  const root = (await comment(db)).rows[0].id;
  await comment(db, 'blog/test', root);
  assert.equal((await rpc(db, 'anon', 'select * from get_site_comments($1)', ['blog/test'])).rows.length, 2);
  const voter = randomUUID();
  assert.equal((await rpc(db, 'anon', 'select * from toggle_site_like($1,$2)', ['blog/test', voter])).rows[0].liked, true);
  assert.equal((await rpc(db, 'anon', 'select * from toggle_site_like($1,$2)', ['blog/test', voter])).rows[0].liked, false);
  await feedback(db); await visit(db);
  await db.query(`insert into site_admin_keys(name,key_hash) values ('visits', encode(extensions.digest($1,'sha256'),'hex'))`, ['local-test-passphrase']);
  const result = await rpc(db, 'anon', 'select get_site_visit_report($1, 30) as report', ['local-test-passphrase']);
  assert.equal(result.rows[0].report.total, 1);
  for (const table of ['site_feedback', 'site_visits', 'site_admin_keys', 'site_private.write_events']) {
    await assert.rejects(rpc(db, 'anon', `select * from ${table}`), /permission denied/);
  }
  await assert.rejects(rpc(db, 'anon', "select site_private.allow_site_write('feedback')"), /permission denied/);
  await assert.rejects(rpc(db, 'authenticated', "select site_private.allow_site_write('feedback')"), /permission denied/);
});

test('changing UUIDs, pages and anonymous/authenticated roles cannot reset shared budgets', async (t) => {
  const db = await database(t);
  for (let i = 0; i < 10; i++) await comment(db, `blog/page-${i}`, null, i % 2 ? 'authenticated' : 'anon');
  await assert.rejects(comment(db, 'blog/other'), /混み合って/);
  assert.equal(await count(db, 'site_comments'), 10);
  for (let i = 0; i < 5; i++) await feedback(db);
  await assert.rejects(feedback(db), /混み合って/);
  assert.equal(await count(db, 'site_feedback'), 5);
  for (let i = 0; i < 120; i++) await visit(db, randomUUID(), `/page-${i}`);
  await visit(db);
  assert.equal(await count(db, 'site_visits'), 120);
  for (let i = 0; i < 60; i++) await rpc(db, 'anon', 'select * from toggle_site_like($1,$2)', [`blog/page-${i}`, randomUUID()]);
  await assert.rejects(rpc(db, 'anon', 'select * from toggle_site_like($1,$2)', ['blog/other', randomUUID()]), /混み合って/);
  assert.equal(await count(db, 'site_likes'), 60);
});

test('rolling day caps, expiration and failed writes preserve transaction semantics', async (t) => {
  const db = await database(t);
  await db.exec("insert into site_private.write_events select 'feedback', clock_timestamp()-interval '2 minutes' from generate_series(1,50)");
  await assert.rejects(feedback(db), /混み合って/);
  await db.exec("update site_private.write_events set created_at=clock_timestamp()-interval '25 hours'");
  await feedback(db);
  assert.equal(await count(db, 'site_private.write_events'), 1);
  await assert.rejects(rpc(db, 'anon', 'select submit_private_feedback($1,$2,$3,$4)', ['other', '', '', randomUUID()]));
  assert.equal(await count(db, 'site_private.write_events'), 1);
  await assert.rejects(feedback(db, null), /識別子/);
  await visit(db, null);
  assert.equal(await count(db, 'site_visits'), 0);
});

test('absolute table and per-page ceilings apply before persistent writes', async (t) => {
  const db = await database(t);
  const cases = [
    ['site_comments', 20000, "insert into site_comments(page_id,author_name,body) select 'blog/existing','x','x' from generate_series(1,20000)", () => comment(db, 'blog/new')],
    ['site_feedback', 10000, "insert into site_feedback(body) select 'x' from generate_series(1,10000)", () => feedback(db)],
    ['site_likes', 100000, "insert into site_likes(page_id,voter_key) select 'blog/existing',gen_random_uuid() from generate_series(1,100000)", () => rpc(db,'anon','select * from toggle_site_like($1,$2)',['blog/new',randomUUID()])],
    ['site_visits', 250000, "insert into site_visits(page_path) select '/' from generate_series(1,250000)", () => visit(db)],
  ];
  for (const [table, max, seed, write] of cases) {
    await reset(db); await db.exec(seed);
    if (table === 'site_visits') await write(); else await assert.rejects(write(), /混み合って/);
    assert.equal(await count(db, table), max);
    if (table === 'site_likes') {
      const voter = (await db.query('select voter_key from site_likes limit 1')).rows[0].voter_key;
      assert.equal((await rpc(db,'anon','select * from toggle_site_like($1,$2)',['blog/existing',voter])).rows[0].liked, false);
      assert.equal(await count(db, table), max - 1);
    }
    await db.exec(`truncate ${table} cascade`);
  }
  await db.exec("insert into site_comments(page_id,author_name,body) select 'blog/full','x','x' from generate_series(1,500)");
  await assert.rejects(comment(db, 'blog/full'), /上限/);
  await comment(db, 'blog/normal');
  assert.equal((await rpc(db,'anon','select * from get_site_comments($1)',['blog/full'])).rows.length, 500);
});

test('legacy replacement migration keeps limits and repeated setup is safe', async (t) => {
  const db = await database(t);
  await db.exec(await sql('enable-immediate-comments.sql'));
  for (const file of ['write-limits.sql','comments.sql','private-feedback.sql','visits.sql']) await db.exec(await sql(file));
  for (let i=0;i<10;i++) await comment(db);
  await assert.rejects(comment(db), /混み合って/);
});

test('wrong report key returns without deliberate database sleep', async (t) => {
  const db = await database(t);
  await db.exec("set statement_timeout = '200ms'");
  await assert.rejects(rpc(db,'anon','select get_site_visit_report($1,30)',['wrong-key']), /合言葉が違います/);
  const definition = (await db.query("select pg_get_functiondef('public.get_site_visit_report(text,integer)'::regprocedure) as code")).rows[0].code;
  assert.doesNotMatch(definition, /pg_sleep\s*\(/i);
});

test('single-transaction upgrade matches canonical SQL and applies to an existing database', async (t) => {
  const db = await database(t);
  const parts = [];
  for (const file of ['write-limits.sql','comments.sql','private-feedback.sql','visits.sql']) {
    let text = await sql(file);
    if (file === 'write-limits.sql') text = text.replace('begin;\n','').split('commit;')[0];
    parts.push(`-- Source: ${file}\n${text}`);
  }
  const bundle = await sql('security-upgrade.sql');
  assert.equal(bundle.slice(bundle.indexOf('begin;\n')), `begin;\n${parts.join('\n')}\ncommit;\n`);
  await comment(db);
  await db.exec(bundle);
  assert.equal(await count(db, 'site_comments'), 1);
  for (let i=1;i<10;i++) await comment(db);
  await assert.rejects(comment(db), /混み合って/);
});
