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
    const state = {token:null, rows:[], player:null, offset:0, error:'', busy:false, generation:0, updated:null};
    document.title='Subway Exchange · Live Market Preview';
    document.querySelector('.demo-strip').textContent='PRIVATE ALPHA · LIVE MTA DATA · READ-ONLY RESEARCH MARKETS';
    for (const sel of ['#alertsBtn','.sticky-nav','.foot','.side']) {
      const el=document.querySelector(sel); if(el)el.hidden=true;
    }
    const app=document.querySelector('.app'); if(app)app.style.gridTemplateColumns='minmax(0,760px)';
    const box=document.querySelector('.tokenbox'); if(box)box.title='Backend available Tokens';
    document.getElementById('headerBalance').textContent='—';
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
      main.innerHTML='<div class="pagehead"><h1>Live Market Preview</h1></div><div class="notice">Development access only. Sign in with your existing verified test account. No predictions can be placed.</div><form id="liveLogin" class="shell-section"><label class="form-label" for="liveEmail">Email</label><input class="field" id="liveEmail" type="email" autocomplete="username" required><label class="form-label" for="livePassword">Password</label><input class="field" id="livePassword" type="password" autocomplete="current-password" required><button class="btn fill" style="margin-top:14px" type="submit">Sign In</button><p id="liveLoginStatus" role="status">'+safe(message)+'</p></form><p class="fineprint">Credentials go directly to Supabase. This preview does not persist the session on this device.</p>';
      document.getElementById('liveLogin').addEventListener('submit',async e=>{
        e.preventDefault();
        const form=e.currentTarget, btn=form.querySelector('button'), password=document.getElementById('livePassword');
        if(btn.disabled)return;btn.disabled=true;
        document.getElementById('liveLoginStatus').textContent='Signing in…';
        try {
          const data=await request('/auth/v1/token?grant_type=password',{email:document.getElementById('liveEmail').value.trim(),password:password.value});
          if(!data.access_token)throw Error('Missing session');
          state.token=data.access_token;state.generation++;password.value='';
          renderShell();await refresh();
        }catch(err){password.value='';btn.disabled=false;const status=document.getElementById('liveLoginStatus');if(status)status.textContent='Sign-in failed. Check your test-account credentials or connection.';}
      });
    }
    function renderShell(){
      main.innerHTML='<div class="pagehead"><div><h1>Lines</h1><p id="liveUser"></p></div><button id="liveLogout" class="tiny-action">Sign Out</button></div><div class="ticker"><span>● <strong>LIVE MTA RESEARCH</strong> · Trading disabled</span></div><section class="shell-section"><div class="section-label"><h2>Choose Your Line</h2><span class="dashes"></span></div><div class="routebar"><span class="roundel" style="--bg:#00933C;--fg:white">6</span></div><div class="chiprow"><span class="chip is-on">Next Train</span></div></section><section class="shell-section"><div class="section-label"><h2>Available Markets</h2><span class="dashes"></span><button id="liveRefresh" class="tiny-action">Refresh</button></div><p id="liveStatus" role="status">Loading live markets…</p><div id="liveCards" class="cards"></div><p class="fineprint">Research prices only. Independent of the MTA. No tickets or Token balances change when viewing.</p></section>';
      document.getElementById('liveLogout').onclick=()=>logout();
      document.getElementById('liveRefresh').onclick=()=>refresh();
    }
    function logout(message='Signed out.') {
      const token=state.token;state.generation++;state.token=null;state.rows=[];state.player=null;state.error='';state.updated=null;state.busy=false;
      document.getElementById('headerBalance').textContent='—';signInView(message);
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
      const message=state.error||(!state.updated?'Loading live markets…':rows.length?rows.length+' live markets · Updated '+time(state.updated)+' ET':'No fresh markets right now. Checking again automatically.');
      if(status.textContent!==message)status.textContent=message;
      document.getElementById('liveCards').innerHTML=rows.map(r=>{
        const lock=Math.max(0,Math.ceil((Date.parse(r.lock_at)-now)/1000));
        const question='Will the selected '+r.direction.toLowerCase()+' 6 train arrive at '+r.station_name+' by '+time(r.outcome_deadline)+' ET?';
        return '<article class="market-card"><div class="card-flex"><div class="card-info"><div class="card-question">'+bullet+'<span class="card-title">'+safe(question)+'</span></div><div class="card-meta">Next Train · '+safe(r.station_name)+' · '+safe(r.direction)+'<span class="meta-lock"> · Locks in '+Math.floor(lock/60)+':'+String(lock%60).padStart(2,'0')+'</span></div><div class="card-meta">Estimated YES probability '+fmt(r.yes_probability_ppm)+' · Read-only</div></div><div class="card-side-buttons"><button class="pricebtn" disabled title="Research only">YES <b>'+fmt(r.yes_ask_ppm)+'</b></button><button class="pricebtn no" disabled title="Research only">NO <b>'+fmt(r.no_ask_ppm)+'</b></button></div></div></article>';
      }).join('');
    }
    async function refresh(){
      if(!state.token||state.busy||document.hidden)return;
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
        document.getElementById('liveUser').textContent=state.player.username+' · Test account required for market access';
        document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:2});
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401||e.status===403){logout('Session expired or access unavailable. Sign in again.');return;}
        state.rows=[];state.error='Live data unavailable. Retrying automatically.';document.getElementById('headerBalance').textContent='—';
      }finally{if(gen===state.generation){state.busy=false;renderRows();}}
    }
    signInView();
    setInterval(()=>{if(state.token&&!document.hidden)renderRows();},1000);
    setInterval(refresh,10000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderRows();refresh();}});
    return true;
  }
};
