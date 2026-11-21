import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFloors} from '../public/conversations.js';
import {renderOfficeScene, officeByHandle} from '../public/tower.js';

const ids = ['professional', 'product-design', 'personal-dashboard', 'personal-website', 'financial-advice'];
const url = 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000001';
function fixture() {
  return {agents: ids.map((id,i) => ({
    id, name:'Project '+i, sourceType:'sector',
    originalThreadReference:{threadTitle:'Shared title',threadUrl:url},
    folderAgents:[
      {name:'Shared title',nameSource:'fixture',url},
      ...([1,2,4].includes(i) ? [{name:'Design',nameSource:'fixture',ownerSuppliedUrl:url}] : []),
      {name:'Temporary',nameSource:'fixture',workOnly:true}
    ]
  })), commandCenter:{coordinator:{name:'Lead',project:'Operations team'}, workflowControl:{paused:true},
    execution:{evaluationGate:{name:'Reviewer'},projectConversationReceipts:[]}}};
}
test('private tower keeps seven occupied floors and ten distinct illustrated rooms across holds',()=>{
  const state=fixture(), archived={handle:'archived sample'};
  const levels=conversationFloors(state,[{id:ids[1],allWorkers:[archived]}],'owner');
  assert.deepEqual(levels.map(f=>f.id),['operations',...ids,'evaluation']);
  assert.deepEqual(levels.map(f=>f.workers.length),[1,1,2,2,1,2,1]);
  const rooms=levels.flatMap(f=>f.workers);
  assert.equal(new Set(rooms.map(w=>w.id)).size,10);
  for(const w of rooms)assert.match(renderOfficeScene(w),/class="desk-worker"/);
  assert.ok(rooms.every(w=>!w.active));
  assert.equal(officeByHandle(levels[2],archived.handle),archived);
  assert.ok(rooms.every(w=>w!==archived && w.name!=='Temporary'));
});
test('chat links and receipt attribution require the correct folder and destination',()=>{
  const state=fixture();
  state.commandCenter.execution.projectConversationReceipts.push({project:ids[0],threadTitle:'Shared title',threadUrl:url,messageId:'sample',summary:'Delivered fixture'});
  state.agents[3].originalThreadReference.threadTitle='Previous title';
  const levels=conversationFloors(state,[],'service');
  assert.equal(levels[1].workers[0].activity,'Delivered fixture');
  assert.equal(levels[2].workers[0].activity,undefined);
  assert.equal(levels[2].workers[1].chatUrl,undefined);
  assert.equal(levels[4].workers[0].chatUrl,undefined);
  assert.equal(levels[2].workers[1].status,'Awaiting verified link');
  assert.deepEqual(conversationFloors(state,[],'anonymous'),[]);
});
