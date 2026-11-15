import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const begin=source.indexOf('  async function api(url, options={})');
const end=source.indexOf('  async function logout()',begin);
assert.ok(begin>0&&end>begin);
const code=source.slice(begin,end);

function setup(response){
 const dom=new JSDOM(`<div id="login"><input id="loginUser" value="brother@dllone.com">
 <input id="loginPassword" value="testPassword"><div id="loginError"></div></div>`,{runScripts:'outside-only'});
 const w=dom.window;
 w.$=id=>w.document.getElementById(id);
 let resetCalls=0,started=0;
 w.showLogin=()=>{resetCalls++;w.$('loginPassword').value='';};
 w.start=async()=>{started++;};
 w.fetch=async()=>response;
 w.eval(code);
 return {dom,w,get resetCalls(){return resetCalls;},get started(){return started;}};
}

test('invalid email or password gives actionable login error, not a fake expired session',async()=>{
 const f=setup({status:401,ok:false,json:async()=>({ok:false,error:'Usuario o contraseña incorrectos.'})});
 await f.w.login();
 assert.equal(f.w.$('loginError').textContent,'Usuario o contraseña incorrectos.');
 assert.equal(f.resetCalls,0);
 assert.equal(f.w.$('loginPassword').value,'testPassword');
 assert.equal(f.started,0);
 f.dom.window.close();
});

test('an expired existing session still redirects to login',async()=>{
 const f=setup({status:401,ok:false,json:async()=>({ok:false,error:'NO_AUTH'})});
 await assert.rejects(f.w.api('/api/me'),/Sesión vencida/);
 assert.equal(f.resetCalls,1);
 f.dom.window.close();
});

test('successful authentication clears the password field and enters the panel',async()=>{
 const f=setup({status:200,ok:true,json:async()=>({ok:true,role:'SUPERADMIN'})});
 await f.w.login();
 assert.equal(f.w.$('loginError').textContent,'');
 assert.equal(f.w.$('loginPassword').value,'');
 assert.equal(f.started,1);
 assert.equal(f.resetCalls,0);
 f.dom.window.close();
});
