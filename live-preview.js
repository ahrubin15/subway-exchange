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
    const restored=new URLSearchParams(location.search).get('classic')!=='0';
    const state = {token:null, rows:[], player:null, offset:0, error:'', busy:false, generation:0, updated:null,tab:'lines',portfolioTab:'active',tickets:null,portfolioError:'',portfolioBusy:false,purchase:null,purchaseBusy:false,notice:'',board:new Map(),toastTimer:null,settlementSeen:null,expandedTickets:new Set(),evidenceTickets:new Set()};
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
          renderShell();await Promise.all([refresh(),refreshPortfolio()]);
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
      document.getElementById('bottomNav').innerHTML='<button class="navitem is-on" id="liveLinesNav" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 18V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v12H5ZM5 11h14M8 16h2m4 0h2M7 21l2-3m8 3-2-3"/></svg><span>Lines</span></button><button class="navitem" id="livePortfolioNav" aria-current="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M3 10h18m-12-4V4h6v2m-4 9h4"/></svg><span>Portfolio</span></button>';
      document.getElementById('liveLinesNav').onclick=()=>switchTab('lines');
      document.getElementById('livePortfolioNav').onclick=()=>switchTab('portfolio');
      state.tab='lines';
      const panel=document.createElement('div');panel.id='livePurchase';panel.hidden=true;(restored?document.getElementById('overlays'):main).appendChild(panel);
      if(restored)restoreLines();
      const notice=document.createElement('p');notice.id='liveTradeNotice';notice.setAttribute('role','status');main.insertBefore(notice,main.querySelector('.ticker'));
    }
    function logout(message='Signed out.') {
      if(state.purchaseBusy||state.purchase?.uncertain)return;
      document.getElementById('livePurchase')?.remove();document.body.classList.remove('modal-open');
      const token=state.token;state.generation++;state.token=null;state.rows=[];state.board.clear();clearTimeout(state.toastTimer);const toastSlot=document.getElementById('toastSlot');if(toastSlot)toastSlot.innerHTML='';state.settlementSeen=null;state.expandedTickets.clear();state.evidenceTickets.clear();state.player=null;state.error='';state.updated=null;state.busy=false;state.tickets=null;state.portfolioError='';state.portfolioBusy=false;state.tab='lines';state.portfolioTab='active';state.purchase=null;state.purchaseBusy=false;state.notice='';
      document.getElementById('headerBalance').textContent='\u2014';signInView(message);
      if(token)fetch(url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token}}).catch(()=>{});
    }
    function visibleRows(){
      const now=Date.now()+state.offset;
      return state.rows.filter(r=>Date.parse(r.lock_at)>now&&r.quotes.YES&&r.quotes.NO&&['YES','NO'].every(side=>Date.parse(r.quotes[side].quote_expires_at)>now));
    }
    function renderRows(){
      if(restored)return renderClassicRows();
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
      if(restored)return openClassic(r,side);
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
      state.purchase=null;document.body.classList.remove('modal-open');const el=document.getElementById('livePurchase');if(el){el.hidden=true;el.innerHTML='';}renderRows();
    }
    function purchaseValid(p){
      if(!p.quote)return false;
      const now=Date.now()+state.offset;
      const current=visibleRows().find(r=>r.market_id===p.market.market_id)?.quotes[p.side];
      return !state.error&&current?.quote_id===p.quote.quote_id&&Date.parse(p.quote.quote_expires_at)>now&&Number.isInteger(p.stake)&&p.stake>=10&&p.stake<=250&&p.stake*100<=Number(state.player?.available_minor);
    }
    function updatePurchase(){
      if(restored)return updateClassic();
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
        state.purchaseBusy=false;p.uncertain=false;closePurchase();if(restored)showClassicTrain();
        if(state.settlementSeen)state.settlementSeen.set(id,'OPEN');
        showToast('Ticket punched! '+p.side+' | '+tokens(p.stake*100));
        state.player=null;document.getElementById('headerBalance').textContent='-';state.portfolioTab='active';state.tickets=null;switchTab('lines');refresh();refreshPortfolio();
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===400||e.status===409||e.status===422){p.uncertain=false;p.failure='Prediction rejected. Checking the latest market status.';refresh();}
        else {p.uncertain=true;}
      }finally{if(gen===state.generation){state.purchaseBusy=false;const fill=document.getElementById('swipeProgress');if(fill){fill.style.opacity='0';fill.style.height='0';}updatePurchase();}}
    }
    async function refresh(){
      if(!state.token||state.busy||document.hidden||state.tab!=='lines')return;
      const gen=state.generation,token=state.token;state.busy=true;
      
      try{
        const [rows,players]=await Promise.all([rpc('get_open_markets',token),rpc('get_my_player',token)]);
        if(gen!==state.generation)return;
        if(!Array.isArray(rows)||!Array.isArray(players)||players.length!==1)throw Error('Unexpected response');
        if(state.tab!=='lines')return;
        state.player=players[0];
        state.rows=groupMarkets(rows);
        for(const r of state.rows)state.board.set(r.market_id,r);
        state.updated=new Date(Date.now()+state.offset).toISOString();state.error='';
        document.getElementById('liveUser').textContent=state.player.username+' \u00b7 Test account required for market access';
        document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:2});
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401||e.status===403){logout('Session expired or access unavailable. Sign in again.');return;}
        state.error='Live data unavailable. Retrying automatically.';document.getElementById('headerBalance').textContent='\u2014';
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
    const minor=v=>v==null||!Number.isFinite(Number(v))?NaN:Number(v);
    const signedCash=v=>Number.isFinite(minor(v))?(minor(v)>0?'+':minor(v)<0?'\u2212':'')+cash(Math.abs(minor(v))):'\u2014';
    function ticketEvidence(t){
      const e=t.evidence||{}, a=e.arrival_evidence||{};
      if(!e.research_market_id)return '<p>Test settlement. No live arrival evidence is associated with this ticket.</p>';
      const reason={WINDOW_BEFORE_DEADLINE:'The entire observed arrival window was at or before the prediction deadline.',WINDOW_AFTER_DEADLINE:'The entire observed arrival window was after the prediction deadline.',WINDOW_STRADDLES_DEADLINE:'The arrival window crossed the deadline, so the result was uncertain and the stake was refunded.',NO_STOPPED_EVIDENCE:'No qualifying stopped-train observation was available. The stake was refunded.',STOPPED_ONLY:'A stopped train was observed, but there was no qualifying preceding observation to establish arrival.',IDENTITY_CONFLICT:'The observations could not be confidently matched to the same train.',STOPPED_BEFORE_GENERATION:'The stopped observation predates market creation.'}[t.reason_code]||'The recorded evidence was evaluated using the test settlement rules.';
      return `<p>${safe(reason)}</p><div class="rule"><strong>Outcome:</strong> ${safe(t.outcome||'Not supplied')}</div>${a.window_start&&a.window_end?`<div class="rule"><strong>Observed arrival window:</strong> ${safe(dateTime(a.window_start))} to ${safe(dateTime(a.window_end))}</div>`:''}${a.estimated_arrival_at?`<div class="rule"><strong>Estimated arrival:</strong> ${safe(new Date(a.estimated_arrival_at).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'}))} ET (estimate, not an exact verified arrival)</div>`:''}<p class="fineprint">Source: MTA real-time observations. Conservative test rules; uncertain evidence is voided.</p>`;
    }
    function renderPortfolio(){
      const el=document.getElementById('livePortfolio');if(!el||state.tab!=='portfolio')return;
      const all=state.tickets||[], history=all.filter(completed).sort((a,b)=>Date.parse(b.closed_at)-Date.parse(a.closed_at)), active=all.filter(t=>!completed(t));
      const ready=state.tickets!==null, risk=active.reduce((n,t)=>n+minor(t.stake_minor),0), balance=minor(state.player?.available_minor);
      const selected=state.portfolioTab==='active'?active:history;
      const detail=(label,value,cls='')=>`<div class="detail-line"><span>${safe(label)}</span><strong class="${cls}">${value}</strong></div>`;
      const card=t=>{
        const done=completed(t), id=safe(t.ticket_id), expanded=state.expandedTickets.has(t.ticket_id), ev=state.evidenceTickets.has(t.ticket_id);
        const status=done?t.status:['LOCKED','VERIFYING'].includes(t.market_status)?t.market_status:'AWAITING';
        const badge=t.status==='WON'?'win':t.status==='LOST'?'loss':done?'void':'pending';
        const question=safe(t.market_question||t.market_name||'Your prediction');
        const r=state.board.get(t.market_id), countdown=!done&&r&&status==='AWAITING'&&Date.parse(r.lock_at)>Date.now()?` \u00b7 Locks in ${lockText(r)}`:'';
        return `<div class="ticket" data-ticket="${id}"><div class="ticket-top">${classicBullet(t.route_id||'S','small')}<div class="txt"><h3>${question} \u00b7 <span class="pick-side">${safe(t.side)}</span></h3><p>${safe(t.station_name||'Test market')} \u00b7 Risked ${cash(minor(t.stake_minor))}${countdown}</p></div><div class="right"><span class="badge ${badge}">${safe(status)}${t.status==='WON'?' <span style="color:#FFCB23">\u2605</span>':''}</span>${done?`<strong class="${tone(t.net_minor)}" style="margin-top:6px">${signedCash(t.net_minor)}</strong>`:''}</div></div><button class="ticket-expand" data-expand-ticket="${id}" aria-expanded="${expanded}">${expanded?'\u25be':'\u25b8'} Ticket Details</button>${expanded?`<div class="ticket-detail"><p>${question}</p>${detail('Your pick',safe(t.side)+' \u00b7 '+safe(fmt(t.ask_ppm)))}${detail('Risked',cash(minor(t.stake_minor)))}${detail(done?'Returned':'Potential return',cash(minor(done?t.returned_minor:t.gross_win_minor)))}${detail(done?'Net':'Potential profit',signedCash(done?t.net_minor:minor(t.gross_win_minor)-minor(t.stake_minor)),done?tone(t.net_minor):'')}${detail('Accepted',safe(dateTime(t.accepted_at)))}${done?detail('Closed',safe(dateTime(t.closed_at)))+`<details class="history-explain" data-evidence="${id}" ${ev?'open':''}><summary>How Was This Decided?</summary>${ticketEvidence(t)}</details>`:`<div class="notice">${status==='VERIFYING'?'Checking MTA arrival evidence.':status==='LOCKED'?'Market locked. Waiting for the result.':'Awaiting event lock.'} Results settle automatically when evidence is evaluated. Cash-out is not yet available.</div>`}</div>`:''}</div>`;
      };
      const markup=`<div class="summary-grid"><div class="summary-box"><small>Portfolio Value*</small><strong>${ready?cash(balance+risk):'\u2014'}</strong></div><div class="summary-box"><small>Available</small><strong>${cash(balance)}</strong></div><div class="summary-box"><small>At Risk</small><strong>${ready?cash(risk):'\u2014'}</strong></div></div><p class="intro-note">*Unresolved tickets are valued at their original stake, not a cash-out quote.</p><div class="segment" style="margin-top:18px"><button id="liveActive" class="${state.portfolioTab==='active'?'is-on':''}" aria-pressed="${state.portfolioTab==='active'}">Open &amp; Waiting${ready?' ('+active.length+')':''}</button><button id="liveHistory" class="${state.portfolioTab==='history'?'is-on':''}" aria-pressed="${state.portfolioTab==='history'}">History${ready?' ('+history.length+')':''}</button></div>${state.portfolioError?'<p role="status" class="notice">Portfolio refresh unavailable. Displayed values may be stale.</p>':''}${!ready?'<div class="empty" role="status">Loading tickets\u2026</div>':selected.length?selected.map(card).join(''):`<div class="empty"><h3>No Tickets on the Tracks</h3><p>${state.portfolioTab==='active'?'Your next prediction is waiting in Lines.':'Settled and voided tickets will show up here.'}</p><button class="btn" id="exploreMarkets">Explore Markets \u2192</button></div>`}<p class="fineprint">Private test account \u00b7 Virtual Tokens only</p>`;
      if(el.dataset.rendered===markup)return;
      const focused=document.activeElement?.closest('[data-expand-ticket]');const focusedId=focused?.dataset.expandTicket;
      el.dataset.rendered=markup;el.innerHTML=markup;
      document.getElementById('liveActive').onclick=()=>{state.portfolioTab='active';renderPortfolio();};
      document.getElementById('liveHistory').onclick=()=>{state.portfolioTab='history';renderPortfolio();};
      el.querySelector('#exploreMarkets')?.addEventListener('click',()=>switchTab('lines'));
      el.querySelectorAll('[data-expand-ticket]').forEach(btn=>btn.onclick=()=>{const id=btn.dataset.expandTicket;if(state.expandedTickets.has(id))state.expandedTickets.delete(id);else state.expandedTickets.add(id);renderPortfolio();});
      if(focusedId){[...el.querySelectorAll('[data-expand-ticket]')].find(b=>b.dataset.expandTicket===focusedId)?.focus({preventScroll:true});}
      el.querySelectorAll('[data-evidence]').forEach(d=>d.addEventListener('toggle',()=>{if(!d.isConnected)return;if(d.open)state.evidenceTickets.add(d.dataset.evidence);else state.evidenceTickets.delete(d.dataset.evidence);}));
    }
    function observeSettlements(tickets){
      const previous=state.settlementSeen;state.settlementSeen=new Map(tickets.map(t=>[t.ticket_id,t.status]));
      if(!previous)return;
      const settled=tickets.filter(t=>completed(t)&&previous.has(t.ticket_id)&&!['WON','LOST','VOIDED','CASHED_OUT'].includes(previous.get(t.ticket_id)));
      if(!settled.length)return;
      if(settled.length>1){showToast(`${settled.length} tickets settled \u00b7 ${settled.filter(t=>t.status==='WON').length} won, ${settled.filter(t=>t.status==='LOST').length} lost, ${settled.filter(t=>t.status==='VOIDED').length} refunded`);return;}
      const t=settled[0];showToast(t.status==='WON'?'Your ticket won! '+signed(t.net_minor):t.status==='VOIDED'?'Ticket voided \u00b7 '+tokens(t.returned_minor)+' refunded':t.status==='LOST'?'Ticket settled \u00b7 '+signed(t.net_minor):'Ticket settled');
    }
    async function refreshPortfolio(){
      if(!state.token||state.portfolioBusy||document.hidden)return;
      const gen=state.generation, startedTab=state.tab;state.portfolioBusy=true;
      try{
        const [tickets,players]=await Promise.all([rpc('get_my_portfolio',state.token),startedTab==='portfolio'?rpc('get_my_player',state.token):Promise.resolve(null)]);
        if(gen!==state.generation)return;
        if(!Array.isArray(tickets)||(players&&(!Array.isArray(players)||players.length!==1)))throw Error('Unexpected portfolio response');
        observeSettlements(tickets);state.tickets=tickets;state.portfolioError='';
        if(players&&state.tab==='portfolio'){state.player=players[0];document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:2});}
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401||e.status===403){logout('Session expired or access unavailable. Sign in again.');return;}
        state.portfolioError='Unavailable';
      }finally{if(gen===state.generation){state.portfolioBusy=false;renderPortfolio();}}
    }

    const routeColors={ALL:'#3e526a','1':'#EE352E','2':'#EE352E','3':'#EE352E','4':'#00933C','5':'#00933C','6':'#00933C','7':'#B933AD',A:'#0039A6',C:'#0039A6',E:'#0039A6',B:'#FF6319',D:'#FF6319',F:'#FF6319',M:'#FF6319',G:'#6CBE45',J:'#996633',Z:'#996633',L:'#A7A9AC',N:'#FCCC0A',Q:'#FCCC0A',R:'#FCCC0A',W:'#FCCC0A',S:'#808183'};
    const classicBullet=(r,size='')=>`<span class="roundel ${size}" style="--bg:${routeColors[r]||'#3e526a'};--fg:${['N','Q','R','W'].includes(r)?'#17253a':'#fff'}">${safe(r)}</span>`;
    const tokenMark=()=>'<svg class="mini-token" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="#FFCB23"/><circle cx="20" cy="20" r="13.5" fill="none" stroke="#B78308" stroke-width="2"/></svg>';
    const cash=n=>Number.isFinite(n)?`<span class="money-inline">${tokenMark()}<span>${(n/100).toLocaleString('en-US',{maximumFractionDigits:2})}</span></span>`:'\u2014';
    const lockText=r=>{const n=Math.max(0,Math.ceil((Date.parse(r.lock_at)-Date.now()-state.offset)/1000));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
    function restoreLines(){
      const sections=main.querySelectorAll('[data-live-lines]');
      sections[0].classList.add('filters-section');
      sections[0].innerHTML=`<div class="section-label"><h2>Choose Your Line</h2><span class="dashes"></span></div><div class="routebar" role="group" aria-label="Filter markets by subway line">${Object.keys(routeColors).sort((a,b)=>a==='ALL'?-1:b==='ALL'?1:0).map(r=>`<button class="route-filter ${r==='6'?'is-on':''}" data-route="${r}" aria-pressed="${r==='6'}" aria-label="${r==='ALL'?'All lines':'Line '+r}${['ALL','6'].includes(r)?'':' unavailable'}" ${['ALL','6'].includes(r)?'':'disabled'}>${classicBullet(r,r==='ALL'?'all':'')}</button>`).join('')}</div><div class="chiprow" role="group" aria-label="Filter markets by category">${['All Types','Next Train','Beat the MTA','Rush Hour','Line Wars'].map(t=>`<button class="chip ${t==='Next Train'?'is-on':''}" data-type="${t}" aria-pressed="${t==='Next Train'}" ${['All Types','Next Train'].includes(t)?'':'disabled'}>${t}</button>`).join('')}</div>`;
      sections[0].querySelectorAll('button:not(:disabled)').forEach(b=>b.onclick=()=>{b.parentElement.querySelectorAll('button').forEach(x=>{x.classList.toggle('is-on',x===b);x.setAttribute('aria-pressed',String(x===b));});});
      sections[1].innerHTML='<p id="liveStatus" class="fineprint" role="status"></p><div id="liveCards"></div><p class="intro-note">Live Line 6 Next Train markets only. Other lines and types are not yet available.</p><button id="liveRefresh" class="tiny-action">Refresh</button>';
      document.getElementById('liveRefresh').onclick=()=>refresh();
      const style=document.createElement('style');style.textContent='[hidden]{display:none!important}.route-filter:disabled,.chip:disabled{opacity:.4;cursor:not-allowed}#livePurchase .rh-swipe{touch-action:none}#livePurchase .rh-swipe[aria-disabled="true"]{opacity:.5;pointer-events:none}';document.head.appendChild(style);
    }
    function renderClassicRows(){
      if(!state.token||state.tab!=='lines'||!document.getElementById('liveCards'))return;
      const host=document.getElementById('liveCards'),now=Date.now()+state.offset;
      const fresh=new Map(visibleRows().map(r=>[r.market_id,r]));
      if(!host.querySelector('#boardMore'))host.innerHTML='<div id="boardFeaturedHead" class="section-label"><h2>Featured For You</h2><span class="dashes"></span></div><div class="cards" id="boardFeatured"></div><div id="boardMoreHead" class="section-label" style="margin-top:20px"><h2>More on the Board</h2><span class="dashes"></span></div><div class="cards" id="boardMore"></div><div id="boardEmpty" class="empty">'+classicBullet('6')+'<h3>No Trains on This Track</h3><p>Checking for live markets...</p></div>';
      const featured=host.querySelector('#boardFeatured'),more=host.querySelector('#boardMore');
      for(const [id,r] of state.board){
        const locked=Date.parse(r.lock_at)<=now;
        let el=[...host.querySelectorAll('[data-market]')].find(x=>x.dataset.market===id);
        if(locked&&!el){state.board.delete(id);continue;}
        if(!el){
          el=document.createElement('article');el.className='market-card';el.dataset.market=id;el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label','Open '+r.question);
          el.innerHTML=`<div class="card-flex"><div class="card-info"><div class="card-question">${classicBullet('6','small')}<span class="card-title">${safe(r.question)}</span></div><div class="card-meta">Next Train<span class="meta-lock"> &middot; <span data-lock></span></span></div></div><div class="card-side-buttons">${['YES','NO'].map(side=>`<button class="pricebtn ${side==='NO'?'no':''}" data-pick="${side}">${side} <b></b></button>`).join('')}</div></div>`;
          (featured.children.length?more:featured).append(el);
          if(!matchMedia('(prefers-reduced-motion: reduce)').matches)el.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:240});
          const open=side=>{const current=state.error?null:visibleRows().find(x=>x.market_id===id);if(current)openPurchase(current,side);};
          el.onclick=e=>open(e.target.closest('[data-pick]')?.dataset.pick||null);el.onkeydown=e=>{if(e.target===el&&['Enter',' '].includes(e.key)){e.preventDefault();open(null);}};
        }
        const q=fresh.get(id),ready=!!q&&!state.error&&!locked;
        el.querySelector('[data-lock]').textContent=locked?'Locked':ready?'Locks in '+lockText(r):'Updating odds...';
        el.setAttribute('aria-disabled',String(!ready));el.tabIndex=ready?0:-1;
        for(const b of el.querySelectorAll('[data-pick]')){b.disabled=!ready;b.querySelector('b').textContent=ready?fmt(q.quotes[b.dataset.pick].ask_ppm):'--';}
        if(locked&&!el.dataset.closing){el.dataset.closing='1';setTimeout(()=>{if(!el.isConnected)return;const h=el.getBoundingClientRect().height;if(!matchMedia('(prefers-reduced-motion: reduce)').matches){const a=el.animate([{opacity:1,maxHeight:h+'px'},{opacity:0,maxHeight:'0px',paddingTop:0,paddingBottom:0,margin:0}],{duration:300,fill:'forwards'});a.onfinish=()=>{el.remove();state.board.delete(id);renderClassicRows();};}else{el.remove();state.board.delete(id);renderClassicRows();}},800);}
      }
      if(!featured.children.length&&more.children.length)featured.append(more.firstElementChild);
      host.querySelector('#boardFeaturedHead').hidden=!featured.children.length;host.querySelector('#boardMoreHead').hidden=!more.children.length;host.querySelector('#boardEmpty').hidden=!!(featured.children.length+more.children.length);
      document.getElementById('liveStatus').textContent=state.error||(!state.updated?'Loading live markets...':fresh.size?fresh.size+' live test markets':'Checking for fresh quotes...');updateClassic();
    }
    function showToast(message){const slot=document.getElementById('toastSlot');if(!slot)return;slot.innerHTML='<div class="toast" role="status">'+safe(message)+'</div>';clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>slot.innerHTML='',3300);}
    function missedTrain(){const p=state.purchase,host=document.getElementById('livePurchase');if(!p||!host||p.stage==='missed')return;p.stage='missed';host.innerHTML='<div class="backdrop"></div><section class="modal" role="dialog" aria-modal="true" aria-label="Market locked"><div class="market-line">'+classicBullet('6')+'<h3>You Missed Your Train!</h3></div><p>This market has already locked. No Tokens were deducted. Catch the next one!</p><button class="btn fill" id="backToLines">Back to Lines</button></section>';host.querySelector('#backToLines').onclick=()=>{closePurchase();switchTab('lines');};}
    function priceOffer(p,q){const host=document.getElementById('livePurchase');p.stageBeforeOffer=p.stage==='offer'?p.stageBeforeOffer:p.stage;p.stage='offer';p.offered=q;
      const gain=x=>cash(Math.floor(p.stake*100*1000000/x.ask_ppm+.5)-p.stake*100);
      host.innerHTML=`<div class="backdrop"></div><section class="modal" role="dialog" aria-modal="true" aria-label="Odds have changed"><h3>Odds Have Changed</h3><p>Your ${safe(p.side)} price has changed.</p><div class="summary-grid"><div class="summary-box"><small>Previous price</small><strong>${fmt(p.quote.ask_ppm)}</strong><small>Profit ${gain(p.quote)}</small></div><div class="summary-box"><small>New price</small><strong>${fmt(q.ask_ppm)}</strong><small>Profit ${gain(q)}</small></div></div><p id="offerStatus" role="status"></p><button class="btn fill" id="acceptPrice">Accept New Price</button><button class="btn secondary fill" id="rejectPrice">Reject New Price</button></section>`;
      host.querySelector('#rejectPrice').onclick=()=>{closePurchase();switchTab('lines');};
      host.querySelector('#acceptPrice').onclick=()=>{const r=state.error?null:visibleRows().find(x=>x.market_id===p.market.market_id),latest=r?.quotes[p.side];if(!latest||latest.ask_ppm!==p.offered.ask_ppm){updateClassic();return;}p.quote=latest;p.market=r;p.stage=p.stageBeforeOffer;p.offered=null;p.failure='';p.key=crypto.randomUUID();renderClassicPurchase();};
    }
    function openClassic(r,side){
      if(!r||state.purchase||state.purchaseBusy)return;
      state.purchase={market:r,side,quote:side?r.quotes[side]:null,stake:25,key:crypto.randomUUID(),uncertain:false,stage:'detail',custom:false};renderClassicPurchase();
    }
    function renderClassicPurchase(){
      const p=state.purchase,host=document.getElementById('livePurchase');if(!p||!host)return;
      host.hidden=false;document.body.classList.add('modal-open');const r=p.market;
      const close='<button class="modal-close" id="liveCancel" aria-label="Close">&times;</button>';
      const summaries=`<div class="summary-grid detail-summary"><div class="summary-box"><small>Risk</small><strong id="classicRisk"></strong></div><div class="summary-box"><small>Return</small><strong id="classicReturn"></strong></div><div class="summary-box"><small>Profit</small><strong id="classicProfit"></strong></div></div>`;
      if(p.stage==='detail')host.innerHTML=`<div class="backdrop" data-live-dismiss></div><section class="modal" role="dialog" aria-modal="true" aria-label="Market details"><div class="modal-head minimal-modal-head">${close}</div><div class="market-line">${classicBullet('6')}<div><div class="card-meta">Next Train &middot; Locks in <span id="classicLock">${lockText(r)}</span></div><h3>${safe(r.question)}</h3></div></div><div class="deal-prices">${['YES','NO'].map(side=>`<button class="side-select ${side==='NO'?'no ':''}${p.side===side?'selected':''}" data-side="${side}">${side}<strong>${fmt(r.quotes[side].ask_ppm)}</strong></button>`).join('')}</div><div class="stats-booth"><div class="t">&#9734; Quick Stats</div><div class="statsgrid"><div><span>Market</span><strong>Next Train</strong></div><div><span>YES price</span><strong>${fmt(r.quotes.YES.ask_ppm)}</strong></div><div><span>Station</span><strong>${safe(r.station)}</strong></div></div><details class="history-explain"><summary>Historical Explanation</summary><p>Live odds are provisional estimates from MTA data. Historical calibration is not yet available.</p></details></div><label class="form-label">Tokens to risk ${tokenMark()}</label><div class="stakes">${[10,25,50,100].map(n=>`<button class="stake ${!p.custom&&p.stake===n?'selected':''}" data-stake="${n}">${tokenMark()} ${n}</button>`).join('')}<button class="stake ${p.custom?'selected':''}" id="liveOther">Other</button></div>${p.custom?`<label class="form-label" for="liveStake">Custom stake</label><input class="field" id="liveStake" type="number" min="10" max="250" step="1" inputmode="numeric" value="${Number.isFinite(p.stake)?p.stake:''}">`:''}<p id="liveQuoteStatus" class="stake-error" role="status"></p>${summaries}<button class="btn fill" id="reviewPick">Review My Pick</button><details class="market-rules"><summary>Market Rules</summary><div class="rule"><strong>Observation:</strong> Selected ${safe(r.direction)} 6 train at ${safe(r.station)}.</div><div class="rule"><strong>Settlement:</strong> Conservative arrival evidence; uncertain evidence causes VOID and full refund.</div><div class="rule"><strong>Source:</strong> Live MTA data, provisional test rules. Virtual Tokens only.</div></details></section>`;
      else host.innerHTML=`<div class="backdrop" data-live-dismiss></div><section class="sheet rh-sheet" role="dialog" aria-modal="true" aria-label="Review ticket"><button class="slip-back" id="liveEdit">&#8249; Edit</button><div class="slip-sub">SUBWAY EXCHANGE &middot; LIVE TEST TICKET</div><div class="slip-head">Review My Pick</div><div class="slip-stub"><div class="market-line" style="display:flex;align-items:center;gap:12px">${classicBullet('6')}<div><strong>Next Train</strong><div class="muted" style="font-size:12px;margin-top:4px">${safe(r.question)}</div></div></div><div class="detail-line"><span>Your pick</span><strong>${safe(p.side)} &middot; ${fmt(p.quote.ask_ppm)}</strong></div><div class="detail-line"><span>Risk</span><strong>${cash(p.stake*100)}</strong></div><div class="detail-line"><span>Return if correct</span><strong>${cash(Math.floor(p.stake*100*1000000/p.quote.ask_ppm+.5))}</strong></div><div class="slip-total"><span>Profit if correct</span><strong>+${cash(Math.floor(p.stake*100*1000000/p.quote.ask_ppm+.5)-p.stake*100)}</strong></div></div><p id="liveQuoteStatus" role="status"></p><div id="swipeZone" class="rh-swipe" role="button" tabindex="0" aria-label="Swipe up to punch ticket"><div class="swipe-glyph">&#8593;</div><div class="swipe-text">Swipe up to punch ticket</div><div class="swipe-sub">Slide from here to submit</div></div><button class="btn fill" id="liveRetry" hidden>Retry same request</button><p class="slip-footnote">Live MTA data &middot; No real money</p></section><div id="swipeProgress" class="swipe-progress" aria-hidden="true"></div>`;
      host.querySelector('[data-live-dismiss]').onclick=()=>closePurchase();
      const cancel=document.getElementById('liveCancel');if(cancel)cancel.onclick=()=>closePurchase();
      host.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>{if(state.purchaseBusy||p.uncertain)return;const latest=state.error?null:visibleRows().find(x=>x.market_id===r.market_id);if(!latest)return;p.side=b.dataset.side;p.quote=latest.quotes[p.side];p.market=latest;p.failure='';renderClassicPurchase();});
      host.querySelectorAll('[data-stake]').forEach(b=>b.onclick=()=>{p.stake=Number(b.dataset.stake);p.custom=false;renderClassicPurchase();});
      const other=document.getElementById('liveOther');if(other)other.onclick=()=>{p.custom=true;p.stake=NaN;renderClassicPurchase();document.getElementById('liveStake')?.focus();};
      const input=document.getElementById('liveStake');if(input)input.oninput=()=>{p.stake=input.value===''?NaN:Number(input.value);updateClassic();};
      const review=document.getElementById('reviewPick');if(review)review.onclick=()=>{if(purchaseValid(p)){p.stage='slip';renderClassicPurchase();}};
      const edit=document.getElementById('liveEdit');if(edit)edit.onclick=()=>{if(!state.purchaseBusy&&!p.uncertain){p.stage='detail';renderClassicPurchase();}};
      const retry=document.getElementById('liveRetry');if(retry)retry.onclick=()=>submitPurchase(true);
      if(p.stage==='slip')wireClassicSwipe();updateClassic();
    }
    function updateClassic(){
      const p=state.purchase;if(!p||p.stage==='missed')return;
      if(!state.purchaseBusy&&!p.uncertain){
        if(Date.parse(p.market.lock_at)<=Date.now()+state.offset){missedTrain();return;}
        const r=state.error?null:visibleRows().find(x=>x.market_id===p.market.market_id),q=r?.quotes[p.side];
        if(p.stage==='offer'){
          if(q&&q.ask_ppm!==p.offered.ask_ppm){priceOffer(p,q);return;}
          const b=document.getElementById('acceptPrice');if(b)b.disabled=!q;
          const msg=document.getElementById('offerStatus');if(msg)msg.textContent=q?'':'Updating odds...';return;
        }
        if(q&&p.quote&&q.ask_ppm!==p.quote.ask_ppm){priceOffer(p,q);return;}
        if(q&&p.quote&&q.quote_id!==p.quote.quote_id){p.quote=q;p.market=r;p.key=crypto.randomUUID();p.failure='';}
        if(r&&p.stage==='detail'){
          for(const b of document.querySelectorAll('#livePurchase [data-side]')){b.querySelector('strong').textContent=fmt(r.quotes[b.dataset.side].ask_ppm);}
        }
      }
      const status=document.getElementById('liveQuoteStatus');if(!status)return;
      const valid=purchaseValid(p),gross=valid?Math.floor(p.stake*100*1000000/p.quote.ask_ppm+.5):NaN;
      status.textContent=state.purchaseBusy?'Submitting...':p.uncertain?'Result unknown. Retry the same request.':p.failure||(!p.side?'Choose YES or NO.':!Number.isInteger(p.stake)||p.stake<10||p.stake>250?'Enter 10-250 whole Tokens.':!valid?(p.stake*100>Number(state.player?.available_minor)?'Insufficient Tokens.':'Updating odds...'):'Quote expires '+time(p.quote.quote_expires_at)+' ET');
      for(const [id,v] of [['classicRisk',p.stake*100],['classicReturn',gross],['classicProfit',gross-p.stake*100]]){const el=document.getElementById(id);if(el)el.innerHTML=cash(v);}
      const lock=document.getElementById('classicLock');if(lock)lock.textContent=lockText(p.market);
      for(const b of document.querySelectorAll('#livePurchase [data-side],#livePurchase [data-stake],#liveOther,#liveStake,#liveCancel'))b.disabled=state.purchaseBusy||p.uncertain;
      const review=document.getElementById('reviewPick');if(review)review.disabled=!valid||state.purchaseBusy||!!p.failure;
      const zone=document.getElementById('swipeZone');if(zone){zone.setAttribute('aria-disabled',String(!valid||state.purchaseBusy||p.uncertain||!!p.failure));zone.tabIndex=valid&&!p.uncertain&&!p.failure&&!state.purchaseBusy?0:-1;}
      const edit=document.getElementById('liveEdit');if(edit)edit.disabled=state.purchaseBusy||p.uncertain;
      const retry=document.getElementById('liveRetry');if(retry){retry.hidden=!p.uncertain;retry.disabled=state.purchaseBusy;}
    }
    function wireClassicSwipe(){
      const z=document.getElementById('swipeZone'),fill=document.getElementById('swipeProgress');if(!z||!fill)return;
      let y=null,id=null,progress=0,base=null,start=0,finishing=false;
      const allowed=()=>!finishing&&z.isConnected&&z.getAttribute('aria-disabled')!=='true'&&state.purchase?.stage==='slip';
      const threshold=()=>Math.min(280,Math.max(155,window.innerHeight*.3));
      const shape=d=>{progress=Math.max(0,d);fill.style.left=base.left+'px';fill.style.width=base.width+'px';fill.style.bottom=(window.innerHeight-base.bottom)+'px';fill.style.height=(base.height+progress)+'px';fill.style.opacity='1';fill.style.borderRadius='14px';z.classList.toggle('ready',progress>=threshold());};
      const reset=()=>{fill.style.opacity='0';fill.style.height='0';z.classList.remove('ready','dragging');};
      const finish=()=>{if(!allowed())return;finishing=true;const p=state.purchase;fill.style.transition=matchMedia('(prefers-reduced-motion: reduce)').matches?'none':'height .28s ease,left .28s ease,width .28s ease,bottom .28s ease,border-radius .28s ease';fill.style.opacity='1';fill.style.bottom='0';fill.style.left='0';fill.style.width='100vw';fill.style.height='100dvh';fill.style.borderRadius='0';setTimeout(()=>{finishing=false;if(state.purchase===p&&allowed()&&purchaseValid(p))submitPurchase();else reset();},matchMedia('(prefers-reduced-motion: reduce)').matches?0:300);};
      z.onpointerdown=e=>{if(!allowed())return;e.preventDefault();start=performance.now();fill.style.transition='none';base=z.getBoundingClientRect();y=e.clientY;id=e.pointerId;shape(0);z.setPointerCapture(id);z.classList.add('dragging');};
      z.onpointermove=e=>{if(y===null||id!==e.pointerId)return;e.preventDefault();shape(y-e.clientY);};
      z.onpointerup=e=>{if(y===null||id!==e.pointerId)return;const distance=Math.max(progress,y-e.clientY),elapsed=Math.max(1,performance.now()-start),done=distance>=threshold()||(distance>=45&&distance/elapsed>.65);y=null;id=null;if(done&&allowed())finish();else reset();};
      z.onpointercancel=()=>{y=null;id=null;reset();};
      z.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();if(allowed())finish();}};
    }
    function showClassicTrain(){const el=document.createElement('div');el.className='train-overlay';el.innerHTML='<div class="train-stage"><div class="train"><div class="trainwindow"></div><div class="trainwindow"></div>'+classicBullet('6')+'<div class="trainwindow"></div></div></div><div class="train-label">TICKET PUNCHED</div>';document.body.appendChild(el);setTimeout(()=>el.remove(),2700);}

    signInView();
    setInterval(()=>{if(state.token&&!document.hidden){if(state.tab==='portfolio')renderPortfolio();else renderRows();}},1000);
    setInterval(()=>{if(state.tab==='lines')refresh();refreshPortfolio();},5000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.tab==='portfolio')refreshPortfolio();else{renderRows();refresh();refreshPortfolio();}}});
    return true;
  }
};
