const {test,assert,assertClose}=require('./harness');
const F=require('../money-flow');
const fixture=()=>({columnCount:6,nodes:[
 {id:'espp-discount',label:'Purchase benefit',kind:'source',column:0},
 {id:'espp-cash-released',label:'Previously contributed cash',kind:'source',column:0},
 {id:'espp-growth',label:'Equity growth',kind:'source',column:0},
 {id:'salary',label:'Salary',kind:'source',column:0},
 {id:'combined',label:'Combined',kind:'hub',column:1},
 {id:'account-espp',label:'ESPP assets',kind:'asset',column:4}],links:[
 {source:'espp-discount',target:'combined',value:20},
 {source:'espp-cash-released',target:'combined',value:1},
 {source:'espp-growth',target:'combined',value:.01},
 {source:'salary',target:'combined',value:178.99},
 {source:'combined',target:'account-espp',value:200}]});
test('ESPP combines nonadjacent strands by category transition without discarding cents',()=>{
 const graph=fixture(),before=JSON.stringify(graph),g=F.categoryBands(graph),link=g.links.find(l=>l.target==='account-espp');
 assert(link.bands.length===2,'Expected cash-to-equity and equity-to-equity only');
 assertClose(link.bands.find(b=>b.sourceCategory==='cash').value,179.99);
 assertClose(link.bands.find(b=>b.sourceCategory==='equity').value,20.01);
 assert(JSON.stringify(graph)===before);assertClose(link.bands.reduce((s,b)=>s+b.value,0),200);
 assert(link.bands.flatMap(b=>b.components).length===4,'Source detail remains available');
});
test('each displayed strand has a tooltip for its own amount',()=>{
 const container={clientWidth:1260,innerHTML:'',querySelectorAll:()=>[]};
 F.render(container,fixture(),v=>v.toFixed(2));
 assert(container.innerHTML.includes('179.99 / year ÷ 12 = 15.00 / month'));
 assert(container.innerHTML.includes('20.01 / year ÷ 12 = 1.67 / month'));
 assert(container.innerHTML.includes('data-band='));
});
