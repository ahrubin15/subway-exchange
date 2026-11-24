/* Subway Exchange development live preview. Verified test-account trading only. */
window.SubwayLivePreview = {
  start() {
    if (new URLSearchParams(location.search).get('live') !== '1') return false;
    const main = document.getElementById('main');
    const url = 'https://jxymdjkzbjntfbbyjdfa.supabase.co';
    const key = 'sb_publishable_DA9X9DoNOhoBYFMdVGh7JQ_Rzk_xRPI';
    const safe = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fmt = v => (Number(v)/10000).toLocaleString('en-US',{maximumFractionDigits:0})+'%';
    const time = v => new Date(v).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'});
    const bullet = '<span class="roundel small" style="--bg:#00933C;--fg:white">6</span>';
    const restored=new URLSearchParams(location.search).get('classic')!=='0';
    const state = {token:null, rows:[], player:null, offset:0, error:'', busy:false, generation:0, updated:null,tab:'lines',portfolioTab:'active',txRows:null,txFilter:'ALL',txBusy:false,txMore:false,txError:'',txEpoch:0,txExpanded:new Set(),txUpdated:0,tickets:null,portfolioError:'',portfolioBusy:false,purchase:null,purchaseBusy:false,notice:'',board:new Map(),toastTimer:null,settlementSeen:null,expandedTickets:new Set(),evidenceTickets:new Set(),rewards:null,avatarLine:"6",receipts:null,avatarBusy:false,rewardInfo:false,meBusy:false,meError:"",meDraft:null,accountEmail:"",rewardBusy:false,crewId:null,crewPeriod:"WEEKLY",rankPeriod:"WEEKLY",rankType:"players",socialBusy:false,socialEpoch:0,crews:[],crewRows:[],rankRows:[],inviteCode:"",socialError:"",crewSettings:false};
    document.title='Subway Exchange \u00b7 Live Market Preview';
    document.querySelector('.demo-strip').textContent='PRIVATE ALPHA \u00b7 LIVE MTA DATA \u00b7 VIRTUAL TOKEN TEST TRADING';
    for (const sel of ['#alertsBtn','.sticky-nav','.foot','.side']) {
      const el=document.querySelector(sel); if(el)el.hidden=true;
    }
    const app=document.querySelector('.app'); if(app)app.style.gridTemplateColumns='minmax(0,760px)';
    const box=document.querySelector('.tokenbox');
    if(box){
      box.title='Backend available Tokens (rounded for display)';
      box.innerHTML=tokenMark().replace('class="mini-token"','class="token-svg"')+'<strong id="headerBalance">&mdash;</strong>';
      const stack=document.createElement('div');stack.className='live-token-stack';
      box.parentNode.insertBefore(stack,box);stack.appendChild(box);
      const signOut=document.createElement('button');signOut.type='button';signOut.id='liveLogout';signOut.hidden=true;signOut.textContent='Sign Out';stack.appendChild(signOut);
      const style=document.createElement('style');style.textContent='.live-token-stack{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;line-height:1.15;flex-shrink:0}.live-token-stack #liveLogout{font:inherit;font-size:10px;line-height:1.15;color:var(--muted,#a7b6c8);text-decoration:underline;text-underline-offset:2px;background:none;border:0;padding:2px 3px;cursor:pointer}.live-token-stack #liveLogout[hidden]{display:none!important}.live-token-stack #liveLogout:focus-visible{outline:2px solid #FFCB23;outline-offset:2px}.live-signed-money{display:inline-flex;align-items:center;gap:3px;vertical-align:middle;white-space:nowrap}';document.head.appendChild(style);
      document.getElementById('liveLogout').onclick=()=>logout();
    }
    document.getElementById('headerBalance').textContent='\u2014';
    // Persistent authentication uses the official Supabase client and a dedicated alpha storage key.
    let authClient=null, authUserId=null, authStarting=false, authSigningOut=false, authReady=false;
    const authStorageKey='subway-exchange-live-auth-v1';
    const verifiedUser=u=>!!u?.email_confirmed_at&&!u.is_anonymous;
    const invitePattern=/^(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}|[a-f0-9]{32})$/i;
    const referralPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pendingKeys={crew:'subway-alpha-pending-crew',ref:'subway-alpha-pending-ref'};
    const pending={crew:null,ref:null};
    for(const [kind,pattern] of [['crew',invitePattern],['ref',referralPattern]]){
      const incoming=new URLSearchParams(location.search).get(kind);
      try{pending[kind]=sessionStorage.getItem(pendingKeys[kind]);if(!pending[kind]&&incoming&&pattern.test(incoming)){pending[kind]=incoming;sessionStorage.setItem(pendingKeys[kind],incoming);}}catch{if(incoming&&pattern.test(incoming))pending[kind]=incoming;}
    }
    function clearPending(kind){pending[kind]=null;try{sessionStorage.removeItem(pendingKeys[kind]);}catch{}const u=new URL(location.href);u.searchParams.delete(kind);history.replaceState(history.state,'',u.href);}
    function shareURL(kind,value){const u=new URL(location.origin+location.pathname);u.searchParams.set('live','1');u.searchParams.set(kind,value);return u.href;}
    async function shareLink(message,link){
      if(navigator.share){try{await navigator.share({title:'Subway Exchange',text:message,url:link});return;}catch(e){if(e.name==='AbortError')return;}}
      try{await navigator.clipboard.writeText(link);showToast('Invitation link copied');}catch{window.prompt('Copy this invitation link:',link);}
    }
    async function processInvites(playerId){
      const gen=state.generation;
      if(pending.ref){try{if(pending.ref.toLowerCase()!==String(playerId).toLowerCase())await rpc('attribute_my_referral',state.token,{p_referrer_id:pending.ref});if(gen===state.generation)clearPending('ref');}catch(e){if(gen===state.generation){if(e.status===400)clearPending('ref');else showToast('Referral could not be confirmed. Refresh to retry.');}}}
      if(gen!==state.generation)return;
      if(pending.crew){try{const id=await rpc('join_crew',state.token,{p_code:pending.crew});if(gen!==state.generation)return;state.crewId=id;clearPending('crew');switchTab('crew');showToast('Welcome to your Crew!');}catch(e){if(gen===state.generation){if(e.status===400){clearPending('crew');showToast('Invitation invalid or expired.');}else showToast('Crew invitation not confirmed. Refresh to retry.');}}}
    }
    async function checkReferral(){try{if(await rpc('check_my_referral_reward',state.token))showToast('Referral reward: +100 Tokens');}catch{}}
    const redirectUrl=()=>{const target=new URL(location.origin+location.pathname);target.searchParams.set('live','1');for(const k of ['crew','ref'])if(pending[k])target.searchParams.set(k,pending[k]);return target.href;};
    async function rpc(name,token,body={}){
      const gen=state.generation,uid=authUserId;
      if(!authClient||!token||!state.token||!uid)throw Object.assign(new Error('Session unavailable'),{status:401});
      const {data,error}=await authClient.auth.getSession();
      if(error||!data.session||data.session.user.id!==uid||gen!==state.generation||uid!==authUserId)throw Object.assign(new Error('Session unavailable'),{status:401});
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
      try{
        const result=await authClient.rpc(name,body).abortSignal(ctrl.signal);
        if(result.error)throw Object.assign(new Error('Request failed'),{status:result.status});
        if(gen!==state.generation)throw Error('Session changed');
        return result.data;
      }finally{clearTimeout(timer);}
    }
    function signInView(message='',register=false){
      document.querySelector('.sticky-nav').hidden=true;
      const signOut=document.getElementById('liveLogout');if(signOut)signOut.hidden=true;
      main.innerHTML=`<div class="pagehead"><h1>${register?'Create Account':'Sign In'}</h1></div><div class="notice">Private alpha. Virtual Tokens only. Verify your email to start playing.</div><form id="liveLogin" class="shell-section"><label class="form-label" for="liveEmail">Email</label><input class="field" id="liveEmail" type="email" autocomplete="email" required><label class="form-label" for="livePassword">Password</label><input class="field" id="livePassword" type="password" autocomplete="${register?'new-password':'current-password'}" ${register?'minlength="12"':''} required>${register?'<p class="fineprint">Use at least 12 characters. Verify your email before signing in.</p>':''}<button class="btn fill" style="margin-top:14px" type="submit">${register?'Create Account':'Sign In'}</button><p id="liveLoginStatus" role="status">${safe(message)}</p></form><button class="btn secondary fill" id="liveAuthToggle">${register?'Already have an account? Sign In':'New to Subway Exchange? Create Account'}</button><p class="fineprint">Your session stays signed in on this browser until you sign out or it is invalidated.</p>`;
      document.getElementById('liveAuthToggle').onclick=()=>signInView('',!register);
      document.getElementById('liveLogin').onsubmit=async e=>{
        e.preventDefault();if(authStarting||authSigningOut||!authClient)return;
        const form=e.currentTarget,btn=form.querySelector('button'),password=document.getElementById('livePassword'),email=document.getElementById('liveEmail').value.trim();
        if(btn.disabled)return;btn.disabled=true;authStarting=true;
        const toggle=document.getElementById('liveAuthToggle');toggle.disabled=true;
        document.getElementById('liveLoginStatus').textContent=register?'Creating account...':'Signing in...';
        try{
          if(register){
            const {data,error}=await authClient.auth.signUp({email,password:password.value,options:{emailRedirectTo:redirectUrl()}});if(error)throw error;
            if(data.session&&verifiedUser(data.user)){await enterSession(data.session);}
            else{if(data.session)await authClient.auth.signOut({scope:'local'});signInView('Check your email for a verification link. Once verified, sign in.');}
          }else{
            const {data,error}=await authClient.auth.signInWithPassword({email,password:password.value});if(error||!data.session)throw error||Error('No session');
            if(!verifiedUser(data.user)){await authClient.auth.signOut({scope:'local'});signInView('Please verify your email before signing in.');return;}
            await enterSession(data.session);
          }
        }catch(err){if(!state.token){const status=document.getElementById('liveLoginStatus');if(status)status.textContent=register?'Account creation could not be confirmed. Check your email or try signing in.':'Sign-in failed. Check your credentials, email verification or connection.';}else{showToast('Account setup unavailable. Refresh to retry.');}}
        finally{password.value='';authStarting=false;if(btn.isConnected)btn.disabled=false;if(toggle.isConnected)toggle.disabled=false;}
      };
    }
    async function enterSession(session){
      if(!verifiedUser(session?.user))throw Error('Verified account required');
      if(state.token&&authUserId===session.user.id){state.token=session.access_token;return;}
      authUserId=session.user.id;state.token=session.access_token;state.generation++;state.accountEmail=session.user.email||'';
      const gen=state.generation;
      try{
        const playerId=await rpc('initialize_my_player',state.token);if(!playerId)throw Error('Player unavailable');
        if(gen!==state.generation)return;
        renderShell();await processInvites(playerId);if(gen!==state.generation)return;await checkReferral();await collectRewards();await Promise.all([refresh(),refreshPortfolio()]);
      }catch(err){if(gen===state.generation){state.token=null;authUserId=null;state.generation++;main.innerHTML='<div class="notice">Account setup could not be completed. Your session is retained.</div><button class="btn fill" id="retryAuth">Retry</button>';document.getElementById('retryAuth').onclick=()=>location.reload();}throw err;}
    }
    async function bootAuth(){
      main.innerHTML='<div class="notice" role="status">Restoring your session...</div>';
      try{
        const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
        authClient=createClient(url,key,{auth:{storageKey:authStorageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
        authClient.auth.onAuthStateChange((event,session)=>{
          // Do not await Supabase calls inside this callback (the SDK holds an auth lock).
          if(!authReady||authStarting||authSigningOut)return;
          if(event==='SIGNED_OUT'&&!session){setTimeout(()=>{if(state.token)clearLocalSession('Session ended. Sign in again.');},0);}
          else if(session&&session.user.id===authUserId){state.token=session.access_token;}
          else if(session&&session.user.id!==authUserId){setTimeout(()=>location.reload(),0);}
        });
        const {data,error}=await authClient.auth.getSession();if(error)throw error;
        authReady=true;
        if(data.session&&verifiedUser(data.session.user)){await enterSession(data.session);}
        else{if(data.session)await authClient.auth.signOut({scope:'local'});signInView(data.session?'Please verify your email before signing in.':'');}
      }catch(e){main.innerHTML='<div class="notice" role="status">Unable to restore authentication. Check your connection and retry. Your saved session has not been deliberately cleared.</div><button class="btn fill" id="retryAuth">Retry</button>';document.getElementById('retryAuth').onclick=()=>location.reload();}
    }
    function renderShell(){
      main.innerHTML='<div class="pagehead"><div><h1>Lines</h1><p id="liveUser"></p></div></div><div class="ticker"><span>\u25cf <strong>LIVE MTA DATA</strong> \u00b7 Test trading</span></div><section class="shell-section"><div class="section-label"><h2>Choose Your Line</h2><span class="dashes"></span></div><div class="routebar"><span class="roundel" style="--bg:#00933C;--fg:white">6</span></div><div class="chiprow"><span class="chip is-on">Next Train</span></div></section><section class="shell-section"><div class="section-label"><h2>Available Markets</h2><span class="dashes"></span><button id="liveRefresh" class="tiny-action">Refresh</button></div><p id="liveStatus" role="status">Loading live markets\u2026</p><div id="liveCards" class="cards"></div><p class="fineprint">Virtual Tokens only. Independent of the MTA. Arrival evidence is evaluated using provisional test rules.</p></section>';
      const signOut=document.getElementById('liveLogout');if(signOut)signOut.hidden=false;
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
      const me=document.createElement('section');me.id='liveMe';me.hidden=true;main.appendChild(me);
      const meNav=document.createElement('button');meNav.className='navitem';meNav.id='liveMeNav';meNav.setAttribute('aria-current','false');meNav.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Me</span>';meNav.onclick=()=>switchTab('me');document.getElementById('bottomNav').append(meNav);
      for(const [tab,label,path] of [['crew','Crew','<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9"/><circle cx="9" cy="7" r="4"/><path d="M16 3.2a4 4 0 0 1 0 7.6"/>'],['ranks','Ranks','<path d="M3 21h18M5 21V12h4v9M10 21V4h4v17M15 21V9h4v12"/>']]){
        const section=document.createElement('section');section.id='live'+(tab==='crew'?'Crew':'Ranks');section.hidden=true;main.append(section);
        const b=document.createElement('button');b.className='navitem';b.id=section.id+'Nav';b.setAttribute('aria-current','false');b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg><span>'+label+'</span>';b.onclick=()=>switchTab(tab);document.getElementById('bottomNav').insertBefore(b,meNav);
      }
      const socialStyle=document.createElement('style');socialStyle.id='liveSocialStyle';socialStyle.textContent='#liveMe,#liveCrew,#liveRanks{min-width:0;max-width:100%}#liveMe .profile-hero>div{flex:1;min-width:0;overflow-wrap:anywhere}#liveMe .profile-hero h2{overflow-wrap:anywhere;word-break:break-word}#liveMe .profile-hero .roundel{flex-shrink:0}#liveMe .inputrow,#liveCrew .inputrow{display:flex;gap:10px;min-width:0;align-items:center}#liveMe .inputrow .field,#liveCrew .inputrow .field{flex:1;width:0;min-width:0}#liveCrew .rank-row,#liveRanks .rank-row{min-width:0}#liveCrew .rank-row .name,#liveRanks .rank-row .name{min-width:0;overflow-wrap:anywhere;flex:1}#liveCrew .score,#liveRanks .score{white-space:nowrap}#liveCrew .field{max-width:100%}#liveCrew .live-member-actions{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px}#liveCrew .crew-title h2{overflow-wrap:anywhere;min-width:0}#liveCrew .live-social-form{margin-top:12px}#liveCrew .live-invite-code{overflow-wrap:anywhere;user-select:all}#liveCrew[hidden],#liveRanks[hidden],#liveMe[hidden]{display:none!important}#liveCrew .rank-row,#liveRanks .rank-row{grid-template-columns:30px 30px minmax(0,1fr) max-content;gap:8px;align-items:center;padding:10px 4px}#liveRanks .rank-row.crew-rank{grid-template-columns:30px minmax(0,1fr) max-content}#liveCrew .rank-row .name,#liveRanks .rank-row .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;font-size:14px}#liveCrew .rank-row .roundel,#liveRanks .rank-row .roundel{width:28px;height:28px;flex-shrink:0}#liveMe .avatar-grid{display:flex;flex-wrap:wrap;gap:7px}#liveMe .avatar-grid button{border:1px solid transparent;border-radius:50%;padding:4px;background:transparent;cursor:pointer}#liveMe .avatar-grid button[aria-pressed=true]{border-color:#FFCB23;background:#273a50}#liveMe .reward-row{display:grid;grid-template-columns:20px minmax(0,1fr) max-content;gap:9px;align-items:start;padding:9px 0}#liveMe .reward-check{font-size:19px;color:#83d6b2;line-height:1.2}#liveMe .reward-check.pending{color:#a7b6c8}#liveMe .reward-info{border:1px solid #59718a;border-radius:10px;padding:12px;margin:8px 0 12px}#liveMe .reward-info p{margin:8px 0}';document.head.append(socialStyle);
      state.tab='lines';
      const brand=document.querySelector('header .brand');if(brand){brand.style.cursor='pointer';brand.setAttribute('role','button');brand.tabIndex=0;brand.onclick=()=>{if(state.token)switchTab('lines');};brand.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(state.token)switchTab('lines');}};}
      const panel=document.createElement('div');panel.id='livePurchase';panel.hidden=true;(restored?document.getElementById('overlays'):main).appendChild(panel);
      if(restored)restoreLines();
      const notice=document.createElement('p');notice.id='liveTradeNotice';notice.setAttribute('role','status');main.insertBefore(notice,main.querySelector('.ticker'));
    }
    async function logout(message='Signed out.') {
      if(state.purchaseBusy||state.purchase?.uncertain||authSigningOut)return;
      authSigningOut=true;const button=document.getElementById('liveLogout');if(button)button.disabled=true;
      try{const {error}=await authClient.auth.signOut({scope:'local'});if(error)throw error;clearLocalSession(message);}
      catch(e){showToast('Sign out could not be confirmed. Please retry.');}
      finally{authSigningOut=false;if(button)button.disabled=false;}
    }
    function clearLocalSession(message){
      authUserId=null;
      document.getElementById('livePurchase')?.remove();document.body.classList.remove('modal-open');
      const token=state.token;state.generation++;state.token=null;state.rows=[];state.board.clear();clearTimeout(state.toastTimer);const toastSlot=document.getElementById('toastSlot');if(toastSlot)toastSlot.innerHTML='';state.settlementSeen=null;state.expandedTickets.clear();state.evidenceTickets.clear();state.player=null;state.error='';state.updated=null;state.busy=false;state.tickets=null;state.portfolioError='';state.portfolioBusy=false;state.tab='lines';state.portfolioTab='active';state.txRows=null;state.txFilter='ALL';state.txBusy=false;state.txMore=false;state.txError='';state.txEpoch++;state.txExpanded.clear();state.txUpdated=0;state.purchase=null;state.purchaseBusy=false;state.notice='';state.rewards=null;state.referrals=null;state.avatarLine="6";state.receipts=null;state.avatarBusy=false;state.rewardInfo=false;state.meBusy=false;state.meError='';state.meDraft=null;state.accountEmail='';state.rewardBusy=false;state.socialEpoch++;state.socialBusy=false;state.crews=[];state.crewRows=[];state.rankRows=[];state.crewId=null;state.inviteCode='';state.crewSettings=false;state.socialError='';document.getElementById('liveSocialStyle')?.remove();document.getElementById('weeklyCelebrate')?.remove();
      document.getElementById('headerBalance').textContent='\u2014';signInView(message);

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
        showToast('Ticket punched! '+p.side+' | '+tokens(p.stake*100));void checkReferral();
        state.player=null;document.getElementById('headerBalance').textContent='-';state.portfolioTab='active';state.tickets=null;switchTab('lines');refresh();refreshPortfolio();
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===400||e.status===409||e.status===422){p.uncertain=false;p.failure='Prediction rejected. Checking the latest market status.';refresh();}
        else {p.uncertain=true;}
      }finally{if(gen===state.generation){state.purchaseBusy=false;const fill=document.getElementById('swipeProgress');if(fill){fill.style.opacity='0';fill.style.height='0';}updatePurchase();}}
    }
    async function refresh(){
      if(!state.token||state.busy||state.rewardBusy||document.hidden||state.tab!=='lines')return;
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
        document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:0});
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401){state.error='Session temporarily unavailable. Reconnecting...';return;}
        state.error='Live data unavailable. Retrying automatically.';document.getElementById('headerBalance').textContent='\u2014';
      }finally{if(gen===state.generation){state.busy=false;renderRows();}}
    }
    const tokens=v=>v==null||!Number.isFinite(Number(v))?'\u2014':(Number(v)/100).toLocaleString('en-US',{maximumFractionDigits:0})+' T';
    const signed=v=>v==null||!Number.isFinite(Number(v))?'\u2014':(Number(v)>0?'+':'')+tokens(v);
    const tone=v=>v==null?'':Number(v)>0?'up':Number(v)<0?'down':'';
    const dateTime=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'\u2014';
    const completed=t=>['WON','LOST','VOIDED','CASHED_OUT'].includes(t.status);
    function scrollTop(smooth=false){window.scrollTo({top:0,left:0,behavior:smooth?'smooth':'instant'});document.scrollingElement?.scrollTo({top:0,left:0,behavior:smooth?'smooth':'instant'});}
    function switchTab(tab){
      const same=tab===state.tab;
      if(tab!=='lines'&&state.purchase){if(state.purchaseBusy||state.purchase.uncertain)return;closePurchase();}
      if(tab!=='crew'){state.crewSettings=false;document.getElementById('liveCrewSettings')?.close();}
      state.tab=tab;
      scrollTop(same);
      main.querySelector('.pagehead h1').textContent=({lines:'Lines',portfolio:'Portfolio',me:'Me',crew:'Crew',ranks:'Ranks'})[tab];
      main.querySelectorAll('[data-live-lines]').forEach(el=>el.hidden=tab!=='lines');
      main.querySelector('.ticker').hidden=tab!=='lines';
      document.getElementById('livePortfolio').hidden=tab!=='portfolio';document.getElementById('liveMe').hidden=tab!=='me';document.getElementById('liveCrew').hidden=tab!=='crew';document.getElementById('liveRanks').hidden=tab!=='ranks';
      for(const [id,name] of [['liveLinesNav','lines'],['livePortfolioNav','portfolio'],['liveMeNav','me'],['liveCrewNav','crew'],['liveRanksNav','ranks']]){
        const el=document.getElementById(id);el.classList.toggle('is-on',tab===name);el.setAttribute('aria-current',tab===name?'page':'false');
      }
      if(tab==='portfolio'){renderPortfolio();refreshPortfolio();if(state.portfolioTab==='transactions')loadTransactions();}else if(tab==='me'){renderMe();refreshMe();refreshPortfolio();}else if(tab==='crew'||tab==='ranks'){refreshSocial();}else{renderRows();refresh();}
    }
    const minor=v=>v==null||!Number.isFinite(Number(v))?NaN:Number(v);
    const signedCash=v=>Number.isFinite(minor(v))?`<span class="live-signed-money">${minor(v)!==0?'<span>'+(minor(v)>0?'+':'\u2212')+'</span>':''}${cash(Math.abs(minor(v)))}</span>`:'\u2014';
    function ticketEvidence(t){
      const e=t.evidence||{}, a=e.arrival_evidence||{};
      if(!e.research_market_id)return '<p>Test settlement. No live arrival evidence is associated with this ticket.</p>';
      const reason={WINDOW_BEFORE_DEADLINE:'The entire observed arrival window was at or before the prediction deadline.',WINDOW_AFTER_DEADLINE:'The entire observed arrival window was after the prediction deadline.',WINDOW_STRADDLES_DEADLINE:'The arrival window crossed the deadline, so the result was uncertain and the stake was refunded.',NO_STOPPED_EVIDENCE:'No qualifying stopped-train observation was available. The stake was refunded.',STOPPED_ONLY:'A stopped train was observed, but there was no qualifying preceding observation to establish arrival.',IDENTITY_CONFLICT:'The observations could not be confidently matched to the same train.',STOPPED_BEFORE_GENERATION:'The stopped observation predates market creation.'}[t.reason_code]||'The recorded evidence was evaluated using the test settlement rules.';
      return `<p>${safe(reason)}</p><div class="rule"><strong>Outcome:</strong> ${safe(t.outcome||'Not supplied')}</div>${a.window_start&&a.window_end?`<div class="rule"><strong>Observed arrival window:</strong> ${safe(dateTime(a.window_start))} to ${safe(dateTime(a.window_end))}</div>`:''}${a.estimated_arrival_at?`<div class="rule"><strong>Estimated arrival:</strong> ${safe(new Date(a.estimated_arrival_at).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',second:'2-digit'}))} ET (estimate, not an exact verified arrival)</div>`:''}<p class="fineprint">Source: MTA real-time observations. Conservative test rules; uncertain evidence is voided.</p>`;
    }
    const txKinds={OPENING_GRANT:['Welcome Bonus','+'],DAILY_GRANT:['Daily Reward','+'],WEEKLY_GRANT:['Weekly Reward','+'],REFERRAL_GRANT:['Referral Reward','+'],STAKE:['Prediction Placed','â'],WIN_PAYOUT:['Prediction Won','+'],VOID_REFUND:['Prediction Voided','â¶'],CASH_OUT:['Cash Out','+'],PROMOTIONAL_GRANT:['Promotional Reward','+']};
    function txDate(v){return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(v));}
    function transactionMarkup(card){
      const rows=state.txRows||[];let day='';
      const content=rows.map(t=>{
        const date=txDate(t.created_at),heading=date===day?'':`<h3 class="tx-date">${safe(date)}</h3>`;day=date;
        const [label,symbol]=txKinds[t.kind]||[String(t.kind||'Transaction').replace(/_/g,' '),'â¢'];
        const ticket=(state.tickets||[]).find(x=>x.ticket_id===t.ticket_id),expanded=state.txExpanded.has(t.transaction_id);
        const context=[t.station_name,t.prediction_side].filter(Boolean).join(' Â· ');
        const timeLabel=new Date(t.created_at).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'})+' ET';
        const icon=t.route_id&&t.ticket_id?classicBullet(t.route_id,'small'):`<span class="tx-symbol" aria-hidden="true">${safe(symbol)}</span>`;
        const amount=`<span class="${tone(t.delta_minor)}">${signedCash(t.delta_minor)}</span>`;
        return heading+`<div class="tx-entry"><button type="button" class="tx-row" ${t.ticket_id?`data-tx-detail="${safe(t.transaction_id)}" aria-expanded="${expanded}"`:'disabled'}>${icon}<span class="tx-description"><strong>${safe(label)}</strong><small>${safe(context?context+' Â· '+timeLabel:timeLabel)}</small></span><span class="tx-amount"><strong>${amount}</strong><small>Bal: ${cash(minor(t.balance_minor))}</small></span>${t.ticket_id?`<span class="tx-chevron" aria-hidden="true">${expanded?'â':'â'}</span>`:''}</button>${expanded&&t.ticket_id?`<div class="tx-detail">${ticket?card(ticket):`<p>${safe(t.market_name||'Prediction')} Â· ${safe(context)}</p><p>Transaction recorded ${safe(dateTime(t.created_at))}</p>`}</div>`:''}</div>`;
      }).join('');
      return `<div class="tx-section"><div class="tx-heading"><h2>Token Activity</h2><select id="liveTxFilter" aria-label="Transaction filter" class="field tx-filter">${[['ALL','All Transactions'],['PREDICTIONS','Predictions'],['REWARDS','Rewards']].map(([v,l])=>`<option value="${v}" ${v===state.txFilter?'selected':''}>${l}</option>`).join('')}</select></div>${state.txError?`<p class="notice" role="status">${safe(state.txError)} <button class="tiny-action" id="liveTxRetry">Retry</button></p>`:''}${content||(!state.txBusy?'<div class="empty">No transactions yet.</div>':'')} ${state.txBusy?'<p class="fineprint" role="status">Loading transactionsâ¦</p>':state.txMore?'<button class="btn secondary fill" id="liveTxMore">Load More</button>':''}<button type="button" class="tiny-action" id="liveTxRefresh" ${state.txBusy?'disabled':''}>Refresh Transactions</button><p class="fineprint">All times Eastern. Balances reflect all transactions, including those hidden by filters. Token values are rounded for display.</p></div>`;
    }
    async function loadTransactions(append=false){
      if(!state.token||state.txBusy)return;
      const gen=state.generation,epoch=++state.txEpoch,filter=state.txFilter,tail=append?state.txRows?.at(-1):null;
      if(append&&!tail)return;
      state.txBusy=true;state.txError='';renderPortfolio();
      try{
        const page=await rpc('get_my_token_transactions',state.token,{p_filter:filter,p_limit:31,p_before_at:tail?.created_at??null,p_before_id:tail?.transaction_id??null});
        if(gen!==state.generation||epoch!==state.txEpoch)return;
        if(!Array.isArray(page))throw Error('Unexpected transaction response');
        const items=page.slice(0,30);state.txRows=append?[...state.txRows,...items.filter(t=>!state.txRows.some(x=>x.transaction_id===t.transaction_id))]:items;state.txMore=page.length>30;state.txUpdated=Date.now();
      }catch(e){if(gen===state.generation&&epoch===state.txEpoch)state.txError='Transaction history unavailable. Please retry.';}
      finally{if(gen===state.generation&&epoch===state.txEpoch){state.txBusy=false;renderPortfolio();}}
    }
    function openTransactions(){state.portfolioTab='transactions';if(state.tab==='portfolio'){renderPortfolio();loadTransactions();}else switchTab('portfolio');}
    const txStyle=document.createElement('style');txStyle.textContent=`#livePortfolio .segment.tx-tabs button{flex:1;min-width:0;padding:9px 4px;font-size:12px;white-space:normal} .tx-section{margin-top:18px}.tx-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.tx-heading h2{font-size:15px;margin:0;white-space:nowrap}.tx-filter{width:auto!important;min-width:0;font-size:12px;padding:7px 28px 7px 9px;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22m6 9 6 6 6-6%22 fill=%22none%22 stroke=%22%23dce7f0%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E');background-repeat:no-repeat;background-position:right 7px center;background-size:16px}.tx-date{font-size:12px;color:var(--muted,#a7b6c8);margin:16px 0 5px}.tx-entry{border-bottom:1px solid rgba(167,182,200,.18)}.tx-row{display:flex;width:100%;align-items:center;text-align:left;gap:9px;padding:12px 0;color:inherit;background:none;border:0;font:inherit}.tx-row:not(:disabled){cursor:pointer}.tx-row:disabled{opacity:1;cursor:default}.tx-symbol{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(167,182,200,.12);font-size:17px;flex:none}.tx-description{min-width:0;flex:1}.tx-description strong,.tx-amount strong{display:block;font-size:13px}.tx-description small,.tx-amount small{display:block;color:var(--muted,#a7b6c8);font-size:11px;margin-top:3px}.tx-amount{text-align:right;flex-shrink:0}.tx-amount .up{color:#4ade80}.tx-amount .down{color:#f87171}.tx-chevron{font-size:16px;color:#a7b6c8}.tx-detail{padding:0 0 10px}.tx-detail .ticket{margin-top:0}#liveTxMore{margin-top:12px}#liveTxRefresh{display:block;margin:12px auto 0}`;document.head.appendChild(txStyle);
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
      const markup=`<div class="summary-grid"><div class="summary-box"><small>Portfolio Value*</small><strong>${ready?cash(balance+risk):'\u2014'}</strong></div><div class="summary-box"><small>Available</small><strong>${cash(balance)}</strong></div><div class="summary-box"><small>At Risk</small><strong>${ready?cash(risk):'\u2014'}</strong></div></div><p class="intro-note">*Unresolved tickets are valued at their original stake, not a cash-out quote.</p><div class="segment tx-tabs" style="margin-top:18px"><button id="liveActive" class="${state.portfolioTab==='active'?'is-on':''}" aria-pressed="${state.portfolioTab==='active'}">Open &amp; Waiting${ready?' ('+active.length+')':''}</button><button id="liveHistory" class="${state.portfolioTab==='history'?'is-on':''}" aria-pressed="${state.portfolioTab==='history'}">History${ready?' ('+history.length+')':''}</button><button id="liveTransactions" class="${state.portfolioTab==='transactions'?'is-on':''}" aria-pressed="${state.portfolioTab==='transactions'}">Transactions</button></div>${state.portfolioTab==='transactions'?transactionMarkup(card):''}${state.portfolioTab!=='transactions'&&state.portfolioError?'<p role="status" class="notice">Portfolio refresh unavailable. Displayed values may be stale.</p>':''}${state.portfolioTab==='transactions'?'':!ready?'<div class="empty" role="status">Loading tickets\u2026</div>':selected.length?selected.map(card).join(''):`<div class="empty"><h3>No Tickets on the Tracks</h3><p>${state.portfolioTab==='active'?'Your next prediction is waiting in Lines.':'Settled and voided tickets will show up here.'}</p><button class="btn" id="exploreMarkets">Explore Markets \u2192</button></div>`}<p class="fineprint">Private test account \u00b7 Virtual Tokens only</p>`;
      if(el.dataset.rendered===markup)return;
      const focused=document.activeElement?.closest('[data-expand-ticket]');const focusedId=focused?.dataset.expandTicket;
      el.dataset.rendered=markup;el.innerHTML=markup;
      document.getElementById('liveActive').onclick=()=>{state.portfolioTab='active';renderPortfolio();};
      document.getElementById('liveHistory').onclick=()=>{state.portfolioTab='history';renderPortfolio();};
      document.getElementById('liveTransactions').onclick=openTransactions;
      el.querySelector('#liveTxFilter')?.addEventListener('change',e=>{state.txFilter=e.target.value;state.txEpoch++;state.txBusy=false;state.txRows=null;state.txMore=false;state.txExpanded.clear();loadTransactions();});
      el.querySelector('#liveTxMore')?.addEventListener('click',()=>loadTransactions(true));
      el.querySelector('#liveTxRetry')?.addEventListener('click',()=>loadTransactions());
      el.querySelector('#liveTxRefresh')?.addEventListener('click',()=>loadTransactions());
      el.querySelectorAll('[data-tx-detail]').forEach(b=>b.onclick=()=>{const id=b.dataset.txDetail,tx=state.txRows?.find(t=>t.transaction_id===id);if(state.txExpanded.has(id))state.txExpanded.delete(id);else{state.txExpanded.add(id);if(tx?.ticket_id)state.expandedTickets.add(tx.ticket_id);}renderPortfolio();});
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
      if(!state.token||state.portfolioBusy||state.rewardBusy||document.hidden)return;
      const gen=state.generation, startedTab=state.tab;state.portfolioBusy=true;
      try{
        const [tickets,players]=await Promise.all([rpc('get_my_portfolio',state.token),startedTab!=='lines'?rpc('get_my_player',state.token):Promise.resolve(null)]);
        if(gen!==state.generation)return;
        if(!Array.isArray(tickets)||(players&&(!Array.isArray(players)||players.length!==1)))throw Error('Unexpected portfolio response');
        observeSettlements(tickets);state.tickets=tickets;state.portfolioError='';
        if(players&&state.tab===startedTab){state.player=players[0];document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:0});}
      }catch(e){
        if(gen!==state.generation)return;
        if(e.status===401){state.error='Session temporarily unavailable. Reconnecting...';return;}
        state.portfolioError='Unavailable';
      }finally{if(gen===state.generation){state.portfolioBusy=false;renderPortfolio();renderMe();if(state.tab==='portfolio'&&state.portfolioTab==='transactions'&&!state.txBusy&&!state.txError&&(state.txRows?.length??0)<=30&&Date.now()-state.txUpdated>15000)loadTransactions();}}
    }

    const routeColors={ALL:'#3e526a','1':'#EE352E','2':'#EE352E','3':'#EE352E','4':'#00933C','5':'#00933C','6':'#00933C','7':'#B933AD',A:'#0039A6',C:'#0039A6',E:'#0039A6',B:'#FF6319',D:'#FF6319',F:'#FF6319',M:'#FF6319',G:'#6CBE45',J:'#996633',Z:'#996633',L:'#A7A9AC',N:'#FCCC0A',Q:'#FCCC0A',R:'#FCCC0A',W:'#FCCC0A',S:'#808183'};
    const classicBullet=(r,size='')=>`<span class="roundel ${size}" style="--bg:${routeColors[r]||'#3e526a'};--fg:${['N','Q','R','W'].includes(r)?'#17253a':'#fff'}">${safe(r)}</span>`;
    function tokenMark(){return '<svg class="mini-token" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="#FFCB23"/><circle cx="20" cy="20" r="13.5" fill="none" stroke="#B78308" stroke-width="2"/></svg>';}
    const cash=n=>Number.isFinite(n)?`<span class="money-inline">${tokenMark()}<span>${(n/100).toLocaleString('en-US',{maximumFractionDigits:0})}</span></span>`:'\u2014';
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
      const sameRounded=fmt(p.quote.ask_ppm)===fmt(q.ask_ppm);
      const offerPrice=x=>sameRounded?(x/10000).toLocaleString('en-US',{maximumFractionDigits:4})+'%':fmt(x);
      host.innerHTML=`<div class="backdrop"></div><section class="modal" role="dialog" aria-modal="true" aria-label="Odds have changed"><h3>Odds Have Changed</h3><p>Your ${safe(p.side)} price has changed.${sameRounded?' Exact prices are shown because both round to the same whole number.':''}</p><div class="summary-grid"><div class="summary-box"><small>Previous price</small><strong>${offerPrice(p.quote.ask_ppm)}</strong><small>Profit ${gain(p.quote)}</small></div><div class="summary-box"><small>New price</small><strong>${offerPrice(q.ask_ppm)}</strong><small>Profit ${gain(q)}</small></div></div><p id="offerStatus" role="status"></p><button class="btn fill" id="acceptPrice">Accept New Price</button><button class="btn secondary fill" id="rejectPrice">Reject New Price</button></section>`;
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
      else host.innerHTML=`<div class="backdrop" data-live-dismiss></div><section class="sheet rh-sheet" role="dialog" aria-modal="true" aria-label="Review ticket"><button class="slip-back" id="liveEdit">&#8249; Edit</button><div class="slip-sub">SUBWAY EXCHANGE &middot; LIVE TEST TICKET</div><div class="slip-head">Review My Pick</div><div class="slip-stub"><div class="market-line" style="display:flex;align-items:center;gap:12px">${classicBullet('6')}<div><strong>Next Train</strong><div class="muted" style="font-size:12px;margin-top:4px">${safe(r.question)}</div></div></div><div class="detail-line"><span>Your pick</span><strong>${safe(p.side)} &middot; ${fmt(p.quote.ask_ppm)}</strong></div><div class="detail-line"><span>Risk</span><strong>${cash(p.stake*100)}</strong></div><div class="detail-line"><span>Return if correct</span><strong>${cash(Math.floor(p.stake*100*1000000/p.quote.ask_ppm+.5))}</strong></div><div class="slip-total"><span>Profit if correct</span><strong>${signedCash(Math.floor(p.stake*100*1000000/p.quote.ask_ppm+.5)-p.stake*100)}</strong></div></div><p id="liveQuoteStatus" role="status"></p><div id="swipeZone" class="rh-swipe" role="button" tabindex="0" aria-label="Swipe up to punch ticket"><div class="swipe-glyph">&#8593;</div><div class="swipe-text">Swipe up to punch ticket</div><div class="swipe-sub">Slide from here to submit</div></div><button class="btn fill" id="liveRetry" hidden>Retry same request</button><p class="slip-footnote">Live MTA data &middot; No real money</p></section><div id="swipeProgress" class="swipe-progress" aria-hidden="true"></div>`;
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


    // The backend is the sole authority for grants, username and balances.
    async function collectRewards(){
      if(!state.token||state.rewardBusy)return;
      const gen=state.generation,token=state.token;state.rewardBusy=true;
      let daily=false,weekly=false;
      try{
        const grants=await rpc('get_my_reward_status',token);
        if(gen!==state.generation)return;
        if(!Array.isArray(grants)||grants.length!==2)throw Error('Reward status unavailable');
        for(const kind of ['DAILY_GRANT','WEEKLY_GRANT']){
          if(gen!==state.generation)return;
          if(!grants.some(g=>g.reward_kind===kind&&g.available===true))continue;
          const awarded=await rpc('claim_my_reward',token,{p_kind:kind});
          if(gen!==state.generation)return;
          if(awarded===true){if(kind==='DAILY_GRANT')daily=true;else weekly=true;}
          else if(awarded!==false)throw Error('Unconfirmed grant');
        }
        state.meError='';
      }catch(e){if(gen===state.generation)state.meError='Reward check unavailable. You can retry safely from Me.';}
      finally{if(gen===state.generation){state.rewardBusy=false;if(weekly){const el=document.createElement('div');el.className='weekly-celebrate';el.id='weeklyCelebrate';el.innerHTML='<button class="celebrate-close" aria-label="Dismiss celebration">&times;</button><div class="nyc-coin"><span class="small-n">N</span><b>Y</b><span class="small-c">C</span></div><h2>Sunday payday!</h2><p>+1,000 Tokens</p><small>All aboard for another week.</small>';document.body.appendChild(el);el.onclick=()=>el.remove();setTimeout(()=>el.remove(),2800);if(daily)showToast('Daily Tokens collected: +50');}else if(daily)showToast('Daily Tokens collected: +50');renderMe();}}
    }
    async function refreshMe(){
      if(!state.token||state.meBusy||state.rewardBusy||state.tab!=='me')return;
      const gen=state.generation;state.meBusy=true;
      try{const [player,rewards,receipts,referrals]=await Promise.all([rpc('get_my_player',state.token),rpc('get_my_reward_status',state.token),rpc('get_my_reward_receipts',state.token),rpc('get_my_referral_status',state.token)]);if(gen!==state.generation)return;const avatars=player?.[0]?.player_id?await rpc('get_player_avatars',state.token,{p_ids:[player[0].player_id]}):[];if(gen!==state.generation)return;if(!Array.isArray(player)||player.length!==1||!Array.isArray(rewards))throw Error('Account unavailable');state.player=player[0];state.referrals=referrals?.[0]||null;state.rewards=rewards;state.receipts=Array.isArray(receipts)?receipts:null;state.avatarLine=avatars?.[0]?.avatar_line||'6';state.meError='';document.getElementById('headerBalance').textContent=(Number(state.player.available_minor)/100).toLocaleString('en-US',{maximumFractionDigits:0});}
      catch(e){if(gen===state.generation)state.meError='Account refresh unavailable. Try again.';}
      finally{if(gen===state.generation){state.meBusy=false;renderMe();}}
    }
    function weekStartNY(){
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const val=k=>Number(parts.find(p=>p.type===k).value);const d=new Date(Date.UTC(val('year'),val('month')-1,val('day')));d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10);
    }
    const nyDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
    function renderMe(){
      const el=document.getElementById('liveMe');if(!el||state.tab!=='me')return;
      const player=state.player,all=state.tickets||[],ready=state.tickets!==null&&!state.portfolioError;
      const risk=all.filter(t=>!completed(t)).reduce((n,t)=>n+minor(t.stake_minor),0);
      const week=weekStartNY(),net=all.filter(t=>completed(t)&&t.closed_at&&nyDay(t.closed_at)>=week).reduce((n,t)=>n+minor(t.net_minor),0);
      const decisive=all.filter(t=>['WON','LOST'].includes(t.status));const win=decisive.length?Math.round(decisive.filter(t=>t.status==='WON').length/decisive.length*100):0;
      const draft=state.meDraft??(/^guest_/i.test(player?.username||'')?'':player?.username??'');
      const focused=document.activeElement?.id==='myName',cursor=focused?document.activeElement.selectionStart:null;
      const markup=`<div class="profile-hero">${classicBullet(state.avatarLine,'large')}<div><h2>${safe(/^guest_/i.test(player?.username||'')?'Guest Rider':player?.username||'Your profile')}</h2><p>Private alpha account</p><small class="muted">${safe(state.accountEmail||'Signed-in account')}</small></div></div><div class="summary-grid"><div class="summary-box"><small>Portfolio</small><strong>${ready?cash(minor(player?.available_minor)+risk):'&mdash;'}</strong></div><div class="summary-box"><small>Weekly P/L</small><strong class="${tone(net)}">${ready?signedCash(net):'&mdash;'}</strong></div><div class="summary-box"><small>Win Rate</small><strong>${ready?win+'%':'&mdash;'}</strong></div></div><p class="intro-note">Test prediction statistics. Voids excluded from win rate.</p><section class="shell-section"><div class="section-label"><h2>My Profile</h2><span class="dashes"></span></div><label class="form-label" for="myName">Username</label><div class="inputrow"><input class="field" id="myName" placeholder="Choose a username" maxlength="40" autocomplete="off" value="${safe(draft)}" ${state.meBusy?'disabled':''}><button class="btn small" id="saveName" ${state.meBusy||!player||draft===player.username||!/^[A-Za-z0-9_]{3,40}$/.test(draft)||/^guest_/i.test(draft)?'disabled':''}>Save</button></div><p class="fineprint">3&ndash;40 letters, numbers or underscores.</p></section><section class="shell-section"><div class="section-label"><h2>My Avatar</h2><span class="dashes"></span></div><p class="intro-note">Pick the subway roundel shown by your username. Change it anytime.</p><div class="avatar-grid">${Object.keys(routeColors).filter(r=>r!=='ALL').map(r=>`<button type="button" data-avatar-line="${r}" aria-label="Select ${r} avatar" aria-pressed="${state.avatarLine===r}" ${state.avatarBusy||state.meBusy||!player?'disabled':''}>${classicBullet(r)}</button>`).join('')}</div></section><section class="shell-section"><div class="section-label"><h2>My Rewards</h2><button type="button" class="info-icon" id="liveRewardsInfo" aria-label="How rewards work" aria-expanded="${state.rewardInfo}">i</button><span class="dashes"></span></div>${state.rewardInfo?'<div class="reward-info" role="region" aria-label="How rewards work"><strong>How Rewards Work</strong><p>Daily Reward: Receive 50 Tokens when you sign in each day. Resets at midnight ET.</p><p>Weekly Reward: Receive 1,000 Tokens when you sign in each week. Resets every Sunday at midnight ET.</p><p>Rewards collect automatically, once per period. Unclaimed rewards do not accumulate.</p></div>':''}${['DAILY_GRANT','WEEKLY_GRANT'].map(kind=>{const g=state.rewards?.find(x=>x.reward_kind===kind),receipt=state.receipts?.find(x=>x.reward_kind===kind),done=g?.available===false;return `<div class="reward-row"><span class="reward-check ${done?'':'pending'}" role="img" aria-label="${done?'Received':g?'Not yet received':'Checking status'}">${done?'&#9745;':'&#9744;'}</span><span>${kind==='DAILY_GRANT'?'Daily Reward':'Weekly Reward'}<small class="muted" style="display:block">Last Received: ${receipt?.last_received_at?safe(dateTime(receipt.last_received_at)):state.receipts?'Never':'Checking...'}</small><small class="muted" style="display:block">Next Reset: ${g?safe(dateTime(g.next_reset_at)):'Checking...'}</small></span><strong>${cash(kind==='DAILY_GRANT'?5000:100000)}</strong></div>`}).join('')}${state.meError&&state.meError.includes('Reward')||state.rewards?.some(g=>g.available)?`<button class="btn secondary fill" id="liveClaim" ${state.rewardBusy||state.meBusy?'disabled':''}>Collect Available Rewards</button>`:''}<p class="fineprint">Rewards collect automatically on sign-in. Reset times follow New York time.</p><button class="btn secondary fill" id="liveMeTransactions">View Transaction History</button></section><section class="shell-section"><div class="section-label"><h2>Refer a Friend</h2><span class="dashes"></span></div><p class="intro-note">You both get 100 Tokens when your friend verifies their account and makes a genuine prediction.</p><p>Friends referred: ${safe(state.referrals?.total_referrals??"â")} &middot; Qualified: ${safe(state.referrals?.qualified_referrals??"â")}</p><p>Tokens earned: ${state.referrals?cash(state.referrals.earned_minor):"&mdash;"}</p><button class="btn secondary fill" id="liveShareReferral" ${!state.referrals?.referral_code?"disabled":""}>Share Referral Link</button></section><section class="shell-section"><div class="section-label"><h2>Station Services</h2><span class="dashes"></span></div><p class="intro-note">Your account is saved on the server.</p><button class="btn secondary fill" id="liveMeRefresh" ${state.meBusy?'disabled':''}>Refresh Account</button></section>${state.meError?`<p class="notice" role="status">${safe(state.meError)}</p>`:''}`;
      if(el.dataset.rendered===markup)return;el.dataset.rendered=markup;el.innerHTML=markup;
      const input=el.querySelector('#myName'),save=el.querySelector('#saveName');input.oninput=()=>{state.meDraft=input.value;save.disabled=state.meBusy||!player||input.value===player.username||!/^[A-Za-z0-9_]{3,40}$/.test(input.value)||/^guest_/i.test(input.value);};save.onclick=()=>saveUsername();if(focused&&!input.disabled){input.focus({preventScroll:true});if(cursor!==null)input.setSelectionRange(cursor,cursor);}
      el.querySelector('#liveRewardsInfo').onclick=()=>{state.rewardInfo=!state.rewardInfo;renderMe();};el.querySelectorAll('[data-avatar-line]').forEach(b=>b.onclick=()=>saveAvatar(b.dataset.avatarLine));
      el.querySelector('#liveShareReferral').onclick=()=>shareLink('Ride with me on Subway Exchange! Earn 100 Tokens when you verify your account and make your first prediction.',shareURL('ref',state.referrals.referral_code));
      el.querySelector('#liveMeTransactions').onclick=openTransactions;
      el.querySelector('#liveMeRefresh').onclick=()=>{refreshMe();refreshPortfolio();};const claim=el.querySelector('#liveClaim');if(claim)claim.onclick=async()=>{await collectRewards();if(state.token){await refreshMe();refreshPortfolio();}};
    }
    async function saveAvatar(line){
      if(!Object.hasOwn(routeColors,line)||line==='ALL'||!state.token||state.avatarBusy||state.meBusy)return;
      const gen=state.generation;state.avatarBusy=true;renderMe();
      try{await rpc('set_my_avatar',state.token,{p_line:line});if(gen!==state.generation)return;state.avatarLine=line;state.meError='';showToast('Avatar saved');}
      catch(e){if(gen===state.generation)state.meError='Unable to save avatar. Please try again.';}
      finally{if(gen===state.generation){state.avatarBusy=false;renderMe();}}
    }
    async function saveUsername(){
      const value=state.meDraft?.trim();if(!value||!/^[A-Za-z0-9_]{3,40}$/.test(value)||/^guest_/i.test(value)||state.meBusy||!state.token)return;
      const gen=state.generation;state.meBusy=true;renderMe();
      try{await rpc('update_my_username',state.token,{p_username:value});if(gen!==state.generation)return;state.meDraft=null;state.meError='';showToast('Username saved');}
      catch(e){if(gen===state.generation)state.meError='Unable to save username. It may be unavailable. Try another name.';}
      finally{if(gen===state.generation){state.meBusy=false;if(!state.meError)await refreshMe();else renderMe();}}
    }

    // Real Crew and ranking APIs. No mock standings or test scores.
    const socialTabs=(items,selected)=>'<div class="segment compact-segment">'+items.map(([v,l])=>`<button type="button" data-social-tab="${v}" class="${v===selected?'is-on':''}" ${state.socialBusy?'disabled':''}>${l}</button>`).join('')+'</div>';
    const riderName=v=>/^guest_/i.test(v||'')?'Guest Rider':v||'Rider';
    function socialRows(rows,crew=false){
      if(!rows.length)return '<div class="empty"><h3>No standings yet</h3><p>Only eligible completed predictions count toward official rankings.</p></div>';
      return '<div class="rank-list">'+rows.map(r=>`<div class="rank-row ${crew?'crew-rank':''}"><span class="position">${safe(r.rank)}</span>${crew?'':classicBullet(r.avatar_line||'6','small')}<span class="name" title="${safe(crew?r.crew_name:riderName(r.username))}">${safe(crew?r.crew_name:riderName(r.username))} ${r.is_me||r.is_my_crew?'<span class="badge">YOU</span>':''}${r.is_captain?' <small class="muted">Captain</small>':''}${crew?`<small class="muted" style="display:block">${safe(r.member_count)} members</small>`:''}</span><span class="score ${tone(crew?r.average_net_minor:r.net_minor)}">${signedCash(crew?r.average_net_minor:r.net_minor)}</span></div>`).join('')+'</div>';
    }
    function renderSocial(){
      const tab=state.tab;if(!['crew','ranks'].includes(tab))return;
      const el=document.getElementById(tab==='crew'?'liveCrew':'liveRanks');if(!el)return;
      el.querySelector('dialog[open]')?.close();
      const busy=state.socialBusy?'disabled':'', error=state.socialError?`<p class="notice" role="status">${safe(state.socialError)} <button class="tiny-action" data-social-action="refresh">Retry</button></p>`:'';
      const period=(value)=>`<select class="field" aria-label="Ranking period" id="liveRankPeriod" style="width:auto;min-width:0;padding:6px 28px 6px 10px;font-size:12px;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22m6 9 6 6 6-6%22 fill=%22none%22 stroke=%22%23dce7f0%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E');background-position:right 7px center;background-repeat:no-repeat;background-size:16px 16px" ${busy}><option value="WEEKLY" ${value==='WEEKLY'?'selected':''}>Weekly</option><option value="ALL_TIME" ${value==='ALL_TIME'?'selected':''}>All Time</option></select>`;
      const heading=(title,value)=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0"><h2 class="rank-title compact-rank-title" style="margin:0">${title}</h2>${period(value)}</div>`;
      if(tab==='ranks'){
        el.innerHTML=socialTabs([['players','Riders'],['crews','Crews']],state.rankType)+heading(state.rankType==='crews'?'Crew Standings':'Trading Profit',state.rankPeriod)+error+(state.socialBusy?'<p role="status">Loading standings...</p>':socialRows(state.rankRows,state.rankType==='crews'))+'<p class="fineprint">Private alpha: test prediction P/L only. Rewards excluded. Crew scores are averages per eligible member. Weeks reset Sunday, New York time.</p>';
      }else{
        const c=state.crews.find(x=>x.crew_id===state.crewId),captain=c?.is_captain;
        const gear='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2 2-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1.01 1.52V20h-2.8v-.09A1.65 1.65 0 0 0 10.6 18.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2-2 .06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.52-1.01H5.5v-2.8h.1A1.65 1.65 0 0 0 7.1 10.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2-2 .06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1.01-1.52V5.5h2.8v.1a1.65 1.65 0 0 0 1.01 1.52 1.65 1.65 0 0 0 1.82-.33l.06-.06 2 2-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.52 1.01H21v2.8h-.09A1.65 1.65 0 0 0 19.4 15Z"/></svg>';
        const members=state.crewRows.filter(r=>!r.is_me&&!r.is_captain);
        const memberSelect=(id)=>`<select class="field" id="${id}" required ${busy}><option value="">Select a member</option>${members.map(r=>`<option value="${safe(r.player_id)}">${safe(riderName(r.username))}</option>`).join('')}</select>`;
        el.innerHTML=`${error}${state.crews.length>1?`<label class="crew-chooser"><span>Your Crews</span><select class="field" id="liveCrewSelect" ${busy}>${state.crews.map(x=>`<option value="${safe(x.crew_id)}" ${x.crew_id===state.crewId?'selected':''}>${safe(x.crew_name)}</option>`).join('')}</select></label>`:''}${c?`<div class="crew-title"><h2>${safe(c.crew_name)}</h2><button class="icon-plain" data-social-action="settings" aria-label="Crew settings" ${busy}>${gear}</button></div><p class="intro-note">${safe(c.member_count)} members${captain?' &middot; You are captain':''}</p>${heading('Standings',state.crewPeriod)}${state.socialBusy?'<p role="status">Updating Crew...</p>':socialRows(state.crewRows)}${captain?`<button class="btn secondary fill" data-social-action="invite" ${busy}>Share Invite</button>${state.inviteCode?`<p class="live-invite-code">${safe(state.inviteCode)}</p><button class="btn secondary fill" data-social-action="copy" ${busy}>Share or Copy Link</button>`:''}`:''}`:'<div class="empty"><h3>Don&apos;t Ride Alone</h3><p>Create a Crew or join with an invitation code.</p></div>'}<section class="shell-section"><div class="section-label"><h2>Join or Create a Crew</h2><span class="dashes"></span></div><form id="liveJoinCrew" class="live-social-form"><label class="form-label" for="liveJoinCode">Invitation Code</label><div class="inputrow"><input id="liveJoinCode" class="field" autocomplete="off" placeholder="Enter code" required maxlength="32" pattern="(?:[a-fA-F0-9]{32}|[23456789A-HJ-NP-Za-hj-np-z]{8})" ${busy}><button class="btn small" ${busy}>Join</button></div></form><form id="liveCreateCrew" class="live-social-form"><label class="form-label" for="liveNewCrew">Crew Name</label><div class="inputrow"><input id="liveNewCrew" class="field" required minlength="2" maxlength="80" placeholder="Name your Crew" ${busy}><button class="btn small" ${busy}>Create</button></div></form></section><p class="fineprint">Private alpha. Standings use alpha predictions.</p>`;
        if(c&&state.crewSettings){
          const d=document.createElement('dialog');d.id='liveCrewSettings';d.style.cssText='width:min(92vw,480px);max-height:85vh;overflow:auto;border:1px solid #637589;border-radius:16px;background:#112a45;color:white;padding:20px;box-sizing:border-box';
          d.innerHTML=`<div class="crew-title"><h2>Crew Settings</h2><button class="icon-plain" data-social-action="close-settings" aria-label="Close settings">&#10005;</button></div>${captain?`<form id="liveRenameCrew" class="live-social-form"><label class="form-label" for="liveCrewTitle">Change Crew Name</label><div class="inputrow"><input id="liveCrewTitle" class="field" minlength="2" maxlength="80" required value="${safe(c.crew_name)}" ${busy}><button class="btn small" ${busy}>Save</button></div></form><form id="liveRemoveMember" class="live-social-form"><label class="form-label" for="liveRemoveSelect">Remove Member</label><div class="inputrow">${memberSelect('liveRemoveSelect')}<button class="btn small secondary" ${busy||!members.length?'disabled':''}>Remove</button></div></form><form id="liveTransferMember" class="live-social-form"><label class="form-label" for="liveTransferSelect">Transfer Captaincy</label><div class="inputrow">${memberSelect('liveTransferSelect')}<button class="btn small secondary" ${busy||!members.length?'disabled':''}>Transfer</button></div><p class="fineprint">You will become a regular Crew member.</p></form>`:`<button class="btn secondary fill" data-social-action="leave" ${busy}>Leave Crew</button>`}`;
          el.appendChild(d);d.addEventListener('cancel',()=>{state.crewSettings=false;});d.showModal();
        }
        const sel=el.querySelector('#liveCrewSelect');if(sel)sel.onchange=()=>{state.crewId=sel.value;state.inviteCode='';state.crewSettings=false;refreshSocial();};
        for(const [id,fn] of [['liveJoinCrew',()=>socialMutation('join_crew',{p_code:el.querySelector('#liveJoinCode').value.trim().toLowerCase()})],['liveCreateCrew',()=>socialMutation('create_my_crew',{p_title:el.querySelector('#liveNewCrew').value.trim()})],['liveRenameCrew',()=>socialMutation('rename_crew',{p_crew:c.crew_id,p_title:el.querySelector('#liveCrewTitle').value.trim()})],['liveRemoveMember',()=>{const m=el.querySelector('#liveRemoveSelect').value;if(m&&confirm('Remove this member?'))socialMutation('remove_crew_member',{p_crew:c.crew_id,p_member:m});}],['liveTransferMember',()=>{const m=el.querySelector('#liveTransferSelect').value;if(m&&confirm('Transfer captaincy?'))socialMutation('transfer_crew_captain',{p_crew:c.crew_id,p_member:m});}]]){const f=el.querySelector('#'+id);if(f)f.onsubmit=e=>{e.preventDefault();fn();};}
      }
      const periodSelect=el.querySelector('#liveRankPeriod');if(periodSelect)periodSelect.onchange=()=>{if(tab==='crew')state.crewPeriod=periodSelect.value;else state.rankPeriod=periodSelect.value;refreshSocial();};
      el.querySelectorAll('[data-social-tab]').forEach(b=>b.onclick=()=>{state.rankType=b.dataset.socialTab;refreshSocial();});
      el.querySelectorAll('[data-social-action]').forEach(b=>b.onclick=async()=>{
        const a=b.dataset.socialAction,id=state.crewId;
        if(a==='settings'||a==='close-settings'){state.crewSettings=a==='settings';renderSocial();return;}
        if(a==='refresh')return refreshSocial();
        if(a==='copy'||(a==='invite'&&state.inviteCode)){const c=state.crews.find(x=>x.crew_id===id);return shareLink('Join my Crew - '+(c?.crew_name||'')+' - on Subway Exchange!',shareURL('crew',state.inviteCode));}
        if(a==='invite')return socialMutation('create_crew_invite',{p_crew:id});
        if(a==='leave'&&confirm('Leave this Crew?'))return socialMutation('leave_crew',{p_crew:id});
      });
    }
    async function attachAvatars(rows,token){
      const ids=[...new Set(rows.map(r=>r.player_id).filter(Boolean))],map=new Map();
      for(let i=0;i<ids.length;i+=100){const avatars=await rpc('get_player_avatars',token,{p_ids:ids.slice(i,i+100)});if(!Array.isArray(avatars))throw Error('Invalid avatars');for(const a of avatars)map.set(a.player_id,a.avatar_line);}
      return rows.map(r=>({...r,avatar_line:map.get(r.player_id)||'6'}));
    }
    async function refreshSocial(){
      const tab=state.tab;if(!state.token||!['crew','ranks'].includes(tab)||state.socialBusy)return;
      const gen=state.generation,epoch=++state.socialEpoch,token=state.token;state.socialBusy=true;state.socialError='';renderSocial();
      const current=()=>gen===state.generation&&epoch===state.socialEpoch;
      try{
        if(tab==='crew'){
          const crews=await rpc('get_my_crews',token);if(!current())return;if(!Array.isArray(crews))throw Error('Invalid crew response');state.crews=crews;
          if(!crews.some(c=>c.crew_id===state.crewId)){state.crewId=crews[0]?.crew_id||null;state.inviteCode='';}
          const rows=state.crewId?await rpc('get_crew_leaderboard',token,{p_crew:state.crewId,p_period:state.crewPeriod}):[];if(!current())return;if(!Array.isArray(rows))throw Error('Invalid standings');const enriched=await attachAvatars(rows,token);if(!current())return;state.crewRows=enriched;
        }else{const rows=await rpc(state.rankType==='crews'?'get_global_crew_leaderboard':'get_player_leaderboard',token,{p_period:state.rankPeriod});if(!current())return;if(!Array.isArray(rows))throw Error('Invalid rankings');const enriched=state.rankType==='crews'?rows:await attachAvatars(rows,token);if(!current())return;state.rankRows=enriched;}
      }catch(e){if(current()){state.socialError='Unable to load current data. Please retry.';if(tab==='crew'){state.crews=[];state.crewRows=[];}else state.rankRows=[];}}
      finally{if(current()){state.socialBusy=false;if(state.tab===tab)renderSocial();else if(['crew','ranks'].includes(state.tab))refreshSocial();}}
    }
    async function socialMutation(name,args){
      if(state.socialBusy||!state.token)return;const gen=state.generation,token=state.token;state.crewSettings=false;state.socialBusy=true;state.socialError='';renderSocial();let ok=false;
      try{const result=await rpc(name,token,args);if(gen!==state.generation)return;if(name==='create_crew_invite'){if(typeof result!=='string'||!invitePattern.test(result))throw Error('Invalid code');state.inviteCode=result;const c=state.crews.find(x=>x.crew_id===state.crewId);await shareLink('Join my Crew - '+(c?.crew_name||'')+' - on Subway Exchange!',shareURL('crew',result));}else if(['create_my_crew','join_crew'].includes(name)){if(typeof result!=='string')throw Error('Invalid Crew ID');state.crewId=result;state.inviteCode='';}else if(['leave_crew','transfer_crew_captain','revoke_crew_invites'].includes(name)){state.inviteCode='';}ok=true;showToast(name==='create_crew_invite'?'Invitation created':'Crew updated');}
      catch(e){if(gen===state.generation)state.socialError='Action could not be confirmed. Refresh before retrying; the request may have reached the server.';}
      finally{if(gen===state.generation){state.socialBusy=false;if(ok)refreshSocial();else renderSocial();}}
    }

    bootAuth();
    setInterval(()=>{if(state.token&&!document.hidden){if(state.tab==='portfolio')renderPortfolio();else if(state.tab==='lines')renderRows();}},1000);
    setInterval(()=>{if(state.tab==='lines')refresh();refreshPortfolio();},5000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.tab==='portfolio')refreshPortfolio();else if(state.tab==='me'){refreshMe();refreshPortfolio();}else if(['crew','ranks'].includes(state.tab)){refreshSocial();refreshPortfolio();}else{renderRows();refresh();refreshPortfolio();}}});
    return true;
  }
};
