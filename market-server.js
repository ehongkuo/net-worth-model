'use strict';
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');

function normalizeQuote(data, requested, now=Date.now()) {
  if(data.status==='error') {
    const error=new Error(data.code===429?'Provider rate limit reached. Try again later.':data.code===401?'The provider rejected the API key.':'Quote unavailable for this symbol or plan.');
    error.status=data.code===429?429:400;throw error;
  }
  const price=Number(data.close),stamp=Number(data.last_quote_at || data.timestamp);
  if(!Number.isFinite(price)||price<=0||!data.symbol||data.symbol.toUpperCase()!==requested.split(':')[0]||!data.currency) throw new Error('Provider returned an invalid quote.');
  return {symbol:data.symbol,name:data.name || data.symbol,exchange:data.exchange || '',currency:data.currency,price,
    quoteAt:Number.isFinite(stamp)&&stamp>0?new Date(stamp*1000).toISOString():null,
    retrievedAt:new Date(now).toISOString(),marketOpen:data.is_market_open===true,source:'Twelve Data',cached:false};
}
function createMarketClient({fetcher=fetch,clock=Date.now,key=''}={}) {
  let apiKey=key,requests=[];
  const cache=new Map(),pending=new Map();
  return {
    configured:()=>!!apiKey,
    setKey(value){if(typeof value!=='string'||value.length>256||!value.trim()||/[\s]/.test(value.trim())) throw new Error('Enter a valid API key.');apiKey=value.trim();cache.clear();},
    disconnect(){apiKey='';cache.clear();},
    async quote(raw) {
      const symbol=String(raw || '').trim().toUpperCase();
      if(!/^[A-Z0-9][A-Z0-9.:-]{0,39}$/.test(symbol)) {const e=new Error('Enter a valid stock ticker.');e.status=400;throw e;}
      if(!apiKey){const e=new Error('Connect a free Twelve Data key in Stock prices first.');e.status=503;throw e;}
      const now=clock(),cached=cache.get(symbol);
      if(cached&&now-cached.time<300000) return {...cached.quote,cached:true};
      if(pending.has(symbol)) return pending.get(symbol);
      requests=requests.filter(t=>now-t<86400000);
      if(requests.filter(t=>now-t<60000).length>=8||requests.length>=800){const e=new Error('Free-plan request budget reached. Cached quotes and manual prices remain available.');e.status=429;throw e;}
      requests.push(now);
      const request=(async()=>{
        try {
          const url=new URL('https://api.twelvedata.com/quote');url.searchParams.set('symbol',symbol);url.searchParams.set('apikey',apiKey);
          const response=await fetcher(url,{signal:AbortSignal.timeout(10000)});
          if(!response.ok){const e=new Error(response.status===429?'Provider rate limit reached. Try again later.':'The stock provider is unavailable. Keep using manual prices.');e.status=response.status===429?429:502;throw e;}
          const quote=normalizeQuote(await response.json(),symbol,clock());cache.set(symbol,{time:clock(),quote});return quote;
        } catch(error) {
          if(error.name==='TimeoutError'||error.name==='AbortError') throw new Error('Stock quote request timed out. Your assumptions are unchanged.');
          if(error.status) throw error;
          throw new Error('Could not retrieve a valid quote. Your assumptions are unchanged.');
        } finally {pending.delete(symbol);}
      })();pending.set(symbol,request);return request;
    }
  };
}
const files=new Set(['index.html','style.css','app.js','model.js','compensation.js','compensation-ui.js','money-flow.js','market-ui.js']);
function createServer({root=__dirname,client=createMarketClient({key:process.env.TWELVE_DATA_API_KEY || ''})}={}) {
  return http.createServer(async(req,res)=>{
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      const host=req.headers.host || '';
      if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(403,{error:'Local access only.'});
      const url=new URL(req.url,`http://${host}`);
      if(url.pathname.startsWith('/api/')) {
        if(req.headers['x-model-request']!=='1'||(req.headers.origin&&req.headers.origin!==`http://${host}`)) return send(403,{error:'Same-origin requests only.'});
        if(url.pathname==='/api/market/status'&&req.method==='GET') return send(200,{configured:client.configured(),provider:'Twelve Data',cacheMinutes:5});
        if(url.pathname==='/api/market/key'&&req.method==='POST') {
          if(!req.headers['content-type']?.startsWith('application/json')) return send(415,{error:'JSON required.'});
          let body='';for await(const chunk of req){body+=chunk;if(body.length>1024) return send(413,{error:'Request too large.'});}
          try {client.setKey(JSON.parse(body).key);}catch{return send(400,{error:'Enter a valid API key.'});}
          return send(200,{configured:true});
        }
        if(url.pathname==='/api/market/key'&&req.method==='DELETE'){client.disconnect();return send(200,{configured:false});}
        if(url.pathname==='/api/market/quote'&&req.method==='GET') return send(200,await client.quote(url.searchParams.get('symbol')));
        return send(404,{error:'Not found.'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD') return send(405,{error:'Method not allowed.'});
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!files.has(file)) return send(404,{error:'Not found.'});
      const data=await fs.readFile(path.join(root,file));
      const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
      res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
    } catch(error){send(error.status || 502,{error:error.message || 'Request failed.'});}
  });
}
if(require.main===module){const port=Number(process.env.PORT || process.argv[2] || 5182);createServer().listen(port,'127.0.0.1',()=>console.log(`Net worth model: http://127.0.0.1:${port}`));}
module.exports={normalizeQuote,createMarketClient,createServer};
