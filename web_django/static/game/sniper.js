(() => {
  'use strict';
  const domCache=new Map();
  const $ = s => domCache.get(s)||(domCache.set(s,document.querySelector(s)),domCache.get(s)), canvas = $('#game'), ctx = canvas.getContext('2d');
  window.addEventListener('error',function(e){var st=document.querySelector('#onlineStatus');if(st)st.textContent='게임 오류: '+e.message+' (줄 '+e.lineno+')';});
  const W=1440,H=900, TAU=Math.PI*2, clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  let mode='menu', scoped=false, muted=false, audio, last=0, time=0, yaw=0, pitch=0;
  let camera={x:0,y:9,z:0}, keys=new Set(), targets=[], effects=[], wave=1,kills=0,score=0,hp=100,ammo=5,shots=0,heads=0,hits=0;
  let reload=0,bolt=0,recoil=0,damageFlash=0,hitMark=0,breath=100,breakTime=0,messageTime=0;
  let message='',viewYaw=0,viewPitch=0,focal=850,lockedBefore=false;
  let viewSinYaw=0,viewCosYaw=1,viewSinPitch=0,viewCosPitch=1;
  const WEAPONS={
    sniper:{name:'M-24 저격총',label:'BOLT ACTION / 4×',mag:5,damage:80,critical:2.5,interval:1.05,reload:1.45,zoom:3000,kick:.024,auto:false},
    rifle:{name:'AR-4 라이플',label:'FULL AUTO / RED DOT',mag:30,damage:24,critical:2,interval:.105,reload:1.15,zoom:1250,kick:.008,auto:true},
    knife:{name:'전투용 뚫어뻥',label:'MELEE / 근접 베기',mag:1,damage:150,critical:1,interval:.48,reload:0,zoom:850,kick:0,auto:false},
  };
  let weaponId='rifle',inventory={},trigger=false,meleeSwing=0,aimBlend=0,switchTime=0,aimKick=0,walkPhase=0,emptyClick=0;
  let projectiles=[],tracers=[],combo=0,comboTime=0,hitCritical=false;
  let sensitivity=1,adsSensitivity=.7,laserCooldown=0,dashCooldown=0,dashTime=0,contactGrace=0;
  const DIFFICULTIES={easy:{name:'쉬움',speed:.75,damage:.65},normal:{name:'보통',speed:1,damage:1},hard:{name:'어려움',speed:1.35,damage:1.5}};
  let difficulty='normal',jumpHeight=0,jumpVelocity=0,stanceHeight=9;
  const level=()=>DIFFICULTIES[difficulty];
  function setDifficulty(id){
    difficulty=Object.prototype.hasOwnProperty.call(DIFFICULTIES,id)?id:'normal';
    document.querySelectorAll('[data-difficulty]').forEach(el=>el.value=difficulty);
    document.querySelectorAll('[data-difficulty-info]').forEach(el=>el.textContent=`적 속도 ${level().speed.toFixed(2)}× · 피해 ${level().damage.toFixed(2)}×`);
    try{localStorage.setItem('faceoff-difficulty',difficulty);}catch(e){}
  }
  try{const saved=localStorage.getItem('faceoff-difficulty');if(Object.prototype.hasOwnProperty.call(DIFFICULTIES,saved))difficulty=saved;}catch(e){}
  document.querySelectorAll('[data-difficulty]').forEach(el=>el.addEventListener('change',()=>setDifficulty(el.value)));
  setDifficulty(difficulty);
  function jump(){if(!canAct()||!combatGrounded)return;combatGrounded=false;jumpVelocity=12.5;scoped=false;tone(190,.08,.03,'triangle');}
  function sprinting(){return false;}
  function shiftMove(){if(['combat','duel'].includes(gameMode))dash();}
  let dashVector={x:0,z:1},laserBeams=[],lastMouse=null;
  const gun=()=>WEAPONS[weaponId];
  function setSensitivity(value,ads=false){
    const n=Number(value),v=Number.isFinite(n)?clamp(n,.2,ads?2:3):1;
    if(ads)adsSensitivity=v;else sensitivity=v;
    document.querySelectorAll(ads?'[data-setting="ads"]':'[data-setting="look"]').forEach(el=>{el.value=v;el.nextElementSibling.textContent=v.toFixed(2)+'×';});
    try{localStorage.setItem('faceoff-sensitivity',JSON.stringify({look:sensitivity,ads:adsSensitivity}));}catch(e){}
  }
  try{const saved=JSON.parse(localStorage.getItem('faceoff-sensitivity')||'null');if(saved){sensitivity=Number.isFinite(saved.look)?clamp(saved.look,.2,3):1;adsSensitivity=Number.isFinite(saved.ads)?clamp(saved.ads,.2,2):.7;}}catch(e){}
  document.querySelectorAll('[data-setting]').forEach(el=>el.addEventListener('input',()=>setSensitivity(el.value,el.dataset.setting==='ads')));
  setSensitivity(sensitivity);setSensitivity(adsSensitivity,true);
  function look(dx,dy){if(!Number.isFinite(dx)||!Number.isFinite(dy))return;const scale=.0015*sensitivity*(scoped?adsSensitivity:1)*850/focal;yaw+=dx*scale;pitch=clamp(pitch-dy*scale,-1.55,1.55);}

  let damageCue={life:0,amount:0,source:null,effect:''},hpTrail=100,hitNoise=null;
  let skillWarnings=[];
  let laserSlow=0,waterSlow=0;
  const slowRemaining=()=>Math.max(laserSlow,waterSlow);
  function applySlow(duration,water=false){
    const fresh=slowRemaining()<=0;
    if(water)waterSlow=Math.max(waterSlow,duration);else laserSlow=Math.max(laserSlow,duration);
    if(fresh&&duration>0)tone(125,.16,.055,'triangle');
  }
  function updateWet(dt){
    laserSlow=Math.max(0,laserSlow-dt);waterSlow=0;
    if(!online.roomCode||online.isHost)for(const t of targets)t.slow=Math.max(0,(t.slow||0)-dt);
  }
  const effectName=e=>({rifle:'라이플',sniper:'저격총',laser:'오줌 레이저',poop:'똥 투하',melee:'뚫어뻥',paper:'휴지'})[e]||'공격';
  function damageFeedback(amount,source=null,effect=''){
    if(amount<=0)return;
    damageFlash=Math.max(damageFlash,.7);
    damageCue={life:1.25,amount:Math.round(amount)+(damageCue.life>1?damageCue.amount:0),source:source?{x:source.x,z:source.z}:null,effect};
    tone(84,.18,.19,'triangle');
    if(muted||!audio)return;
    if(!hitNoise){
      hitNoise=audio.createBuffer(1,Math.floor(audio.sampleRate*.1),audio.sampleRate);
      const samples=hitNoise.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*Math.exp(-i/(audio.sampleRate*.022));
    }
    const src=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
    src.buffer=hitNoise;filter.type='lowpass';filter.frequency.value=1100;gain.gain.value=.32;
    src.connect(filter);filter.connect(gain);gain.connect(audio.destination);src.start();
    src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};
  }
  function drawDamageFeedback(){
    if(mode==='menu')return;
    const pulse=hp>0&&hp<=30?.12+Math.sin(time*6)*.035:0;
    if(damageFlash>0||pulse){
      const g=ctx.createRadialGradient(W/2,H/2,H*.22,W/2,H/2,W*.65);
      g.addColorStop(0,'rgba(190,22,30,0)');g.addColorStop(.55,'rgba(190,22,30,'+(damageFlash*.2+pulse*.25)+')');
      g.addColorStop(1,'rgba(235,30,40,'+clamp(damageFlash*1.2+pulse,0,.86)+')');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
      if(damageFlash>.42){ctx.fillStyle='rgba(255,95,75,'+((damageFlash-.42)*.16)+')';ctx.fillRect(0,0,W,H);}
    }
    if(damageCue.life<=0)return;
    ctx.save();ctx.globalAlpha=Math.min(1,damageCue.life*3);
    if(damageCue.source){
      const a=Math.atan2(damageCue.source.x-camera.x,damageCue.source.z-camera.z)-yaw;
      ctx.translate(W/2,H/2);ctx.rotate(a);ctx.strokeStyle='#ff514f';ctx.lineWidth=7;
      ctx.beginPath();ctx.arc(0,0,105,-Math.PI/2-.3,-Math.PI/2+.3);ctx.stroke();
      polygon([{x:0,y:-130},{x:-8,y:-113},{x:8,y:-113}],'#ffe0d3');ctx.rotate(-a);ctx.translate(-W/2,-H/2);
    }
    ctx.textAlign='center';ctx.font='900 28px sans-serif';ctx.fillStyle='#ffada0';ctx.strokeStyle='#2e1018';ctx.lineWidth=5;
    const text='−'+damageCue.amount+' HP';ctx.strokeText(text,W/2,H*.67);ctx.fillText(text,W/2,H*.67);
    ctx.font='bold 14px sans-serif';ctx.fillStyle='#ffd4c9';ctx.fillText(effectName(damageCue.effect)+' 피격',W/2,H*.67+25);ctx.restore();
  }
  function hurt(amount,text){
    if((mode!=='playing'&&!(online.roomCode&&mode==='paused'))||dashTime>0||contactGrace>0||hp<=0)return false;
    const previous=hp;hp=Math.max(0,hp-Math.round(amount*level().damage));contactGrace=.65;damageFeedback(previous-hp);say(text,1.1);
    if(hp<=0){voice('으악');say('으악!',1.2);end(false);}return true;
  }
  function laser(){if(!canAct())return;if(laserCooldown>0||laserUlt){say('오줌 레이저 · '+laserCooldown.toFixed(1)+'초 후 사용 가능',1);return;}laserCooldown=5;beginLaserUlt(true);}
  function dash(){
    if(!canAct()||dashCooldown>0)return;
    const dx=Number(keys.has('d'))-Number(keys.has('a'));let dz=Number(keys.has('w'))-Number(keys.has('s'));
    if(!dx&&!dz)dz=1;const mag=Math.hypot(dx,dz);
    dashVector={x:(dx*Math.cos(yaw)+dz*Math.sin(yaw))/mag,z:(dz*Math.cos(yaw)-dx*Math.sin(yaw))/mag};
    emitFx('dash');dashTime=.18;dashCooldown=2.5;scoped=false;tone(230,.18,.07,'triangle');say('SHIFT 이동기 · 이동 중 피해 회피',.7);
  }
  function resetInventory(){inventory=Object.fromEntries(Object.entries(WEAPONS).map(([id,w])=>[id,{ammo:w.mag,cooldown:0}]));ammo=inventory[weaponId].ammo;}
  resetInventory();
  const blocks=[];const mapPalette=['#52636c','#606974','#697371','#586b68','#786f62','#596774'];
  // Bathroom scenery also participates in the existing world ray tests.
  blocks.push({x:0,y:17,z:82,w:43,h:24,d:10,color:'#a2b0ad'},
    {x:0,y:29.5,z:82,w:45,h:1,d:12,color:'#bac5be'},
    {x:15,y:24,z:76.5,w:5,h:1,d:1.2,color:'#859e9f'});
  for(let i=0;i<24;i++){const a=i*TAU/24;blocks.push({x:Math.cos(a)*27,y:6.6,z:30+Math.sin(a)*48,w:6.5,h:2,d:7,color:i%2?'#b3beb5':'#9baaa4'});}
  let gunNoise=null;
  function gunshot(){
    if(muted||!audio)return;
    const now=audio.currentTime,master=audio.createGain();master.gain.setValueAtTime(.34,now);master.gain.exponentialRampToValueAtTime(.001,now+.24);master.connect(audio.destination);
    const osc=audio.createOscillator(),og=audio.createGain();osc.type='sawtooth';osc.frequency.setValueAtTime(145,now);osc.frequency.exponentialRampToValueAtTime(42,now+.2);og.gain.setValueAtTime(.34,now);og.gain.exponentialRampToValueAtTime(.001,now+.2);osc.connect(og);og.connect(master);osc.start(now);osc.stop(now+.22);
    if(!gunNoise){gunNoise=audio.createBuffer(1,Math.floor(audio.sampleRate*.12),audio.sampleRate);const data=gunNoise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/(audio.sampleRate*.018));}const buffer=gunNoise;
    const src=audio.createBufferSource(),filter=audio.createBiquadFilter(),ng=audio.createGain();src.buffer=buffer;filter.type='highpass';filter.frequency.value=700;ng.gain.setValueAtTime(.55,now);ng.gain.exponentialRampToValueAtTime(.001,now+.12);src.connect(filter);filter.connect(ng);ng.connect(master);src.start(now);src.onended=()=>{src.disconnect();filter.disconnect();ng.disconnect();};osc.onended=()=>{osc.disconnect();og.disconnect();master.disconnect();};
  }
  function tone(freq,duration,volume=.08,type='sine'){
    if(muted||!audio)return;
    const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.3),audio.currentTime+duration);
    g.gain.setValueAtTime(volume,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
    o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  function say(text,duration=1.8){message=text;messageTime=duration;}
  function voice(text){if(muted)return;try{if('speechSynthesis' in window){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text),voices=speechSynthesis.getVoices();const male=voices.find(v=>/^ko/i.test(v.lang)&&/(male|남|man|m男子)/i.test(v.name));u.voice=male||voices.find(v=>/^ko/i.test(v.lang))||null;u.lang='ko-KR';u.rate=.78;u.pitch=.35;u.volume=1;speechSynthesis.speak(u);}}catch(e){}}
  function lock(){
    try{const p=canvas.requestPointerLock();if(p&&p.catch)p.catch(()=>say('마우스 고정 불가 · 화면 안에서 마우스로 조준',4));}
    catch(e){say('화면 안에서 마우스로 조준',4);}
  }
  const ROUND_NAMES=['첫 번째 물결','측면 침투','배수구 확보','공중 청소부','배관 파괴자','휴지 반격','포위 돌파','상층 밸브 확보','마지막 물결','최종 세척'];
  let mission={capture:false,progress:0,required:0,point:{x:0,y:7.12,z:28},intro:0,clock:0,pressure:0,finished:false,failed:false,wipe:0};
  let pressureZones=[],reviveProgress=0,roomRenderer=null,rendererFailed=false;
  function updateCampaign(dt){
    if(gameMode==='duel')return;
    mission.clock=(mission.clock||0)+dt;mission.intro=Math.max(0,(mission.intro||0)-dt);mapTransition=Math.max(0,mapTransition-dt);
    if(online.roomCode&&hp<=0&&!mission.failed&&!mission.finished){
      const helper=remotePilots().some(p=>p.state.hp>0&&Math.hypot(p.state.x-camera.x,p.state.z-camera.z)<3&&Math.abs(p.state.y-camera.y)<3);
      reviveProgress=helper?reviveProgress+dt:Math.max(0,reviveProgress-dt);
      if(reviveProgress>=3){hp=60;hpTrail=60;reviveProgress=0;mode='playing';$('#result').classList.add('hidden');contactGrace=2;say('팀원이 구해줬습니다 · 체력 60',2);tone(550,.25,.09);}
    }
    if(!online.roomCode||online.isHost){
      const team=[{...camera,hp},...remotePilots().map(p=>p.state)];
      if(online.roomCode&&team.length>1&&team.every(p=>p.hp<=0)){mission.wipe+=dt;if(mission.wipe>=2&&!mission.failed){mission.failed=true;end(false);}}else mission.wipe=0;
      if(mission.capture&&mission.progress<mission.required){
        const present=team.filter(p=>p.hp>0&&Math.hypot(p.x-mission.point.x,p.z-mission.point.z)<3.7&&Math.abs(p.y-(mission.point.y+1.9))<2.5).length;
        if(present){mission.progress=Math.min(mission.required,mission.progress+dt*(present>1?1.4:1));if(mission.progress>=mission.required){say('밸브 확보! 남은 적을 정리하세요',2);tone(630,.3,.09);ultCharge=clamp(ultCharge+20,0,100);}}
      }
      const boss=targets.find(t=>t.alive&&t.boss);
      if(boss&&mission.intro<=0&&mode!=='result'){
        mission.pressure-=dt;
        if(mission.pressure<=0){
          mission.pressure=boss.hp<boss.maxHp*.5?4.3:6;
          const living=team.filter(p=>p.hp>0),victim=living[Math.floor(mission.clock)%Math.max(1,living.length)]||camera;
          const event={kind:'pressure',point:{x:victim.x,y:floorAt(victim.x,victim.z)+.04,z:victim.z},radius:4.2,delay:1.8,damage:20};
          pressureZones.push({...event,age:0,hit:false});queueEvent(event);say('수압 폭발 · 붉은 원에서 벗어나세요!',1.5);
        }
      }
    }
    for(const z of pressureZones){
      z.age+=dt;
      if(!z.hit&&z.age>=z.delay){z.hit=true;if(hp>0&&Math.hypot(camera.x-z.point.x,camera.z-z.point.z)<z.radius&&Math.abs(camera.y-(z.point.y+2))<2.7)hurt(z.damage,'수압 폭발! 대시하거나 높이 점프하세요');tone(58,.25,.08,'triangle');}
    }
    pressureZones=pressureZones.filter(z=>z.age<z.delay+.65);
  }
  function drawMissionMarkers(){
    for(const z of pressureZones){
      worldRing(z.point.x,z.point.y,z.point.z,z.radius,z.hit?'#ffc38e':'#ff6e58',z.hit?Math.max(0,(z.delay+.65-z.age)/.65):.8);
      if(!z.hit){worldRing(z.point.x,z.point.y+.01,z.point.z,z.radius*clamp(z.age/z.delay,0,1),'#ff9475',.5);worldLabel(z.point.x,z.point.y+.3,z.point.z,'!', '#ffb293',.8);}
    }
    if(mission.capture&&gameMode!=='duel'&&mission.progress<mission.required)worldLabel(mission.point.x,mission.point.y+1,mission.point.z,'여기서 밸브 확보','#e8e5a1',.5);
  }
  function drawActorLabels(){
    for(const p of remotePilots()){
      const s=p.state,pos=remoteViews.get(p.playerId)||s;if(s.hp<=0){worldLabel(pos.x,pos.y,pos.z,'구조 · 가까이 3초','#f2bd8d',.45);continue;}
      const dir={x:pos.x-camera.x,y:pos.y-camera.y,z:pos.z-camera.z},dist=Math.hypot(dir.x,dir.y,dir.z)||1;
      if(solidWorld().some(b=>rayBox(camera,{x:dir.x/dist,y:dir.y/dist,z:dir.z/dist},b)<dist-.7))continue;
      const q=project(pos.x,pos.y+.95,pos.z);if(!q)continue;
      ctx.save();ctx.textAlign='center';ctx.font='bold 13px sans-serif';ctx.fillStyle=gameMode==='duel'?'#ffc3a1':'#baf7d5';ctx.fillText((gameMode==='duel'?'VS · ':'TEAM · ')+p.name,q.x,q.y);
      ctx.fillStyle='#173b36';ctx.fillRect(q.x-28,q.y+6,56,4);ctx.fillStyle=gameMode==='duel'?'#e7a07d':'#a9e6c7';ctx.fillRect(q.x-28,q.y+6,56*s.hp/100,4);
      if((s.slow||0)>0){ctx.fillStyle='#e5d87c';ctx.fillText('감속',q.x,q.y+26);}ctx.restore();
    }
    for(const t of targets)if(t.alive&&(t.hp<t.maxHp||t.flyer)){
      const q=project(t.x,t.y+(t.boss?3.5:1.6),t.z);if(!q)continue;
      ctx.save();ctx.textAlign='center';ctx.fillStyle='#fff0d2';ctx.font='bold 11px sans-serif';ctx.fillText(t.boss?'보스':t.flyer?'공중 청소부':t.slow>0?'감속 중':'',q.x,q.y-3);
      ctx.fillStyle='#314a45';ctx.fillRect(q.x-19,q.y+2,38,3);ctx.fillStyle='#e5ac7d';ctx.fillRect(q.x-19,q.y+2,38*t.hp/t.maxHp,3);ctx.restore();
    }
  }

  let entry={phase:'combat'},pauseReturn='playing';
  const HOME_FINDS=[];
  const newHomeFun=()=>({tv:false,shower:false,showerDoor:false,cabinet:false,washer:0,towel:false,duck:0,toast:'',toastTime:0,matArmed:true});
  let homeFun=newHomeFun();
  function homeInteraction(){
    const choices=[['showerDoor',-78,-33,22],['shower',-130,-61,32],['cabinet',137,-53,26],['washer',132,-424,26],['towel',117,86,25],['duck',30,-228,19],['tv',81,-306,43]];
    return choices.map(([id,x,z,r])=>({id,d:Math.hypot(entry.x-x,entry.z-z),r})).filter(v=>v.d<v.r).sort((a,b)=>a.d-b.d)[0]?.id;
  }
  function homeNotice(text){homeFun.toast=text;homeFun.toastTime=3;tone(600,.12,.04,'triangle');}
  function interactHome(){
    if(mode!=='homewalk')return;
    const action=homeInteraction();
    if(action==='showerDoor'){homeFun.showerDoor=!homeFun.showerDoor;homeNotice(homeFun.showerDoor?'샤워실 문을 열었습니다. 안으로 들어가 F로 물을 켜세요.':'샤워실 문을 닫았습니다.');return;}
    if(action==='cabinet'){homeFun.cabinet=!homeFun.cabinet;homeNotice(homeFun.cabinet?'비밀 오리 발견! 꽥! 여긴 내 집이다!':'수납장 문을 닫았습니다.');tone(230,.2,.06,'sawtooth');return;}
    if(action==='washer'){homeFun.washer=homeFun.washer>0?0:7;homeNotice(homeFun.washer?'탈수 시작! 양말들이 우주 훈련 중입니다.':'세탁기를 멈췄습니다.');tone(95,.5,.06,'triangle');return;}
    if(action==='shower'){homeFun.shower=!homeFun.shower;homeNotice(homeFun.shower?'샤워 시작! 전투 전에 씻고 가세요.':'수도 요금은 아껴야지.');return;}
    if(Math.hypot(entry.x-117,entry.z-86)<25){homeFun.towel=!homeFun.towel;homeNotice(homeFun.towel?'수건 망토 장착! 목욕탕의 영웅 등장.':'망토를 다시 걸었습니다.');return;}
    if(Math.hypot(entry.x-30,entry.z+228)<19){homeFun.duck++;homeNotice(homeFun.duck%5===0?'꽥꽥꽥! 오리도 화났습니다.':'꽥!');tone(350,.12,.08,'sawtooth');return;}
    if(Math.hypot(entry.x-81,entry.z+306)<43){
      homeFun.tv=!homeFun.tv;homeNotice(homeFun.tv?'긴급 속보: 변기에서 정체불명의 전투 발생!':'TV를 껐습니다');
      tone(homeFun.tv?420:220,.16,.045,'sine');
    }
  }
  function updateHomeFun(dt){
    homeFun.toastTime=Math.max(0,homeFun.toastTime-dt);
    homeFun.washer=Math.max(0,homeFun.washer-dt);
    const onMat=Math.abs(entry.x-92)<14&&Math.abs(entry.z-34)<24;
    if(onMat&&homeFun.matArmed&&entry.jump===0){entry.vy=65;homeFun.matArmed=false;homeNotice('푹신한 발매트! 통통!');tone(280,.2,.06,'sine');}
    if(!onMat)homeFun.matArmed=true;
    const nearTv=Math.hypot(entry.x-81,entry.z+306)<43;
    $('#homeCollect').hidden=true;
    const labels={showerDoor:'샤워실 문 '+(homeFun.showerDoor?'닫기':'열기'),shower:'샤워기 '+(homeFun.shower?'끄기':'켜기'),cabinet:'수납장 '+(homeFun.cabinet?'닫기':'열기'),washer:'세탁기 '+(homeFun.washer?'멈추기':'돌리기'),towel:'수건 '+(homeFun.towel?'걸기':'두르기'),duck:'오리 눌러보기',tv:'TV '+(homeFun.tv?'끄기':'켜기')};
    const action=homeInteraction(),hint=action?'F · '+labels[action]:'식탁, 독서 공간, 세탁실… 집을 둘러보고 F로 만져보세요.';
    $('#homeToast').textContent=homeFun.toastTime>0?homeFun.toast:hint;
  }
  function beginHome(){
    homeFun=newHomeFun();
    entry={phase:'walk',x:59+(online.roomCode&&!online.isHost?-13:0),z:-244,feet:-18,jump:0,vy:0,walk:0,
      destination:{...camera},spawnYaw:yaw,diveAt:0,pending:false};
    mode='homewalk';yaw=0;pitch=0;focal=850;scoped=false;lastMouse=null;entry.eyeHeight=43;keys.clear();$('#entryHud').hidden=false;$('#stage').classList.add('exploring');
  }
  function nearToilet(){return Math.abs(entry.x)<24&&entry.z>-48&&entry.z<-18;}
  function requestEntry(quick=false){
    if(mode!=='homewalk'||entry.phase!=='walk'||entry.pending)return;
    if(!quick&&!nearToilet())return;
    if(online.roomCode){entry.pending=true;queueEvent({kind:'entry'});$('#entryPrompt').textContent='친구와 함께 입장 준비 중…';}
    else beginDive(Date.now()/1000);
  }
  function beginDive(at){
    if(entry.phase==='combat')return;
    if(!nearToilet()){entry.x=0;entry.z=-37;yaw=0;}
    entry.phase='dive';entry.progress=0;entry.diveAt=at;entry.from={x:entry.x,z:entry.z};entry.jump=0;entry.vy=0;mode='entering';
    keys.clear();scoped=false;trigger=false;$('#pause').classList.add('hidden');
    $('#entryTitle').textContent='작아질 준비, 됐어?';$('#entryPrompt').textContent='변기 속으로!';
    tone(380,.5,.07,'sine');
  }
  function entryBlocked(x,z){
    if(x<-150||x>150||z<-491||z>133)return true;
    if(x>-92&&x<-82&&z>-86&&z<-17&&(!homeFun.showerDoor||z<-49))return true;
    if(homeFun.showerDoor&&x>-91&&x<-54&&Math.abs(z+49)<5)return true;
    if(x>-150&&x<-83&&Math.abs(z+21)<5)return true;
    if(x>114&&z>-125&&z<-64)return true;
    if(x>104&&z<-446)return true;
    if(x>24&&x<100&&z>-445&&z<-384)return true;
    if(x>43&&x<81&&(Math.abs(z+374)<17||Math.abs(z+454)<17))return true;
    if(x<-77&&x>-137&&z>-453&&z<-399)return true;
    if(Math.hypot(x+55,z+422)<19)return true;
    if(x<-120&&z>-400&&z<-342)return true;
    if(Math.abs(z+169)<8&&(x<43||x>75))return true;
    if((x/35)**2+((z-30)/58)**2<1)return true;
    return (x<-83&&z>29&&z<83)||(x>-15&&x<25&&z>73&&z<94)||
      (x<-35&&x>-105&&z<-250&&z>-314)||(x>-35&&x<8&&z<-257&&z>-298)||
      (x>59&&x<108&&z<-280&&z>-333)||(x<-116&&z<-189&&z>-296)||
      (x>104&&x<148&&z<-205&&z>-267);
  }
  function updateEntry(dt){
    if(mode==='homewalk'){
      time+=dt;entry.feet=entry.x<-89&&entry.z>-83&&entry.z<-21?-12.5:-18;updateHomeFun(dt);
      const dx=Number(keys.has('d'))-Number(keys.has('a')),dz=Number(keys.has('w'))-Number(keys.has('s')),mag=Math.hypot(dx,dz)||1;
      const crouching=keys.has('control'),speed=crouching?26:keys.has('shift')?76:48;
      entry.eyeHeight+=( (crouching?29:43)-entry.eyeHeight)*Math.min(1,dt*14);
      const nx=entry.x+(dx*Math.cos(yaw)+dz*Math.sin(yaw))/mag*speed*dt;
      if(!entryBlocked(nx,entry.z))entry.x=nx;
      const nz=entry.z+(-dx*Math.sin(yaw)+dz*Math.cos(yaw))/mag*speed*dt;
      if(!entryBlocked(entry.x,nz))entry.z=nz;
      if(dx||dz)entry.walk+=dt*(speed/5);
      if(entry.jump>0||entry.vy>0){entry.vy-=90*dt;entry.jump=Math.max(0,entry.jump+entry.vy*dt);}
      const close=nearToilet();
      $('#entryTitle').textContent=close?'변기 속으로 뛰어들자.':'우리 집에서 시작하는 작은 소동.';
      if(!entry.pending)$('#entryPrompt').textContent=close?'SPACE · 변기로 뛰어들기':'열린 문으로 들어가 변기 앞에 서세요';
      $('#entryControls').textContent='1인칭 · 화면 클릭으로 마우스 고정 · WASD 이동 · SHIFT 달리기 · CTRL 앉기 · SPACE 점프 · F 상호작용 · ESC 일시정지';
    }else if(mode==='entering'){
      time+=dt;
      entry.progress=clamp(((Date.now()/1000+(online.roomCode?online.serverOffset:0))-entry.diveAt)/3.2,0,1);
      if(entry.progress>=1){
        camera={...entry.destination};yaw=entry.spawnYaw;pitch=0;entry.phase='combat';mode='playing';keys.clear();
        $('#entryHud').hidden=true;$('#stage').classList.remove('exploring');mission.intro=Math.max(mission.intro,2);contactGrace=1.5;lastMouse=null;canvas.focus();
        say(gameMode==='duel'?'1대1 대전 · 5킬 먼저 달성!':'변기 방어 작전 · 10라운드 생존',2.5);
      }
    }
  }
  $('#quickEntry').onclick=()=>{requestEntry(true);canvas.focus();};
  function renderRoom(){
    if(!roomRenderer&&!rendererFailed&&window.createBathroomRenderer){
      try{roomRenderer=window.createBathroomRenderer($('#roomCanvas'),arena);$('#sceneStatus').textContent='PC · 키보드 / 마우스';}
      catch(e){rendererFailed=true;$('#sceneStatus').textContent='호환 그래픽 모드';console.warn('3D renderer unavailable',e);}
    }
    if(!roomRenderer)return false;
    const ok=roomRenderer.render({mode,gameMode,wave,arena,layoutId,finale,mapTransition,homeFun,homeFinds:HOME_FINDS,entry:{...entry,yaw,pitch},now:performance.now(),time,camera,yaw:viewYaw,pitch:viewPitch,focal,quality,targets,
      pilots:remotePilots().map(p=>({...p,pos:remoteViews.get(p.playerId)||p.state})),remoteFx,barrels,papers:soapPickups,heals:healPacks,mission,
      weapon:weaponId,aim:aimBlend,recoil,reload,reloadMax:gun().reload,walkPhase,melee:meleeSwing,paper:soapSelected});
    $('#roomCanvas').style.visibility=ok?'visible':'hidden';return ok;
  }
  let online={roomCode:'',playerId:'',name:'플레이어',pilots:[],timer:0,waiting:false,isHost:false,roomMode:'combat',events:[],seq:0,revision:0,life:0,readyAt:0,serverOffset:0,busy:false,generation:0,matchOver:false,deadAnnounced:{},ping:0};
  let remoteFx=[], remoteViews=new Map(), roomBusy=false;
  const onlineStatus=()=>$('#onlineStatus');
  function setOnlineStatus(text,error=false){onlineStatus().textContent=text;onlineStatus().classList.toggle('error',error);}
  function queueEvent(event){if(online.roomCode){online.events.push({...event,seq:++online.seq});if(online.events.length>256)online.events.shift();}}
    function emitFx(effect,extra={}){
    queueEvent({kind:'fx',effect,origin:{x:camera.x,y:camera.y-.25,z:camera.z},dir:aimDirection(),weapon:weaponId,...extra});
  }
  function aimDirection(){return{x:Math.sin(viewYaw)*Math.cos(viewPitch),y:Math.sin(viewPitch),z:Math.cos(viewYaw)*Math.cos(viewPitch)};}
  function onlineState(){return{x:camera.x,y:camera.y,z:camera.z,yaw,pitch,hp,weapon:weaponId,wave,teamScore:score,playing:mode==='playing'||(!!online.roomCode&&mode==='paused'),dash:dashTime,slow:slowRemaining(),entry:entry.phase==='combat'?null:{phase:entry.phase,x:entry.x,z:entry.z,feet:entry.feet,jump:entry.jump,yaw,walk:entry.walk},mission:online.isHost?mission:null,
    enemies:online.isHost?targets.map(t=>({...t,aim:null})):[],barrels:online.isHost?barrels:[]};}
  function roomError(code){return({room_full:'이미 가득 찬 방입니다.',host_left:'방장이 나갔습니다. 새 방 코드를 입력하세요.',match_finished:'종료된 대전입니다. 새 방을 만들어 주세요.',room_not_found:'방을 찾지 못했습니다. 코드를 확인하세요.',invalid_room_code:'영문·숫자 6자리 코드를 입력하세요.',player_not_found:'연결이 종료됐습니다. 로비에서 다시 참가하세요.'})[code]||'연결이 지연되고 있습니다. 잠시 후 다시 시도하세요.';}
  async function roomRequest(path,body){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4500);
    try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'network');return d;}finally{clearTimeout(timeout);}
  }
  function setRoomBusy(value){roomBusy=value;for(const id of ['createRoom','createDuel','submitJoin3'])$('#'+id).disabled=value;}
  function acceptRoom(d,name){
    online.roomCode=d.room.roomCode;online.playerId=d.playerId;online.name=name;online.isHost=d.isHost;online.roomMode=d.room.mode;
    online.pilots=d.room.pilots;online.waiting=true;online.events=[];online.seq=0;online.revision=Math.max(0,...d.room.events.map(e=>e.revision));online.life=0;online.matchOver=false;
    online.deadAnnounced={};online.serverOffset=d.room.serverTime-Date.now()/1000;online.readyAt=d.room.started;remoteViews.clear();remoteFx=[];
    $('#roomInfo').hidden=false;$('#createdCode').textContent=online.roomCode;$('#roomKind').textContent=(d.room.mode==='duel'?'1대1 대전':'협동 전투')+' · 친구에게 이 코드를 알려주세요';
    setOnlineStatus('방 '+online.roomCode+' · 친구 입장을 기다리는 중');
    clearTimeout(online.timer);online.generation++;online.busy=false;
    if(d.room.pilots.length>=2){online.waiting=false;start(online.roomMode);consumeRoom(d.room);}
    syncOnline();
  }
  async function createRoom(roomMode='combat'){
    if(roomBusy)return;setRoomBusy(true);
    try{await leaveRoom();const name=$('#playerName').value.trim()||'플레이어';const d=await roomRequest('/api/rooms/create',{mode:roomMode,name,state:onlineState()});acceptRoom(d,name);}
    catch(e){setOnlineStatus(roomError(e.message),true);}finally{setRoomBusy(false);}
  }
  async function joinRoom(){
    if(roomBusy)return;const code=$('#roomCode3').value.trim().toUpperCase();
    if(!/^[A-Z0-9]{6}$/.test(code)){setOnlineStatus('영문·숫자 6자리 코드를 입력하세요.',true);$('#roomCode3').focus();return;}
    setRoomBusy(true);setOnlineStatus('방 '+code+'에 입장 중…');
    try{await leaveRoom();const name=$('#playerName').value.trim()||'플레이어';const d=await roomRequest('/api/rooms/join',{roomCode:code,name,state:onlineState()});acceptRoom(d,name);}
    catch(e){setOnlineStatus(roomError(e.message),true);}finally{setRoomBusy(false);}
  }
  async function leaveRoom(){
    const code=online.roomCode,id=online.playerId;clearTimeout(online.timer);online.generation++;online.roomCode='';online.playerId='';online.waiting=false;online.busy=false;online.pilots=[];remoteViews.clear();remoteFx=[];$('#roomInfo').hidden=true;$('#createdCode').textContent='';
    if(code)try{await roomRequest('/api/rooms/'+code+'/leave',{playerId:id});}catch(e){}
  }
  async function syncOnline(){
    if(!online.roomCode||online.busy)return;online.busy=true;const generation=online.generation,begin=performance.now();
    try{const d=await roomRequest('/api/rooms/'+online.roomCode+'/sync',{playerId:online.playerId,state:onlineState(),events:online.events.slice(0,64),afterRevision:online.revision});
      if(generation!==online.generation)return;online.ping=Math.round(performance.now()-begin);consumeRoom(d.room);
    }catch(e){if(generation===online.generation){setOnlineStatus(roomError(e.message),true);if(e.message==='player_not_found'||e.message==='room_not_found'){home();setOnlineStatus(roomError(e.message),true);}}}
    finally{if(generation===online.generation){online.busy=false;if(online.roomCode)online.timer=setTimeout(syncOnline,160);}}
  }
  function consumeRoom(room){
    online.pilots=room.pilots;online.serverOffset=room.serverTime-Date.now()/1000;online.readyAt=room.started;
    if(room.status==='closed'||!room.pilots.some(p=>p.isHost)){home();setOnlineStatus('방장이 나갔습니다. 새 방을 만들어 주세요.',true);return;}
    const me=room.pilots.find(p=>p.playerId===online.playerId),others=remotePilots();
    if(me)online.events=online.events.filter(e=>e.seq>(me.state.netSeq||0));
    if(online.waiting&&others.length){online.waiting=false;start(room.mode);}
    if(room.entryAt&&entry.phase==='walk')beginDive(room.entryAt);
    if(!online.waiting&&room.mode==='combat'&&!online.isHost){
      const host=room.pilots.find(p=>p.isHost&&(p.state.playing||p.state.mission?.finished||p.state.mission?.failed));
      if(host&&Array.isArray(host.state.enemies)){
        if(wave!==host.state.wave){wave=host.state.wave;selectLayout(wave>=6?1:0);startFlush();if(wave===6){mapTransition=3.2;camera={x:0,y:9,z:0};combatFeet=7;jumpVelocity=0;combatGrounded=true;}if(hp<=0){hp=100;mode='playing';$('#result').classList.add('hidden');}else hp=Math.min(100,hp+25);soapPickups=[{x:3,y:7.6,z:6},{x:-5,y:7.6,z:43}];}
        if(host.state.mission){mission={...host.state.mission};if(mission.finished&&!['ending','result'].includes(mode)){mode='ending';finale=0;keys.clear();trigger=false;scoped=false;}else if(mission.failed&&mode!=='result')end(false);}
        score=host.state.teamScore||0;targets=host.state.enemies.map(t=>({...t}));barrels=(host.state.barrels||[]).map(b=>({...b}));
      }
    }
    if(room.mode==='duel'&&me&&!online.waiting){
      const s=me.state;
      if(s.life!==online.life){online.life=s.life;respawnDuel();say('재등장 · 1초 보호',1.2);}
      else if(s.hp<hp){
        // Only confirmed HP loss triggers feedback; repeated snapshots do not.
        const ev=room.events.filter(e=>e.revision>online.revision&&e.kind==='damage'&&e.target===online.playerId&&e.life===s.life).at(-1);
        const attacker=others.find(p=>p.playerId===ev?.owner)||others[0];
        damageFeedback(hp-s.hp,attacker?.state,ev?.effect);
      }
      if(hp>0&&s.hp<=0){voice('으악');trigger=false;scoped=false;keys.clear();}
      hp=s.hp;
      const duration=hp>0?clamp((s.slowUntil||0)-(Date.now()/1000+online.serverOffset),0,2):0;
      if(duration>0)applySlow(duration);laserSlow=duration;
      if(room.winner&&!online.matchOver){online.matchOver=true;end(room.winner===online.playerId);}
    }
    for(const pilot of others){
      const s=pilot.state,prev=remoteViews.get(pilot.playerId);
      if(!prev)remoteViews.set(pilot.playerId,{x:s.x,y:s.y,z:s.z});
      if(s.hp<=0&&!online.deadAnnounced[pilot.playerId]){online.deadAnnounced[pilot.playerId]=true;if(room.mode==='combat'){say(pilot.name+' 님이 쓰러졌습니다',2);voice('우리 팀원이 죽었습니다');}}
      if(s.hp>0)online.deadAnnounced[pilot.playerId]=false;
    }
    for(const ev of room.events){
      if(ev.revision<=online.revision)continue;
      if(ev.owner!==online.playerId){
        if(ev.kind==='fx')receiveFx(ev);
        if(ev.kind==='pressure'&&gameMode==='combat')pressureZones.push({...ev,age:0,hit:false});
        if(ev.kind==='kill'&&ev.target===online.playerId){kills++;if(ev.head)heads++;ultCharge=clamp(ultCharge+10,0,100);addKill(ev.head,false);}
        if(ev.kind==='enemyShot'&&!online.isHost)projectiles.push({...ev.point,...ev.velocity,damage:ev.damage||12,life:4});
        if(ev.kind==='barrel'&&online.isHost&&barrels[ev.index])explodeBarrel(barrels[ev.index]);
        if(ev.kind==='damage'&&online.isHost&&gameMode==='combat'&&ev.wave===wave&&targets[ev.index])damageTarget({t:targets[ev.index],head:!!ev.head,effect:ev.effect},clamp(Number(ev.damage)||0,0,600),false,ev.owner);
      }
      online.revision=Math.max(online.revision,ev.revision);
    }
    setOnlineStatus('방 '+online.roomCode+' · '+(room.mode==='duel'?'1대1':'협동')+' · '+room.pilots.length+'명 접속');
  }
  function remotePilots(){return online.pilots.filter(p=>p.playerId!==online.playerId&&p.state&&Number.isFinite(p.state.x)&&Number.isFinite(p.state.z));}
  function respawnDuel(){
    camera={x:online.isHost?-5:5,y:9,z:online.isHost?2:59};yaw=online.isHost?0:Math.PI;pitch=0;combatFeet=7;combatGrounded=true;stanceHeight=9;jumpVelocity=0;jumpHeight=0;reload=0;resetInventory();laserCooldown=0;dashCooldown=0;trigger=false;scoped=false;effects=[];contactGrace=1.2;damageCue.life=0;damageFlash=0;hpTrail=100;laserSlow=0;waterSlow=0;
  }
  function canAct(){return mode==='playing'&&hp>0&&(!online.roomCode||gameMode!=='duel'||(!online.matchOver&&remotePilots().length>0&&Date.now()/1000+online.serverOffset>=online.readyAt));}
  function duelVictim(origin,dir,range=100,radius=0){
    let result=null,nearest=range;
    for(const p of remotePilots()){if(p.state.hp<=0)continue;const t={x:p.state.x,y:p.state.y-.55,z:p.state.z};
      let hit=enemyHit(origin,dir,t);
      if(radius){const dist=sphereDistance(origin,dir,t,radius);if(dist<hit.distance)hit={distance:dist,head:false};}
      if(hit.distance<nearest&&!solidWorld().some(b=>rayBox(origin,dir,b)<hit.distance)){result={pilot:p,head:hit.head};nearest=hit.distance;}
    }return result;
  }
  function damagePilot(hit,damage,effect){
    if(!hit||!canAct())return;queueEvent({kind:'damage',target:hit.pilot.playerId,life:hit.pilot.state.life||0,damage,effect,head:hit.head});
    hits++;hitMark=.18;hitCritical=hit.head;ultCharge=clamp(ultCharge+Math.min(100,damage)*.25,0,100);
    effects.push({x:hit.pilot.state.x,y:hit.pilot.state.y+1,z:hit.pilot.state.z,life:.65,text:String(damage),critical:hit.head});
  }
  function receiveFx(ev){
    if(!ev.origin||!ev.dir||![ev.origin.x,ev.origin.y,ev.origin.z,ev.dir.x,ev.dir.y,ev.dir.z].every(Number.isFinite))return;
    remoteFx.push({...ev,age:0,duration:ev.effect==='poop'?1.7:ev.effect==='laser'?.7:ev.effect==='paper'?1.4:.4});
    if(ev.effect==='laser'||ev.effect==='poop'){
      skillWarnings.push({effect:ev.effect,point:ev.effect==='poop'&&ev.point?ev.point:ev.origin,age:0,duration:ev.effect==='poop'?1.7:1.1});
      skillWarnings=skillWarnings.slice(-4);
      tone(ev.effect==='poop'?70:240,.2,.07,ev.effect==='poop'?'triangle':'sawtooth');
    }
    if(remoteFx.length>96)remoteFx.splice(0,remoteFx.length-96);
    if(ev.effect==='shot'&&Math.hypot(ev.origin.x-camera.x,ev.origin.z-camera.z)<50)tone(100,.06,.02,'triangle');
  }
  function drawRemotePilot(pilot){
    const s=pilot.state;if(s.hp<=0)return;const pos=remoteViews.get(pilot.playerId)||s;
    const dx=pos.x-camera.x,dy=pos.y-1-camera.y,dz=pos.z-camera.z,dist=Math.hypot(dx,dy,dz)||1;
    if(solidWorld().some(b=>rayBox(camera,{x:dx/dist,y:dy/dist,z:dz/dist},b)<dist-.6))return;
    const enemy=gameMode==='duel',c=enemy?'#ff8b70':'#a8f7c7',t={x:pos.x,y:pos.y-.55,z:pos.z,hp:s.hp,maxHp:100,r:.75,type:enemy?'angry':'cool',side:1,phase:0,charge:0,flash:0,alive:true,friendly:!enemy,facing:s.yaw};
    humanoid(t);const p=project(pos.x,pos.y+.9,pos.z);if(!p)return;
    const size=clamp(p.s,10,45);ctx.save();ctx.textAlign='center';ctx.font='bold 11px sans-serif';ctx.fillStyle=c;ctx.fillText((enemy?'VS · ':'TEAM · ')+pilot.name,p.x,p.y-size*.2);
    ctx.fillStyle='#102b2d';ctx.fillRect(p.x-28,p.y+4,56,4);ctx.fillStyle=c;ctx.fillRect(p.x-28,p.y+4,56*clamp(s.hp/100,0,1),4);
    const slowed=Math.max(s.slow||0,(s.slowUntil||0)-(Date.now()/1000+online.serverOffset));
    if(slowed>0){ctx.font='bold 12px sans-serif';ctx.fillStyle='#f3d667';ctx.fillText('오줌 맞음 · 감속',p.x,p.y+24);}ctx.restore();
    worldLine({x:pos.x,y:pos.y-.9,z:pos.z},{x:pos.x+Math.sin(s.yaw)*1.3,y:pos.y-.85,z:pos.z+Math.cos(s.yaw)*1.3},'#9cafad',.13);
  }
  function drawRemotePilots(){for(const p of remotePilots())drawRemotePilot(p);}

  function syncMusic(){const b=document.querySelector('#music');if(b)b.textContent=musicEnabled?'음악 켜짐':'음악 꺼짐';}
  (document.querySelector('#music')||{}).addEventListener('click',()=>{musicEnabled=!musicEnabled;syncMusic();});
  let barrels=[];
  function explodeBarrel(b){
    if(!b.alive)return;if(online.roomCode&&!online.isHost){queueEvent({kind:'barrel',index:barrels.indexOf(b)});return;}b.alive=false;
    effects.push({x:b.x,y:b.y,z:b.z,life:.6});tone(55,.25,.12,'sawtooth');
    for(const t of targets){const d=Math.hypot(t.x-b.x,t.y-b.y,t.z-b.z);if(t.alive&&d<6)damageTarget({t,head:false},Math.round(220*(1-d/7.3333333333)),false);}
    say('드럼통 폭발!',1);
  }
  function drawBarrels(){for(const b of barrels){if(!b.alive)continue;
    for(let i=0;i<12;i++){const a=i*TAU/12,c=(i+1)*TAU/12;ground([[b.x+Math.cos(a)*.6,b.y-.9,b.z+Math.sin(a)*.6],[b.x+Math.cos(c)*.6,b.y-.9,b.z+Math.sin(c)*.6],[b.x+Math.cos(c)*.6,b.y+.9,b.z+Math.sin(c)*.6],[b.x+Math.cos(a)*.6,b.y+.9,b.z+Math.sin(a)*.6]],i%3===0?'#754532':i%3===1?'#a46543':'#8c5338');}
    for(const y of [b.y-.9,b.y-.48,b.y+.48,b.y+.9]){const pts=Array.from({length:16},(_,i)=>[b.x+Math.cos(i*TAU/16)*.62,y,b.z+Math.sin(i*TAU/16)*.62]);if(y===b.y+.9)ground(pts,'#69716a');const pp=pts.map(v=>project(...v));if(pp.every(Boolean)){ctx.beginPath();pp.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.strokeStyle='#39443e';ctx.lineWidth=2;ctx.stroke();}}
    const q=project(b.x,b.y,b.z);if(q){ctx.fillStyle='#f1d596';ctx.font='bold '+clamp(q.s*.5,10,32)+'px sans-serif';ctx.textAlign='center';ctx.fillText('!',q.x,q.y);}
  }}
  let soapCount=0,soapSelected=false,soapPickups=[],soapThrows=[];
  function throwSoap(){
    if(!canAct()||!soapCount||!soapSelected)return;emitFx('paper');soapCount--;soapSelected=false;trigger=false;scoped=false;
    soapThrows.push({x:camera.x,y:camera.y-.3,z:camera.z,vx:Math.sin(yaw)*18,vy:5+Math.sin(pitch)*10,vz:Math.cos(yaw)*18,life:2});tone(230,.12,.04);
  }
  function updateSoap(dt){
    for(const p of soapPickups){if(!p.taken&&Math.hypot(camera.x-p.x,camera.z-p.z)<1.5&&Math.abs(camera.y-p.y)<3){p.taken=true;soapCount++;say('휴지 획득 · 3번 선택 후 좌클릭으로 던지기',2);}}
    for(const b of soapThrows){b.life-=dt;b.vy-=18*dt;const next={x:b.x+b.vx*dt,y:b.y+b.vy*dt,z:b.z+b.vz*dt};const speed=Math.hypot(b.vx,b.vy,b.vz);const wall=solidWorld().some(w=>rayBox(b,{x:b.vx/speed,y:b.vy/speed,z:b.vz/speed},w)<speed*dt);b.x=next.x;b.y=next.y;b.z=next.z;
      if(wall||b.y<=floorAt(b.x,b.z)+.2||b.life<=0){if(gameMode==='duel')for(const p of remotePilots())if(p.state.hp>0&&Math.hypot(p.state.x-b.x,p.state.z-b.z)<4)damagePilot({pilot:p,head:false},90,'paper');for(const t of targets)if(t.alive&&Math.hypot(t.x-b.x,t.z-b.z)<4)damageTarget({t,head:false},250,false);b.life=-1;effects.push({x:b.x,y:b.y,z:b.z,life:.6});say('휴지 폭발!',1);}}
    soapThrows=soapThrows.filter(b=>b.life>0);
    const slot=document.querySelector('#soapSlot');if(slot){slot.hidden=soapCount===0;slot.classList.toggle('active',soapSelected);slot.textContent='3 휴지 ×'+soapCount;}
  }
  function drawPaperRoll(x,y,r){ctx.save();ctx.translate(x,y);ctx.fillStyle='#c5c5b7';ctx.fillRect(-r,-r*.6,r*2,r*1.2);ctx.fillStyle='#ecebda';ctx.beginPath();ctx.ellipse(0,-r*.6,r,r*.38,0,0,TAU);ctx.fill();ctx.strokeStyle='#8e978c';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#75634f';ctx.beginPath();ctx.ellipse(0,-r*.6,r*.32,r*.15,0,0,TAU);ctx.fill();ctx.fillStyle='#e5e5d5';ctx.fillRect(r*.5,0,r*.45,r*1.2);ctx.restore();}
  function drawSoap(){for(const b of soapPickups.filter(p=>!p.taken).concat(soapThrows)){const q=project(b.x,b.y,b.z);if(q){drawPaperRoll(q.x,q.y,clamp(q.s*.45,6,35));ctx.fillStyle='#d9fff0';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('휴지',q.x,q.y-28);}}}
  let flushTime=0,flushNoise=null;
  function startFlush(){
    flushTime=2.4;if(muted||!audio)return;
    if(!flushNoise){flushNoise=audio.createBuffer(1,Math.floor(audio.sampleRate*2.4),audio.sampleRate);const samples=flushNoise.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;}
    const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain(),now=audio.currentTime;
    source.buffer=flushNoise;filter.type='lowpass';filter.frequency.setValueAtTime(1900,now);filter.frequency.exponentialRampToValueAtTime(160,now+2.3);
    gain.gain.setValueAtTime(.001,now);gain.gain.linearRampToValueAtTime(.2,now+.25);gain.gain.exponentialRampToValueAtTime(.001,now+2.4);
    source.connect(filter);filter.connect(gain);gain.connect(audio.destination);source.start();source.stop(now+2.4);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  function drawFlush(){
    if(flushTime<=0)return;const t=2.4-flushTime,fade=Math.min(t/.25,flushTime/.45,1);ctx.save();ctx.globalAlpha=fade*.65;ctx.strokeStyle='#87c8ca';ctx.lineWidth=5;
    for(let i=0;i<7;i++){const r=35+((i*80-t*140)%560+560)%560;ctx.beginPath();ctx.ellipse(W/2,H*.58,r,r*.33,t*2+i*.12,.2,Math.PI*1.75);ctx.stroke();}
    ctx.globalAlpha=fade;ctx.fillStyle='#d1ebe6';ctx.font='bold 30px sans-serif';ctx.textAlign='center';ctx.fillText('스테이지 클리어 · 물 내리는 중!',W/2,H*.28);ctx.restore();
  }
  function start(selected='combat',skipHome=false){
    flushTime=0;finale=0;finaleSplashed=false;mapTransition=0;soapCount=0;soapSelected=false;soapThrows=[];damageCue.life=0;hpTrail=100;skillWarnings=[];laserSlow=0;waterSlow=0;
    mission={capture:false,progress:0,required:0,point:{x:0,y:7.12,z:28},intro:0,clock:0,pressure:4,finished:false,failed:false,wipe:0};pressureZones=[];reviveProgress=0;
    gameMode=selected;killFeed=[];remoteFx=[];modeUI();ultCharge=selected==='duel'?0:35;ultFlash=0;laserUlt=null,poopUlt=null;combatFeet=7;combatGrounded=true;initHeals();
    if(!audio)try{audio=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}
    if(audio)audio.resume();camera={x:online.roomCode?(online.isHost?-3:3):0,y:9,z:0};yaw=0;pitch=0;time=0;wave=1;kills=0;score=0;hp=100;ammo=5;shots=0;heads=0;hits=0;
    reload=0;bolt=0;recoil=0;damageFlash=0;hitMark=0;breath=100;breakTime=0;scoped=false;effects=[];keys.clear();mode='playing';
    jumpHeight=0;jumpVelocity=0;stanceHeight=9;
    laserCooldown=0;dashCooldown=0;dashTime=0;contactGrace=0;laserBeams=[];lastMouse=null;
    weaponId='rifle';resetInventory();trigger=false;aimBlend=0;switchTime=0;aimKick=0;walkPhase=0;projectiles=[];tracers=[];combo=0;comboTime=0;emptyClick=0;
    ['#menu','#pause','#result'].forEach(s=>$(s).classList.add('hidden'));canvas.style.cursor='none';if(selected==='duel')respawnDuel();spawnWave();if(online.roomCode&&!online.isHost&&selected==='combat'){targets=[];barrels=[];}syncMusic();canvas.focus();entry={phase:'combat'};$('#entryHud').hidden=true;$('#stage').classList.remove('exploring');if(!skipHome)beginHome();
  }
  window.startCombat=()=>{try{start('combat');}catch(err){const st=document.querySelector('#onlineStatus');if(st)st.textContent='전투 시작 오류: '+((err&&err.message)||err);}};
  function spawnWave(){
    selectLayout(gameMode!=='duel'&&wave>=6?1:0);
    soapPickups=[{x:3,y:7.6,z:6},{x:-5,y:7.6,z:43}];pressureZones=[];breakTime=0;
    if(gameMode==='duel'){targets=[];barrels=[];soapPickups=[];return;}
    mission.capture=wave===3||wave===8;mission.progress=0;mission.required=wave===8?8:6;
    mission.point=wave===8?{x:10,y:12.09,z:43}:{x:0,y:7.12,z:28};mission.intro=wave===1?2.5:1.8;mission.pressure=4;
    barrels=[[-6,30],[7,42],[0,55]].map(([x,z])=>({x,z,y:7.9,alive:true}));
    const players=online.roomCode?Math.max(1,online.pilots.length):1,bossRound=wave%5===0;
    const count=bossRound?2:Math.min(3+Math.floor(wave*.45)+(players>1?1:0),7);
    const spots=wave===1?[[-5,32],[3,39],[9,34]]:[[-14,20],[12,40],[-7,55],[14,10],[0,59],[-13,44],[8,52]];
    targets=Array.from({length:count},(_,i)=>{
      const flyer=wave>=2&&((wave===4&&i%2===0)||i===count-1),type=['grin','angry','cool'][i%3];
      const maxHp=Math.round((flyer?72:type==='cool'?120:96)*(1+.25*(players-1)));
      const [x,z]=spots[i%spots.length],y=flyer?13.5:8.45;
      return{x,baseX:x,y,baseY:y,z,hp:maxHp,maxHp,r:flyer?1.05:.75,type,flyer,side:i%2?1:-1,orbit:i*.6,phase:i*1.9,charge:-.10-i*.06,alive:true,flash:0,dodge:0,aim:null,slow:0};
    });
    if(bossRound){const maxHp=Math.round((wave===5?660:920)*(1+.45*(players-1)));targets.push({x:0,baseX:0,y:10.7,baseY:10.7,z:49,hp:maxHp,maxHp,r:1.8,type:'angry',side:1,phase:0,charge:-1,alive:true,flash:0,dodge:0,aim:null,boss:true,slow:0});}
    for(const t of targets)if(!t.flyer){t.y=floorAt(t.x,t.z)+1.45*(t.boss?2.55:1);t.baseY=t.y;}
    say((bossRound?'보스 출현 · ':'ROUND '+String(wave).padStart(2,'0')+' · ')+ROUND_NAMES[wave-1],2.6);
  }

  let lastPauseAt=0;
  function pause(){lastPauseAt=performance.now();if(!['playing','homewalk'].includes(mode))return;pauseReturn=mode;mode='paused';canvas.style.cursor='auto';lastMouse=null;scoped=false;trigger=false;keys.clear();$('#pauseText').textContent=online.roomCode?'멀티플레이는 메뉴를 여는 동안에도 계속 진행됩니다.':'준비되면 다시 전장으로.';$('#pause').classList.remove('hidden');if(document.pointerLockElement===canvas)document.exitPointerLock();}
  function resume(){if(mode!=='paused')return;mode=pauseReturn;$('#pause').classList.add('hidden');canvas.style.cursor='none';lastMouse=null;canvas.focus();}
  function home(){$('#stage').classList.remove('exploring');leaveRoom();entry={phase:'combat'};$('#entryHud').hidden=true;mode='menu';scoped=false;trigger=false;keys.clear();$('#pause').classList.add('hidden');$('#result').classList.add('hidden');$('#menu').classList.remove('hidden');canvas.style.cursor='auto';if(document.pointerLockElement===canvas)document.exitPointerLock();}
  function end(win){
    mode='result';canvas.style.cursor='auto';scoped=false;trigger=false;keys.clear();$('#pause').classList.add('hidden');
    $('#resultTitle').textContent=gameMode==='duel'?(win?'승리. 시원하게 끝냈다!':'패배. 다음엔 네 차례.'):(win?'완벽하게 내려갔다!':'다시 한 번, 시원하게.');
    $('#stats').textContent=gameMode==='duel'?online.pilots.map(p=>p.name+' '+(p.state.score||0)+'킬').join(' · '):'STAGE '+wave+' · '+score.toLocaleString()+'점 · '+kills+'처치 · 헤드샷 '+heads+'회 · 명중률 '+(shots?Math.round(hits/shots*100):0)+'%';
    $('#retry').hidden=!!online.roomCode;$('#result').classList.remove('hidden');if(document.pointerLockElement===canvas)document.exitPointerLock();tone(win?600:100,.5);
    try{localStorage.setItem('flush-best',String(Math.max(score,Number(localStorage.getItem('flush-best'))||0)));}catch(e){}
  }

  function switchWeapon(id){
    soapSelected=false;
    if(!['combat','duel'].includes(gameMode)||mode!=='playing'||!WEAPONS[id]||weaponId===id)return;
    inventory[weaponId].ammo=ammo;weaponId=id;ammo=inventory[id].ammo;bolt=inventory[id].cooldown;
    reload=0;scoped=false;trigger=false;aimBlend=0;switchTime=.3;aimKick=0;recoil=0;
    tone(280,.06,.025,'triangle');
  }
  function doReload(){if(!['combat','duel'].includes(gameMode)||weaponId==='knife'||mode!=='playing'||reload>0||ammo===gun().mag||switchTime>0)return;reload=gun().reload;scoped=false;trigger=false;tone(210,.12,.035,'triangle');}
  function cameraView(){
    const hold=scoped&&weaponId==='sniper'&&!sprinting()&&jumpHeight===0;
    const sway=weaponId==='sniper'&&scoped?(hold?.0003:.0015):.00015;
    viewYaw=yaw+Math.sin(time*1.4)*sway;viewPitch=pitch+Math.cos(time*1.7)*sway+aimKick;
    viewSinYaw=Math.sin(viewYaw);viewCosYaw=Math.cos(viewYaw);viewSinPitch=Math.sin(viewPitch);viewCosPitch=Math.cos(viewPitch);
    focal=850+(gun().zoom-850)*aimBlend;
  }
  function project(x,y,z){
    const dx=x-camera.x,dy=y-camera.y,dz=z-camera.z;
    const xx=dx*viewCosYaw-dz*viewSinYaw,zz=dx*viewSinYaw+dz*viewCosYaw;
    const yy=dy*viewCosPitch-zz*viewSinPitch,depth=dy*viewSinPitch+zz*viewCosPitch;
    if(depth<.2)return null;
    return{x:W/2+xx*focal/depth,y:H/2-yy*focal/depth,s:focal/depth,z:depth};
  }
  function sphereDistance(origin,dir,center,r){
    const a={x:origin.x-center.x,y:origin.y-center.y,z:origin.z-center.z};
    const b=a.x*dir.x+a.y*dir.y+a.z*dir.z,c=a.x*a.x+a.y*a.y+a.z*a.z-r*r,disc=b*b-c;
    if(disc<0)return Infinity;const t=-b-Math.sqrt(disc);return t>=0?t:c<=0?0:Infinity;
  }

  function shoot(){
    if(!canAct())return;
    if(soapSelected){throwSoap();return;}
    if(reload>0||bolt>0||switchTime>0)return;if(!ammo){doReload();return;}
    cameraView();ammo--;inventory[weaponId].ammo=ammo;shots++;bolt=gun().interval;inventory[weaponId].cooldown=bolt;
    const dir=aimDirection();let hit=null,nearest=100;
    for(const t of targets){if(!t.alive)continue;const test=enemyHit(camera,dir,t);if(test.distance<nearest){nearest=test.distance;hit={t,head:test.head};}}
    const wall=Math.min(100,...solidWorld().map(b=>rayBox(camera,dir,b)));if(wall<nearest){nearest=wall;hit=null;}
    let barrelHit=null;for(const b of barrels){if(!b.alive)continue;const d=rayBox(camera,dir,{...b,w:1.2,h:1.8,d:1.2});if(d<nearest){barrelHit=b;nearest=d;hit=null;}}
    if(barrelHit)explodeBarrel(barrelHit);else if(hit)damageTarget(hit);
    if(gameMode==='duel'){const victim=duelVictim(camera,dir,wall);if(victim)damagePilot(victim,Math.min(100,gun().damage*(victim.head?gun().critical:1)),weaponId);}
    emitFx('shot',{range:nearest});
    tracers.push({x:camera.x+dir.x*nearest,y:camera.y+dir.y*nearest,z:camera.z+dir.z*nearest,life:.09});
    recoil=1;gunshot();aimKick=Math.min(.045,aimKick+gun().kick*(scoped?.65:1));
    if(!ammo){doReload();say('자동 재장전',.8);}
  }


  function damageTarget(hit,overrideDamage=null,countHit=true,fromNetwork=false){
    const t=hit.t;if(!t||!t.alive)return;
    const damage=overrideDamage==null?Math.round(gun().damage*(hit.head?gun().critical:1)):overrideDamage;
    if(online.roomCode&&!online.isHost&&!fromNetwork){queueEvent({kind:'damage',wave,index:targets.indexOf(t),damage,head:hit.head,effect:hit.effect||weaponId});if(countHit)hits++;hitMark=.16;hitCritical=hit.head;ultCharge=clamp(ultCharge+Math.min(t.hp,damage)*.09,0,100);effects.push({x:t.x,y:t.y+2,z:t.z,life:.65,text:String(damage),critical:hit.head});return;}
    const previousHp=t.hp;t.hp-=damage;if(hit.effect==='laser'&&t.hp>0)t.slow=2;if(countHit)hits++;if(!ultActive&&!fromNetwork)ultCharge=clamp(ultCharge+Math.min(previousHp,damage)*.09+(t.hp<=0?10:0),0,100);t.flash=.18;
    if(!fromNetwork){hitMark=.18;hitCritical=hit.head;tone(hit.head?950:560,.05,.035);}
    effects.push({x:t.x,y:t.y+2,z:t.z,life:.65,text:String(damage),critical:hit.head});
    if(t.hp<=0){t.alive=false;kills++;dropHeal(t);queueEvent({kind:'kill',target:fromNetwork||online.playerId,wave,head:hit.head});combo=comboTime>0?combo+1:1;comboTime=3;score+=(hit.head?300:100)+Math.min(combo-1,5)*25;if(hit.head)heads++;addKill(hit.head,t.boss);effects.push({x:t.x,y:t.y,z:t.z,life:.6});}
    else{t.dodge=(Math.random()>.5?1:-1)*2;t.charge=Math.max(-.15,t.charge-.08);}
  }


  function slash(){
    if(!canAct()||inventory.knife.cooldown>0)return;cameraView();emitFx('melee');meleeSwing=.42;inventory.knife.cooldown=.48;recoil=.5;
    const dir=aimDirection();let victim=null,nearest=Infinity;
    for(const t of targets){if(!t.alive)continue;const dx=t.x-camera.x,dy=t.y-camera.y,dz=t.z-camera.z,d=Math.hypot(dx,dy,dz);if(d-t.r>3.2||d>=nearest||(dx*dir.x+dy*dir.y+dz*dir.z)/d<.7)continue;const toward={x:dx/d,y:dy/d,z:dz/d};if(solidWorld().some(b=>rayBox(camera,toward,b)<d-t.r))continue;victim=t;nearest=d;}
    if(victim)damageTarget({t:victim,head:false},150,false);
    if(gameMode==='duel')damagePilot(duelVictim(camera,dir,3.5,.7),55,'melee');tone(320,.12,.05,'triangle');
  }

  function rayBox(origin,dir,b){
    let near=0,far=Infinity;
    for(const [axis,size] of [['x','w'],['y','h'],['z','d']]){
      const lo=b[axis]-b[size]/2,hi=b[axis]+b[size]/2;
      if(Math.abs(dir[axis])<1e-8){if(origin[axis]<lo||origin[axis]>hi)return Infinity;continue;}
      let a=(lo-origin[axis])/dir[axis],z=(hi-origin[axis])/dir[axis];if(a>z)[a,z]=[z,a];near=Math.max(near,a);far=Math.min(far,z);if(near>far)return Infinity;
    }return far>0?near:Infinity;
  }

  $('#start').onclick=()=>{leaveRoom();start('combat');};
  $('#createRoom').onclick=()=>createRoom('combat');
  $('#createDuel').onclick=()=>createRoom('duel');
  $('#joinForm').onsubmit=e=>{e.preventDefault();joinRoom();};
  $('#roomCode3').oninput=e=>{e.target.value=e.target.value.replace(/[^a-z0-9]/gi,'').toUpperCase();};
  $('#cancelRoom').onclick=()=>{leaveRoom();setOnlineStatus('대기를 취소했습니다.');};
  $('#copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(online.roomCode);setOnlineStatus('방 코드를 복사했습니다.');}catch(e){setOnlineStatus('친구에게 '+online.roomCode+' 코드를 알려주세요.');}};
  $('#retry').onclick=()=>start(gameMode,true);
  $('#resume').onclick=resume;$('#home').onclick=home;$('#resultHome').onclick=home;

  $('#sound').onclick=()=>{muted=!muted;$('#sound').textContent=muted?'소리 꺼짐':'소리 켜짐';syncMusic();};
  const fullscreenButton=$('#fullscreen');
  function syncFullscreen(){if(fullscreenButton)fullscreenButton.textContent=document.fullscreenElement?'전체화면 해제':'전체화면';}
  fullscreenButton&&fullscreenButton.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#stage').requestFullscreen();}catch(e){say('브라우저에서 전체화면을 허용해주세요',2);}syncFullscreen();});
  document.addEventListener('fullscreenchange',()=>{syncFullscreen();if(!document.fullscreenElement&&mode==='playing')pause();});syncFullscreen();
  document.addEventListener('pointerlockchange',()=>{const locked=document.pointerLockElement===canvas;const wasLocked=lockedBefore;lockedBefore=locked;if(!locked&&wasLocked&&['playing','homewalk'].includes(mode))pause();});
  document.addEventListener('mousemove',e=>{
    if(mode!=='playing'&&mode!=='homewalk')return;
    if(document.pointerLockElement===canvas)look(e.movementX,e.movementY);
    else {if(lastMouse)look(e.clientX-lastMouse.x,e.clientY-lastMouse.y);lastMouse={x:e.clientX,y:e.clientY};}
  });
  canvas.addEventListener('mouseleave',()=>lastMouse=null);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('mousedown',e=>{if(mode==='homewalk'){lock();return;}if(!canAct())return;if(!document.pointerLockElement)lock();if(e.button===2&&['combat','duel'].includes(gameMode)&&weaponId!=='knife'&&reload<=0&&switchTime<=0)scoped=true;if(e.button===0){trigger=true;shoot();}});
  window.addEventListener('mouseup',e=>{if(e.button===0)trigger=false;if(e.button===2)scoped=false;});
  canvas.addEventListener('wheel',e=>{if(mode!=='playing')return;e.preventDefault();const ids=['sniper','rifle'],i=ids.indexOf(weaponId);switchWeapon(ids[(i+(e.deltaY>0?1:ids.length-1))%ids.length]);},{passive:false});
  document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,button')&&e.key!=='Escape')return;const key=e.code.startsWith('Key')?e.code.slice(3).toLowerCase():e.key.toLowerCase();if(e.ctrlKey&&key==='w'){e.preventDefault();e.stopPropagation();return;}if(key==='escape'){e.preventDefault();if(['playing','homewalk'].includes(mode)){pause();}else if(mode==='paused'&&performance.now()-lastPauseAt>180){resume();}return;}if(mode==='homewalk'){
      if(['w','a','s','d','shift','control',' ','e','f'].includes(key)){e.preventDefault();keys.add(key);}
      if(!e.repeat&&key==='f')interactHome();
      if(!e.repeat&&(key===' '||key==='e')){if(nearToilet())requestEntry();else if(key===' '&&entry.jump===0)entry.vy=42;}
      return;
    }if(!canAct())return;if([' ','arrowup','arrowdown','shift','control','w','a','s','d','1','2','r','q','e','f'].includes(key))e.preventDefault();keys.add(key);if(e.repeat)return;if(['1','2'].includes(key))switchWeapon(['sniper','rifle'][Number(key)-1]);if(key===' '||e.code==='Space')jump();if(key==='3'&&soapCount>0){soapSelected=true;scoped=false;trigger=false;say('휴지 · 좌클릭으로 던지기',1);}if(key==='r')doReload();if(key==='q')ultimate();if(key==='e')laser();if(key==='shift')shiftMove();if(key==='f')slash();if(key==='p')pause();});
  document.addEventListener('keyup',e=>keys.delete(e.code.startsWith('Key')?e.code.slice(3).toLowerCase():e.key.toLowerCase()));window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  function update(dt){
    if(mode==='ending'){time+=dt;finale=Math.min(5,finale+dt);if(finale>=2.6&&!finaleSplashed){finaleSplashed=true;startFlush();tone(110,.25,.16,'sine');voice('퐁당');}if(finale>=5)end(true);return;}
    if(mapTransition>0){mapTransition=Math.max(0,mapTransition-dt);time+=dt;return;}
    updateEntry(dt);if(entry.phase!=='combat'||(mode==='result'&&(mission.finished||mission.failed)))return;
    const background=online.roomCode&&(mode==='paused'||mode==='result');
    if(mode==='playing'||background)flushTime=Math.max(0,flushTime-dt);
    if(mode!=='playing'&&!background)return;time+=dt;updateWet(dt);updateCampaign(dt);updateSoap(dt);meleeSwing=Math.max(0,meleeSwing-dt);cameraView();ultFlash=Math.max(0,ultFlash-dt);updateHeals(dt);updateLaserUlt(dt);updatePoopUlt(dt);
    laserCooldown=Math.max(0,laserCooldown-dt);dashCooldown=Math.max(0,dashCooldown-dt);contactGrace=Math.max(0,contactGrace-dt);
    laserBeams.forEach(b=>b.life-=dt);laserBeams=laserBeams.filter(b=>b.life>0);
    const dashStep=Math.min(dashTime,dt);dashTime=Math.max(0,dashTime-dt);


    const dx=Number(keys.has('d'))-Number(keys.has('a')),dz=Number(keys.has('w'))-Number(keys.has('s')),mag=Math.hypot(dx,dz)||1;
    const crouching=keys.has('control'),running=sprinting();
    if(running)scoped=false;
    const speed=(dashStep>0?0:crouching?2.5:running?13:scoped?3:8)*(slowRemaining()>0?.5:1);
    stanceHeight+=((crouching?7.9:9)-stanceHeight)*(1-Math.exp(-16*dt));
    const mx=dashStep>0?dashVector.x*55*dashStep:(dx*Math.cos(yaw)+dz*Math.sin(yaw))/mag*speed*dt;
    const mz=dashStep>0?dashVector.z*55*dashStep:(dz*Math.cos(yaw)-dx*Math.sin(yaw))/mag*speed*dt;
    if(canAct())combatMotion(mx,mz,dt);
    if(dx||dz)walkPhase+=dt*(running?14:9);
    breath=100;
    aimBlend+=(Number(scoped)-aimBlend)*(1-Math.exp(-14*dt));aimKick*=Math.exp(-12*dt);switchTime=Math.max(0,switchTime-dt);emptyClick=Math.max(0,emptyClick-dt);comboTime=Math.max(0,comboTime-dt);
    Object.values(inventory).forEach(v=>v.cooldown=Math.max(0,v.cooldown-dt));bolt=inventory[weaponId].cooldown;
    recoil=Math.max(0,recoil-dt*7);hitMark=Math.max(0,hitMark-dt);damageFlash=Math.max(0,damageFlash-dt*2);messageTime=Math.max(0,messageTime-dt);
    if(reload>0){reload-=dt;if(reload<=0){ammo=gun().mag;inventory[weaponId].ammo=ammo;tone(380,.08,.04);}}
    if(canAct()&&weaponId!=='knife'&&ammo===0&&reload<=0&&switchTime<=0)doReload();
    if(trigger&&gun().auto)shoot();
    effects.forEach(e=>e.life-=dt);effects=effects.filter(e=>e.life>0);
    tracers.forEach(t=>t.life-=dt);tracers=tracers.filter(t=>t.life>0);
    for(const t of targets){if(!t.alive||mission.intro>0)continue;if(online.roomCode&&!online.isHost){if(Math.hypot(t.x-camera.x,t.y-camera.y,t.z-camera.z)<t.r+.7)hurt(15,'접촉 피해!');continue;}t.flash=Math.max(0,t.flash-dt);t.dodge*=Math.exp(-3*dt);
      if(t.charge<.65)moveEnemy(t,dt);
      if(Math.hypot(t.x-camera.x,t.y-camera.y,t.z-camera.z)<t.r+.7){hurt(15,'접촉 피해! 적과 거리를 벌리세요');if(mode!=='playing')return;}
      const victim=enemyAim(t);const prev=t.charge;t.charge+=dt*level().speed/(t.boss?2.5:t.type==='angry'?2.3:t.type==='cool'?3.0:3.5);
      if(prev<.65&&t.charge>=.65)t.aim={...victim};
      if(t.charge>=1){
        const aim=t.aim||victim,dx=aim.x-t.x,dy=aim.y-t.y,dz=aim.z-t.z,dist=Math.hypot(dx,dy,dz)||1,speed=(20+Math.min(wave,10)*1.6)*level().speed;
        for(const angle of (t.boss?[-.13,0,.13]:t.type==='cool'?[-.055,.055]:[0])){const vx=(dx*Math.cos(angle)+dz*Math.sin(angle))/dist*speed,vz=(dz*Math.cos(angle)-dx*Math.sin(angle))/dist*speed,shot={x:t.x,y:t.y,z:t.z,vx,vy:dy/dist*speed,vz,damage:t.boss?25:15,life:5};projectiles.push(shot);queueEvent({kind:'enemyShot',point:{x:t.x,y:t.y,z:t.z},velocity:{vx:shot.vx,vy:shot.vy,vz:shot.vz},damage:shot.damage});}t.charge=-.1;t.aim=null;
      }
    }
    for(const p of projectiles){
      p.life-=dt;const old={x:p.x,y:p.y,z:p.z};p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
      const vx=p.x-old.x,vy=p.y-old.y,vz=p.z-old.z,len=vx*vx+vy*vy+vz*vz;
      const length=Math.sqrt(len);if(length>0&&solidWorld().some(b=>rayBox(old,{x:vx/length,y:vy/length,z:vz/length},b)<=length)){p.life=0;continue;}
      const f=len?clamp(((camera.x-old.x)*vx+(camera.y-old.y)*vy+(camera.z-old.z)*vz)/len,0,1):0;
      if(Math.hypot(old.x+vx*f-camera.x,old.y+vy*f-camera.y,old.z+vz*f-camera.z)<.65){p.life=0;hurt(p.damage||12,'피격! SHIFT로 회피하세요');if(mode!=='playing')return;}
    }
    projectiles=projectiles.filter(p=>p.life>0&&p.z>-12);
    if(mode!=='result'&&(!online.roomCode||online.isHost)&&gameMode!=='duel'&&targets.length&&targets.every(t=>!t.alive)&&(!mission.capture||mission.progress>=mission.required)){
      if(!breakTime){breakTime=3;startFlush();projectiles=[];say(wave===10?'최종 세척 완료!':'라운드 완료 · 체력 +25 / 탄약 보충',2.4);}
      if(flushTime>0)return;
      if(wave>=10){mission.finished=true;score+=Math.max(0,Math.round(2400-mission.clock*2));mode='ending';finale=0;keys.clear();trigger=false;scoped=false;return;}
      breakTime=0;wave++;mapTransition=wave===6?3.2:0;if(wave===6){camera={x:0,y:9,z:0};combatFeet=7;jumpVelocity=0;combatGrounded=true;yaw=0;pitch=0;}hp=hp<=0?60:Math.min(100,hp+25);reload=0;trigger=false;scoped=false;
      for(const [id,w] of Object.entries(WEAPONS)){inventory[id].ammo=w.mag;inventory[id].cooldown=0;}ammo=inventory[weaponId].ammo;bolt=0;laserCooldown=0;spawnWave();
    }
  }

  function polygon(points,fill,stroke){if(points.some(p=>!p))return;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function ground(points,color){
    let vertices=points.map(([x,y,z])=>{
      const dx=x-camera.x,dy=y-camera.y,dz=z-camera.z,zz=dx*viewSinYaw+dz*viewCosYaw;
      return{x:dx*viewCosYaw-dz*viewSinYaw,y:dy*viewCosPitch-zz*viewSinPitch,z:dy*viewSinPitch+zz*viewCosPitch};
    });
    const clipped=[];
    for(let i=0;i<vertices.length;i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length],inside=a.z>=.2,next=b.z>=.2;
      if(inside)clipped.push(a);
      if(inside!==next){const t=(.2-a.z)/(b.z-a.z);clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:.2});}
    }
    if(clipped.length>=3)polygon(clipped.map(p=>({x:W/2+p.x*focal/p.z,y:H/2-p.y*focal/p.z})),color);
  }

  function box(b){
    const x=b.x,z=b.z,w=b.w/2,d=b.d/2,lo=b.y-b.h/2,hi=b.y+b.h/2;
    if(camera.z<z)ground([[x-w,lo,z-d],[x+w,lo,z-d],[x+w,hi,z-d],[x-w,hi,z-d]],b.color);
    else ground([[x-w,lo,z+d],[x+w,lo,z+d],[x+w,hi,z+d],[x-w,hi,z+d]],b.color);
    if(camera.x<x)ground([[x-w,lo,z-d],[x-w,lo,z+d],[x-w,hi,z+d],[x-w,hi,z-d]],'#405d60');
    else ground([[x+w,lo,z-d],[x+w,lo,z+d],[x+w,hi,z+d],[x+w,hi,z-d]],'#6b8984');
    if(camera.y>hi)ground([[x-w,hi,z-d],[x+w,hi,z-d],[x+w,hi,z+d],[x-w,hi,z+d]],'#c0cbb8');
  }

  function weapon(){
    const sniper=weaponId==='sniper',knife=weaponId==='knife'||meleeSwing>0;
    const moving=['w','a','s','d'].some(k=>keys.has(k));
    const bob=moving?Math.sin(walkPhase)*3*(1-aimBlend):0;
    const reloadPhase=reload>0?Math.sin(Math.PI*reload/gun().reload):0;
    ctx.save();ctx.translate(W/2+(1-aimBlend)*205+bob,H/2+(1-aimBlend)*80+recoil*24+reloadPhase*155+switchTime*350);ctx.scale(1.14,1.14);
    ctx.rotate((1-aimBlend)*-.12+reloadPhase*.35);
    function shape(points,fill,stroke='#11181c'){polygon(points.map(([x,y])=>({x,y})),fill,stroke);}
    function metal(x,y,w,h){const g=ctx.createLinearGradient(x,y,x+w,y);g.addColorStop(0,'#151b20');g.addColorStop(.32,'#677078');g.addColorStop(.48,'#343e45');g.addColorStop(1,'#11191f');ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.strokeStyle='#768088';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);}
    function arm(x,y,rotation,color='#596b58'){ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.strokeStyle=color;ctx.lineWidth=42;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-45,145);ctx.stroke();ctx.strokeStyle='#9ab7a3';ctx.lineWidth=4;ctx.stroke();ctx.restore();}
    function glove(x,y,rotation){ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.fillStyle='#343b32';ctx.beginPath();ctx.ellipse(0,0,35,61,0,0,TAU);ctx.fill();ctx.strokeStyle='#646b57';ctx.lineWidth=2;ctx.stroke();for(let i=0;i<4;i++){ctx.fillStyle='#202820';ctx.fillRect(-24,-33+i*13,46,8);}ctx.restore();}
    if(soapSelected&&!knife){arm(30,290,0);glove(30,280,0);drawPaperRoll(0,190,55);ctx.restore();return;}
    if(knife){
      const thrust=Math.sin(clamp(1-meleeSwing/.42,0,1)*Math.PI);ctx.translate(-thrust*90,70-thrust*160);ctx.rotate(-.2+thrust*.15);
      ctx.fillStyle='#a77f4d';ctx.fillRect(-12,20,24,290);ctx.fillStyle='#d0ab72';ctx.fillRect(-8,20,5,290);
      ctx.fillStyle='#984f43';ctx.beginPath();ctx.moveTo(-65,35);ctx.bezierCurveTo(-55,-45,55,-45,65,35);ctx.closePath();ctx.fill();ctx.fillStyle='#b86a58';ctx.beginPath();ctx.ellipse(0,35,72,15,0,0,TAU);ctx.fill();ctx.strokeStyle='#683b32';ctx.lineWidth=5;ctx.stroke();glove(20,275,-.1);arm(25,310,-.1);ctx.restore();return;
    }
    {

      // Foreshortened barrel, separate receiver faces, magazine and stock.
      metal(-10,18,20,sniper?128:77);metal(-14,23,28,18);
      for(let i=0;i<3;i++){ctx.fillStyle='#060d12';ctx.fillRect(-13,27+i*4,26,2);}
      const front=sniper?148:96;
      shape([[-19,front],[19,front],[43,249],[-43,249]],sniper?'#59604b':'#30393b');
      shape([[19,front],[43,249],[57,272],[31,front]],'#1b252b');
      for(let i=0;i<8;i++){const y=front+12+i*(sniper?10:16),w=20+i*2;metal(-w,y,w*2,5);ctx.fillStyle='#0c1316';ctx.fillRect(w-6,y+6,7,7);}
      shape([[-43,248],[43,248],[67,348],[-63,348]],'#404b51');
      shape([[43,248],[67,348],[91,361],[61,266]],'#1b252b');
      metal(-18,265,36,70);ctx.fillStyle='#0b141b';ctx.fillRect(34,282,23,31);
      shape([[41,337],[73,348],[91,429],[40,447],[27,411]],'#20292e');
      for(let i=0;i<5;i++){ctx.strokeStyle='#525c62';ctx.beginPath();ctx.moveTo(43,355+i*14);ctx.lineTo(70+i*2,359+i*14);ctx.stroke();}
      shape([[-60,344],[61,344],[90,530],[-92,530]],sniper?'#4c5740':'#303a34');ctx.fillStyle='#cced9c';ctx.fillRect(-31,278,8,38);ctx.fillStyle='#a4b8b4';ctx.font='9px monospace';ctx.fillText(sniper?'M-24':'F-04',-18,317);
      shape([[-44,373],[44,373],[57,495],[-56,495]],'#17221f');
      for(const [x,y] of [[-31,270],[-43,325],[49,328]]){ctx.fillStyle='#929b9d';ctx.beginPath();ctx.arc(x,y,3,0,TAU);ctx.fill();ctx.fillStyle='#182126';ctx.fillRect(x-2,y-1,4,2);}
      if(sniper){
        metal(-23,95,46,135);metal(-31,90,62,25);metal(-34,206,68,36);
        ctx.fillStyle='#111d25';ctx.beginPath();ctx.ellipse(0,211,31,17,0,0,TAU);ctx.fill();ctx.strokeStyle='#8a9b99';ctx.stroke();
        ctx.fillStyle='#467d8266';ctx.beginPath();ctx.ellipse(-3,207,22,9,0,0,TAU);ctx.fill();metal(22,142,22,26);
        ctx.strokeStyle='#8c999d';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(43,287);ctx.lineTo(76,303);ctx.lineTo(79,326);ctx.stroke();ctx.fillStyle='#182128';ctx.beginPath();ctx.arc(79,328,10,0,TAU);ctx.fill();
      }else{
        metal(-20,50,40,22);ctx.fillStyle='#659d9b25';ctx.strokeStyle='#151e23';ctx.lineWidth=8;ctx.beginPath();ctx.roundRect(-34,-29,68,64,10);ctx.fill();ctx.stroke();ctx.strokeStyle='#7b8889';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#65ff65';ctx.beginPath();ctx.arc(0,0,2.5,0,TAU);ctx.fill();
      }
      arm(-51,225,.28);arm(79,350,-.3);glove(-51,225,.28);glove(79,350,-.3);
      shape([[60,397],[111,382],[179,540],[19,540]],'#414b3a');
    }
    if(recoil>.65){ctx.globalAlpha=(recoil-.65)/.35;shape([[-9,18],[-32,-28],[-5,-12],[8,-47],[24,18]],'#ffe3a3');ctx.globalAlpha=1;}
    ctx.restore();
  }
  function scope(){
    const r=H*.385;ctx.fillStyle='#03090bea';ctx.beginPath();ctx.rect(0,0,W,H);ctx.arc(W/2,H/2,r,0,TAU,true);ctx.fill('evenodd');
    ctx.strokeStyle='#a5b5a480';ctx.lineWidth=3;ctx.beginPath();ctx.arc(W/2,H/2,r+5,0,TAU);ctx.stroke();
    ctx.strokeStyle='#101c17';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(W/2-r,H/2);ctx.lineTo(W/2+r,H/2);ctx.moveTo(W/2,H/2-r);ctx.lineTo(W/2,H/2+r);ctx.stroke();
    for(let i=-5;i<=5;i++){if(!i)continue;ctx.fillStyle='#111b16';ctx.fillRect(W/2+i*35-1,H/2-4,2,8);ctx.fillRect(W/2-4,H/2+i*35-1,8,2);}
    ctx.fillStyle='#65ff65';ctx.fillRect(W/2-2,H/2-2,4,4);ctx.textAlign='center';ctx.font='12px monospace';ctx.fillStyle='#c5d3b7';ctx.fillText('4× / M-24',W/2,H/2+r-38);
    ctx.fillStyle='#7f908366';ctx.fillRect(W/2-60,H/2+r-25,120,3);ctx.fillStyle='#d0d9ab';ctx.fillRect(W/2-60,H/2+r-25,breath*1.2,3);
  }

  function draw(){
    ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);cameraView();const in3d=renderRoom();
    if(mode==='ending'||mapTransition>0){ctx.clearRect(0,0,W,H);ctx.fillStyle='#e8eed2';ctx.strokeStyle='#142e30';ctx.lineWidth=5;ctx.textAlign='center';ctx.font='900 30px sans-serif';const caption=mode==='ending'?(finale<2.6?'마지막 한 덩이까지…':'퐁당! 오늘의 청소 완료.'):'변기 아래, 깊은 배관으로';ctx.strokeText(caption,W/2,H*.18);ctx.fillText(caption,W/2,H*.18);return;}
    if(entry.phase!=='combat'&&mode!=='menu'){ctx.clearRect(0,0,W,H);if(!in3d&&rendererFailed){entry.phase='combat';mode='playing';$('#entryHud').hidden=true;$('#stage').classList.remove('exploring');}return;}
    if(in3d){ctx.clearRect(0,0,W,H);drawActorLabels();}else{drawEnvironment();
    const objects=blocks.map(b=>({z:(project(b.x,b.y,b.z)||{}).z||0,draw:()=>box(b)}));arena.forEach(b=>objects.push({z:(project(b.x,b.y,b.z)||{}).z||0,draw:()=>drawStructure(b)}));targets.filter(t=>t.alive).forEach(t=>objects.push({z:(project(t.x,t.y,t.z)||{}).z||0,draw:()=>humanoid(t)}));remotePilots().forEach(p=>objects.push({z:(project(p.state.x,p.state.y,p.state.z)||{}).z||0,draw:()=>drawRemotePilot(p)}));objects.sort((a,b)=>b.z-a.z).forEach(o=>o.draw());}
    drawRemoteFx();drawMissionMarkers();
    if(!in3d)worldLabel(0,22,76.8,'FLUSH PROTOCOL','#d1e1cc',2.4);
    if(!in3d)worldLabel(0,18.7,76.7,'PORCELAIN / '+String(wave).padStart(2,'0'),'#a3cbaa',.65);
    if(!in3d){drawBarrels();drawSoap();drawHeals();}else for(const b of soapThrows){const q=project(b.x,b.y,b.z);if(q)drawPaperRoll(q.x,q.y,clamp(q.s*.45,6,35));}
    projectiles.forEach(b=>{const p=project(b.x,b.y,b.z);if(!p)return;ctx.fillStyle='#ff9b63';ctx.shadowColor='#ff6746';ctx.shadowBlur=quality==='low'?0:12;ctx.beginPath();ctx.arc(p.x,p.y,clamp(p.s*.18,3,35),0,TAU);ctx.fill();ctx.shadowBlur=0;});
    tracers.forEach(t=>{const p=project(t.x,t.y,t.z);if(!p)return;ctx.strokeStyle='#ffe9b655';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(W/2+(1-aimBlend)*160,H*.78);ctx.lineTo(p.x,p.y);ctx.stroke();});
    effects.forEach(e=>{const p=project(e.x,e.y,e.z);if(!p)return;ctx.globalAlpha=Math.min(1,e.life*3);
      if(e.text){ctx.fillStyle=e.critical?'#ff3b3b':'#fff';ctx.font=`bold ${e.critical?24:18}px monospace`;ctx.textAlign='center';ctx.fillText(e.text,p.x,p.y-(.7-e.life)*45);}
      else{ctx.strokeStyle='#ffe0a0';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(1,(.6-e.life)*p.s*5+4),0,TAU);ctx.stroke();for(let i=0;i<8;i++){const a=i*TAU/8,d=(.6-e.life)*p.s*7;ctx.fillStyle=i%2?'#ffcc67':'#fff7c7';ctx.fillRect(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,4,4);}}
      ctx.globalAlpha=1;
    });
    if(weaponId==='sniper'&&aimBlend>.85)scope();else{if(!in3d)weapon();
      if(aimBlend<.75){const gap=7+recoil*9;ctx.strokeStyle='#102518';ctx.lineWidth=5;ctx.beginPath();for(const sign of [-1,1]){ctx.moveTo(W/2+sign*gap,H/2);ctx.lineTo(W/2+sign*(gap+7),H/2);ctx.moveTo(W/2,H/2+sign*gap);ctx.lineTo(W/2,H/2+sign*(gap+7));}ctx.stroke();ctx.strokeStyle='#65ff65';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#102518';ctx.fillRect(W/2-3,H/2-3,6,6);ctx.fillStyle='#65ff65';ctx.fillRect(W/2-1,H/2-1,2,2);}
    }
    for(const beam of laserBeams){
      const end=project(beam.end.x,beam.end.y,beam.end.z);if(!end)continue;
      ctx.save();ctx.globalAlpha=clamp(beam.life/.35,0,1);ctx.shadowColor='#51f4ff';ctx.shadowBlur=28;
      for(const [width,color] of [[22,'#36dfff55'],[8,'#54ecff'],[2,'#ffffff']]){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(W*.58,H*.78);ctx.lineTo(end.x,end.y);ctx.stroke();}ctx.restore();
    }
    if(dashTime>0){ctx.save();ctx.strokeStyle='#9fefff99';ctx.lineWidth=3;for(let i=0;i<18;i++){const a=i*TAU/18;ctx.beginPath();ctx.moveTo(W/2+Math.cos(a)*W*.33,H/2+Math.sin(a)*H*.33);ctx.lineTo(W/2+Math.cos(a)*W*.56,H/2+Math.sin(a)*H*.56);ctx.stroke();}ctx.restore();}
    for(const t of targets){
      if(!t.alive)continue;
      const p=project(t.x,t.y,t.z);if(p&&p.x>60&&p.x<W-60&&p.y>60&&p.y<H-60)continue;
      const angle=Math.atan2(t.x-camera.x,t.z-camera.z)-yaw;
      const x=W/2+Math.sin(angle)*W*.41,y=H/2-Math.cos(angle)*H*.34;
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);polygon([{x:0,y:-13},{x:-8,y:9},{x:8,y:9}],'#ffad78');ctx.restore();
    }
    if(ultFlash>0){ctx.save();ctx.globalAlpha=ultFlash/1.2;ctx.strokeStyle='#ccaeff';ctx.shadowColor='#9872ff';ctx.shadowBlur=35;ctx.lineWidth=25;ctx.beginPath();ctx.arc(W/2,H/2,(1.2-ultFlash)*900+30,0,TAU);ctx.stroke();ctx.fillStyle='#bda5ff22';ctx.fillRect(0,0,W,H);ctx.restore();}
    drawLaserUlt();drawPoopUlt();drawFlush();
    if(hitMark>0){ctx.strokeStyle=hitCritical?'#ff2f2f':'#fff';ctx.lineWidth=2;for(const x of [-1,1])for(const y of [-1,1]){ctx.beginPath();ctx.moveTo(W/2+x*8,H/2+y*8);ctx.lineTo(W/2+x*17,H/2+y*17);ctx.stroke();}}
    drawDamageFeedback();drawSkillWarnings();
    if(mapTransition>0){ctx.save();ctx.globalAlpha=clamp(mapTransition/2.8,0,1);ctx.fillStyle='#071f2a';ctx.fillRect(0,0,W,H);ctx.fillStyle='#dcefa4';ctx.font='900 30px sans-serif';ctx.textAlign='center';ctx.fillText('PIPE DEPTH',W/2,H*.32);ctx.font='bold 16px sans-serif';ctx.fillText('NEW DRAINAGE ZONE',W/2,H*.32+34);ctx.restore();}const vignette=ctx.createRadialGradient(W/2,H/2,H*.18,W/2,H/2,H*.78);vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(2,8,18,.42)');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
    if(mode==='playing'&&weaponId==='rifle'&&aimBlend>=.75&&!soapSelected){
      ctx.save();ctx.translate(W/2,H/2);
      ctx.beginPath();ctx.arc(0,0,10,0,TAU);ctx.strokeStyle='#05190c';ctx.lineWidth=5;ctx.stroke();
      ctx.strokeStyle='#8cff63';ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='#05190c';ctx.beginPath();ctx.arc(0,0,4.5,0,TAU);ctx.fill();
      ctx.fillStyle='#afff78';ctx.beginPath();ctx.arc(0,0,2.5,0,TAU);ctx.fill();
      ctx.restore();
    }
    if(mode==='playing'){ctx.save();ctx.globalAlpha=.18;ctx.strokeStyle='#b9fff0';ctx.lineWidth=1;ctx.beginPath();ctx.arc(W/2,H/2,22+recoil*8,0,TAU);ctx.stroke();ctx.restore();}
  }
  function updateHud(){
    $('#wave').textContent=`STAGE ${String(wave).padStart(2,'0')} · ${level().name}`;$('#score').textContent=String(score).padStart(5,'0');$('#health').textContent=`체력 ${hp} · ${jumpHeight>0?'공중':keys.has('control')?'앉음':sprinting()?'달리는 중':'서 있음'}`;$('#ammo').textContent=weaponId==='knife'?'∞':ammo;
    $('#hpTrail').style.width=hpTrail+'%';$('#hpBar').classList.toggle('hit',damageCue.life>.75);$('#hpFill').style.width=hp+'%';$('#hpValue').textContent=hp+' / 100';$('#hpBar').setAttribute('aria-valuenow',String(hp));$('#hpBar').classList.toggle('low',hp<=30);
    $('#laserState').textContent=laserCooldown>0?laserCooldown.toFixed(1)+'초':'준비';$('#dashState').textContent=dashCooldown>0?dashCooldown.toFixed(1)+'초':'준비';
    $('#laserSkill').classList.toggle('ready',laserCooldown<=0);$('#dashSkill').classList.toggle('ready',dashCooldown<=0);
    $('#ultGauge').style.setProperty('--charge',ultCharge+'%');$('#ultGauge').classList.toggle('ready',ultCharge>=100);$('#ultGauge').setAttribute('aria-valuenow',String(Math.floor(ultCharge)));$('#ultPercent').textContent=ultCharge>=100?'준비':Math.floor(ultCharge)+'%';
    $('#weaponName').textContent=gun().name;$('#magSize').textContent=weaponId==='knife'?' / 근접':'/ '+gun().mag;
    $('#weaponStatus').textContent=switchTime>0?'무기 교체 중':reload>0?`재장전 ${reload.toFixed(1)}s`:bolt>0&&weaponId==='sniper'?'노리쇠 작동 중':scoped&&weaponId==='sniper'?'4× 스코프 · 조준 안정화':gun().label;
    for(const [i,id] of ['sniper','rifle'].entries()){$('#slot'+(i+1)).classList.toggle('active',id===weaponId);$('#slotAmmo'+(i+1)).textContent=id==='knife'?'∞':inventory[id].ammo;}
    $('#objective').textContent=(online.roomCode?`방 코드 ${online.roomCode} · `:'')+`남은 적 ${targets.filter(t=>t.alive).length}명 · 전멸 시 다음 스테이지 · CTRL 앉기`;$('#message').textContent=messageTime>0?message:'';
    polishHud();
  }
  var gameMode='combat',ultCharge=0,ultFlash=0,ultActive=false,healPacks=[],musicEnabled=true,mapTransition=0,finale=0,finaleSplashed=false;
  function initHeals(){healPacks=[];}
  function updateHeals(dt){for(const p of healPacks){p.life-=dt;if(p.life>0&&hp>0&&hp<100&&Math.hypot(camera.x-p.x,camera.z-p.z)<1.8&&Math.abs(camera.y-p.y)<2.2){hp=Math.min(100,hp+35);p.life=0;say('힐팩 +35 HP',1.5);tone(640,.2,.07);}}healPacks=healPacks.filter(p=>p.life>0);}
  function drawHeals(){for(const h of healPacks){if(h.life<=0)continue;const p=project(h.x,h.y+Math.sin(time*2)*.2,h.z);if(!p)continue;const size=clamp(p.s*.8,8,80);ctx.save();ctx.translate(p.x,p.y);ctx.shadowColor='#79ffc3';ctx.shadowBlur=18;ctx.fillStyle='#184a3c';ctx.fillRect(-size,-size,size*2,size*1.6);ctx.shadowBlur=0;ctx.strokeStyle='#8bffcc';ctx.strokeRect(-size,-size,size*2,size*1.6);ctx.fillStyle='#bdffe3';ctx.fillRect(-size*.15,-size*.7,size*.3,size);ctx.fillRect(-size*.5,-size*.35,size,size*.3);ctx.restore();}}
  function modeUI(){$('#missionTitle').textContent=gameMode==='duel'?'1대1 · 변기 쟁탈전':'변기 방어 작전';}



  var combatFeet=7,combatGrounded=true,laserUlt=null,poopUlt=null;
  const arena=[];
  function structure(x,z,w,d,top,bottom=7,color='#667c82',kind='cover'){arena.push({x,z,w,d,y:(top+bottom)/2,h:top-bottom,top,bottom,color:kind==='jumpPad'?'#74be9a':kind==='cover'?'#708584':'#637e7c',kind});}
  for(let i=0;i<12;i++)structure(-11,9+i*1.4,4,1.4,7+(i+1)*.5,7,i%2?'#748c90':'#586f75','stairs');
  structure(-10,32,12,14,13,12.4,'#708890','deck');
  structure(-15,29,1,1,12.4);structure(-5,37,1,1,12.4);
  structure(0,35,8,4,13,12.4,'#879ba0','bridge');
  structure(10,35,12,10,13,12.4,'#708890','deck');
  for(let i=0;i<12;i++)structure(11,13+i*1.4,4,1.4,7+(i+1)*.5,7,i%2?'#748c90':'#586f75','stairs');
  structure(11,29.5,4,1.8,13,12.4,'#708890','deck');structure(15,38,1,1,12.4);structure(5,32,1,1,12.4);
  structure(-3,15,3,3,8.5,7,'#8b7956');
  structure(-7,20,3.5,3.5,7.35,7,'#52c7a0','jumpPad');structure(7,27,3.5,3.5,7.35,7,'#52c7a0','jumpPad');structure(0,45,3.5,3.5,7.35,7,'#52c7a0','jumpPad');structure(6,48,4,4,8.7,7,'#8b7956');structure(-10,53,5,3,9,7,'#8b7956');
  const worldSolids=blocks.concat(arena);
  const bowlLayout=arena.map(b=>({...b}));let layoutId=0;
  function selectLayout(id){
    if(id===layoutId)return;layoutId=id;arena.length=0;
    if(id===0)arena.push(...bowlLayout.map(b=>({...b})));
    else{
      for(const [x,z,w,d,top] of [[-8,12,5,3,9.5],[8,15,5,3,9],[-4,29,4,5,10.5],[4,54,6,3,10],[-14,49,4,6,9.5]])structure(x,z,w,d,top);
      for(let i=0;i<10;i++)structure(11,22+i*1.4,4,1.4,7+(i+1)*.5,7,'#64827c','stairs');
      structure(10,43,12,16,12,11.3,'#537873','deck');structure(6,41,1,1,11.3);structure(15,48,1,1,11.3);
      structure(-12,27,9,10,9.5,7,'#66817b','deck');for(let i=0;i<5;i++)structure(-12,15+i*1.4,4,1.4,7+(i+1)*.5,7,'#718b82','stairs');
      structure(-7,39,3.5,3.5,7.35,7,'#74bb9a','jumpPad');structure(6,31,3.5,3.5,7.35,7,'#74bb9a','jumpPad');
    }
    worldSolids.splice(0,worldSolids.length,...blocks,...arena);
  }
  const solidWorld=()=>worldSolids;
  function inside(b,x,z,r=0){return Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r;}
  function floorAt(x,z,max=Infinity,r=0){let y=7;for(const b of arena)if(inside(b,x,z,r)&&b.top<=max+.02)y=Math.max(y,b.top);return y;}
  function moveOnStructures(body,mx,mz,height=1.8,r=.3){
    const steps=Math.max(1,Math.ceil(Math.hypot(mx,mz)/.15));
    for(let i=0;i<steps;i++)for(const axis of ['x','z']){
      const value=body[axis]+(axis==='x'?mx:mz)/steps,x=axis==='x'?value:body.x,z=axis==='z'?value:body.z;
      let blocked=false,stepTop=body.feet;
      for(const b of arena){if(!inside(b,x,z,r)||body.feet>=b.top-.02||body.feet+height<=b.bottom+.01)continue;
        if(body.grounded&&b.top-body.feet<=.52)stepTop=Math.max(stepTop,b.top);else{blocked=true;break;}}
      if(!blocked){body[axis]=value;body.feet=stepTop;}
    }
  }
  function combatMotion(mx,mz,dt){
    const body={x:camera.x,z:camera.z,feet:combatFeet,grounded:combatGrounded};moveOnStructures(body,mx,mz,keys.has('control')?1.05:1.8);
    camera.z=clamp(body.z,-6,66);const side=19.4*Math.sqrt(Math.max(.18,1-((camera.z-30)/45)**2));camera.x=clamp(body.x,-side,side);combatFeet=body.feet;
    const floor=floorAt(camera.x,camera.z,combatFeet,.3);
    if(combatFeet>floor+.02)combatGrounded=false;
    if(combatGrounded&&arena.some(b=>b.kind==='jumpPad'&&inside(b,camera.x,camera.z,.15))){combatGrounded=false;jumpVelocity=22;tone(520,.18,.08,'triangle');say('점프 발판!',.7);}
    if(!combatGrounded){const old=combatFeet;jumpVelocity-=24*dt;let next=old+jumpVelocity*dt;
      if(jumpVelocity>0){const head=keys.has('control')?1.05:1.8;for(const b of arena)if(inside(b,camera.x,camera.z,.25)&&old+head<=b.bottom+.02&&next+head>=b.bottom){next=b.bottom-head;jumpVelocity=0;}}
      if(jumpVelocity<=0&&next<=floor){combatFeet=floor;jumpVelocity=0;combatGrounded=true;}else combatFeet=next;
    }
    jumpHeight=combatGrounded?0:Math.max(.001,combatFeet-floor);camera.y=combatFeet+stanceHeight-7;
  }
  function enemyAim(t){const players=[...(hp>0?[camera]:[]),...remotePilots().filter(p=>p.state.hp>0).map(p=>p.state)];return players.sort((a,b)=>Math.hypot(a.x-t.x,a.z-t.z)-Math.hypot(b.x-t.x,b.z-t.z))[0]||camera;}
  function moveEnemy(t,dt){
    const aim=enemyAim(t), enemyFeet=aim.y-2,motionDt=dt*(t.slow>0?.5:1);
    if(t.flyer){const dx=aim.x-t.x,dz=aim.z-t.z,d=Math.hypot(dx,dz)||1;const nx=t.x+dx/d*1.8*level().speed*motionDt+Math.sin(time*2+t.phase)*motionDt*2,nz=t.z+dz/d*1.8*level().speed*motionDt+Math.cos(time*1.7+t.phase)*motionDt*2;const blocked=solidWorld().some(b=>Math.abs(nx-b.x)<b.w/2+.7&&Math.abs(nz-b.z)<b.d/2+.7&&(t.baseY+Math.sin(time*2+t.phase)*1.4)<b.y+b.h/2+.9&&(t.baseY+Math.sin(time*2+t.phase)*1.4)>b.y-b.h/2-.9);if(!blocked){t.x=clamp(nx,-18,18);t.z=clamp(nz,-8,65);}else{t.side*=-1;}if(!blocked)t.y=t.baseY+Math.sin(time*2+t.phase)*1.4;return;}
    const scale=t.boss?2.55:1,feet=t.y-1.45*scale;let destination={x:aim.x,z:aim.z},routing=false;
    if(enemyFeet>feet+1&&feet<(layoutId?11.95:12.95)){const side=layoutId?11:aim.x<0?-11:11,base=layoutId?20:side<0?7:11;
      if(!t.climbing&&Math.hypot(t.x-side,t.z-base)<.7)t.climbing=true;destination=t.climbing?{x:side,z:layoutId?38:side<0?27:31}:{x:side,z:base};routing=true;}
    const dx=t.x-destination.x,dz=t.z-destination.z,d=Math.hypot(dx,dz)||1,speed=((t.type==='grin'?3.5:2.5)+Math.min(wave*.16,1.5))*level().speed;
    const preferred=t.type==='grin'?1.4:t.type==='angry'?7:15;
    const approach=routing?(d>.15?speed:0):d>preferred+1?speed:d<preferred-1?-speed*.6:0,strafe=routing?0:speed*(t.type==='grin'?.35:.9)*t.side;
    const body={x:t.x,z:t.z,feet,grounded:true};moveOnStructures(body,(-dx/d*approach+dz/d*strafe)*motionDt,(-dz/d*approach-dx/d*strafe)*motionDt,2.4,.3);
    t.x=clamp(body.x,-18,18);t.z=clamp(body.z,-8,65);t.y=Math.max(floorAt(t.x,t.z,body.feet,.3),body.feet-12*dt)+1.45*scale;
  }
  function enemyHit(origin,dir,t){
    const scale=t.boss?2.55:1;
    const head=sphereDistance(origin,dir,{x:t.x,y:t.y+.95*scale,z:t.z},.38*scale);
    const torso=rayBox(origin,dir,{x:t.x,y:t.y-.02*scale,z:t.z,w:.95*scale,h:1.3*scale,d:.55*scale});
    const legs=rayBox(origin,dir,{x:t.x,y:t.y-scale,z:t.z,w:.8*scale,h:.9*scale,d:.5*scale});
    const distance=Math.min(head,torso,legs);return {distance,head:head===distance};
  }
  function humanoid(t){
    const scale=t.boss?2.55:1,center=project(t.x,t.y,t.z);if(!center||center.z<.65)return;
    const theta=t.facing??Math.atan2(camera.x-t.x,camera.z-t.z),cs=Math.cos(theta),sn=Math.sin(theta),pieces=[];
    const eye={x:((camera.x-t.x)*cs-(camera.z-t.z)*sn)/scale,y:(camera.y-t.y)/scale,z:((camera.x-t.x)*sn+(camera.z-t.z)*cs)/scale};
    const friendly=t.friendly,flash=t.flash>0,armor=flash?'#f1f5d5':friendly?'#a9dad0':t.boss?'#524750':t.type==='angry'?'#b87965':t.type==='cool'?'#777c98':'#8c927a';
    const dark=friendly?'#2e5658':'#303e49',accent=friendly?'#aaffcb':t.boss?'#ffc07a':'#f0ac82';
    if(t.slow>0)worldRing(t.x,t.y-1.45*scale+.04,t.z,.65*scale,'#ddc34d',.65);
    const stride=Math.sin(time*7+(t.phase||0))*.16;
    const world=(x,y,z)=>({x:t.x+(x*cs+z*sn)*scale,y:t.y+y*scale,z:t.z+(-x*sn+z*cs)*scale});
    function cube(x,y,z,w,h,d,color){
      const v=[];for(const yy of [-1,1])for(const zz of [-1,1])for(const xx of [-1,1])v.push(world(x+xx*w/2,y+yy*h/2,z+zz*d/2));
      const faces=[];
      if(eye.z<z-d/2)faces.push([[0,1,5,4],.77]);else if(eye.z>z+d/2)faces.push([[2,6,7,3],1]);
      if(eye.x<x-w/2)faces.push([[0,4,6,2],.65]);else if(eye.x>x+w/2)faces.push([[1,3,7,5],.88]);
      if(eye.y>y+h/2)faces.push([[4,5,7,6],1.16]);else if(eye.y<y-h/2)faces.push([[0,2,3,1],.6]);
      const screen=v.map(p=>project(p.x,p.y,p.z));
      for(const [ids,light] of faces){const pts=ids.map(i=>v[i]),pp=ids.map(i=>screen[i]),depth=pp.reduce((n,p)=>n+(p?.z||0),0)/4;pieces.push({pts,pp,color:shadeColor(color,light),depth});}
    }
    const floor=floorAt(t.x,t.z,t.y-1.3*scale);
    ground(Array.from({length:12},(_,i)=>[t.x+Math.cos(i*TAU/12)*.7*scale,floor+.025,t.z+Math.sin(i*TAU/12)*.55*scale]),'#07192077');
    cube(-.24,-.83,stride,.27,.78,.32,dark);cube(.24,-.83,-stride,.27,.78,.32,dark);
    cube(-.24,-.8,.19+stride,.24,.21,.14,armor);cube(.24,-.8,.19-stride,.24,.21,.14,armor);
    cube(-.24,-1.33,.13+stride,.34,.22,.58,'#21313b');cube(.24,-1.33,.13-stride,.34,.22,.58,'#21313b');
    cube(0,-.35,0,.75,.25,.44,dark);cube(0,.13,0,.85,.82,.46,armor);
    cube(0,.17,.28,.62,.61,.13,dark);cube(0,.36,.36,.49,.13,.035,accent);
    for(let i=-1;i<=1;i++)cube(i*.2,-.06,.36,.14,.2,.12,friendly?'#c3d9b5':'#a6a089');
    cube(-.55,.35,0,.32,.36,.48,armor);cube(.55,.35,0,.32,.36,.48,armor);
    cube(-.56,.03,.12,.26,.4,.3,dark);cube(.53,.04,.18,.24,.4,.32,dark);
    cube(-.4,-.12,.43,.3,.22,.5,armor);cube(.33,-.09,.5,.25,.22,.55,armor);
    cube(-.27,-.08,.67,.22,.22,.22,'#4d5c55');cube(.27,-.05,.74,.22,.22,.22,'#4d5c55');
    cube(0,.69,0,.28,.24,.26,'#b6957c');cube(0,1.0,0,.53,.51,.49,'#bca083');
    cube(0,1.25,-.035,.64,.25,.59,dark);cube(0,1.08,.285,.57,.17,.06,dark);cube(0,1.1,.323,.45,.067,.016,accent);
    cube(0,.83,.26,.36,.18,.13,'#45545b');
    cube(.07,.02,.87,.21,.23,.87,'#25363e');cube(.07,.07,1.36,.105,.115,.28,'#93aaa5');cube(.07,-.21,.67,.18,.3,.21,'#22363a');
    cube(.07,.19,.85,.16,.1,.21,accent);
    if(t.flyer){cube(-.68,.23,-.24,.32,.8,.32,'#45566b');cube(.68,.23,-.24,.32,.8,.32,'#45566b');cube(-.68,-.3,-.24,.19,.28,.2,'#e8b3e4');cube(.68,-.3,-.24,.19,.28,.2,'#e8b3e4');}
    if(t.boss){cube(-.58,.78,-.06,.22,.6,.25,'#c5986e');cube(.58,.78,-.06,.22,.6,.25,'#c5986e');cube(0,.15,.38,.2,.27,.045,'#ffb768');}
    pieces.sort((a,b)=>b.depth-a.depth);
    for(const f of pieces){if(f.pp.every(Boolean))polygon(f.pp,f.color);else ground(f.pts.map(p=>[p.x,p.y,p.z]),f.color);}
    if(t.charge>.65){worldRing(t.x,floor+.045,t.z,1.1*scale,'#ef9e79',.6);const m=world(.07,.08,1.57),p=project(m.x,m.y,m.z);if(p){ctx.fillStyle='#ffcf8a';ctx.beginPath();ctx.arc(p.x,p.y,clamp(p.s*.09,2,8),0,TAU);ctx.fill();}}
    if(friendly)worldRing(t.x,floor+.04,t.z,.8,'#b3fbd2',.35);
    if(!friendly){const p=project(t.x,t.y+1.6*scale,t.z);if(p){ctx.save();ctx.textAlign='center';ctx.fillStyle=t.flyer?'#e2bde9':'#e7bc9c';ctx.font='bold 10px monospace';ctx.fillText(t.boss?'':t.flyer?'공중 강습':t.type==='angry'?'돌격병':t.type==='cool'?'중장갑':'추격병',p.x,p.y-5);if(t.hp<t.maxHp){ctx.fillStyle='#14222b';ctx.fillRect(p.x-20,p.y,40,3);ctx.fillStyle='#f3b08b';ctx.fillRect(p.x-20,p.y,40*Math.max(0,t.hp/t.maxHp),3);}ctx.restore();}}
  }
  const shades=new Map();
  function shadeColor(hex,m){
    const key=hex+':'+m;if(shades.has(key))return shades.get(key);
    const n=parseInt(hex.slice(1),16),r=Math.min(255,Math.round((n>>16)*m)),g=Math.min(255,Math.round(((n>>8)&255)*m)),b=Math.min(255,Math.round((n&255)*m)),out='rgb('+r+','+g+','+b+')';shades.set(key,out);return out;
  }

  function drawStructure(b){
    const x=b.x,z=b.z,w=b.w/2,d=b.d/2,lo=b.bottom,hi=b.top;
    if(camera.z<z)ground([[x-w,lo,z-d],[x+w,lo,z-d],[x+w,hi,z-d],[x-w,hi,z-d]],b.color);
    else ground([[x-w,lo,z+d],[x+w,lo,z+d],[x+w,hi,z+d],[x-w,hi,z+d]],b.color);
    if(camera.x<x)ground([[x-w,lo,z-d],[x-w,lo,z+d],[x-w,hi,z+d],[x-w,hi,z-d]],'#536c67');
    else ground([[x+w,lo,z-d],[x+w,lo,z+d],[x+w,hi,z+d],[x+w,hi,z-d]],'#6a8279');
    if(camera.y>=hi)ground([[x-w,hi,z-d],[x+w,hi,z-d],[x+w,hi,z+d],[x-w,hi,z+d]],b.kind==='stairs'?'#91a7a0':b.kind==='jumpPad'?'#94d9a1':'#8fa69c');
    else if(camera.y<lo)ground([[x-w,lo,z-d],[x+w,lo,z-d],[x+w,lo,z+d],[x-w,lo,z+d]],'#2c4049');
    if(b.kind==='jumpPad'){for(const zz of [-.65,0,.65]){
      worldLine({x:x-.7,y:hi+.035,z:z+zz+.35},{x,y:hi+.035,z:z+zz-.2},'#d7ffb4',.065);
      worldLine({x,y:hi+.035,z:z+zz-.2},{x:x+.7,y:hi+.035,z:z+zz+.35},'#d7ffb4',.065);
    }}

  }
  function dropHeal(t,roll=Math.random()){if(roll>=.25||healPacks.length>=5)return;healPacks.push({x:t.x,z:t.z,y:floorAt(t.x,t.z,t.y-1)+.55,life:25});}

  function beginLaserUlt(quick=false){
    if(!canAct()||laserUlt)return;cameraView();const dir=aimDirection(),range=Math.min(70,...solidWorld().map(b=>rayBox(camera,dir,b)));
    laserUlt={origin:{...camera},dir,elapsed:0,hit:false,range,duration:.7,damage:180};emitFx('laser',{range});say('오줌발싸',.8);voice('오줌');tone(180,.3,.1,'sawtooth');
  }
  function updateLaserUlt(dt){
    if(!laserUlt)return;const u=laserUlt;u.elapsed+=dt;
    if(!u.hit&&u.elapsed>=.18){u.hit=true;
      for(const t of targets){if(!t.alive)continue;const d=sphereDistance(u.origin,u.dir,{x:t.x,y:t.y,z:t.z},1.25);if(d<=u.range)damageTarget({t,head:false,effect:'laser'},u.damage,false);}
      if(gameMode==='duel')damagePilot(duelVictim(u.origin,u.dir,u.range,1.0),60,'laser');
    }if(u.elapsed>u.duration)laserUlt=null;
  }

  function drawLaserUlt(){
    if(!laserUlt)return;
    const u=laserUlt,end={x:u.origin.x+u.dir.x*u.range,y:u.origin.y+u.dir.y*u.range,z:u.origin.z+u.dir.z*u.range},q=project(end.x,end.y,end.z);
    if(!q){ctx.save();drawUrineStream(u.origin,u.dir,u.range,u.elapsed);ctx.fillStyle='#f5dc79';ctx.font='bold 38px sans-serif';ctx.textAlign='center';ctx.fillText('오줌발싸',W/2,125);ctx.restore();return;}
    const fade=clamp(Math.min(u.elapsed/.12,(u.duration-u.elapsed)/.2),0,1);
    const sx=W*.55,sy=H*.78,dx=q.x-sx,dy=q.y-sy,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
    const points=Array.from({length:19},(_,i)=>{const t=i/18,w=Math.sin(t*18-time*25)*7*Math.sin(t*Math.PI);return{x:sx+dx*t+nx*w,y:sy+dy*t+ny*w};});
    ctx.save();ctx.globalAlpha=fade;ctx.lineCap='round';ctx.lineJoin='round';
    for(const [width,color] of [[45,'#d89a2355'],[27,'#dbab29'],[16,'#f6d753'],[5,'#fff3b1']]){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}
    for(let i=0;i<8;i++){const t=(time*2+i/8)%1,spread=Math.sin(i*2.4)*18;ctx.fillStyle=i%2?'#f2ca45':'#ffe794';ctx.beginPath();ctx.ellipse(sx+dx*t+nx*spread,sy+dy*t+ny*spread,2.5,5,Math.atan2(dy,dx)-Math.PI/2,0,TAU);ctx.fill();}
    ctx.fillStyle='#f5dc79';ctx.font='bold 38px sans-serif';ctx.textAlign='center';ctx.fillText('오줌발싸',W/2,125);ctx.restore();
  }

  function beginPoopUlt(){
    if(!canAct()||poopUlt)return;if(ultCharge<100){say('똥 투하 · 궁극기 '+Math.floor(ultCharge)+'% / 100% · 상대를 맞혀 충전',1.8);tone(120,.08,.04);return;}ultCharge=0;cameraView();const d=aimDirection(),range=pitch<-.1?clamp((camera.y-7)/-d.y,3,30):24,x=clamp(camera.x+d.x*range,-16,16),z=clamp(camera.z+d.z*range,-5,62),ground=floorAt(x,z)+.1;
    poopUlt={x,z,y:ground+32,ground,elapsed:0,hit:false};emitFx('poop',{point:{x,y:ground,z}});say('뿌직!',1.3);voice('뿌직');tone(90,.3,.12,'sawtooth');
  }
  function updatePoopUlt(dt){if(!poopUlt)return;const u=poopUlt;u.elapsed+=dt;const fall=clamp(u.elapsed/.8,0,1);u.y=u.ground+32*(1-fall);
    if(!u.hit&&fall>=1){u.hit=true;ultActive=true;for(const t of targets)if(t.alive&&Math.hypot(t.x-u.x,t.z-u.z)<=10)damageTarget({t,head:false},600,false);ultActive=false;
      if(gameMode==='duel')for(const p of remotePilots())if(p.state.hp>0&&Math.hypot(p.state.x-u.x,p.state.z-u.z)<=10)damagePilot({pilot:p,head:false},100,'poop');tone(48,.4,.17,'triangle');}
    if(u.elapsed>1.7)poopUlt=null;
  }
  function drawPoopUlt(){if(poopUlt)drawFallingPoop(poopUlt);}

  function ultimate(){beginPoopUlt();}



  let quality='standard',hudClock=0,frameMs=16.7,killFeed=[],musicClock=0,musicStep=0;
  const tileMesh=[];
  for(let x=-20;x<20;x+=4)for(let z=-8;z<72;z+=4)tileMesh.push({points:[[x+.035,7.005,z+.035],[x+3.965,7.005,z+.035],[x+3.965,7.005,z+3.965],[x+.035,7.005,z+3.965]],dark:(x/4+z/4)%2===0});
  try{quality=localStorage.getItem('flush-quality')||'standard';}catch(e){}
  function applyQuality(){canvas.width=quality==='low'?1008:1440;canvas.height=quality==='low'?630:900;}
  applyQuality();$('#quality').value=quality;
  $('#quality').onchange=()=>{quality=$('#quality').value;applyQuality();try{localStorage.setItem('flush-quality',quality);}catch(e){}};

  function viewDepth(p){return (p.y-camera.y)*viewSinPitch+((p.x-camera.x)*viewSinYaw+(p.z-camera.z)*viewCosYaw)*viewCosPitch;}
  function worldLine(a,b,color,width=.035){
    // Clip at the camera plane rather than dropping an entire incoming effect.
    const near=.22,da=viewDepth(a),db=viewDepth(b);if(da<near&&db<near)return false;
    if(da<near||db<near){
      const t=(near-da)/(db-da),p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
      if(da<near)a=p;else b=p;
    }
    const pa=project(a.x,a.y,a.z),pb=project(b.x,b.y,b.z);if(!pa||!pb)return false;
    const dx=pb.x-pa.x,dy=pb.y-pa.y;let lo=0,hi=1;
    for(const [p,q] of [[-dx,pa.x+40],[dx,W+40-pa.x],[-dy,pa.y+40],[dy,H+40-pa.y]]){
      if(Math.abs(p)<1e-8){if(q<0)return false;continue;}
      const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;
    }
    ctx.strokeStyle=color;ctx.lineWidth=clamp((pa.s+pb.s)*.5*width,1,30);ctx.lineCap='round';ctx.beginPath();
    ctx.moveTo(pa.x+dx*lo,pa.y+dy*lo);ctx.lineTo(pa.x+dx*hi,pa.y+dy*hi);ctx.stroke();return true;
  }
  function drawUrineStream(o,d,range,age){
    const r=clamp(Number(range)||0,0,70),side={x:d.z,z:-d.x};
    const point=t=>{const v=r*t,w=Math.sin(t*25-age*30)*.10*Math.sin(t*Math.PI);return{x:o.x+d.x*v+side.x*w,y:o.y+d.y*v+Math.sin(t*19-age*24)*.055,z:o.z+d.z*v+side.z*w};};
    for(let i=0;i<20;i++){const a=point(i/20),b=point((i+1)/20);worldLine(a,b,'#dba11f55',.32);worldLine(a,b,'#f5cd36',.14);worldLine(a,b,'#fff2ae',.04);}
    for(let i=0;i<8;i++){
      const a=point((age*2+i/8)%1),p=project(a.x,a.y,a.z);
      if(p&&p.x>-10&&p.x<W+10&&p.y>-10&&p.y<H+10){ctx.fillStyle='#ffe992';ctx.beginPath();ctx.ellipse(p.x,p.y,clamp(p.s*.05,1.5,5),clamp(p.s*.1,2,8),0,0,TAU);ctx.fill();}
    }
  }
  function drawSkillWarnings(){
    const list=skillWarnings.slice(-2);
    if(poopUlt)list.push({effect:'poop',point:{x:poopUlt.x,y:poopUlt.ground,z:poopUlt.z},age:poopUlt.elapsed,duration:1.7,local:true});
    for(let i=0;i<list.length;i++){
      const e=list[i],p=project(e.point.x,e.point.y+.35,e.point.z),enemy=gameMode==='duel'&&!e.local;
      const onScreen=p&&p.x>85&&p.x<W-85&&p.y>180&&p.y<H-190,a=Math.atan2(e.point.x-camera.x,e.point.z-camera.z)-yaw;
      const x=onScreen?p.x:W/2+Math.sin(a)*W*.38,y=onScreen?p.y:H/2-Math.cos(a)*H*.27,color=e.effect==='laser'?'#ffe064':enemy?'#ff986b':'#e3bd89';
      ctx.save();ctx.globalAlpha=clamp((e.duration-e.age)*4,0,1);ctx.textAlign='center';
      ctx.translate(x,y);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,17,0,TAU);ctx.stroke();
      if(!onScreen){ctx.rotate(a);polygon([{x:0,y:-12},{x:-6,y:5},{x:6,y:5}],color);ctx.rotate(-a);}
      else{ctx.fillStyle=color;ctx.font='900 18px sans-serif';ctx.fillText(e.effect==='poop'?'!':'E',0,6);}
      ctx.translate(-x,-y);
      const label=(e.local?'내 ':enemy?'상대 ':'팀원 ')+effectName(e.effect)+(e.effect==='poop'?(e.age<.8?' · '+(.8-e.age).toFixed(1)+'초 후 낙하':' · 착탄'):' 발사');
      ctx.font='bold 17px sans-serif';const width=ctx.measureText(label).width+32;
      ctx.fillStyle='#17242ce8';ctx.beginPath();ctx.roundRect(W/2-width/2,175+i*36,width,30,6);ctx.fill();ctx.fillStyle=color;ctx.fillText(label,W/2,196+i*36);
      if(e.effect==='poop'&&Math.hypot(camera.x-e.point.x,camera.z-e.point.z)<10&&e.age<.8){
        ctx.strokeStyle=enemy?'#ff885a99':'#efc77e66';ctx.lineWidth=5;ctx.strokeRect(5,5,W-10,H-10);
        ctx.fillStyle=color;ctx.font='900 23px sans-serif';ctx.fillText(enemy?'낙하 범위 안! 대시로 피하세요':'투하 위치',W/2,H*.31);
      }ctx.restore();
    }
  }
  function worldRing(x,y,z,r,color,alpha=1){
    const pts=Array.from({length:24},(_,i)=>[x+Math.cos(i*TAU/24)*r,y,z+Math.sin(i*TAU/24)*r]);
    ctx.save();ctx.globalAlpha=alpha;
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];worldLine({x:a[0],y:a[1],z:a[2]},{x:b[0],y:b[1],z:b[2]},color,.045);}
    ctx.restore();
  }
  function worldLabel(x,y,z,text,color='#dcebb9',size=.65){
    const p=project(x,y,z);if(!p)return;ctx.save();ctx.textAlign='center';ctx.font='bold '+clamp(p.s*size,8,75)+'px monospace';ctx.fillStyle=color;ctx.fillText(text,p.x,p.y);ctx.restore();
  }
  function drawEnvironment(){
    const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#071c26');sky.addColorStop(.48,'#305b60');sky.addColorStop(1,'#142e35');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    ground([[-180,0,-180],[180,0,-180],[180,0,180],[-180,0,180]],'#14282f');
    ground([[-23,7,-13],[23,7,-13],[23,7,77],[-23,7,77]],'#182f34');

    const oval=(rx,rz,y)=>Array.from({length:48},(_,i)=>[Math.cos(i*TAU/48)*rx,y,30+Math.sin(i*TAU/48)*rz]);
    ground(oval(22.1,44,7.008),'#9cada6');ground(oval(20.8,42.4,7.009),'#617f7a');
    ground(oval(19.6,40,7.010),'#304b50');
    // The playable floor remains level; only the outer porcelain rim is raised.
    for(const tile of tileMesh){const centerX=tile.points[0][0]+2,centerZ=tile.points[0][2]+2;if((centerX/19.6)**2+((centerZ-30)/40)**2<.85)ground(tile.points.map(p=>[p[0],7.012,p[2]]),tile.dark?'#345357':'#3b5d60');}
    for(const x of [-17.5,17.5])ground([[x,7.02,-4],[x+.075,7.02,-4],[x+.075,7.02,66],[x,7.02,66]],'#b4dcb4');
    for(const b of arena.filter(b=>b.kind==='jumpPad')){worldRing(b.x,b.top+.04,b.z,1.1,'#b9f0a2');worldLabel(b.x,b.top+.1,b.z,'↑','#d4ffc7',.6);}
    const sectors=['SECTOR 01 / PORCELAIN','SECTOR 02 / PRESSURE','SECTOR 03 / OVERFLOW'];
    worldLabel(0,22,76.8,'FLUSH PROTOCOL','#d1e1cc',2.4);
    worldLabel(0,18.7,76.7,sectors[Math.floor((wave-1)/5)%3],'#a3cbaa',.65);
    for(const x of [-20,20]){worldLine({x,y:9,z:0},{x,y:9,z:66},'#679b8c',.08);worldLabel(x,10,15,x<0?'01':'02','#dbeab8',1.2);}
    if(quality==='standard')for(let i=0;i<14;i++){const z=(i*7+time*.1)%70,x=Math.sin(i*13.1)*18,p=project(x,10+Math.sin(time*.6+i)*1.7,z);if(p){ctx.fillStyle='#d1ef9125';ctx.fillRect(p.x,p.y,2,2);}}
  }
  function drawRemoteFx(){
    for(const e of remoteFx){
      const o=e.origin,d=e.dir,age=e.age,alpha=clamp(1-age/e.duration,0,1);ctx.save();ctx.globalAlpha=Math.min(1,alpha*2);
      if(e.effect==='shot'){
        const range=clamp(e.range||65,1,100),t=clamp(age/.32,0,1);
        for(let i=0;i<3;i++){const v=Math.max(0,t-i*.025)*range,p=project(o.x+d.x*v,o.y+d.y*v,o.z+d.z*v);if(p){ctx.fillStyle=i===0?'#fff1ac':'#efbf7366';ctx.beginPath();ctx.arc(p.x,p.y,clamp(p.s*.065,1.5,5),0,TAU);ctx.fill();}}
        if(age<.08)worldLine(o,{x:o.x+d.x,y:o.y+d.y,z:o.z+d.z},'#fff6ca',.12);
      }else if(e.effect==='laser'){
        drawUrineStream(o,d,e.range??70,age);
      }else if(e.effect==='poop'&&e.point){
        drawFallingPoop({...e.point,y:e.point.y+32*(1-clamp(age/.8,0,1)),ground:e.point.y,elapsed:age,hit:age>=.8},false);
      }else if(e.effect==='paper'){
        const t=age,p=project(o.x+d.x*18*t,o.y+5*t-9*t*t,o.z+d.z*18*t);if(p)drawPaperRoll(p.x,p.y,clamp(p.s*.3,4,24));
      }else if(e.effect==='dash'){worldRing(o.x,o.y-1.6,o.z,1+age*4,'#a8ffdc',alpha);}
      else if(e.effect==='melee'){
        const a={x:o.x+d.x,y:o.y-.5,z:o.z+d.z},b={x:o.x+d.x*2+Math.cos(age*12)*.6,y:o.y+.5,z:o.z+d.z*2};
        worldLine(a,b,'#bc9465',.12);const p=project(b.x,b.y,b.z);if(p){ctx.fillStyle='#d67f6d';ctx.beginPath();ctx.ellipse(p.x,p.y,p.s*.35,p.s*.13,0,0,TAU);ctx.fill();}
      }
      ctx.restore();
    }
  }

  function drawFallingPoop(u,title=true){
    const fade=u.hit?clamp((1.7-u.elapsed)/.9,0,1):1;
    worldRing(u.x,u.ground+.03,u.z,10,u.hit?'#e7be7a':'#ffc273',fade*.8);
    if(!u.hit){
      worldRing(u.x,u.ground+.05,u.z,2+clamp(u.elapsed/.8,0,1)*7,'#ffc273',.65);
      worldLine({x:u.x,y:u.ground,z:u.z},{x:u.x,y:u.y,z:u.z},'#ebc28255',.12);
    }
    const p=project(u.x,u.y,u.z);ctx.save();
    if(u.hit){
      ctx.globalAlpha=fade;worldRing(u.x,u.ground+.12,u.z,Math.min(10,(u.elapsed-.8)*18),'#dda770',fade);
      for(let i=0;i<16;i++){
        const a=i*TAU/16,v=(u.elapsed-.8)*10,pp=project(u.x+Math.cos(a)*v,u.ground+.4+Math.sin(clamp(v/9,0,1)*Math.PI)*1.8,u.z+Math.sin(a)*v);
        if(pp){ctx.fillStyle=i%2?'#bb8955':'#795538';ctx.beginPath();ctx.arc(pp.x,pp.y,clamp(pp.s*.25,3,18),0,TAU);ctx.fill();}
      }
    }else if(p&&p.x>-180&&p.x<W+180&&p.y>-180&&p.y<H+180){
      const r=clamp(p.s*1.8,16,150);ctx.translate(p.x,p.y);ctx.scale(r,r);
      for(const [y,rx,ry,c] of [[.35,1,.42,'#745135'],[-.08,.8,.36,'#946940'],[-.43,.53,.3,'#b08551']]){
        ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(0,y,rx,ry,0,0,TAU);ctx.fill();ctx.strokeStyle='#efcd9577';ctx.lineWidth=.05;ctx.stroke();
      }
      ctx.fillStyle='#c59b65';ctx.beginPath();ctx.moveTo(-.32,-.52);ctx.bezierCurveTo(-.4,-.85,.3,-.65,.05,-1.15);ctx.bezierCurveTo(.6,-.95,.6,-.62,.2,-.49);ctx.fill();
    }ctx.restore();
    // Text stays visible even when the falling object is overhead.
    if(title){ctx.save();ctx.fillStyle='#f4d3a2';ctx.font='900 36px sans-serif';ctx.textAlign='center';ctx.fillText('뿌직!',W/2,145);ctx.restore();}
  }
  function addKill(head,boss){killFeed.unshift({text:(boss?'보스 격파':head?'헤드샷':'처치')+'  +'+(head?300:100),life:3});killFeed=killFeed.slice(0,4);}
  function polishUpdate(dt){
    damageCue.life=Math.max(0,damageCue.life-dt);
    if(hp>=hpTrail)hpTrail=hp;else if(damageCue.life<.85)hpTrail+=(hp-hpTrail)*(1-Math.exp(-6*dt));
    skillWarnings.forEach(e=>e.age+=dt);skillWarnings=skillWarnings.filter(e=>e.age<e.duration);
    remoteFx.forEach(e=>e.age+=dt);remoteFx=remoteFx.filter(e=>e.age<e.duration);
    for(const p of remotePilots()){const v=remoteViews.get(p.playerId);if(v){const f=1-Math.exp(-12*dt);for(const key of ['x','y','z'])v[key]+=(p.state[key]-v[key])*f;}}
    killFeed.forEach(e=>e.life-=dt);killFeed=killFeed.filter(e=>e.life>0);
    if(mode==='playing'&&!muted&&musicEnabled&&audio){musicClock-=dt;if(musicClock<=0){musicClock=.24;const notes=[130.81,164.81,196,164.81,110,146.83,174.61,146.83];tone(notes[musicStep++%8],.22,.012,'sine');if(musicStep%4===0)tone(50,.14,.018,'triangle');}}
  }
  function drawRadar(){
    const c=$('#radar').getContext('2d'),w=150;c.clearRect(0,0,w,w);c.save();c.translate(75,75);
    c.strokeStyle='#8fad9b22';c.lineWidth=1;for(const r of [23,47,68]){c.beginPath();c.arc(0,0,r,0,TAU);c.stroke();}
    c.fillStyle='#bde9b41c';c.beginPath();c.moveTo(0,0);c.arc(0,0,67,-Math.PI*.72,-Math.PI*.28);c.closePath();c.fill();
    function point(x,z,color){let dx=x-camera.x,dz=z-camera.z,px=(dx*Math.cos(yaw)-dz*Math.sin(yaw))*1.5,py=-(dx*Math.sin(yaw)+dz*Math.cos(yaw))*1.5;const l=Math.hypot(px,py);if(l>64){px*=64/l;py*=64/l;}c.fillStyle=color;c.beginPath();c.arc(px,py,2.8,0,TAU);c.fill();}
    targets.filter(t=>t.alive).forEach(t=>point(t.x,t.z,t.boss?'#ffda86':t.flyer?'#dab5f1':'#f59981'));
    remotePilots().filter(p=>p.state.hp>0).forEach(p=>point(p.state.x,p.state.z,gameMode==='duel'?'#ff806d':'#a0f8d1'));
    c.fillStyle='#e6f9bb';c.beginPath();c.moveTo(0,-5);c.lineTo(-4,4);c.lineTo(4,4);c.fill();c.restore();
  }
  function polishHud(){
    $('#roundTrack').hidden=gameMode==='duel';
    $('#roundFill').style.width=((wave-1)/10*100)+'%';
    $('#roundTitle').textContent='ROUND '+String(wave).padStart(2,'0')+' / 10';
    $('#roundName').textContent=ROUND_NAMES[wave-1]||'최종 세척';
    const objective=mission.capture&&mission.progress<mission.required;
    $('#captureTrack').hidden=!objective||gameMode==='duel';
    $('#captureFill').style.width=(mission.progress/Math.max(1,mission.required)*100)+'%';
    $('#captureText').textContent=(wave===8?'오른쪽 배관 정비대':'중앙 배수구')+' 안에서 밸브 확보 · '+Math.floor(mission.progress)+' / '+mission.required+'초';
    $('#tutorialHint').hidden=gameMode==='duel'||wave!==1||mission.clock>18||mode!=='playing';
    if(gameMode!=='duel')$('#objective').textContent=(online.roomCode?'방 '+online.roomCode+' · ':'')+(objective?'노란 기둥으로 이동해 밸브를 확보하세요':'남은 적 '+targets.filter(t=>t.alive).length+'명 · '+(wave===10?'최종 보스를 처치하세요':'적을 모두 처치하세요'));
    if(online.roomCode&&hp<=0&&!mission.failed)$('#stats').textContent=reviveProgress>0?'팀원이 구조 중 · '+Math.ceil(3-reviveProgress)+'초':'팀원이 내 위치에서 3초 동안 머무르면 부활합니다.';

    const wet=$('#slowStatus'),remaining=hp>0?slowRemaining():0;
    wet.hidden=remaining<=0||mode==='menu';wet.textContent='오줌 맞음 · 이동 속도 50% · '+remaining.toFixed(1)+'초';
    $('#stage').dataset.state=mode;$('#performance').textContent=Math.round(1000/frameMs)+' FPS'+(online.roomCode?' · '+online.ping+'ms':'');
    $('#killFeed').textContent=killFeed.map(e=>e.text).join(' · ');
    $('#reloadFill').style.width=(reload>0?(1-reload/gun().reload)*100:0)+'%';
    const mates=remotePilots();$('#teamStatus').textContent=mates.map(p=>(gameMode==='duel'?'VS ':'TEAM ')+p.name+' '+Math.ceil(p.state.hp)+' HP'+(gameMode==='duel'?' · '+(p.state.score||0)+'킬':'')).join(' / ');
    const boss=targets.find(t=>t.boss&&t.alive),bar=$('#bossTrack');bar.hidden=!boss;
    if(boss){$('#bossName').textContent='배관 파괴자';$('#bossHp').style.width=clamp(boss.hp/boss.maxHp*100,0,100)+'%';}
    const banner=$('#duelBanner');banner.hidden=true;
    if(gameMode==='duel'&&online.roomCode){
      const me=online.pilots.find(p=>p.playerId===online.playerId),op=mates[0];$('#wave').textContent='1대1 · 먼저 5킬';$('#score').textContent=(me?.state.score||0)+' : '+(op?.state.score||0);
      $('#objective').textContent='방 '+online.roomCode+' · 5킬 승리 · 사망 후 3초 재등장';
      const now=Date.now()/1000+online.serverOffset;
      const text=!mates.length?'상대의 연결을 기다리는 중':online.readyAt>now?Math.ceil(online.readyAt-now)+'초 후 대전 시작':hp<=0?Math.max(1,Math.ceil((me?.state.respawnAt||now+1)-now))+'초 후 재등장':'';
      if(text){banner.hidden=false;banner.textContent=text;}
    }
    if(soapSelected){$('#weaponName').textContent='휴지 투척';$('#ammo').textContent=soapCount;$('#magSize').textContent='ROLLS';$('#weaponStatus').textContent='좌클릭 투척 · 반경 4m';}
    for(const [i,id] of ['sniper','rifle'].entries())$('#slot'+(i+1)).classList.toggle('active',!soapSelected&&id===weaponId);
    drawRadar();
  }

  let accumulator=0,idleDraw=0;
  function frame(now){
    const raw=Math.min(.1,(now-(last||now))/1000);last=now;frameMs+=(raw*1000-frameMs)*.03;
    accumulator+=raw;while(accumulator>=1/60){polishUpdate(1/60);update(1/60);accumulator-=1/60;}
    effects=effects.slice(-96);projectiles=projectiles.slice(-80);tracers=tracers.slice(-48);
    idleDraw+=raw;if(['playing','homewalk','entering'].includes(mode)||idleDraw>=.05){draw();idleDraw=0;}
    hudClock+=raw;if(hudClock>=.1){updateHud();hudClock=0;}
    requestAnimationFrame(frame);
  }
  window.startCombat=()=>{leaveRoom();start('combat');};
  requestAnimationFrame(frame);
})();
