import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TokenStore } from '../src/token-store.js';
import { ImwebClient } from '../src/imweb.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const cfg = { base:'http://localhost:3000', proxy:0, clientId:'test-client', clientSecret:'test-secret', siteCode:'S_TEST', adminPassword:'a'.repeat(43), mcpClientId:'cosa-chatgpt', mcpClientSecret:'b'.repeat(43), redirects:['https://chatgpt.com/test-callback'] };
const response = (data,status=200) => new Response(JSON.stringify(status===200 ? {statusCode:200,data} : data),{status,headers:{'content-type':'application/json'}});
const tokenResponse = () => response({accessToken:'access-private',refreshToken:'refresh-private',scope:'site-info:write script:write'});
function memoryStore(initial=null) { return { value:initial, async load(){return this.value;}, async save(v){this.value=v;} }; }
const token = () => ({ accessToken:'old', refreshToken:'refresh', expiresAt:Date.now()+7200000, refreshExpiresAt:Date.now()+86400000 });
test('Imweb camelCase authorize/form, Basic auth, envelope and READ scope', async () => {
  const store=memoryStore(), calls=[];
  const imweb=new ImwebClient(cfg,store,async (url,init)=>{calls.push({url,init});return tokenResponse();});
  const url=new URL(imweb.authorizationUrl('nonce'));
  assert.equal(url.searchParams.get('siteCode'),'S_TEST'); assert.equal(url.searchParams.get('scope'),'site-info:write script:write'); assert.equal(url.searchParams.get('responseType'),'code');
  await imweb.exchange('code');
  assert.equal(calls[0].url,'https://openapi.imweb.me/oauth2/token');
  assert.equal(calls[0].init.body.get('grantType'),'authorization_code');
  assert.equal(calls[0].init.body.get('clientSecret'),'test-secret');
  assert.match(calls[0].init.headers.Authorization,/^Basic /);
  assert.equal(store.value.refreshToken,'refresh-private');
});
test('Reject incomplete scopes and mismatched site',async()=>{
 const bad=new ImwebClient(cfg,memoryStore(),async()=>response({accessToken:'a',refreshToken:'r',scope:'site-info:write'}));
 await assert.rejects(bad.exchange('c'),/unexpected scopes/);
 const wrong=new ImwebClient(cfg,memoryStore(token()),async()=>response({siteCode:'OTHER'}));
 await assert.rejects(wrong.getSiteInfo(),/identity mismatch/);
});
test('Concurrent expired reads rotate refresh token once; expose basic info only',async()=>{
 const store=memoryStore({...token(),expiresAt:0}); let refreshes=0;
 const imweb=new ImwebClient(cfg,store,async(url,init)=>{
  if(url.endsWith('/token')) {refreshes++;assert.equal(init.body.get('grantType'),'refresh_token');return tokenResponse();}
  assert.equal(init.method,'GET'); assert.equal(init.headers.Authorization,'Bearer access-private');
  return response({siteCode:'S_TEST',unitList:[{unitCode:'u1',name:'COSA',currency:'KRW',unexpected:'private'}],ownerUid:'private',configData:{private:'data'}});
 });
 const sites=await Promise.all([imweb.getSiteInfo(),imweb.getSiteInfo()]);
 assert.equal(refreshes,1); assert.deepEqual(sites[0],{siteCode:'S_TEST',unitList:[{unitCode:'u1',name:'COSA',currency:'KRW'}]});
});
test('401 expired retry once; 403/429 never refresh; upstream details never leak',async()=>{
 let n=0; const store=memoryStore(token());
 const imweb=new ImwebClient(cfg,store,async(url)=>{
  n++; if(url.endsWith('/token'))return tokenResponse();
  return n===1?response({errorCode:30102,message:'secret'},401):response({siteCode:'S_TEST',unitList:[]});
 });
 await imweb.getSiteInfo();assert.equal(n,3);
 for(const status of [403,429]){let calls=0;const c=new ImwebClient(cfg,memoryStore(token()),async()=>{calls++;return response({errorCode:30103,message:'SECRET'},status);});await assert.rejects(c.getSiteInfo(),e=>!e.message.includes('SECRET'));assert.equal(calls,1);}
});
test('AES-GCM store roundtrip, permissions and key/site binding',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cosa-test-'));try{
 const file=path.join(dir,'tokens.enc'), store=new TokenStore(file,'ab'.repeat(32),'client:site');
 assert.equal(await store.load(),null);await store.save(token());
 assert.equal((await store.load()).accessToken,'old');
 assert.equal((await stat(file)).mode & 0o777,0o600);
 assert.ok(!(await readFile(file,'utf8')).includes('refreshToken'));
 await assert.rejects(new TokenStore(file,'cd'.repeat(32),'client:site').load(),/decrypt/);
 await assert.rejects(new TokenStore(file,'ab'.repeat(32),'other').load(),/decrypt/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
async function fixture(t, overrides={}){
 const local={...cfg,...overrides};const calls=[];
 const imweb={authorizationUrl:state=>'https://openapi.imweb.me/oauth2/authorize?state='+state,exchange:async code=>calls.push(code),getSiteInfo:async()=>({siteCode:'S_TEST',unitList:[]})};
 const server=http.createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 local.base=base;
 const {app}=createApp(local,imweb);server.on('request',app);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const req=(p,init={})=>fetch(base+p,{...init,redirect:'manual'});
 return {req,base,calls};
}
const cookiePair=res=>res.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const form=data=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
test('Browser-bound one-time Imweb state; admin read protection; no token response',async t=>{
 const {req,calls}=await fixture(t);
 assert.equal((await req('/api/site-info')).status,401);
 assert.equal((await req('/health',{headers:{Origin:'https://attacker.com'}})).status,403);
 assert.equal((await req('/oauth/callback?code=x&state=bad')).status,400);
 const start=await req('/oauth/start');
 assert.equal(start.headers.get('referrer-policy'),'same-origin');
 assert.match(start.headers.get('content-security-policy'),/form-action 'self' https:\/\/openapi.imweb.me/);
 const cookie=cookiePair(start),nonce=(await start.text()).match(/name="nonce" value="([^"]+)"/)[1];
 const post=form({nonce,password:cfg.adminPassword});post.headers.Cookie=cookie;post.headers.Origin=new URL((await req('/health')).url).origin;
 const redirect=await req('/oauth/start',post);assert.equal(redirect.status,303);
 const state=new URL(redirect.headers.get('location')).searchParams.get('state');
 assert.equal((await req('/oauth/callback?code=ok&state='+state)).status,400);
 const callback=await req('/oauth/callback?code=ok&state='+state,{headers:{Cookie:cookiePair(redirect)}});
 assert.equal(callback.status,303);assert.deepEqual(calls,['ok']);
 assert.equal((await req('/oauth/callback?code=ok&state='+state,{headers:{Cookie:cookiePair(redirect)}})).status,400);
 assert.equal((await req('/api/site-info',{headers:{Cookie:cookiePair(redirect)}})).status,200);
});
test('Real MCP SDK client: OAuth discovery, consent, PKCE, replay prevention and read and write tool annotations',async t=>{
 const {req,base}=await fixture(t);
 const denied=await req('/mcp',{method:'POST'});assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);
 assert.equal((await req('/.well-known/oauth-protected-resource/mcp')).status,200);
 const metadata=await (await req('/.well-known/oauth-authorization-server')).json();assert.equal(metadata.token_endpoint,base+'/token');
 const verifier='v'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
 const query=new URLSearchParams({client_id:cfg.mcpClientId,redirect_uri:cfg.redirects[0],response_type:'code',code_challenge:challenge,code_challenge_method:'S256',scope:'site:manage',state:'client-state',resource:base+'/mcp'});
 const invalidRedirect=new URLSearchParams(query);invalidRedirect.set('redirect_uri','https://attacker.example/callback');assert.equal((await req('/authorize?'+invalidRedirect)).status,400);
 const consent=await req('/authorize?'+query);assert.equal(consent.status,200);
 const transaction=(await consent.text()).match(/name="transaction" value="([^"]+)"/)[1];
 assert.equal((await req('/consent',form({transaction,password:cfg.adminPassword}))).status,403);
 const consentPost=form({transaction,password:cfg.adminPassword});consentPost.headers.Cookie=cookiePair(consent);
 const approved=await req('/consent',consentPost);assert.equal(approved.status,303);
 const target=new URL(approved.headers.get('location'));assert.equal(target.searchParams.get('state'),'client-state');
 const fields={grant_type:'authorization_code',client_id:cfg.mcpClientId,client_secret:cfg.mcpClientSecret,code:target.searchParams.get('code'),redirect_uri:cfg.redirects[0],code_verifier:verifier,resource:base+'/mcp'};
 assert.equal((await req('/token',form({...fields,code_verifier:'wrong'}))).status,400);
 const invalidClient=await req('/token',form({...fields,client_secret:'wrong'}));assert.equal(invalidClient.status,400);assert.equal((await invalidClient.json()).error,'invalid_client');
 assert.equal((await req('/token',form({...fields,resource:'https://attacker.example/mcp'}))).status,400);
 const issued=await req('/token',form(fields));assert.equal(issued.status,200);const tokens=await issued.json();
 assert.equal((await req('/token',form(fields))).status,400);
 const client=new Client({name:'test-client',version:'1'});
 const transport=new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}});
 await client.connect(transport);
 try {const {tools}=await client.listTools();assert.equal(tools.length,4);assert.equal(tools[0].name,'get_site_info');assert.equal(tools[0].annotations.readOnlyHint,true);assert.equal(tools.find(t=>t.name==='update_script').annotations.readOnlyHint,false);const result=await client.callTool({name:'get_site_info',arguments:{}});assert.equal(JSON.parse(result.content[0].text).siteCode,'S_TEST');}finally{await client.close();}
 const refreshed=await req('/token',form({grant_type:'refresh_token',client_id:cfg.mcpClientId,client_secret:cfg.mcpClientSecret,refresh_token:tokens.refresh_token}));assert.equal(refreshed.status,200);
 assert.equal((await req('/token',form({grant_type:'refresh_token',client_id:cfg.mcpClientId,client_secret:cfg.mcpClientSecret,refresh_token:tokens.refresh_token}))).status,400);
});
test('Configuration blocks missing secrets and public plain HTTP',()=>{
 assert.throws(()=>config({}),/Missing/);
 assert.throws(()=>config({PUBLIC_BASE_URL:'http://example.com'}),/HTTPS/);
});

test('Missing site code allows health but blocks Imweb authorization',async t=>{
 const {req,calls}=await fixture(t,{siteCode:''});
 assert.equal((await req('/health')).status,200);
 assert.equal((await req('/oauth/start')).status,503);
 assert.equal((await req('/oauth/start',form({password:cfg.adminPassword}))).status,503);
 assert.deepEqual(calls,[]);
 assert.throws(()=>new ImwebClient({...cfg,siteCode:''},memoryStore()).authorizationUrl('state'),/IMWEB_SITE_CODE/);
});

test('Imweb scope rejection without state is explained without token exchange',async t=>{
 const {req,calls}=await fixture(t);
 const r=await req('/oauth/callback?errorCode=30156&code=must-not-exchange&message=%3Cscript%3Ebad%3C/script%3E');
 assert.equal(r.status,400);const body=await r.text();
 assert.match(body,/site-info:write/);assert.ok(!body.includes('<script>'));
 assert.deepEqual(calls,[]);
 assert.equal((await req('/oauth/callback?code=must-not-exchange')).status,400);
 assert.deepEqual(calls,[]);
});

test('Script writes validate unit/revision, back up contents, and never retry mutation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cosa-script-'));
 try {
 const local={...cfg,tokenFile:path.join(dir,'tokens.enc'),encryptionKey:'ab'.repeat(32)};
 let content='<script>old()</script>',writes=0,fail=false;
 const imweb=new ImwebClient(local,memoryStore(token()),async(url,init)=>{
   if(url.endsWith('/site-info'))return response({siteCode:cfg.siteCode,unitList:[{unitCode:'u1'}]});
   if(init.method==='GET')return response(content===null?[]:[{siteCode:cfg.siteCode,unitCode:'u1',position:'header',scriptContent:content}]);
   writes++;if(fail)throw Error('network lost');
   assert.equal(url,'https://openapi.imweb.me/script');
   content=JSON.parse(init.body).scriptContent;return response(true);
 });
 const before=await imweb.getScript('u1','header');
 await assert.rejects(imweb.saveScript({...before,scriptContent:'new',expectedRevision:'bad'}),/changed/);assert.equal(writes,0);
 await assert.rejects(imweb.getScript('u2','header'),/does not belong/);
 const changed=await imweb.saveScript({...before,scriptContent:'<script>new()</script>',expectedRevision:before.revision});
 assert.equal(writes,1);assert.equal(changed.success,true);
 const backup=await new TokenStore(path.join(dir,'script-backups',changed.backupId+'.enc'),local.encryptionKey,cfg.clientId+':'+cfg.siteCode).load();
 assert.equal(backup.scriptContent,'<script>old()</script>');
 await assert.rejects(imweb.saveScript({...before,scriptContent:'oops',expectedRevision:before.revision}),/changed/);assert.equal(writes,1);
 const current=await imweb.getScript('u1','header');fail=true;
 await assert.rejects(imweb.saveScript({...current,scriptContent:'attempt',expectedRevision:current.revision}),/network/);assert.equal(writes,2);
 fail=false;content=null;const empty=await imweb.getScript('u1','header');
 await assert.rejects(imweb.saveScript({...empty,scriptContent:'new',expectedRevision:empty.revision}),/No script/);
 assert.equal((await imweb.saveScript({...empty,scriptContent:'new',expectedRevision:empty.revision},true)).success,true);
 } finally {await rm(dir,{recursive:true,force:true});}
});
