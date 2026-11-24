/* Subway Exchange development live preview. No writes to game state. */
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
    const state = {token:null, rows:[], player:null, offset:0, error:'', busy:false, generation:0, updated:null,tab:'lines',portfolioTab:'active',tickets:null,portfolioError:'',portfolioBusy:false};
    document.title='Subway Exchange Â· Live Market Preview';
    document.querySelector('.demo-strip').textContent='PRIVATE ALPHA Â· LIVE MTA DATA Â· READ-ONLY RESEARCH MARKETS';
    for (const sel of ['#alertsBtn','.sticky-nav','.foot','.side']) {
      const el=document.querySelector(sel); if(el)el.hidden=true;
    }
    const app=document.querySelector('.app'); if(app)app.style.gridTemplateColumns='minmax(0,760px)';
    const box=document.querySelector('.tokenbox'); if(box)box.title='Backend available Tokens';
    document.getElementById('headerBalance').textContent='â';
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
    const rpc=(name,token)=>request('/rest/v1/rpc/'+name,{},token);
    function signInView(message='') {
      document.querySelector('.sticky-nav').hidden=true;
      main.innerHTML='<div class="pagehead"><h1>Live Market Preview</h1></div><div class="notice">Development access only. Sign in with your existing verified test account. No predictions can be placed.</div><form id="liveLogin" class="shell-section"><label class="form-label" for="liveEmail">Email</label><input class="field" id="liveEmail" type="email" autocomplete="username" required><label class="form-label" for="livePassword">Password</label><input class="field" id="livePassword" type="password" autocomplete="current-password" required><button class="btn fill" style="margin-top:14px" type="submit">Sign In</button><p id="liveLoginStatus" role="status">'+safe(message)+'</p></form><p class="fineprint">Credentials go directly to Supabase. This preview does not persist the session on this device.</p>';
      document.getElementById('liveLogin').addEventListener('submit',async e=>{
        e.preventDefault();
        const form=e.currentTarget, btn=form.querySelector('button'), password=document.getElementById('livePassword');
        if(btn.disabled)return;btn.disabled=true;
        document.getElementById('liveLoginStatus').textContent='Signing inâ¦';
        try {
          const data=await request('/auth/v1/token?grant_type=password',{email:document.getElementById('liveEmail').value.trim(),password:password.value});
          if(!data.access_token)throw Error('Missing session');
          state.token=data.access_token;state.generation++;password.value='';
          renderShell();await refresh();
        }catch(err){password.value='';btn.disabled=false;const status=document.getElementById('liveLoginStatus');if(status)status.textContent='Sign-in failed. Check your test-account credentials or connection.';}
      });
    }
    function renderShell(){
      main.innerHTML='<div class="pagehead"><div><h1>Lines</h1><p id="liveUser"></p></div><button id="liveLogout" class="tiny-action">Sign Out</button></div><div class="ticker"><span>â <strong>LIVE MTA RESEARCH</strong> Â· Trading disabled</span></div><section class="shell-section"><div class="section-label"><h2>Choose Your Line</h2><span class="dashes"></span></div><div class="routebar"><span class="roundel" style="--bg:#00933C;--fg:white">6</span></div><div class="chiprow"><span class="chip is-on">Next Train</span></div></section><section class="shell-section"><div class="section-label"><h2>Available Markets</h2><span class="dashes"></span><button id="liveRefresh" class="tiny-action">Refresh</button></div><p id="liveStatus" role="status">Loading live marketsâ¦</p><div id="liveCards" class="cards"></div><p class="fineprint">Research prices only. Independent of the MTA. No tickets or Token balances change when viewing.</p></section>';
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
    }
    function logout(message='Signed out.') {
      const token=state.token;state.generation++;state.token=null;state.rows=[];state.player=null;state.error='';state.updated=null;state.busy=false;state.tickets=null;state.portfolioError='';state.portfolioBusy=false;state.tab='lines';state.portfolioTab='active';
      document.getElementById('headerBalance').textContent='â';signInView(message);
      if(token)fetch(url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token}}).catch(()=>{});
    }
    function visibleRows(){
      const now=Date.now()+state.offset;
      return state.rows.filter(r=>r.trading_enabled===false&&Date.parse(r.lock_at)>now&&Date.parse(r.quote_expires_at)>now);
    }
    function renderRows(){
      if(!state.token||!document.getElementById('liveCards'))return;
      const now=Date.now()+state.offset, rows=visibleRows();
      const status=document.getElementById('liveStatus');
      const message=state.error||(!state.updated?'Loading live marketsâ¦':rows.length?rows.length+' live markets Â· Updated '+time(state.updated)+' ET':'No fresh markets right now. Checking again automatically.');
      if(status.textContent!==message)status.textContent=message;
      document.getElementById('liveCards').innerHTML=rows.map(r=>{
        const lock=Math.max(0,Math.ceil((Date.parse(r.lock_at)-now)/1000));
        const question='Will the selected '+r.direction.toLowerCase()+' 6 train arrive at '+r.station_name+' by '+time(r.outcome_deadline)+' ET?';
        return '<article class="market-card"><div class="card-flex"><div class="card-info"><div class="card-question">'+bullet+'<span class="card-title">'+safe(question)+'</span></div><div class="card-meta">Next Train Â· '+safe(r.station_name)+' Â· '+safe(r.direction)+'<span class="meta-lock"> Â· Locks in '+Math.floor(lock/60)+':'+String(lock%60).padStart(2,'0')+'</span></div><div class="card-meta">Estimated YES probability '+fmt(r.yes_probability_ppm)+' Â· Read-only</div></div><div class="card-side-buttons"><button class="pricebtn" disabled title="Research only">YES <b>'+fmt(r.yes_ask_ppm)+'</b></button><button class="pricebtn no" disabled title="Research only">NO <b>'+fmt(r.no_ask_ppm)+'</b></button></div></div></article>';
      }).join('');
    }
    async function refresh(){
      if(!state.token||state.busy||document.hidden||state.tab!=='lines')return;
      const gen=state.generation,token=state.token;state.busy=true;
      const started=Date.now();
      try{
        const [rows,players]=await Promise.all([rpc('get_research_market_preview',token),rpc('get_my_player',token)]);
        if(gen!==state.generation)return;
        if(!Array.isArray(rows)||!Array.isArray(players)||players.length!==1)throw Error('Unexpected response');
        state.player=players[0];
        if(rows.length){const server=Date.parse(rows[0].server_time);if(Number.isFinite(server))state.offset=server-started;}
        state.rows=rows.filter(r=>r&&r.route_id==='6'&&typeof r.direction==='string'&&typeof r.station_name==='string'&&r.trading_enabled===false&&[r.yes_probability_ppm,r.yes_ask_ppm,r.no_ask_ppm].every(v=>Number.isInteger(v)&&v>=0&&v<=1000000));
        state.updated=new Date(Date.now()+state.offset).toISOString();state.error='';
        document.getElementById('liveUser').textContent=state.player.username+' Â· Test account required for market access';
        document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:2});
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401||e.status===403){logout('Session expired or access unavailable. Sign in again.');return;}
        state.rows=[];state.error='Live data unavailable. Retrying automatically.';document.getElementById('headerBalance').textContent='â';
      }finally{if(gen===state.generation){state.busy=false;renderRows();}}
    }
    const tokens=v=>v==null||!Number.isFinite(Number(v))?'â':(Number(v)/100).toLocaleString('en-US',{maximumFractionDigits:2})+' T';
    const signed=v=>v==null||!Number.isFinite(Number(v))?'â':(Number(v)>0?'+':'')+tokens(v);
    const tone=v=>v==null?'':Number(v)>0?'up':Number(v)<0?'down':'';
    const dateTime=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'â';
    const completed=t=>['WON','LOST','VOIDED','CASHED_OUT'].includes(t.status);
    function switchTab(tab){
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
      el.innerHTML='<div class="notice">Backend tickets Â· Test predictions are labeled. Live research markets remain read-only.</div><div class="summary-grid" style="margin-top:14px"><div class="summary-box"><small>Available Tokens</small><strong>'+safe(tokens(state.player?.available_minor))+'</strong></div><div class="summary-box"><small>Open stake</small><strong>'+safe(ready?tokens(risk):'â')+'</strong></div><div class="summary-box"><small>Realized P/L</small><strong class="'+(ready?tone(net):'')+'">'+safe(ready?signed(net):'â')+'</strong></div></div><div class="chiprow" style="margin:18px 0 12px" role="group" aria-label="Portfolio filter"><button id="liveActive" class="chip '+(state.portfolioTab==='active'?'is-on':'')+'" aria-pressed="'+(state.portfolioTab==='active')+'">Active'+(ready?' ('+active.length+')':'')+'</button><button id="liveHistory" class="chip '+(state.portfolioTab==='history'?'is-on':'')+'" aria-pressed="'+(state.portfolioTab==='history')+'">History'+(ready?' ('+history.length+')':'')+'</button><button id="livePortfolioRefresh" class="tiny-action" '+(state.portfolioBusy?'disabled':'')+'>Refresh</button></div>'+
      (state.portfolioError?'<div class="empty" role="status">Portfolio unavailable. Try refreshing.</div>':!ready?'<div class="empty" role="status">Loading ticketsâ¦</div>':!selected.length?'<div class="empty">'+(state.portfolioTab==='active'?'No active predictions yet.':'No completed predictions yet.')+'</div>':selected.map(t=>{
        const done=completed(t), id=safe(t.ticket_id), test=t.environment==='test';
        const badge=t.status==='WON'?'win':t.status==='LOST'?'loss':done?'void':'pending';
        const pnl=done?'<strong class="'+tone(t.net_minor)+'">'+safe(signed(t.net_minor))+'</strong>':'';
        const status=done?t.status:(['LOCKED','VERIFYING'].includes(t.market_status)?t.market_status:t.status);
        return '<details class="ticket" data-ticket="'+id+'" '+(expanded.has(t.ticket_id)?'open':'')+'><summary class="ticket-top" style="cursor:pointer;list-style:none"><div class="txt"><h3>'+safe(t.market_question||t.market_name||'Prediction')+'</h3><p>'+safe([t.station_name,t.route_id?'Line '+t.route_id:null,test?'TEST PREDICTION':null,t.side].filter(Boolean).join(' Â· '))+'</p></div><div class="right"><span class="badge '+badge+'">'+safe(status)+(t.status==='WON'?' <span style="color:var(--gold)">â</span>':'')+'</span>'+pnl+'</div><span aria-hidden="true">â</span></summary><div class="ticket-detail">'+detail('Pick',t.side+' Â· '+fmt(t.ask_ppm))+detail('Risked',tokens(t.stake_minor))+detail(done?'Returned':'Potential return',tokens(done?t.returned_minor:t.gross_win_minor))+detail(done?'Net':'Potential profit',done?signed(t.net_minor):signed(Number(t.gross_win_minor)-Number(t.stake_minor)),done?tone(t.net_minor):'')+detail('Accepted',dateTime(t.accepted_at))+(done?detail('Closed',dateTime(t.closed_at))+'<details class="history-explain" data-evidence="'+id+'" '+(evidenceOpen.has(t.ticket_id)?'open':'')+'><summary>How Was This Decided?</summary>'+(test?'<p>Backend test settlement; not verified MTA data.</p>':'')+detail('Outcome',t.outcome||'Not supplied')+detail('Reason',t.reason_code||'Not supplied')+(t.evidence&&Object.keys(t.evidence).length?'<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+safe(JSON.stringify(t.evidence,null,2))+'</pre>':'<p>No additional evidence recorded.</p>')+'</details>':'')+'</div></details>';
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
  }
};
