/* Quotes remain separate from scenario prices until explicitly applied. */
class QuoteStore {
  constructor(fetcher,notify=()=>{},clock=Date.now){this.fetcher=fetcher;this.notify=notify;this.clock=clock;this.states=new Map();this.generation=0;}
  get(symbol){return this.states.get(symbol.trim().toUpperCase());}
  clear(){this.generation++;this.states.clear();}
  async fetch(raw,retry=false){
    const symbol=raw.trim().toUpperCase(),previous=this.get(symbol);
    if(!/^[A-Z0-9][A-Z0-9.:-]{0,39}$/.test(symbol)){this.states.set(symbol,{error:'Enter a valid ticker, such as AAPL.'});this.notify();return null;}
    if(previous?.pending)return previous.pending;
    if(!retry && (previous?.error || (previous?.quote && this.clock()-previous.time<300000)))return previous.quote;
    const generation=this.generation,state={...previous,loading:true,error:''};this.states.set(symbol,state);
    state.pending=(async()=>{
      try {const quote=await this.fetcher(symbol);if(generation===this.generation){state.quote=quote;state.time=this.clock();}return quote;}
      catch(error){if(generation===this.generation)state.error=error.message;return null;}
      finally {if(generation===this.generation){state.loading=false;state.pending=null;this.notify();}}
    })();this.notify();return state.pending;
  }
}
let marketReady=false,marketTimer,marketStore;
async function marketRequest(path,options={}) {
  const response=await fetch(`/api/market/${path}`,{...options,headers:{'X-Model-Request':'1',...(options.body?{'Content-Type':'application/json'}:{})}});
  let result;try{result=await response.json();}catch{throw new Error('Stock prices need the local app server. Start with npm start.');}
  if(!response.ok)throw new Error(result.error || 'Stock price request failed.');
  return result;
}
function stockTargets() {
  const c=model.getConfig().compensation;
  return c.grants.map((g,i)=>({id:`grant-${i}`,name:g.name || `Grant ${i+1}`,symbol:g.symbol || '',path:`grants.${i}.vestPrice`,estimate:g.vestPrice,label:'vest-price estimate'})).concat([{id:'espp',name:'ESPP',symbol:c.espp.symbol || '',path:'espp.purchasePrice',estimate:c.espp.purchasePrice,label:'purchase-market estimate'}]);
}
function marketCard(t){
  const symbol=t.symbol.trim().toUpperCase(),state=marketStore?.get(symbol),q=state?.quote;
  const status=!symbol?'Enter a ticker to see its quote.':!marketReady?'Connect in Stock prices to fetch this ticker.':state?.loading?'Fetching '+symbol+'…':state?.error?state.error:q?'Quote ready':'Waiting for quote…';
  const quote=q?`<div class="market-quote"><strong>${escapeText(q.currency)} ${Number(q.price).toFixed(2)}</strong><small>${escapeText(q.name)} · ${escapeText(q.exchange)}<br>As of ${escapeText(q.quoteAt?new Date(q.quoteAt).toLocaleString():'time unavailable')}<br>Retrieved ${escapeText(new Date(q.retrievedAt).toLocaleTimeString())}${q.cached?' · cached':''}</small><p>Model ${escapeText(t.label)}: $${Number(t.estimate || 0).toFixed(2)}</p><button type="button" class="btn-secondary" data-apply-quote="${t.id}" ${q.currency!=='USD'||state.error?'disabled':''}>Use $${q.price.toFixed(2)} as estimate</button>${q.currency!=='USD'?'<p>This model requires a USD quote.</p>':''}</div>`:'';
  return `<section class="market-target"><h4>${escapeText(t.name)}${symbol?' · '+escapeText(symbol):''}</h4><p class="market-status ${state?.error?'loss-text':''}" role="status">${escapeText(status)}</p>${quote}<button type="button" class="btn-secondary" data-quote="${t.id}" ${!marketReady||!symbol||state?.loading?'disabled':''}>${state?.error?'Retry':q?'Refresh quote':'Get quote'}</button>${!marketReady?'<button type="button" class="btn-secondary" data-market-connect>Connect stock prices</button>':''}</section>`;
}
function renderMarketPrices(schedule=true) {
  const target=document.getElementById('market-targets');if(!target)return;
  const targets=stockTargets();target.innerHTML=targets.map(marketCard).join('');
  document.querySelectorAll('[data-market-inline]').forEach(el=>{const t=targets.find(t=>t.id===el.dataset.marketInline);el.innerHTML=t?marketCard(t):'';});
  document.querySelectorAll('[data-market-connect]').forEach(b=>b.onclick=()=>showCompensationView('market'));
  document.querySelectorAll('[data-quote]').forEach(b=>b.onclick=()=>{const t=stockTargets().find(t=>t.id===b.dataset.quote);if(t)marketStore.fetch(t.symbol,true);});
  document.querySelectorAll('[data-apply-quote]').forEach(b=>b.onclick=()=>{
    const t=stockTargets().find(t=>t.id===b.dataset.applyQuote),state=t&&marketStore.get(t.symbol),q=state?.quote;
    if(!q||q.currency!=='USD'||state.error)return;
    const c=model.getConfig().compensation;setConfigValue(c,t.path,q.price);
    model.updateConfig({compensation:c});syncCompensationFields();runSimulation();
    marketMessage(`Applied ${q.symbol} at $${q.price.toFixed(2)} to the ${t.label}. Historical grant and offering prices are unchanged.`);
  });
  if(schedule){clearTimeout(marketTimer);marketTimer=setTimeout(()=>{
    if(!marketReady)return;
    for(const symbol of new Set(stockTargets().map(t=>t.symbol.trim().toUpperCase()).filter(Boolean))){
      marketStore.fetch(symbol);
    }
  },550);}
}
function marketMessage(text){document.getElementById('market-message').textContent=text;}
async function setupMarketUI() {
  marketStore=new QuoteStore(symbol=>marketRequest(`quote?symbol=${encodeURIComponent(symbol)}`),()=>renderMarketPrices(false));
  document.getElementById('market-connect').onclick=async()=>{
    const button=document.getElementById('market-connect'),input=document.getElementById('market-key'),key=input.value;input.value='';button.disabled=true;marketMessage('Connecting…');
    try {await marketRequest('key',{method:'POST',body:JSON.stringify({key})});marketStore.clear();marketReady=true;marketMessage('Connected. Quotes load automatically for your tickers. Review a quote, then use it as an estimate.');renderMarketPrices();}
    catch(error){marketMessage(error.message);}finally{button.disabled=false;}
  };
  document.getElementById('market-disconnect').onclick=async()=>{
    try{await marketRequest('key',{method:'DELETE'});marketReady=false;marketStore.clear();renderMarketPrices();marketMessage('Disconnected. Manual assumptions are unchanged.');}catch(error){marketMessage(error.message);}
  };
  renderMarketPrices();
  try {const status=await marketRequest('status');marketReady=status.configured;marketMessage(marketReady?'Connected. Quotes load automatically for your tickers.':'Connect your free Twelve Data key. Then enter a ticker in an RSU grant or ESPP.');renderMarketPrices();}
  catch(error){marketMessage(error.message);}
}
if(typeof module!=='undefined')module.exports={QuoteStore};
