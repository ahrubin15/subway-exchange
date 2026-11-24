/* Subway Exchange development live preview. Verified test-account trading only. */
window.SubwayLivePreview = {
  start() {
    if (new URLSearchParams(location.search).get('live') !== '1') return false;
    const main = document.getElementById('main');
    const url = 'https://jxymdjkzbjntfbbyjdfa.supabase.co';
    const key = 'sb_publishable_DA9X9DoNOhoBYFMdVGh7JQ_Rzk_xRPI';
    const safe = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fmt = v => (Number(v)/10000).toLocaleString('en-US',{maximumFractionDigits:2})+'%';
    const time = v => new Date(v).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'});
    const bullet = '<span class="roundel small" style="--bg:#00933C;--fg:white">6</span>';
    const state = {token:null, rows:[], player:null, offset:0, error:'', busy:false, generation:0, updated:null,tab:'lines',portfolioTab:'active',tickets:null,portfolioError:'',portfolioBusy:false,purchase:null,purchaseBusy:false,notice:''};
    document.title='Subway Exchange \u00b7 Live Market Preview';
    document.querySelector('.demo-strip').textContent='PRIVATE ALPHA \u00b7 LIVE MTA DATA \u00b7 VIRTUAL TOKEN TEST TRADING';
    for (const sel of ['#alertsBtn','.sticky-nav','.foot','.side']) {
      const el=document.querySelector(sel); if(el)el.hidden=true;
    }
    const app=document.querySelector('.app'); if(app)app.style.gridTemplateColumns='minmax(0,760px)';
    const box=document.querySelector('.tokenbox'); if(box)box.title='Backend available Tokens';
    document.getElementById('headerBalance').textContent='\u2014';
    async function request(path,body,token) {
      const headers={apikey:key,'Content-Type':'application/json'};
      if(token)headers.Authorization='Bearer '+token;
      const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),12000);
      try {
        const res=await fetch(url+path,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',signal:ctrl.signal});
        if(!res.ok){const e=new Error('Request failed');e.status=res.status;throw e;}
        return await res.json();
      } finally {clearTimeout(timer);}
    }
    const rpc=(name,token,body={})=>request('/rest/v1/rpc/'+name,body,token);
    function signInView(message='') {
      document.querySelector('.sticky-nav').hidden=true;
      main.innerHTML='<div class="pagehead"><h1>Live Market Preview</h1></div><div class="notice">Development access only. Sign in with your existing verified test account. Virtual Tokens only; test predictions may be placed.</div><form id="liveLogin" class="shell-section"><label class="form-label" for="liveEmail">Email</label><input class="field" id="liveEmail" type="email" autocomplete="username" required><label class="form-label" for="livePassword">Password</label><input class="field" id="livePassword" type="password" autocomplete="current-password" required><button class="btn fill" style="margin-top:14px" type="submit">Sign In</button><p id="liveLoginStatus" role="status">'+safe(message)+'</p></form><p class="fineprint">Credentials go directly to Supabase. This preview does not persist the session on this device.</p>';
      document.getElementById('liveLogin').addEventListener('submit',async e=>{
        e.preventDefault();
        const form=e.currentTarget, btn=form.querySelector('button'), password=document.getElementById('livePassword');
        if(btn.disabled)return;btn.disabled=true;
        document.getElementById('liveLoginStatus').textContent='Signing in\u2026';
        try {
          const data=await request('/auth/v1/token?grant_type=password',{email:document.getElementById('liveEmail').value.trim(),password:password.value});
          if(!data.access_token)throw Error('Missing session');
          state.token=data.access_token;state.generation++;password.value='';
          renderShell();await refresh();
        }catch(err){password.value='';btn.disabled=false;const status=document.getElementById('liveLoginStatus');if(status)status.textContent='Sign-in failed. Check your test-account credentials or connection.';}
      });
    }
    function renderShell(){
      main.innerHTML='<div class="pagehead"><div><h1>Lines</h1><p id="liveUser"></p></div><button id="liveLogout" class="tiny-action">Sign Out</button></div><div class="ticker"><span>\u25cf <strong>LIVE MTA DATA</strong> \u00b7 Test trading</span></div><section class="shell-section"><div class="section-label"><h2>Choose Your Line</h2><span class="dashes"></span></div><div class="routebar"><span class="roundel" style="--bg:#00933C;--fg:white">6</span></div><div class="chiprow"><span class="chip is-on">Next Train</span></div></section><section class="shell-section"><div class="section-label"><h2>Available Markets</h2><span class="dashes"></span><button id="liveRefresh" class="tiny-action">Refresh</button></div><p id="liveStatus" role="status">Loading live markets\u2026</p><div id="liveCards" class="cards"></div><p class="fineprint">Virtual Tokens only. Independent of the MTA. Arrival evidence is evaluated using provisional test rules.</p></section>';
      document.getElementById('liveLogout').onclick=()=>logout();
      document.getElementById('liveRefresh').onclick=()=>refresh();
      const sections=[...main.querySelectorAll('section.shell-section')];
      sections.forEach(el=>el.dataset.liveLines='true');
      const portfolio=document.createElement('section');
      portfolio.id='livePortfolio';portfolio.className='shell-section';portfolio.hidden=true;
      main.appendChild(portfolio);
      const nav=document.querySelector('.sticky-nav');nav.hidden=false;
      document.getElementById('bottomNav').innerHTML='<button class="navitem is-on" id="liveLinesNav" aria-current="page"><span>Lines</span></button><button class="navitem" id="livePortfolioNav" aria-current="false"><span>Portfolio</span></button>';
      document.getElementById('liveLinesNav').onclick=()=>switchTab('lines');
      document.getElementById('livePortfolioNav').onclick=()=>switchTab('portfolio');
      state.tab='lines';
      const panel=document.createElement('div');panel.id='livePurchase';panel.hidden=true;main.appendChild(panel);
      const notice=document.createElement('p');notice.id='liveTradeNotice';notice.setAttribute('role','status');main.insertBefore(notice,main.querySelector('.ticker'));
    }
    function logout(message='Signed out.') {
      if(state.purchaseBusy)return;
      const token=state.token;state.generation++;state.token=null;state.rows=[];state.player=null;state.error='';state.updated=null;state.busy=false;state.tickets=null;state.portfolioError='';state.portfolioBusy=false;state.tab='lines';state.portfolioTab='active';state.purchase=null;state.purchaseBusy=false;state.notice='';
      document.getElementById('headerBalance').textContent='\u2014';signInView(message);
      if(token)fetch(url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token}}).catch(()=>{});
    }
    function visibleRows(){
      const now=Date.now()+state.offset;
      return state.rows.filter(r=>Date.parse(r.lock_at)>now&&r.quotes.YES&&r.quotes.NO&&['YES','NO'].every(side=>Date.parse(r.quotes[side].quote_expires_at)>now));
    }
    function renderRows(){
      if(!state.token||!document.getElementById('liveCards')||state.tab!=='lines')return;
      const now=Date.now()+state.offset, rows=visibleRows();
      document.getElementById('liveStatus').textContent=state.error||(!state.updated?'Loading live markets...':rows.length?rows.length+' live test markets | Updated '+time(state.updated)+' ET':'No fresh tradable markets right now. Checking again automatically.');
      document.getElementById('liveCards').innerHTML=rows.map((r,i)=>{
        const lock=Math.max(0,Math.ceil((Date.parse(r.lock_at)-now)/1000));
        return '<article class="market-card"><div class="card-flex"><div class="card-info"><div class="card-question">'+bullet+'<span class="card-title">'+safe(r.question)+'</span></div><div class="card-meta">'+safe(r.station)+' | '+safe(r.direction)+' | Locks in '+Math.floor(lock/60)+':'+String(lock%60).padStart(2,'0')+'</div></div><div class="card-side-buttons">'+['YES','NO'].map(side=>'<button class="pricebtn '+(side==='NO'?'no':'')+'" data-market="'+i+'" data-pick="'+side+'" '+(state.purchase?'disabled':'')+'>'+side+' <b>'+fmt(r.quotes[side].ask_ppm)+'</b></button>').join('')+'</div></div></article>';
      }).join('');
      document.getElementById('liveCards').querySelectorAll('[data-pick]').forEach(btn=>btn.onclick=()=>openPurchase(rows[Number(btn.dataset.market)],btn.dataset.pick));
      updatePurchase();
    }
    function groupMarkets(raw){
      const grouped=new Map();
      for(const q of raw){
        const r=q.rule_snapshot||{};
        if(r.environment!=='test'||r.route_id!=='6'||!r.research_market_id||!['YES','NO'].includes(q.side)||!Number.isInteger(q.ask_ppm)||q.ask_ppm<1||q.ask_ppm>999999||!q.quote_id||!q.market_id||!Number.isFinite(Date.parse(q.quote_expires_at))||!Number.isFinite(Date.parse(q.lock_at)))continue;
        if(!grouped.has(q.market_id))grouped.set(q.market_id,{market_id:q.market_id,question:r.question||q.market_name,station:r.station_name,direction:r.direction,lock_at:q.lock_at,quotes:{}});
        grouped.get(q.market_id).quotes[q.side]=q;
      }
      return [...grouped.values()];
    }
    function openPurchase(r,side){
      if(!r||state.purchase||state.purchaseBusy)return;
      const q=r.quotes[side];if(!q)return;
      state.purchase={market:r,side,quote:q,stake:10,key:crypto.randomUUID(),uncertain:false};
      const el=document.getElementById('livePurchase');el.hidden=false;
      el.innerHTML='<section class="shell-section" style="border:2px solid #b89a50;padding:16px;margin:12px 0"><div class="section-label"><h2>Punch Your Ticket</h2><button class="tiny-action" id="liveCancel">Cancel</button></div><p>'+safe(r.question)+'</p><p><strong>'+side+' | '+fmt(q.ask_ppm)+'</strong></p><label for="liveStake">Stake (10-250 Tokens)</label><input class="field" type="number" id="liveStake" value="10" min="10" max="250" step="1" inputmode="numeric"><div class="chiprow">'+[10,25,50,100,250].map(n=>'<button class="chip" data-stake="'+n+'">'+n+' T</button>').join('')+'</div><p id="liveReturn"></p><p id="liveQuoteStatus" role="status"></p><label for="livePunch">Swipe to punch (slide all the way right)</label><input id="livePunch" type="range" min="0" max="100" value="0" style="width:100%;accent-color:#00933c;touch-action:pan-y"><button class="btn fill" id="liveConfirm" type="button">Confirm Prediction</button><button class="btn" id="liveRetry" hidden type="button">Retry same request</button><p class="fineprint">Virtual Tokens only. Your quoted price never changes silently. If it expires, select a fresh quote.</p></section>';
      const stake=document.getElementById('liveStake');stake.oninput=()=>{state.purchase.stake=Number(stake.value);updatePurchase();};
      el.querySelectorAll('[data-stake]').forEach(b=>b.onclick=()=>{stake.value=b.dataset.stake;stake.oninput();});
      document.getElementById('liveCancel').onclick=()=>closePurchase();
      document.getElementById('livePunch').onchange=e=>{if(Number(e.target.value)===100)submitPurchase();else e.target.value=0;};
      document.getElementById('liveConfirm').onclick=()=>submitPurchase();
      document.getElementById('liveRetry').onclick=()=>submitPurchase(true);
      updatePurchase();el.scrollIntoView({block:'nearest',behavior:'smooth'});
    }
    function closePurchase(){
      if(state.purchaseBusy||state.purchase?.uncertain)return;
      state.purchase=null;const el=document.getElementById('livePurchase');if(el){el.hidden=true;el.innerHTML='';}renderRows();
    }
    function purchaseValid(p){
      const now=Date.now()+state.offset;
      const current=visibleRows().find(r=>r.market_id===p.market.market_id)?.quotes[p.side];
      return !state.error&&current?.quote_id===p.quote.quote_id&&Date.parse(p.quote.quote_expires_at)>now&&Number.isInteger(p.stake)&&p.stake>=10&&p.stake<=250&&p.stake*100<=Number(state.player?.available_minor);
    }
    function updatePurchase(){
      const p=state.purchase;if(!p||!document.getElementById('livePunch'))return;
      const valid=purchaseValid(p), gross=Math.floor(p.stake*100*1000000/p.quote.ask_ppm+0.5);
      document.getElementById('liveReturn').textContent=Number.isInteger(p.stake)&&p.stake>=10&&p.stake<=250?'Potential return: '+tokens(gross)+' | Potential profit: '+signed(gross-p.stake*100):'Enter a valid stake.';
      document.getElementById('liveQuoteStatus').textContent=state.purchaseBusy?'Submitting...':p.uncertain?'Result unknown. Retry the same request to avoid a duplicate ticket.':p.failure||(!valid?'Quote changed, expired, or stake unavailable. Cancel and choose a fresh quote.':'Quote expires '+time(p.quote.quote_expires_at)+' ET');
      for(const id of ['livePunch','liveConfirm'])document.getElementById(id).disabled=!valid||state.purchaseBusy||p.uncertain||!!p.failure;
      document.getElementById('liveCancel').disabled=state.purchaseBusy||p.uncertain;
      document.getElementById('liveRetry').hidden=!p.uncertain;document.getElementById('liveRetry').disabled=state.purchaseBusy;
      document.getElementById('liveStake').disabled=state.purchaseBusy||p.uncertain;
      document.getElementById('livePurchase').querySelectorAll('[data-stake]').forEach(b=>b.disabled=state.purchaseBusy||p.uncertain);
    }
    async function submitPurchase(retry=false){
      const p=state.purchase;if(!p||state.purchaseBusy||(!retry&&(!purchaseValid(p)||p.uncertain||p.failure))||(retry&&!p.uncertain))return;
      const gen=state.generation;state.purchaseBusy=true;updatePurchase();
      try{
        const id=await rpc('purchase_my_prediction',state.token,{p_request_key:p.key,p_quote:p.quote.quote_id,p_stake_minor:p.stake*100});
        if(gen!==state.generation)return;
        if(typeof id!=='string'||!id)throw Error('Unconfirmed purchase');
        state.purchaseBusy=false;p.uncertain=false;closePurchase();
        state.notice='Ticket punched! '+p.side+' | '+tokens(p.stake*100);document.getElementById('liveTradeNotice').textContent=state.notice;
        state.player=null;document.getElementById('headerBalance').textContent='-';state.portfolioTab='active';switchTab('portfolio');
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===400||e.status===409||e.status===422){p.uncertain=false;p.failure='Prediction rejected. Refresh and choose a fresh quote.';}
        else {p.uncertain=true;}
      }finally{if(gen===state.generation){state.purchaseBusy=false;updatePurchase();}}
    }
    async function refresh(){
      if(!state.token||state.busy||document.hidden||state.tab!=='lines')return;
      const gen=state.generation,token=state.token;state.busy=true;
      
      try{
        const [rows,players]=await Promise.all([rpc('get_open_markets',token),rpc('get_my_player',token)]);
        if(gen!==state.generation)return;
        if(!Array.isArray(rows)||!Array.isArray(players)||players.length!==1)throw Error('Unexpected response');
        state.player=players[0];
        state.rows=groupMarkets(rows);
        state.updated=new Date(Date.now()+state.offset).toISOString();state.error='';
        document.getElementById('liveUser').textContent=state.player.username+' \u00b7 Test account required for market access';
        document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:2});
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401||e.status===403){logout('Session expired or access unavailable. Sign in again.');return;}
        state.rows=[];state.error='Live data unavailable. Retrying automatically.';document.getElementById('headerBalance').textContent='\u2014';
      }finally{if(gen===state.generation){state.busy=false;renderRows();}}
    }
    const tokens=v=>v==null||!Number.isFinite(Number(v))?'\u2014':(Number(v)/100).toLocaleString('en-US',{maximumFractionDigits:2})+' T';
    const signed=v=>v==null||!Number.isFinite(Number(v))?'\u2014':(Number(v)>0?'+':'')+tokens(v);
    const tone=v=>v==null?'':Number(v)>0?'up':Number(v)<0?'down':'';
    const dateTime=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'\u2014';
    const completed=t=>['WON','LOST','VOIDED','CASHED_OUT'].includes(t.status);
    function switchTab(tab){
      if(tab==='portfolio'&&state.purchase){if(state.purchaseBusy||state.purchase.uncertain)return;closePurchase();}
      state.tab=tab;
      main.querySelector('.pagehead h1').textContent=tab==='lines'?'Lines':'Portfolio';
      main.querySelectorAll('[data-live-lines]').forEach(el=>el.hidden=tab!=='lines');
      main.querySelector('.ticker').hidden=tab!=='lines';
      document.getElementById('livePortfolio').hidden=tab!=='portfolio';
      for(const [id,name] of [['liveLinesNav','lines'],['livePortfolioNav','portfolio']]){
        const el=document.getElementById(id);el.classList.toggle('is-on',tab===name);el.setAttribute('aria-current',tab===name?'page':'false');
      }
      if(tab==='portfolio'){renderPortfolio();refreshPortfolio();}else{renderRows();refresh();}
    }
    function renderPortfolio(){
      const el=document.getElementById('livePortfolio');if(!el||state.tab!=='portfolio')return;
      const expanded=new Set([...el.querySelectorAll('details[data-ticket][open]')].map(d=>d.dataset.ticket));
      const evidenceOpen=new Set([...el.querySelectorAll('details[data-evidence][open]')].map(d=>d.dataset.evidence));
      const all=state.tickets||[], history=all.filter(completed), active=all.filter(t=>!completed(t));
      const net=history.every(t=>t.net_minor!=null&&Number.isFinite(Number(t.net_minor)))?history.reduce((n,t)=>n+Number(t.net_minor),0):null;
      const risk=active.reduce((n,t)=>n+Number(t.stake_minor),0);
      const ready=state.tickets!==null&&!state.portfolioError;
      const selected=state.portfolioTab==='active'?active:history;
      const detail=(label,value,cls='')=>'<div class="detail-line"><span>'+safe(label)+'</span><strong class="'+cls+'">'+safe(value)+'</strong></div>';
      el.innerHTML='<div class="notice">Backend tickets \u00b7 Test predictions are labeled. Live MTA predictions use provisional settlement rules.</div><div class="summary-grid" style="margin-top:14px"><div class="summary-box"><small>Available Tokens</small><strong>'+safe(tokens(state.player?.available_minor))+'</strong></div><div class="summary-box"><small>Open stake</small><strong>'+safe(ready?tokens(risk):'\u2014')+'</strong></div><div class="summary-box"><small>Realized P/L</small><strong class="'+(ready?tone(net):'')+'">'+safe(ready?signed(net):'\u2014')+'</strong></div></div><div class="chiprow" style="margin:18px 0 12px" role="group" aria-label="Portfolio filter"><button id="liveActive" class="chip '+(state.portfolioTab==='active'?'is-on':'')+'" aria-pressed="'+(state.portfolioTab==='active')+'">Active'+(ready?' ('+active.length+')':'')+'</button><button id="liveHistory" class="chip '+(state.portfolioTab==='history'?'is-on':'')+'" aria-pressed="'+(state.portfolioTab==='history')+'">History'+(ready?' ('+history.length+')':'')+'</button><button id="livePortfolioRefresh" class="tiny-action" '+(state.portfolioBusy?'disabled':'')+'>Refresh</button></div>'+
      (state.portfolioError?'<div class="empty" role="status">Portfolio unavailable. Try refreshing.</div>':!ready?'<div class="empty" role="status">Loading tickets\u2026</div>':!selected.length?'<div class="empty">'+(state.portfolioTab==='active'?'No active predictions yet.':'No completed predictions yet.')+'</div>':selected.map(t=>{
        const done=completed(t), id=safe(t.ticket_id), test=t.environment==='test';
        const badge=t.status==='WON'?'win':t.status==='LOST'?'loss':done?'void':'pending';
        const pnl=done?'<strong class="'+tone(t.net_minor)+'">'+safe(signed(t.net_minor))+'</strong>':'';
        const status=done?t.status:(['LOCKED','VERIFYING'].includes(t.market_status)?t.market_status:t.status);
        return '<details class="ticket" data-ticket="'+id+'" '+(expanded.has(t.ticket_id)?'open':'')+'><summary class="ticket-top" style="cursor:pointer;list-style:none"><div class="txt"><h3>'+safe(t.market_question||t.market_name||'Prediction')+'</h3><p>'+safe([t.station_name,t.route_id?'Line '+t.route_id:null,test?'TEST PREDICTION':null,t.side].filter(Boolean).join(' \u00b7 '))+'</p></div><div class="right"><span class="badge '+badge+'">'+safe(status)+(t.status==='WON'?' <span style="color:var(--gold)">\u2605</span>':'')+'</span>'+pnl+'</div><span aria-hidden="true">\u2304</span></summary><div class="ticket-detail">'+detail('Pick',t.side+' \u00b7 '+fmt(t.ask_ppm))+detail('Risked',tokens(t.stake_minor))+detail(done?'Returned':'Potential return',tokens(done?t.returned_minor:t.gross_win_minor))+detail(done?'Net':'Potential profit',done?signed(t.net_minor):signed(Number(t.gross_win_minor)-Number(t.stake_minor)),done?tone(t.net_minor):'')+detail('Accepted',dateTime(t.accepted_at))+(done?detail('Closed',dateTime(t.closed_at))+'<details class="history-explain" data-evidence="'+id+'" '+(evidenceOpen.has(t.ticket_id)?'open':'')+'><summary>How Was This Decided?</summary>'+(test?'<p>Backend test settlement; not verified MTA data.</p>':'')+detail('Outcome',t.outcome||'Not supplied')+detail('Reason',t.reason_code||'Not supplied')+(t.evidence&&Object.keys(t.evidence).length?'<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+safe(JSON.stringify(t.evidence,null,2))+'</pre>':'<p>No additional evidence recorded.</p>')+'</details>':'')+'</div></details>';
      }).join(''));
      document.getElementById('liveActive').onclick=()=>{state.portfolioTab='active';renderPortfolio();};
      document.getElementById('liveHistory').onclick=()=>{state.portfolioTab='history';renderPortfolio();};
      document.getElementById('livePortfolioRefresh').onclick=()=>refreshPortfolio();
    }
    async function refreshPortfolio(){
      if(!state.token||state.portfolioBusy||document.hidden||state.tab!=='portfolio')return;
      const gen=state.generation;state.portfolioBusy=true;
      try{
        const [tickets,players]=await Promise.all([rpc('get_my_portfolio',state.token),rpc('get_my_player',state.token)]);
        if(gen!==state.generation)return;
        if(!Array.isArray(tickets)||!Array.isArray(players)||players.length!==1)throw Error('Unexpected portfolio response');
        state.tickets=tickets;state.player=players[0];state.portfolioError='';
        document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:2});
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401||e.status===403){logout('Session expired or access unavailable. Sign in again.');return;}
        state.tickets=null;state.portfolioError='Unavailable';
      }finally{if(gen===state.generation){state.portfolioBusy=false;renderPortfolio();}}
    }
    signInView();
    setInterval(()=>{if(state.token&&!document.hidden)renderRows();},1000);
    setInterval(()=>{if(state.tab==='portfolio')refreshPortfolio();else refresh();},10000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.tab==='portfolio')refreshPortfolio();else{renderRows();refresh();}}});
    return true;
