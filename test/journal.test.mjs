import test from 'node:test';
import assert from 'node:assert/strict';
import {journalDay,journalEvents,journalGroups,journalMarkup} from '../public/journal.js';

test('Pacific midnight, spring gap and repeated autumn hour',()=>{
  for(const [stamp,date] of [
    ['2026-11-22T07:59:59Z','2026-11-21'],['2026-11-22T08:00:00Z','2026-11-22'],
    ['2026-03-08T09:59:59Z','2026-03-08'],['2026-03-08T10:00:00Z','2026-03-08'],
    ['2026-11-01T08:30:00Z','2026-11-01'],['2026-11-01T09:30:00Z','2026-11-01']
  ]) assert.equal(journalDay(stamp),date);
  const groups=journalGroups([{at:'bad'},{at:null},{at:'2026-11-22T07:59:59Z'}],'2026-11-22T08:00:00Z');
  assert.deepEqual([groups.today.length,groups.previous.length,groups.undated.length],[0,1,2]);
});

test('join original receipts once, preserve prior events and exclude mere sends',()=>{
  const r={id:'reply/job/msg',type:'reply',project:'p',tag:'job',messageId:'msg',threadTitle:'Example',observedAt:'2026-11-22T08:00:00Z'};
  const state={agents:[{id:'p'}],events:[],commandCenter:{id:'hub',execution:{projectConversationReceipts:[r,r,{...r,type:'sent',id:'sent/x'}],evaluationIntake:[{producerReplyId:'msg',evidenceUrl:'https://example.org/results'}]}}};
  let rows=journalEvents(state);
  assert.equal(rows.length,1);assert.equal(rows[0].at,r.observedAt);assert.equal(rows[0].artifactUrl,'https://example.org/results');
  state.events.push({id:'result/job/msg',agentId:'p',title:'Original result',at:r.observedAt});
  assert.deepEqual(journalEvents(state),state.events);
});

test('previous days use a keyboard-native closed disclosure and today stays outside it',()=>{
  const stamp='2026-11-22T08:00:00Z';
  const rows=[{title:'current',at:stamp},{title:'old',at:'2026-11-22T07:59:59Z'},{title:'unknown'}];
  const render=entries=>entries.map(r=>'<article>'+r.title+'</article>').join('');
  const html=journalMarkup(rows,stamp,render);
  assert.match(html,/<h3>Today<\/h3><article>current<\/article><details class="journal-archive"><summary>Previous days <span>2<\/span><\/summary><article>old<\/article><article>unknown<\/article><\/details>$/);
  assert.doesNotMatch(html,/Date unavailable|<details[^>]*\bopen\b/);
  assert.match(journalMarkup(rows.slice(1),stamp,render),/No activity recorded today/);
  assert.doesNotMatch(journalMarkup(rows.slice(0,1),stamp,render),/Previous days/);
});

test('undated records stay last in Previous days without changing timestamps or rows',()=>{
  const stamp='2026-11-22T08:00:00Z';
  const rows=[{title:'missing'},{title:'old',at:'2026-11-21T12:00:00Z'},{title:'invalid',at:'bad'},{title:'future',at:'2026-11-23T12:00:00Z'}];
  const original=structuredClone(rows);
  const rendered=[];
  const render=entries=>{rendered.push(entries);return entries.map(r=>'<article>'+r.title+'</article>').join('');};
  const html=journalMarkup(rows,stamp,render);
  assert.deepEqual(rows,original);
  assert.deepEqual(rendered[0],[rows[1],rows[0],rows[2]]);
  assert.equal(rendered[0][1],rows[0]);
  assert.match(html,/Previous days <span>3<\/span><\/summary><article>old<\/article><article>missing<\/article><article>invalid<\/article><\/details><h3>Future-dated records<\/h3><article>future<\/article>$/);
  const undatedOnly=journalMarkup([rows[0],rows[2]],stamp,render);
  assert.match(undatedOnly,/No activity recorded today/);
  assert.match(undatedOnly,/Previous days <span>2<\/span>/);
  assert.doesNotMatch(undatedOnly,/Date unavailable|Future-dated records/);
  assert.doesNotMatch(journalMarkup([],stamp,render),/<details/);
});
